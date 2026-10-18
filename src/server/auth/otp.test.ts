import { describe, expect, it } from 'vitest';

import { base32Decode, base32Encode, hotp, secretFromTotpUri, totp, totpUri } from './otp';

describe('otp', () => {
  it('encodes and decodes base32 (RFC 4648 test vectors, no padding)', () => {
    const vectors: Array<[string, string]> = [
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ];
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(Buffer.from(plain))).toBe(encoded);
      expect(Buffer.from(base32Decode(encoded.toLowerCase())).toString()).toBe(plain);
    }
    expect(() => base32Decode('MZ1')).toThrow('not base32');
  });

  it('computes RFC 6238 SHA-1 codes from the secret string bytes', () => {
    const secret = '12345678901234567890';
    // RFC 6238 appendix B (8 digits): 59 s -> 94287082, 1111111109 s -> 07081804.
    expect(hotp(secret, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(hotp(secret, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(totp(secret, 59_000)).toBe('287082');
  });

  it('builds the otpauth URI the plugin builds and reads the secret back', () => {
    const uri = totpUri('demoSecretValue0123456789abcdefgh', 'WingChunRoots', 'demo-student@example.test');
    expect(uri).toMatch(/^otpauth:\/\/totp\/WingChunRoots:demo-student%40example\.test\?secret=[A-Z2-7]+&issuer=WingChunRoots&digits=6&period=30$/);
    expect(secretFromTotpUri(uri)).toBe('demoSecretValue0123456789abcdefgh');
  });
});
