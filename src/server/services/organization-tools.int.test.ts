// Organization tools (milestone M24, docs/adr/0027-organization-tools.md) against PostGIS, on the
// seeded demo data: the bulk import never authenticates a person, never matches or merges onto an
// existing account and never creates, verifies or changes a teaching relationship (execution plan,
// Phase 3 completion condition); one organization never reads or edits another's imports, claims
// or numbers; the analytics count only the organization's own records and public states; the
// heatmap never draws a square a single school could be found in; a separation keeps the history
// and every relationship and removes only the organization's own fields and claims.
// Fictional data only (D20).

import { randomBytes } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { notification, organization, organizationImport, organizationImportRow, organizationMembership, organizationTeacherClaim, person } from '../db/schema';
import { ORGANIZATION_IMPORTS_PER_DAY } from '../db/schema/organization-tools';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { grantOrganizationPlan, revokeOrganizationPlan } from './organization-grants';
import { commitImport, discardImport, getImport, listImports, previewImport } from './organization-import';
import { HEATMAP_MIN_SCHOOLS, organizationAnalytics, organizationHeatmap } from './organization-insights';
import { leaveOrganization, myMemberships, organizationClaims, withdrawClaim } from './organization-separation';
import { addOrganizationMember, applyOrganization, endOrganizationMember } from './organizations';
import { approveRelationship, requestTeacher } from './relationships';
import { createUser, key, member, meta, newLineage, ongoingFrom, principalOf, staff } from './relationships.test-support';
import { expireOrganizationImports } from './retention';

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

/** An approved organization of a new owner account, with a test Federation plan unless `plan: false`. */
async function federation(opts: { plan?: boolean } = {}) {
  const account = await createUser('m24-owner');
  const owner = principalOf(account);
  const applied = await applyOrganization(
    owner,
    { name: `Demo ${randomBytes(2).toString('hex')} Federation`, kind: 'federation', leaderName: 'Demo Leader', leaderTitle: null, websiteUrl: null, countryCode: 'BG', schoolsEstimate: 3, evidenceIds: [], note: null, idempotencyKey: key() },
    meta,
  );
  await getDb().execute(sql`UPDATE organization SET status = 'active', approved_at = now() WHERE id = ${applied.organizationId}::uuid`);
  await getDb().execute(sql`UPDATE review_case SET status = 'resolved', resolution = 'approved', resolved_at = now() WHERE id = ${applied.caseId}::uuid`);
  admin ??= await staff('m24-admin', 'admin');
  let grantId: string | null = null;
  if (opts.plan !== false) grantId = (await grantOrganizationPlan(admin.principal, { organizationId: applied.organizationId, reason: 'M24 test plan (fictional)' }, meta)).grants[0]!.id;
  return { account, owner, organizationId: applied.organizationId, grantId };
}

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const HEADER = 'First_Name,Last_Name,Email,Chinese_Name,Start_Year,Current_Rank,Sifu_Database_ID,School_City';

/** Every teaching relationship and every person's visibility, except the people listed (new records). */
async function lineageState(): Promise<string> {
  const result = await getDb().execute<{ h: string }>(sql`
    SELECT md5(coalesce((SELECT string_agg(t.id::text || t.status || t.visibility || t.updated_at::text, ',' ORDER BY t.id) FROM teaching_relationship t), '') ||
               coalesce((SELECT string_agg(p.id::text || p.visibility || p.stewardship || coalesce(p.claimed_by_user_id::text, '') || p.updated_at::text, ',' ORDER BY p.id) FROM person p
                          WHERE p.id NOT IN (SELECT person_id FROM organization_import_row WHERE person_id IS NOT NULL)), '')) AS h`);
  return result.rows[0]!.h;
}

describe('the bulk import (In scope 1)', () => {
  it('previews per-row errors, then imports private unclaimed records with claims that are never relationships', async () => {
    const org = await federation();
    const teacher = await member('m24-teacher', { sifu: true });
    // A person with an account outside the organization, whose name a row repeats: never matched.
    const outsider = await member('outsider-sample');
    const [outsiderName] = await getDb().execute<{ value: string }>(sql`SELECT value FROM person_name WHERE person_id = ${outsider.personId}::uuid AND is_primary`).then((r) => r.rows);
    const [first, ...rest] = outsiderName!.value.split(' ');
    const before = await lineageState();
    const file = [
      HEADER,
      `Demo,Imported One,demo-imported-one@example.test,陳大文,2015,Second level,/people/${teacher.slug},Demo City`,
      `${first},${rest.join(' ')},,,,,,`,
      `Demo,Imported One,,,,,,`,
      `,Missing First,,,,,,`,
      `Demo,Bad Year,,,15,,,`,
      `Demo,No Teacher,,,,,demo-not-a-profile,`,
    ].join('\n');
    const preview = await previewImport(org.owner, { organizationId: org.organizationId, contentBase64: b64(file) }, meta);
    expect(preview.status).toBe('previewed');
    expect(preview.emailIgnored).toBe(true);
    expect(preview.rows.map((r) => [r.rowNumber, r.status, r.errors.map((e) => e.field)])).toEqual([
      [2, 'valid', []],
      [3, 'valid', []],
      [4, 'error', ['row']],
      [5, 'error', ['First_Name']],
      [6, 'error', ['Start_Year']],
      [7, 'error', ['Sifu_Database_ID']],
    ]);
    expect(preview.rows[0]!.teacher?.id).toBe(teacher.personId);
    expect(preview.can.commit).toBe(true);
    // The e-mail address is never stored.
    const stored = await getDb().execute<{ n: number }>(sql`
      SELECT (SELECT count(*) FROM organization_import_row WHERE data::text LIKE '%example.test%')::int +
             (SELECT count(*) FROM audit_log WHERE coalesce(after::text, '') LIKE '%example.test%' OR coalesce(after::text, '') LIKE '%Imported One%')::int AS n`);
    expect(stored.rows[0]!.n).toBe(0);

    const committed = await commitImport(org.owner, { organizationId: org.organizationId, importId: preview.id }, meta);
    expect(committed.status).toBe('committed');
    expect(committed.importedCount).toBe(2);
    // The parsed fields are cleared once the import ends.
    expect(committed.rows.every((r) => r.name === null)).toBe(true);
    const created = committed.rows.filter((r) => r.status === 'imported').map((r) => r.person!.id);
    expect(created).toHaveLength(2);
    const people = await getDb().select().from(person).where(sql`${person.id} IN (${sql.join(created.map((id) => sql`${id}::uuid`), sql`, `)})`);
    for (const p of people) {
      expect([p.stewardship, p.visibility, p.claimedByUserId, p.kind]).toEqual(['unclaimed', 'involved_only', null, 'living']);
    }
    // The row with the outsider's name became a record of its own: the outsider is unchanged.
    expect(created).not.toContain(outsider.personId);
    const claims = await getDb().select().from(organizationTeacherClaim).where(eq(organizationTeacherClaim.organizationId, org.organizationId));
    expect(claims.map((c) => [c.teacherPersonId, c.status, c.startYear])).toEqual([[teacher.personId, 'claimed_by_organization', 2015]]);
    // No teaching relationship and no other person changed (DEFAULT D12).
    expect(await lineageState()).toBe(before);
    const rels = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM teaching_relationship WHERE student_person_id = ANY (ARRAY[${sql.join(created.map((id) => sql`${id}::uuid`), sql`, `)}])`);
    expect(rels.rows[0]!.n).toBe(0);
    // Twice: the same file again finds the members it created and imports nobody twice.
    const again = await previewImport(org.owner, { organizationId: org.organizationId, contentBase64: b64(file) }, meta);
    expect(again.rows.slice(0, 2).map((r) => r.status)).toEqual(['error', 'error']);
    await expect(commitImport(org.owner, { organizationId: org.organizationId, importId: preview.id }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses a broken file, needs Federation, and allows ten previews a day', async () => {
    const org = await federation();
    await expect(previewImport(org.owner, { organizationId: org.organizationId, contentBase64: b64('Name\nDemo\n') }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST', fields: { file: expect.stringMatching(/First_Name/) } });
    const noPlan = await federation({ plan: false });
    await expect(previewImport(noPlan.owner, { organizationId: noPlan.organizationId, contentBase64: b64(`${HEADER}\nDemo,Student,,,,,,\n`) }, meta)).rejects.toMatchObject({ code: 'ENTITLEMENT_REQUIRED' });
    for (let i = 0; i < ORGANIZATION_IMPORTS_PER_DAY; i++) {
      await previewImport(org.owner, { organizationId: org.organizationId, contentBase64: b64(`${HEADER}\nDemo,Student ${'abcdefghij'[i]},,,,,,\n`) }, meta);
    }
    await expect(previewImport(org.owner, { organizationId: org.organizationId, contentBase64: b64(`${HEADER}\nDemo,Student,,,,,,\n`) }, meta)).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('an expired preview cannot be committed and keeps no names; discard clears a preview too', async () => {
    const org = await federation();
    const preview = await previewImport(org.owner, { organizationId: org.organizationId, contentBase64: b64(`${HEADER}\nDemo,Expiring Student,,,,,,\n`) }, meta);
    await getDb().update(organizationImport).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(organizationImport.id, preview.id));
    expect((await expireOrganizationImports(getDb())).imports).toBeGreaterThanOrEqual(1);
    const [row] = await getDb().select().from(organizationImportRow).where(eq(organizationImportRow.importId, preview.id));
    expect(row!.data).toBeNull();
    await expect(commitImport(org.owner, { organizationId: org.organizationId, importId: preview.id }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
    const other = await previewImport(org.owner, { organizationId: org.organizationId, contentBase64: b64(`${HEADER}\nDemo,Discarded Student,,,,,,\n`) }, meta);
    const discarded = await discardImport(org.owner, { organizationId: org.organizationId, importId: other.id }, meta);
    expect([discarded.status, discarded.rows[0]!.name]).toEqual(['discarded', null]);
    expect((await listImports(org.owner, { organizationId: org.organizationId })).imports.map((i) => i.status)).toEqual(['discarded', 'expired']);
  });
});

describe('one organization never reaches another (Phase 3 completion condition)', () => {
  it("another organization's admin, a member and staff get 404 for its imports, claims, analytics and heatmap", async () => {
    const org = await federation();
    const other = await federation();
    const teacher = await member('m24-sep-teacher', { sifu: true });
    const preview = await previewImport(org.owner, { organizationId: org.organizationId, contentBase64: b64(`${HEADER}\nDemo,Guarded Student,,,,,${teacher.slug},\n`) }, meta);
    const someone = await member('m24-someone');
    admin ??= await staff('m24-admin', 'admin');
    for (const who of [other.owner, someone.principal, admin.principal]) {
      const ids = { organizationId: org.organizationId, importId: preview.id };
      await expect(getImport(who, ids)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(commitImport(who, ids, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(discardImport(who, ids, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(listImports(who, { organizationId: org.organizationId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(organizationClaims(who, { organizationId: org.organizationId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(organizationAnalytics(who, { organizationId: org.organizationId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(organizationHeatmap(who, { organizationId: org.organizationId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    // The other organization's own id with this one's import: still 404.
    await expect(getImport(other.owner, { organizationId: other.organizationId, importId: preview.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const committed = await commitImport(org.owner, { organizationId: org.organizationId, importId: preview.id }, meta);
    const [claim] = (await organizationClaims(org.owner, { organizationId: org.organizationId })).claims;
    await expect(withdrawClaim(other.owner, { organizationId: other.organizationId, claimId: claim!.id }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(withdrawClaim(other.owner, { organizationId: org.organizationId, claimId: claim!.id }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // A teacher named only by another organization's private record is not found by this one.
    const privateSlug = (await getDb().select({ slug: person.slug }).from(person).where(eq(person.id, committed.rows[0]!.person!.id)))[0]!.slug;
    const probe = await previewImport(other.owner, { organizationId: other.organizationId, contentBase64: b64(`${HEADER}\nDemo,Probe Student,,,,,${privateSlug},\n`) }, meta);
    expect(probe.rows[0]!.errors.map((e) => e.field)).toEqual(['Sifu_Database_ID']);
    expect(await withdrawClaim(org.owner, { organizationId: org.organizationId, claimId: claim!.id }, meta)).toEqual({ claimId: claim!.id, status: 'withdrawn' });
  });
});

describe('analytics and the heatmap (In scope 2, 3)', () => {
  async function cityId(name: string, country: string): Promise<string> {
    const rows = await getDb().execute<{ id: string }>(sql`SELECT id::text FROM place WHERE name = ${name} AND country_code = ${country} ORDER BY population DESC NULLS LAST LIMIT 1`);
    return rows.rows[0]!.id;
  }
  async function linkedSchool(organizationId: string, placeId: string, exact: { lat: number; lng: number }) {
    const owner = await createUser('m24-school-owner');
    const id = (await getDb().execute<{ id: string }>(sql`
      INSERT INTO school (slug, name, place_id, location_privacy, public_point, status, created_by_user_id)
      VALUES (${`demo-m24-${randomBytes(4).toString('hex')}`}, 'Demo Heatmap Hall', ${placeId}::uuid, 'exact', ST_SetSRID(ST_MakePoint(${exact.lng}, ${exact.lat}), 4326)::geography, 'draft', ${owner.id}::uuid)
      RETURNING id::text`)).rows[0]!.id;
    await getDb().execute(sql`INSERT INTO school_private_location (school_id, exact_point) VALUES (${id}::uuid, ST_SetSRID(ST_MakePoint(${exact.lng}, ${exact.lat}), 4326)::geography)`);
    await getDb().execute(sql`INSERT INTO organization_school (organization_id, school_id, status, answered_at) VALUES (${organizationId}::uuid, ${id}::uuid, 'accepted', now())`);
    return id;
  }

  it('counts the own records and public states only, and is gone with the plan', async () => {
    const org = await federation();
    const teacher = await member('m24-an-teacher', { sifu: true });
    const verified = await member('m24-an-verified');
    const pending = await member('m24-an-pending');
    const lineageId = await newLineage('m24-analytics');
    const r1 = await requestTeacher(verified.principal, { teacherId: teacher.personId, lineageId, periods: ongoingFrom(), idempotencyKey: key() }, meta);
    await approveRelationship(teacher.principal, { relationshipId: r1.relationship.id, idempotencyKey: key() }, meta);
    await requestTeacher(pending.principal, { teacherId: teacher.personId, lineageId, periods: ongoingFrom(), idempotencyKey: key() }, meta);
    for (const m of [verified, pending]) await addOrganizationMember(org.owner, { organizationId: org.organizationId, personSlug: m.slug, role: 'member' }, meta);
    const preview = await previewImport(org.owner, { organizationId: org.organizationId, contentBase64: b64(`${HEADER}\nDemo,Counted Record,,,,,${teacher.slug},\n`) }, meta);
    await commitImport(org.owner, { organizationId: org.organizationId, importId: preview.id }, meta);
    const a = await organizationAnalytics(org.owner, { organizationId: org.organizationId });
    expect(a.members).toEqual({ current: 3, publicProfiles: 2, withAccount: 2, recordsOnly: 1, ended: 0 });
    // The pending request is never counted (DEFAULT D03).
    expect(a.verification).toEqual({ verified: 1, inArbitration: 0, membersWithVerifiedTeacher: 1 });
    expect(a.claims).toEqual({ open: 1, withdrawn: 0 });
    expect(a.months).toHaveLength(12);
    expect(a.months.at(-1)!.membersJoined).toBe(3);
    expect(a.months.at(-1)!.relationshipsVerified).toBe(1);
    expect(JSON.stringify(a)).not.toMatch(/Demo m24|Counted Record|[0-9a-f]{8}-[0-9a-f]{4}-/);
    await revokeOrganizationPlan(admin.principal, { grantId: org.grantId!, reason: 'M24 test' }, meta);
    await expect(organizationAnalytics(org.owner, { organizationId: org.organizationId })).rejects.toMatchObject({ code: 'ENTITLEMENT_REQUIRED' });
    await expect(organizationHeatmap(org.owner, { organizationId: org.organizationId })).rejects.toMatchObject({ code: 'ENTITLEMENT_REQUIRED' });
  });

  it(`draws only squares of at least ${HEATMAP_MIN_SCHOOLS} schools, at their cities' centres, never a school's own point`, async () => {
    const org = await federation();
    const sofia = await cityId('Sofia', 'BG');
    const plovdiv = await cityId('Plovdiv', 'BG');
    const exact = [
      { lat: 42.69871, lng: 23.32147 },
      { lat: 42.70013, lng: 23.31588 },
      { lat: 42.68529, lng: 23.33961 },
    ];
    for (const point of exact) await linkedSchool(org.organizationId, sofia, point);
    await linkedSchool(org.organizationId, plovdiv, { lat: 42.14821, lng: 24.74957 });
    const h = await organizationHeatmap(org.owner, { organizationId: org.organizationId });
    expect(h.total).toBe(4);
    expect(h.cells).toEqual([{ south: 42, west: 23, size: 1, count: 3, countries: ['BG'] }]);
    expect(h.sparse).toEqual([{ countryCode: 'BG', country: 'Bulgaria', count: 1 }]);
    const text = JSON.stringify(h);
    for (const p of [...exact, { lat: 42.14821, lng: 24.74957 }]) {
      expect(text).not.toContain(String(p.lat));
      expect(text).not.toContain(String(p.lng));
    }
    const a = await organizationAnalytics(org.owner, { organizationId: org.organizationId });
    expect(a.schools).toEqual({ linked: 4, waiting: 0 });
    expect(a.schoolsByCity.map((c) => [c.city, c.count])).toEqual([
      ['Sofia', 3],
      ['Plovdiv', 1],
    ]);
  });
});

describe('separation (In scope 4)', () => {
  it('a member leaves alone: the history and every relationship stay, the organization’s fields and claims go, the admins are told', async () => {
    const org = await federation();
    const teacher = await member('m24-leave-teacher', { sifu: true });
    const student = await member('m24-leaver');
    const lineageId = await newLineage('m24-leave');
    const r = await requestTeacher(student.principal, { teacherId: teacher.personId, lineageId, periods: ongoingFrom(), idempotencyKey: key() }, meta);
    await approveRelationship(teacher.principal, { relationshipId: r.relationship.id, idempotencyKey: key() }, meta);
    const added = await addOrganizationMember(org.owner, { organizationId: org.organizationId, personSlug: student.slug, role: 'member' }, meta);
    await getDb().execute(sql`INSERT INTO organization_member_record (membership_id, rank_label) VALUES (${added.membershipId}::uuid, 'Demo rank')`);
    await getDb().insert(organizationTeacherClaim).values({ organizationId: org.organizationId, studentPersonId: student.personId, teacherPersonId: teacher.personId });
    const mine = await myMemberships(student.principal);
    expect(mine.memberships.map((m) => [m.current, m.recorded?.rank, m.claims.length])).toEqual([[true, 'Demo rank', 1]]);
    const before = await lineageState();
    // Another account cannot end it.
    await expect(leaveOrganization(teacher.principal, { membershipId: added.membershipId }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // No plan is needed to leave.
    await revokeOrganizationPlan(admin.principal, { grantId: org.grantId!, reason: 'M24 test' }, meta);
    const left = await leaveOrganization(student.principal, { membershipId: added.membershipId }, meta);
    expect(left.membershipId).toBe(added.membershipId);
    const [row] = await getDb().select().from(organizationMembership).where(eq(organizationMembership.id, added.membershipId));
    expect(row!.endsOn).not.toBeNull();
    const after = await myMemberships(student.principal);
    expect(after.memberships.map((m) => [m.current, m.recorded, m.claims.length])).toEqual([[false, null, 0]]);
    const [claim] = await getDb().select().from(organizationTeacherClaim).where(eq(organizationTeacherClaim.studentPersonId, student.personId));
    expect([claim!.status, claim!.withdrawReason]).toEqual(['withdrawn', 'separation']);
    expect(await lineageState()).toBe(before);
    const told = await getDb().select().from(notification).where(eq(notification.userId, org.account.id));
    expect(told.map((n) => n.template)).toContain('organization.member_left');
    await expect(leaveOrganization(student.principal, { membershipId: added.membershipId }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('the organization ends a membership: the member’s account is told, the record and relationships stay', async () => {
    const org = await federation();
    const student = await member('m24-ended');
    const added = await addOrganizationMember(org.owner, { organizationId: org.organizationId, personSlug: student.slug, role: 'member' }, meta);
    await getDb().execute(sql`INSERT INTO organization_member_record (membership_id, school_city) VALUES (${added.membershipId}::uuid, 'Demo City')`);
    await endOrganizationMember(org.owner, { organizationId: org.organizationId, membershipId: added.membershipId }, meta);
    const told = await getDb().select().from(notification).where(eq(notification.userId, student.account.id));
    expect(told.map((n) => n.template)).toContain('organization.membership_ended');
    const left = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM organization_member_record WHERE membership_id = ${added.membershipId}::uuid`);
    expect(left.rows[0]!.n).toBe(0);
    const [p] = await getDb().select().from(person).where(eq(person.id, student.personId));
    expect(p!.visibility).toBe('public');
    // The organization and the school stay apart from the person (nothing else was touched).
    expect((await getDb().select().from(organization).where(eq(organization.id, org.organizationId)))[0]!.status).toBe('active');
  });
  it('a member who leaves takes the claims naming them as the teacher too; a teacher gone private is shown without a name', async () => {
    const org = await federation();
    const teacher = await member('m24-claimed-teacher', { sifu: true });
    const publicTeacher = await member('m24-public-teacher', { sifu: true });
    const added = await addOrganizationMember(org.owner, { organizationId: org.organizationId, personSlug: teacher.slug, role: 'member' }, meta);
    // A private member: the organization finds the teacher as its own member only.
    await getDb().update(person).set({ visibility: 'involved_only' }).where(eq(person.id, teacher.personId));
    const preview = await previewImport(
      org.owner,
      { organizationId: org.organizationId, contentBase64: b64(`${HEADER}\nDemo,Taught Record,,,,,${teacher.slug},\nDemo,Other Record,,,,,${publicTeacher.slug},\n`) },
      meta,
    );
    await commitImport(org.owner, { organizationId: org.organizationId, importId: preview.id }, meta);
    const open = await organizationClaims(org.owner, { organizationId: org.organizationId });
    expect(open.claims.map((c) => [c.status, c.teacher?.slug])).toEqual(
      expect.arrayContaining([
        ['claimed_by_organization', teacher.slug],
        ['claimed_by_organization', publicTeacher.slug],
      ]),
    );
    // The public teacher hides the profile: the claim stays, without the teacher's name.
    await getDb().update(person).set({ visibility: 'involved_only' }).where(eq(person.id, publicTeacher.personId));
    // The member teacher leaves: the claim naming them as the teacher is withdrawn.
    await leaveOrganization(teacher.principal, { membershipId: added.membershipId }, meta);
    const after = await organizationClaims(org.owner, { organizationId: org.organizationId });
    const byStatus = after.claims.map((c) => [c.status, c.withdrawnBecause, c.teacher?.slug ?? null]);
    expect(byStatus).toEqual(
      expect.arrayContaining([
        ['withdrawn', 'separation', null],
        ['claimed_by_organization', null, null],
      ]),
    );
    expect(JSON.stringify(after)).not.toContain(publicTeacher.slug);
    expect(JSON.stringify(after)).not.toContain(teacher.slug);
  });
});
