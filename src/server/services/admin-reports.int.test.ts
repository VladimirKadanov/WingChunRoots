// The control panel's reports (docs/adr/0041-control-panel-reports.md), against a migrated
// throwaway database: who may read them (staff with the second factor; billing for administrators
// only; account deletion requests in the review report for administrators only), and that each
// report counts what was written: growth, review throughput, archive completeness per lineage,
// schools by stage and city (never a point), and subscriptions by plan with their monthly value.
// Each figure is checked as a change around the rows a test writes. Fictional data only (D20).

import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { billingCustomer, billingSubscription, place, reviewCase, school, teachingRelationship } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { adminBillingReport, adminReport, type ArchiveReport, type GrowthReport, type ReviewReport, type SchoolsReport } from './admin-reports';
import { reportTableCsv } from './admin-reports-csv';
import { member, newLineage, staff } from './relationships.test-support';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;
let admin: Awaited<ReturnType<typeof staff>>;
let moderator: Awaited<ReturnType<typeof staff>>;
let archivist: Awaited<ReturnType<typeof staff>>;

const DAY = 86_400_000;
/** A little ahead, so every row the tests write falls inside the period. */
const later = () => new Date(Date.now() + 60_000);
const hex = (n: number) => randomBytes(n).toString('hex');

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
  admin = await staff('rep-admin', 'admin');
  moderator = await staff('rep-moderator', 'moderator');
  archivist = await staff('rep-archivist', 'archivist');
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

const refused = (p: Promise<unknown>) =>
  p.then(
    () => 'OK',
    (e: unknown) => (e as { code?: string }).code ?? String(e),
  );

describe('who reads the reports', () => {
  it('lets every staff role read the staff reports, and only administrators the billing report', async () => {
    for (const who of [admin, moderator, archivist]) expect(await refused(adminReport(who.principal, { report: 'growth' }))).toBe('OK');
    expect(await refused(adminBillingReport(admin.principal, {}))).toBe('OK');
    expect(await refused(adminBillingReport(moderator.principal, {}))).toBe('FORBIDDEN');
    expect(await refused(adminBillingReport(archivist.principal, {}))).toBe('FORBIDDEN');
  });

  it('refuses members, anonymous callers and staff without the second factor', async () => {
    const someone = await member('rep-member');
    const unverified = await staff('rep-unverified', 'admin', { unverified: true });
    expect(await refused(adminReport(someone.principal, { report: 'review' }))).toBe('FORBIDDEN');
    expect(await refused(adminReport(null, { report: 'review' }))).toBe('UNAUTHORIZED');
    expect(await refused(adminReport(unverified.principal, { report: 'review' }))).toBe('SECOND_FACTOR_REQUIRED');
    expect(await refused(adminBillingReport(unverified.principal, {}))).toBe('SECOND_FACTOR_REQUIRED');
  });

  it('refuses a report or a period that does not exist', async () => {
    expect(await refused(adminReport(admin.principal, { report: 'billing' as 'growth' }))).toBe('BAD_REQUEST');
    expect(await refused(adminReport(admin.principal, { report: 'growth', period: '7d' as '30d' }))).toBe('BAD_REQUEST');
  });

  it('shows account deletion requests in the review report to administrators only', async () => {
    const forAdmin = (await adminReport(admin.principal, { report: 'review' })) as ReviewReport;
    const forModerator = (await adminReport(moderator.principal, { report: 'review' })) as ReviewReport;
    expect(forAdmin.groups.map((g) => g.key)).toContain('deletions');
    expect(forModerator.groups.map((g) => g.key)).not.toContain('deletions');
  });
});

describe('the periods', () => {
  it('has 5 or 13 weeks, or 12 months', async () => {
    const now = new Date('2026-11-18T10:00:00Z');
    const weeks30 = await adminReport(admin.principal, { report: 'growth', period: '30d' }, now);
    const weeks90 = await adminReport(admin.principal, { report: 'growth', period: '90d' }, now);
    const months = await adminReport(admin.principal, { report: 'growth', period: '12m' }, now);
    expect((weeks30 as GrowthReport).buckets).toHaveLength(5);
    expect((weeks90 as GrowthReport).buckets).toHaveLength(13);
    expect((months as GrowthReport).buckets).toHaveLength(12);
    expect(weeks90.range.starts.at(-1)).toBe('2026-11-16');
    expect(months.range.starts[0]).toBe('2025-12-01');
  });
});

describe('growth', () => {
  it('counts a new account and its person in the current bucket', async () => {
    const now = later();
    const before = (await adminReport(admin.principal, { report: 'growth', period: '30d' }, now)) as GrowthReport;
    await member('rep-growth');
    const after = (await adminReport(admin.principal, { report: 'growth', period: '30d' }, now)) as GrowthReport;
    expect(after.totals.accounts.inPeriod - before.totals.accounts.inPeriod).toBe(1);
    expect(after.totals.people.inPeriod - before.totals.people.inPeriod).toBe(1);
    expect(after.totals.accounts.now - before.totals.accounts.now).toBe(1);
    expect(after.buckets.at(-1)!.accounts - before.buckets.at(-1)!.accounts).toBe(1);
    expect(reportTableCsv('growth', after).split('\r\n')[0]).toBe('Period starting (UTC),New accounts,New people on record,Links verified,"Schools added, listed now"');
  });
});

describe('review throughput', () => {
  it('counts opened, decided, approved, closed and the median time by group', async () => {
    const now = later();
    const before = (await adminReport(moderator.principal, { report: 'review', period: '30d' }, now)) as ReviewReport;
    const db = getDb();
    const opened = new Date(Date.now() - 2 * DAY);
    await db.insert(reviewCase).values([
      { kind: 'historical_claim', status: 'resolved', resolution: 'approved', createdAt: opened, resolvedAt: new Date() },
      { kind: 'person_claim', status: 'dismissed', createdAt: opened, resolvedAt: new Date() },
      { kind: 'historical_claim', status: 'open' },
    ]);
    const after = (await adminReport(moderator.principal, { report: 'review', period: '30d' }, now)) as ReviewReport;
    const claims = (r: ReviewReport) => r.groups.find((g) => g.key === 'claims')!;
    expect(claims(after).opened - claims(before).opened).toBe(3);
    expect(claims(after).decided - claims(before).decided).toBe(2);
    expect(claims(after).approved - claims(before).approved).toBe(1);
    expect(claims(after).dismissed - claims(before).dismissed).toBe(1);
    expect(claims(after).openNow - claims(before).openNow).toBe(1);
    expect(claims(after).medianDays).not.toBeNull();
    expect(after.totals.opened - before.totals.opened).toBe(3);
    const sum = (r: ReviewReport) => r.buckets.reduce((t, b) => t + b.decided, 0);
    expect(sum(after) - sum(before)).toBe(2);
  });
});

describe('archive completeness', () => {
  it('counts the people and the sourced share of a lineage', async () => {
    const lineageId = await newLineage('rep-archive');
    const [a, b, c] = await Promise.all([member('rep-a'), member('rep-b'), member('rep-c')]);
    await getDb()
      .insert(teachingRelationship)
      .values([
        { teacherPersonId: a.personId, studentPersonId: b.personId, lineageId, status: 'verified', visibility: 'public', sourceNote: 'Demo book, page 3' },
        { teacherPersonId: b.personId, studentPersonId: c.personId, lineageId, status: 'verified', visibility: 'public' },
        { teacherPersonId: a.personId, studentPersonId: c.personId, lineageId, status: 'pending_teacher', visibility: 'involved_only' },
      ]);
    const report = (await adminReport(archivist.principal, { report: 'archive' }, later())) as ArchiveReport;
    const row = report.lineages.find((l) => l.name === 'Demo rep-archive Lineage');
    expect(row).toMatchObject({ people: 3, links: 2, sourced: 1, sourcedPercent: 50, addedInPeriod: 2 });
    expect(report.totals.links).toBeGreaterThanOrEqual(2);
  });
});

describe('schools', () => {
  it('counts listed schools by stage, country and city, with no point', async () => {
    const db = getDb();
    const owner = await member('rep-school-owner', { sifu: true });
    const [city] = await db
      .insert(place)
      .values({ geonamesId: 800000 + Math.floor(Math.random() * 90000), name: 'Demo Report City', asciiName: 'Demo Report City', countryCode: 'IS', centroid: { lng: -21.9, lat: 64.1 } })
      .returning({ id: place.id, centroid: place.centroid });
    const before = (await adminReport(moderator.principal, { report: 'schools' }, later())) as SchoolsReport;
    const row = (slug: string, status: 'active' | 'pending_review') => ({ slug, name: 'Demo Report Kwoon', placeId: city!.id, locationPrivacy: 'city_only' as const, publicPoint: city!.centroid, status, createdByUserId: owner.account.id });
    await db.insert(school).values([row(`demo-rep-a-${hex(3)}`, 'active'), row(`demo-rep-b-${hex(3)}`, 'active'), row(`demo-rep-c-${hex(3)}`, 'pending_review')]);
    const after = (await adminReport(moderator.principal, { report: 'schools' }, later())) as SchoolsReport;
    const stage = (r: SchoolsReport, key: string) => r.stages.find((s) => s.key === key)!.count;
    expect(stage(after, 'current') - stage(before, 'current')).toBe(2);
    expect(stage(after, 'pending_review') - stage(before, 'pending_review')).toBe(1);
    expect(after.cities.find((c) => c.city === 'Demo Report City')).toEqual({ countryCode: 'IS', city: 'Demo Report City', listed: 2 });
    expect(after.countries.find((c) => c.countryCode === 'IS')).toMatchObject({ listed: 2, cities: 1 });
    const text = JSON.stringify(after);
    expect(text).not.toMatch(/-21\.9|64\.1|lng|lat|centroid|publicPoint/);
  });
});

describe('billing', () => {
  it('counts subscriptions by plan and status and their monthly value, for administrators', async () => {
    const db = getDb();
    const now = later();
    const before = await adminBillingReport(admin.principal, { period: '30d' }, now);
    const payer = await member('rep-payer');
    const [customer] = await db.insert(billingCustomer).values({ provider: 'test', providerCustomerId: `cus_${hex(6)}`, subjectUserId: payer.account.id }).returning({ id: billingCustomer.id });
    await db.insert(billingSubscription).values({
      provider: 'test',
      providerSubscriptionId: `sub_${hex(6)}`,
      customerId: customer!.id,
      subjectUserId: payer.account.id,
      planCode: 'premium_student',
      interval: 'month',
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * DAY),
      providerVersion: 1,
    });
    const after = await adminBillingReport(admin.principal, { period: '30d' }, now);
    const active = (r: typeof after) => r.byPlan.find((p) => p.code === 'premium_student')?.counts.active ?? 0;
    expect(active(after) - active(before)).toBe(1);
    expect(after.monthlyCents).toBeGreaterThan(before.monthlyCents);
    expect(after.buckets.at(-1)!.running - before.buckets.at(-1)!.running).toBe(1);
    expect(after.buckets.at(-1)!.started - before.buckets.at(-1)!.started).toBe(1);
    expect(after.buckets.at(-1)!.monthlyCents - before.buckets.at(-1)!.monthlyCents).toBe(after.monthlyCents - before.monthlyCents);
    expect(reportTableCsv('billing-plans', after)).toContain('Plan,Not completed,Active,Payment overdue,Ended,All');
  });
});
