// The Supporter badge (ADR 0049): off until the member switches it on, on a plan that includes it,
// shown only while the person is public; kept and not shown on a lower plan; off on any plan.

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { auditLog, entitlementGrant, person } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { mySupporter, profileSupporter, setSupporter } from './supporter';
import { member, meta } from './relationships.test-support';

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

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'answered',
    (error: { code?: string }) => error.code,
  );

describe('the Supporter badge (ADR 0049)', () => {
  it('is off by default, switched on only on the plan, shown only while public, kept on a lower plan', async () => {
    const m = await member('supporter');
    expect(await mySupporter(m.principal)).toEqual({ show: false, allowed: false });
    expect(await codeOf(setSupporter(m.principal, { show: true }, meta))).toBe('ENTITLEMENT_REQUIRED');
    expect(await setSupporter(m.principal, { show: false }, meta)).toEqual({ show: false, allowed: false });

    const [grant] = await getDb()
      .insert(entitlementGrant)
      .values({ subjectUserId: m.account.id, planCode: 'premium_student', source: 'test_grant', startsAt: new Date(Date.now() - 60_000), reason: 'Demo: ADR 0049 test plan' })
      .returning({ id: entitlementGrant.id });
    expect((await profileSupporter(null, { slug: m.slug })).supporter).toBe(false);
    expect(await setSupporter(m.principal, { show: true }, meta)).toEqual({ show: true, allowed: true });
    expect((await profileSupporter(null, { slug: m.slug })).supporter).toBe(true);
    const audited = await getDb()
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(and(eq(auditLog.subjectId, m.personId), eq(auditLog.action, 'person.supporter_badge')));
    expect(audited).toEqual([{ after: { show: true } }]);

    // Private: NOT_FOUND, whatever the plan and the choice.
    await getDb().update(person).set({ visibility: 'involved_only' }).where(eq(person.id, m.personId));
    expect(await codeOf(profileSupporter(null, { slug: m.slug }))).toBe('NOT_FOUND');
    await getDb().update(person).set({ visibility: 'public' }).where(eq(person.id, m.personId));

    await getDb().update(entitlementGrant).set({ endsAt: new Date(Date.now() - 1_000) }).where(eq(entitlementGrant.id, grant!.id));
    expect((await profileSupporter(null, { slug: m.slug })).supporter).toBe(false);
    expect(await mySupporter(m.principal)).toEqual({ show: true, allowed: false });
    expect(await setSupporter(m.principal, { show: false }, meta)).toEqual({ show: false, allowed: false });
    expect(await codeOf(profileSupporter(null, { slug: 'Not a slug!' }))).toBe('NOT_FOUND');
    expect(await codeOf(mySupporter(null))).toBe('UNAUTHORIZED');
  });
});
