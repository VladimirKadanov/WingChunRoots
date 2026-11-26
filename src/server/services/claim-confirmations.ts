// "Ask the teacher to confirm" (role replay 2026-11-25, P3-8, docs/adr/0067-ask-teacher-to-confirm.md):
// a reviewer of a profile claim (person_claim) who may ask its claimant for more may also ask a
// verified teacher of the claimed record, one with an account, whether the claim is their student's.
//
// - One ask per case and teacher (claim_confirmation_case_teacher_key): asking again changes
//   nothing. The teacher gets a notice (claim.confirmation_asked) with a link to the answer page.
// - The teacher answers once: "yes", "no" or "unsure", with an optional note that only the reviewers
//   read. The reviewer the case is assigned to is told (review.updated, change "confirmation").
// - The teacher sees the record (their own student's name, which they already know) and nothing of
//   the claimant: no name, no address, no evidence. Anyone else gets 404, staff included.
// - The answer is advice: the reviewer still decides the case. A closed case takes no answer.

import { and, asc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { hasStaff2FA, requireStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { CLAIM_CONFIRMATION_ANSWERS, CLAIM_CONFIRMATION_NOTE_MAX, claimConfirmation, person, reviewCase, teachingRelationship } from '../db/schema';
import type { Executor } from '../entitlements/access';
import type { RequestMeta } from './context';
import { peopleRefs, type PersonRef } from './dashboard';
import { ServiceError } from './errors';
import { notify } from './notify';
import { caseById, type CaseRow, DECIDERS, isOpenCase, ownSide } from './review-core';

export type ClaimConfirmationAnswer = (typeof CLAIM_CONFIRMATION_ANSWERS)[number];

/** The answers as the reviewers and the teacher read them. */
export const ANSWER_LABELS: Record<ClaimConfirmationAnswer, string> = {
  yes: 'Yes, it is my student',
  no: 'No, I do not think it is my student',
  unsure: 'I do not know',
};

const NO_CONFIRMATION = 'No such question.';
const notFound = () => new ServiceError('NOT_FOUND', NO_CONFIRMATION);

export const claimConfirmationAskInput = z.object({
  caseId: z.uuid({ error: 'No such case.' }),
  relationshipId: z.uuid({ error: 'Choose a teacher of the record.' }),
});

export const claimConfirmationIdInput = z.object({ id: z.uuid({ error: NO_CONFIRMATION }) });

export const claimConfirmationAnswerInput = z.object({
  id: z.uuid({ error: NO_CONFIRMATION }),
  answer: z.enum(CLAIM_CONFIRMATION_ANSWERS, { error: 'Choose an answer.' }),
  note: z
    .string()
    .trim()
    .max(CLAIM_CONFIRMATION_NOTE_MAX, { error: `At most ${CLAIM_CONFIRMATION_NOTE_MAX} characters.` })
    .optional()
    .transform((v) => (v ? v : null)),
});

/** One teacher a reviewer can ask, and the ask when there is one (review.get `confirmations`). */
export interface CaseConfirmation {
  relationshipId: string;
  teacher: PersonRef;
  ask: { id: string; askedAt: string; answer: ClaimConfirmationAnswer | null; answerLabel: string | null; note: string | null; answeredAt: string | null } | null;
}

/**
 * The verified teachers of the record a profile claim is about who have an account (never the
 * claimant), with the asks already made. Empty for any other kind of case.
 */
export async function confirmationsOfCase(db: Executor, c: Pick<CaseRow, 'id' | 'kind' | 'personId' | 'openedByUserId'>): Promise<CaseConfirmation[]> {
  if (c.kind !== 'person_claim' || !c.personId) return [];
  const asks = await db
    .select({
      id: claimConfirmation.id,
      relationshipId: claimConfirmation.relationshipId,
      teacherPersonId: teachingRelationship.teacherPersonId,
      createdAt: claimConfirmation.createdAt,
      answer: claimConfirmation.answer,
      note: claimConfirmation.note,
      answeredAt: claimConfirmation.answeredAt,
    })
    .from(claimConfirmation)
    .innerJoin(teachingRelationship, eq(teachingRelationship.id, claimConfirmation.relationshipId))
    .where(eq(claimConfirmation.reviewCaseId, c.id))
    .orderBy(asc(claimConfirmation.createdAt));
  const teachers = await db
    .select({ relationshipId: teachingRelationship.id, teacherPersonId: teachingRelationship.teacherPersonId })
    .from(teachingRelationship)
    .innerJoin(person, eq(person.id, teachingRelationship.teacherPersonId))
    .where(
      and(
        eq(teachingRelationship.studentPersonId, c.personId),
        eq(teachingRelationship.status, 'verified'),
        isNotNull(person.claimedByUserId),
        isNull(person.deletedAt),
        ...(c.openedByUserId ? [ne(person.claimedByUserId, c.openedByUserId)] : []),
      ),
    )
    .orderBy(asc(teachingRelationship.createdAt));
  const byRelationship = new Map<string, string>();
  for (const t of teachers) byRelationship.set(t.relationshipId, t.teacherPersonId);
  for (const a of asks) byRelationship.set(a.relationshipId, a.teacherPersonId);
  const refs = await peopleRefs([...new Set(byRelationship.values())]);
  return [...byRelationship].flatMap(([relationshipId, teacherPersonId]) => {
    const teacher = refs.get(teacherPersonId);
    if (!teacher) return [];
    const a = asks.find((row) => row.relationshipId === relationshipId);
    return [
      {
        relationshipId,
        teacher,
        ask: a
          ? {
              id: a.id,
              askedAt: a.createdAt.toISOString(),
              answer: a.answer,
              answerLabel: a.answer ? ANSWER_LABELS[a.answer] : null,
              note: a.note,
              answeredAt: a.answeredAt?.toISOString() ?? null,
            }
          : null,
      },
    ];
  });
}

/** Whether this reviewer may ask about this case: the rule of "Ask for more information". */
export function mayAskTeacher(p: Principal, c: Pick<CaseRow, 'kind' | 'status' | 'assignedToUserId'>, own: boolean): boolean {
  if (c.kind !== 'person_claim' || own || !isOpenCase(c.status)) return false;
  const admin = hasStaff2FA(p, ['admin']);
  return hasStaff2FA(p, DECIDERS.person_claim) && (c.assignedToUserId === p.user.id || admin);
}

/** review.askTeacher: asks one verified teacher of the claimed record. A second ask changes nothing. */
export async function askTeacherToConfirm(principal: Principal | null, raw: z.input<typeof claimConfirmationAskInput>, meta: RequestMeta): Promise<{ id: string; replayed: boolean }> {
  const p = requireStaff2FA(principal);
  const parsed = claimConfirmationAskInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', 'No such case.');
  const input = parsed.data;
  const db = getDb();
  return db.transaction(async (tx) => {
    const c = await caseById(tx, input.caseId, true);
    if (!c) throw new ServiceError('NOT_FOUND', 'No such case.');
    if (c.kind !== 'person_claim') throw new ServiceError('BAD_REQUEST', 'Only the teacher of a claimed profile can be asked.');
    const own = await ownSide(tx, p, c);
    if (own) throw new ServiceError('FORBIDDEN', 'This claim is about you: another reviewer handles it.');
    if (!isOpenCase(c.status)) throw new ServiceError('CONFLICT', 'This case is closed.');
    if (!mayAskTeacher(p, c, own)) throw new ServiceError('FORBIDDEN', 'Assign the case to yourself to ask the teacher.');
    const candidate = (await confirmationsOfCase(tx, c)).find((t) => t.relationshipId === input.relationshipId);
    if (!candidate) throw new ServiceError('BAD_REQUEST', 'That is not a verified teacher of the record with an account.', { relationshipId: 'Choose a teacher of the record.' });
    if (candidate.ask) return { id: candidate.ask.id, replayed: true };
    const [teacher] = await tx.select({ userId: person.claimedByUserId }).from(person).where(eq(person.id, candidate.teacher.id));
    if (!teacher?.userId) throw new ServiceError('BAD_REQUEST', 'That teacher has no account.', { relationshipId: 'Choose a teacher of the record.' });
    const [row] = await tx
      .insert(claimConfirmation)
      .values({ reviewCaseId: c.id, relationshipId: input.relationshipId, teacherUserId: teacher.userId, askedByUserId: p.user.id })
      .onConflictDoNothing()
      .returning({ id: claimConfirmation.id });
    if (!row) {
      const [earlier] = await tx.select({ id: claimConfirmation.id }).from(claimConfirmation).where(and(eq(claimConfirmation.reviewCaseId, c.id), eq(claimConfirmation.teacherUserId, teacher.userId)));
      return { id: earlier!.id, replayed: true };
    }
    await tx.update(reviewCase).set({ updatedAt: new Date() }).where(eq(reviewCase.id, c.id));
    await notify(tx, teacher.userId, 'claim.confirmation_asked', { confirmationId: row.id }, { key: `claim-confirmation:${row.id}` });
    await writeAudit(tx, {
      action: 'review.ask_teacher',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'review_case',
      subjectId: c.id,
      after: { confirmationId: row.id, relationshipId: input.relationshipId },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { id: row.id, replayed: false };
  });
}

/** What the asked teacher reads (claimConfirmations.get). */
export interface ClaimConfirmationView {
  id: string;
  /** The record someone asked to claim: the teacher's own student. */
  student: PersonRef;
  askedAt: string;
  /** False once the case is decided or withdrawn: it takes no answer then. */
  open: boolean;
  answer: ClaimConfirmationAnswer | null;
  answerLabel: string | null;
  note: string | null;
  answeredAt: string | null;
  answers: { value: ClaimConfirmationAnswer; label: string }[];
  noteMax: number;
}

async function ownConfirmation(db: Executor, p: Principal, id: string, lock = false) {
  const query = db
    .select({
      id: claimConfirmation.id,
      caseId: claimConfirmation.reviewCaseId,
      teacherUserId: claimConfirmation.teacherUserId,
      studentPersonId: teachingRelationship.studentPersonId,
      createdAt: claimConfirmation.createdAt,
      answer: claimConfirmation.answer,
      note: claimConfirmation.note,
      answeredAt: claimConfirmation.answeredAt,
      caseStatus: reviewCase.status,
      assignedTo: reviewCase.assignedToUserId,
    })
    .from(claimConfirmation)
    .innerJoin(teachingRelationship, eq(teachingRelationship.id, claimConfirmation.relationshipId))
    .innerJoin(reviewCase, eq(reviewCase.id, claimConfirmation.reviewCaseId))
    .where(and(eq(claimConfirmation.id, id), eq(claimConfirmation.teacherUserId, p.user.id)));
  const [row] = lock ? await query.for('update', { of: claimConfirmation }) : await query;
  return row ?? null;
}

async function viewOfConfirmation(row: NonNullable<Awaited<ReturnType<typeof ownConfirmation>>>): Promise<ClaimConfirmationView> {
  const student = (await peopleRefs([row.studentPersonId])).get(row.studentPersonId)!;
  return {
    id: row.id,
    student,
    askedAt: row.createdAt.toISOString(),
    open: isOpenCase(row.caseStatus),
    answer: row.answer,
    answerLabel: row.answer ? ANSWER_LABELS[row.answer] : null,
    note: row.note,
    answeredAt: row.answeredAt?.toISOString() ?? null,
    answers: CLAIM_CONFIRMATION_ANSWERS.map((value) => ({ value, label: ANSWER_LABELS[value] })),
    noteMax: CLAIM_CONFIRMATION_NOTE_MAX,
  };
}

/** claimConfirmations.get: the asked teacher's own question; 404 for anyone else. */
export async function getClaimConfirmation(principal: Principal | null, raw: z.input<typeof claimConfirmationIdInput>): Promise<ClaimConfirmationView> {
  const p = requireUser(principal);
  const parsed = claimConfirmationIdInput.safeParse(raw);
  if (!parsed.success) throw notFound();
  const row = await ownConfirmation(getDb(), p, parsed.data.id);
  if (!row) throw notFound();
  return viewOfConfirmation(row);
}

/**
 * claimConfirmations.answer: the asked teacher answers once. The same answer and note again is a
 * replay; another answer after the first is refused, as is an answer to a closed case.
 */
export async function answerClaimConfirmation(
  principal: Principal | null,
  raw: z.input<typeof claimConfirmationAnswerInput> | z.output<typeof claimConfirmationAnswerInput>,
  meta: RequestMeta,
): Promise<{ confirmation: ClaimConfirmationView; replayed: boolean }> {
  const p = requireUser(principal);
  const parsed = claimConfirmationAnswerInput.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? 'form')] ??= issue.message;
    if (fields.id) throw notFound();
    throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
  }
  const input = parsed.data;
  const db = getDb();
  const replayed = await db.transaction(async (tx) => {
    const row = await ownConfirmation(tx, p, input.id, true);
    if (!row) throw notFound();
    if (row.answer !== null) {
      if (row.answer === input.answer && row.note === input.note) return true;
      throw new ServiceError('CONFLICT', 'You already answered. Write to the WingChunRoots team if something changed.');
    }
    if (!isOpenCase(row.caseStatus)) throw new ServiceError('CONFLICT', 'The reviewers have closed this case, so it takes no answer now.');
    await tx.update(claimConfirmation).set({ answer: input.answer, note: input.note, answeredAt: new Date(), updatedAt: new Date() }).where(eq(claimConfirmation.id, row.id));
    await tx.update(reviewCase).set({ updatedAt: new Date() }).where(eq(reviewCase.id, row.caseId));
    if (row.assignedTo) await notify(tx, row.assignedTo, 'review.updated', { caseId: row.caseId, change: 'confirmation' });
    await writeAudit(tx, {
      action: 'claim_confirmation.answer',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'review_case',
      subjectId: row.caseId,
      after: { confirmationId: row.id, answer: input.answer, noteLength: input.note?.length ?? 0 },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return false;
  });
  const row = await ownConfirmation(db, p, input.id);
  return { confirmation: await viewOfConfirmation(row!), replayed };
}
