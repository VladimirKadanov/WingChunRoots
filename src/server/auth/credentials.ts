// Credential helpers in Better Auth's own storage formats, for the seed (demo accounts), the
// twoFactor plugin (backup codes) and the tests: a password hash (scrypt with a random salt), the
// TOTP secret and backup codes, encrypted with BETTER_AUTH_SECRET exactly as the twoFactor plugin
// stores them, and the signed value of a session cookie (the bearer token) for a session row a
// test creates itself.

import { randomInt } from 'node:crypto';

import { hashPassword, makeSignature, symmetricEncrypt } from 'better-auth/crypto';

export function hashAccountPassword(password: string): Promise<string> {
  return hashPassword(password);
}

/** auth_two_factor.secret: the secret that createOTP(secret) uses, encrypted. */
export function encryptTotpSecret(totpSecret: string, authSecret: string): Promise<string> {
  return symmetricEncrypt({ key: authSecret, data: totpSecret });
}

/**
 * Backup codes: ten codes of eight characters from Crockford's base32 alphabet (no I, L, O or U, so
 * no 0/O or 1/l confusion), upper case, as XXXX-XXXX. 40 random bits each; every code works once,
 * and the sign-in attempts are limited (5 per challenge, 10 per account; docs/adr/0004-auth.md).
 */
export const BACKUP_CODE_COUNT = 10;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const chars = Array.from({ length: 8 }, () => CROCKFORD[randomInt(32)]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}

/**
 * A typed backup code in the stored form: upper case, spaces and dashes ignored, O read as 0 and
 * I or L as 1 (Crockford). Anything that is not eight such characters is returned trimmed, and fails.
 */
export function normalizeBackupCode(input: string): string {
  const compact = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4)}` : input.trim();
}

/** Backup codes (newBackupCodes) and their encrypted column value, as the twoFactor plugin stores them. */
export async function generateBackupCodes(authSecret: string): Promise<{ codes: string[]; encrypted: string }> {
  const codes = newBackupCodes();
  return { codes, encrypted: await symmetricEncrypt({ key: authSecret, data: JSON.stringify(codes) }) };
}

/** The session cookie value and bearer token of a session `token`: `token.signature`. */
export async function signedSessionToken(token: string, authSecret: string): Promise<string> {
  return `${token}.${await makeSignature(token, authSecret)}`;
}
