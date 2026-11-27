// Naming requests (review 2026-11-13, docs/adr/0088-review-1113-leftovers.md) against PostGIS:
// nobody is listed as a member, an instructor or an examiner, and no organization as an issuer or
// an account as an administrator, without agreeing to it. A person with an account answers; the
// archive team decides for a person without one. Fictional data only (D20).

import { randomBytes } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { auditLog, namingRequest, notification, organizationAdmin, organizationMembership, passportRank, person, personName, teachingRelationship } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { answerNaming, namingMine, namingQueue, reviewNaming } from './naming';
import { grantOrganizationPlan } from './organization-grants';
import { addOrganizationAdmin, addOrganizationMember, applyOrganization, manageOrganization, withdrawOrganizationRequest } from './organizations';
import { addRank } from './passport';
import { createUser, key, member, meta, newLineage, principalOf, staff } from './relationships.test-support';
import { purgeExpiredNamingInvites } from './retention';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;

beforeAll(async () => {
  setTestAuthEnv();
  testDb = await createTestDatabase({ seed: true });
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { __wcrAuth?: unknown }).__wcrAuth;
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

let admin: Awaited<ReturnType<typeof staff>>;

/** An approved organization with a test Federation plan, of a new owner account. */
async function federation() {
  const account = await createUser('naming-owner');
  const owner = principalOf(account);
  const applied = await applyOrganization(
    owner,
    { name: `Demo ${randomBytes(2).toString('hex')} Naming Federation`, kind: 'federation', leaderName: 'Demo Leader', leaderTitle: null, websiteUrl: null, countryCode: 'BG', schoolsEstimate: 3, evidenceIds: [], note: null, idempotencyKey: key() },
    meta,
  );
  await getDb().execute(sql`UPDATE organization SET status = 'active', approved_at = now() WHERE id = ${applied.organizationId}::uuid`);
  await getDb().execute(sql`UPDATE review_case SET status = 'resolved', resolution = 'approved', resolved_at = now() WHERE id = ${applied.caseId}::uuid`);
  admin ??= await staff('naming-admin', 'admin');
  await grantOrganizationPlan(admin.principal, { organizationId: applied.organizationId, reason: 'ADR 0088 test plan (fictional)' }, meta);
  return { account, owner, organizationId: applied.organizationId };
}

/** A public record without an account (unclaimed). */
async function record(label: string) {
  const personId = uuidv7();
  const slug = `demo-${label}-${randomBytes(4).toString('hex')}`;
  await getDb().insert(person).values({ id: personId, slug, kind: 'living', lifeStatus: 'living', stewardship: 'unclaimed', visibility: 'public' });
  await getDb().insert(personName).values({ personId, value: `Demo ${label.replace(/-/g, ' ')}`, script: 'Latn', lang: 'en', isPrimary: true });
  return { personId, slug };
}

const memberships = async (organizationId: string, personId: string) =>
  getDb()
    .select({ id: organizationMembership.id })
    .from(organizationMembership)
    .where(and(eq(organizationMembership.organizationId, organizationId), eq(organizationMembership.personId, personId)));

describe('an organization lists a member (review 2026-11-13, authz 1)', () => {
  it('a person with an account accepts or declines; nobody else can answer; the audit log keeps who asked and what was decided', async () => {
    const org = await federation();
    const named = await member('naming-member');
    const out = await addOrganizationMember(org.owner, { organizationId: org.organizationId, personSlug: named.slug, role: 'member' }, meta);
    expect(out).toEqual({ membershipId: null, outcome: 'pending' });
    expect(await memberships(org.organizationId, named.personId)).toEqual([]);
    // The owner sees it waiting; the named account sees it to answer, and was told.
    expect((await manageOrganization(org.owner, { organizationId: org.organizationId })).pendingMembers).toMatchObject([{ slug: named.slug, waiting: 'Waiting for them to accept' }]);
    const mine = await namingMine(named.principal);
    expect(mine.requests).toMatchObject([{ kind: 'organization_member', personSlug: named.slug, status: 'pending' }]);
    const told = await getDb().select().from(notification).where(eq(notification.userId, named.account.id));
    expect(told.map((n) => n.template)).toContain('naming.requested');
    // Asking again does not make a second request.
    await addOrganizationMember(org.owner, { organizationId: org.organizationId, personSlug: named.slug, role: 'member' }, meta);
    expect((await namingMine(named.principal)).requests).toHaveLength(1);

    const id = mine.requests[0]!.id;
    for (const other of [org.owner, (await member('naming-bystander')).principal]) {
      await expect(answerNaming(other, { id, accept: true }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(await answerNaming(named.principal, { id, accept: false }, meta)).toEqual({ status: 'declined' });
    expect(await memberships(org.organizationId, named.personId)).toEqual([]);
    await expect(answerNaming(named.principal, { id, accept: true }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await addOrganizationMember(org.owner, { organizationId: org.organizationId, personSlug: named.slug, role: 'leader' }, meta);
    const again = (await namingMine(named.principal)).requests[0]!;
    expect(await answerNaming(named.principal, { id: again.id, accept: true }, meta)).toEqual({ status: 'accepted' });
    expect(await memberships(org.organizationId, named.personId)).toHaveLength(1);
    expect(await getDb().select().from(namingRequest).where(eq(namingRequest.personId, named.personId))).toEqual([]);

    const audit = await getDb().select({ action: auditLog.action, after: auditLog.after }).from(auditLog).where(sql`${auditLog.subjectId} IN (${id}, ${again.id})`);
    expect(audit.map((a) => a.action).sort()).toEqual(['naming.answer', 'naming.answer', 'naming.request', 'naming.request']);
    expect(JSON.stringify(audit)).not.toContain(named.slug);
  });

  it('a record without an account goes to the archive team; a moderator cannot decide', async () => {
    const org = await federation();
    const r = await record('naming-record');
    expect(await addOrganizationMember(org.owner, { organizationId: org.organizationId, personSlug: r.slug, role: 'member' }, meta)).toEqual({ membershipId: null, outcome: 'in_review' });
    const archivist = await staff('naming-archivist', 'archivist');
    const moderator = await staff('naming-moderator', 'moderator');
    const queue = await namingQueue(archivist.principal);
    const item = queue.requests.find((q) => q.personSlug === r.slug)!;
    expect(item).toMatchObject({ kind: 'organization_member', status: 'in_review' });
    await expect(namingQueue(moderator.principal)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(reviewNaming(moderator.principal, { id: item.id, approve: true }, meta)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Nobody's own request list holds it.
    expect((await namingMine(org.owner)).requests).toEqual([]);
    expect(await reviewNaming(archivist.principal, { id: item.id, approve: true, reason: 'Demo: the record matches (fictional)' }, meta)).toEqual({ status: 'approved' });
    expect(await memberships(org.organizationId, r.personId)).toHaveLength(1);
  });

  it('the admin’s own person is listed at once; a request that waits can be withdrawn', async () => {
    const owner = await member('naming-own-owner');
    const org = await federation();
    await getDb().insert(organizationAdmin).values({ organizationId: org.organizationId, userId: owner.account.id, role: 'admin', grantedByUserId: org.account.id });
    const out = await addOrganizationMember(owner.principal, { organizationId: org.organizationId, personSlug: owner.slug, role: 'member' }, meta);
    expect(out.outcome).toBe('added');
    expect(out.membershipId).toEqual(expect.any(String));

    const named = await member('naming-withdrawn');
    await addOrganizationMember(org.owner, { organizationId: org.organizationId, personSlug: named.slug, role: 'member' }, meta);
    const requestId = (await manageOrganization(org.owner, { organizationId: org.organizationId })).pendingMembers[0]!.requestId;
    const other = await federation();
    await expect(withdrawOrganizationRequest(other.owner, { organizationId: org.organizationId, requestId }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(withdrawOrganizationRequest(other.owner, { organizationId: other.organizationId, requestId }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await withdrawOrganizationRequest(org.owner, { organizationId: org.organizationId, requestId }, meta)).toEqual({ withdrawn: true });
    expect((await namingMine(named.principal)).requests).toEqual([]);
  });
});

describe('an owner invites an administrator (review 2026-11-13, authz 4)', () => {
  it('the same answer for any address; only the account of that address accepts, before the invitation expires', async () => {
    const org = await federation();
    const invitee = await createUser('naming-invitee');
    expect(await addOrganizationAdmin(org.owner, { organizationId: org.organizationId, email: invitee.email.toUpperCase() }, meta)).toEqual({ invited: true });
    expect(await addOrganizationAdmin(org.owner, { organizationId: org.organizationId, email: 'demo-nobody-uses-this@example.test' }, meta)).toEqual({ invited: true });
    const view = await manageOrganization(org.owner, { organizationId: org.organizationId });
    expect(view.pendingAdmins.map((a) => a.email).sort()).toEqual([invitee.email.toLowerCase(), 'demo-nobody-uses-this@example.test'].sort());
    // Not an admin before accepting.
    await expect(manageOrganization(principalOf(invitee), { organizationId: org.organizationId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const mine = await namingMine(principalOf(invitee));
    expect(mine.requests).toMatchObject([{ kind: 'organization_admin' }]);
    const stranger = await createUser('naming-stranger');
    await expect(answerNaming(principalOf(stranger), { id: mine.requests[0]!.id, accept: true }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // An expired invitation cannot be accepted, and the daily job deletes it.
    await getDb().update(namingRequest).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(namingRequest.id, mine.requests[0]!.id));
    await expect(answerNaming(principalOf(invitee), { id: mine.requests[0]!.id, accept: true }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await purgeExpiredNamingInvites(getDb())).toBeGreaterThanOrEqual(1);
    expect(await getDb().select().from(namingRequest).where(eq(namingRequest.id, mine.requests[0]!.id))).toEqual([]);

    // Invited again: accepted, the account administers it.
    await addOrganizationAdmin(org.owner, { organizationId: org.organizationId, email: invitee.email }, meta);
    const fresh = (await namingMine(principalOf(invitee))).requests[0]!;
    await answerNaming(principalOf(invitee), { id: fresh.id, accept: true }, meta);
    expect((await manageOrganization(principalOf(invitee), { organizationId: org.organizationId })).id).toBe(org.organizationId);
  });
});

describe('a teacher names an organization on a passport entry (review 2026-11-13, flows-community H2)', () => {
  it('the organization is shown only once one of its admins accepts', async () => {
    const org = await federation();
    const teacher = await member('naming-teacher', { sifu: true });
    const student = await member('naming-student');
    await getDb().insert(teachingRelationship).values({ teacherPersonId: teacher.personId, studentPersonId: student.personId, lineageId: await newLineage('naming'), status: 'verified', visibility: 'public' });
    const entry = await addRank(teacher.principal, { personId: student.personId, rank: 'Demo level', date: '2020', organizationId: org.organizationId }, meta);
    const [before] = await getDb().select({ organizationId: passportRank.organizationId }).from(passportRank).where(eq(passportRank.id, entry.id));
    expect(before!.organizationId).toBeNull();
    const asked = (await namingMine(org.owner)).requests;
    expect(asked).toMatchObject([{ kind: 'entry_issuer', about: 'Demo level' }]);
    await answerNaming(org.owner, { id: asked[0]!.id, accept: true }, meta);
    const [after] = await getDb().select({ organizationId: passportRank.organizationId }).from(passportRank).where(eq(passportRank.id, entry.id));
    expect(after!.organizationId).toBe(org.organizationId);
  });
});
