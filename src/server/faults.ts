// The test fault switch (milestone M04, In scope 6): WCR_TEST_FAULTS=lineage-once lets an E2E test
// make the lineage service fail exactly once, to show the catchError state with Retry.
//
// It cannot reach a real deployment:
//   - it is honoured only when APP_URL names a loopback host (`next dev`, or `next start` on this
//     machine for the E2E tests), never behind a public origin;
//   - startup (src/server/auth/startup.ts) refuses to start a server whose WCR_TEST_FAULTS is set
//     with a non-loopback APP_URL, or names an unknown fault;
//   - even when it is honoured, only a request that carries the cookie
//     `wcr-test-fault=lineage-once:<token>` fails, and only on the first lineage call that carries
//     that token; every later call with the same token succeeds (the Retry of the test).
// docs/api/lineage.md describes it.

import { hasLoopbackAppUrl } from './auth/env';

type Env = Record<string, string | undefined>;

export const TEST_FAULTS_ENV = 'WCR_TEST_FAULTS';
export const TEST_FAULT_COOKIE = 'wcr-test-fault';
const KNOWN_FAULTS = new Set(['lineage-once']);
const TOKEN = /^lineage-once:([A-Za-z0-9-]{1,64})$/;
/** Tokens already used, per process; bounded so a long test run cannot grow it without end. */
const MAX_TOKENS = 1000;

/** The faults WCR_TEST_FAULTS names (comma-separated). */
export function requestedTestFaults(env: Env = process.env): string[] {
  return (env[TEST_FAULTS_ENV] ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
}

/**
 * Throws when WCR_TEST_FAULTS is set where it must not be: an unknown fault, or any fault with an
 * APP_URL that is not a loopback host. Startup calls it in every environment.
 */
export function checkTestFaults(env: Env = process.env): void {
  const faults = requestedTestFaults(env);
  if (faults.length === 0) return;
  const unknown = faults.find((f) => !KNOWN_FAULTS.has(f));
  if (unknown !== undefined) throw new Error(`${TEST_FAULTS_ENV} names an unknown fault (allowed: lineage-once)`);
  // An APP_URL that is missing or invalid counts as not loopback, so the refusal names the switch.
  if (!testFaultsEnabled(env)) {
    throw new Error(`${TEST_FAULTS_ENV} is a test switch and is refused unless APP_URL is a loopback host`);
  }
}

/** True when the lineage-once fault is switched on and allowed (loopback APP_URL only). */
export function testFaultsEnabled(env: Env = process.env): boolean {
  if (!requestedTestFaults(env).includes('lineage-once')) return false;
  try {
    return hasLoopbackAppUrl(env);
  } catch {
    return false;
  }
}

/** The fault token of this request's cookie, or null (always null when the switch is off). */
export function testFaultToken(headers: Headers, env: Env = process.env): string | null {
  if (!testFaultsEnabled(env)) return null;
  const cookie = headers.get('cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== TEST_FAULT_COOKIE) continue;
    const match = TOKEN.exec(decodeURIComponent(rest.join('=')));
    if (match) return match[1]!;
  }
  return null;
}

// Kept on globalThis: Next.js may load this module more than once in one server process.
const store = globalThis as unknown as { __wcrUsedFaultTokens?: Set<string> };

/** Fails the first call that carries `token`, then never again for that token. */
export function failOnce(token: string | null | undefined): void {
  if (!token) return;
  store.__wcrUsedFaultTokens ??= new Set();
  const used = store.__wcrUsedFaultTokens;
  if (used.has(token)) return;
  if (used.size >= MAX_TOKENS) used.clear();
  used.add(token);
  throw new Error('Test fault: the lineage service failed once (WCR_TEST_FAULTS=lineage-once).');
}
