// Account erasure (review 2026-11; docs/adr/0030-takedown-suspension-erasure.md), against a migrated
// throwaway database: the administrator's `accounts.erase` and the shared core of `pnpm account:delete`.
// A catalogue test reads every foreign key to auth_user from the database and fails when a table or a
// column is not in USER_REFERENCES (so a new table that refers to an account cannot be forgotten); a
// scenario test erases an account that has evidence, relationships (one pending), a certificate with
// its files, a school, an event, an invitation and more, and checks that nothing the catalogue calls
// delete or clear still refers to it, that the files are gone, that the row is a nameless tombstone
// and that the pending request cannot be approved. Fictional data only (D20).

import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { and, eq, sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { erasedEmail } from '../auth/suspension';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import {
  auditLog,
  authAccount,
  authSession,
  authUser,
  consentRecord,
  emailDelivery,
  event,
  evidenceFile,
  evidenceLink,
  invitation,
  notification,
  notificationPreference,
  organization,
  organizationAdmin,
  passportCertificate,
  passportRank,
  person,
  personBio,
  personName,
  place,
  relationshipEvent,
  reviewCase,
  reviewNote,
  school,
  teachingRelationship,
  trialInquiry,
} from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { createObjectStore, type ObjectStore } from '../storage';
import { eraseAccount, eraseAccountAsAdmin, USER_REFERENCES, USER_REFERENCES_WITHOUT_KEY } from './account-erasure';
import { approveRelationship } from './relationships';
import { key, member, meta, newLineage, principalOf, staff } from './relationships.test-support';
import { takeDownProfile } from './takedown';

const dropped = vi.hoisted(() => ({ tags: [] as string[] }));
vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: (tag: string) => void dropped.tags.push(tag),
  updateTag: (tag: string) => void dropped.tags.push(tag),
}));

let testDb: TestDatabase | undefined;
const storeRoot = mkdtempSync(path.join(tmpdir(), 'wcr-erasure-int-'));
let store: ObjectStore;
beforeAll(async () => {
  testDb = await startAuthTestDatabase();
  store = createObjectStore({ driver: 'filesystem', dir: storeRoot });
});
afterAll(async () => {
  await stopAuthTestDatabase(testDb);
  rmSync(storeRoot, { recursive: true, force: true });
});
beforeEach(() => {
  dropped.tags.length = 0;
});

const REASON = 'The member asked for the account to be erased, in writing.';
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
const filesInStore = () =>
  readdirSync(storeRoot, { recursive: true })
    .map(String)
    .filter((f) => statSync(path.join(storeRoot, f)).isFile())
    .map((f) => f.split(path.sep).join('/'));

/** The columns of the database that refer to auth_user, as the catalogue sees them. */
async function foreignKeysToUser(): Promise<string[]> {
  const rows = await getDb().execute<{ ref: string }>(sql`
    SELECT t.relname || '.' || a.attname AS ref
      FROM pg_constraint k
      JOIN pg_class t ON t.oid = k.conrelid
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
     WHERE k.contype = 'f' AND k.confrelid = 'auth_user'::regclass
     ORDER BY 1`);
  return rows.rows.map((r) => r.ref);
}

describe('the catalogue of references to an account', () => {
  it('lists every foreign key to auth_user, and nothing else', async () => {
    const inCatalogue = USER_REFERENCES.map((r) => `${r.table}.${r.column}`);
    const inDatabase = await foreignKeysToUser();
    // A new table with a user_id (or any column that refers to auth_user) must be added to
    // USER_REFERENCES in services/account-erasure.ts, with what erasure does to it.
    expect(inDatabase.filter((c) => !inCatalogue.includes(c))).toEqual([]);
    expect(inCatalogue.filter((c) => !inDatabase.includes(c))).toEqual([]);
    expect(new Set(inCatalogue).size).toBe(inCatalogue.length);
  });

  it('lists every other column that holds an account id without a key', async () => {
    const rows = await getDb().execute<{ ref: string }>(sql`
      SELECT c.table_name || '.' || c.column_name AS ref
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public'
         AND (c.column_name LIKE '%user\\_id%' OR c.column_name LIKE '%\\_by' OR c.column_name IN ('actor', 'author', 'reporter', 'appellant'))
         AND NOT EXISTS (
           SELECT 1 FROM pg_constraint k
             JOIN pg_class r ON r.oid = k.conrelid
             JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
            WHERE k.contype = 'f' AND k.confrelid = 'auth_user'::regclass AND r.relname = c.table_name AND a.attname = c.column_name)
       ORDER BY 1`);
    const known = USER_REFERENCES_WITHOUT_KEY.map((r) => `${r.table}.${r.column}`);
    expect(rows.rows.map((r) => r.ref).filter((c) => !known.includes(c))).toEqual([]);
  });

  it('only deletes or clears what the application role may delete or update', async () => {
    const privileges = await getDb().execute<{ ref: string; upd: boolean; del: boolean }>(sql`
      SELECT t.relname || '.' || a.attname AS ref, has_table_privilege('app_rw', t.oid, 'UPDATE') AS upd, has_table_privilege('app_rw', t.oid, 'DELETE') AS del
        FROM pg_constraint k
        JOIN pg_class t ON t.oid = k.conrelid
        JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
       WHERE k.contype = 'f' AND k.confrelid = 'auth_user'::regclass`);
    const by = new Map(privileges.rows.map((r) => [r.ref, r]));
    for (const ref of USER_REFERENCES) {
      const row = by.get(`${ref.table}.${ref.column}`)!;
      if (ref.action === 'delete') expect(row.del, `${ref.table}.${ref.column} is deleted`).toBe(true);
      if (ref.action === 'clear') expect(row.upd, `${ref.table}.${ref.column} is cleared`).toBe(true);
      // An append-only table (no UPDATE) cannot be cleared: it is `database` or `keep`.
      if (!row.upd) expect(['database', 'keep'], `${ref.table}.${ref.column} is append-only`).toContain(ref.action);
    }
  });

  it('gives each column a reason', () => {
    for (const ref of USER_REFERENCES) expect(ref.why.length, `${ref.table}.${ref.column}`).toBeGreaterThan(3);
  });
});

/** How many rows of `ref` still refer to the account. */
async function referencing(userId: string, table: string, column: string): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${userId}`);
  return rows.rows[0]!.n;
}

/** The leaver: a public self-kept profile with everything the erasure has to deal with. */
async function leaver() {
  const db = getDb();
  const leaverMember = await member('erase-leaver', { sifu: true });
  const userId = leaverMember.account.id;
  const personId = leaverMember.personId;
  const primaryName = (await db.select({ v: personName.value }).from(personName).where(and(eq(personName.personId, personId), eq(personName.isPrimary, true))))[0]!.v;
  const lineageId = await newLineage('erase');
  const teacher = await member('erase-teacher', { sifu: true });
  const other = await member('erase-other-teacher', { sifu: true });
  const student = await member('erase-student');
  const historical = uuidv7();
  await db.insert(person).values({ id: historical, slug: `demo-erase-historical-${hex(4)}`, kind: 'historical', lifeStatus: 'deceased', stewardship: 'platform', visibility: 'public' });
  await db.insert(personName).values({ personId: historical, value: 'Demo Erase Historical', script: 'Latn', lang: 'en', isPrimary: true });

  // The profile: a second name, a biography, a city and a year, and the leaver's own consents.
  await db.insert(personName).values({ personId, value: '離雲', script: 'Hant', lang: 'zh-Hant', isPrimary: false });
  await db.insert(personBio).values({ personId, body: 'A fictional biography to erase.', lang: 'en' });
  await db.update(person).set({ trainingStartYear: 2012, countryCode: 'BG', birthDate: '1990-01-01' }).where(eq(person.id, personId));
  await db.insert(consentRecord).values([
    { userId, kind: 'terms', documentVersion: '1', action: 'granted' },
    { userId, kind: 'publication', documentVersion: '1', action: 'granted' },
  ]);
  await db.insert(notification).values({ userId, template: 'review.updated', payload: { caseId: uuidv7(), change: 'x' } });
  await db.insert(notificationPreference).values({ userId, category: 'review', email: true });
  await db.insert(authAccount).values({ userId, providerId: 'credential', accountId: userId, password: 'not-a-real-hash' });
  await db.insert(authSession).values({ id: uuidv7(), userId, token: `erase-${hex(16)}`, expiresAt: new Date(Date.now() + 3_600_000) });

  // Relationships: one verified (stays), one pending to another teacher (withdrawn), a historical claim
  // under review with its case and evidence, an invited teacher who has not joined, and a student's
  // pending request to the leaver as a teacher (withdrawn).
  const verified = (await db.insert(teachingRelationship).values({ teacherPersonId: teacher.personId, studentPersonId: personId, lineageId, status: 'verified', visibility: 'public', requestedByUserId: userId, confirmedByUserId: teacher.account.id }).returning({ id: teachingRelationship.id }))[0]!.id;
  const pending = (await db.insert(teachingRelationship).values({ teacherPersonId: other.personId, studentPersonId: personId, lineageId, status: 'pending_teacher', visibility: 'involved_only', requestedByUserId: userId }).returning({ id: teachingRelationship.id }))[0]!.id;
  const claimed = (await db.insert(teachingRelationship).values({ teacherPersonId: historical, studentPersonId: personId, lineageId, status: 'under_review', visibility: 'involved_only', requestedByUserId: userId }).returning({ id: teachingRelationship.id }))[0]!.id;
  const toLeaver = (await db.insert(teachingRelationship).values({ teacherPersonId: personId, studentPersonId: student.personId, lineageId, status: 'pending_teacher', visibility: 'involved_only', requestedByUserId: student.account.id }).returning({ id: teachingRelationship.id }))[0]!.id;
  for (const [relationshipId, to] of [[verified, 'verified'], [pending, 'pending_teacher'], [claimed, 'under_review']] as const) {
    await db.insert(relationshipEvent).values({ relationshipId, toStatus: to, actorUserId: userId, actorRole: 'student' });
  }
  const claimCase = (await db.insert(reviewCase).values({ kind: 'historical_claim', status: 'open', relationshipId: claimed, personId, openedByUserId: userId }).returning({ id: reviewCase.id }))[0]!.id;
  await db.insert(reviewNote).values({ reviewCaseId: claimCase, authorUserId: userId, body: 'A fictional note the leaver wrote.', isInternal: false });
  const requestCase = (await db.insert(reviewCase).values({ kind: 'deletion_request', status: 'open', personId, openedByUserId: userId }).returning({ id: reviewCase.id }))[0]!.id;

  // The invitation of a teacher who has not joined, with its e-mail in the delivery log.
  const invitedPerson = uuidv7();
  await db.insert(person).values({ id: invitedPerson, slug: `demo-erase-invited-${hex(4)}`, kind: 'living', stewardship: 'unclaimed', visibility: 'involved_only' });
  await db.insert(personName).values({ personId: invitedPerson, value: 'Demo Erase Invited', script: 'Latn', lang: 'en', isPrimary: true });
  const awaiting = (await db.insert(teachingRelationship).values({ teacherPersonId: invitedPerson, studentPersonId: personId, lineageId, status: 'awaiting_claim', visibility: 'involved_only', requestedByUserId: userId }).returning({ id: teachingRelationship.id }))[0]!.id;
  const [invite] = await db
    .insert(invitation)
    .values({ personId: invitedPerson, relationshipId: awaiting, invitedByUserId: userId, email: 'demo-invitee@example.test', tokenHash: hex(64), status: 'pending', expiresAt: new Date(Date.now() + 86_400_000) })
    .returning({ id: invitation.id });
  await db.insert(emailDelivery).values({ toEmail: 'demo-invitee@example.test', template: 'invitation', idempotencyKey: `invitation:${invite!.id}`, status: 'queued' });
  const noticeKey = `erase-notice-${hex(8)}`;
  await db.insert(emailDelivery).values({ userId, toEmail: leaverMember.account.email, template: 'notice', idempotencyKey: noticeKey, status: 'sent' });

  // Evidence: a file in the historical claim (nothing live rests on it), a file the verified
  // relationship rests on (stays), and a file in no claim. Their objects are in the private store.
  const putEvidence = async (label: string, link: { reviewCaseId?: string; relationshipId?: string } | null) => {
    const storageKey = `evidence/${hex(32)}`;
    await store.put(storageKey, new Uint8Array([1, 2, 3, 4]), { contentType: 'application/pdf' });
    const [file] = await db
      .insert(evidenceFile)
      .values({ storageKey, sha256: hex(64), originalSha256: hex(64), mime: 'application/pdf', sizeBytes: 4, originalName: `demo-${label}.pdf`, uploadedByUserId: userId })
      .returning({ id: evidenceFile.id });
    if (link) await db.insert(evidenceLink).values({ evidenceFileId: file!.id, ...link, note: `A fictional note about ${label}.`, createdByUserId: userId });
    return { id: file!.id, storageKey };
  };
  const evidenceClaim = await putEvidence('claim', { reviewCaseId: claimCase });
  const evidenceVerified = await putEvidence('verified', { relationshipId: verified });
  const evidenceLoose = await putEvidence('loose', null);

  // The passport of the kept record: a certificate with its three files, and a rank the teacher wrote.
  const certKey = `certificates/${hex(48)}`;
  for (const size of ['96', '512', 'full']) await store.put(`${certKey}/${size}`, new Uint8Array([9, 9, 9]), { contentType: 'image/webp' });
  const [certificate] = await db
    .insert(passportCertificate)
    .values({ personId, createdByUserId: userId, title: 'Demo certificate', storageKey: certKey, sha256: hex(64), width: 100, height: 80, sizeBytes: 3 })
    .returning({ id: passportCertificate.id });
  const [rank] = await db.insert(passportRank).values({ personId, rank: 'Demo first level', on: '2019-01-01', precision: 'day', createdByUserId: teacher.account.id }).returning({ id: passportRank.id });

  // A school it listed (with an inquiry from another member), an event it organised, an inquiry it sent,
  // and an organization it administers.
  const [city] = await db.insert(place).values({ geonamesId: 700000 + Math.floor(Math.random() * 90000), name: 'Demo City', asciiName: 'Demo City', countryCode: 'BG', centroid: { lng: 23.3, lat: 42.7 } }).returning({ id: place.id, centroid: place.centroid });
  const [listed] = await db
    .insert(school)
    .values({ slug: `demo-erase-school-${hex(4)}`, name: 'Demo Erase Kwoon', placeId: city!.id, locationPrivacy: 'city_only', publicPoint: city!.centroid, status: 'active', createdByUserId: userId, contactEmail: 'demo-kwoon@example.test', websiteUrl: 'https://example.test/kwoon' })
    .returning({ id: school.id });
  const visitor = await member('erase-visitor');
  const [inbound] = await db.insert(trialInquiry).values({ schoolId: listed!.id, senderUserId: visitor.account.id, senderName: 'Demo Visitor', contactMethod: 'email', contactValue: 'demo-visitor@example.test' }).returning({ id: trialInquiry.id });
  const [elsewhere] = await db.insert(school).values({ slug: `demo-erase-elsewhere-${hex(4)}`, name: 'Demo Elsewhere', placeId: city!.id, locationPrivacy: 'city_only', publicPoint: city!.centroid, status: 'active', createdByUserId: teacher.account.id }).returning({ id: school.id });
  const [sent] = await db.insert(trialInquiry).values({ schoolId: elsewhere!.id, senderUserId: userId, senderName: 'Demo Leaver', contactMethod: 'email', contactValue: leaverMember.account.email }).returning({ id: trialInquiry.id });
  const [ownEvent] = await db
    .insert(event)
    .values({ slug: `demo-erase-event-${hex(4)}`, title: 'Demo Erase Seminar', kind: 'seminar', startsAt: new Date(Date.now() + 86_400_000 * 10), endsAt: new Date(Date.now() + 86_400_000 * 10 + 3_600_000), timezone: 'Europe/Sofia', placeId: city!.id, status: 'published', organizerUserId: userId, organizerPersonId: personId, createdByUserId: userId, description: 'Demo text', venue: 'Demo hall' })
    .returning({ id: event.id });
  const [org] = await db.insert(organization).values({ slug: `demo-erase-org-${hex(4)}`, name: 'Demo Erase Federation', kind: 'association', createdByUserId: userId }).returning({ id: organization.id });
  await db.insert(organizationAdmin).values({ organizationId: org!.id, userId, role: 'owner' });

  return {
    leaverMember, userId, personId, primaryName, noticeKey, teacher, other, student, historical,
    ids: { verified, pending, claimed, toLeaver, awaiting, claimCase, requestCase, invite: invite!.id, certificate: certificate!.id, rank: rank!.id, school: listed!.id, inbound: inbound!.id, sent: sent!.id, event: ownEvent!.id, org: org!.id },
    evidence: { claim: evidenceClaim, verified: evidenceVerified, loose: evidenceLoose },
    certKey,
  };
}

describe('accounts.erase', () => {
  it('erases an account with evidence, relationships, a certificate, a school and an event, and leaves a nameless tombstone', async () => {
    const s = await leaver();
    const admin = await staff('erase-admin', 'admin');
    expect(filesInStore().filter((f) => f.includes('certificates/')).length).toBeGreaterThan(0);
    const before = await getDb().select().from(person).where(eq(person.id, s.personId));
    expect(before[0]).toMatchObject({ visibility: 'public', claimedByUserId: s.userId });

    const result = await eraseAccountAsAdmin(admin.principal, { caseId: s.ids.requestCase, reason: REASON, confirm: true }, meta, store);
    // The row stays: the verified relationship, the history and the organization's rows point to it.
    expect(result).toEqual({ userId: s.userId, caseId: s.ids.requestCase, personId: s.personId, visibility: 'public', tombstone: true, requestsWithdrawn: 4 });

    // The account row: a nameless tombstone with no sign-in, no role and no way back.
    const [row] = await getDb().select().from(authUser).where(eq(authUser.id, s.userId));
    expect(row).toMatchObject({ email: erasedEmail(s.userId), name: '', emailVerified: false, role: 'user', banned: true, banReason: 'Account erased', banExpires: null, twoFactorEnabled: false, timezone: null, lastActiveAt: null });
    expect(JSON.stringify(row)).not.toContain(s.leaverMember.account.email);

    // Nothing the catalogue deletes or clears still refers to the account; only what must stay does.
    const left: string[] = [];
    for (const ref of USER_REFERENCES) if ((await referencing(s.userId, ref.table, ref.column)) > 0) left.push(`${ref.action}:${ref.table}.${ref.column}`);
    expect(left.sort()).toEqual(['keep:organization_admin.user_id', 'keep:relationship_event.actor_user_id', 'keep:teaching_relationship.requested_by_user_id']);
    // The two history tables the app cannot update still point at it (the database writes them).
    expect(await referencing(s.userId, 'relationship_event', 'actor_user_id')).toBe(3);

    // The profile: unclaimed, public (a verified relationship stays), the Latin name only.
    const [kept] = await getDb().select().from(person).where(eq(person.id, s.personId));
    expect(kept).toMatchObject({ claimedByUserId: null, createdByUserId: null, stewardship: 'unclaimed', visibility: 'public', placeId: null, trainingStartYear: null, countryCode: null, birthDate: null, photoId: null });
    expect(await getDb().select({ v: personName.value, primary: personName.isPrimary }).from(personName).where(eq(personName.personId, s.personId))).toEqual([{ v: s.primaryName, primary: true }]);
    expect(await getDb().select().from(personBio).where(eq(personBio.personId, s.personId))).toEqual([]);

    // Relationships: the verified one stays; the three of the student and the one to the leaver are withdrawn.
    const status = async (id: string) => (await getDb().select({ s: teachingRelationship.status }).from(teachingRelationship).where(eq(teachingRelationship.id, id)))[0]!.s;
    expect(await status(s.ids.verified)).toBe('verified');
    for (const id of [s.ids.pending, s.ids.claimed, s.ids.awaiting, s.ids.toLeaver]) expect(await status(id)).toBe('withdrawn');
    const events = await getDb().select().from(relationshipEvent).where(and(eq(relationshipEvent.relationshipId, s.ids.pending), eq(relationshipEvent.toStatus, 'withdrawn')));
    expect(events).toEqual([expect.objectContaining({ fromStatus: 'pending_teacher', actorUserId: admin.account.id, actorRole: 'admin', reason: 'account_erased' })]);
    // Nobody can approve a withdrawn request (flows-core L3): the erasure and every approval hold the same global lock.
    await expect(approveRelationship(s.other.principal, { relationshipId: s.ids.pending, idempotencyKey: key() }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });

    // Cases: the historical claim is dismissed, the deletion request resolved, no case keeps the opener; the note is blanked.
    const caseOf = async (id: string) => (await getDb().select().from(reviewCase).where(eq(reviewCase.id, id)))[0]!;
    expect(await caseOf(s.ids.claimCase)).toMatchObject({ status: 'dismissed', openedByUserId: null });
    expect(await caseOf(s.ids.requestCase)).toMatchObject({ status: 'resolved', resolution: 'approved', openedByUserId: null });
    expect((await getDb().select().from(reviewNote).where(eq(reviewNote.reviewCaseId, s.ids.claimCase)))[0]).toMatchObject({ authorUserId: null, body: expect.stringContaining('Removed') });

    // Invitations and the delivery log: revoked, the address erased everywhere.
    expect((await getDb().select().from(invitation).where(eq(invitation.id, s.ids.invite)))[0]).toMatchObject({ status: 'revoked', email: null, invitedByUserId: null });
    const delivery = async (idempotencyKey: string) => (await getDb().select().from(emailDelivery).where(eq(emailDelivery.idempotencyKey, idempotencyKey)))[0]!;
    expect(await delivery(`invitation:${s.ids.invite}`)).toMatchObject({ toEmail: null, userId: null, status: 'failed' });
    expect(await delivery(s.noticeKey)).toMatchObject({ toEmail: null, userId: null, status: 'sent' });

    // Evidence: the claim's file and the loose file are deleted (row and object); the verified relationship's stays, unnamed.
    const file = async (id: string) => (await getDb().select().from(evidenceFile).where(eq(evidenceFile.id, id)))[0]!;
    expect((await file(s.evidence.claim.id)).deletedAt).toBeInstanceOf(Date);
    expect((await file(s.evidence.loose.id)).deletedAt).toBeInstanceOf(Date);
    expect(await file(s.evidence.verified.id)).toMatchObject({ deletedAt: null, originalName: null, originalSha256: null, uploadedByUserId: null });
    const stored = filesInStore();
    expect(stored).not.toContain(s.evidence.claim.storageKey);
    expect(stored).not.toContain(s.evidence.loose.storageKey);
    expect(stored).toContain(s.evidence.verified.storageKey);
    expect((await getDb().select().from(evidenceLink).where(eq(evidenceLink.relationshipId, s.ids.verified)))[0]).toMatchObject({ note: null, createdByUserId: null });

    // The passport: the certificate row is blanked and removed, its three files are gone, the rank is blanked.
    expect((await getDb().select().from(passportCertificate).where(eq(passportCertificate.id, s.ids.certificate)))[0]).toMatchObject({ status: 'removed', title: null, sha256: '0'.repeat(64), createdByUserId: null });
    expect(stored.filter((f) => f.startsWith(s.certKey))).toEqual([]);
    expect((await getDb().select().from(passportRank).where(eq(passportRank.id, s.ids.rank)))[0]).toMatchObject({ status: 'removed', rank: 'Erased', on: null, precision: 'unknown' });

    // The school is archived with nothing of the Sifu's on it and its inquiry gone; the inquiry the leaver sent is gone; the event is removed.
    expect((await getDb().select().from(school).where(eq(school.id, s.ids.school)))[0]).toMatchObject({ status: 'archived', createdByUserId: null, contactEmail: null, websiteUrl: null });
    expect(await getDb().select().from(trialInquiry).where(eq(trialInquiry.id, s.ids.inbound))).toEqual([]);
    expect(await getDb().select().from(trialInquiry).where(eq(trialInquiry.id, s.ids.sent))).toEqual([]);
    expect((await getDb().select().from(event).where(eq(event.id, s.ids.event)))[0]).toMatchObject({ status: 'removed', organizerUserId: null, createdByUserId: null, description: null, venue: null });

    // The organization stays, without its administrator: the row is revoked.
    expect((await getDb().select().from(organizationAdmin).where(eq(organizationAdmin.organizationId, s.ids.org)))[0]).toMatchObject({ userId: s.userId });
    expect((await getDb().select().from(organizationAdmin).where(eq(organizationAdmin.organizationId, s.ids.org)))[0]!.revokedAt).toBeInstanceOf(Date);
    expect((await getDb().select().from(organization).where(eq(organization.id, s.ids.org)))[0]).toMatchObject({ createdByUserId: null });

    // Credentials, sessions, consents, notifications: gone.
    for (const table of ['auth_account', 'auth_session', 'consent_record', 'notification', 'notification_preference']) expect(await referencing(s.userId, table, 'user_id')).toBe(0);

    // The audit row: the administrator, the reason in its column, ids and counts only.
    const [audit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'account.delete'), eq(auditLog.subjectId, s.ids.requestCase)));
    expect(audit).toMatchObject({ actorUserId: admin.account.id, actorRole: 'admin', subjectType: 'review_case', reason: REASON });
    expect(audit!.after).toMatchObject({ tombstone: true, requestsWithdrawn: 4, schoolsArchived: 1, eventsRemoved: 1, certificatesRemoved: 1, evidenceDeleted: 2, evidenceKept: 1 });
    expect(JSON.stringify([audit!.before, audit!.after])).not.toMatch(/Demo|example\.test|fictional/i);

    // The public cache is told: the person, the schools, the events and the organizations.
    expect(dropped.tags).toEqual(expect.arrayContaining([`person:${s.personId}`, 'schools', 'events', 'organizations']));

    // Erasing it again is refused, and so is signing in as it (no address, no credentials, banned).
    await expect(eraseAccountAsAdmin(admin.principal, { userId: s.userId, reason: REASON, confirm: true }, meta, store)).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('erased already') });
  });

  it('deletes the account row when nothing that must stay refers to it', async () => {
    const plain = await member('erase-plain');
    const admin = await staff('erase-plain-admin', 'admin');
    await getDb().insert(consentRecord).values({ userId: plain.account.id, kind: 'terms', documentVersion: '1', action: 'granted' });
    const result = await eraseAccountAsAdmin(admin.principal, { email: plain.account.email, reason: REASON, confirm: true }, meta, store);
    expect(result).toMatchObject({ userId: plain.account.id, caseId: null, personId: plain.personId, tombstone: false });
    expect(await getDb().select().from(authUser).where(eq(authUser.id, plain.account.id))).toEqual([]);
    // Audited by account id, with no case.
    const [audit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'account.delete'), eq(auditLog.subjectId, plain.account.id)));
    expect(audit).toMatchObject({ subjectType: 'user', actorUserId: admin.account.id });
  });

  it('falls back to a tombstone when a table the catalogue does not know still refers to the account', async () => {
    // The second line of defence: a RESTRICT key the catalogue (and its test) missed must not make the
    // erasure fail half way; the row becomes a tombstone, which holds nothing of the person.
    const owner = await member('erase-unknown');
    const admin = await staff('erase-unknown-admin', 'admin');
    // The test connects as the application role, which cannot create tables: the superuser does.
    const superuser = new Client({ connectionString: testDb!.url });
    await superuser.connect();
    try {
      await superuser.query('CREATE TABLE erase_probe (id serial PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth_user (id) ON DELETE RESTRICT)');
      await superuser.query('GRANT SELECT, INSERT, UPDATE, DELETE ON erase_probe TO app_rw');
      await superuser.query('INSERT INTO erase_probe (user_id) VALUES ($1)', [owner.account.id]);
      const result = await eraseAccountAsAdmin(admin.principal, { userId: owner.account.id, reason: REASON, confirm: true }, meta, store);
      expect(result).toMatchObject({ userId: owner.account.id, tombstone: true });
      const [row] = await getDb().select().from(authUser).where(eq(authUser.id, owner.account.id));
      expect(row).toMatchObject({ email: erasedEmail(owner.account.id), name: '', banned: true });
      expect(await referencing(owner.account.id, 'erase_probe', 'user_id')).toBe(1);
    } finally {
      await superuser.query('DROP TABLE IF EXISTS erase_probe');
      await superuser.end();
    }
  });

  it('redacts the text of the kept record’s archival revisions and keeps who, when, which fields and why', async () => {
    const owner = await member('erase-revisions');
    const other = await member('erase-revisions-other');
    const superuser = new Client({ connectionString: testDb!.url });
    await superuser.connect();
    try {
      const insert = (personId: string, reason: string) =>
        superuser.query(
          `INSERT INTO record_revision (person_id, source, changed, before, after, reason)
           VALUES ($1, 'archival_edit', ARRAY['primaryName'], '{"primaryName":"Demo Old Name"}', '{"primaryName":"Demo New Name"}', $2)`,
          [personId, reason],
        );
      await insert(owner.personId, 'Demo correction after a complaint.');
      await insert(other.personId, 'Demo correction of someone else.');
      const outcome = await eraseAccount({ actor: null, by: { userId: owner.account.id }, reason: REASON }, store);
      expect(outcome.counts.revisionsRedacted).toBe(1);
      const { rows } = await superuser.query(`SELECT person_id::text AS person_id, reason, changed, before, after FROM record_revision WHERE person_id = ANY($1::uuid[]) ORDER BY reason`, [[owner.personId, other.personId]]);
      expect(rows).toEqual([
        {
          person_id: owner.personId,
          reason: 'Demo correction after a complaint.',
          changed: ['primaryName'],
          before: { primaryName: '[redacted: 13 characters]', redacted: true },
          after: { primaryName: '[redacted: 13 characters]', redacted: true },
        },
        // Another record's revisions are not touched.
        { person_id: other.personId, reason: 'Demo correction of someone else.', changed: ['primaryName'], before: { primaryName: 'Demo Old Name' }, after: { primaryName: 'Demo New Name' } },
      ]);
    } finally {
      await superuser.end();
    }
  });

  it('keeps a record held by staff held, and sets what a restore returns it to', async () => {
    const owner = await member('erase-held');
    const mod = await staff('erase-held-mod', 'moderator');
    const admin = await staff('erase-held-admin', 'admin');
    await takeDownProfile(mod.principal, { personId: owner.personId, reason: 'Fictional: held by staff.' }, meta);
    const result = await eraseAccountAsAdmin(admin.principal, { userId: owner.account.id, reason: REASON, confirm: true }, meta, store);
    // No relationship others verified: the record would not be public again.
    expect(result).toMatchObject({ personId: owner.personId, visibility: 'involved_only' });
    const [held] = await getDb().select().from(person).where(eq(person.id, owner.personId));
    expect(held).toMatchObject({ visibility: 'involved_only', stewardship: 'unclaimed', claimedByUserId: null, takenDownVisibility: 'involved_only', takenDownReason: 'Fictional: held by staff.' });
    expect(held!.takenDownAt).toBeInstanceOf(Date);
  });

  it('runs from the command line core with no administrator, closing the request', async () => {
    const owner = await member('erase-core');
    const [request] = await getDb().insert(reviewCase).values({ kind: 'deletion_request', status: 'open', personId: owner.personId, openedByUserId: owner.account.id }).returning({ id: reviewCase.id });
    const outcome = await eraseAccount({ actor: null, by: { caseId: request!.id }, reason: 'pnpm account:delete (local environment)', caseNote: 'Carried out with pnpm account:delete.' }, store);
    expect(outcome).toMatchObject({ userId: owner.account.id, caseId: request!.id, tombstone: false });
    const [audit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'account.delete'), eq(auditLog.subjectId, request!.id)));
    expect(audit).toMatchObject({ actorUserId: null, actorRole: null });
    expect((await getDb().select().from(reviewCase).where(eq(reviewCase.id, request!.id)))[0]).toMatchObject({ status: 'resolved', resolutionReason: 'Carried out with pnpm account:delete.' });
  });

  it('refuses who may not, and what may not be erased', async () => {
    const victim = await member('erase-refuse');
    const admin = await staff('erase-refuse-admin', 'admin');
    const body = { email: victim.account.email, reason: REASON, confirm: true as const };
    await expect(eraseAccountAsAdmin(null, body, meta)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(eraseAccountAsAdmin(victim.principal, body, meta)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const role of ['moderator', 'archivist'] as const) {
      await expect(eraseAccountAsAdmin((await staff(`erase-refuse-${role}`, role)).principal, body, meta)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    // An administrator whose session has not proved the second factor.
    const unverified = principalOf(admin.account, 'admin', { unverified: true });
    await expect(eraseAccountAsAdmin(unverified, body, meta)).rejects.toMatchObject({ code: 'SECOND_FACTOR_REQUIRED' });
    // Input: a reason, the confirmation, exactly one way to name the account.
    await expect(eraseAccountAsAdmin(admin.principal, { ...body, reason: ' ' }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(eraseAccountAsAdmin(admin.principal, { ...body, confirm: false as unknown as true }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(eraseAccountAsAdmin(admin.principal, { ...body, userId: victim.account.id }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(eraseAccountAsAdmin(admin.principal, { reason: REASON, confirm: true }, meta, store)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(eraseAccountAsAdmin(admin.principal, { email: 'demo-nobody@example.test', reason: REASON, confirm: true }, meta, store)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Not yourself, and not a staff account (its role is taken away first).
    await expect(eraseAccountAsAdmin(admin.principal, { userId: admin.account.id, reason: REASON, confirm: true }, meta, store)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const mod = await staff('erase-refuse-target', 'moderator');
    await expect(eraseAccountAsAdmin(admin.principal, { userId: mod.account.id, reason: REASON, confirm: true }, meta, store)).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('staff role') });
    // Nothing was erased by any of these.
    expect(await getDb().select({ id: authUser.id }).from(authUser).where(eq(authUser.id, victim.account.id))).toHaveLength(1);
    expect(await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'account.delete'), eq(auditLog.subjectId, victim.account.id)))).toEqual([]);
    // An administrator who was demoted since the request began cannot erase.
    await getDb().update(authUser).set({ role: 'user', twoFactorEnabled: false }).where(eq(authUser.id, admin.account.id));
    await expect(eraseAccountAsAdmin(admin.principal, body, meta)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refuses a deletion request that is closed, and one that is not a deletion request', async () => {
    const owner = await member('erase-closed');
    const admin = await staff('erase-closed-admin', 'admin');
    const [closed] = await getDb().insert(reviewCase).values({ kind: 'deletion_request', status: 'dismissed', personId: owner.personId, openedByUserId: owner.account.id }).returning({ id: reviewCase.id });
    await expect(eraseAccountAsAdmin(admin.principal, { caseId: closed!.id, reason: REASON, confirm: true }, meta, store)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(eraseAccountAsAdmin(admin.principal, { caseId: uuidv7(), reason: REASON, confirm: true }, meta, store)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
