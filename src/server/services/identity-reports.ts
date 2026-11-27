// Impersonation reports (owner decisions 2026-11-27; docs/adr/0088-impersonation-reports.md;
// specification §16.1): "This account is pretending to be me". No identity documents in Phase 1
// (decision 2): the proof is vouching, the person's own channel, or a short private video.
//
//   identity.get         the report page of a public profile: may this account report it, as what
//   identity.report      files the report: a review_case of kind identity_report, open; nothing
//                        changes for the profile (decision 1: no hold before a moderator's check)
//   identity.triage      a moderator or an administrator checks it: `hold` puts the profile on hold
//                        (person.identity_hold_at) and tells the account that holds it, with 14 days
//                        for the proof and 30 for the hold; `close` ends it with a reason
//   identity.askVouch    one side asks a verified teacher (decision 6: one is enough) or a verified
//                        member (two, from different schools) to vouch for it
//   identityVouches.get, identityVouches.answer   the asked person's page: yes, no or not sure
//   identity.addCode     own channel: a code mailed to an address at the school's own domain (only
//                        the domain is kept), or a public code to post on the school's page
//   identity.confirmCode the side types the mailed code back; identity.checkCode an administrator
//                        saw the public code on the page
//   review.decide        an administrator alone decides (decision 3, review-core.ts DECIDERS):
//                        decideIdentityReport below. Upheld: the profile moves to the reporter
//                        (impostor) or the copy is taken down (duplicate); dismissed or unsettled:
//                        the hold lifts
//
// The two sides never see each other: the account that holds the profile learns what is claimed,
// never by whom; each side reads only its own vouches, codes, files and replies (cases.ts). Logs and
// audit rows carry ids and counts, never a name, an address or a code (plan §6.4).

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { and, asc, count, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { invalidatePublic } from '../cache';
import { hasStaff2FA, requireStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import {
  authUser,
  evidenceFile,
  evidenceLink,
  identityCode,
  identityReport,
  identityVouch,
  person,
  personPhoto,
  relationshipEvent,
  reviewCase,
  reviewEvent,
  reviewNote,
  teachingRelationship,
} from '../db/schema';
import {
  IDENTITY_CODE_DAYS,
  IDENTITY_CODE_MAX_ATTEMPTS,
  IDENTITY_HOLD_DAYS,
  IDENTITY_NOTE_MAX,
  IDENTITY_PROOF_DAYS,
  IDENTITY_REFILE_DAYS,
  IDENTITY_REPORTS_PER_30_DAYS,
  IDENTITY_TARGET_MAX,
  IDENTITY_TEXT_MAX,
  IDENTITY_VIDEO_KEEP_DAYS,
  IDENTITY_VOUCH_ANSWERS,
  IDENTITY_VOUCH_KINDS,
  IDENTITY_VOUCHER_MIN_AGE_DAYS,
  OPEN_IDENTITY_REPORT_STATUSES,
} from '../db/schema/common';
import type { Executor } from '../entitlements/access';
import { enqueue, queueEmail, type Transaction } from '../jobs/outbox';
import { QUEUE } from '../jobs/queues';
import { getEvidenceStore, type ObjectStore } from '../storage';
import { accountSuspended } from '../auth/suspension';
import type { RequestMeta } from './context';
import { missingRequiredConsents } from './consent';
import { peopleRefs, type PersonRef } from './dashboard';
import { pgErrorOf, ServiceError } from './errors';
import { notify, notifyEach } from './notify';
import { sifuOnClaim } from './plans';
import { neighbourTags } from './profile';
export { HELD_MESSAGE, refuseWhileHeld } from './identity-hold';
import { fieldErrors, idempotencyKey, keyReused, viewerOf } from './relationships';
import { askParties, type KindDecisionInput, type KindDecisionOutcome, resolveCase } from './review-kinds';
import { type CaseRow, caseById, caseNotFound, caseReplayOf, isCaseKeyConflict, isOpenCase, lockAccountCases, ownSide, recordCaseEvent } from './review-core';
import { applySuspension, SUSPENSION_REASON_MAX } from './suspension';
import { applyTakeDown } from './takedown';

export type IdentityReportType = 'impostor' | 'duplicate';
export type IdentityRoute = 'vouching' | 'channel' | 'video' | 'own_profile';
export type IdentitySide = 'reporter' | 'reported';
export type IdentityVouchAnswer = (typeof IDENTITY_VOUCH_ANSWERS)[number];
export type IdentityVouchKind = (typeof IDENTITY_VOUCH_KINDS)[number];

const DAY = 86_400_000;
/** At most this many vouches and codes one side asks for in one report. */
export const IDENTITY_VOUCHES_PER_SIDE = 5;
export const IDENTITY_CODES_PER_SIDE = 3;

/** The proof routes an impostor report chooses from (decision 2), as the report page offers them. */
export const ROUTE_TEXT: Record<Exclude<IdentityRoute, 'own_profile'>, { label: string; hint: string }> = {
  vouching: {
    label: 'People who know me vouch for me',
    hint: 'One verified teacher of yours, or two verified members from different schools, confirm to the administrators that you are this person.',
  },
  channel: {
    label: 'My school’s own website or e-mail',
    hint: 'We send a code to an address at your school’s own domain, or you post a code on the school’s website or official social page.',
  },
  video: {
    label: 'A short private video',
    hint: 'Half a minute of you saying your name and today’s date. Only the administrators see it, and it is deleted 30 days after the decision.',
  },
};

export const VOUCH_ANSWER_LABELS: Record<IdentityVouchAnswer, string> = {
  yes: 'Yes, I know this is them',
  no: 'No, I do not think it is them',
  unsure: 'I am not sure',
};

export const VOUCH_KIND_LABELS: Record<IdentityVouchKind, string> = {
  teacher: 'Verified teacher',
  peer: 'Verified member',
};

export const REPORT_STATUS_LABELS: Record<string, string> = {
  open: 'Waiting for a moderator’s check',
  held: 'On hold while the administrators decide',
  upheld: 'Upheld',
  dismissed: 'Not upheld',
  unsettled: 'Could not be settled',
  closed: 'Closed after the moderator’s check',
};

/** Free mail services: an address there shows nothing about a school. */
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|web|yandex|mail|abv|dir|inbox|zoho|tutanota|tuta|fastmail|qq|163|126)\.[a-z.]+$/;

const text = (max: number, required: string) =>
  z
    .string({ error: required })
    .max(max * 2, { error: `Use at most ${max} characters.` })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .refine((s) => s.length > 0, { error: required })
    .refine((s) => s.length <= max, { error: `Use at most ${max} characters.` });

const optionalText = (max: number) =>
  z
    .string()
    .max(max * 2, { error: `Use at most ${max} characters.` })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .refine((s) => s.length <= max, { error: `Use at most ${max} characters.` })
    .nullish()
    .transform((s) => (s ? s : null));

export const identityGetInput = z.object({ slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/, { error: 'No such profile.' }) });

export const identityReportInput = z.object({
  personId: z.uuid({ error: 'No such profile.' }),
  /** Impostor reports only: how the reporter will prove who they are. */
  route: z.enum(['vouching', 'channel', 'video'], { error: 'Choose how you will show that you are this person.' }).nullish(),
  details: text(IDENTITY_TEXT_MAX, 'Say why this profile is yours.'),
  idempotencyKey,
});

export const identityTriageInput = z.object({
  caseId: z.uuid({ error: 'No such case.' }),
  outcome: z.enum(['hold', 'close'], { error: 'Choose what to do.' }),
  /** Required to close: the reporter reads it. Optional with a hold (an internal note). */
  reason: optionalText(IDENTITY_TEXT_MAX),
  idempotencyKey,
});

export const identityAskVouchInput = z.object({
  caseId: z.uuid({ error: 'No such case.' }),
  /** The profile address of the person asked (/people/<slug>). */
  slug: z.string({ error: 'Enter the profile address of the person to ask.' }).trim().toLowerCase().min(1, { error: 'Enter the profile address of the person to ask.' }).max(200),
  kind: z.enum(IDENTITY_VOUCH_KINDS, { error: 'Choose a teacher or a member.' }),
  message: optionalText(IDENTITY_NOTE_MAX),
});

export const identityVouchIdInput = z.object({ id: z.uuid({ error: 'No such question.' }) });

export const identityVouchAnswerInput = z.object({
  id: z.uuid({ error: 'No such question.' }),
  answer: z.enum(IDENTITY_VOUCH_ANSWERS, { error: 'Choose an answer.' }),
  note: optionalText(IDENTITY_NOTE_MAX),
});

export const identityAddCodeInput = z.object({
  caseId: z.uuid({ error: 'No such case.' }),
  channel: z.enum(['email', 'page'], { error: 'Choose e-mail or a page.' }),
  /** `email`: an address at the school's own domain; `page`: the https address of the page. */
  target: z.string({ error: 'Enter the address.' }).trim().min(1, { error: 'Enter the address.' }).max(IDENTITY_TARGET_MAX, { error: `Use at most ${IDENTITY_TARGET_MAX} characters.` }),
});

export const identityConfirmCodeInput = z.object({
  codeId: z.uuid({ error: 'No such code.' }),
  code: z.string({ error: 'Enter the code.' }).trim().regex(/^[0-9]{6}$/, { error: 'Enter the six digits of the e-mail.' }),
});

export const identityCheckCodeInput = z.object({ codeId: z.uuid({ error: 'No such code.' }) });

// --- Shared reads --------------------------------------------------------------------------------

export interface ReportRow {
  id: string;
  caseId: string;
  subjectPersonId: string;
  reporterUserId: string | null;
  reportedUserId: string | null;
  type: IdentityReportType;
  route: IdentityRoute;
  status: 'open' | 'held' | 'upheld' | 'dismissed' | 'unsettled' | 'closed';
  heldAt: Date | null;
  proofDueAt: Date | null;
  holdUntil: Date | null;
  decidedAt: Date | null;
  outcome: Record<string, unknown> | null;
}

const reportColumns = {
  id: identityReport.id,
  caseId: identityReport.reviewCaseId,
  subjectPersonId: identityReport.subjectPersonId,
  reporterUserId: identityReport.reporterUserId,
  reportedUserId: identityReport.reportedUserId,
  type: identityReport.type,
  route: identityReport.route,
  status: identityReport.status,
  heldAt: identityReport.heldAt,
  proofDueAt: identityReport.proofDueAt,
  holdUntil: identityReport.holdUntil,
  decidedAt: identityReport.decidedAt,
  outcome: identityReport.outcome,
};

export async function reportOfCase(db: Executor, caseId: string, lock = false): Promise<ReportRow | null> {
  const query = db.select(reportColumns).from(identityReport).where(eq(identityReport.reviewCaseId, caseId));
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

/** The viewer's side of a report: the reporter, or the account that held the profile once a moderator put it on hold. */
export function sideOf(report: Pick<ReportRow, 'reporterUserId' | 'reportedUserId' | 'heldAt'>, userId: string): IdentitySide | null {
  if (report.reporterUserId === userId) return 'reporter';
  if (report.reportedUserId === userId && report.heldAt) return 'reported';
  return null;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function staffToTell(tx: Executor, roles: readonly string[], exclude: readonly (string | null)[]): Promise<string[]> {
  const rows = await tx
    .select({ id: authUser.id })
    .from(authUser)
    .where(and(inArray(authUser.role, [...roles] as ('admin' | 'moderator')[]), eq(authUser.banned, false)))
    .limit(200);
  return rows.map((r) => r.id).filter((id) => !exclude.includes(id));
}

async function tellSide(tx: Transaction, userId: string | null, caseId: string, stage: string, side: IdentitySide): Promise<void> {
  if (userId) await notify(tx, userId, 'identity.notice', { caseId, stage, side }, { key: `identity:${caseId}:${stage}:${side}` });
}

// --- identity.get --------------------------------------------------------------------------------

export interface IdentityReportOption {
  person: PersonRef;
  /** Null when the account may report this profile; otherwise why not, in the page's words. */
  refusal: string | null;
  /** The account's own open report of this profile, when it has one. */
  openCaseId: string | null;
  type: IdentityReportType;
  routes: { value: Exclude<IdentityRoute, 'own_profile'>; label: string; hint: string }[];
  detailsMax: number;
}

/** The profile a report is about: public, its own account's (stewardship self), living, not the viewer's. */
async function reportable(db: Executor, personId: string) {
  const [row] = await db
    .select({
      id: person.id,
      slug: person.slug,
      kind: person.kind,
      stewardship: person.stewardship,
      claimedBy: person.claimedByUserId,
      isPublic: sql<boolean>`EXISTS (SELECT 1 FROM v_public_person vp WHERE vp.id = ${person.id})`,
    })
    .from(person)
    .where(and(eq(person.id, personId), isNull(person.deletedAt)));
  return row && row.isPublic ? row : null;
}

const NO_PROFILE = () => new ServiceError('NOT_FOUND', 'No such profile.');
const NOT_SELF = 'Only a profile that a member runs can be reported as pretending to be you. For an archive record, use Record history and corrections.';

/** Why this account may not report now (null: it may), with its open report of the profile if any. */
async function refusalFor(db: Executor, p: Principal, target: { id: string; stewardship: string; claimedBy: string | null; kind: string }, ownId: string | null): Promise<{ refusal: string | null; openCaseId: string | null }> {
  if (target.claimedBy === p.user.id || ownId === target.id) return { refusal: 'This is your own profile. Edit it in Your profile instead.', openCaseId: null };
  if (target.stewardship !== 'self' || !target.claimedBy || target.kind !== 'living') return { refusal: NOT_SELF, openCaseId: null };
  const [open] = await db
    .select({ caseId: identityReport.reviewCaseId, subject: identityReport.subjectPersonId })
    .from(identityReport)
    .where(and(eq(identityReport.reporterUserId, p.user.id), inArray(identityReport.status, [...OPEN_IDENTITY_REPORT_STATUSES])));
  if (open) {
    return open.subject === target.id
      ? { refusal: 'You have reported this profile already. Follow your report on its case page.', openCaseId: open.caseId }
      : { refusal: 'You have another report waiting. You can send a new one once it is decided.', openCaseId: null };
  }
  const [recent] = await db
    .select({ n: count() })
    .from(identityReport)
    .where(and(eq(identityReport.reporterUserId, p.user.id), gt(identityReport.createdAt, new Date(Date.now() - 30 * DAY))));
  if ((recent?.n ?? 0) >= IDENTITY_REPORTS_PER_30_DAYS) return { refusal: 'You have sent several reports this month. You can send another one later.', openCaseId: null };
  const [unsettled] = await db
    .select({ id: identityReport.id })
    .from(identityReport)
    .where(
      and(
        eq(identityReport.reporterUserId, p.user.id),
        eq(identityReport.subjectPersonId, target.id),
        eq(identityReport.status, 'unsettled'),
        gt(identityReport.decidedAt, new Date(Date.now() - IDENTITY_REFILE_DAYS * DAY)),
      ),
    );
  if (unsettled) return { refusal: `Your last report of this profile could not be settled. You can report it again ${IDENTITY_REFILE_DAYS} days after that decision, with new proof.`, openCaseId: null };
  return { refusal: null, openCaseId: null };
}

/** identity.get: the "This account is pretending to be me" page of a public profile. */
export async function getIdentityReportOption(principal: Principal | null, raw: z.input<typeof identityGetInput>): Promise<IdentityReportOption> {
  const p = requireUser(principal);
  const parsed = identityGetInput.safeParse(raw);
  if (!parsed.success) throw NO_PROFILE();
  const db = getDb();
  const [found] = await db.select({ id: person.id }).from(person).where(and(eq(person.slug, parsed.data.slug), isNull(person.deletedAt)));
  const target = found ? await reportable(db, found.id) : null;
  if (!target) throw NO_PROFILE();
  const viewer = await viewerOf(db, p);
  const ref = (await peopleRefs([target.id])).get(target.id)!;
  const { refusal, openCaseId } = await refusalFor(db, p, target, viewer.personId);
  const type: IdentityReportType = viewer.personId ? 'duplicate' : 'impostor';
  return {
    person: ref,
    refusal,
    openCaseId,
    type,
    routes: type === 'impostor' ? (Object.keys(ROUTE_TEXT) as (keyof typeof ROUTE_TEXT)[]).map((value) => ({ value, ...ROUTE_TEXT[value] })) : [],
    detailsMax: IDENTITY_TEXT_MAX,
  };
}

// --- identity.report -----------------------------------------------------------------------------

/** identity.report: files a report (see the top of this file). Nothing changes for the profile yet. */
export async function fileIdentityReport(principal: Principal | null, raw: z.input<typeof identityReportInput>, meta: RequestMeta): Promise<{ caseId: string; replayed: boolean }> {
  const p = requireUser(principal);
  const parsed = identityReportInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      await lockAccountCases(tx, p.user.id);
      const replay = await caseReplayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        const [earlier] = await tx.select({ kind: reviewCase.kind, personId: reviewCase.personId }).from(reviewCase).where(eq(reviewCase.id, replay.caseId));
        if (replay.action !== 'open' || earlier?.kind !== 'identity_report' || earlier.personId !== input.personId) throw keyReused();
        return { caseId: replay.caseId, replayed: true };
      }
      const target = await reportable(tx, input.personId);
      if (!target) throw NO_PROFILE();
      if ((await missingRequiredConsents(tx, p.user.id)).length > 0) throw new ServiceError('FORBIDDEN', 'Accept the terms and the privacy notice first.');
      const viewer = await viewerOf(tx, p);
      const { refusal } = await refusalFor(tx, p, target, viewer.personId);
      if (refusal) throw new ServiceError(refusal.startsWith('You have sent') ? 'TOO_MANY_REQUESTS' : 'CONFLICT', refusal);
      const type: IdentityReportType = viewer.personId ? 'duplicate' : 'impostor';
      if (type === 'impostor' && !input.route) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { route: 'Choose how you will show that you are this person.' });
      const route: IdentityRoute = type === 'duplicate' ? 'own_profile' : input.route!;

      const caseId = uuidv7();
      await tx.insert(reviewCase).values({ id: caseId, kind: 'identity_report', status: 'open', personId: target.id, openedByUserId: p.user.id });
      const reportId = uuidv7();
      await tx.insert(identityReport).values({ id: reportId, reviewCaseId: caseId, subjectPersonId: target.id, reporterUserId: p.user.id, reportedUserId: target.claimedBy, type, route });
      // The reporter's words, as their first reply: the reviewers read it, the other side never does.
      await tx.insert(reviewNote).values({ reviewCaseId: caseId, authorUserId: p.user.id, body: input.details, isInternal: false });
      await recordCaseEvent(tx, { caseId, action: 'open', from: null, to: 'open', actor: p, key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'identity.report',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'person',
        subjectId: target.id,
        after: { reportId, caseId, type, route, reportedUserId: target.claimedBy },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      // The moderators make the first check, and the administrators decide: both are told.
      await notifyEach(tx, await staffToTell(tx, ['moderator', 'admin'], [p.user.id, target.claimedBy]), 'review.opened', { caseId, kind: 'identity_report' });
      return { caseId, replayed: false };
    });
  } catch (error) {
    if (isCaseKeyConflict(error)) throw keyReused();
    const pg = pgErrorOf(error);
    if (pg?.code === '23505' && pg.constraint === 'identity_report_one_open_key') throw new ServiceError('CONFLICT', 'You have another report waiting. You can send a new one once it is decided.');
    throw error;
  }
}

// --- identity.triage ----------------------------------------------------------------------------

/** Lifts the profile's hold unless another report holds it too; returns the cache tags. */
async function releaseHold(tx: Transaction, report: ReportRow): Promise<string[]> {
  const [other] = await tx
    .select({ id: identityReport.id })
    .from(identityReport)
    .where(and(eq(identityReport.subjectPersonId, report.subjectPersonId), eq(identityReport.status, 'held'), ne(identityReport.id, report.id)));
  if (other) return [];
  const [row] = await tx.select({ held: person.identityHoldAt }).from(person).where(eq(person.id, report.subjectPersonId)).for('update');
  if (!row?.held) return [];
  await tx.update(person).set({ identityHoldAt: null, updatedAt: new Date() }).where(eq(person.id, report.subjectPersonId));
  return neighbourTags(tx, report.subjectPersonId);
}

/** identity.triage: the moderators' first check (decision 1): hold the profile, or close the report. */
export async function triageIdentityReport(principal: Principal | null, raw: z.input<typeof identityTriageInput>, meta: RequestMeta): Promise<{ caseId: string; replayed: boolean }> {
  const result = await triage(principal, raw, meta);
  if (result.tags.length > 0) invalidatePublic(result.tags, 'procedure');
  return { caseId: result.caseId, replayed: result.replayed };
}

async function triage(principal: Principal | null, raw: z.input<typeof identityTriageInput>, meta: RequestMeta): Promise<{ caseId: string; replayed: boolean; tags: string[] }> {
  const p = requireStaff2FA(principal, ['moderator', 'admin']);
  const parsed = identityTriageInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  if (input.outcome === 'close' && !input.reason) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { reason: 'Write the reason the reporter will read.' });
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const c = await caseById(tx, input.caseId, true);
      if (!c || c.kind !== 'identity_report') throw caseNotFound();
      const replay = await caseReplayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        if (replay.caseId !== c.id || replay.action !== (input.outcome === 'hold' ? 'hold' : 'reject')) throw keyReused();
        return { caseId: c.id, replayed: true, tags: [] };
      }
      if (await ownSide(tx, p, c)) throw new ServiceError('FORBIDDEN', 'This case is about you: another member of staff checks it.');
      const report = await reportOfCase(tx, c.id, true);
      if (!report || !isOpenCase(c.status) || report.status !== 'open') throw new ServiceError('CONFLICT', 'This report has been checked already.');
      const now = new Date();
      if (input.outcome === 'close') {
        await resolveCase(tx, p, c, { decision: 'reject', reason: input.reason, idempotencyKey: input.idempotencyKey }, 'rejected', meta);
        await tx.update(identityReport).set({ status: 'closed', decidedAt: now, updatedAt: now }).where(eq(identityReport.id, report.id));
        await writeAudit(tx, {
          action: 'identity.close',
          actorUserId: p.user.id,
          actorRole: p.user.role,
          subjectType: 'review_case',
          subjectId: c.id,
          before: { status: 'open' },
          after: { status: 'closed', personId: report.subjectPersonId },
          requestId: meta.requestId,
          ipHmac: meta.ipHmac,
        });
        await tellSide(tx, report.reporterUserId, c.id, 'closed', 'reporter');
        return { caseId: c.id, replayed: false, tags: [] };
      }
      // The hold: the profile is locked against changes (refuseWhileHeld), and the public page says
      // "Identity under review" in place of the instructor mark (v_public_person.identity_hold).
      const proofDueAt = new Date(now.getTime() + IDENTITY_PROOF_DAYS * DAY);
      const holdUntil = new Date(now.getTime() + IDENTITY_HOLD_DAYS * DAY);
      await tx.select({ id: person.id }).from(person).where(eq(person.id, report.subjectPersonId)).for('update');
      await tx.update(person).set({ identityHoldAt: now, updatedAt: now }).where(and(eq(person.id, report.subjectPersonId), isNull(person.identityHoldAt)));
      await tx.update(identityReport).set({ status: 'held', heldAt: now, heldByUserId: p.user.id, proofDueAt, holdUntil, updatedAt: now }).where(eq(identityReport.id, report.id));
      if (input.reason) await tx.insert(reviewNote).values({ reviewCaseId: c.id, authorUserId: p.user.id, body: input.reason, isInternal: true });
      await tx.update(reviewCase).set({ updatedAt: now }).where(eq(reviewCase.id, c.id));
      await recordCaseEvent(tx, { caseId: c.id, action: 'hold', from: c.status, to: c.status, actor: p, key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'identity.hold',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'person',
        subjectId: report.subjectPersonId,
        before: { held: false },
        after: { held: true, caseId: c.id, proofDueAt: proofDueAt.toISOString(), holdUntil: holdUntil.toISOString() },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      await tellSide(tx, report.reporterUserId, c.id, 'held', 'reporter');
      await tellSide(tx, report.reportedUserId, c.id, 'held', 'reported');
      // The administrators decide from here (decision 3).
      await notifyEach(tx, await staffToTell(tx, ['admin'], [p.user.id, report.reporterUserId, report.reportedUserId]), 'review.updated', { caseId: c.id, change: 'evidence' });
      return { caseId: c.id, replayed: false, tags: await neighbourTags(tx, report.subjectPersonId) };
    });
  } catch (error) {
    if (isCaseKeyConflict(error)) throw keyReused();
    throw error;
  }
}

// --- The side's own part of a report (cases.get) -------------------------------------------------

export interface IdentityVouchView {
  id: string;
  kind: IdentityVouchKind;
  kindLabel: string;
  voucher: PersonRef;
  askedAt: string;
  answer: IdentityVouchAnswer | null;
  answerLabel: string | null;
  answeredAt: string | null;
}

export interface IdentityCodeView {
  id: string;
  channel: 'email' | 'page';
  /** `email`: the domain; `page`: the page's address. */
  target: string;
  /** `page` only: the code to post. */
  publicCode: string | null;
  expiresAt: string;
  confirmed: boolean;
  /** `email`: attempts left to type the code. */
  attemptsLeft: number;
}

export interface IdentityPartyView {
  side: IdentitySide;
  type: IdentityReportType;
  route: IdentityRoute;
  routeLabel: string;
  status: ReportRow['status'];
  statusLabel: string;
  subject: PersonRef;
  proofDueAt: string | null;
  holdUntil: string | null;
  /** The side may add proof: the profile is on hold and the case is open. */
  canProve: boolean;
  vouches: IdentityVouchView[];
  codes: IdentityCodeView[];
  /** What a decision did, for the side that reads it (the reporter of an upheld report). */
  outcome: { profileMoved: boolean; photosRemoved: number; relationshipsReturned: number; takenDown: boolean } | null;
  limits: { vouches: number; codes: number; noteMax: number; targetMax: number };
}

const routeLabel = (route: IdentityRoute) => (route === 'own_profile' ? 'My own profile on WingChunRoots' : ROUTE_TEXT[route].label);

async function vouchesOf(db: Executor, caseId: string, side?: IdentitySide) {
  const rows = await db
    .select({
      id: identityVouch.id,
      side: identityVouch.side,
      kind: identityVouch.kind,
      voucherPersonId: identityVouch.voucherPersonId,
      message: identityVouch.message,
      answer: identityVouch.answer,
      note: identityVouch.note,
      answeredAt: identityVouch.answeredAt,
      createdAt: identityVouch.createdAt,
    })
    .from(identityVouch)
    .where(and(eq(identityVouch.reviewCaseId, caseId), side ? eq(identityVouch.side, side) : undefined))
    .orderBy(asc(identityVouch.createdAt));
  const refs = await peopleRefs([...new Set(rows.map((r) => r.voucherPersonId))]);
  return rows.flatMap((r) => {
    const voucher = refs.get(r.voucherPersonId);
    return voucher ? [{ ...r, voucher }] : [];
  });
}

async function codesOf(db: Executor, caseId: string, side?: IdentitySide) {
  return db
    .select({
      id: identityCode.id,
      side: identityCode.side,
      channel: identityCode.channel,
      target: identityCode.target,
      publicCode: identityCode.publicCode,
      attempts: identityCode.attempts,
      expiresAt: identityCode.expiresAt,
      confirmedAt: identityCode.confirmedAt,
      createdAt: identityCode.createdAt,
    })
    .from(identityCode)
    .where(and(eq(identityCode.reviewCaseId, caseId), side ? eq(identityCode.side, side) : undefined))
    .orderBy(asc(identityCode.createdAt));
}

const codeView = (r: Awaited<ReturnType<typeof codesOf>>[number]): IdentityCodeView => ({
  id: r.id,
  channel: r.channel,
  target: r.target,
  publicCode: r.publicCode,
  expiresAt: r.expiresAt.toISOString(),
  confirmed: r.confirmedAt !== null,
  attemptsLeft: Math.max(0, IDENTITY_CODE_MAX_ATTEMPTS - r.attempts),
});

/** The side's own part of an identity report, for cases.get; null when the viewer is no side. */
export async function identityPartyView(db: Executor, c: CaseRow, userId: string): Promise<IdentityPartyView | null> {
  if (c.kind !== 'identity_report') return null;
  const report = await reportOfCase(db, c.id);
  if (!report) return null;
  const side = sideOf(report, userId);
  if (!side) return null;
  const subject = (await peopleRefs([report.subjectPersonId])).get(report.subjectPersonId)!;
  const vouches = await vouchesOf(db, c.id, side);
  const codes = await codesOf(db, c.id, side);
  const outcome = report.outcome as { profileMoved?: boolean; photosRemoved?: number; relationshipsReturned?: number; takenDown?: boolean } | null;
  return {
    side,
    type: report.type,
    route: report.route,
    routeLabel: routeLabel(report.route),
    status: report.status,
    statusLabel: REPORT_STATUS_LABELS[report.status] ?? report.status,
    subject,
    proofDueAt: report.proofDueAt?.toISOString() ?? null,
    holdUntil: report.holdUntil?.toISOString() ?? null,
    canProve: report.status === 'held' && isOpenCase(c.status),
    vouches: vouches.map((v) => ({
      id: v.id,
      kind: v.kind,
      kindLabel: VOUCH_KIND_LABELS[v.kind],
      voucher: v.voucher,
      askedAt: v.createdAt.toISOString(),
      answer: v.answer,
      answerLabel: v.answer ? VOUCH_ANSWER_LABELS[v.answer] : null,
      answeredAt: v.answeredAt?.toISOString() ?? null,
    })),
    codes: codes.map(codeView),
    outcome:
      report.status === 'upheld' && side === 'reporter' && outcome
        ? { profileMoved: outcome.profileMoved === true, photosRemoved: outcome.photosRemoved ?? 0, relationshipsReturned: outcome.relationshipsReturned ?? 0, takenDown: outcome.takenDown === true }
        : null,
    limits: { vouches: IDENTITY_VOUCHES_PER_SIDE, codes: IDENTITY_CODES_PER_SIDE, noteMax: IDENTITY_NOTE_MAX, targetMax: IDENTITY_TARGET_MAX },
  };
}

/** The open case and the report of a side that may add proof now, locked; 404 for anyone else. */
async function provingSide(tx: Transaction, p: Principal, caseId: string): Promise<{ c: CaseRow; report: ReportRow; side: IdentitySide }> {
  const c = await caseById(tx, caseId, true);
  if (!c || c.kind !== 'identity_report') throw caseNotFound();
  const report = await reportOfCase(tx, c.id, true);
  const side = report ? sideOf(report, p.user.id) : null;
  if (!report || !side) throw caseNotFound();
  if (!isOpenCase(c.status) || report.status !== 'held') throw new ServiceError('CONFLICT', 'This report takes no more proof now.');
  return { c, report, side };
}

// --- identity.askVouch ---------------------------------------------------------------------------

/**
 * Who may vouch (decision 6): an account at least 30 days old, not suspended, neither side, with a
 * profile. A `teacher`: a verified teacher of the reported profile, or a verified instructor. A
 * `peer`: a member with a verified link that the account holding the profile did not confirm, and
 * who is not a student of the reported profile.
 */
async function voucherRefusal(tx: Transaction, report: ReportRow, voucher: { id: string; userId: string }, kind: IdentityVouchKind): Promise<string | null> {
  const [account] = await tx.select({ createdAt: authUser.createdAt, banned: authUser.banned, banExpires: authUser.banExpires }).from(authUser).where(eq(authUser.id, voucher.userId));
  if (!account || accountSuspended(account)) return 'This member cannot be asked.';
  if (account.createdAt.getTime() > Date.now() - IDENTITY_VOUCHER_MIN_AGE_DAYS * DAY) return `Ask someone whose account is older than ${IDENTITY_VOUCHER_MIN_AGE_DAYS} days.`;
  if (kind === 'teacher') {
    const [teaches] = await tx
      .select({ id: teachingRelationship.id })
      .from(teachingRelationship)
      .where(and(eq(teachingRelationship.teacherPersonId, voucher.id), eq(teachingRelationship.studentPersonId, report.subjectPersonId), eq(teachingRelationship.status, 'verified')))
      .limit(1);
    if (teaches) return null;
    const [instructor] = await tx
      .select({ id: reviewCase.id })
      .from(reviewCase)
      .where(
        and(
          eq(reviewCase.personId, voucher.id),
          eq(reviewCase.kind, 'instructor_verification'),
          eq(reviewCase.status, 'resolved'),
          eq(reviewCase.resolution, 'approved'),
          or(isNull(reviewCase.openedByUserId), eq(reviewCase.openedByUserId, voucher.userId)),
        ),
      )
      .limit(1);
    return instructor ? null : 'This member is not a verified teacher of the profile or a verified instructor. Ask them as a member instead.';
  }
  const [student] = await tx
    .select({ id: teachingRelationship.id })
    .from(teachingRelationship)
    .where(and(eq(teachingRelationship.teacherPersonId, report.subjectPersonId), eq(teachingRelationship.studentPersonId, voucher.id)))
    .limit(1);
  if (student) return 'A student of the reported profile cannot vouch here: the account that holds it approved them.';
  const [link] = await tx
    .select({ id: teachingRelationship.id })
    .from(teachingRelationship)
    .where(
      and(
        or(eq(teachingRelationship.teacherPersonId, voucher.id), eq(teachingRelationship.studentPersonId, voucher.id)),
        eq(teachingRelationship.status, 'verified'),
        report.reportedUserId ? or(isNull(teachingRelationship.confirmedByUserId), ne(teachingRelationship.confirmedByUserId, report.reportedUserId)) : undefined,
      ),
    )
    .limit(1);
  return link ? null : 'This member has no verified teacher or student yet. Ask a member whose training is verified.';
}

/** identity.askVouch: one side asks someone to vouch for it. Asking the same person again changes nothing. */
export async function askIdentityVouch(principal: Principal | null, raw: z.input<typeof identityAskVouchInput>, meta: RequestMeta): Promise<{ id: string; replayed: boolean }> {
  const p = requireUser(principal);
  const parsed = identityAskVouchInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const slug = input.slug.replace(/^.*\/people\//, '').replace(/[/?#].*$/, '');
  return getDb().transaction(async (tx) => {
    const { c, report, side } = await provingSide(tx, p, input.caseId);
    const [voucher] = /^[a-z0-9-]{1,120}$/.test(slug)
      ? await tx.select({ id: person.id, userId: person.claimedByUserId }).from(person).where(and(eq(person.slug, slug), isNull(person.deletedAt), eq(person.stewardship, 'self')))
      : [];
    const field = (message: string) => new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { slug: message });
    if (!voucher?.userId) throw field('No member has this profile address.');
    if (voucher.id === report.subjectPersonId || voucher.userId === report.reporterUserId || voucher.userId === report.reportedUserId) throw field('Ask someone who is not part of this report.');
    const [earlier] = await tx.select({ id: identityVouch.id }).from(identityVouch).where(and(eq(identityVouch.reviewCaseId, c.id), eq(identityVouch.voucherUserId, voucher.userId)));
    if (earlier) return { id: earlier.id, replayed: true };
    const [asked] = await tx.select({ n: count() }).from(identityVouch).where(and(eq(identityVouch.reviewCaseId, c.id), eq(identityVouch.side, side)));
    if ((asked?.n ?? 0) >= IDENTITY_VOUCHES_PER_SIDE) throw new ServiceError('CONFLICT', `You have asked ${IDENTITY_VOUCHES_PER_SIDE} people already, the most for one report.`);
    const refusal = await voucherRefusal(tx, report, { id: voucher.id, userId: voucher.userId }, input.kind);
    if (refusal) throw field(refusal);
    const id = uuidv7();
    await tx.insert(identityVouch).values({ id, reviewCaseId: c.id, side, kind: input.kind, voucherUserId: voucher.userId, voucherPersonId: voucher.id, requestedByUserId: p.user.id, message: input.message });
    await tx.update(reviewCase).set({ updatedAt: new Date() }).where(eq(reviewCase.id, c.id));
    await notify(tx, voucher.userId, 'identity.vouch_asked', { vouchId: id }, { key: `identity-vouch:${id}` });
    await writeAudit(tx, {
      action: 'identity.vouch_ask',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'review_case',
      subjectId: c.id,
      after: { vouchId: id, side, kind: input.kind, voucherPersonId: voucher.id, messageLength: input.message?.length ?? 0 },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { id, replayed: false };
  });
}

// --- identityVouches.get / answer ----------------------------------------------------------------

export interface IdentityVouchQuestion {
  id: string;
  /** The profile the asking member says is theirs. */
  subject: PersonRef;
  kind: IdentityVouchKind;
  kindLabel: string;
  /** The asking member's own words. */
  message: string | null;
  askedAt: string;
  open: boolean;
  answer: IdentityVouchAnswer | null;
  answerLabel: string | null;
  note: string | null;
  answeredAt: string | null;
  answers: { value: IdentityVouchAnswer; label: string }[];
  noteMax: number;
}

async function ownVouch(db: Executor, p: Principal, id: string, lock = false) {
  const query = db
    .select({
      id: identityVouch.id,
      caseId: identityVouch.reviewCaseId,
      kind: identityVouch.kind,
      message: identityVouch.message,
      answer: identityVouch.answer,
      note: identityVouch.note,
      answeredAt: identityVouch.answeredAt,
      createdAt: identityVouch.createdAt,
      subjectPersonId: identityReport.subjectPersonId,
      reportStatus: identityReport.status,
      caseStatus: reviewCase.status,
      assignedTo: reviewCase.assignedToUserId,
    })
    .from(identityVouch)
    .innerJoin(identityReport, eq(identityReport.reviewCaseId, identityVouch.reviewCaseId))
    .innerJoin(reviewCase, eq(reviewCase.id, identityVouch.reviewCaseId))
    .where(and(eq(identityVouch.id, id), eq(identityVouch.voucherUserId, p.user.id)));
  const [row] = lock ? await query.for('update', { of: identityVouch }) : await query;
  return row ?? null;
}

async function vouchQuestion(row: NonNullable<Awaited<ReturnType<typeof ownVouch>>>): Promise<IdentityVouchQuestion> {
  return {
    id: row.id,
    subject: (await peopleRefs([row.subjectPersonId])).get(row.subjectPersonId)!,
    kind: row.kind,
    kindLabel: VOUCH_KIND_LABELS[row.kind],
    message: row.message,
    askedAt: row.createdAt.toISOString(),
    open: isOpenCase(row.caseStatus) && row.reportStatus === 'held',
    answer: row.answer,
    answerLabel: row.answer ? VOUCH_ANSWER_LABELS[row.answer] : null,
    note: row.note,
    answeredAt: row.answeredAt?.toISOString() ?? null,
    answers: IDENTITY_VOUCH_ANSWERS.map((value) => ({ value, label: VOUCH_ANSWER_LABELS[value] })),
    noteMax: IDENTITY_NOTE_MAX,
  };
}

const NO_VOUCH = () => new ServiceError('NOT_FOUND', 'No such question.');

/** identityVouches.get: the asked person's own question; 404 for anyone else, staff included. */
export async function getIdentityVouch(principal: Principal | null, raw: z.input<typeof identityVouchIdInput>): Promise<IdentityVouchQuestion> {
  const p = requireUser(principal);
  const parsed = identityVouchIdInput.safeParse(raw);
  if (!parsed.success) throw NO_VOUCH();
  const row = await ownVouch(getDb(), p, parsed.data.id);
  if (!row) throw NO_VOUCH();
  return vouchQuestion(row);
}

/** identityVouches.answer: the asked person answers once; the same answer again is a replay. */
export async function answerIdentityVouch(principal: Principal | null, raw: z.input<typeof identityVouchAnswerInput>, meta: RequestMeta): Promise<{ vouch: IdentityVouchQuestion; replayed: boolean }> {
  const p = requireUser(principal);
  const parsed = identityVouchAnswerInput.safeParse(raw);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === 'id')) throw NO_VOUCH();
    throw fieldErrors(parsed.error);
  }
  const input = parsed.data;
  const db = getDb();
  const replayed = await db.transaction(async (tx) => {
    const row = await ownVouch(tx, p, input.id, true);
    if (!row) throw NO_VOUCH();
    if (row.answer !== null) {
      if (row.answer === input.answer && row.note === input.note) return true;
      throw new ServiceError('CONFLICT', 'You already answered. Write to the WingChunRoots team if something changed.');
    }
    if (!isOpenCase(row.caseStatus) || row.reportStatus !== 'held') throw new ServiceError('CONFLICT', 'The administrators have closed this report, so it takes no answer now.');
    const now = new Date();
    await tx.update(identityVouch).set({ answer: input.answer, note: input.note, answeredAt: now, updatedAt: now }).where(eq(identityVouch.id, row.id));
    await tx.update(reviewCase).set({ updatedAt: now }).where(eq(reviewCase.id, row.caseId));
    if (row.assignedTo) await notify(tx, row.assignedTo, 'review.updated', { caseId: row.caseId, change: 'vouch' });
    await writeAudit(tx, {
      action: 'identity.vouch_answer',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'review_case',
      subjectId: row.caseId,
      after: { vouchId: row.id, answer: input.answer, noteLength: input.note?.length ?? 0 },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return false;
  });
  return { vouch: await vouchQuestion((await ownVouch(db, p, input.id))!), replayed };
}

// --- identity.addCode / confirmCode / checkCode -------------------------------------------------

const PUBLIC_CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const publicCode = () => `WCR-${Array.from({ length: 8 }, () => PUBLIC_CODE_LETTERS[randomInt(PUBLIC_CODE_LETTERS.length)]).join('')}`;
const mailCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
const codeHash = (codeId: string, code: string) => sha256(`identity-code:${codeId}:${code}`);

/** identity.addCode: a mailed code (email) or a public code to post (page). See the top of this file. */
export async function addIdentityCode(principal: Principal | null, raw: z.input<typeof identityAddCodeInput>, meta: RequestMeta): Promise<{ code: IdentityCodeView }> {
  const p = requireUser(principal);
  const parsed = identityAddCodeInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const field = (message: string) => new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { target: message });
  let address: string | null = null;
  let target: string;
  if (input.channel === 'email') {
    const email = z.email().safeParse(input.target.toLowerCase());
    if (!email.success) throw field('Enter an e-mail address.');
    address = email.data;
    target = address.slice(address.lastIndexOf('@') + 1);
    if (FREE_MAIL.test(target)) throw field('Use an address at your school’s own domain, not a free mail service.');
  } else {
    let page: URL;
    try {
      page = new URL(input.target);
    } catch {
      throw field('Enter the full address of the page, starting with https://.');
    }
    if (page.protocol !== 'https:' || page.username || page.password || page.port) throw field('Enter the full address of the page, starting with https://.');
    target = page.toString();
    if (target.length > IDENTITY_TARGET_MAX) throw field(`Use at most ${IDENTITY_TARGET_MAX} characters.`);
  }
  return getDb().transaction(async (tx) => {
    const { c, side } = await provingSide(tx, p, input.caseId);
    const [made] = await tx.select({ n: count() }).from(identityCode).where(and(eq(identityCode.reviewCaseId, c.id), eq(identityCode.side, side)));
    if ((made?.n ?? 0) >= IDENTITY_CODES_PER_SIDE) throw new ServiceError('CONFLICT', `You have asked for ${IDENTITY_CODES_PER_SIDE} codes already, the most for one report.`);
    const id = uuidv7();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + IDENTITY_CODE_DAYS * DAY);
    const code = input.channel === 'email' ? mailCode() : null;
    const [row] = await tx
      .insert(identityCode)
      .values({
        id,
        reviewCaseId: c.id,
        side,
        channel: input.channel,
        requestedByUserId: p.user.id,
        target,
        codeHash: code ? codeHash(id, code) : null,
        publicCode: code ? null : publicCode(),
        expiresAt,
      })
      .returning();
    if (code && address) {
      // Ids only in the key (mailer.ts checkIdempotencyKey); the code travels sealed.
      await queueEmail(tx, { template: 'identity-code', to: address, userId: null, idempotencyKey: `identity-code:${id}`, data: { code, domain: target, days: IDENTITY_CODE_DAYS } });
    }
    await writeAudit(tx, {
      action: 'identity.code_create',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'review_case',
      subjectId: c.id,
      after: { codeId: id, side, channel: input.channel },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { code: codeView({ ...row!, side }) };
  });
}

/** identity.confirmCode: the side types back the mailed code (at most five tries). */
export async function confirmIdentityCode(principal: Principal | null, raw: z.input<typeof identityConfirmCodeInput>, meta: RequestMeta): Promise<{ confirmed: boolean; attemptsLeft: number }> {
  const p = requireUser(principal);
  const parsed = identityConfirmCodeInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const outcome = await getDb().transaction(async (tx) => {
    const [code] = await tx.select().from(identityCode).where(eq(identityCode.id, input.codeId)).for('update');
    if (!code || code.channel !== 'email') throw new ServiceError('NOT_FOUND', 'No such code.');
    const { side } = await provingSide(tx, p, code.reviewCaseId);
    if (code.side !== side) throw new ServiceError('NOT_FOUND', 'No such code.');
    if (code.confirmedAt) return { confirmed: true, attemptsLeft: 0, changed: false };
    if (code.expiresAt.getTime() < Date.now()) throw new ServiceError('CONFLICT', 'This code has expired. Ask for a new one.');
    if (code.attempts >= IDENTITY_CODE_MAX_ATTEMPTS) throw new ServiceError('CONFLICT', 'This code was typed wrong too many times. Ask for a new one.');
    const expected = Buffer.from(code.codeHash ?? '', 'hex');
    const given = Buffer.from(codeHash(code.id, input.code), 'hex');
    const match = expected.length === given.length && timingSafeEqual(expected, given);
    const now = new Date();
    await tx
      .update(identityCode)
      .set(match ? { attempts: code.attempts + 1, confirmedAt: now, confirmedByUserId: p.user.id, updatedAt: now } : { attempts: code.attempts + 1, updatedAt: now })
      .where(eq(identityCode.id, code.id));
    if (match) {
      await writeAudit(tx, {
        action: 'identity.code_confirm',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'review_case',
        subjectId: code.reviewCaseId,
        after: { codeId: code.id, channel: 'email' },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
    }
    return { confirmed: match, attemptsLeft: Math.max(0, IDENTITY_CODE_MAX_ATTEMPTS - code.attempts - 1), changed: true };
  });
  if (!outcome.confirmed && outcome.changed) {
    throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', {
      code: outcome.attemptsLeft > 0 ? `This is not the code of the e-mail. ${outcome.attemptsLeft} tries left.` : 'This is not the code of the e-mail. Ask for a new one.',
    });
  }
  return { confirmed: outcome.confirmed, attemptsLeft: outcome.attemptsLeft };
}

/** identity.checkCode: an administrator saw the public code on the page (an admin with the second factor, not a side). */
export async function checkIdentityPageCode(principal: Principal | null, raw: z.input<typeof identityCheckCodeInput>, meta: RequestMeta): Promise<{ confirmed: true; replayed: boolean }> {
  const p = requireStaff2FA(principal, ['admin']);
  const parsed = identityCheckCodeInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', 'No such code.');
  return getDb().transaction(async (tx) => {
    const [code] = await tx.select().from(identityCode).where(eq(identityCode.id, parsed.data.codeId)).for('update');
    if (!code || code.channel !== 'page') throw new ServiceError('NOT_FOUND', 'No such code.');
    const c = await caseById(tx, code.reviewCaseId, true);
    if (!c) throw new ServiceError('NOT_FOUND', 'No such code.');
    if (await ownSide(tx, p, c)) throw new ServiceError('FORBIDDEN', 'This case is about you: another administrator checks it.');
    if (code.confirmedAt) return { confirmed: true as const, replayed: true };
    if (!isOpenCase(c.status)) throw new ServiceError('CONFLICT', 'This case has been decided or closed.');
    const now = new Date();
    await tx.update(identityCode).set({ confirmedAt: now, confirmedByUserId: p.user.id, updatedAt: now }).where(eq(identityCode.id, code.id));
    await tx.update(reviewCase).set({ updatedAt: now }).where(eq(reviewCase.id, c.id));
    await writeAudit(tx, {
      action: 'identity.code_confirm',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'review_case',
      subjectId: c.id,
      after: { codeId: code.id, channel: 'page' },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { confirmed: true as const, replayed: false };
  });
}

// --- The case card (review.get) -------------------------------------------------------------------

export interface IdentityProofSummary {
  /** Decision 6: one verified teacher said yes, or two verified members said yes. */
  vouching: string;
  channel: string;
  files: number;
  /** The same in numbers, for the control panel's own words (ADR 0043). */
  counts: { asked: number; answered: number; teachersYes: number; peersYes: number; independent: boolean; noes: number; codes: number; confirmedCodes: number };
}

export interface IdentityCaseView {
  type: IdentityReportType;
  typeLabel: string;
  route: IdentityRoute;
  routeLabel: string;
  status: ReportRow['status'];
  statusLabel: string;
  heldAt: string | null;
  proofDueAt: string | null;
  holdUntil: string | null;
  sides: Record<IdentitySide, { proof: IdentityProofSummary; vouches: (IdentityVouchView & { message: string | null; note: string | null })[]; codes: IdentityCodeView[] }>;
  /** The reporter has a profile of their own now (an impostor report cannot move the profile then). */
  reporterHasProfile: boolean;
  /** The account that holds the profile is suspended already. */
  reportedSuspended: boolean;
  can: { triage: boolean; checkCode: boolean };
}

/** Whether two members share no verified teacher and are not teacher and student (decision 6, "different schools"). */
async function independentPeers(db: Executor, a: string, b: string): Promise<boolean> {
  const result = await db.execute<{ shared: boolean }>(sql`
SELECT EXISTS (
  SELECT 1 FROM teaching_relationship x JOIN teaching_relationship y ON y.teacher_person_id = x.teacher_person_id
   WHERE x.student_person_id = ${a}::uuid AND y.student_person_id = ${b}::uuid AND x.status = 'verified' AND y.status = 'verified'
) OR EXISTS (
  SELECT 1 FROM teaching_relationship r
   WHERE r.status IN ('verified', 'in_arbitration')
     AND ((r.teacher_person_id = ${a}::uuid AND r.student_person_id = ${b}::uuid) OR (r.teacher_person_id = ${b}::uuid AND r.student_person_id = ${a}::uuid))
) AS shared`);
  return result.rows[0]?.shared !== true;
}

async function proofOf(db: Executor, caseId: string, side: IdentitySide, vouches: { kind: IdentityVouchKind; answer: IdentityVouchAnswer | null; voucherPersonId: string }[], codes: { confirmedAt: Date | null; channel: string }[], uploader: string | null): Promise<IdentityProofSummary> {
  const teachers = vouches.filter((v) => v.kind === 'teacher' && v.answer === 'yes').length;
  const peers = vouches.filter((v) => v.kind === 'peer' && v.answer === 'yes');
  let independent = false;
  for (let i = 0; i < peers.length && !independent; i++) for (let j = i + 1; j < peers.length && !independent; j++) independent = await independentPeers(db, peers[i]!.voucherPersonId, peers[j]!.voucherPersonId);
  const noes = vouches.filter((v) => v.answer === 'no').length;
  const vouching =
    teachers > 0
      ? `Enough: ${teachers} verified teacher${teachers > 1 ? 's' : ''} said yes`
      : independent
        ? `Enough: ${peers.length} verified members said yes, from different schools`
        : peers.length > 1
          ? `Not enough yet: ${peers.length} members said yes, but they share a teacher`
          : vouches.length > 0
            ? `Not enough yet: ${vouches.filter((v) => v.answer !== null).length} of ${vouches.length} answered`
            : 'Nobody asked yet';
  const confirmed = codes.filter((c) => c.confirmedAt).length;
  const [files] = uploader
    ? await db
        .select({ n: count() })
        .from(evidenceLink)
        .innerJoin(evidenceFile, and(eq(evidenceFile.id, evidenceLink.evidenceFileId), isNull(evidenceFile.deletedAt)))
        .where(and(eq(evidenceLink.reviewCaseId, caseId), eq(evidenceFile.uploadedByUserId, uploader)))
    : [];
  void side;
  return {
    vouching: noes > 0 ? `${vouching} · ${noes} said no` : vouching,
    channel: confirmed > 0 ? `Confirmed (${confirmed})` : codes.length > 0 ? 'Asked, not confirmed yet' : 'None',
    files: files?.n ?? 0,
    counts: { asked: vouches.length, answered: vouches.filter((v) => v.answer !== null).length, teachersYes: teachers, peersYes: peers.length, independent, noes, codes: codes.length, confirmedCodes: confirmed },
  };
}

/** The identity part of the case card, for staff who are no side of it; null for any other kind. */
export async function identityCaseView(db: Executor, p: Principal, c: CaseRow, own: boolean): Promise<IdentityCaseView | null> {
  if (c.kind !== 'identity_report' || own) return null;
  const report = await reportOfCase(db, c.id);
  if (!report) return null;
  const vouches = await vouchesOf(db, c.id);
  const codes = await codesOf(db, c.id);
  const sides = {} as IdentityCaseView['sides'];
  for (const side of ['reporter', 'reported'] as const) {
    const mine = vouches.filter((v) => v.side === side);
    const myCodes = codes.filter((x) => x.side === side);
    sides[side] = {
      proof: await proofOf(db, c.id, side, mine, myCodes, side === 'reporter' ? report.reporterUserId : report.reportedUserId),
      vouches: mine.map((v) => ({
        id: v.id,
        kind: v.kind,
        kindLabel: VOUCH_KIND_LABELS[v.kind],
        voucher: v.voucher,
        askedAt: v.createdAt.toISOString(),
        answer: v.answer,
        answerLabel: v.answer ? VOUCH_ANSWER_LABELS[v.answer] : null,
        answeredAt: v.answeredAt?.toISOString() ?? null,
        message: v.message,
        note: v.note,
      })),
      codes: myCodes.map(codeView),
    };
  }
  const [reporterOwn] = report.reporterUserId ? await db.select({ id: person.id }).from(person).where(and(eq(person.claimedByUserId, report.reporterUserId), isNull(person.deletedAt))) : [];
  const [reported] = report.reportedUserId ? await db.select({ banned: authUser.banned, banExpires: authUser.banExpires }).from(authUser).where(eq(authUser.id, report.reportedUserId)) : [];
  const open = isOpenCase(c.status);
  return {
    type: report.type,
    typeLabel: report.type === 'impostor' ? 'Impostor: the reporter has no profile and says this one is theirs' : 'Duplicate: the reporter has their own profile and says this one copies it',
    route: report.route,
    routeLabel: routeLabel(report.route),
    status: report.status,
    statusLabel: REPORT_STATUS_LABELS[report.status] ?? report.status,
    heldAt: report.heldAt?.toISOString() ?? null,
    proofDueAt: report.proofDueAt?.toISOString() ?? null,
    holdUntil: report.holdUntil?.toISOString() ?? null,
    sides,
    reporterHasProfile: Boolean(reporterOwn) && report.type === 'impostor',
    reportedSuspended: reported ? accountSuspended(reported) : false,
    can: {
      triage: open && report.status === 'open' && hasStaff2FA(p, ['moderator', 'admin']),
      checkCode: open && hasStaff2FA(p, ['admin']),
    },
  };
}

/** The facts of the case card's subject block. */
export async function identityFacts(db: Executor, caseId: string): Promise<{ label: string; value: string }[]> {
  const report = await reportOfCase(db, caseId);
  if (!report) return [];
  return [
    { label: 'Report', value: report.type === 'impostor' ? 'Impostor' : 'Duplicate profile' },
    { label: 'Proof route', value: routeLabel(report.route) },
    { label: 'Status', value: REPORT_STATUS_LABELS[report.status] ?? report.status },
  ];
}

// --- review.decide (an administrator) -----------------------------------------------------------

/** Marks the case's videos for deletion 30 days after the decision (decision 7). */
async function scheduleVideoPurge(tx: Transaction, caseId: string, now: Date): Promise<number> {
  const due = new Date(now.getTime() + IDENTITY_VIDEO_KEEP_DAYS * DAY);
  const rows = await tx
    .update(evidenceFile)
    .set({ purgeAfter: due })
    .where(
      and(
        sql`${evidenceFile.mime} LIKE 'video/%'`,
        isNull(evidenceFile.deletedAt),
        isNull(evidenceFile.purgeAfter),
        sql`EXISTS (SELECT 1 FROM evidence_link l WHERE l.evidence_file_id = ${evidenceFile.id} AND l.review_case_id = ${caseId}::uuid)`,
      ),
    )
    .returning({ id: evidenceFile.id });
  return rows.length;
}

export interface IdentityDecisionInput extends KindDecisionInput {
  /** verify only: also suspend the account that held the profile (decision 5; the form suggests it). */
  suspend?: boolean;
  /** reject only: "could not be settled" rather than "not upheld" (the reporter may refile in 30 days). */
  unsettled?: boolean;
}

export interface IdentityDecisionOutcome extends KindDecisionOutcome {
  /** Photo files to delete after the commit. */
  photos: { id: string; storageKey: string }[];
}

/**
 * Moves the impostor's profile to the reporter (decision 4): the record's account changes, the
 * links its teacher side approved go back to pending (history kept), the photos the other account
 * added are removed, and a teaching record makes the new owner a Sifu as a claim would.
 */
async function transfer(tx: Transaction, p: Principal, c: CaseRow, report: ReportRow, meta: RequestMeta) {
  if (!report.reporterUserId) throw new ServiceError('CONFLICT', 'The reporter’s account is gone: refuse the report instead.');
  const [record] = await tx.select({ claimedBy: person.claimedByUserId, photoId: person.photoId }).from(person).where(eq(person.id, report.subjectPersonId)).for('update');
  if (!record || record.claimedBy !== report.reportedUserId) throw new ServiceError('CONFLICT', 'The profile has changed hands since the report: refuse it, or ask the reporter about it.');
  const [own] = await tx.select({ id: person.id }).from(person).where(and(eq(person.claimedByUserId, report.reporterUserId), isNull(person.deletedAt)));
  if (own) throw new ServiceError('CONFLICT', 'The reporter has a profile of their own now. Refuse this report, or ask them about it.');
  const [reporter] = await tx.select({ banned: authUser.banned, banExpires: authUser.banExpires }).from(authUser).where(eq(authUser.id, report.reporterUserId));
  if (!reporter || accountSuspended(reporter)) throw new ServiceError('CONFLICT', 'The reporter’s account is suspended: the profile cannot move to it.');
  const now = new Date();
  const [teaches] = await tx.select({ n: count() }).from(teachingRelationship).where(and(eq(teachingRelationship.teacherPersonId, report.subjectPersonId), eq(teachingRelationship.status, 'verified')));
  await tx.update(person).set({ claimedByUserId: report.reporterUserId, identityHoldAt: null, updatedAt: now }).where(eq(person.id, report.subjectPersonId));
  // The students the other account approved: back to the teacher's answer, now the real person's.
  const approved = report.reportedUserId
    ? await tx
        .select({ id: teachingRelationship.id, status: teachingRelationship.status, lineageId: teachingRelationship.lineageId })
        .from(teachingRelationship)
        .where(and(eq(teachingRelationship.teacherPersonId, report.subjectPersonId), eq(teachingRelationship.confirmedByUserId, report.reportedUserId), eq(teachingRelationship.status, 'verified')))
        .for('update')
    : [];
  for (const row of approved) {
    await tx
      .update(teachingRelationship)
      .set({ status: 'pending_teacher', visibility: 'involved_only', isDisplayPrimary: false, confirmedByUserId: null, confirmedAt: null, statusReason: 'identity_transfer', updatedAt: now })
      .where(eq(teachingRelationship.id, row.id));
    await tx.insert(relationshipEvent).values({ relationshipId: row.id, fromStatus: row.status, toStatus: 'pending_teacher', actorUserId: p.user.id, actorRole: p.user.role, reason: 'identity_transfer' });
  }
  const lineageIds = [...new Set(approved.map((r) => r.lineageId))];
  if (lineageIds.length > 0) await enqueue(tx, QUEUE.lineageRecompute, { lineageIds });
  // The photos the other account added go; the text stays for the new owner to review.
  const photos = report.reportedUserId
    ? await tx
        .update(personPhoto)
        .set({ status: 'removed', removedAt: now, removedByUserId: p.user.id, removalReason: 'Impersonation report upheld', updatedAt: now })
        .where(and(eq(personPhoto.personId, report.subjectPersonId), eq(personPhoto.uploadedByUserId, report.reportedUserId), inArray(personPhoto.status, ['active', 'gallery'])))
        .returning({ id: personPhoto.id, storageKey: personPhoto.storageKey })
    : [];
  if (record.photoId && photos.some((ph) => ph.id === record.photoId)) await tx.update(person).set({ photoId: null }).where(eq(person.id, report.subjectPersonId));
  const sifu = (teaches?.n ?? 0) > 0 ? await sifuOnClaim(tx, p, report.reporterUserId, c.id, meta) : false;
  await writeAudit(tx, {
    action: 'identity.transfer',
    actorUserId: p.user.id,
    actorRole: p.user.role,
    subjectType: 'person',
    subjectId: report.subjectPersonId,
    before: { claimedByUserId: report.reportedUserId },
    after: { claimedByUserId: report.reporterUserId, caseId: c.id, relationshipsReturned: approved.length, photosRemoved: photos.length, sifu },
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
  return { relationshipsReturned: approved.length, photos };
}

/** The decision on an identity report (review-core.ts DECIDERS: an administrator), from review.decide. */
export async function decideIdentityReport(tx: Transaction, p: Principal, c: CaseRow, input: IdentityDecisionInput, meta: RequestMeta): Promise<IdentityDecisionOutcome> {
  const report = await reportOfCase(tx, c.id, true);
  if (!report) throw caseNotFound();
  if (report.status !== 'held') throw new ServiceError('CONFLICT', 'A moderator checks a report and puts the profile on hold before an administrator decides it.');
  const now = new Date();
  if (input.decision === 'needs_info') {
    await askParties(tx, p, c, input, meta);
    for (const [userId] of [[report.reporterUserId], [report.reportedUserId]] as const) if (userId) await notify(tx, userId, 'case.question', { caseId: c.id }, { key: `case-question:${c.id}:${input.idempotencyKey}` });
    return { tags: [], photos: [] };
  }
  if (input.decision === 'reject') {
    const status = input.unsettled ? 'unsettled' : 'dismissed';
    await resolveCase(tx, p, c, input, 'rejected', meta);
    const tags = await releaseHold(tx, report);
    await tx.update(identityReport).set({ status, decidedAt: now, outcome: { status }, updatedAt: now }).where(eq(identityReport.id, report.id));
    await scheduleVideoPurge(tx, c.id, now);
    await writeAudit(tx, {
      action: 'identity.decide',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'review_case',
      subjectId: c.id,
      before: { status: 'held' },
      after: { status, personId: report.subjectPersonId },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    await tellSide(tx, report.reporterUserId, c.id, status, 'reporter');
    await tellSide(tx, report.reportedUserId, c.id, status, 'reported');
    return { tags, photos: [] };
  }
  // Upheld.
  if (input.suspend && input.reason && input.reason.length > SUSPENSION_REASON_MAX) {
    throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { reason: `Use at most ${SUSPENSION_REASON_MAX} characters when the account is suspended too.` });
  }
  await resolveCase(tx, p, c, input, 'approved', meta);
  let outcome: Record<string, unknown>;
  let tags: string[];
  let photos: { id: string; storageKey: string }[] = [];
  if (report.type === 'impostor') {
    const moved = await transfer(tx, p, c, report, meta);
    photos = moved.photos;
    tags = await neighbourTags(tx, report.subjectPersonId);
    outcome = { profileMoved: true, relationshipsReturned: moved.relationshipsReturned, photosRemoved: photos.length };
  } else {
    if (!input.reason) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { reason: 'Write the reason the copy’s owner will read.' });
    const taken = await applyTakeDown(tx, p, { personId: report.subjectPersonId, reason: input.reason, caseId: c.id }, meta);
    tags = [...taken.tags, ...(await releaseHold(tx, report))];
    outcome = { takenDown: true };
  }
  let suspended = false;
  if (input.suspend && report.reportedUserId) {
    const [account] = await tx.select({ banned: authUser.banned, banExpires: authUser.banExpires }).from(authUser).where(eq(authUser.id, report.reportedUserId));
    if (account && !accountSuspended(account)) {
      await applySuspension(tx, p, { userId: report.reportedUserId, email: null, reason: input.reason ?? 'Impersonation report upheld.', until: null }, meta);
      suspended = true;
    }
  }
  outcome = { ...outcome, suspended };
  await tx.update(identityReport).set({ status: 'upheld', decidedAt: now, outcome, updatedAt: now }).where(eq(identityReport.id, report.id));
  await scheduleVideoPurge(tx, c.id, now);
  await writeAudit(tx, {
    action: 'identity.decide',
    actorUserId: p.user.id,
    actorRole: p.user.role,
    subjectType: 'review_case',
    subjectId: c.id,
    before: { status: 'held' },
    after: { status: 'upheld', type: report.type, personId: report.subjectPersonId, ...outcome },
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
  await tellSide(tx, report.reporterUserId, c.id, 'upheld', 'reporter');
  await tellSide(tx, report.reportedUserId, c.id, 'upheld', 'reported');
  return { tags, photos };
}

// --- The daily sweep (jobs/worker.ts retention) ---------------------------------------------------

/**
 * The daily sweep of impersonation reports: a held report whose proof is overdue and whose
 * reporter sent none closes as unsettled; a hold past its 30 days lifts (the report still waits for
 * a decision, and the administrators are told). Returns the counts and the cache tags to drop.
 */
export async function sweepIdentityReports(db: ReturnType<typeof getDb>, now: Date = new Date()): Promise<{ closed: number; lifted: number; tags: string[] }> {
  const tags: string[] = [];
  let closed = 0;
  let lifted = 0;
  const overdue = await db
    .select({ caseId: identityReport.reviewCaseId })
    .from(identityReport)
    .where(and(eq(identityReport.status, 'held'), eq(identityReport.type, 'impostor'), sql`${identityReport.proofDueAt} < ${now}`))
    .limit(200);
  for (const { caseId } of overdue) {
    await db.transaction(async (tx) => {
      const c = await caseById(tx, caseId, true);
      const report = await reportOfCase(tx, caseId, true);
      if (!c || !report || report.status !== 'held' || !isOpenCase(c.status) || !report.reporterUserId) return;
      const [vouched] = await tx.select({ n: count() }).from(identityVouch).where(and(eq(identityVouch.reviewCaseId, caseId), eq(identityVouch.side, 'reporter'), isNotNull(identityVouch.answeredAt)));
      const [coded] = await tx.select({ n: count() }).from(identityCode).where(and(eq(identityCode.reviewCaseId, caseId), eq(identityCode.side, 'reporter'), isNotNull(identityCode.confirmedAt)));
      const [filed] = await tx
        .select({ n: count() })
        .from(evidenceLink)
        .innerJoin(evidenceFile, and(eq(evidenceFile.id, evidenceLink.evidenceFileId), isNull(evidenceFile.deletedAt)))
        .where(and(eq(evidenceLink.reviewCaseId, caseId), eq(evidenceFile.uploadedByUserId, report.reporterUserId)));
      if ((vouched?.n ?? 0) + (coded?.n ?? 0) + (filed?.n ?? 0) > 0) return;
      const reason = `No proof arrived within ${IDENTITY_PROOF_DAYS} days, so the report closed on its own.`;
      await tx.update(reviewCase).set({ status: 'resolved', resolution: 'rejected', resolutionReason: reason, resolvedAt: now, updatedAt: now }).where(eq(reviewCase.id, caseId));
      await tx.insert(reviewEvent).values({ reviewCaseId: caseId, action: 'reject', fromStatus: c.status, toStatus: 'resolved', actorUserId: null, actorRole: 'system' });
      tags.push(...(await releaseHold(tx, report)));
      await tx.update(identityReport).set({ status: 'unsettled', decidedAt: now, outcome: { status: 'unsettled', proofOverdue: true }, updatedAt: now }).where(eq(identityReport.id, report.id));
      await scheduleVideoPurge(tx, caseId, now);
      await writeAudit(tx, {
        action: 'identity.decide',
        actorUserId: null,
        actorRole: 'system',
        subjectType: 'review_case',
        subjectId: caseId,
        before: { status: 'held' },
        after: { status: 'unsettled', proofOverdue: true, personId: report.subjectPersonId },
      });
      await tellSide(tx, report.reporterUserId, caseId, 'unsettled', 'reporter');
      await tellSide(tx, report.reportedUserId, caseId, 'unsettled', 'reported');
      closed++;
    });
  }
  const expired = await db
    .select({ caseId: identityReport.reviewCaseId })
    .from(identityReport)
    .innerJoin(person, and(eq(person.id, identityReport.subjectPersonId), isNotNull(person.identityHoldAt)))
    .where(and(eq(identityReport.status, 'held'), sql`${identityReport.holdUntil} < ${now}`))
    .limit(200);
  for (const { caseId } of expired) {
    await db.transaction(async (tx) => {
      const report = await reportOfCase(tx, caseId, true);
      if (!report || report.status !== 'held' || !report.holdUntil || report.holdUntil >= now) return;
      // Every held report of the profile ran out, or the hold stays for the other one.
      const [other] = await tx
        .select({ id: identityReport.id })
        .from(identityReport)
        .where(and(eq(identityReport.subjectPersonId, report.subjectPersonId), eq(identityReport.status, 'held'), ne(identityReport.id, report.id), sql`${identityReport.holdUntil} >= ${now}`));
      if (other) return;
      const [row] = await tx.select({ held: person.identityHoldAt }).from(person).where(eq(person.id, report.subjectPersonId)).for('update');
      if (!row?.held) return;
      await tx.update(person).set({ identityHoldAt: null, updatedAt: now }).where(eq(person.id, report.subjectPersonId));
      tags.push(...(await neighbourTags(tx, report.subjectPersonId)));
      const [held] = await tx.select({ status: reviewCase.status }).from(reviewCase).where(eq(reviewCase.id, caseId));
      if (held) await tx.insert(reviewEvent).values({ reviewCaseId: caseId, action: 'release', fromStatus: held.status, toStatus: held.status, actorUserId: null, actorRole: 'system' });
      await writeAudit(tx, { action: 'identity.release', actorUserId: null, actorRole: 'system', subjectType: 'person', subjectId: report.subjectPersonId, after: { caseId, held: false } });
      await tellSide(tx, report.reportedUserId, caseId, 'hold_lifted', 'reported');
      await notifyEach(tx, await staffToTell(tx, ['admin'], [report.reporterUserId, report.reportedUserId]), 'review.updated', { caseId, change: 'hold_lifted' });
      lifted++;
    });
  }
  return { closed, lifted, tags };
}

/**
 * Deletes the videos of decided impersonation reports 30 days after the decision (decision 7):
 * the object from the private store, then the row marked deleted, audited as evidence.purge. An
 * object the store would not delete stays for the next run.
 */
export async function purgeIdentityVideos(db: ReturnType<typeof getDb>, store: ObjectStore = getEvidenceStore(), now: Date = new Date()): Promise<{ files: number; failed: number }> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: evidenceFile.id, storageKey: evidenceFile.storageKey })
      .from(evidenceFile)
      .where(and(isNull(evidenceFile.deletedAt), isNotNull(evidenceFile.purgeAfter), sql`${evidenceFile.purgeAfter} <= ${now}`))
      .orderBy(asc(evidenceFile.purgeAfter))
      .limit(100)
      .for('update', { skipLocked: true });
    let files = 0;
    let failed = 0;
    for (const f of due) {
      try {
        await store.delete(f.storageKey);
      } catch {
        failed++;
        continue;
      }
      await tx.update(evidenceFile).set({ deletedAt: now, originalName: null, originalSha256: null, updatedAt: now }).where(eq(evidenceFile.id, f.id));
      await writeAudit(tx, { action: 'evidence.purge', actorUserId: null, actorRole: 'system', subjectType: 'evidence_file', subjectId: f.id, after: { reason: 'impersonation report video, 30 days after the decision' } });
      files++;
    }
    return { files, failed };
  });
}
