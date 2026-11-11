// Lineage disputes and appeals (milestone M25, In scope 2; specification §16.1;
// docs/adr/0028-governance.md).
//
//   disputes.report   a signed-in account reports that a public, verified teaching relationship is
//                     wrong, with grounds, details and at least one file of evidence: a review_case
//                     of kind lineage_report. Nothing changes on the accusation: the relationship
//                     stays as it is until a moderator upholds the report (it is then set in
//                     arbitration, shown neutrally as "Disputed", in words) or does not (with a
//                     reason; a report that is not upheld counts against no one). The two people
//                     of the relationship never learn who reported.
//   disputes.relationships
//                     the public relationships of a profile that may be reported (the form)
//   appeals.create    one appeal per decision, by a party of the decided case, within
//                     APPEAL_WINDOW_DAYS: a review_case of kind decision_appeal, decided by another
//                     member of staff than the one who decided (governance-review.ts)
//
// Rate limits (DEFAULT M25, question 5): GOVERNANCE_DAILY_LIMIT reports and appeals a day per
// account, counted under the account's case lock; one open report per account and relationship.
// Logs and audit rows carry ids and codes, never a party's words.

import { and, count, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { decisionAppeal, lineage, lineageReport, person, reviewCase, reviewEvent, reviewNote, teachingRelationship } from '../db/schema';
import { APPEAL_WINDOW_DAYS, APPEALABLE_KINDS, GOVERNANCE_DAILY_LIMIT, GOVERNANCE_TEXT_MAX, LINEAGE_REPORT_GROUNDS } from '../db/schema/common';
import type { Executor } from '../entitlements/access';
import { LINEAGE_REPORT_GROUND_LABELS, REVIEW_KIND_LABELS } from '../templates/review';
import type { RequestMeta } from './context';
import { peopleRefs, type PersonRef } from './dashboard';
import { pgErrorOf, ServiceError } from './errors';
import { linkFilesToCase } from './evidence';
import { fieldErrors, idempotencyKey, keyReused, rowById } from './relationships';
import { type CaseRow, caseById, caseNotFound, caseReplayOf, isCaseKeyConflict, lockAccountCases, recordCaseEvent, tellStaff } from './review-core';

export type LineageReportGrounds = (typeof LINEAGE_REPORT_GROUNDS)[number];
export type AppealableKind = (typeof APPEALABLE_KINDS)[number];


const text = (empty: string) =>
  z
    .string({ error: empty })
    .max(GOVERNANCE_TEXT_MAX * 2, { error: `Use at most ${GOVERNANCE_TEXT_MAX} characters.` })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .refine((s) => s.length > 0, { error: empty })
    .refine((s) => s.length <= GOVERNANCE_TEXT_MAX, { error: `Use at most ${GOVERNANCE_TEXT_MAX} characters.` });

export const lineageReportInput = z.object({
  relationshipId: z.uuid({ error: 'Choose the relationship you report.' }),
  grounds: z.enum(LINEAGE_REPORT_GROUNDS, { error: 'Choose what is wrong.' }),
  details: text('Write what is wrong and what your evidence shows.'),
  evidenceIds: z.array(z.uuid({ error: 'Attach at least one file of evidence.' })).max(20).default([]),
  idempotencyKey,
});

export const disputeSlugInput = z.object({ slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/, { error: 'No such profile.' }) });

export const appealInput = z.object({
  caseId: z.uuid({ error: 'No such case.' }),
  grounds: text('Write why the decision should be looked at again.'),
  idempotencyKey,
});

const dailyLimit = async (db: Executor, table: typeof lineageReport | typeof decisionAppeal, userId: string) => {
  const column = table === lineageReport ? lineageReport.reporterUserId : decisionAppeal.appellantUserId;
  const created = table === lineageReport ? lineageReport.createdAt : decisionAppeal.createdAt;
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(table).where(and(eq(column, userId), gt(created, sql`now() - interval '24 hours'`)));
  return n;
};

// --- disputes.relationships ---------------------------------------------------------------------------

export interface ReportableRelationship {
  id: string;
  role: 'teacher' | 'student';
  other: PersonRef;
  lineageName: string;
  status: 'verified' | 'in_arbitration';
  /** This account has an open report about it. */
  reported: boolean;
}

/** disputes.relationships: a public profile's public relationships, for the report form. */
export async function reportableRelationships(principal: Principal | null, raw: z.input<typeof disputeSlugInput>): Promise<{ personId: string; slug: string; relationships: ReportableRelationship[] }> {
  const p = requireUser(principal);
  const parsed = disputeSlugInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', 'No such profile.');
  const db = getDb();
  const [subject] = await db.select({ id: person.id, slug: person.slug }).from(person).where(and(eq(person.slug, parsed.data.slug), eq(person.visibility, 'public'), isNull(person.deletedAt)));
  if (!subject) throw new ServiceError('NOT_FOUND', 'No such profile.');
  const rows = await db
    .select({ id: teachingRelationship.id, teacher: teachingRelationship.teacherPersonId, student: teachingRelationship.studentPersonId, lineageName: lineage.name, status: teachingRelationship.status })
    .from(teachingRelationship)
    .innerJoin(lineage, eq(lineage.id, teachingRelationship.lineageId))
    .where(
      and(
        sql`${subject.id}::uuid IN (${teachingRelationship.teacherPersonId}, ${teachingRelationship.studentPersonId})`,
        eq(teachingRelationship.visibility, 'public'),
        inArray(teachingRelationship.status, ['verified', 'in_arbitration']),
      ),
    )
    .limit(200);
  const others = rows.map((r) => (r.teacher === subject.id ? r.student : r.teacher));
  const refs = await peopleRefs([...new Set(others)]);
  const open = await db
    .select({ relationshipId: lineageReport.relationshipId })
    .from(lineageReport)
    .where(and(eq(lineageReport.reporterUserId, p.user.id), eq(lineageReport.status, 'open')));
  const reported = new Set(open.map((o) => o.relationshipId));
  return {
    personId: subject.id,
    slug: subject.slug,
    relationships: rows
      .filter((r) => {
        const ref = refs.get(r.teacher === subject.id ? r.student : r.teacher);
        // Only relationships whose other side is public too (v_public_edge shows the same).
        return ref && !ref.removed;
      })
      .map((r) => ({
        id: r.id,
        role: r.teacher === subject.id ? ('teacher' as const) : ('student' as const),
        other: refs.get(r.teacher === subject.id ? r.student : r.teacher)!,
        lineageName: r.lineageName,
        status: r.status as 'verified' | 'in_arbitration',
        reported: reported.has(r.id),
      })),
  };
}

// --- disputes.report ------------------------------------------------------------------------------------

/** disputes.report: an evidence-based lineage dispute report (see the top). It changes nothing by itself. */
export async function reportLineage(principal: Principal | null, raw: z.input<typeof lineageReportInput>, meta: RequestMeta): Promise<{ caseId: string; replayed: boolean }> {
  const p = requireUser(principal);
  const parsed = lineageReportInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      await lockAccountCases(tx, p.user.id);
      const replay = await caseReplayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        if (replay.action !== 'open') throw keyReused();
        return { caseId: replay.caseId, replayed: true };
      }
      // A share lock: the report reads the relationship, it never changes it.
      const row = await rowById(tx, input.relationshipId);
      if (!row || row.visibility !== 'public' || (row.status !== 'verified' && row.status !== 'in_arbitration')) throw new ServiceError('NOT_FOUND', 'No such relationship.');
      if (row.status === 'in_arbitration') throw new ServiceError('CONFLICT', 'This relationship is already in arbitration. The moderators are reviewing it.');
      const [open] = await tx.select({ id: lineageReport.id }).from(lineageReport).where(and(eq(lineageReport.reporterUserId, p.user.id), eq(lineageReport.relationshipId, row.id), eq(lineageReport.status, 'open')));
      if (open) throw new ServiceError('CONFLICT', 'You have reported this relationship already. The moderators have your report.');
      if ((await dailyLimit(tx, lineageReport, p.user.id)) >= GOVERNANCE_DAILY_LIMIT) throw new ServiceError('TOO_MANY_REQUESTS', 'You have sent several reports today. You can send another one tomorrow.');
      const caseId = uuidv7();
      // No relationship on the case: the reported people are not its parties and never read it.
      await tx.insert(reviewCase).values({ id: caseId, kind: 'lineage_report', status: 'open', openedByUserId: p.user.id });
      const evidenceError = await linkFilesToCase(tx, p.user.id, caseId, input.evidenceIds);
      if (evidenceError) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { evidenceIds: evidenceError });
      await tx.insert(reviewNote).values({ reviewCaseId: caseId, authorUserId: p.user.id, body: input.details, isInternal: false });
      await tx.insert(lineageReport).values({ relationshipId: row.id, reporterUserId: p.user.id, reviewCaseId: caseId, grounds: input.grounds, status: 'open' });
      await recordCaseEvent(tx, { caseId, action: 'open', from: null, to: 'open', actor: p, key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'dispute.report',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'teaching_relationship',
        subjectId: row.id,
        // The relationship's status is unchanged: the audit says so.
        before: { status: row.status },
        after: { status: row.status, caseId, grounds: input.grounds },
        evidenceIds: input.evidenceIds,
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      await tellStaff(tx, caseId, 'lineage_report', [p.user.id]);
      return { caseId, replayed: false };
    });
  } catch (error) {
    if (isCaseKeyConflict(error)) throw keyReused();
    const pg = pgErrorOf(error);
    if (pg?.code === '23505' && pg.constraint === 'lineage_report_one_open_key') throw new ServiceError('CONFLICT', 'You have reported this relationship already. The moderators have your report.');
    throw error;
  }
}

/** For the report's case card: the relationship, the grounds and its state now. */
export async function lineageReportFacts(db: Executor, caseId: string): Promise<{ facts: { label: string; value: string }[]; relationshipId: string | null } | null> {
  const [r] = await db.select({ relationshipId: lineageReport.relationshipId, grounds: lineageReport.grounds, status: lineageReport.status }).from(lineageReport).where(eq(lineageReport.reviewCaseId, caseId));
  if (!r) return null;
  const row = r.relationshipId ? await rowById(db, r.relationshipId) : null;
  const refs = row ? await peopleRefs([row.teacherPersonId, row.studentPersonId]) : new Map<string, PersonRef>();
  return {
    relationshipId: r.relationshipId,
    facts: [
      { label: 'Grounds', value: LINEAGE_REPORT_GROUND_LABELS[r.grounds] },
      {
        label: 'Relationship',
        value: row ? `${refs.get(row.teacherPersonId)?.name.value ?? 'Unknown'} taught ${refs.get(row.studentPersonId)?.name.value ?? 'Unknown'} · ${row.lineageName}` : 'No longer recorded',
      },
      { label: 'Relationship now', value: row ? (row.status === 'in_arbitration' ? 'In arbitration' : row.status === 'verified' ? 'Verified (unchanged by the report)' : row.status) : 'Gone' },
      { label: 'Upholding it', value: 'Sets the relationship in arbitration and asks both people for evidence; they are not told who reported. Not upholding it counts against no one.' },
    ],
  };
}

// --- appeals ---------------------------------------------------------------------------------------------

/** Which party may appeal a decided case of each kind, and which outcomes (DEFAULT M25, question 3). */
async function appealRole(db: Executor, c: CaseRow, userId: string): Promise<boolean> {
  if (!(APPEALABLE_KINDS as readonly string[]).includes(c.kind) || c.status !== 'resolved' || !c.resolution) return false;
  if (c.kind === 'relationship_dispute') {
    if (!c.relationshipId) return false;
    const rows = await db.execute<{ ok: boolean }>(sql`
SELECT true AS ok FROM teaching_relationship r JOIN person x ON x.id IN (r.teacher_person_id, r.student_person_id) AND x.deleted_at IS NULL
 WHERE r.id = ${c.relationshipId}::uuid AND x.claimed_by_user_id = ${userId}::uuid LIMIT 1`);
    return rows.rows.length > 0;
  }
  // A report not upheld, a succession request or a proposal refused: the account that sent it.
  return c.openedByUserId === userId && c.resolution === 'rejected';
}

/** The review_event that decided a case (its latest approve or reject), or null. */
async function decisionEventOf(db: Executor, caseId: string): Promise<{ id: string; actorUserId: string | null; createdAt: Date } | null> {
  const [row] = await db
    .select({ id: reviewEvent.id, actorUserId: reviewEvent.actorUserId, createdAt: reviewEvent.createdAt })
    .from(reviewEvent)
    .where(and(eq(reviewEvent.reviewCaseId, caseId), inArray(reviewEvent.action, ['approve', 'reject']), eq(reviewEvent.toStatus, 'resolved')))
    .orderBy(desc(reviewEvent.createdAt), desc(reviewEvent.id))
    .limit(1);
  return row ?? null;
}

export interface AppealState {
  /** Whether this party may appeal the decision now. */
  canAppeal: boolean;
  /** Why not, when the case is decided but cannot be appealed. */
  note: string | null;
  /** The appeal of this decision, when there is one. */
  appeal: { caseId: string; status: 'pending' | 'upheld' | 'rejected' } | null;
  windowDays: number;
}

/** For the party's case page (cases.ts): whether and how this decision can be appealed. */
export async function appealStateOf(db: Executor, c: CaseRow, userId: string): Promise<AppealState | null> {
  if (!(APPEALABLE_KINDS as readonly string[]).includes(c.kind) || c.status !== 'resolved') return null;
  const decision = await decisionEventOf(db, c.id);
  if (!decision) return null;
  const [appeal] = await db.select({ caseId: decisionAppeal.reviewCaseId, status: decisionAppeal.status }).from(decisionAppeal).where(eq(decisionAppeal.decisionEventId, decision.id));
  const party = await appealRole(db, c, userId);
  const expired = Date.now() - decision.createdAt.getTime() > APPEAL_WINDOW_DAYS * 86_400_000;
  const base = { appeal: appeal ? { caseId: appeal.caseId, status: appeal.status } : null, windowDays: APPEAL_WINDOW_DAYS };
  if (appeal) return { ...base, canAppeal: false, note: 'This decision was appealed: one appeal per decision.' };
  if (!party) return { ...base, canAppeal: false, note: c.kind === 'relationship_dispute' ? null : 'An approved request or an upheld report has nothing to appeal.' };
  if (expired) return { ...base, canAppeal: false, note: `An appeal is sent within ${APPEAL_WINDOW_DAYS} days of the decision.` };
  return { ...base, canAppeal: true, note: null };
}

/** appeals.create: one appeal per decision, by a party, within the window (see the top). */
export async function appealDecision(principal: Principal | null, raw: z.input<typeof appealInput>, meta: RequestMeta): Promise<{ caseId: string; replayed: boolean }> {
  const p = requireUser(principal);
  const parsed = appealInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      await lockAccountCases(tx, p.user.id);
      const replay = await caseReplayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        if (replay.action !== 'open') throw keyReused();
        return { caseId: replay.caseId, replayed: true };
      }
      const c = await caseById(tx, input.caseId, true);
      if (!c || !(APPEALABLE_KINDS as readonly string[]).includes(c.kind)) throw caseNotFound();
      const party = await appealRole(tx, c, p.user.id);
      // Anyone who is no party of the case gets the same answer as for no such case (the moderator
      // who opened a dispute is its reviewer, not a party).
      const known = party || (c.kind !== 'relationship_dispute' && c.openedByUserId === p.user.id);
      if (!known) throw caseNotFound();
      const state = await appealStateOf(tx, c, p.user.id);
      if (!state || !state.canAppeal) throw new ServiceError('CONFLICT', state?.note ?? 'This case has no decision to appeal.');
      if ((await dailyLimit(tx, decisionAppeal, p.user.id)) >= GOVERNANCE_DAILY_LIMIT) throw new ServiceError('TOO_MANY_REQUESTS', 'You have sent several appeals today. You can send another one tomorrow.');
      const decision = (await decisionEventOf(tx, c.id))!;
      const caseId = uuidv7();
      await tx.insert(reviewCase).values({ id: caseId, kind: 'decision_appeal', status: 'open', openedByUserId: p.user.id });
      await tx.insert(reviewNote).values({ reviewCaseId: caseId, authorUserId: p.user.id, body: input.grounds, isInternal: false });
      await tx.insert(decisionAppeal).values({
        appealedCaseId: c.id,
        appealedKind: c.kind as AppealableKind,
        decisionEventId: decision.id,
        reviewCaseId: caseId,
        appellantUserId: p.user.id,
        originalDeciderUserId: decision.actorUserId,
        status: 'pending',
      });
      await recordCaseEvent(tx, { caseId, action: 'open', from: null, to: 'open', actor: p, key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'appeal.create',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'review_case',
        subjectId: c.id,
        after: { appealCaseId: caseId, appealedKind: c.kind, resolution: c.resolution, decisionEventId: decision.id },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      // The staff who decide the appealed kind, never the one who decided it.
      await tellStaff(tx, caseId, 'decision_appeal', [p.user.id, ...(decision.actorUserId ? [decision.actorUserId] : [])]);
      return { caseId, replayed: false };
    });
  } catch (error) {
    if (isCaseKeyConflict(error)) throw keyReused();
    const pg = pgErrorOf(error);
    if (pg?.code === '23505' && pg.constraint === 'decision_appeal_one_per_decision_key') throw new ServiceError('CONFLICT', 'This decision was appealed: one appeal per decision.');
    throw error;
  }
}

export interface AppealRow {
  id: string;
  appealedCaseId: string;
  appealedKind: AppealableKind;
  originalDeciderUserId: string | null;
  status: 'pending' | 'upheld' | 'rejected';
}

export async function appealOfCase(db: Executor, caseId: string, lock = false): Promise<AppealRow | null> {
  const query = db
    .select({ id: decisionAppeal.id, appealedCaseId: decisionAppeal.appealedCaseId, appealedKind: decisionAppeal.appealedKind, originalDeciderUserId: decisionAppeal.originalDeciderUserId, status: decisionAppeal.status })
    .from(decisionAppeal)
    .where(eq(decisionAppeal.reviewCaseId, caseId));
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

/** For the appeal's case card: what is appealed and who may not decide it. */
export async function appealFacts(db: Executor, caseId: string, viewerId: string): Promise<{ label: string; value: string }[] | null> {
  const a = await appealOfCase(db, caseId);
  if (!a) return null;
  const [appealed] = await db.select({ resolution: reviewCase.resolution, resolutionReason: reviewCase.resolutionReason, status: reviewCase.status }).from(reviewCase).where(eq(reviewCase.id, a.appealedCaseId));
  return [
    { label: 'Appealed case', value: `${REVIEW_KIND_LABELS[a.appealedKind]} · /admin/review/${a.appealedCaseId}` },
    { label: 'Decision appealed', value: appealed?.resolution === 'approved' ? 'Approved or upheld' : appealed?.resolution === 'rejected' ? 'Refused or not upheld' : 'Reopened' },
    { label: 'Reason of the decision', value: appealed?.resolutionReason ?? 'None given' },
    { label: 'Who decides', value: a.originalDeciderUserId === viewerId ? 'You decided the appealed case: another member of staff decides this appeal.' : 'Any decider of the appealed kind except the one who decided it.' },
    { label: 'Upholding it', value: 'Reopens the appealed case for a new decision by someone other than the first decider.' },
  ];
}

/** Whether `userId` decided a case whose appeal was upheld (they never decide it again). */
export async function decidedBeforeAppeal(db: Executor, caseId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: decisionAppeal.id })
    .from(decisionAppeal)
    .where(and(eq(decisionAppeal.appealedCaseId, caseId), eq(decisionAppeal.status, 'upheld'), eq(decisionAppeal.originalDeciderUserId, userId)))
    .limit(1);
  return Boolean(row);
}

