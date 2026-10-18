// Downgrades in the pilot (M08, Done when 2; plan §6.5, DEFAULT D06/D08): revoking the Pro Sifu
// test plan of demo-pro-sifu-8 leaves all eight links verified and public, and requireEntitlement()
// refuses a new approval with code 'quota'; switching from Sifu to Student keeps every confirmed
// link. Runs the real services (grants.revokeGrant, plans.setAccountType) on the seeded demo data.

import { and, count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Principal } from '../auth/principal';
import { closeDb, getDb } from '../db';
import { auditLog, authUser, entitlementGrant, person, teachingRelationship } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { revokeGrant } from '../services/grants';
import { setAccountType } from '../services/plans';
import { effectivePlan, requireEntitlement } from './access';

let testDb: TestDatabase | undefined;
const meta = { requestId: 'demo-downgrade-test', ipHmac: null };

beforeAll(async () => {
  testDb = await createTestDatabase({ seed: true });
  process.env.DATABASE_URL = testDb.url;
});

afterAll(async () => {
  await closeDb();
  await testDb?.drop();
});

async function account(slug: string) {
  const [row] = await getDb()
    .select({ userId: authUser.id, role: authUser.role, email: authUser.email, personId: person.id })
    .from(authUser)
    .innerJoin(person, eq(person.claimedByUserId, authUser.id))
    .where(eq(authUser.email, `${slug}@example.test`));
  return row!;
}

function principalOf(user: { userId: string; email: string; role: Principal['user']['role'] }, verified = true): Principal {
  return {
    user: { id: user.userId, email: user.email, emailVerified: true, role: user.role, twoFactorEnabled: user.role !== 'user' },
    session: { id: `session-${user.userId}`, expiresAt: new Date(Date.now() + 3_600_000), twoFactorVerifiedAt: verified ? new Date() : null },
    via: 'cookie',
  };
}

async function admin(): Promise<Principal> {
  const [row] = await getDb().select({ userId: authUser.id, role: authUser.role, email: authUser.email }).from(authUser).where(eq(authUser.email, 'demo-admin@example.test'));
  return principalOf(row!);
}

/** The teacher's established links: [all, verified and public, shown in v_public_edge]. */
async function links(teacherPersonId: string): Promise<[number, number, number]> {
  const db = getDb();
  const [all] = await db.select({ n: count() }).from(teachingRelationship).where(eq(teachingRelationship.teacherPersonId, teacherPersonId));
  const [verifiedPublic] = await db
    .select({ n: count() })
    .from(teachingRelationship)
    .where(and(eq(teachingRelationship.teacherPersonId, teacherPersonId), eq(teachingRelationship.status, 'verified'), eq(teachingRelationship.visibility, 'public')));
  const view = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM v_public_edge WHERE teacher_person_id = ${teacherPersonId}`);
  return [all!.n, verifiedPublic!.n, view.rows[0]!.n];
}

describe('revoking the Pro Sifu test plan of demo-pro-sifu-8', () => {
  it('leaves all 8 links verified and public, and refuses a new approval with code quota', async () => {
    const sifu = await account('demo-pro-sifu-8');
    const subject = { kind: 'user' as const, userId: sifu.userId };
    expect(await links(sifu.personId)).toEqual([8, 8, 8]);
    expect((await effectivePlan(subject)).plan).toBe('pro_sifu');
    expect(await requireEntitlement(subject, 'approve_students')).toEqual({ ok: true, plan: 'pro_sifu', limit: null, current: 8 });

    const [grant] = await getDb()
      .select({ id: entitlementGrant.id })
      .from(entitlementGrant)
      .where(and(eq(entitlementGrant.subjectUserId, sifu.userId), eq(entitlementGrant.planCode, 'pro_sifu')));
    const revoked = await revokeGrant(await admin(), { grantId: grant!.id, reason: 'Demo: end of the test period' }, meta);
    expect(revoked).toMatchObject({ state: 'revoked', revokeReason: 'Demo: end of the test period', revokedBy: 'demo-admin@example.test' });

    expect(await links(sifu.personId)).toEqual([8, 8, 8]);
    expect((await effectivePlan(subject)).plan).toBe('free_sifu');
    expect(await requireEntitlement(subject, 'approve_students')).toEqual({
      ok: false,
      code: 'quota',
      plan: 'free_sifu',
      limit: 5,
      current: 8,
      grantedBy: 'pro_sifu',
    });

    const audits = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'grant.revoke'), eq(auditLog.subjectId, grant!.id)));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ reason: 'Demo: end of the test period', actorRole: 'admin', requestId: 'demo-downgrade-test' });
  });

  it('a second revoke is refused and changes nothing', async () => {
    const sifu = await account('demo-pro-sifu-8');
    const [grant] = await getDb().select({ id: entitlementGrant.id }).from(entitlementGrant).where(eq(entitlementGrant.subjectUserId, sifu.userId));
    await expect(revokeGrant(await admin(), { grantId: grant!.id, reason: 'Again' }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await links(sifu.personId)).toEqual([8, 8, 8]);
  });
});

describe('switching from Sifu to Student', () => {
  it('keeps every confirmed link of demo-free-sifu-5 and demo-pro-sifu-8, and is audited', async () => {
    for (const slug of ['demo-free-sifu-5', 'demo-pro-sifu-8']) {
      const sifu = await account(slug);
      const subject = { kind: 'user' as const, userId: sifu.userId };
      const before = await links(sifu.personId);
      expect(before[1]).toBeGreaterThanOrEqual(5);

      const change = await setAccountType(principalOf(sifu), { accountType: 'student' }, meta);
      expect(change).toMatchObject({ accountType: 'student', changed: true, plan: { code: 'free_student' }, instructor: { label: 'Student' } });
      expect(await links(sifu.personId)).toEqual(before);
      // A Student account approves no students; with five or more already, Free Sifu would not
      // allow another either, so the refusal names Professional Sifu.
      expect(await requireEntitlement(subject, 'approve_students')).toMatchObject({ ok: false, code: 'plan', plan: 'free_student', grantedBy: 'pro_sifu' });

      const audits = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'account.type_change'), eq(auditLog.subjectId, sifu.userId)));
      expect(audits).toHaveLength(1);
      expect(audits[0]!.before).toMatchObject({ accountType: 'sifu', plan: 'free_sifu' });
      expect(audits[0]!.after).toMatchObject({ accountType: 'student', plan: 'free_student' });
    }
  });

  it('switching back to Sifu restores the free Sifu plan and the verified instructor label', async () => {
    const sifu = await account('demo-free-sifu-5');
    const change = await setAccountType(principalOf(sifu), { accountType: 'sifu' }, meta);
    expect(change).toMatchObject({ accountType: 'sifu', plan: { code: 'free_sifu' }, instructor: { status: 'verified', label: 'Instructor' } });
    // The same choice again changes nothing and writes no second audit row.
    expect(await setAccountType(principalOf(sifu), { accountType: 'sifu' }, meta)).toMatchObject({ changed: false });
    const [audits] = await getDb().select({ n: count() }).from(auditLog).where(and(eq(auditLog.action, 'account.type_change'), eq(auditLog.subjectId, sifu.userId)));
    expect(audits!.n).toBe(2);
  });
});
