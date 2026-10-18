// Counters and one-time markers of the accounts module (milestone M02 fix rounds 1 and 2), in
// auth_throttle, so they hold across restarts and for every path (web forms and /api/auth alike):
//
//   sign-in:<hmac of the address>   password attempts per e-mail address from browsers that do not
//                                   know it yet: 10 failures in a row lock the address for 15
//                                   minutes for those browsers, whatever the client address. Keyed
//                                   by the address, not the account, so an unknown address locks the
//                                   same way and the lock reveals nothing.
//   sign-in-device:<hmac>           the same for one known browser of the address (known-devices.ts):
//                                   its own 10 in a row. A stranger's failures never lock it, so a
//                                   stranger cannot keep the owner out.
//   totp:<hmac of user and code>    a TOTP code that has been accepted; refused again for 2 minutes
//                                   (the code itself is valid for up to 90 seconds).
//
// An attempt is reserved before the password is checked (reserve(): one atomic statement), so a
// burst of parallel requests gets no more checks than the limit. The after hook keeps the
// reservation of a wrong password, clears the key on a right one and gives any other outcome back
// (release()).
//
// Keys never hold an address or a code in clear: HMAC-SHA-256 with IP_HMAC_KEY. The retention job
// deletes expired rows (src/server/services/retention.ts).

import { createHmac } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { getDb } from '../db';
import { ipHmacKey } from './env';

export const SIGN_IN_FAILURE_LIMIT = 10;
export const SIGN_IN_LOCK_S = 15 * 60;
export const TOTP_REPLAY_WINDOW_S = 120;

/** HMAC-SHA-256 of `value` with IP_HMAC_KEY, cut to 48 hex digits: never an address or a code in clear. */
export function throttleDigest(value: string): string {
  return createHmac('sha256', ipHmacKey()).update(value).digest('hex').slice(0, 48);
}

export const normalizeAddress = (email: string) => email.trim().toLowerCase();
export const signInKey = (email: string) => `sign-in:${throttleDigest(`email:${normalizeAddress(email)}`)}`;
export const signInDeviceKey = (email: string, device: string) =>
  `sign-in-device:${throttleDigest(`email:${normalizeAddress(email)}:device:${device}`)}`;
export const totpKey = (userId: string, code: string) => `totp:${throttleDigest(`totp:${userId}:${code}`)}`;

/**
 * Reserves one attempt under `key`: true while fewer than `limit` attempts are counted in the
 * window, false once the key is locked. One statement, so parallel requests are counted one after
 * another (the row lock of ON CONFLICT DO UPDATE). A count starts a window of `windowS` seconds;
 * the attempt that reaches `limit` restarts it, so a lock lasts `windowS` from the attempt that
 * caused it. Refused attempts are not counted: waiting out the lock always works.
 */
export async function reserve(key: string, windowS: number, limit: number): Promise<boolean> {
  const rows = await getDb().execute<{ count: number }>(sql`
    INSERT INTO auth_throttle AS t (key, count, expires_at)
    VALUES (${key}, 1, now() + make_interval(secs => ${windowS}))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN t.expires_at <= now() THEN 1 ELSE t.count + 1 END,
      expires_at = CASE
        WHEN t.expires_at <= now() OR t.count + 1 >= ${limit} THEN now() + make_interval(secs => ${windowS})
        ELSE t.expires_at
      END
      WHERE t.expires_at <= now() OR t.count < ${limit}
    RETURNING count`);
  return rows.rows.length > 0;
}

/** Gives back an attempt reserved under `key` whose outcome was neither a right nor a wrong password. */
export async function release(key: string): Promise<void> {
  await getDb().execute(sql`
    UPDATE auth_throttle SET count = count - 1
     WHERE key = ${key} AND count > 0 AND expires_at > now()`);
}

/** The live count of `key` (0 when absent or expired). */
export async function countOf(key: string): Promise<number> {
  const rows = await getDb().execute<{ count: number }>(
    sql`SELECT count FROM auth_throttle WHERE key = ${key} AND expires_at > now()`,
  );
  return rows.rows[0]?.count ?? 0;
}

/** Forgets `key`. */
export async function clear(key: string): Promise<void> {
  await getDb().execute(sql`DELETE FROM auth_throttle WHERE key = ${key}`);
}

/** Claims `key` for `ttlS` seconds: true for the first claim, false while an earlier one lives. */
export async function claimOnce(key: string, ttlS: number): Promise<boolean> {
  const rows = await getDb().execute<{ key: string }>(sql`
    INSERT INTO auth_throttle AS t (key, count, expires_at)
    VALUES (${key}, 1, now() + make_interval(secs => ${ttlS}))
    ON CONFLICT (key) DO UPDATE SET count = 1, expires_at = excluded.expires_at
      WHERE t.expires_at <= now()
    RETURNING key`);
  return rows.rows.length > 0;
}
