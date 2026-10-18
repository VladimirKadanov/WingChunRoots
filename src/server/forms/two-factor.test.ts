import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { openBackupCodes, openPendingSetup, sealBackupCodes, sealPendingSetup } from './two-factor';

const CODES = ['7KQ2-M9XA', 'P4ZT-0VNH'];
const URI = 'otpauth://totp/WingChunRoots:demo%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=WingChunRoots';

beforeAll(() => {
  vi.stubEnv('BETTER_AUTH_SECRET', 'codes-test-secret-0000000000000000000');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe('the sealed backup codes', () => {
  it('opens for the account it was sealed for, while fresh', () => {
    const now = Date.now();
    const raw = sealBackupCodes('user-a', CODES, now);
    expect(raw).not.toContain('7KQ2');
    expect(openBackupCodes(raw, 'user-a', now + 60_000)).toEqual(CODES);
  });

  it('does not open for another account, after 30 minutes, or when changed', () => {
    const now = Date.now();
    const raw = sealBackupCodes('user-a', CODES, now);
    expect(openBackupCodes(raw, 'user-b', now)).toBeNull();
    expect(openBackupCodes(raw, 'user-a', now + 31 * 60_000)).toBeNull();
    // One character of the ciphertext changed: the first after the last separator carries 6 bits of
    // data (unlike the final one, which can end in unused bits), so the bytes always change.
    const at = raw.lastIndexOf('.') + 1;
    expect(openBackupCodes(`${raw.slice(0, at)}${raw[at] === 'A' ? 'B' : 'A'}${raw.slice(at + 1)}`, 'user-a', now)).toBeNull();
    expect(openBackupCodes(undefined, 'user-a', now)).toBeNull();
  });
});

describe('the sealed pending setup', () => {
  it('keeps only the secret, sealed, for the account and 30 minutes', () => {
    const now = Date.now();
    const raw = sealPendingSetup('user-a', URI, now);
    expect(raw).not.toContain('JBSWY3DP');
    expect(openPendingSetup(raw, 'user-a', now + 29 * 60_000)).toBe('JBSWY3DPEHPK3PXP');
    expect(openPendingSetup(raw, 'user-b', now)).toBeNull();
    expect(openPendingSetup(raw, 'user-a', now + 31 * 60_000)).toBeNull();
  });

  it('a value sealed for one purpose does not open as the other', () => {
    const now = Date.now();
    expect(openBackupCodes(sealPendingSetup('user-a', URI, now), 'user-a', now)).toBeNull();
    expect(openPendingSetup(sealBackupCodes('user-a', CODES, now), 'user-a', now)).toBeNull();
  });
});
