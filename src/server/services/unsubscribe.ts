// Unsubscribe links (milestone M18, In scope 4; docs/adr/0021-notices.md): every e-mail whose
// category can be switched off carries a link that switches that category off with one press,
// without signing in, and the List-Unsubscribe and List-Unsubscribe-Post headers (RFC 8058).
//
// The token is `v1.<user id>.<category>.<version>.<HMAC>`: an HMAC-SHA256 over the account, the
// category and the version of the account's preference for it (notification_preference.version; 0
// without a row), with a key derived from MAIL_SEAL_KEY for this purpose only. It is valid until the
// preference changes: switching the category off or on again moves the version, and every earlier
// link stops working. Nothing in the token is secret but the HMAC; it names no address. The code
// never logs it, and the logger replaces any field whose key names a token (src/server/log/redact.ts).

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { mailSealKey } from '../mail/seal';
import { isNotificationCategory, type NotificationCategory } from '../templates/catalog';

const VERSION = 'v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The longest token the pages and the API accept (a UUID, a category, a version and the HMAC). */
export const UNSUBSCRIBE_TOKEN_MAX = 200;

export interface UnsubscribeClaim {
  userId: string;
  category: NotificationCategory;
  /** The preference version the link was made for. */
  version: number;
}

function keyBytes(key: string): Buffer {
  return createHash('sha256').update(`wcr-unsubscribe:${key}`).digest();
}

function mac(claim: UnsubscribeClaim, key: string): string {
  return createHmac('sha256', keyBytes(key)).update(`${VERSION}:${claim.userId}:${claim.category}:${claim.version}`).digest('base64url');
}

/** The token of an unsubscribe link. */
export function signUnsubscribeToken(claim: UnsubscribeClaim, key: string = mailSealKey()): string {
  if (!UUID.test(claim.userId) || !isNotificationCategory(claim.category) || !Number.isInteger(claim.version) || claim.version < 0) {
    throw new Error('unsubscribe token: a user id, a category and a version are needed');
  }
  return `${VERSION}.${claim.userId}.${claim.category}.${claim.version}.${mac(claim, key)}`;
}

/** What a token claims, when its HMAC is right; null for anything else (no reason given). */
export function readUnsubscribeToken(token: unknown, key: string = mailSealKey()): UnsubscribeClaim | null {
  if (typeof token !== 'string' || token.length > UNSUBSCRIBE_TOKEN_MAX) return null;
  const parts = token.split('.');
  if (parts.length !== 5) return null;
  const [version, userId, category, versionText, signature] = parts as [string, string, string, string, string];
  if (version !== VERSION || !UUID.test(userId) || !isNotificationCategory(category) || !/^\d{1,9}$/.test(versionText)) return null;
  const claim = { userId, category, version: Number(versionText) };
  const expected = Buffer.from(mac(claim, key));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return claim;
}
