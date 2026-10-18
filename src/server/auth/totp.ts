// The two-factor record of an account (milestone M02; fix round 1, findings H3 and H4): whether a
// setup waits for its first code, the setup's otpauth:// URI and the backup codes left.
//
// Better Auth keeps the TOTP secret and the backup codes encrypted in auth_two_factor
// (symmetricEncrypt with the auth secret). /two-factor/enable writes the row with verified = false
// and the first valid code sets it to true. account.twoFactor reads the state and the number of
// codes; the security page renders a pending key only for the browser that started the setup
// (src/server/forms/two-factor.ts). Nothing read here is logged.

import { symmetricDecrypt } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { encode } from 'uqr';

import type { QrModules } from '../../lib/qr';
import { getDb } from '../db';
import { authTwoFactor } from '../db/schema';
import { getAuth, TOTP_ISSUER } from './config';
import { totpUri } from './otp';

export function qrModules(value: string): QrModules {
  const { data, size } = encode(value, { ecc: 'M', border: 2 });
  let path = '';
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return { path, size };
}

/** The base32 key of an otpauth:// URI in groups of four, as authenticator apps accept it typed in. */
export function groupedKey(uri: string): string {
  const secret = new URL(uri).searchParams.get('secret') ?? '';
  return secret.replace(/=+$/, '').match(/.{1,4}/g)?.join(' ') ?? '';
}

export interface TwoFactorRecord {
  /** False while the setup waits for its first code. */
  verified: boolean;
  /** otpauth://totp/WingChunRoots:<email>?secret=… */
  uri: string;
  backupCodes: string[];
  updatedAt: Date;
}

async function decrypt(data: string): Promise<string> {
  const { secretConfig } = await getAuth().$context;
  return symmetricDecrypt({ key: secretConfig, data });
}

/** The account's two-factor record, decrypted, or null without one. */
export async function readTwoFactor(userId: string, email: string): Promise<TwoFactorRecord | null> {
  const [row] = await getDb()
    .select({
      secret: authTwoFactor.secret,
      backupCodes: authTwoFactor.backupCodes,
      verified: authTwoFactor.verified,
      updatedAt: authTwoFactor.updatedAt,
    })
    .from(authTwoFactor)
    .where(eq(authTwoFactor.userId, userId));
  if (!row) return null;
  const secret = await decrypt(row.secret);
  let backupCodes: string[] = [];
  try {
    const parsed: unknown = JSON.parse(await decrypt(row.backupCodes));
    if (Array.isArray(parsed)) backupCodes = parsed.filter((code): code is string => typeof code === 'string');
  } catch {
    backupCodes = [];
  }
  return { verified: row.verified, uri: totpUri(secret, TOTP_ISSUER, email), backupCodes, updatedAt: row.updatedAt };
}
