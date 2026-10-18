// The account e-mails (milestone M02, In scope 6): Better Auth creates the tokens and calls these
// functions; the e-mail goes through the outbox of M01b (src/server/jobs/outbox.ts) and the worker
// renders src/server/templates/email/*.tsx. The link points at our own pages, never at /api/auth
// directly: the page asks for a button press first, so a mail system that opens links to scan them
// cannot confirm an address or spend a reset token. The token travels sealed in the job
// (secretFields; src/server/mail/seal.ts), never in clear.
//
// At most ACCOUNT_EMAIL_HOURLY_CAP account e-mails per account and hour: the per-address limits of
// the endpoints can be dodged by changing the client address, this cap cannot. An e-mail over the
// cap is dropped silently (the forms answer the same way, so nothing is revealed).

import { createHash } from 'node:crypto';

import { generateRandomString } from 'better-auth/crypto';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { getDb } from '../db';
import { authAccount, person, personName } from '../db/schema';
import { queueEmail } from '../jobs/outbox';
import type { NameData } from '../templates/email';
import { appUrl } from './env';
import { logAuth } from './logger';

export const VERIFY_EMAIL_EXPIRES_IN_S = 24 * 3600;
export const RESET_PASSWORD_EXPIRES_IN_S = 3600;
export const ACCOUNT_EMAIL_HOURLY_CAP = 5;
/** The templates that count toward the cap. */
export const ACCOUNT_EMAIL_TEMPLATES = ['verify-email', 'reset-password', 'finish-sign-up', 'account-exists'] as const;

interface Recipient {
  id: string;
  email: string;
  emailVerified?: boolean;
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

/** False when the account already had ACCOUNT_EMAIL_HOURLY_CAP account e-mails in the last hour. */
export async function underHourlyCap(userId: string): Promise<boolean> {
  const templates = sql.join(
    ACCOUNT_EMAIL_TEMPLATES.map((template) => sql`${template}`),
    sql`, `,
  );
  const rows = await getDb().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM email_delivery
     WHERE user_id = ${userId} AND template IN (${templates}) AND created_at > now() - interval '1 hour'`);
  const under = (rows.rows[0]?.n ?? 0) < ACCOUNT_EMAIL_HOURLY_CAP;
  if (!under) logAuth('warn', 'account e-mail dropped: the hourly cap of the account is reached');
  return under;
}

/** Whether the account has a password (a duplicate sign-up wipes it; accounts.ts). */
export async function hasPassword(userId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: authAccount.id })
    .from(authAccount)
    .where(and(eq(authAccount.userId, userId), eq(authAccount.providerId, 'credential'), isNotNull(authAccount.password)));
  return row !== undefined;
}

export async function sendVerificationEmail(user: Recipient, token: string): Promise<void> {
  // An unconfirmed account without a password (its password was wiped by a later sign-up) is
  // finished by choosing a password, never by confirming the address alone.
  if (!(await hasPassword(user.id))) return sendFinishSignUpEmail(user);
  if (!(await underHourlyCap(user.id))) return;
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
  // A reset of an unconfirmed account without a password is how a duplicate sign-up finishes.
  const finish = user.emailVerified === false && !(await hasPassword(user.id));
  if (!(await underHourlyCap(user.id))) return;
  const url = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}${finish ? '&finish=1' : ''}`;
  const names = await recipientNames(user.id);
  const template = finish ? 'finish-sign-up' : 'reset-password';
  await getDb().transaction((tx) =>
    queueEmail(tx, {
      template,
      to: user.email,
      userId: user.id,
      idempotencyKey: keyFor(template, token),
      data: { url, expiresInHours: RESET_PASSWORD_EXPIRES_IN_S / 3600, ...(names ? { recipientNames: names } : {}) },
    }),
  );
}

/**
 * A password-reset token for `user` (Better Auth's own `reset-password:<token>` verification value,
 * so /reset-password accepts it) and the finish-sign-up e-mail with it.
 */
export async function sendFinishSignUpEmail(user: Recipient): Promise<void> {
  if (!(await underHourlyCap(user.id))) return;
  // Imported here: config.ts imports this module.
  const { getAuth } = await import('./config');
  const context = await getAuth().$context;
  const token = generateRandomString(24, 'a-z', 'A-Z', '0-9');
  await context.internalAdapter.createVerificationValue({
    value: user.id,
    identifier: `reset-password:${token}`,
    expiresAt: new Date(Date.now() + RESET_PASSWORD_EXPIRES_IN_S * 1000),
  });
  const url = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}&finish=1`;
  await getDb().transaction((tx) =>
    queueEmail(tx, {
      template: 'finish-sign-up',
      to: user.email,
      userId: user.id,
      idempotencyKey: keyFor('finish-sign-up', token),
      data: { url, expiresInHours: RESET_PASSWORD_EXPIRES_IN_S / 3600 },
    }),
  );
}

/** Tells the owner of a confirmed account that someone tried to sign up with the address. */
export async function sendAccountExistsEmail(user: Recipient): Promise<void> {
  if (!(await underHourlyCap(user.id))) return;
  const origin = appUrl();
  const names = await recipientNames(user.id);
  await getDb().transaction((tx) =>
    queueEmail(tx, {
      template: 'account-exists',
      to: user.email,
      userId: user.id,
      // One per sign-up attempt: random, never derived from the address.
      idempotencyKey: keyFor('account-exists', generateRandomString(24, 'a-z', '0-9')),
      data: { signInUrl: `${origin}/sign-in`, resetUrl: `${origin}/reset-password`, ...(names ? { recipientNames: names } : {}) },
    }),
  );
}
