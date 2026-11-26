// "My city is missing" (role replay 2026-11-25, P2-12, ADR 0071), against a migrated throwaway
// database: a signed-in member tells every admin the place's name and country; the audit row keeps
// the name, the country and the number of admins told, with the member as the actor; a bad name or
// country is refused field by field; a sixth report in a day is refused; nobody signed out reports.
// Fictional data only (D20).

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { auditLog, notification } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { PLACE_REPORTS_PER_DAY, reportMissingPlace } from './places';
import { member, meta, staff } from './relationships.test-support';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

async function failure(promise: Promise<unknown>): Promise<{ code?: string; fields?: Record<string, string> }> {
  return (await promise.then(
    () => ({}),
    (e: unknown) => e,
  )) as { code?: string; fields?: Record<string, string> };
}

describe('reportMissingPlace', () => {
  it('tells every admin the name and the country, and audits it with the member as the actor', async () => {
    const admin = await staff('places-admin', 'admin');
    const reporter = await member('places-reporter');
    const outcome = await reportMissingPlace(reporter.principal, { name: '  Demo   Missing Town ', countryCode: 'FR' }, meta);
    expect(outcome.reported).toBe(true);
    expect(outcome.notified).toBeGreaterThanOrEqual(1);

    const told = await getDb()
      .select({ payload: notification.payload })
      .from(notification)
      .where(and(eq(notification.userId, admin.account.id), eq(notification.template, 'place.missing')));
    expect(told.map((row) => row.payload)).toEqual([{ name: 'Demo Missing Town', countryCode: 'FR' }]);

    const audited = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'place.missing_report'), eq(auditLog.actorUserId, reporter.account.id)));
    expect(audited).toHaveLength(1);
    expect(audited[0]!.after).toEqual({ name: 'Demo Missing Town', countryCode: 'FR', notifiedAdmins: outcome.notified });
    expect(audited[0]!.subjectType).toBe('place');
  });

  it('refuses an empty name and an unknown country field by field, and anyone signed out', async () => {
    const reporter = await member('places-fields');
    const refused = await failure(reportMissingPlace(reporter.principal, { name: ' ', countryCode: 'ZZ' }, meta));
    expect(refused.code).toBe('BAD_REQUEST');
    expect(Object.keys(refused.fields ?? {}).sort()).toEqual(['countryCode', 'name']);
    expect((await failure(reportMissingPlace(null, { name: 'Demo Town', countryCode: 'FR' }, meta))).code).toBe('UNAUTHORIZED');
  });

  it(`refuses a report after ${PLACE_REPORTS_PER_DAY} in a day`, async () => {
    const reporter = await member('places-limit');
    for (let i = 0; i < PLACE_REPORTS_PER_DAY; i += 1) await reportMissingPlace(reporter.principal, { name: `Demo Town ${i}`, countryCode: 'IT' }, meta);
    expect((await failure(reportMissingPlace(reporter.principal, { name: 'Demo Town again', countryCode: 'IT' }, meta))).code).toBe('TOO_MANY_REQUESTS');
  });
});
