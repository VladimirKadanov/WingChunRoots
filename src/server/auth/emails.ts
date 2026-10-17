// The account e-mails (milestone M02, In scope 6): Better Auth creates the tokens and calls these
// functions; the e-mail goes through the outbox of M01b (src/server/jobs/outbox.ts) and the worker
// renders src/server/templates/email/{verify-email,reset-password}.tsx. The link points at our own
// pages, never at /api/auth directly: the page asks for a button press first, so a mail system
// that opens links to scan them cannot confirm an address or spend a reset token.

import { createHash } from 'node:crypto';

import { and, eq, isNotNull } from 'drizzle-orm';

import { getDb } from '../db';
import { person, personName } from '../db/schema';
import { queueEmail } from '../jobs/outbox';
import type { NameData } from '../templates/email';
import { appUrl } from './env';

export const VERIFY_EMAIL_EXPIRES_IN_S = 24 * 3600;
export const RESET_PASSWORD_EXPIRES_IN_S = 3600;

interface Recipient {
  id: string;
  email: string;
}

/** The idempotency key of an account e-mail: the kind and a hash of its token (never the token). */
function keyFor(kind: string, token: string): string {
  return `auth.${kind}:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
}

/** The names of the account's own profile, primary (Latin) first, for the greeting. */
async function recipientNames(userId: string): Promise<NameData[] | undefined> {
  const rows = await getDb()
    .select({ value: personName.value, lang: personName.lang, isPrimary: personName.isPrimary, sortOrder: personName.sortOrder })
    .from(personName)
    .innerJoin(person, eq(person.id, personName.personId))
    .where(and(eq(person.claimedByUserId, userId), isNotNull(person.claimedByUserId), eq(personName.kind, 'name')));
  const sorted = rows.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder);
  if (!sorted[0]?.isPrimary) return undefined;
  return sorted.slice(0, 2).map(({ value, lang }) => ({ value, lang }));
}

export async function sendVerificationEmail(user: Recipient, token: string): Promise<void> {
  const url = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  const names = await recipientNames(user.id);
  await getDb().transaction((tx) =>
    queueEmail(tx, {
      template: 'verify-email',
      to: user.email,
      userId: user.id,
      idempotencyKey: keyFor('verify-email', token),
      data: { url, expiresInHours: VERIFY_EMAIL_EXPIRES_IN_S / 3600, ...(names ? { recipientNames: names } : {}) },
    }),
  );
}

export async function sendPasswordResetEmail(user: Recipient, token: string): Promise<void> {
  const url = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const names = await recipientNames(user.id);
  await getDb().transaction((tx) =>
    queueEmail(tx, {
      template: 'reset-password',
      to: user.email,
      userId: user.id,
      idempotencyKey: keyFor('reset-password', token),
      data: { url, expiresInHours: RESET_PASSWORD_EXPIRES_IN_S / 3600, ...(names ? { recipientNames: names } : {}) },
    }),
  );
}
