import { describe, expect, it } from 'vitest';

import { mailSealKey, seal, SealError, unseal } from './seal';

const KEY = 'demo-mail-seal-key-for-unit-tests-0000';
const DELIVERY = '0192a6f0-0000-7000-8000-000000000001';

describe('seal', () => {
  it('round-trips the fields of one delivery and never shows them in clear', () => {
    const sealed = seal({ url: 'http://localhost:3000/verify-email?token=demo-token' }, DELIVERY, KEY);
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain('demo-token');
    expect(unseal(sealed, DELIVERY, KEY)).toEqual({ url: 'http://localhost:3000/verify-email?token=demo-token' });
  });

  it('refuses another delivery, another key and changed bytes', () => {
    const sealed = seal({ url: 'x' }, DELIVERY, KEY);
    expect(() => unseal(sealed, '0192a6f0-0000-7000-8000-000000000002', KEY)).toThrow(SealError);
    expect(() => unseal(sealed, DELIVERY, `${KEY}-other`)).toThrow(SealError);
    // The first character of the ciphertext carries 6 bits of data (unlike the final one, which can
    // end in unused bits), so changing it always changes the bytes the tag authenticates.
    const at = sealed.lastIndexOf('.') + 1;
    const tampered = `${sealed.slice(0, at)}${sealed[at] === 'A' ? 'B' : 'A'}${sealed.slice(at + 1)}`;
    expect(() => unseal(tampered, DELIVERY, KEY)).toThrow(SealError);
    expect(() => unseal('v0.a.b', DELIVERY, KEY)).toThrow(SealError);
  });

  it('needs MAIL_SEAL_KEY of at least 32 characters', () => {
    expect(() => mailSealKey({})).toThrow('MAIL_SEAL_KEY is not set');
    expect(() => mailSealKey({ MAIL_SEAL_KEY: 'short' })).toThrow('at least 32');
    expect(mailSealKey({ MAIL_SEAL_KEY: KEY })).toBe(KEY);
  });
});
