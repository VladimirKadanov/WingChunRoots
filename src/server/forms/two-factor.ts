// What the security page shows only to the browser that asked for it (milestone M02 fix round 1,
// findings H3 and H4): the key of a two-factor setup that waits for its first code, and new backup
// codes.
//
// Better Auth returns both once, to the request that made them: the setup's otpauth:// URI from
// /two-factor/enable and the backup codes from /two-factor/enable and
// /two-factor/generate-backup-codes, each of which takes the password. The Server Action that made
// the call keeps them here: sealed (AES-256-GCM, a key derived from the auth secret, bound to the
// account id and the purpose) in an httpOnly cookie that only /account/security receives, for
// 30 minutes. So the page works without JavaScript and after a reload (a phone that switched to
// the authenticator app and back), while a stolen session alone, without the password, can read
// neither: they are never returned by an API read, stored in clear or logged. The pending key is
// shown only while it is still the account's pending key (another setup started since makes it
// stale).
//
// Only Server Actions and pages import this file (it reads next/headers).

import { cookies } from 'next/headers';

import { appUrl, authSecret } from '../auth/env';
import { groupedKey, readTwoFactor } from '../auth/totp';
import { seal, unseal } from '../mail/seal';

/** Long enough to add the key to an app, enter a code and save the codes. */
const KEEP_FOR_S = 30 * 60;
const PATH = '/account/security';

export const BACKUP_CODES_COOKIE = 'wcr.codes';
export const PENDING_SETUP_COOKIE = 'wcr.totp-setup';

type Purpose = 'backup-codes' | 'totp-setup';

function sealFor(purpose: Purpose, userId: string, value: unknown, now: number): string {
  return seal({ value, issuedAt: now }, `${purpose}:${userId}`, `${purpose}:${authSecret()}`);
}

function openFor(purpose: Purpose, raw: string | undefined, userId: string, now: number): unknown {
  if (!raw) return null;
  try {
    const { value, issuedAt } = unseal(raw, `${purpose}:${userId}`, `${purpose}:${authSecret()}`) as { value?: unknown; issuedAt?: unknown };
    if (typeof issuedAt !== 'number' || now - issuedAt > KEEP_FOR_S * 1000 || now < issuedAt) return null;
    return value ?? null;
  } catch {
    return null;
  }
}

async function keep(name: string, value: string): Promise<void> {
  (await cookies()).set(name, value, { httpOnly: true, sameSite: 'lax', path: PATH, maxAge: KEEP_FOR_S, secure: appUrl().startsWith('https:') });
}

// --- Backup codes ---------------------------------------------------------------------------------

/** Seals `codes` for `userId` (exported for the unit tests). */
export function sealBackupCodes(userId: string, codes: readonly string[], now = Date.now()): string {
  return sealFor('backup-codes', userId, [...codes], now);
}

/** Opens sealBackupCodes() for `userId`: the codes while they are fresh, else null. */
export function openBackupCodes(raw: string | undefined, userId: string, now = Date.now()): string[] | null {
  const codes = openFor('backup-codes', raw, userId, now);
  return Array.isArray(codes) && codes.every((code) => typeof code === 'string') ? (codes as string[]) : null;
}

/** Keeps the codes Better Auth has just returned for the page. */
export async function keepBackupCodes(userId: string, codes: readonly string[]): Promise<void> {
  await keep(BACKUP_CODES_COOKIE, sealBackupCodes(userId, codes));
}

/** The codes kept for `userId` in this browser, while fresh; else null. */
export async function readBackupCodes(userId: string): Promise<string[] | null> {
  return openBackupCodes((await cookies()).get(BACKUP_CODES_COOKIE)?.value, userId);
}

// --- The pending setup ----------------------------------------------------------------------------

const secretOf = (uri: string): string | null => {
  try {
    return new URL(uri).searchParams.get('secret');
  } catch {
    return null;
  }
};

/** Seals the secret of the setup URI `uri` for `userId` (exported for the unit tests). */
export function sealPendingSetup(userId: string, uri: string, now = Date.now()): string {
  return sealFor('totp-setup', userId, secretOf(uri), now);
}

/** Opens sealPendingSetup() for `userId`: the secret while it is fresh, else null. */
export function openPendingSetup(raw: string | undefined, userId: string, now = Date.now()): string | null {
  const secret = openFor('totp-setup', raw, userId, now);
  return typeof secret === 'string' && secret ? secret : null;
}

/** Keeps the setup Better Auth has just started for the page. */
export async function keepPendingSetup(userId: string, uri: string): Promise<void> {
  await keep(PENDING_SETUP_COOKIE, sealPendingSetup(userId, uri));
}

export interface PendingSetup {
  /** otpauth://totp/WingChunRoots:<email>?secret=… */
  uri: string;
  /** The secret in groups of four, as an app takes it typed in. */
  key: string;
}

/**
 * The setup this browser started for `userId`, while fresh and while it is still the account's
 * pending setup (not confirmed, not replaced by a newer one); else null.
 */
export async function readPendingSetup(userId: string, email: string): Promise<PendingSetup | null> {
  const secret = openPendingSetup((await cookies()).get(PENDING_SETUP_COOKIE)?.value, userId);
  if (!secret) return null;
  const record = await readTwoFactor(userId, email);
  if (!record || record.verified || secretOf(record.uri) !== secret) return null;
  return { uri: record.uri, key: groupedKey(record.uri) };
}
