// The test fault switch (milestone M04, In scope 6): honoured only behind a loopback APP_URL,
// refused at startup anywhere else, and each token fails exactly once.

import { describe, expect, it } from 'vitest';

import { checkProductionSettings, startOrExit } from './auth/startup';
import { checkTestFaults, failOnce, testFaultsEnabled, testFaultToken } from './faults';

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

const cookie = (value: string) => new Headers({ cookie: `theme=dark; wcr-test-fault=${value}` });

describe('WCR_TEST_FAULTS', () => {
  it('is honoured only with a loopback APP_URL', () => {
    expect(testFaultsEnabled({ ...loopbackProduction, WCR_TEST_FAULTS: 'lineage-once' })).toBe(true);
    expect(testFaultsEnabled({ WCR_TEST_FAULTS: 'lineage-once' })).toBe(true); // next dev: localhost
    expect(testFaultsEnabled({ ...publicProduction, WCR_TEST_FAULTS: 'lineage-once' })).toBe(false);
    expect(testFaultsEnabled({ NODE_ENV: 'development', APP_URL: 'https://staging.example', WCR_TEST_FAULTS: 'lineage-once' })).toBe(false);
    expect(testFaultsEnabled(loopbackProduction)).toBe(false);
  });

  it('startup refuses it behind a public APP_URL, in production and outside it, and refuses unknown faults', () => {
    expect(() => checkProductionSettings({ ...publicProduction, WCR_TEST_FAULTS: 'lineage-once' })).toThrow(/WCR_TEST_FAULTS/);
    expect(() => checkTestFaults({ NODE_ENV: 'development', APP_URL: 'https://staging.example', WCR_TEST_FAULTS: 'lineage-once' })).toThrow(
      /loopback/,
    );
    expect(() => checkTestFaults({ WCR_TEST_FAULTS: 'everything' })).toThrow(/unknown fault/);
    // An APP_URL that fails its own check (http behind a public host, or none in production) still
    // gets a refusal that names the switch.
    expect(() => checkTestFaults({ ...publicProduction, APP_URL: 'http://wingchunroots.example', WCR_TEST_FAULTS: 'lineage-once' })).toThrow(
      /WCR_TEST_FAULTS is a test switch/,
    );
    expect(() => checkTestFaults({ NODE_ENV: 'production', WCR_TEST_FAULTS: 'lineage-once' })).toThrow(/WCR_TEST_FAULTS is a test switch/);
    expect(() => checkProductionSettings({ ...loopbackProduction, WCR_TEST_FAULTS: 'lineage-once' })).not.toThrow();
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

  it('reads the token from the cookie only when the switch is on', () => {
    const on = { WCR_TEST_FAULTS: 'lineage-once', APP_URL: 'http://localhost:3140' };
    expect(testFaultToken(cookie('lineage-once:abc-123'), on)).toBe('abc-123');
    expect(testFaultToken(cookie('lineage-once:abc-123'), { APP_URL: 'http://localhost:3140' })).toBeNull();
    expect(testFaultToken(cookie('lineage-once:abc-123'), { ...publicProduction, WCR_TEST_FAULTS: 'lineage-once' })).toBeNull();
    expect(testFaultToken(cookie('other:abc'), on)).toBeNull();
    expect(testFaultToken(new Headers(), on)).toBeNull();
  });

  it('fails the first call with a token and never again', () => {
    const token = `unit-${Math.random().toString(36).slice(2)}`;
    expect(() => failOnce(token)).toThrow(/Test fault/);
    expect(() => failOnce(token)).not.toThrow();
    expect(() => failOnce(null)).not.toThrow();
    expect(() => failOnce(undefined)).not.toThrow();
  });
});
