// The account e-mails (milestone M02, In scope 6): Better Auth creates the tokens and calls these
// functions; the e-mail goes through the outbox of M01b (src/server/jobs/outbox.ts) and the worker
// renders src/server/templates/email/*.tsx. The link points at our own pages, never at /api/auth
// directly: the page asks for a button press first, so a mail system that opens links to scan them
// cannot confirm an address or spend a reset token. The token travels sealed in the job
// (secretFields; src/server/mail/seal.ts), never in clear.
//
// An hourly budget per account and template (ACCOUNT_EMAIL_HOURLY_CAPS; fix round 2): the
// per-address limits of the endpoints can be dodged by changing the client address, these cannot.
// Each template has its own budget, so mail that anyone can trigger never uses up the mail that
// gets the owner in. Every template with a link has a budget of 3 and a link that stays valid at
// least as long as the hour the budget counts, so when the budget is spent the mailbox already
// holds a link that works, whoever asked for it. The account-exists notice has no link and a
// budget of 1: repeats inside the hour are not sent. An e-mail over the budget is dropped
// silently (the forms answer the same way, so nothing is revealed). The count and the queueing
// run in one transaction under an advisory lock per account and template, so parallel requests
// cannot pass the budget together.

import { createHash } from 'node:crypto';

import { generateRandomString } from 'better-auth/crypto';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { getDb } from '../db';
import { authAccount, person, personName } from '../db/schema';
import { getProducer } from '../jobs/boss';
import { queueEmail, type Transaction } from '../jobs/outbox';
import type { NameData } from '../templates/email';
import { appUrl } from './env';
import { logAuth } from './logger';

/** This process's job producer (pg-boss stays inside src/server/jobs). */
type Producer = Awaited<ReturnType<typeof getProducer>>;

export const VERIFY_EMAIL_EXPIRES_IN_S = 24 * 3600;
export const RESET_PASSWORD_EXPIRES_IN_S = 3600;
/** The e-mails of one template that one account gets in an hour, at most. */
export const ACCOUNT_EMAIL_HOURLY_CAPS = {
  'verify-email': 3,
  'reset-password': 3,
  'finish-sign-up': 3,
  'account-exists': 1,
} as const;
export type AccountEmailTemplate = keyof typeof ACCOUNT_EMAIL_HOURLY_CAPS;

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

/**
 * Runs `queue` inside a transaction when the account has budget left for `template` this hour,
 * and returns whether it ran. The advisory lock makes the count and the insert one step per
 * account and template. The job producer is started before the transaction, so the lock is only
 * ever held for a count and two inserts (the requests that wait for it share the 2 s statement
 * timeout of app_rw).
 */
export async function withinHourlyCap(
  userId: string,
  template: AccountEmailTemplate,
  queue: (tx: Transaction, boss: Producer) => Promise<unknown>,
): Promise<boolean> {
  const boss = await getProducer();
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`account-email:${userId}:${template}`}, 0))`);
    const rows = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM email_delivery
       WHERE user_id = ${userId} AND template = ${template} AND created_at > now() - interval '1 hour'`);
    if ((rows.rows[0]?.n ?? 0) >= ACCOUNT_EMAIL_HOURLY_CAPS[template]) {
      logAuth('warn', `account e-mail dropped: the hourly cap of the account for ${template} is reached`);
      return false;
    }
    await queue(tx, boss);
    return true;
  });
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
  const url = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  const names = await recipientNames(user.id);
  await withinHourlyCap(user.id, 'verify-email', (tx, boss) =>
    queueEmail(tx, {
      template: 'verify-email',
      to: user.email,
      userId: user.id,
      idempotencyKey: keyFor('verify-email', token),
      data: { url, expiresInHours: VERIFY_EMAIL_EXPIRES_IN_S / 3600, ...(names ? { recipientNames: names } : {}) },
    }, boss),
  );
}

export async function sendPasswordResetEmail(user: Recipient, token: string): Promise<void> {
  // A reset of an unconfirmed account without a password is how a duplicate sign-up finishes.
  const finish = user.emailVerified === false && !(await hasPassword(user.id));
  const url = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}${finish ? '&finish=1' : ''}`;
  const names = await recipientNames(user.id);
  const template = finish ? 'finish-sign-up' : 'reset-password';
  await withinHourlyCap(user.id, template, (tx, boss) =>
    queueEmail(tx, {
      template,
      to: user.email,
      userId: user.id,
      idempotencyKey: keyFor(template, token),
      data: { url, expiresInHours: RESET_PASSWORD_EXPIRES_IN_S / 3600, ...(names ? { recipientNames: names } : {}) },
    }, boss),
  );
}

/**
 * A password-reset token for `user` (Better Auth's own `reset-password:<token>` verification value,
 * so /reset-password accepts it) and the finish-sign-up e-mail with it. A token whose e-mail is
 * over the budget is deleted again. It is created before the budget's transaction, never inside
 * it: the adapter takes a connection of its own, and waiting for one while holding another could
 * exhaust the pool.
 */
export async function sendFinishSignUpEmail(user: Recipient): Promise<void> {
  // Imported here: config.ts imports this module.
  const { getAuth } = await import('./config');
  const context = await getAuth().$context;
  const token = generateRandomString(24, 'a-z', 'A-Z', '0-9');
  const identifier = `reset-password:${token}`;
  await context.internalAdapter.createVerificationValue({
    value: user.id,
    identifier,
    expiresAt: new Date(Date.now() + RESET_PASSWORD_EXPIRES_IN_S * 1000),
  });
  const url = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}&finish=1`;
  const queued = await withinHourlyCap(user.id, 'finish-sign-up', (tx, boss) =>
    queueEmail(tx, {
      template: 'finish-sign-up',
      to: user.email,
      userId: user.id,
      idempotencyKey: keyFor('finish-sign-up', token),
      data: { url, expiresInHours: RESET_PASSWORD_EXPIRES_IN_S / 3600 },
    }, boss),
  );
  if (!queued) await context.internalAdapter.deleteVerificationByIdentifier(identifier);
}

/** Tells the owner of a confirmed account that someone tried to sign up with the address (once an hour). */
export async function sendAccountExistsEmail(user: Recipient): Promise<void> {
  const origin = appUrl();
  const names = await recipientNames(user.id);
  await withinHourlyCap(user.id, 'account-exists', (tx, boss) =>
    queueEmail(tx, {
      template: 'account-exists',
      to: user.email,
      userId: user.id,
      // One per sign-up attempt that passes the budget: random, never derived from the address.
      idempotencyKey: keyFor('account-exists', generateRandomString(24, 'a-z', '0-9')),
      data: { signInUrl: `${origin}/sign-in`, resetUrl: `${origin}/reset-password`, ...(names ? { recipientNames: names } : {}) },
    }, boss),
  );
}
