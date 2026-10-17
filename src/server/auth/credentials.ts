// Credential helpers in Better Auth's own storage formats, for the seed (demo accounts) and the
// tests: a password hash (scrypt with a random salt) and the TOTP secret and backup codes,
// encrypted with BETTER_AUTH_SECRET exactly as the twoFactor plugin stores them.

import { generateRandomString, hashPassword, symmetricEncrypt } from 'better-auth/crypto';

export function hashAccountPassword(password: string): Promise<string> {
  return hashPassword(password);
}

/** auth_two_factor.secret: the secret that createOTP(secret) uses, encrypted. */
export function encryptTotpSecret(totpSecret: string, authSecret: string): Promise<string> {
  return symmetricEncrypt({ key: authSecret, data: totpSecret });
}

/** Ten backup codes in Better Auth's format (`abcde-12345`), and their encrypted column value. */
export async function generateBackupCodes(authSecret: string): Promise<{ codes: string[]; encrypted: string }> {
  const codes = Array.from({ length: 10 }, () => generateRandomString(10, 'a-z', '0-9', 'A-Z')).map(
    (code) => `${code.slice(0, 5)}-${code.slice(5)}`,
  );
  return { codes, encrypted: await symmetricEncrypt({ key: authSecret, data: JSON.stringify(codes) }) };
}
