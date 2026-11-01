// Inviting a living teacher who has no account (milestone M10b, In scope 1 and 2; plan §6.4, §6.7).
//
//   relationships.invite (student)
//     → a new teacher record: living, stewardship unclaimed, involved_only (DEFAULT D03), created by
//       the student; absent from anonymous pages, the API, search and the sitemap (v_public_person);
//     → the relationship awaiting_claim, involved_only, teacher_approval, with the periods; optional
//       evidence linked to the relationship (never shown to the invitee before the claim is
//       approved: evidence.ts accessOfFiles opens it to the teacher only once the record is theirs);
//     → relationship_event (null → awaiting_claim), audit relationship.request and person.create;
//     → with an e-mail address, an invitation (below).
//   invitations.send (student): a new invitation for an awaiting_claim relationship (an address
//     added later, or a new link after the old one expired); earlier links stop working.
//   invitations.get (anyone with the link): what the invitation is about, never the evidence.
//   invitations.accept (a signed-in account without a profile of its own)
//     → a person_claim and a review_case of kind person_claim (open), the invitation used; the
//       relationship stays awaiting_claim and involved_only. An archivist or an administrator
//       decides the claim (review.decide, review-kinds.ts): approved, the record becomes the
//       account's own and the relationship pending_teacher, which the teacher answers as in M09.
//
// The invitation token (DEFAULT, the milestone's brief): 32 random bytes, sent only in the e-mail
// (the outbox seals the link, src/server/mail/seal.ts); only its SHA-256 is stored; it works for
// INVITATION_DAYS days and once. An unknown, malformed or revoked token gets the same 404. The
// address is kept until 30 days after the invitation ends (retention.purge, docs/data-model.md §7)
// and is never written to a log or an audit row.
//
// The same locks and limits as a request (relationships.ts): the student's request lock, the
// pending cap and the 24-hour request window; invitations are limited per relationship and per
// account as well, since each sends an e-mail to someone who has no account. invitations.send takes
// the same request lock, so the account's invitations are counted one call after the other.

import { createHash, randomBytes } from 'node:crypto';

import { and, count, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { authUser, invitation, lineage, notification, person, personClaim, personName, reviewCase, reviewNote, teachingRelationship } from '../db/schema';
import { EVIDENCE_MAX_FILES_PER_CASE, OPEN_REVIEW_CASE_STATUSES } from '../db/schema/common';
import type { Executor } from '../entitlements/access';
import { queueEmail, type Transaction } from '../jobs/outbox';
import { writePersonKeys } from '../search/store';
import type { NameData } from '../templates/email/types';
import { missingRequiredConsents } from './consent';
import type { RequestMeta } from './context';
import { pgErrorOf, ServiceError } from './errors';
import { linkFilesToRelationship } from './evidence';
import { cleanName, isLatinName, matchesScript, NAME_MAX_LENGTH, originalScript, slugFromName } from './names';
import {
  checkLineage,
  checkPendingCap,
  checkPeriods,
  checkRequestWindow,
  fieldErrors,
  idempotencyKey,
  isKeyConflict,
  keyReused,
  lockStudentRequests,
  namesFor,
  periodShape,
  periods,
  recordEvent,
  type RelationshipView,
  replayOf,
  rowById,
  url,
  viewerOf,
  viewOf,
  writePeriods,
} from './relationships';
import { caseReplayOf, isCaseKeyConflict, lockAccountCases, recordCaseEvent, tellStaff } from './review-core';

/** DEFAULT (the milestone's brief): an invitation link works for 14 days, once. */
export const INVITATION_DAYS = 14;
/** At most this many invitations for one relationship, and from one account, in INVITATION_WINDOW_HOURS. */
export const INVITATIONS_PER_RELATIONSHIP = 3;
export const INVITATIONS_PER_ACCOUNT = 10;
export const INVITATION_WINDOW_HOURS = 24;
export const CLAIM_NOTE_MAX = 2000;

const INVALID_LINK = 'This invitation link is not valid. Ask the person who invited you to send a new one.';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The SHA-256 of a token, in hex: the only form of it the database keeps. */
export const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

const optionalName = z
  .string()
  .max(NAME_MAX_LENGTH * 2)
  .transform((s) => cleanName(s))
  .nullish()
  .transform((s) => (s ? s : null));

const emailField = z
  .string()
  .max(320, { error: 'Enter a shorter e-mail address.' })
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.union([z.literal(''), z.email({ error: 'Enter the e-mail address as name@example.com.' })]))
  .nullish()
  .transform((s) => (s ? s : null));

/**
 * The invitation of a teacher who has no account: the name in Latin letters (required) and
 * optionally in its own script, the lineage (required: a new record has none of its own), the
 * periods, an optional e-mail address and optional evidence. Flat fields, so every field error is
 * named by its own field.
 */
export const inviteInput = z
  .object({
    teacherName: optionalName,
    originalName: optionalName,
    originalLang: z
      .string()
      .max(16)
      .nullish()
      .transform((s) => (s ? s : null)),
    lineageId: z.uuid({ error: 'Choose a lineage from the list.' }).nullish(),
    periods,
    email: emailField,
    evidenceIds: z
      .array(z.uuid({ error: 'Upload the files again.' }))
      .max(EVIDENCE_MAX_FILES_PER_CASE, { error: `Attach at most ${EVIDENCE_MAX_FILES_PER_CASE} files.` })
      .default([]),
    /** DEFAULT D05: the student's wish that this teacher be drawn as the primary line; visual only. */
    displayPrimary: z.boolean().default(false),
    idempotencyKey,
  })
  .superRefine((input, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (!input.teacherName) issue('teacherName', 'Enter your teacher’s name in Latin letters.');
    else if (input.teacherName.length > NAME_MAX_LENGTH) issue('teacherName', `Use at most ${NAME_MAX_LENGTH} characters.`);
    else if (!isLatinName(input.teacherName)) issue('teacherName', 'Use Latin letters here. Add the name in its own script below.');
    if (input.originalName) {
      const script = input.originalLang ? originalScript(input.originalLang) : undefined;
      if (!script) issue('originalLang', 'Choose the script of this name.');
      else if (input.originalName.length > NAME_MAX_LENGTH) issue('originalName', `Use at most ${NAME_MAX_LENGTH} characters.`);
      else if (!matchesScript(input.originalName, script.lang)) issue('originalName', `This name is not written in ${script.label}.`);
    } else if (input.originalLang && !originalScript(input.originalLang)) {
      issue('originalLang', 'Choose one of the listed scripts.');
    }
    if (!input.lineageId) issue('lineageId', 'Choose the lineage this training belongs to.');
  });
export type InviteInput = z.input<typeof inviteInput>;

export const sendInvitationInput = z.object({
  relationshipId: z.uuid({ error: 'Choose a request.' }),
  email: z
    .string({ error: 'Enter your teacher’s e-mail address.' })
    .max(320, { error: 'Enter a shorter e-mail address.' })
    .transform((s) => s.trim().toLowerCase())
    .pipe(z.email({ error: 'Enter the e-mail address as name@example.com.' })),
  idempotencyKey,
});

export const invitationTokenInput = z.object({ token: z.string().max(100) });

export const acceptInvitationInput = z.object({
  token: z.string().max(100),
  /** For the reviewers: who you are and how you know the student. */
  note: z
    .string()
    .max(CLAIM_NOTE_MAX * 2, { error: `Use at most ${CLAIM_NOTE_MAX} characters.` })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .refine((s) => s.length <= CLAIM_NOTE_MAX, { error: `Use at most ${CLAIM_NOTE_MAX} characters.` })
    .nullish()
    .transform((s) => (s ? s : null)),
  idempotencyKey,
});

export interface InviteResult {
  relationship: RelationshipView;
  /** Whether an invitation e-mail was queued with this call. */
  invited: boolean;
  replayed: boolean;
}

// --- relationships.invite ----------------------------------------------------------------------

/** The new record of an invited teacher: living, unclaimed, private until the claim and the approval. */
async function createInvitedRecord(tx: Transaction, p: Principal, input: z.output<typeof inviteInput>, meta: RequestMeta): Promise<string> {
  const id = uuidv7();
  // DEFAULT D03: the record of a teacher invited by a student is involved_only until a relationship
  // with it is verified; it is unclaimed until the archivists approve the teacher's claim.
  await tx.insert(person).values({
    id,
    slug: slugFromName(input.teacherName!, randomBytes(4).toString('hex')),
    kind: 'living',
    lifeStatus: 'living',
    stewardship: 'unclaimed',
    visibility: 'involved_only',
    createdByUserId: p.user.id,
  });
  const script = input.originalName && input.originalLang ? originalScript(input.originalLang)! : null;
  const names: (typeof personName.$inferInsert)[] = [{ personId: id, kind: 'name', value: input.teacherName!, script: 'Latn', lang: 'und-Latn', isPrimary: true, sortOrder: 0 }];
  if (script && input.originalName) names.push({ personId: id, kind: 'name', value: input.originalName, script: script.script, lang: script.lang, sortOrder: 1 });
  await tx.insert(personName).values(names);
  // The search keys, so the record is found by every spelling once it is public (M07).
  await writePersonKeys(tx, id);
  await writeAudit(tx, {
    action: 'person.create',
    actorUserId: p.user.id,
    actorRole: p.user.role,
    subjectType: 'person',
    subjectId: id,
    after: { kind: 'living', lifeStatus: 'living', stewardship: 'unclaimed', visibility: 'involved_only', names: names.map((n) => ({ kind: n.kind, script: n.script, lang: n.lang })) },
    reason: 'invited teacher',
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
  return id;
}

/** Refuses one more invitation above the limits per relationship and per account. */
async function checkInvitationLimits(tx: Transaction, userId: string, relationshipId: string | null): Promise<void> {
  const since = sql`now() - make_interval(hours => ${INVITATION_WINDOW_HOURS}::int)`;
  const [mine] = await tx
    .select({ n: count() })
    .from(invitation)
    .where(and(eq(invitation.invitedByUserId, userId), gt(invitation.createdAt, since)));
  if ((mine?.n ?? 0) >= INVITATIONS_PER_ACCOUNT) throw new ServiceError('TOO_MANY_REQUESTS', 'You have sent many invitations today. You can send more tomorrow.');
  if (!relationshipId) return;
  const [here] = await tx
    .select({ n: count() })
    .from(invitation)
    .where(and(eq(invitation.relationshipId, relationshipId), gt(invitation.createdAt, since)));
  if ((here?.n ?? 0) >= INVITATIONS_PER_RELATIONSHIP) {
    throw new ServiceError('TOO_MANY_REQUESTS', 'You have sent this teacher several invitations today. You can send another one tomorrow.');
  }
}

/**
 * A new invitation for an awaiting_claim relationship: earlier pending links stop working, a new
 * token is made, its hash stored and the e-mail queued with the link sealed. Never logs the address.
 */
async function createInvitation(
  tx: Transaction,
  p: Principal,
  rel: { id: string; teacherPersonId: string; studentPersonId: string; lineageName: string },
  email: string,
  key: string,
  meta: RequestMeta,
): Promise<string> {
  const now = new Date();
  const revoked = await tx
    .update(invitation)
    .set({ status: 'revoked', updatedAt: now })
    .where(and(eq(invitation.relationshipId, rel.id), eq(invitation.status, 'pending')))
    .returning({ id: invitation.id });
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + INVITATION_DAYS * 86_400_000);
  const id = uuidv7();
  await tx.insert(invitation).values({
    id,
    personId: rel.teacherPersonId,
    relationshipId: rel.id,
    invitedByUserId: p.user.id,
    email,
    tokenHash: hashToken(token),
    status: 'pending',
    expiresAt,
    idempotencyKey: key,
  });
  const inviterNames = await namesFor(tx, rel.studentPersonId);
  const teacherNames = await namesFor(tx, rel.teacherPersonId);
  await queueEmail(tx, {
    template: 'invitation',
    to: email,
    userId: null,
    // Ids only (mailer.ts checkIdempotencyKey): never the address.
    idempotencyKey: `invitation:${id}`,
    data: {
      inviterNames,
      teacherNames,
      lineageName: rel.lineageName,
      url: url(`/invite/${token}`),
      days: INVITATION_DAYS,
    },
  });
  await writeAudit(tx, {
    action: 'invitation.create',
    actorUserId: p.user.id,
    actorRole: p.user.role,
    subjectType: 'invitation',
    subjectId: id,
    after: { relationshipId: rel.id, personId: rel.teacherPersonId, expiresAt: expiresAt.toISOString(), ...(revoked.length > 0 ? { revokedInvitationIds: revoked.map((r) => r.id) } : {}) },
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
  return id;
}

/** The address of the account itself is refused: the invitation is for the teacher. */
async function ownAddress(tx: Transaction, userId: string, email: string): Promise<boolean> {
  const [me] = await tx.select({ email: authUser.email }).from(authUser).where(eq(authUser.id, userId));
  return me?.email.toLowerCase() === email;
}

/**
 * relationships.invite: the signed-in student names a living teacher who has no account (see the
 * top of this file). With an e-mail address the teacher gets the invitation at once.
 */
export async function inviteTeacher(principal: Principal | null, raw: InviteInput, meta: RequestMeta): Promise<InviteResult> {
  const p = requireUser(principal);
  const parsed = inviteInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  const viewer = await viewerOf(db, p);
  if (!viewer.personId) throw new ServiceError('NOT_FOUND', 'Set up your profile before you name your teachers.');
  const studentId = viewer.personId;

  try {
    const outcome = await db.transaction(async (tx) => {
      await lockStudentRequests(tx, studentId);
      const replay = await replayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        if (replay.fromStatus !== null || replay.toStatus !== 'awaiting_claim') throw keyReused();
        return { id: replay.relationshipId, invited: false, replayed: true };
      }
      const { lineageId, fields: lineageFields } = await checkLineage(tx, input.lineageId ?? null, null);
      const { rows, fields: periodFields } = await checkPeriods(tx, input.periods);
      const fields: Record<string, string> = { ...lineageFields, ...periodFields };
      if (input.email && (await ownAddress(tx, p.user.id, input.email))) fields.email = 'Enter your teacher’s address, not your own.';
      if (Object.keys(fields).length > 0 || !lineageId) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);

      await checkPendingCap(tx, studentId);
      // A new record has no requests yet: only the account's own window counts for it.
      await checkRequestWindow(tx, p.user.id, uuidv7());
      if (input.email) await checkInvitationLimits(tx, p.user.id, null);

      const teacherId = await createInvitedRecord(tx, p, input, meta);
      const id = uuidv7();
      // DEFAULT D03: pending requests are involved_only; awaiting_claim is one until verified.
      await tx.insert(teachingRelationship).values({
        id,
        teacherPersonId: teacherId,
        studentPersonId: studentId,
        lineageId,
        status: 'awaiting_claim',
        visibility: 'involved_only',
        verificationPath: 'teacher_approval',
        requestedByUserId: p.user.id,
        prefersDisplayPrimary: input.displayPrimary,
      });
      await writePeriods(tx, id, rows);
      const evidenceError = await linkFilesToRelationship(tx, p.user.id, id, input.evidenceIds);
      if (evidenceError) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { evidenceIds: evidenceError });
      await recordEvent(tx, { relationshipId: id, from: null, to: 'awaiting_claim', actor: p, role: 'student', key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'relationship.request',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'teaching_relationship',
        subjectId: id,
        after: {
          status: 'awaiting_claim',
          visibility: 'involved_only',
          verificationPath: 'teacher_approval',
          teacherPersonId: teacherId,
          newTeacherRecord: true,
          studentPersonId: studentId,
          lineageId,
          periods: periodShape(rows),
          prefersDisplayPrimary: input.displayPrimary,
          invited: input.email !== null,
          evidenceIds: [...new Set(input.evidenceIds)],
        },
        evidenceIds: input.evidenceIds,
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      if (input.email) {
        const [l] = await tx.select({ name: lineage.name }).from(lineage).where(eq(lineage.id, lineageId));
        await createInvitation(tx, p, { id, teacherPersonId: teacherId, studentPersonId: studentId, lineageName: l!.name }, input.email, input.idempotencyKey, meta);
      }
      return { id, invited: input.email !== null, replayed: false };
    });
    return { relationship: await viewOf(db, outcome.id, viewer), invited: outcome.invited, replayed: outcome.replayed };
  } catch (error) {
    if (isKeyConflict(error) || isInvitationKeyConflict(error)) throw keyReused();
    throw error;
  }
}

function isInvitationKeyConflict(error: unknown): boolean {
  const pg = pgErrorOf(error);
  return pg?.code === '23505' && pg.constraint === 'invitation_idempotency_key';
}

// --- invitations.send --------------------------------------------------------------------------

/**
 * invitations.send: the student sends an invitation (again) for their awaiting_claim relationship,
 * to a new or the same address. Earlier links stop working. Refused while the teacher's claim
 * waits for the reviewers.
 */
export async function sendInvitation(principal: Principal | null, raw: z.input<typeof sendInvitationInput>, meta: RequestMeta): Promise<InviteResult> {
  const p = requireUser(principal);
  const parsed = sendInvitationInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  const viewer = await viewerOf(db, p);
  try {
    const outcome = await db.transaction(async (tx) => {
      // The student's request lock first, as relationships.invite and resubmit take it (the same
      // order: no deadlock), so the invitations of the account are counted one call after the other
      // (M10b review, code-4); the relationship's row lock then orders the calls for one request.
      if (viewer.personId) await lockStudentRequests(tx, viewer.personId);
      const row = await rowById(tx, input.relationshipId, true);
      if (!row || viewer.personId === null || row.studentPersonId !== viewer.personId) throw new ServiceError('NOT_FOUND', 'No such request.');
      const [earlier] = await tx
        .select({ relationshipId: invitation.relationshipId })
        .from(invitation)
        .where(and(eq(invitation.invitedByUserId, p.user.id), eq(invitation.idempotencyKey, input.idempotencyKey)));
      if (earlier) {
        if (earlier.relationshipId !== row.id) throw keyReused();
        return { id: row.id, invited: false, replayed: true };
      }
      if (row.status !== 'awaiting_claim') throw new ServiceError('CONFLICT', 'This request no longer waits for your teacher to join.');
      const [claim] = await tx
        .select({ id: reviewCase.id })
        .from(reviewCase)
        .where(and(eq(reviewCase.relationshipId, row.id), eq(reviewCase.kind, 'person_claim'), inArray(reviewCase.status, [...OPEN_REVIEW_CASE_STATUSES])));
      if (claim) throw new ServiceError('CONFLICT', 'Your teacher has accepted the invitation. The reviewers are checking their claim.');
      if (await ownAddress(tx, p.user.id, input.email)) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { email: 'Enter your teacher’s address, not your own.' });
      await checkInvitationLimits(tx, p.user.id, row.id);
      await createInvitation(tx, p, row, input.email, input.idempotencyKey, meta);
      return { id: row.id, invited: true, replayed: false };
    });
    return { relationship: await viewOf(db, outcome.id, viewer), invited: outcome.invited, replayed: outcome.replayed };
  } catch (error) {
    if (isInvitationKeyConflict(error)) throw keyReused();
    throw error;
  }
}

// --- invitations.get ---------------------------------------------------------------------------

export interface InvitationView {
  /**
   * pending: it can be accepted; yours: this account accepted it (the claim is reviewed or was
   * decided); used: another account accepted it; expired; revoked (a newer link was sent, or the
   * student withdrew the request).
   */
  state: 'pending' | 'yours' | 'used' | 'expired' | 'revoked';
  expiresAt: string | null;
  /** The names of the record and of the student, and the lineage: only while it is pending or yours. */
  teacherNames: NameData[] | null;
  studentNames: NameData[] | null;
  lineageName: string | null;
  /** The record is unclaimed (always, while pending): the label the invitee reads. */
  unclaimedRecord: boolean;
  viewer: {
    signedIn: boolean;
    /** Why this account cannot accept it, when it cannot. */
    refusal: string | null;
    /** The refusal is the current documents, which /onboarding asks this account to confirm. */
    confirmDocuments: boolean;
    /** The claim this account sent with it, and where the reviewers are with it (state yours). */
    caseId: string | null;
    claimStatus: 'pending' | 'approved' | 'rejected' | 'withdrawn' | null;
  };
}

interface InvitationRow {
  id: string;
  personId: string;
  relationshipId: string | null;
  invitedByUserId: string | null;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expiresAt: Date;
  acceptedByUserId: string | null;
}

async function invitationByToken(db: Executor, token: string, lock = false): Promise<InvitationRow | null> {
  if (!TOKEN.test(token)) return null;
  const query = db
    .select({
      id: invitation.id,
      personId: invitation.personId,
      relationshipId: invitation.relationshipId,
      invitedByUserId: invitation.invitedByUserId,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      acceptedByUserId: invitation.acceptedByUserId,
    })
    .from(invitation)
    .where(eq(invitation.tokenHash, hashToken(token)));
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

const CONFIRM_DOCUMENTS = 'Before you claim this profile, confirm the current version of the terms of use and the declarations.';

/** Why `p` may not accept the invitation now, or null. */
async function refusalFor(db: Executor, p: Principal, inv: InvitationRow, studentPersonId: string): Promise<string | null> {
  const [student] = await db.select({ userId: person.claimedByUserId }).from(person).where(eq(person.id, studentPersonId));
  if (p.user.id === inv.invitedByUserId || (student?.userId ?? null) === p.user.id) return 'You sent this invitation. It is for your teacher to accept.';
  const [own] = await db.select({ id: person.id }).from(person).where(and(eq(person.claimedByUserId, p.user.id), isNull(person.deletedAt)));
  if (own) return 'Your account already has its own profile, so it cannot claim another one. Ask the student to send their request to your profile instead.';
  const [waiting] = await db.select({ id: personClaim.id }).from(personClaim).where(and(eq(personClaim.userId, p.user.id), eq(personClaim.status, 'pending')));
  if (waiting) return 'You already have a profile claim waiting for the reviewers.';
  // The confirmations every account gives at sign-up, for the current documents: a claim skips
  // onboarding, never them (landingPath, /onboarding).
  if ((await missingRequiredConsents(db, p.user.id)).length > 0) return CONFIRM_DOCUMENTS;
  return null;
}

/** The state of an invitation as the page and the API report it. */
function stateOf(inv: InvitationRow, relationshipStatus: string | null, viewerId: string | null): InvitationView['state'] {
  if (inv.status === 'accepted') return viewerId !== null && inv.acceptedByUserId === viewerId ? 'yours' : 'used';
  if (inv.status === 'revoked' || relationshipStatus !== 'awaiting_claim') return 'revoked';
  if (inv.status === 'expired' || inv.expiresAt.getTime() <= Date.now()) return 'expired';
  return 'pending';
}

/**
 * invitations.get: what an invitation link is about, for anyone who holds the link (the token is
 * the secret; it travels in the request body, never in an API address). The names only while the
 * invitation can be accepted, or for the account that accepted it. Never the student's evidence.
 */
export async function getInvitation(principal: Principal | null, raw: z.input<typeof invitationTokenInput>): Promise<InvitationView> {
  const parsed = invitationTokenInput.safeParse(raw);
  const db = getDb();
  const inv = parsed.success ? await invitationByToken(db, parsed.data.token) : null;
  if (!inv) throw new ServiceError('NOT_FOUND', INVALID_LINK);
  const rel = inv.relationshipId ? await rowById(db, inv.relationshipId) : null;
  const viewerId = principal?.user.id ?? null;
  const state = stateOf(inv, rel?.status ?? null, viewerId);
  const open = (state === 'pending' || state === 'yours') && rel !== null;
  const [claim] =
    state === 'yours' && viewerId
      ? await db
          .select({ id: reviewCase.id, status: personClaim.status })
          .from(reviewCase)
          .leftJoin(personClaim, eq(personClaim.reviewCaseId, reviewCase.id))
          .where(and(eq(reviewCase.personId, inv.personId), eq(reviewCase.kind, 'person_claim'), eq(reviewCase.openedByUserId, viewerId)))
          .orderBy(desc(reviewCase.createdAt))
          .limit(1)
      : [];
  const refusal = principal && state === 'pending' && rel ? await refusalFor(db, principal, inv, rel.studentPersonId) : null;
  return {
    state,
    expiresAt: state === 'pending' ? inv.expiresAt.toISOString() : null,
    teacherNames: open ? await namesFor(db, inv.personId) : null,
    studentNames: open && rel ? await namesFor(db, rel.studentPersonId) : null,
    lineageName: open && rel ? rel.lineageName : null,
    unclaimedRecord: state === 'pending',
    viewer: {
      signedIn: principal !== null,
      refusal,
      confirmDocuments: refusal === CONFIRM_DOCUMENTS,
      caseId: claim?.id ?? null,
      claimStatus: claim?.status ?? null,
    },
  };
}

// --- invitations.accept ------------------------------------------------------------------------

export interface AcceptResult {
  caseId: string;
  replayed: boolean;
}

/**
 * invitations.accept: the signed-in invitee claims the record (see the top of this file). In one
 * transaction, the account's case lock, then the relationship (the lock order of every relationship
 * change), then the invitation: a second accept, by the same or another account, finds it used.
 */
export async function acceptInvitation(principal: Principal | null, raw: z.input<typeof acceptInvitationInput>, meta: RequestMeta): Promise<AcceptResult> {
  const p = requireUser(principal);
  const parsed = acceptInvitationInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  const seen = await invitationByToken(db, input.token);
  if (!seen || !seen.relationshipId) throw new ServiceError('NOT_FOUND', INVALID_LINK);
  try {
    const outcome = await db.transaction(async (tx) => {
      // The account's case lock before any row lock (review-core.ts): two invitations accepted at
      // once by one account are checked one after the other, so it holds one pending claim.
      await lockAccountCases(tx, p.user.id);
      const rel = await rowById(tx, seen.relationshipId!, true);
      const inv = await invitationByToken(tx, input.token, true);
      if (!rel || !inv) throw new ServiceError('NOT_FOUND', INVALID_LINK);
      const replay = await caseReplayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        const [earlier] = await tx.select({ kind: reviewCase.kind, relationshipId: reviewCase.relationshipId }).from(reviewCase).where(eq(reviewCase.id, replay.caseId));
        if (replay.action !== 'open' || earlier?.kind !== 'person_claim' || earlier.relationshipId !== rel.id) throw keyReused();
        return { caseId: replay.caseId, replayed: true };
      }
      const state = stateOf(inv, rel.status, p.user.id);
      if (state === 'yours' || state === 'used') throw new ServiceError('CONFLICT', 'This invitation has been used already.');
      if (state === 'expired') throw new ServiceError('CONFLICT', 'This invitation has expired. Ask the person who invited you to send a new one.');
      if (state === 'revoked') throw new ServiceError('CONFLICT', 'This invitation no longer works. Ask the person who invited you to send a new one.');
      const refusal = await refusalFor(tx, p, inv, rel.studentPersonId);
      if (refusal) throw new ServiceError('CONFLICT', refusal);
      const [record] = await tx
        .select({ claimedBy: person.claimedByUserId, deletedAt: person.deletedAt, stewardship: person.stewardship })
        .from(person)
        .where(eq(person.id, inv.personId))
        .for('update');
      if (!record || record.deletedAt || record.claimedBy || record.stewardship !== 'unclaimed') throw new ServiceError('CONFLICT', 'This profile can no longer be claimed.');

      const now = new Date();
      const caseId = uuidv7();
      await tx.insert(reviewCase).values({ id: caseId, kind: 'person_claim', status: 'open', relationshipId: rel.id, personId: inv.personId, openedByUserId: p.user.id });
      await tx.insert(personClaim).values({ personId: inv.personId, userId: p.user.id, status: 'pending', reviewCaseId: caseId });
      if (input.note) await tx.insert(reviewNote).values({ reviewCaseId: caseId, authorUserId: p.user.id, body: input.note, isInternal: false });
      await tx.update(invitation).set({ status: 'accepted', acceptedAt: now, acceptedByUserId: p.user.id, updatedAt: now }).where(eq(invitation.id, inv.id));
      await recordCaseEvent(tx, { caseId, action: 'open', from: null, to: 'open', actor: p, key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'person.claim',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'person',
        subjectId: inv.personId,
        after: { status: 'pending', caseId, relationshipId: rel.id, invitationId: inv.id },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      const student = await tx.select({ id: person.claimedByUserId }).from(person).where(eq(person.id, rel.studentPersonId));
      await tellStaff(tx, caseId, 'person_claim', [p.user.id, ...(student[0]?.id ? [student[0].id] : [])]);
      if (student[0]?.id) await tx.insert(notification).values({ userId: student[0].id, template: 'invitation.claimed', payload: { relationshipId: rel.id, stage: 'claimed' } });
      return { caseId, replayed: false };
    });
    return outcome;
  } catch (error) {
    if (isCaseKeyConflict(error)) throw keyReused();
    const pg = pgErrorOf(error);
    if (pg?.code === '23505' && (pg.constraint === 'person_claim_one_pending_key' || pg.constraint === 'review_case_one_open_per_relationship_key')) {
      throw new ServiceError('CONFLICT', 'This invitation has been used already.');
    }
    throw error;
  }
}
