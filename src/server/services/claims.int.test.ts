// Invitations, profile claims, instructor verification, profile reports and arbitration (milestone
// M10b, In scope 1–5), against a migrated throwaway database:
//   - the invitation token is kept only as its SHA-256, expires, works once, and an unknown or
//     revoked one gets the same answer;
//   - awaiting_claim → pending_teacher happens only after an approved person_claim; a refused claim
//     leaves the request awaiting_claim; the invitee never opens the student's evidence before the
//     approval, and the invited record stays out of v_public_person and search until a link with it
//     is verified;
//   - every relationship transition writes a relationship_event and an audit row, every case change
//     a review_event;
//   - instructor verification, one report per account and profile (no automatic hiding), and
//     arbitration with its reason, notices and e-mails to both parties (DEFAULT D19).
// Fictional data only (D20): demo- slugs, example.test addresses, generated PDFs.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { auditLog, authUser, consentRecord, contentReport, invitation, notification, person, personClaim, relationshipEvent, reviewCase, reviewEvent, teachingRelationship } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { jobTemplateData } from '../jobs/outbox';
import type { EmailSendJob } from '../jobs/queues';
import { filesystemStore } from '../storage/fs';
import { landingPath } from './account';
import { arbitrateRelationship } from './arbitration';
import { getPartyCase, myCases, replyToCase } from './cases';
import { grantConsents, recordConsents, REQUIRED_SIGN_UP_CONSENTS } from './consent';
import { pgErrorOf } from './errors';
import { openEvidence, uploadEvidence } from './evidence';
import { instructorOverview, requestInstructorVerification } from './instructor';
import { acceptInvitation, getInvitation, hashToken, INVITATION_DAYS, inviteTeacher, sendInvitation } from './invitations';
import { lineageEgo, personProfile } from './lineage';
import { profileUpdate } from './profile';
import { approveRelationship, getRelationship, withdrawRelationship } from './relationships';
import { reportProfile } from './reports';
import { assignReviewCase, decideReviewCase, getReviewCase } from './review';
import { searchQuery } from './search';
import { key, type Member, member, meta, newLineage, ongoingFrom, principalOf, staff } from './relationships.test-support';

const cache = vi.hoisted(() => ({ revalidated: [] as string[] }));
vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: (tag: string) => {
    cache.revalidated.push(tag);
  },
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;
let lineageId: string;
const root = mkdtempSync(path.join(tmpdir(), 'wcr-claims-int-'));
const store = filesystemStore(root);

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
  lineageId = await newLineage('m10b-claims');
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
  rmSync(root, { recursive: true, force: true });
});

function fictionalPdf(seed: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`%PDF-1.4\n% Demo evidence ${seed}, invented for the WingChunRoots tests.\n%%EOF\n`);
}

async function upload(m: Pick<Member, 'principal'>, seed: string, caseId: string | null = null) {
  const bytes = fictionalPdf(seed);
  return uploadEvidence(m.principal, { declaredLength: bytes.length, body: new Response(bytes).body!, name: encodeURIComponent(`demo-${seed}.pdf`), caseId }, meta, store);
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as { code?: string } | null;
  return error?.code ?? 'OK';
}

async function events(relationshipId: string) {
  return getDb()
    .select({ from: relationshipEvent.fromStatus, to: relationshipEvent.toStatus, actor: relationshipEvent.actorUserId, role: relationshipEvent.actorRole, reason: relationshipEvent.reason })
    .from(relationshipEvent)
    .where(eq(relationshipEvent.relationshipId, relationshipId))
    .orderBy(asc(relationshipEvent.createdAt), asc(relationshipEvent.id));
}

async function auditsOf(subjectId: string) {
  return getDb()
    .select({ action: auditLog.action, actor: auditLog.actorUserId, role: auditLog.actorRole, before: auditLog.before, after: auditLog.after, reason: auditLog.reason })
    .from(auditLog)
    .where(eq(auditLog.subjectId, subjectId))
    .orderBy(asc(auditLog.createdAt), asc(auditLog.id));
}

async function caseEvents(caseId: string) {
  return getDb()
    .select({ action: reviewEvent.action, from: reviewEvent.fromStatus, to: reviewEvent.toStatus, actor: reviewEvent.actorUserId })
    .from(reviewEvent)
    .where(eq(reviewEvent.reviewCaseId, caseId))
    .orderBy(asc(reviewEvent.createdAt), asc(reviewEvent.id));
}

async function isPublicPerson(id: string): Promise<boolean> {
  const result = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM v_public_person WHERE id = ${id}::uuid`);
  return result.rows[0]!.n === 1;
}

async function isPublicEdge(relationshipId: string): Promise<boolean> {
  const result = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM v_public_edge WHERE id = ${relationshipId}::uuid`);
  return result.rows[0]!.n === 1;
}

async function relationship(id: string) {
  const [row] = await getDb().select().from(teachingRelationship).where(eq(teachingRelationship.id, id));
  return row!;
}

/** The template data of the e-mails of one template to one address, oldest first, sealed fields opened. */
async function mails(template: string, to: string): Promise<Record<string, unknown>[]> {
  const rows = await getDb().execute<{ data: EmailSendJob }>(sql`
    SELECT j.data FROM pgboss.job j JOIN email_delivery d ON d.id::text = j.data ->> 'deliveryId'
     WHERE j.name = 'email.send' AND d.template = ${template} AND d.to_email = ${to}
     ORDER BY d.created_at ASC, d.id ASC`);
  return rows.rows.map((r) => jobTemplateData(r.data) as Record<string, unknown>);
}

/** The token of the newest invitation e-mail to an address (the e-mail is the only place it is). */
async function tokenSentTo(email: string): Promise<string> {
  const all = await mails('invitation', email);
  const url = new URL(String(all.at(-1)!.url));
  return url.pathname.replace('/invite/', '');
}

/** A name of letters only from a label: "not-verified" → "Notverified" (names refuse digits). */
const titleCase = (label: string) => {
  const letters = label.replace(/[^A-Za-z]/g, '').toLowerCase();
  return letters.charAt(0).toUpperCase() + letters.slice(1);
};

let addresses = 0;
const teacherAddress = (label: string) => `demo-invited-${label}-${(addresses += 1)}@example.test`;

/** A student invites a new teacher record by e-mail, optionally with evidence. */
async function invite(label: string, opts: { evidence?: boolean } = {}) {
  const student = await member(`m10b-student-${label}`);
  const file = opts.evidence ? await upload(student, `invite-${label}`) : null;
  const email = teacherAddress(label);
  const result = await inviteTeacher(
    student.principal,
    { teacherName: `Demo Invited ${titleCase(label)}`, lineageId, periods: ongoingFrom('2012-09'), email, evidenceIds: file ? [file.id] : [], idempotencyKey: key() },
    meta,
  );
  const rel = await relationship(result.relationship.id);
  return { student, file, email, result, relationshipId: rel.id, teacherId: rel.teacherPersonId, token: await tokenSentTo(email) };
}

/**
 * An account without a profile: the invitee who signs up from the e-mail and chooses the Sifu
 * account type (approving students needs one, M08).
 */
async function newcomer(label: string) {
  const m = await member(`m10b-newcomer-${label}`, { sifu: true });
  // No profile of its own: the account is a fresh sign-up, with the confirmations sign-up records.
  await getDb().delete(person).where(eq(person.id, m.personId));
  await getDb().transaction((tx) => grantConsents(tx, m.account.id, 'user', REQUIRED_SIGN_UP_CONSENTS, meta));
  return m;
}

async function decide(reviewer: Awaited<ReturnType<typeof staff>>, caseId: string, decision: 'verify' | 'reject' | 'needs_info', reason: string | null = null) {
  await assignReviewCase(reviewer.principal, { caseId, assigneeId: reviewer.account.id, idempotencyKey: key() }, meta);
  return decideReviewCase(reviewer.principal, { caseId, decision, reason, idempotencyKey: key() }, meta);
}

describe('the invitation token', () => {
  it('is stored only as its SHA-256, sealed in the e-mail job, and works for 14 days', async () => {
    const { token, relationshipId, email } = await invite('hash');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    const [row] = await getDb().select().from(invitation).where(eq(invitation.relationshipId, relationshipId));
    expect(row!.tokenHash).toBe(hashToken(token));
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // The raw token is in no column of the invitation, and in no job in clear (the link is sealed).
    const asText = await getDb().execute<{ row: string }>(sql`SELECT row_to_json(i)::text AS row FROM invitation i WHERE i.id = ${row!.id}::uuid`);
    expect(asText.rows[0]!.row).not.toContain(token);
    const jobs = await getDb().execute<{ data: string }>(sql`
      SELECT j.data::text AS data FROM pgboss.job j JOIN email_delivery d ON d.id::text = j.data ->> 'deliveryId'
       WHERE d.template = 'invitation' AND d.to_email = ${email}`);
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]!.data).not.toContain(token);
    // The audit rows carry no address and no token.
    for (const audit of [...(await auditsOf(row!.id)), ...(await auditsOf(relationshipId))]) {
      expect(JSON.stringify(audit)).not.toContain(email);
      expect(JSON.stringify(audit)).not.toContain(token);
    }
    const days = (row!.expiresAt.getTime() - row!.createdAt.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(INVITATION_DAYS, 3);
    expect((await getInvitation(null, { token })).state).toBe('pending');
  });

  it('answers an unknown, malformed or revoked token with the same 404, and an expired one as expired', async () => {
    const { token, student, relationshipId, email } = await invite('expiry');
    const unknown = Buffer.alloc(32, 7).toString('base64url');
    expect(await refusal(getInvitation(null, { token: unknown }))).toBe('NOT_FOUND');
    expect(await refusal(getInvitation(null, { token: 'not-a-token' }))).toBe('NOT_FOUND');
    expect(await refusal(getInvitation(null, { token: hashToken(token) }))).toBe('NOT_FOUND');
    const invitee = await newcomer('expiry');
    expect(await refusal(acceptInvitation(invitee.principal, { token: unknown, idempotencyKey: key() }, meta))).toBe('NOT_FOUND');

    // Expired: shown as such, refused, and the relationship still waits.
    await getDb().update(invitation).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitation.tokenHash, hashToken(token)));
    expect((await getInvitation(invitee.principal, { token })).state).toBe('expired');
    expect((await getInvitation(invitee.principal, { token })).teacherNames).toBeNull();
    expect(await refusal(acceptInvitation(invitee.principal, { token, idempotencyKey: key() }, meta))).toBe('CONFLICT');
    expect((await relationship(relationshipId)).status).toBe('awaiting_claim');

    // A new link: the old one is revoked, the new one works.
    await sendInvitation(student.principal, { relationshipId, email, idempotencyKey: key() }, meta);
    const fresh = await tokenSentTo(email);
    expect(fresh).not.toBe(token);
    expect((await getInvitation(null, { token })).state).toBe('revoked');
    expect((await getInvitation(null, { token: fresh })).state).toBe('pending');
    const rows = await getDb().select({ status: invitation.status }).from(invitation).where(eq(invitation.relationshipId, relationshipId)).orderBy(asc(invitation.createdAt));
    expect(rows.map((r) => r.status)).toEqual(['revoked', 'pending']);
  });

  it('works once: a second account finds it used, and the student cannot accept their own invitation', async () => {
    const { token, student } = await invite('once');
    expect(await refusal(acceptInvitation(student.principal, { token, idempotencyKey: key() }, meta))).toBe('CONFLICT');
    const first = await newcomer('once-a');
    const second = await newcomer('once-b');
    const k = key();
    const accepted = await acceptInvitation(first.principal, { token, note: 'I am the fictional teacher.', idempotencyKey: k }, meta);
    // The same call again replays; a new call, from anyone, is refused.
    expect(await acceptInvitation(first.principal, { token, idempotencyKey: k }, meta)).toEqual({ caseId: accepted.caseId, replayed: true });
    expect(await refusal(acceptInvitation(first.principal, { token, idempotencyKey: key() }, meta))).toBe('CONFLICT');
    expect(await refusal(acceptInvitation(second.principal, { token, idempotencyKey: key() }, meta))).toBe('CONFLICT');
    expect((await getInvitation(first.principal, { token })).state).toBe('yours');
    expect((await getInvitation(first.principal, { token })).viewer.caseId).toBe(accepted.caseId);
    const other = await getInvitation(second.principal, { token });
    expect(other.state).toBe('used');
    expect(other.teacherNames).toBeNull();
    expect(other.studentNames).toBeNull();
  });

  it('refuses an account that has a profile of its own', async () => {
    const { token } = await invite('own-profile');
    const someone = await member('m10b-has-profile');
    expect((await getInvitation(someone.principal, { token })).viewer.refusal).toMatch(/already has its own profile/);
    expect(await refusal(acceptInvitation(someone.principal, { token, idempotencyKey: key() }, meta))).toBe('CONFLICT');
  });

  it('skips onboarding for the invitee, never the confirmation of the current documents', async () => {
    const { token, student, relationshipId } = await invite('documents');
    const invitee = await newcomer('documents');
    const here = `/invite/${token}`;
    expect(await landingPath(invitee.principal, here)).toBe(here);
    // The terms get a new version after the account signed up: it confirms them before it claims.
    await getDb()
      .update(consentRecord)
      .set({ documentVersion: '2000-01-01-demo-old' })
      .where(and(eq(consentRecord.userId, invitee.account.id), eq(consentRecord.kind, 'terms')));
    expect(await landingPath(invitee.principal, here)).toBe(`/onboarding?next=${encodeURIComponent(here)}`);
    const asked = await getInvitation(invitee.principal, { token });
    expect(asked.viewer).toMatchObject({ confirmDocuments: true, refusal: expect.stringMatching(/confirm the current version/) });
    expect(await refusal(acceptInvitation(invitee.principal, { token, idempotencyKey: key() }, meta))).toBe('CONFLICT');
    await recordConsents(invitee.principal, { kinds: ['terms'] }, meta);
    expect(await landingPath(invitee.principal, here)).toBe(here);
    expect((await getInvitation(invitee.principal, { token })).viewer).toMatchObject({ confirmDocuments: false, refusal: null });
    const { caseId } = await acceptInvitation(invitee.principal, { token, idempotencyKey: key() }, meta);
    // While the claim waits: no onboarding (the profile comes with the claim), and the link says so.
    expect(await landingPath(invitee.principal, undefined)).toBe('/dashboard');
    expect((await getInvitation(invitee.principal, { token })).viewer.claimStatus).toBe('pending');
    // The student withdraws the request: the claim closes, and its history keeps where it was.
    await withdrawRelationship(student.principal, { relationshipId, idempotencyKey: key() }, meta);
    expect((await getInvitation(invitee.principal, { token })).viewer.claimStatus).toBe('withdrawn');
    expect((await caseEvents(caseId)).map((e) => [e.action, e.from, e.to])).toEqual([
      ['open', null, 'open'],
      ['withdraw', 'open', 'dismissed'],
    ]);
    // awaiting_claim → withdrawn is a relationship transition like any other: its event and audit row.
    expect(await events(relationshipId)).toEqual([
      { from: null, to: 'awaiting_claim', actor: student.account.id, role: 'student', reason: null },
      { from: 'awaiting_claim', to: 'withdrawn', actor: student.account.id, role: 'student', reason: null },
    ]);
    const withdrawn = (await auditsOf(relationshipId)).filter((a) => a.action === 'relationship.withdraw');
    expect(withdrawn).toEqual([
      expect.objectContaining({ actor: student.account.id, role: 'user', before: { status: 'awaiting_claim' }, after: { status: 'withdrawn', dismissedCaseIds: [caseId] } }),
    ]);
  });

  it('revokes a pending invitation when the student withdraws the request, with the relationship_event and the audit row', async () => {
    const { token, student, relationshipId } = await invite('withdrawn');
    const [pending] = await getDb().select({ id: invitation.id }).from(invitation).where(eq(invitation.relationshipId, relationshipId));
    await withdrawRelationship(student.principal, { relationshipId, idempotencyKey: key() }, meta);
    expect((await relationship(relationshipId)).status).toBe('withdrawn');
    expect((await getInvitation(null, { token })).state).toBe('revoked');
    const [row] = await getDb().select({ status: invitation.status }).from(invitation).where(eq(invitation.id, pending!.id));
    expect(row!.status).toBe('revoked');
    expect((await events(relationshipId)).map((e) => [e.from, e.to, e.role])).toEqual([
      [null, 'awaiting_claim', 'student'],
      ['awaiting_claim', 'withdrawn', 'student'],
    ]);
    const withdrawn = (await auditsOf(relationshipId)).filter((a) => a.action === 'relationship.withdraw');
    expect(withdrawn).toEqual([
      expect.objectContaining({ actor: student.account.id, before: { status: 'awaiting_claim' }, after: { status: 'withdrawn', revokedInvitationIds: [pending!.id] } }),
    ]);
  });
});

describe('the profile claim', () => {
  it('moves awaiting_claim → pending_teacher only after an approved claim; the invitee opens the evidence only then; every transition is recorded', async () => {
    const { token, student, file, relationshipId, teacherId, email } = await invite('claim', { evidence: true });
    const invitee = await newcomer('claim');
    const archivist = await staff('m10b-archivist-claim', 'archivist');
    const moderator = await staff('m10b-moderator-claim', 'moderator');

    // The invited record and the link are private; the student's evidence never reaches the link page.
    expect(await isPublicPerson(teacherId)).toBe(false);
    expect(await isPublicEdge(relationshipId)).toBe(false);
    const page = await getInvitation(null, { token });
    expect(page.unclaimedRecord).toBe(true);
    expect(JSON.stringify(page)).not.toContain(file!.id);
    expect(JSON.stringify(page)).not.toContain('demo-invite-claim.pdf');
    expect(JSON.stringify(page)).not.toContain(email);
    expect(await refusal(openEvidence(invitee.principal, file!.id, meta, store))).toBe('NOT_FOUND');

    const { caseId } = await acceptInvitation(invitee.principal, { token, idempotencyKey: key() }, meta);
    // Accepted, not approved: still awaiting_claim, involved_only, unclaimed, private; no evidence.
    expect((await relationship(relationshipId)).status).toBe('awaiting_claim');
    expect((await relationship(relationshipId)).visibility).toBe('involved_only');
    const [record] = await getDb().select().from(person).where(eq(person.id, teacherId));
    expect(record!.stewardship).toBe('unclaimed');
    expect(record!.claimedByUserId).toBeNull();
    expect(await refusal(openEvidence(invitee.principal, file!.id, meta, store))).toBe('NOT_FOUND');
    expect(await refusal(getRelationship(invitee.principal, { id: relationshipId }))).toBe('NOT_FOUND');
    expect(await refusal(approveRelationship(invitee.principal, { relationshipId, idempotencyKey: key() }, meta))).not.toBe('OK');
    const party = await getPartyCase(invitee.principal, { id: caseId });
    expect(party.kind).toBe('person_claim');
    expect(party.record?.unclaimed).toBe(true);
    expect(party.files).toEqual([]);
    expect(JSON.stringify(party)).not.toContain(file!.id);
    expect((await myCases(invitee.principal)).cases.map((c) => c.id)).toContain(caseId);
    // Strangers, the student included, get 404 for the claim case.
    expect(await refusal(getPartyCase(student.principal, { id: caseId }))).toBe('NOT_FOUND');
    expect(await refusal(getPartyCase((await member('m10b-stranger')).principal, { id: caseId }))).toBe('NOT_FOUND');

    // Who decides: a moderator does not verify a claim; an archivist only on a case they took.
    expect(await refusal(decideReviewCase(archivist.principal, { caseId, decision: 'verify', reason: null, idempotencyKey: key() }, meta))).toBe('FORBIDDEN');
    await assignReviewCase(moderator.principal, { caseId, assigneeId: moderator.account.id, idempotencyKey: key() }, meta);
    expect(await refusal(decideReviewCase(moderator.principal, { caseId, decision: 'verify', reason: null, idempotencyKey: key() }, meta))).toBe('FORBIDDEN');
    await assignReviewCase(moderator.principal, { caseId, assigneeId: null, idempotencyKey: key() }, meta);
    expect((await relationship(relationshipId)).status).toBe('awaiting_claim');

    await decide(archivist, caseId, 'verify');
    expect((await getInvitation(invitee.principal, { token })).viewer.claimStatus).toBe('approved');
    const rel = await relationship(relationshipId);
    expect(rel.status).toBe('pending_teacher');
    expect(rel.visibility).toBe('involved_only');
    const [claimed] = await getDb().select().from(person).where(eq(person.id, teacherId));
    expect(claimed!.claimedByUserId).toBe(invitee.account.id);
    expect(claimed!.stewardship).toBe('self');
    expect(claimed!.visibility).toBe('involved_only');
    expect(await isPublicPerson(teacherId)).toBe(false);
    const [pc] = await getDb().select().from(personClaim).where(eq(personClaim.reviewCaseId, caseId));
    expect(pc!.status).toBe('approved');
    // Now the record is the invitee's: they open the student's evidence as the teacher.
    expect((await openEvidence(invitee.principal, file!.id, meta, store)).id).toBe(file!.id);

    // The teacher approves the request: verified and public (M09), both people public.
    await approveRelationship(invitee.principal, { relationshipId, idempotencyKey: key() }, meta);
    expect((await relationship(relationshipId)).status).toBe('verified');
    expect(await isPublicEdge(relationshipId)).toBe(true);
    expect(await isPublicPerson(teacherId)).toBe(true);

    // Every relationship transition: a relationship_event and an audit row.
    expect(await events(relationshipId)).toEqual([
      { from: null, to: 'awaiting_claim', actor: student.account.id, role: 'student', reason: null },
      { from: 'awaiting_claim', to: 'pending_teacher', actor: archivist.account.id, role: 'archivist', reason: 'person_claim_approved' },
      expect.objectContaining({ from: 'pending_teacher', to: 'verified', actor: invitee.account.id }),
    ]);
    const relAudits = (await auditsOf(relationshipId)).map((a) => a.action);
    expect(relAudits).toEqual(expect.arrayContaining(['relationship.request', 'relationship.claimed', 'relationship.approve']));
    expect(relAudits.indexOf('relationship.request')).toBeLessThan(relAudits.indexOf('relationship.claimed'));
    expect(relAudits.indexOf('relationship.claimed')).toBeLessThan(relAudits.indexOf('relationship.approve'));
    const personAudits = await auditsOf(teacherId);
    expect(personAudits.map((a) => [a.action, (a.after as { status?: string } | null)?.status ?? null])).toEqual(
      expect.arrayContaining([
        ['person.create', null],
        ['person.claim', 'pending'],
        ['person.claim', 'approved'],
      ]),
    );
    expect((await caseEvents(caseId)).map((e) => [e.action, e.to])).toEqual([
      ['open', 'open'],
      ['assign', 'in_review'],
      ['unassign', 'open'],
      ['assign', 'in_review'],
      ['approve', 'resolved'],
    ]);
    // The claimant's notice and e-mail; the student's notice at each stage.
    expect(await mails('claim-decided', invitee.account.email)).toEqual([expect.objectContaining({ decision: 'approved' })]);
    const studentNotes = await getDb()
      .select({ payload: notification.payload })
      .from(notification)
      .where(and(eq(notification.userId, student.account.id), eq(notification.template, 'invitation.claimed')))
      .orderBy(asc(notification.createdAt));
    expect(studentNotes.map((n) => (n.payload as { stage: string }).stage)).toEqual(['claimed', 'approved']);
  });

  it('keeps the request awaiting_claim when the claim is refused; the student may invite again', async () => {
    const { token, student, file, relationshipId, teacherId, email } = await invite('refused', { evidence: true });
    const invitee = await newcomer('refused');
    const archivist = await staff('m10b-archivist-refused', 'archivist');
    const { caseId } = await acceptInvitation(invitee.principal, { token, idempotencyKey: key() }, meta);
    // While the claim waits, no new invitation.
    expect(await refusal(sendInvitation(student.principal, { relationshipId, email, idempotencyKey: key() }, meta))).toBe('CONFLICT');
    expect(await refusal(decideReviewCase(archivist.principal, { caseId, decision: 'reject', reason: null, idempotencyKey: key() }, meta))).not.toBe('OK');
    await decide(archivist, caseId, 'reject', 'The fictional details do not match the record.');
    expect((await relationship(relationshipId)).status).toBe('awaiting_claim');
    const [record] = await getDb().select().from(person).where(eq(person.id, teacherId));
    expect(record!.claimedByUserId).toBeNull();
    expect(record!.stewardship).toBe('unclaimed');
    expect(await refusal(openEvidence(invitee.principal, file!.id, meta, store))).toBe('NOT_FOUND');
    const [pc] = await getDb().select().from(personClaim).where(eq(personClaim.reviewCaseId, caseId));
    expect(pc!.status).toBe('rejected');
    // The link the invitee opens again says the claim was refused, not that the profile is theirs.
    expect((await getInvitation(invitee.principal, { token })).viewer).toMatchObject({ caseId, claimStatus: 'rejected' });
    // No relationship transition: only the student's request.
    expect((await events(relationshipId)).map((e) => e.to)).toEqual(['awaiting_claim']);
    const view = await getPartyCase(invitee.principal, { id: caseId });
    expect(view.decision).toEqual({ resolution: 'rejected', reason: 'The fictional details do not match the record.' });
    expect(await mails('claim-decided', invitee.account.email)).toEqual([expect.objectContaining({ decision: 'rejected' })]);
    // The student sends a new link.
    const again = await sendInvitation(student.principal, { relationshipId, email, idempotencyKey: key() }, meta);
    expect(again.invited).toBe(true);
    expect((await getInvitation(null, { token: await tokenSentTo(email) })).state).toBe('pending');
  });

  it('shows the inviting student only the names of the claimed record until the teacher answers (plan §6.4)', async () => {
    const { token, student, relationshipId, teacherId } = await invite('private-after-claim');
    const invitee = await newcomer('private-after-claim');
    const archivist = await staff('m10b-archivist-private', 'archivist');
    const [record] = await getDb().select({ slug: person.slug }).from(person).where(eq(person.id, teacherId));
    const slug = record!.slug;
    const teacherNode = async () => {
      const graph = await lineageEgo(student.principal, { focusId: student.personId, up: 1, down: 0, fanoutLimit: 50 });
      return graph.nodes.find((n) => n.id === teacherId);
    };
    // Before the claim the record is the student's own work, nobody else's: they read all of it.
    expect(await personProfile(student.principal, { slug })).toMatchObject({ limited: false, claimState: 'unclaimed', lifeStatus: 'living' });

    const { caseId } = await acceptInvitation(invitee.principal, { token, idempotencyKey: key() }, meta);
    await decide(archivist, caseId, 'verify');
    expect((await relationship(relationshipId)).status).toBe('pending_teacher');
    // The record is the teacher's now: they write a biography and a country, and keep the profile private.
    const bio = 'Demo private biography of the fictional invited teacher.';
    await profileUpdate(
      invitee.principal,
      {
        names: [{ kind: 'name', value: 'Demo Invited Privateafterclaim', script: 'Latn', lang: 'und-Latn', romanization: null, isPrimary: true }],
        bio: { body: bio, lang: 'en' },
        countryCode: 'BG',
        showPublicly: false,
      },
      meta,
    );
    expect((await personProfile(invitee.principal, { slug })).bio).toBe(bio);

    // The teacher has not answered the student's request: people.get and the lineage view give the
    // student the names only, as for any other unanswered request.
    const seen = await personProfile(student.principal, { slug });
    expect(seen).toMatchObject({ limited: true, bio: null, countryCode: null, cityName: null, kind: 'unknown', lifeStatus: 'unknown', claimState: 'unknown' });
    expect(JSON.stringify(seen)).not.toContain(bio);
    expect(await teacherNode()).toMatchObject({ lifeStatus: 'unknown', claimState: 'unknown' });

    // Once the teacher approves, the student reads the full record (the answered request).
    await approveRelationship(invitee.principal, { relationshipId, idempotencyKey: key() }, meta);
    expect(await personProfile(student.principal, { slug })).toMatchObject({ limited: false, bio, countryCode: 'BG' });
  });

  it('keeps an invited record out of v_public_person and search until a link with it is verified', async () => {
    const { teacherId, relationshipId } = await invite('searchable');
    const name = 'Demo Invited Searchable';
    const slugs = async () => (await searchQuery(null, { q: name })).people.map((p) => p.slug);
    const [record] = await getDb().select({ slug: person.slug }).from(person).where(eq(person.id, teacherId));
    expect(await isPublicPerson(teacherId)).toBe(false);
    expect(await slugs()).not.toContain(record!.slug);
    expect(await isPublicEdge(relationshipId)).toBe(false);
  });
});

describe('instructor verification', () => {
  it('shows a self-declared Sifu as unverified until an archivist approves the evidence (audit instructor.verify)', async () => {
    const sifu = await member('m10b-sifu', { sifu: true });
    const archivist = await staff('m10b-archivist-instructor', 'archivist');
    const status = async () => (await getDb().execute<{ s: string }>(sql`SELECT instructor_status AS s FROM v_public_person WHERE id = ${sifu.personId}::uuid`)).rows[0]!.s;
    expect(await status()).toBe('unverified');
    expect((await instructorOverview(sifu.principal)).status).toBe('unverified');
    // Evidence is required.
    expect(await refusal(requestInstructorVerification(sifu.principal, { evidenceIds: [], idempotencyKey: key() }, meta))).toBe('BAD_REQUEST');
    // A student account cannot ask.
    const learner = await member('m10b-learner');
    const learnerFile = await upload(learner, 'learner');
    expect(await refusal(requestInstructorVerification(learner.principal, { evidenceIds: [learnerFile.id], idempotencyKey: key() }, meta))).toBe('CONFLICT');

    const file = await upload(sifu, 'instructor');
    const { caseId } = await requestInstructorVerification(sifu.principal, { evidenceIds: [file.id], note: 'A fictional certificate.', idempotencyKey: key() }, meta);
    const second = await upload(sifu, 'instructor-2');
    expect(await refusal(requestInstructorVerification(sifu.principal, { evidenceIds: [second.id], idempotencyKey: key() }, meta))).toBe('CONFLICT');
    expect(await status()).toBe('unverified');
    // A moderator does not verify an instructor.
    const moderator = await staff('m10b-moderator-instructor', 'moderator');
    await assignReviewCase(moderator.principal, { caseId, assigneeId: moderator.account.id, idempotencyKey: key() }, meta);
    expect(await refusal(decideReviewCase(moderator.principal, { caseId, decision: 'verify', reason: null, idempotencyKey: key() }, meta))).toBe('FORBIDDEN');
    await assignReviewCase(moderator.principal, { caseId, assigneeId: null, idempotencyKey: key() }, meta);

    await decide(archivist, caseId, 'verify');
    expect(await status()).toBe('verified');
    expect((await instructorOverview(sifu.principal)).status).toBe('verified');
    const audits = await auditsOf(sifu.personId);
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['instructor.request', 'instructor.verify']));
    expect(audits.find((a) => a.action === 'instructor.verify')).toMatchObject({ actor: archivist.account.id, role: 'archivist', after: { instructor: 'verified', caseId } });
    expect(await mails('instructor-decided', sifu.account.email)).toEqual([expect.objectContaining({ decision: 'verified' })]);
    expect((await caseEvents(caseId)).map((e) => e.action)).toEqual(['open', 'assign', 'unassign', 'assign', 'approve']);
    expect(await refusal(requestInstructorVerification(sifu.principal, { evidenceIds: [second.id], idempotencyKey: key() }, meta))).toBe('CONFLICT');
  });
});

describe('"Report profile"', () => {
  it('opens one review case per account and profile (a unique index), never hides the profile by itself', async () => {
    const target = await member('m10b-reported');
    const reporter = await member('m10b-reporter');
    const moderator = await staff('m10b-moderator-report', 'moderator');
    const { caseId } = await reportProfile(reporter.principal, { personId: target.personId, reason: 'spam', details: 'Fictional advertising.', idempotencyKey: key() }, meta);
    const [c] = await getDb().select().from(reviewCase).where(eq(reviewCase.id, caseId));
    expect(c).toMatchObject({ kind: 'profile_report', status: 'open', personId: target.personId, openedByUserId: reporter.account.id });
    expect(await refusal(reportProfile(reporter.principal, { personId: target.personId, reason: 'misleading', idempotencyKey: key() }, meta))).toBe('CONFLICT');
    // The database refuses a second row too, whatever the service does.
    const direct = await getDb()
      .insert(contentReport)
      .values({ subjectType: 'person', subjectId: target.personId, reason: 'copyright', reporterUserId: reporter.account.id })
      .then(
        () => null,
        (e: unknown) => pgErrorOf(e),
      );
    expect(direct).toMatchObject({ code: '23505', constraint: 'content_report_one_per_reporter_key' });
    // Nobody reports their own profile; a profile that is not public is not found.
    expect(await refusal(reportProfile(target.principal, { personId: target.personId, reason: 'spam', idempotencyKey: key() }, meta))).toBe('FORBIDDEN');
    const hidden = await member('m10b-hidden', { hidden: true });
    expect(await refusal(reportProfile(reporter.principal, { personId: hidden.personId, reason: 'spam', idempotencyKey: key() }, meta))).toBe('NOT_FOUND');
    // No automatic hiding.
    expect(await isPublicPerson(target.personId)).toBe(true);
    expect((await auditsOf(target.personId)).map((a) => a.action)).toContain('report.create');
    // A moderator upholds it: the report is resolved, the profile still public (put right by an edit).
    await decide(moderator, caseId, 'verify', 'Fictional: the advertising was removed with an edit.');
    const [report] = await getDb().select().from(contentReport).where(eq(contentReport.reviewCaseId, caseId));
    expect(report!.status).toBe('resolved');
    expect(await isPublicPerson(target.personId)).toBe(true);
    expect((await caseEvents(caseId)).map((e) => e.action)).toEqual(['open', 'assign', 'approve']);
  });
});

describe('arbitration', () => {
  async function verifiedLink(label: string) {
    const { token, student, relationshipId, teacherId } = await invite(label);
    const teacher = await newcomer(label);
    const archivist = await staff(`m10b-archivist-${label}`, 'archivist');
    const { caseId } = await acceptInvitation(teacher.principal, { token, idempotencyKey: key() }, meta);
    await decide(archivist, caseId, 'verify');
    await approveRelationship(teacher.principal, { relationshipId, idempotencyKey: key() }, meta);
    return { student, teacher, relationshipId, teacherId };
  }

  it('is set by a moderator with the second factor and a reason; both parties get the reason and the link; the decision is recorded', async () => {
    const { student, teacher, relationshipId } = await verifiedLink('arbitrated');
    const moderator = await staff('m10b-moderator-arbitration', 'moderator');
    const unverified = await staff('m10b-moderator-no-2fa', 'moderator', { unverified: true });
    const archivist = await staff('m10b-archivist-arbitration', 'archivist');
    const reason = 'Fictional: another student reports different training years.';

    expect(await refusal(arbitrateRelationship(student.principal, { relationshipId, reason, idempotencyKey: key() }, meta))).toBe('FORBIDDEN');
    expect(await refusal(arbitrateRelationship(unverified.principal, { relationshipId, reason, idempotencyKey: key() }, meta))).toBe('SECOND_FACTOR_REQUIRED');
    expect(await refusal(arbitrateRelationship(archivist.principal, { relationshipId, reason, idempotencyKey: key() }, meta))).toBe('FORBIDDEN');
    expect(await refusal(arbitrateRelationship(moderator.principal, { relationshipId, reason: '   ', idempotencyKey: key() }, meta))).toBe('BAD_REQUEST');
    expect((await relationship(relationshipId)).status).toBe('verified');

    const { caseId } = await arbitrateRelationship(moderator.principal, { relationshipId, reason, idempotencyKey: key() }, meta);
    expect(await refusal(arbitrateRelationship(moderator.principal, { relationshipId, reason, idempotencyKey: key() }, meta))).toBe('CONFLICT');
    // In arbitration and still public: the pages say "Disputed".
    expect((await relationship(relationshipId)).status).toBe('in_arbitration');
    const edge = await getDb().execute<{ status: string }>(sql`SELECT status FROM v_public_edge WHERE id = ${relationshipId}::uuid`);
    expect(edge.rows).toEqual([{ status: 'in_arbitration' }]);
    const [c] = await getDb().select().from(reviewCase).where(eq(reviewCase.id, caseId));
    expect(c).toMatchObject({ kind: 'relationship_dispute', status: 'needs_info', relationshipId, assignedToUserId: moderator.account.id });
    const arbitration = (await auditsOf(relationshipId)).find((a) => a.action === 'relationship.arbitration');
    expect(arbitration).toMatchObject({ actor: moderator.account.id, role: 'moderator', reason, after: { status: 'in_arbitration', caseId } });

    // Both parties: a notification and an e-mail with the reason and the evidence link.
    for (const [m, role] of [
      [student, 'student'],
      [teacher, 'teacher'],
    ] as const) {
      const [note] = await getDb()
        .select({ payload: notification.payload })
        .from(notification)
        .where(and(eq(notification.userId, m.account.id), eq(notification.template, 'relationship.arbitration')));
      expect(note!.payload).toMatchObject({ relationshipId, caseId, stage: 'opened', reason });
      const sent = await mails('relationship-arbitration', m.account.email);
      expect(sent).toEqual([expect.objectContaining({ stage: 'opened', role, reason })]);
      expect(new URL(String(sent[0]!.url)).pathname).toBe(`/dashboard/cases/${caseId}`);
      const view = await getPartyCase(m.principal, { id: caseId });
      expect(view.role).toBe(role);
      expect(view.messages).toEqual([expect.objectContaining({ fromYou: false, body: reason })]);
      expect(view.canAddFiles).toBe(true);
    }
    expect(await refusal(getPartyCase((await member('m10b-arb-stranger')).principal, { id: caseId }))).toBe('NOT_FOUND');

    // Each party's replies and files stay their own (DEFAULT D19).
    const file = await upload(student, 'dispute', caseId);
    await replyToCase(student.principal, { caseId, body: 'Fictional: my training card is attached.', idempotencyKey: key() }, meta);
    expect((await getPartyCase(student.principal, { id: caseId })).files.map((f) => f.id)).toEqual([file.id]);
    const teacherView = await getPartyCase(teacher.principal, { id: caseId });
    expect(teacherView.messages.map((m) => m.body)).toEqual([reason]);
    expect(teacherView.files).toEqual([]);
    expect(await refusal(openEvidence(teacher.principal, file.id, meta, store))).toBe('NOT_FOUND');
    expect((await openEvidence(moderator.principal, file.id, meta, store)).id).toBe(file.id);
    const [afterReply] = await getDb().select({ status: reviewCase.status }).from(reviewCase).where(eq(reviewCase.id, caseId));
    expect(afterReply!.status).toBe('in_review');
    // The reviewer's card says whose reply it is; only its deciders take a dispute, whose reviewer
    // opens both sides' files.
    const card = await getReviewCase(moderator.principal, { id: caseId });
    expect(card.notes.find((n) => n.body.startsWith('Fictional: my training card'))).toMatchObject({ author: 'claimant', authorSide: 'student' });
    expect((await getReviewCase(archivist.principal, { id: caseId })).can.assignSelf).toBe(false);
    expect(await refusal(assignReviewCase(archivist.principal, { caseId, assigneeId: archivist.account.id, idempotencyKey: key() }, meta))).toBe('FORBIDDEN');
    const admin = await staff('m10b-admin-arbitration', 'admin');
    expect(await refusal(assignReviewCase(admin.principal, { caseId, assigneeId: archivist.account.id, idempotencyKey: key() }, meta))).toBe('BAD_REQUEST');
    expect((await getReviewCase(admin.principal, { id: caseId })).reviewers.map((r) => r.id)).not.toContain(archivist.account.id);
    // A member of staff who is a party (the teacher, made an administrator for this check) reads the
    // card as the parties do: never the other side's reply or file.
    await getDb().update(authUser).set({ role: 'admin', twoFactorEnabled: true }).where(eq(authUser.id, teacher.account.id));
    const asParty = await getReviewCase(principalOf(teacher.account, 'admin'), { id: caseId });
    expect(asParty.notes.map((n) => n.body)).toEqual([reason]);
    expect(asParty.files).toEqual([]);
    expect(asParty.can).toMatchObject({ assignSelf: false, verify: false, reject: false, note: false });
    await getDb().update(authUser).set({ role: 'user', twoFactorEnabled: false }).where(eq(authUser.id, teacher.account.id));

    // The moderator revokes the link, with a reason both read: out of the public lineage.
    const decision = 'Fictional: the training years could not be confirmed.';
    expect(await refusal(decideReviewCase(moderator.principal, { caseId, decision: 'reject', reason: null, idempotencyKey: key() }, meta))).toBe('BAD_REQUEST');
    await decideReviewCase(moderator.principal, { caseId, decision: 'reject', reason: decision, idempotencyKey: key() }, meta);
    expect((await relationship(relationshipId)).status).toBe('revoked');
    expect(await isPublicEdge(relationshipId)).toBe(false);
    const all = await events(relationshipId);
    expect(all.slice(-2)).toEqual([
      { from: 'verified', to: 'in_arbitration', actor: moderator.account.id, role: 'moderator', reason: 'arbitration' },
      { from: 'in_arbitration', to: 'revoked', actor: moderator.account.id, role: 'moderator', reason: 'arbitration' },
    ]);
    expect((await auditsOf(relationshipId)).find((a) => a.action === 'relationship.revoke')).toMatchObject({ reason: decision, after: { status: 'revoked', caseId } });
    expect((await caseEvents(caseId)).map((e) => [e.action, e.to])).toEqual([
      ['open', 'needs_info'],
      // The file (back to the reviewers), then the reply.
      ['evidence', 'in_review'],
      ['evidence', 'in_review'],
      ['reject', 'resolved'],
    ]);
    for (const m of [student, teacher]) {
      expect((await mails('relationship-arbitration', m.account.email)).map((d) => [d.stage, d.reason])).toEqual([
        ['opened', reason],
        ['revoked', decision],
      ]);
    }
  });

  it('keeps the link verified when the moderator upholds it', async () => {
    const { relationshipId } = await verifiedLink('upheld');
    const moderator = await staff('m10b-moderator-upheld', 'moderator');
    const { caseId } = await arbitrateRelationship(moderator.principal, { relationshipId, reason: 'Fictional: a question about the dates.', idempotencyKey: key() }, meta);
    await decideReviewCase(moderator.principal, { caseId, decision: 'verify', reason: 'Fictional: the dates are confirmed.', idempotencyKey: key() }, meta);
    expect((await relationship(relationshipId)).status).toBe('verified');
    expect(await isPublicEdge(relationshipId)).toBe(true);
    expect((await events(relationshipId)).slice(-2).map((e) => [e.from, e.to])).toEqual([
      ['verified', 'in_arbitration'],
      ['in_arbitration', 'verified'],
    ]);
    expect((await auditsOf(relationshipId)).filter((a) => a.action === 'relationship.arbitration')).toHaveLength(2);
  });

  it('refuses a relationship that is not verified', async () => {
    const { relationshipId } = await invite('not-verified');
    const moderator = await staff('m10b-moderator-pending', 'moderator');
    expect(await refusal(arbitrateRelationship(moderator.principal, { relationshipId, reason: 'Fictional.', idempotencyKey: key() }, meta))).toBe('CONFLICT');
    expect((await relationship(relationshipId)).status).toBe('awaiting_claim');
  });
});
