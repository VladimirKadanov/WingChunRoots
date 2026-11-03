// Organizations (milestone M15, docs/adr/0018-organizations.md) against PostGIS, on the seeded
// demo data: an application, its review and the public page; one organization's admin never
// reaches another's; no organization action creates, verifies or edits a teaching relationship or
// a person's visibility (DEFAULT D12); a pending organization edits only its own application;
// member and school administration needs approval and Federation, and revoking it keeps the
// members, the links, the page and every user's own grants (DEFAULT D08); app_public_ro reads
// no organization table nor v_public_organization, and a pending organization is not in the view; a school link is answered
// by the school's account and never changes the school. Fictional data only (D20).

import { randomBytes } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { withClient } from '../db/admin';
import { auditLog, entitlementGrant, notification, organization, organizationSchool, person, reviewCase, school } from '../db/schema';
import { PG, pgError } from '../db/test-support';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { createGrant } from './grants';
import { grantOrganizationPlan, revokeOrganizationPlan } from './organization-grants';
import {
  addOrganizationAdmin,
  addOrganizationMember,
  answerSchoolLink,
  applyOrganization,
  endOrganizationMember,
  endSchoolLink,
  manageOrganization,
  myOrganizations,
  mySchoolLinks,
  organizationGet,
  organizationsList,
  removeOrganizationAdmin,
  requestOrganizationSchool,
  updateOrganization,
} from './organizations';
import { createUser, key, member, meta, principalOf, staff } from './relationships.test-support';
import { assignReviewCase, decideReviewCase, getReviewCase } from './review';
import { createSchool } from './schools';

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

const FIELDS = { kind: 'federation' as const, leaderName: 'Demo Leader Person', leaderTitle: 'President', websiteUrl: 'https://example.test/demo', countryCode: 'BG', schoolsEstimate: 4 };

async function applicant(label = 'org-applicant') {
  const account = await createUser(label);
  return { account, principal: principalOf(account) };
}

async function apply(label = 'org-applicant', name = `Demo ${randomBytes(2).toString('hex')} Federation`) {
  const who = await applicant(label);
  const applied = await applyOrganization(who.principal, { ...FIELDS, name, evidenceIds: [], note: 'A fictional federation.', idempotencyKey: key() }, meta);
  return { ...who, ...applied, name };
}

/** An archivist takes the case and approves it from the version on the card. */
async function approve(caseId: string) {
  const archivist = await staff('org-archivist', 'archivist');
  await assignReviewCase(archivist.principal, { caseId, assigneeId: archivist.account.id, idempotencyKey: key() }, meta);
  const card = await getReviewCase(archivist.principal, { id: caseId });
  await decideReviewCase(archivist.principal, { caseId, decision: 'verify', reason: null, idempotencyKey: key(), organizationVersion: card.organization!.version }, meta);
  return archivist;
}

async function slugOf(organizationId: string): Promise<string> {
  const [row] = await getDb().select({ slug: organization.slug }).from(organization).where(eq(organization.id, organizationId));
  return row!.slug;
}

let admin: Awaited<ReturnType<typeof staff>>;
async function federation(organizationId: string) {
  admin ??= await staff('org-admin', 'admin');
  return grantOrganizationPlan(admin.principal, { organizationId, reason: 'M15 test plan (fictional)' }, meta);
}

/** A listed school of a Professional Sifu (public, in v_public_school). */
async function listedSchool() {
  const owner = await member('org-school-sifu', { sifu: true });
  admin ??= await staff('org-admin', 'admin');
  await createGrant(admin.principal, { email: owner.account.email, planCode: 'pro_sifu', reason: 'M15 test (fictional)' }, meta);
  const city = await getDb().execute<{ id: string }>(sql`SELECT id::text FROM place WHERE name = 'Plovdiv' AND country_code = 'BG' ORDER BY population DESC NULLS LAST LIMIT 1`);
  const saved = await createSchool(owner.principal, { name: 'Demo Linked Hall', placeId: city.rows[0]!.id, locationPrivacy: 'city_only', idempotencyKey: key() }, meta);
  await getDb().update(school).set({ status: 'active' }).where(eq(school.id, saved.id));
  return { owner, schoolId: saved.id, slug: saved.slug };
}

/** What no organization action may change (DEFAULT D12): every teaching relationship and every person's visibility. */
async function lineageState(except: readonly string[] = []): Promise<string> {
  const skip = except.length === 0 ? sql`false` : sql`p.id = ANY (ARRAY[${sql.join(except.map((id) => sql`${id}::uuid`), sql`, `)}])`;
  const result = await getDb().execute<{ h: string }>(sql`
    SELECT md5(coalesce((SELECT string_agg(t.id::text || t.status || t.updated_at::text, ',' ORDER BY t.id) FROM teaching_relationship t), '') ||
               coalesce((SELECT string_agg(p.id::text || p.visibility || p.updated_at::text, ',' ORDER BY p.id) FROM person p WHERE NOT (${skip})), '')) AS h`);
  return result.rows[0]!.h;
}

describe('an application, its review and the public page', () => {
  it('opens a case, an archivist approves it, and the page lists only public data', async () => {
    const before = await lineageState();
    const a = await apply();
    const [c] = await getDb().select().from(reviewCase).where(eq(reviewCase.id, a.caseId));
    expect(c).toMatchObject({ kind: 'organization_application', status: 'open', organizationId: a.organizationId, openedByUserId: a.account.id });
    // Pending: not public, and the applicant is its owner (an account, not a membership).
    await expect(organizationGet(null, { slug: await slugOf(a.organizationId) })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await myOrganizations(a.principal)).organizations).toEqual([expect.objectContaining({ id: a.organizationId, status: 'pending', role: 'owner' })]);
    expect((await myOrganizations(a.principal)).canApply).toBe(false);

    await approve(a.caseId);
    const page = await organizationGet(null, { slug: await slugOf(a.organizationId) });
    expect(page).toMatchObject({ name: a.name, kind: 'federation', countryCode: 'BG', websiteUrl: FIELDS.websiteUrl, members: [], schools: [] });
    // DEFAULT D03: the leader the application named is for the reviewers, never on the page.
    expect(JSON.stringify(page)).not.toContain(FIELDS.leaderName);
    expect(JSON.stringify(page)).not.toContain('President');
    expect((await organizationsList()).organizations.map((o) => o.slug)).toContain(page.slug);

    // DEFAULT D04: approval gives no plan.
    const managed = await manageOrganization(a.principal, { organizationId: a.organizationId });
    expect(managed.approval.status).toBe('active');
    expect(managed.plan.code).toBeNull();
    expect(managed.can.administration).toBe(false);

    const told = await getDb().select().from(notification).where(and(eq(notification.userId, a.account.id), eq(notification.template, 'organization.reviewed')));
    expect(told.map((n) => n.payload)).toEqual([{ organizationId: a.organizationId, decision: 'approved' }]);
    const audits = await getDb().select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.subjectId, a.organizationId));
    expect(audits.map((r) => r.action)).toEqual(expect.arrayContaining(['organization.apply', 'organization.approve']));
    expect(await lineageState()).toBe(before);
  });

  it('refuses an approval from a card older than the application (CONFLICT), and a moderator’s approval (FORBIDDEN)', async () => {
    const a = await apply();
    const moderator = await staff('org-moderator', 'moderator');
    await assignReviewCase(moderator.principal, { caseId: a.caseId, assigneeId: moderator.account.id, idempotencyKey: key() }, meta);
    const card = await getReviewCase(moderator.principal, { id: a.caseId });
    await expect(
      decideReviewCase(moderator.principal, { caseId: a.caseId, decision: 'verify', reason: null, idempotencyKey: key(), organizationVersion: card.organization!.version }, meta),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const archivist = await staff('org-archivist', 'archivist');
    await assignReviewCase(archivist.principal, { caseId: a.caseId, assigneeId: archivist.account.id, idempotencyKey: key() }, meta);
    const seen = await getReviewCase(archivist.principal, { id: a.caseId });
    await new Promise((r) => setTimeout(r, 5));
    await updateOrganization(a.principal, { organizationId: a.organizationId, name: a.name, ...FIELDS, schoolsEstimate: 9 }, meta);
    await expect(
      decideReviewCase(archivist.principal, { caseId: a.caseId, decision: 'verify', reason: null, idempotencyKey: key(), organizationVersion: seen.organization!.version }, meta),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(decideReviewCase(archivist.principal, { caseId: a.caseId, decision: 'verify', reason: null, idempotencyKey: key() }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('a declined application stays private, and the account may apply again', async () => {
    const a = await apply();
    const archivist = await staff('org-archivist', 'archivist');
    await assignReviewCase(archivist.principal, { caseId: a.caseId, assigneeId: archivist.account.id, idempotencyKey: key() }, meta);
    await decideReviewCase(archivist.principal, { caseId: a.caseId, decision: 'reject', reason: 'The fictional registration does not show this name.', idempotencyKey: key() }, meta);
    const [row] = await getDb().select({ status: organization.status }).from(organization).where(eq(organization.id, a.organizationId));
    expect(row!.status).toBe('rejected');
    await expect(organizationGet(null, { slug: await slugOf(a.organizationId) })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await manageOrganization(a.principal, { organizationId: a.organizationId })).application).toMatchObject({ resolution: 'rejected', reason: 'The fictional registration does not show this name.' });
    expect((await myOrganizations(a.principal)).canApply).toBe(true);
  });
});

describe('editing (DEFAULT: a pending organization edits only its own application)', () => {
  it('a pending organization edits every field of its application; an approved one keeps its name, kind and country', async () => {
    const a = await apply();
    const saved = await updateOrganization(a.principal, { organizationId: a.organizationId, ...FIELDS, name: 'Demo Renamed Federation', kind: 'association', countryCode: 'GR' }, meta);
    expect(saved.changed.sort()).toEqual(['countryCode', 'kind', 'name']);
    // Nothing else of the account's opens to it while it waits: no admins, members or schools.
    await expect(addOrganizationAdmin(a.principal, { organizationId: a.organizationId, email: (await createUser('org-second')).email }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(addOrganizationMember(a.principal, { organizationId: a.organizationId, personSlug: 'demo-root-a' }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
    const view = await manageOrganization(a.principal, { organizationId: a.organizationId });
    expect(view.can).toEqual({ editApplication: true, editDetails: false, manageAdmins: false, administration: false });

    await approve(a.caseId);
    await expect(updateOrganization(a.principal, { organizationId: a.organizationId, ...FIELDS, name: 'Demo Other Name', kind: 'association', countryCode: 'GR' }, meta)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      fields: { name: expect.any(String) },
    });
    const ok = await updateOrganization(a.principal, { organizationId: a.organizationId, ...FIELDS, name: 'Demo Renamed Federation', kind: 'association', countryCode: 'GR', websiteUrl: 'https://example.test/new' }, meta);
    expect(ok.changed).toEqual(['websiteUrl']);
  });
});

describe('one organization’s admin never reaches another’s (authorization matrix)', () => {
  it('answers 404 for every read and write of another organization', async () => {
    const a = await apply('org-a');
    const b = await apply('org-b');
    await approve(a.caseId);
    await approve(b.caseId);
    await federation(a.organizationId);
    await federation(b.organizationId);
    const notFound = { code: 'NOT_FOUND' };
    await expect(manageOrganization(b.principal, { organizationId: a.organizationId })).rejects.toMatchObject(notFound);
    await expect(updateOrganization(b.principal, { organizationId: a.organizationId, name: a.name, ...FIELDS, websiteUrl: 'https://example.test/x' }, meta)).rejects.toMatchObject(notFound);
    await expect(addOrganizationAdmin(b.principal, { organizationId: a.organizationId, email: b.account.email }, meta)).rejects.toMatchObject(notFound);
    await expect(addOrganizationMember(b.principal, { organizationId: a.organizationId, personSlug: 'demo-root-a' }, meta)).rejects.toMatchObject(notFound);
    const added = await addOrganizationMember(a.principal, { organizationId: a.organizationId, personSlug: 'demo-root-a' }, meta);
    await expect(endOrganizationMember(b.principal, { organizationId: a.organizationId, membershipId: added.membershipId }, meta)).rejects.toMatchObject(notFound);
    // Another organization's membership through one's own organization's id: no such member.
    await expect(endOrganizationMember(b.principal, { organizationId: b.organizationId, membershipId: added.membershipId }, meta)).rejects.toMatchObject(notFound);
    const s = await listedSchool();
    const link = await requestOrganizationSchool(a.principal, { organizationId: a.organizationId, schoolSlug: s.slug }, meta);
    await expect(endSchoolLink(b.principal, { linkId: link.linkId }, meta)).rejects.toMatchObject(notFound);
    await expect(answerSchoolLink(b.principal, { linkId: link.linkId, accept: true }, meta)).rejects.toMatchObject(notFound);
  });

  it('an admin (not an owner) manages members but not admins; an owner stays', async () => {
    const a = await apply();
    await approve(a.caseId);
    await federation(a.organizationId);
    const second = await createUser('org-second-admin');
    const added = await addOrganizationAdmin(a.principal, { organizationId: a.organizationId, email: second.email }, meta);
    const asAdmin = principalOf(second);
    await addOrganizationMember(asAdmin, { organizationId: a.organizationId, personSlug: 'demo-root-a' }, meta);
    await expect(addOrganizationAdmin(asAdmin, { organizationId: a.organizationId, email: (await createUser('org-third')).email }, meta)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const view = await manageOrganization(a.principal, { organizationId: a.organizationId });
    const ownerRow = view.admins.find((x) => x.role === 'owner')!;
    await expect(removeOrganizationAdmin(asAdmin, { organizationId: a.organizationId, adminId: ownerRow.id }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
    // An admin may leave.
    await removeOrganizationAdmin(asAdmin, { organizationId: a.organizationId, adminId: added.adminId }, meta);
    await expect(manageOrganization(asAdmin, { organizationId: a.organizationId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('members, the plan and revoking it (DEFAULT D03, D08, D12)', () => {
  it('lists only public people; needs Federation; revoking keeps the members, links, page and user grants', async () => {
    const a = await apply();
    await approve(a.caseId);
    const hidden = await member('org-hidden', { hidden: true });
    const shown = await member('org-shown');
    const s = await listedSchool();
    // `shown` is hidden and shown again by the test itself below.
    const before = await lineageState([shown.personId]);
    // Approved without a plan: shown, not managed.
    await expect(addOrganizationMember(a.principal, { organizationId: a.organizationId, personSlug: shown.slug }, meta)).rejects.toMatchObject({ code: 'ENTITLEMENT_REQUIRED' });

    const granted = await federation(a.organizationId);
    expect(granted.plan.code).toBe('federation');
    await expect(addOrganizationMember(a.principal, { organizationId: a.organizationId, personSlug: hidden.slug }, meta)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      fields: { personSlug: expect.any(String) },
    });
    await addOrganizationMember(a.principal, { organizationId: a.organizationId, personSlug: `https://example.test/people/${shown.slug}`, role: 'leader' }, meta);
    const link = await requestOrganizationSchool(a.principal, { organizationId: a.organizationId, schoolSlug: s.slug }, meta);
    await answerSchoolLink(s.owner.principal, { linkId: link.linkId, accept: true }, meta);
    const slug = await slugOf(a.organizationId);
    const page = await organizationGet(null, { slug });
    expect(page.members.map((m) => [m.slug, m.role])).toEqual([[shown.slug, 'leader']]);
    expect(page.schools.map((x) => x.slug)).toEqual([s.slug]);

    // A member who hides their profile disappears from the page (D03), with nothing else said.
    await getDb().update(person).set({ visibility: 'involved_only' }).where(eq(person.id, shown.personId));
    expect((await organizationGet(null, { slug })).members).toEqual([]);
    await getDb().update(person).set({ visibility: 'public' }).where(eq(person.id, shown.personId));

    // Revoke: administration closes, everything else stays (D08).
    await revokeOrganizationPlan(admin.principal, { grantId: granted.grants[0]!.id, reason: 'End of the fictional test' }, meta);
    const after = await manageOrganization(a.principal, { organizationId: a.organizationId });
    expect(after.plan.code).toBeNull();
    expect(after.can.administration).toBe(false);
    expect(after.administrationNote).toBeTruthy();
    await expect(addOrganizationMember(a.principal, { organizationId: a.organizationId, personSlug: hidden.slug }, meta)).rejects.toMatchObject({ code: 'ENTITLEMENT_REQUIRED' });
    await expect(endSchoolLink(a.principal, { linkId: link.linkId }, meta)).rejects.toMatchObject({ code: 'ENTITLEMENT_REQUIRED' });
    const kept = await organizationGet(null, { slug });
    expect(kept.members.map((m) => m.slug)).toEqual([shown.slug]);
    expect(kept.schools.map((x) => x.slug)).toEqual([s.slug]);
    // The school's own Professional Sifu grant is untouched.
    const own = await getDb().select().from(entitlementGrant).where(and(eq(entitlementGrant.subjectUserId, s.owner.account.id), sql`${entitlementGrant.revokedAt} IS NULL`));
    expect(own.map((g) => g.planCode)).toEqual(['pro_sifu']);
    // A school may always leave.
    await endSchoolLink(s.owner.principal, { linkId: link.linkId }, meta);
    expect((await organizationGet(null, { slug })).schools).toEqual([]);
    expect(await lineageState([shown.personId])).toBe(before);
  });
});

describe('school links (the school decides; the school never changes)', () => {
  it('accept, refuse and end leave the school row as it was, and the page names only the city', async () => {
    const a = await apply();
    await approve(a.caseId);
    await federation(a.organizationId);
    const s = await listedSchool();
    const snapshot = async () => (await getDb().execute(sql`SELECT status, public_point::text, location_privacy, updated_at::text FROM school WHERE id = ${s.schoolId}::uuid`)).rows[0];
    const before = await snapshot();
    const first = await requestOrganizationSchool(a.principal, { organizationId: a.organizationId, schoolSlug: `/schools/${s.slug}` }, meta);
    await expect(requestOrganizationSchool(a.principal, { organizationId: a.organizationId, schoolSlug: s.slug }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await mySchoolLinks(s.owner.principal)).links).toEqual([expect.objectContaining({ id: first.linkId, status: 'pending' })]);
    const told = await getDb().select().from(notification).where(and(eq(notification.userId, s.owner.account.id), eq(notification.template, 'organization.school_requested')));
    expect(told).toHaveLength(1);
    // Only the school's account answers.
    await expect(answerSchoolLink(a.principal, { linkId: first.linkId, accept: true }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await answerSchoolLink(s.owner.principal, { linkId: first.linkId, accept: false }, meta);
    expect((await organizationGet(null, { slug: await slugOf(a.organizationId) })).schools).toEqual([]);

    const second = await requestOrganizationSchool(a.principal, { organizationId: a.organizationId, schoolSlug: s.slug }, meta);
    await answerSchoolLink(s.owner.principal, { linkId: second.linkId, accept: true }, meta);
    const page = await organizationGet(null, { slug: await slugOf(a.organizationId) });
    expect(page.schools).toEqual([{ slug: s.slug, name: 'Demo Linked Hall', city: 'Plovdiv', countryCode: 'BG' }]);
    expect(JSON.stringify(page)).not.toMatch(/"(lat|lng|point)"/);
    await endSchoolLink(a.principal, { linkId: second.linkId }, meta);
    const [ended] = await getDb().select().from(organizationSchool).where(eq(organizationSchool.id, second.linkId));
    expect(ended).toMatchObject({ status: 'ended', endedByUserId: a.account.id });
    expect(await snapshot()).toEqual(before);
  });
});

describe('the public role and the view', () => {
  it('app_public_ro reads no organization table nor the view, and a pending organization is not in the view', async () => {
    const pending = await apply();
    const active = await apply();
    await approve(active.caseId);
    await withClient(testDb!.roleUrl('app_public_ro'), async (c) => {
      for (const table of ['organization', 'organization_admin', 'organization_school', 'organization_membership']) {
        const error = await pgError(c.query(`SELECT 1 FROM ${table} LIMIT 1`));
        expect(error.code, table).toBe(PG.insufficientPrivilege);
      }
      const denied = await pgError(c.query('SELECT 1 FROM v_public_organization LIMIT 1'));
      expect(denied.code).toBe(PG.insufficientPrivilege);
    });
    await withClient(testDb!.roleUrl('app_rw'), async (c) => {
      const view = await c.query<{ id: string }>('SELECT id FROM v_public_organization');
      const ids = view.rows.map((r) => r.id);
      expect(ids).toContain(active.organizationId);
      expect(ids).not.toContain(pending.organizationId);
      const columns = await c.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'v_public_organization' ORDER BY ordinal_position`);
      expect(columns.rows.map((r) => r.column_name)).not.toEqual(expect.arrayContaining(['leader_name']));
      expect(columns.rows.map((r) => r.column_name).some((n) => /leader|created_by|schools_estimate/.test(n))).toBe(false);
    });
  });

  it('the seeded organizations are demo- records of the platform only', async () => {
    const rows = await getDb().select({ slug: organization.slug, createdBy: organization.createdByUserId }).from(organization).where(sql`${organization.createdByUserId} IS NULL`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.slug).toMatch(/^demo-/);
  });
});
