// The test fault switch (milestone M04, In scope 6 and Constraints): compiled only into the E2E
// build, honoured only behind a loopback APP_URL, refused at startup anywhere else, and each token
// fails exactly once, for its own kind of read.

import { afterEach, describe, expect, it } from 'vitest';

import { checkProductionSettings, startOrExit } from './auth/startup';
import { checkTestFaults, enabledTestFaults, failOnce, testFaultOf } from './faults';

const SECRET = 'x'.repeat(40);
const publicProduction = {
  NODE_ENV: 'production',
  APP_URL: 'https://wingchunroots.example',
  TRUSTED_PROXIES: '10.0.0.1',
  BETTER_AUTH_SECRET: SECRET,
  IP_HMAC_KEY: SECRET,
  MAIL_SEAL_KEY: SECRET,
};
const loopbackProduction = { ...publicProduction, APP_URL: 'http://127.0.0.1:3140' };
const on = { WCR_TEST_FAULTS: 'lineage-once,person-once', APP_URL: 'http://localhost:3140' };

const cookie = (value: string) => new Headers({ cookie: `theme=dark; wcr-test-fault=${value}` });
const token = () => `unit-${Math.random().toString(36).slice(2)}`;

/**
 * Runs `fn` under the condition `next build` inlines into a build: NODE_ENV "production", and
 * WCR_E2E_BUILD "1" for the E2E build or empty for a deployable one (next.config.ts). Here they
 * are read at run time, so setting them is the same condition.
 */
function asBuild<T>(kind: 'deployable' | 'e2e', fn: () => T): T {
  const env = process.env as Record<string, string | undefined>;
  const saved = { NODE_ENV: env.NODE_ENV, WCR_E2E_BUILD: env.WCR_E2E_BUILD };
  env.NODE_ENV = 'production';
  env.WCR_E2E_BUILD = kind === 'e2e' ? '1' : '';
  try {
    return fn();
  } finally {
    env.NODE_ENV = saved.NODE_ENV;
    if (saved.WCR_E2E_BUILD === undefined) delete env.WCR_E2E_BUILD;
    else env.WCR_E2E_BUILD = saved.WCR_E2E_BUILD;
  }
}

afterEach(() => {
  delete process.env.WCR_E2E_BUILD;
});

describe('WCR_TEST_FAULTS', () => {
  it('is honoured only with a loopback APP_URL', () => {
    expect(enabledTestFaults({ ...loopbackProduction, WCR_TEST_FAULTS: 'lineage-once' })).toEqual(['lineage-once']);
    expect(enabledTestFaults({ WCR_TEST_FAULTS: 'lineage-once, person-once' })).toEqual(['lineage-once', 'person-once']); // next dev: localhost
    expect(enabledTestFaults({ ...publicProduction, WCR_TEST_FAULTS: 'lineage-once' })).toEqual([]);
    expect(enabledTestFaults({ NODE_ENV: 'development', APP_URL: 'https://staging.example', WCR_TEST_FAULTS: 'lineage-once' })).toEqual([]);
    expect(enabledTestFaults(loopbackProduction)).toEqual([]);
  });

  it('startup refuses it behind a public APP_URL, in production and outside it, and refuses unknown faults', () => {
    expect(() => checkProductionSettings({ ...publicProduction, WCR_TEST_FAULTS: 'lineage-once' })).toThrow(/WCR_TEST_FAULTS/);
    expect(() => checkTestFaults({ NODE_ENV: 'development', APP_URL: 'https://staging.example', WCR_TEST_FAULTS: 'person-once' })).toThrow(
      /loopback/,
    );
    expect(() => checkTestFaults({ WCR_TEST_FAULTS: 'everything' })).toThrow(/unknown fault/);
    expect(() => checkTestFaults({ WCR_TEST_FAULTS: 'lineage-once,everything' })).toThrow(/unknown fault/);
    // An APP_URL that fails its own check (http behind a public host, or none in production) still
    // gets a refusal that names the switch.
    expect(() => checkTestFaults({ ...publicProduction, APP_URL: 'http://wingchunroots.example', WCR_TEST_FAULTS: 'lineage-once' })).toThrow(
      /WCR_TEST_FAULTS is a test switch/,
    );
    expect(() => checkTestFaults({ NODE_ENV: 'production', WCR_TEST_FAULTS: 'lineage-once' })).toThrow(/WCR_TEST_FAULTS is a test switch/);
    expect(() => checkProductionSettings({ ...loopbackProduction, WCR_TEST_FAULTS: 'lineage-once,person-once' })).not.toThrow();
    expect(() => checkProductionSettings(publicProduction)).not.toThrow();

    const messages: string[] = [];
    const error = console.error;
    console.error = (m: string) => messages.push(m);
    try {
      expect(() =>
        startOrExit({ ...publicProduction, WCR_TEST_FAULTS: 'lineage-once' }, (code) => {
          throw new Error(`exit ${code}`);
        }),
      ).toThrow('exit 1');
    } finally {
      console.error = error;
    }
    expect(messages).toEqual([expect.stringMatching(/^WingChunRoots cannot start: WCR_TEST_FAULTS/)]);
  });

  it('reads the fault from the cookie only when that fault is switched on', () => {
    expect(testFaultOf(cookie('lineage-once:abc-123'), on)).toEqual({ kind: 'lineage-once', token: 'abc-123' });
    expect(testFaultOf(cookie('person-once:abc-123'), on)).toEqual({ kind: 'person-once', token: 'abc-123' });
    expect(testFaultOf(cookie('person-once:abc-123'), { ...on, WCR_TEST_FAULTS: 'lineage-once' })).toBeNull();
    expect(testFaultOf(cookie('lineage-once:abc-123'), { APP_URL: 'http://localhost:3140' })).toBeNull();
    expect(testFaultOf(cookie('lineage-once:abc-123'), { ...publicProduction, WCR_TEST_FAULTS: 'lineage-once' })).toBeNull();
    expect(testFaultOf(cookie('other:abc'), on)).toBeNull();
    expect(testFaultOf(cookie('lineage-once:'), on)).toBeNull();
    expect(testFaultOf(new Headers(), on)).toBeNull();
  });

  it('treats a malformed cookie value as no fault instead of failing the request', () => {
    // decodeURIComponent throws URIError on this value; the request must go on as if there were no cookie.
    expect(() => testFaultOf(cookie('%E0%A4%A'), on)).not.toThrow();
    expect(testFaultOf(cookie('%E0%A4%A'), on)).toBeNull();
    // A malformed cookie before a valid one does not hide the valid one.
    expect(testFaultOf(new Headers({ cookie: 'wcr-test-fault=%E0%A4%A; wcr-test-fault=lineage-once:ok-1' }), on)).toEqual({
      kind: 'lineage-once',
      token: 'ok-1',
    });
  });

  it('fails the first read of its kind with a token and never again', () => {
    const lineage = { kind: 'lineage-once' as const, token: token() };
    // A profile read does not use up a lineage fault.
    expect(() => failOnce(lineage, 'person-once')).not.toThrow();
    expect(() => failOnce(lineage, 'lineage-once')).toThrow(/Test fault: lineage-once/);
    expect(() => failOnce(lineage, 'lineage-once')).not.toThrow();

    const person = { kind: 'person-once' as const, token: token() };
    expect(() => failOnce(person, 'person-once')).toThrow(/Test fault: person-once/);
    expect(() => failOnce(person, 'person-once')).not.toThrow();

    expect(() => failOnce(null, 'lineage-once')).not.toThrow();
    expect(() => failOnce(undefined, 'person-once')).not.toThrow();
  });

  it('does nothing in a deployable build, and a deployable server refuses to start with it', () => {
    asBuild('deployable', () => {
      expect(enabledTestFaults(on)).toEqual([]);
      expect(testFaultOf(cookie('lineage-once:abc-123'), on)).toBeNull();
      expect(() => failOnce({ kind: 'lineage-once', token: token() }, 'lineage-once')).not.toThrow();
      expect(() => checkTestFaults({ ...loopbackProduction, WCR_TEST_FAULTS: 'lineage-once' })).toThrow(/this build has no test switch/);
      expect(() => checkProductionSettings({ ...loopbackProduction, WCR_TEST_FAULTS: ' ' })).not.toThrow();
      expect(() => checkProductionSettings(loopbackProduction)).not.toThrow();
    });
    // The E2E build: the same NODE_ENV, with WCR_E2E_BUILD=1 inlined.
    asBuild('e2e', () => {
      const env = { ...loopbackProduction, WCR_TEST_FAULTS: 'lineage-once' };
      expect(testFaultOf(cookie('lineage-once:abc-123'), env)).toEqual({ kind: 'lineage-once', token: 'abc-123' });
      expect(() => checkTestFaults(env)).not.toThrow();
    });
  });
});
