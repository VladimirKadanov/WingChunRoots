// TOTP in the exact format of Better Auth's twoFactor plugin (RFC 6238: HMAC-SHA-1, 30-second
// steps, 6 digits), for the pending setup on /account/security and for the tests. The plugin keys
// the HMAC with the UTF-8 bytes of the secret string it stores, and the otpauth:// URI carries
// those bytes in base32 (RFC 4648, no padding), which is what authenticator apps read.
//
// Only node:crypto: no second OTP library next to the one inside better-auth (milestone M02 fix
// round 1; the former devDependency @better-auth/utils is gone).

import { createHmac } from 'node:crypto';

export const TOTP_PERIOD_S = 30;
export const TOTP_DIGITS = 6;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** RFC 4648 base32, case-insensitive, padding and spaces ignored. Throws on other characters. */
export function base32Decode(text: string): Uint8Array {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** The HOTP code of `secret` (the stored string) for `counter`. */
export function hotp(secret: string, counter: number, digits: number = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', Buffer.from(secret, 'utf8')).update(message).digest();
  const offset = mac[mac.length - 1]! & 15;
  const code =
    (((mac[offset]! & 127) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!) % 10 ** digits;
  return code.toString().padStart(digits, '0');
}

/** The current TOTP code of `secret`. */
export function totp(secret: string, now: number = Date.now()): string {
  return hotp(secret, Math.floor(now / (TOTP_PERIOD_S * 1000)));
}

/** otpauth://totp/Issuer:account?secret=...&issuer=...&digits=6&period=30, as the plugin builds it. */
export function totpUri(secret: string, issuer: string, account: string): string {
  const params = new URLSearchParams({
    secret: base32Encode(Buffer.from(secret, 'utf8')),
    issuer,
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_S),
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${params.toString()}`;
}

/** The stored secret string behind an otpauth:// URI. */
export function secretFromTotpUri(uri: string): string {
  const encoded = new URL(uri).searchParams.get('secret');
  if (!encoded) throw new Error('the TOTP URI has no secret');
  return Buffer.from(base32Decode(encoded)).toString('utf8');
}
