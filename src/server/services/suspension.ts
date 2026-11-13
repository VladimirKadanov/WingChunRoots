// Account suspension (review 2026-11; docs/adr/0030-takedown-suspension-erasure.md): an
// administrator whose session proved the second factor suspends an account with a reason, and
// lifts it. Until now nothing wrote auth_user.banned: "block the account" in docs/operations/
// incident.md had no action behind it.
//
// What a suspension does:
//   - sets auth_user.banned, ban_reason and the optional ban_expires, and deletes every session of
//     the account in the same transaction (the trigger auth_user_end_sessions_on_ban does it for a
//     ban set any other way);
//   - from then on the account has no principal on any path, whatever cookie or bearer token it
//     still holds (auth/session.ts), Better Auth's own endpoints refuse it (auth/hooks.ts), and it
//     cannot sign in again (the admin plugin's BANNED_USER);
//   - the account gets no notice and no e-mail (notify.ts, auth/emails.ts): a suspension is not
//     announced to the person, the administrator tells them by other means if at all.
// DEFAULT review-2026-11: the suspended person's profile stays as it is; staff take a profile down
// separately (takedown.ts), so a suspension is not also a deletion or a hiding.
//
// Nobody suspends their own account, and nobody suspends the last active administrator. The checks
// run under one lock, so two administrators cannot suspend each other at the same moment.
//
// Audit rows (account.suspend, account.unsuspend) carry the account id, the end date and the
// number of sessions ended; never an e-mail address. The reason is the administrator's own words.

import { and, eq, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireStaff2FA } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { accountSuspended, isErasedEmail } from '../auth/suspension';
import { getDb } from '../db';
import { authSession, authUser, authVerification } from '../db/schema';
import type { Transaction } from '../jobs/outbox';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';

export const SUSPENSION_REASON_MAX = 500;
/** The one lock of every change to who may sign in: two administrators never suspend each other. */
const SUSPENSION_LOCK = 'account.suspension';

const reasonText = (message: string) =>
  z
    .string({ error: message })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .pipe(z.string().min(1, { error: message }).max(SUSPENSION_REASON_MAX, { error: `Use at most ${SUSPENSION_REASON_MAX} characters.` }));

const EMAIL_MESSAGE = 'Enter the e-mail address of the account.';
const NO_ACCOUNT = 'Choose an account by its e-mail address.';

/** The account the call is about: its id or its e-mail address, one of them. */
const accountRef = {
  userId: z.uuid({ error: NO_ACCOUNT }).nullish().transform((v) => v ?? null),
  email: z
    .string({ error: EMAIL_MESSAGE })
    .trim()
    .toLowerCase()
    .max(320, { error: EMAIL_MESSAGE })
    .nullish()
    .transform((v) => (v ? v : null)),
};

export const suspendInput = z
  .object({
    ...accountRef,
    reason: reasonText('Write the reason for the suspension.'),
    /** The day the suspension ends, or none for until an administrator lifts it. */
    until: z.iso.datetime({ offset: true, error: 'Enter the end of the suspension as a date and time.' }).nullish(),
  })
  .superRefine((input, ctx) => {
    if ((input.userId === null) === (input.email === null)) ctx.addIssue({ code: 'custom', path: ['email'], message: EMAIL_MESSAGE });
    if (input.until && new Date(input.until).getTime() <= Date.now()) ctx.addIssue({ code: 'custom', path: ['until'], message: 'The end of the suspension must be in the future.' });
  });
export type SuspendInput = z.input<typeof suspendInput>;

export const unsuspendInput = z
  .object({ ...accountRef, reason: reasonText('Write why the suspension is lifted.') })
  .superRefine((input, ctx) => {
    if ((input.userId === null) === (input.email === null)) ctx.addIssue({ code: 'custom', path: ['email'], message: EMAIL_MESSAGE });
  });
export type UnsuspendInput = z.input<typeof unsuspendInput>;

export interface SuspensionResult {
  userId: string;
  suspended: boolean;
  /** When the suspension ends by itself, or null for until an administrator lifts it. */
  until: string | null;
  /** The sessions ended by this call (0 when lifting). */
  sessionsEnded: number;
}

export interface SuspendedAccount {
  id: string;
  email: string;
  reason: string | null;
  /** When the suspension ends by itself, or null. */
  until: string | null;
  /** When it was set (the account's last change). */
  since: string;
}

function parseOrThrow<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? 'form')] ??= issue.message;
  throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
}

interface Target {
  id: string;
  email: string;
  role: string;
  banned: boolean;
  banExpires: Date | null;
}

/** Takes the one lock of this file, then the account's row; throws NOT_FOUND for no such account. */
async function lockTarget(tx: Transaction, ref: { userId: string | null; email: string | null }): Promise<Target> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${SUSPENSION_LOCK}))`);
  const [target] = await tx
    .select({ id: authUser.id, email: authUser.email, role: authUser.role, banned: authUser.banned, banExpires: authUser.banExpires })
    .from(authUser)
    .where(ref.userId ? eq(authUser.id, ref.userId) : eq(authUser.email, ref.email!))
    .for('no key update');
  if (!target) throw new ServiceError('NOT_FOUND', 'No account has this address.', { email: 'No account has this e-mail address.' });
  return target;
}

/** The administrator is still a standing administrator: not suspended or demoted since the request began. */
async function requireStandingAdmin(tx: Transaction, actor: Principal): Promise<void> {
  const [row] = await tx
    .select({ role: authUser.role, banned: authUser.banned, banExpires: authUser.banExpires })
    .from(authUser)
    .where(eq(authUser.id, actor.user.id));
  if (!row || row.role !== 'admin' || accountSuspended(row)) throw new ServiceError('UNAUTHORIZED', 'Sign in to continue.');
}

/** Administrators that are not suspended, not counting `exceptId`. */
async function otherActiveAdmins(tx: Transaction, exceptId: string): Promise<number> {
  const rows = await tx
    .select({ banned: authUser.banned, banExpires: authUser.banExpires })
    .from(authUser)
    .where(and(eq(authUser.role, 'admin'), sql`${authUser.id} <> ${exceptId}`));
  return rows.filter((r) => !accountSuspended(r)).length;
}

/**
 * accounts.suspend: suspends an account with a reason, ends its sessions and, from then on, refuses
 * every request and sign-in of it. Admin with a verified second factor only; not your own account;
 * not the last active administrator.
 */
export async function suspendAccount(principal: Principal | null, raw: SuspendInput, meta: RequestMeta): Promise<SuspensionResult> {
  const actor = requireStaff2FA(principal, ['admin']);
  const input = parseOrThrow(suspendInput, raw);
  const until = input.until ? new Date(input.until) : null;
  return getDb().transaction(async (tx) => {
    const target = await lockTarget(tx, input);
    await requireStandingAdmin(tx, actor);
    if (target.id === actor.user.id) throw new ServiceError('FORBIDDEN', 'Another administrator suspends your own account.');
    if (isErasedEmail(target.email)) throw new ServiceError('CONFLICT', 'This account was erased.');
    if (accountSuspended(target)) throw new ServiceError('CONFLICT', 'This account is suspended already.');
    if (target.role === 'admin' && (await otherActiveAdmins(tx, target.id)) === 0) {
      throw new ServiceError('FORBIDDEN', 'This is the last active administrator: it cannot be suspended.');
    }
    // The sessions go first (the trigger on banned does the same for a ban set any other way), so
    // the count is ours to report.
    const ended = await tx.delete(authSession).where(eq(authSession.userId, target.id)).returning({ id: authSession.id });
    await tx.delete(authVerification).where(eq(authVerification.value, target.id));
    await tx
      .update(authUser)
      .set({ banned: true, banReason: input.reason, banExpires: until, updatedAt: new Date() })
      .where(eq(authUser.id, target.id));
    await writeAudit(tx, {
      action: 'account.suspend',
      actorUserId: actor.user.id,
      actorRole: actor.user.role,
      subjectType: 'user',
      subjectId: target.id,
      before: { suspended: false },
      after: { suspended: true, until: until?.toISOString() ?? null, sessionsEnded: ended.length, role: target.role },
      reason: input.reason,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { userId: target.id, suspended: true, until: until?.toISOString() ?? null, sessionsEnded: ended.length };
  });
}

/** accounts.unsuspend: lifts a suspension, with a reason. The sessions it ended stay ended: the person signs in again. */
export async function unsuspendAccount(principal: Principal | null, raw: UnsuspendInput, meta: RequestMeta): Promise<SuspensionResult> {
  const actor = requireStaff2FA(principal, ['admin']);
  const input = parseOrThrow(unsuspendInput, raw);
  return getDb().transaction(async (tx) => {
    const target = await lockTarget(tx, input);
    await requireStandingAdmin(tx, actor);
    // An erased account is a tombstone (privacy.ts): nothing of the person is left to give back.
    if (isErasedEmail(target.email)) throw new ServiceError('CONFLICT', 'This account was erased and cannot be restored.');
    if (!target.banned) throw new ServiceError('CONFLICT', 'This account is not suspended.');
    await tx.update(authUser).set({ banned: false, banReason: null, banExpires: null, updatedAt: new Date() }).where(eq(authUser.id, target.id));
    await writeAudit(tx, {
      action: 'account.unsuspend',
      actorUserId: actor.user.id,
      actorRole: actor.user.role,
      subjectType: 'user',
      subjectId: target.id,
      before: { suspended: accountSuspended(target) },
      after: { suspended: false },
      reason: input.reason,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { userId: target.id, suspended: false, until: null, sessionsEnded: 0 };
  });
}

/** accounts.suspended: the accounts that are suspended now (admin with a verified second factor), the oldest first. */
export async function listSuspended(principal: Principal | null): Promise<{ accounts: SuspendedAccount[] }> {
  requireStaff2FA(principal, ['admin']);
  const rows = await getDb()
    .select({ id: authUser.id, email: authUser.email, reason: authUser.banReason, banned: authUser.banned, banExpires: authUser.banExpires, since: authUser.updatedAt })
    .from(authUser)
    .where(and(eq(authUser.banned, true), sql`${authUser.email} NOT LIKE '%@erased.invalid'`))
    .orderBy(authUser.updatedAt, authUser.id)
    .limit(200);
  return {
    accounts: rows
      .filter((r) => accountSuspended(r))
      .map((r) => ({ id: r.id, email: r.email, reason: r.reason, until: r.banExpires?.toISOString() ?? null, since: r.since.toISOString() })),
  };
}
