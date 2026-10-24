// The test fault switch (milestone M04, In scope 6): WCR_TEST_FAULTS lets an E2E test make one
// read fail exactly once, to show an error state with Retry:
//   - lineage-once: the lineage reads (lineage.*, people.students), for the catchError state of
//     the profile and the list view's sections;
//   - person-once: the profile read (people.get), for the error state of a whole person page.
//
// It does not exist in a deployable build (M04 Constraints). Every exported function starts with
// a condition on process.env.NODE_ENV and process.env.WCR_E2E_BUILD, which `next build` replaces
// with constants (next.config.ts `env`): in a build made without WCR_E2E_BUILD=1 the condition is
// a constant `return`, the minifier drops what follows, and neither the cookie nor the faults are
// in the server bundle (scripts/verify.d/M04.sh makes such a build and checks). It is compiled in
// for `next dev`, the unit tests and the E2E build, which scripts/verify.sh makes with
// WCR_E2E_BUILD=1 (`pnpm build:e2e`). A deployable server started with WCR_TEST_FAULTS refuses
// to start.
//
// Where it is compiled in, it still cannot reach a public server:
//   - it is honoured only when APP_URL names a loopback host;
//   - startup (src/server/auth/startup.ts) refuses to start a server whose WCR_TEST_FAULTS is set
//     with a non-loopback APP_URL, or names an unknown fault;
//   - even when it is honoured, only a request that carries the cookie
//     `wcr-test-fault=<fault>:<token>` fails, and only on the first read of that kind with that
//     token; every later read with the same token succeeds (the Retry of the test).
// docs/api/lineage.md describes it.

import { hasLoopbackAppUrl } from './auth/env';

type Env = Record<string, string | undefined>;

export type TestFaultKind = 'lineage-once' | 'person-once';

/** The fault a request asked for with its cookie, and the token that makes it fail only once. */
export interface TestFault {
  kind: TestFaultKind;
  token: string;
}

/** Tokens already used, per process; bounded so a long test run cannot grow it without end. */
const MAX_TOKENS = 1000;

/** The faults WCR_TEST_FAULTS names (comma-separated). */
function requestedTestFaults(env: Env): string[] {
  return (env.WCR_TEST_FAULTS ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
}

function isKnown(fault: string): fault is TestFaultKind {
  return fault === 'lineage-once' || fault === 'person-once';
}

/** True when WCR_TEST_FAULTS may be honoured: an APP_URL on a loopback host. */
function loopback(env: Env): boolean {
  try {
    return hasLoopbackAppUrl(env);
  } catch {
    // An APP_URL that is missing or invalid counts as not loopback.
    return false;
  }
}

/**
 * Throws when WCR_TEST_FAULTS is set where it must not be: an unknown fault, or any fault with an
 * APP_URL that is not a loopback host. Startup calls it in every environment. A deployable build
 * has no switch, so there any value is refused: a server started with it would only pretend to
 * run the error-state tests.
 */
export function checkTestFaults(env: Env = process.env): void {
  if (process.env.NODE_ENV === 'production' && process.env.WCR_E2E_BUILD !== '1') {
    if ((env.WCR_TEST_FAULTS ?? '').trim() !== '') {
      throw new Error('WCR_TEST_FAULTS is set, but this build has no test switch (only a build made with WCR_E2E_BUILD=1 has it)');
    }
    return;
  }
  const faults = requestedTestFaults(env);
  if (faults.length === 0) return;
  if (!faults.every(isKnown)) throw new Error('WCR_TEST_FAULTS names an unknown fault (allowed: lineage-once, person-once)');
  if (!loopback(env)) throw new Error('WCR_TEST_FAULTS is a test switch and is refused unless APP_URL is a loopback host');
}

/** The faults that are switched on and allowed (loopback APP_URL only); none in a deployable build. */
export function enabledTestFaults(env: Env = process.env): TestFaultKind[] {
  if (process.env.NODE_ENV === 'production' && process.env.WCR_E2E_BUILD !== '1') return [];
  if (!loopback(env)) return [];
  return requestedTestFaults(env).filter(isKnown);
}

/**
 * The fault this request's cookie asks for, or null: always null when that fault is not switched
 * on, and for a malformed cookie value (never an error: the switch must not break a request).
 */
export function testFaultOf(headers: Headers, env: Env = process.env): TestFault | null {
  if (process.env.NODE_ENV === 'production' && process.env.WCR_E2E_BUILD !== '1') return null;
  const cookie = headers.get('cookie');
  if (!cookie) return null;
  const enabled = enabledTestFaults(env);
  if (enabled.length === 0) return null;
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== 'wcr-test-fault') continue;
    let value: string;
    try {
      value = decodeURIComponent(rest.join('='));
    } catch {
      continue;
    }
    const match = /^(lineage-once|person-once):([A-Za-z0-9-]{1,64})$/.exec(value);
    const kind = match?.[1];
    if (match && kind && isKnown(kind) && enabled.includes(kind)) return { kind, token: match[2]! };
  }
  return null;
}

/** Fails the first read of `kind` that carries the request's fault token, then never again for it. */
export function failOnce(fault: TestFault | null | undefined, kind: TestFaultKind): void {
  if (process.env.NODE_ENV === 'production' && process.env.WCR_E2E_BUILD !== '1') return;
  if (!fault || fault.kind !== kind) return;
  // Kept on globalThis: Next.js may load this module more than once in one server process.
  const store = globalThis as unknown as { __wcrUsedFaultTokens?: Set<string> };
  store.__wcrUsedFaultTokens ??= new Set();
  const used = store.__wcrUsedFaultTokens;
  const key = `${fault.kind}:${fault.token}`;
  if (used.has(key)) return;
  if (used.size >= MAX_TOKENS) used.clear();
  used.add(key);
  throw new Error(`Test fault: ${kind} (WCR_TEST_FAULTS).`);
}
