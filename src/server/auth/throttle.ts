// Counters and one-time markers of the accounts module (milestone M02 fix round 1), in
// auth_throttle, so they hold across restarts and for every path (web forms and /api/auth alike):
//
//   sign-in:<hmac of the address>   failed password sign-ins per e-mail address: 10 in a row lock
//                                   the address for 15 minutes, whatever the client address. Keyed by
//                                   the address, not the account, so an unknown address locks the
//                                   same way and the lock reveals nothing.
//   totp:<hmac of user and code>    a TOTP code that has been accepted; refused again for 2 minutes
//                                   (the code itself is valid for up to 90 seconds).
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

function digest(value: string): string {
  return createHmac('sha256', ipHmacKey()).update(value).digest('hex').slice(0, 48);
}

export const signInKey = (email: string) => `sign-in:${digest(`email:${email.trim().toLowerCase()}`)}`;
export const totpKey = (userId: string, code: string) => `totp:${digest(`totp:${userId}:${code}`)}`;

/** The live count of `key` (0 when absent or expired). */
export async function countOf(key: string): Promise<number> {
  const rows = await getDb().execute<{ count: number }>(
    sql`SELECT count FROM auth_throttle WHERE key = ${key} AND expires_at > now()`,
  );
  return rows.rows[0]?.count ?? 0;
}

/**
 * Adds one to `key` and returns the new count. A count starts a window of `windowS` seconds; the
 * hit that reaches `limit` restarts the window, so a lock lasts `windowS` from the last failure
 * that caused it.
 */
export async function hit(key: string, windowS: number, limit: number): Promise<number> {
  const rows = await getDb().execute<{ count: number }>(sql`
    INSERT INTO auth_throttle AS t (key, count, expires_at)
    VALUES (${key}, 1, now() + make_interval(secs => ${windowS}))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN t.expires_at <= now() THEN 1 ELSE t.count + 1 END,
      expires_at = CASE
        WHEN t.expires_at <= now() OR t.count + 1 >= ${limit} THEN now() + make_interval(secs => ${windowS})
        ELSE t.expires_at
      END
    RETURNING count`);
  return rows.rows[0]?.count ?? 1;
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
