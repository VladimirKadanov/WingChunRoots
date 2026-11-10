// Trial lesson inquiries (milestone M21; Phase 2 "Trial lesson inquiry flow"; docs/adr/0024-trial-lessons.md).
//
// The sender's side (a signed-in adult account: a confirmed address, the sign-up confirmations of
// the current versions, 18 or older among them, and a profile, whose primary name the school sees):
//   trial.options     what the request form of a public school offers: whether this account may
//                     send one now and why not, the name and the contact details the school would see
//   trial.request     sends one: preferred days or times (optional), a message (optional, at most
//                     TRIAL_MESSAGE_MAX), the contact the school may use (the account's e-mail, or a
//                     phone typed into the form). DEFAULT M21 (question 3): one open inquiry per sender
//                     and school, at most TRIAL_DAILY_LIMIT in 24 hours, never at one's own school, and
//                     only at a school v_public_school shows (on the map: pin allowed, not hidden by M20)
//   trial.mine        the account's own inquiries with their state and the school's reply
//
// The school's side (its listing account and the admins of the active organizations the school
// accepted a link from; DEFAULT M21, question 4):
//   trial.inbox       the inquiries of one school, with the sender's name and chosen contact
//   trial.answer      marks one answered, with an optional short reply the sender is told
//   trial.decline     declines one, with an optional reason the sender is told
//   trial.close       closes one (open or answered); the sender is not told
//
// Nobody else reads an inquiry: not another account, not staff (DEFAULT M21, question 4), not a
// public DTO, a cache or a log. Audit rows and notices carry ids and states only, never the
// sender's name, contact or message. A new inquiry tells the school (school.trial-requested, in the
// opt-out Schools category: in the dashboard always, by e-mail unless switched off) and adds one to
// the school's trial counter of the day (school-stats.ts); an answer or a decline tells the sender.
// Inquiries are deleted TRIAL_INQUIRY_RETENTION_DAYS after they closed (purgeOldTrialData in
// retention.ts, the daily job; DEFAULT M21, question 5).

import { and, desc, eq, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import { isStaffRole, type Principal } from '../auth/principal';
import { getDb } from '../db';
import { trialInquiry } from '../db/schema';
import {
  TRIAL_CONTACT_METHODS,
  TRIAL_DAILY_LIMIT,
  TRIAL_INQUIRY_RETENTION_DAYS,
  TRIAL_INQUIRY_STATUSES,
  TRIAL_MESSAGE_MAX,
  TRIAL_PREFERRED_MAX,
  TRIAL_REPLY_MAX,
} from '../db/schema/common';
import type { Executor } from '../entitlements/access';
import type { Transaction } from '../jobs/outbox';
import { missingRequiredConsents } from './consent';
import type { RequestMeta } from './context';
import { pgErrorOf, ServiceError } from './errors';
import { notify, notifyEach } from './notify';
import { organizationAdminsOf } from './school-activity';
import { countSchoolEvent } from './school-stats';

export { TRIAL_DAILY_LIMIT, TRIAL_INQUIRY_RETENTION_DAYS, TRIAL_MESSAGE_MAX, TRIAL_PREFERRED_MAX, TRIAL_REPLY_MAX };
export type TrialStatus = (typeof TRIAL_INQUIRY_STATUSES)[number];
export type TrialContactMethod = (typeof TRIAL_CONTACT_METHODS)[number];

export const TRIAL_STATUS_LABELS: Record<TrialStatus, string> = {
  open: 'Waiting for the school',
  answered: 'Answered',
  declined: 'Declined',
  closed: 'Closed',
};

const NO_SCHOOL = 'No such school.';
const NO_INQUIRY = 'No such trial lesson request.';
const PHONE = /^\+?[0-9 ()./-]{5,40}$/;

const text = (max: number, message: string) =>
  z
    .string()
    .max(max * 2, { error: message })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .refine((s) => s.length <= max, { error: message })
    .nullish()
    .transform((s) => (s ? s : null));

export const trialOptionsInput = z.object({ slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/, { error: NO_SCHOOL }) });

export const trialRequestInput = z
  .object({
    schoolId: z.uuid({ error: NO_SCHOOL }),
    preferredTimes: text(TRIAL_PREFERRED_MAX, `Use at most ${TRIAL_PREFERRED_MAX} characters.`),
    message: text(TRIAL_MESSAGE_MAX, `Use at most ${TRIAL_MESSAGE_MAX} characters.`),
    contactMethod: z.enum(TRIAL_CONTACT_METHODS, { error: 'Choose how the school may reach you.' }),
    phone: text(40, 'Use at most 40 characters.'),
  })
  .superRefine((input, ctx) => {
    if (input.contactMethod !== 'phone') return;
    if (!input.phone) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Give the phone number the school may call.' });
    else if (!PHONE.test(input.phone)) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Use digits, spaces and + ( ) - only.' });
  });
export type TrialRequestInput = z.input<typeof trialRequestInput>;

export const trialInboxInput = z.object({
  schoolId: z.uuid({ error: NO_SCHOOL }),
  status: z.enum(['all', ...TRIAL_INQUIRY_STATUSES]).default('all'),
});
export const trialAnswerInput = z.object({ inquiryId: z.uuid({ error: NO_INQUIRY }), reply: text(TRIAL_REPLY_MAX, `Use at most ${TRIAL_REPLY_MAX} characters.`) });
export const trialDeclineInput = z.object({ inquiryId: z.uuid({ error: NO_INQUIRY }), reason: text(TRIAL_REPLY_MAX, `Use at most ${TRIAL_REPLY_MAX} characters.`) });
export const trialCloseInput = z.object({ inquiryId: z.uuid({ error: NO_INQUIRY }) });

function fieldErrors(error: z.ZodError): ServiceError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[String(issue.path[0] ?? 'form')] ??= issue.message;
  return new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
}

// --- Shared reads --------------------------------------------------------------------------------

interface PublicSchoolRow extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  owner: string | null;
  first_trial_free: boolean;
}

/** A school v_public_school shows (on the public map and list), with its listing account. */
async function publicSchool(db: Executor, where: { id: string } | { slug: string }): Promise<PublicSchoolRow | null> {
  const condition = 'id' in where ? sql`v.id = ${where.id}::uuid` : sql`v.slug = ${where.slug}`;
  const result = await db.execute<PublicSchoolRow>(sql`
    SELECT v.id, v.slug, v.name, s.created_by_user_id AS owner, s.first_trial_free
      FROM v_public_school v JOIN school s ON s.id = v.id
     WHERE ${condition}`);
  return result.rows[0] ?? null;
}

/** The primary name of the account's own profile, which the school sees; null without a profile. */
async function senderNameOf(db: Executor, userId: string): Promise<string | null> {
  const result = await db.execute<{ value: string }>(sql`
    SELECT pn.value FROM person p JOIN person_name pn ON pn.person_id = p.id AND pn.is_primary
     WHERE p.claimed_by_user_id = ${userId}::uuid AND p.deleted_at IS NULL
     ORDER BY p.created_at, p.id LIMIT 1`);
  return result.rows[0]?.value ?? null;
}

/** Why an account may not send a request now, or null when it may (the order of the checks). */
type Refusal = 'unconfirmed' | 'no_profile' | 'own_school' | 'open' | 'limit';

const REFUSAL_TEXT: Record<Refusal, string> = {
  unconfirmed: 'Confirm your e-mail address and the confirmations of sign-up (18 or older among them) first.',
  no_profile: 'Set up your profile first: the school sees the name of your profile.',
  own_school: 'This is your own school, so there is no trial lesson to request.',
  open: 'You already have a request at this school that waits for an answer. It is in your trial lesson requests.',
  limit: `You have sent ${TRIAL_DAILY_LIMIT} trial lesson requests in the last 24 hours. Send the next one later.`,
};

async function sentInLastDay(db: Executor, userId: string): Promise<number> {
  const result = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM trial_inquiry WHERE sender_user_id = ${userId}::uuid AND created_at > now() - interval '24 hours'`);
  return result.rows[0]?.n ?? 0;
}

async function openInquiryOf(db: Executor, schoolId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: trialInquiry.id })
    .from(trialInquiry)
    .where(and(eq(trialInquiry.schoolId, schoolId), eq(trialInquiry.senderUserId, userId), eq(trialInquiry.status, 'open')));
  return row?.id ?? null;
}

async function refusalOf(db: Executor, p: Principal, s: PublicSchoolRow): Promise<{ refusal: Refusal | null; name: string | null; openId: string | null }> {
  const name = await senderNameOf(db, p.user.id);
  if (!p.user.emailVerified || (await missingRequiredConsents(db as never, p.user.id)).length > 0) return { refusal: 'unconfirmed', name, openId: null };
  if (!name) return { refusal: 'no_profile', name, openId: null };
  if (s.owner === p.user.id) return { refusal: 'own_school', name, openId: null };
  const openId = await openInquiryOf(db, s.id, p.user.id);
  if (openId) return { refusal: 'open', name, openId };
  if ((await sentInLastDay(db, p.user.id)) >= TRIAL_DAILY_LIMIT) return { refusal: 'limit', name, openId: null };
  return { refusal: null, name, openId: null };
}

// --- The sender's side ---------------------------------------------------------------------------

export interface TrialOptions {
  school: { id: string; slug: string; name: string; firstTrialFree: boolean };
  /** `sign_in` without a session; `ready` when this account may send a request now. */
  state: 'sign_in' | 'ready' | Refusal;
  /** Why not, in a sentence (null when ready or not signed in). */
  reason: string | null;
  /** The open request at this school (state `open`). */
  openInquiryId: string | null;
  /** What the school would see: the profile's name and the account's e-mail (signed in only). */
  sender: { name: string | null; email: string } | null;
  limits: { message: number; preferred: number; perDay: number };
}

const LIMITS = { message: TRIAL_MESSAGE_MAX, preferred: TRIAL_PREFERRED_MAX, perDay: TRIAL_DAILY_LIMIT };

/** trial.options: see the top of this file. 404 for a school that is not public. */
export async function trialOptions(principal: Principal | null, raw: z.input<typeof trialOptionsInput>): Promise<TrialOptions> {
  const parsed = trialOptionsInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', NO_SCHOOL);
  const db = getDb();
  const s = await publicSchool(db, { slug: parsed.data.slug });
  if (!s) throw new ServiceError('NOT_FOUND', NO_SCHOOL);
  const schoolView = { id: s.id, slug: s.slug, name: s.name, firstTrialFree: s.first_trial_free };
  if (!principal) return { school: schoolView, state: 'sign_in', reason: null, openInquiryId: null, sender: null, limits: LIMITS };
  const { refusal, name, openId } = await refusalOf(db, principal, s);
  return {
    school: schoolView,
    state: refusal ?? 'ready',
    reason: refusal ? REFUSAL_TEXT[refusal] : null,
    openInquiryId: openId,
    sender: { name, email: principal.user.email },
    limits: LIMITS,
  };
}

export interface TrialSent {
  id: string;
  schoolId: string;
  slug: string;
  status: TrialStatus;
}

/** trial.request: see the top of this file. */
export async function requestTrial(principal: Principal | null, raw: TrialRequestInput, meta: RequestMeta): Promise<TrialSent> {
  const p = requireUser(principal);
  const parsed = trialRequestInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      // One sender at a time: the open check and the daily count hold for two requests at once.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`trial.request:${p.user.id}`}, 0))`);
      const s = await publicSchool(tx, { id: input.schoolId });
      if (!s) throw new ServiceError('NOT_FOUND', 'This school is not on the public map now, so it takes no trial lesson requests.');
      const { refusal, name } = await refusalOf(tx, p, s);
      if (refusal === 'limit') throw new ServiceError('TOO_MANY_REQUESTS', REFUSAL_TEXT.limit);
      if (refusal === 'unconfirmed') throw new ServiceError('FORBIDDEN', REFUSAL_TEXT.unconfirmed);
      if (refusal) throw new ServiceError('CONFLICT', REFUSAL_TEXT[refusal]);
      const contactValue = input.contactMethod === 'phone' ? input.phone! : p.user.email;
      const [created] = await tx
        .insert(trialInquiry)
        .values({
          schoolId: s.id,
          senderUserId: p.user.id,
          senderName: name!.slice(0, 200),
          contactMethod: input.contactMethod,
          contactValue,
          preferredTimes: input.preferredTimes,
          message: input.message,
        })
        .returning({ id: trialInquiry.id });
      const id = created!.id;
      await writeAudit(tx, {
        action: 'trial.request',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'trial_inquiry',
        subjectId: id,
        after: { status: 'open', schoolId: s.id, contactMethod: input.contactMethod },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      // The school's counter of the day (school stats): never the visits of staff (DEFAULT M21, question 7).
      if (!isStaffRole(p.user.role)) await countSchoolEvent(tx, s.id, 'trial_inquiry');
      const payload = { schoolId: s.id, inquiryId: id, name: s.name };
      if (s.owner) await notify(tx, s.owner, 'school.trial-requested', payload, { key: `school.trial-requested:${id}` });
      for (const admin of await organizationAdminsOf(tx, s.id, s.owner ?? '00000000-0000-0000-0000-000000000000')) {
        if (admin.userId === p.user.id) continue;
        await notifyEach(tx, [admin.userId], 'school.trial-requested', payload, { key: `school.trial-requested:${id}:${admin.organizationId}:${admin.userId}` });
      }
      return { id, schoolId: s.id, slug: s.slug, status: 'open' as const };
    });
  } catch (error) {
    if (pgErrorOf(error)?.constraint === 'trial_inquiry_one_open_key') throw new ServiceError('CONFLICT', REFUSAL_TEXT.open);
    throw error;
  }
}

export interface OwnTrialInquiry {
  id: string;
  school: { id: string; slug: string; name: string; public: boolean };
  status: TrialStatus;
  statusLabel: string;
  preferredTimes: string | null;
  message: string | null;
  contactMethod: TrialContactMethod;
  /** The contact the sender chose: their own data. */
  contactValue: string;
  /** The school's reply (answered) or reason (declined). */
  reply: string | null;
  createdAt: string;
  closedAt: string | null;
}

/** trial.mine: the account's own requests, the newest first. */
export async function myTrialInquiries(principal: Principal | null): Promise<{ inquiries: OwnTrialInquiry[] }> {
  const p = requireUser(principal);
  const result = await getDb().execute<{
    id: string;
    school_id: string;
    slug: string;
    name: string;
    public: boolean;
    status: TrialStatus;
    preferred_times: string | null;
    message: string | null;
    contact_method: TrialContactMethod;
    contact_value: string;
    reply: string | null;
    created_at: Date | string;
    closed_at: Date | string | null;
  }>(sql`
    SELECT t.id, s.id AS school_id, s.slug, s.name, v.id IS NOT NULL AS public, t.status, t.preferred_times, t.message,
           t.contact_method, t.contact_value, t.reply, t.created_at, t.closed_at
      FROM trial_inquiry t JOIN school s ON s.id = t.school_id LEFT JOIN v_public_school v ON v.id = s.id
     WHERE t.sender_user_id = ${p.user.id}::uuid
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT 200`);
  return {
    inquiries: result.rows.map((r) => ({
      id: r.id,
      school: { id: r.school_id, slug: r.slug, name: r.name, public: r.public },
      status: r.status,
      statusLabel: TRIAL_STATUS_LABELS[r.status],
      preferredTimes: r.preferred_times,
      message: r.message,
      contactMethod: r.contact_method,
      contactValue: r.contact_value,
      reply: r.reply,
      createdAt: new Date(r.created_at).toISOString(),
      closedAt: r.closed_at === null ? null : new Date(r.closed_at).toISOString(),
    })),
  };
}

// --- The school's side ---------------------------------------------------------------------------

/** Whether the account may handle the school's requests: its listing account, or an admin of a linked organization. */
async function schoolHandler(db: Executor, schoolId: string, userId: string): Promise<{ id: string; slug: string; name: string; owner: string | null; role: 'owner' | 'organization' } | null> {
  const result = await db.execute<{ id: string; slug: string; name: string; owner: string | null }>(sql`
    SELECT s.id, s.slug, s.name, s.created_by_user_id AS owner FROM school s WHERE s.id = ${schoolId}::uuid AND s.deleted_at IS NULL`);
  const row = result.rows[0];
  if (!row) return null;
  if (row.owner === userId) return { ...row, role: 'owner' };
  const admins = await organizationAdminsOf(db, row.id, row.owner ?? '00000000-0000-0000-0000-000000000000');
  return admins.some((a) => a.userId === userId) ? { ...row, role: 'organization' } : null;
}

export interface InboxInquiry {
  id: string;
  status: TrialStatus;
  statusLabel: string;
  senderName: string;
  contactMethod: TrialContactMethod;
  contactValue: string;
  preferredTimes: string | null;
  message: string | null;
  reply: string | null;
  createdAt: string;
  closedAt: string | null;
}

export interface TrialInbox {
  school: { id: string; slug: string; name: string };
  /** `owner` (the listing account) or `organization` (an admin of a linked organization). */
  role: 'owner' | 'organization';
  status: z.output<typeof trialInboxInput>['status'];
  counts: Record<TrialStatus, number>;
  inquiries: InboxInquiry[];
}

/** trial.inbox: see the top of this file. 404 for anyone but the school's handlers. */
export async function trialInbox(principal: Principal | null, raw: z.input<typeof trialInboxInput>): Promise<TrialInbox> {
  const p = requireUser(principal);
  const parsed = trialInboxInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', NO_SCHOOL);
  const db = getDb();
  const handler = await schoolHandler(db, parsed.data.schoolId, p.user.id);
  if (!handler) throw new ServiceError('NOT_FOUND', NO_SCHOOL);
  const counted = await db.execute<{ status: TrialStatus; n: number }>(sql`
    SELECT status, count(*)::int AS n FROM trial_inquiry WHERE school_id = ${handler.id}::uuid GROUP BY status`);
  const counts: Record<TrialStatus, number> = { open: 0, answered: 0, declined: 0, closed: 0 };
  for (const row of counted.rows) counts[row.status] = row.n;
  const status = parsed.data.status;
  const rows = await db
    .select()
    .from(trialInquiry)
    .where(and(eq(trialInquiry.schoolId, handler.id), status === 'all' ? undefined : eq(trialInquiry.status, status)))
    // Open first, then the newest.
    .orderBy(sql`(${trialInquiry.status} = 'open') DESC`, desc(trialInquiry.createdAt), desc(trialInquiry.id))
    .limit(200);
  return {
    school: { id: handler.id, slug: handler.slug, name: handler.name },
    role: handler.role,
    status,
    counts,
    inquiries: rows.map((r) => ({
      id: r.id,
      status: r.status,
      statusLabel: TRIAL_STATUS_LABELS[r.status],
      senderName: r.senderName,
      contactMethod: r.contactMethod,
      contactValue: r.contactValue,
      preferredTimes: r.preferredTimes,
      message: r.message,
      reply: r.reply,
      createdAt: r.createdAt.toISOString(),
      closedAt: r.closedAt?.toISOString() ?? null,
    })),
  };
}

/** The open (or, for close, answered) inquiry that the account may handle, locked. */
async function handledInquiry(tx: Transaction, inquiryId: string, userId: string) {
  const [row] = await tx.select().from(trialInquiry).where(eq(trialInquiry.id, inquiryId)).for('update');
  if (!row) throw new ServiceError('NOT_FOUND', NO_INQUIRY);
  const handler = await schoolHandler(tx, row.schoolId, userId);
  if (!handler) throw new ServiceError('NOT_FOUND', NO_INQUIRY);
  return { row, handler };
}

export interface TrialHandled {
  id: string;
  schoolId: string;
  status: TrialStatus;
  /** True when it was already in that state (a second press): nothing changed, nobody was told again. */
  replayed: boolean;
}

async function decide(
  principal: Principal | null,
  inquiryId: string,
  to: 'answered' | 'declined' | 'closed',
  reply: string | null,
  meta: RequestMeta,
): Promise<TrialHandled> {
  const p = requireUser(principal);
  return getDb().transaction(async (tx) => {
    const { row, handler } = await handledInquiry(tx, inquiryId, p.user.id);
    if (row.status === to) return { id: row.id, schoolId: row.schoolId, status: row.status, replayed: true };
    const allowed = to === 'closed' ? row.status === 'open' || row.status === 'answered' : row.status === 'open';
    if (!allowed) throw new ServiceError('CONFLICT', `This request is ${TRIAL_STATUS_LABELS[row.status].toLowerCase()} already.`);
    await tx
      .update(trialInquiry)
      .set({ status: to, reply: to === 'closed' ? row.reply : reply, handledByUserId: p.user.id, closedAt: new Date(), updatedAt: new Date() })
      .where(eq(trialInquiry.id, row.id));
    await writeAudit(tx, {
      action: to === 'answered' ? 'trial.answer' : to === 'declined' ? 'trial.decline' : 'trial.close',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'trial_inquiry',
      subjectId: row.id,
      before: { status: row.status },
      after: { status: to, schoolId: row.schoolId, withText: to !== 'closed' && reply !== null, by: handler.role },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    const payload = { schoolId: handler.id, inquiryId: row.id, name: handler.name };
    if (to === 'answered') await notify(tx, row.senderUserId, 'school.trial-answered', { ...payload, reply }, { key: `school.trial-answered:${row.id}` });
    if (to === 'declined') await notify(tx, row.senderUserId, 'school.trial-declined', { ...payload, reason: reply }, { key: `school.trial-declined:${row.id}` });
    return { id: row.id, schoolId: row.schoolId, status: to, replayed: false };
  });
}

/** trial.answer: see the top of this file. */
export async function answerTrial(principal: Principal | null, raw: z.input<typeof trialAnswerInput>, meta: RequestMeta): Promise<TrialHandled> {
  requireUser(principal);
  const parsed = trialAnswerInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  return decide(principal, parsed.data.inquiryId, 'answered', parsed.data.reply, meta);
}

/** trial.decline: see the top of this file. */
export async function declineTrial(principal: Principal | null, raw: z.input<typeof trialDeclineInput>, meta: RequestMeta): Promise<TrialHandled> {
  requireUser(principal);
  const parsed = trialDeclineInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  return decide(principal, parsed.data.inquiryId, 'declined', parsed.data.reason, meta);
}

/** trial.close: see the top of this file. */
export async function closeTrial(principal: Principal | null, raw: z.input<typeof trialCloseInput>, meta: RequestMeta): Promise<TrialHandled> {
  requireUser(principal);
  const parsed = trialCloseInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  return decide(principal, parsed.data.inquiryId, 'closed', null, meta);
}

/** The number of open requests of each of these schools (the owner's school list). */
export async function openTrialCounts(db: Executor, schoolIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (schoolIds.length === 0) return out;
  const result = await db.execute<{ school_id: string; n: number }>(sql`
    SELECT school_id, count(*)::int AS n FROM trial_inquiry
     WHERE status = 'open' AND school_id = ANY (${sql`ARRAY[${sql.join(schoolIds.map((id) => sql`${id}::uuid`), sql`, `)}]`})
     GROUP BY school_id`);
  for (const row of result.rows) out.set(row.school_id, row.n);
  return out;
}
