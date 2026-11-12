// Federation billing in test mode (milestone M23; docs/adr/0026-federation-billing.md) against
// PostGIS, on the seeded demo data, with the test provider of the app (never Stripe, never a
// network call): an owner of an approved federation subscribes monthly or yearly; another admin,
// another kind of organization or another account cannot; switching between plans and billing
// periods (now with proration, or at the period end); the federation trial (no card, the 14- and
// 7-day notices, the end without a charge or a deletion, the continuation as a subscription); and
// downstream independence (specification §10.3): whatever happens to the federation's subscription
// or trial, the paid plans of its member schools and students stay as they are. Fictional data
// only (D20).

import { randomBytes } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv, stopAuthTestDatabase } from '../auth/test-support';
import { setBillingProvider } from '../billing/provider';
import { prorate } from '../billing/test-provider';
import { getDb } from '../db';
import {
  auditLog,
  billingCheckout,
  billingInvoice,
  billingSubscription,
  entitlementGrant,
  federationTrial,
  notification,
  organization,
  organizationMembership,
  organizationSchool,
  school,
} from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { effectivePlan, organizationPlan } from '../entitlements/access';
import {
  cancelPlanChange,
  cancelSubscription,
  changeSubscriptionPlan,
  endExpiredGrace,
  moveTestClock,
  myBilling,
  organizationBilling,
  startCheckout,
  testCheckout,
  testPay,
} from './billing';
import { applyPendingBillingEvents, paidSubscription } from './billing.test-support';
import { addMonths, adminFederationTrial, endFederationTrial, runFederationTrials, startFederationTrial } from './federation-trials';
import { grantOrganizationPlan, revokeOrganizationPlan } from './organization-grants';
import { addOrganizationAdmin, addOrganizationMember, answerSchoolLink, applyOrganization, requestOrganizationSchool } from './organizations';
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
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  setTestAuthEnv();
  testDb = await createTestDatabase({ seed: true });
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { __wcrAuth?: unknown }).__wcrAuth;
});

afterEach(() => {
  setBillingProvider(null);
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

type Kind = 'federation' | 'association';

/** An organization of a kind, applied for by a fresh account (its owner) and approved by an archivist. */
async function approvedOrganization(label: string, kind: Kind = 'federation', opts: { approve?: boolean } = {}) {
  const owner = await createUser(label);
  const principal = principalOf(owner);
  const applied = await applyOrganization(
    principal,
    {
      kind,
      name: `Demo ${randomBytes(3).toString('hex')} ${kind === 'federation' ? 'Federation' : 'Association'}`,
      leaderName: 'Demo Leader Person',
      leaderTitle: 'President',
      websiteUrl: 'https://example.test/demo',
      countryCode: 'BG',
      schoolsEstimate: 4,
      evidenceIds: [],
      note: 'A fictional organization.',
      idempotencyKey: key(),
    },
    meta,
  );
  if (opts.approve !== false) {
    const archivist = await staff(`${label}-archivist`, 'archivist');
    await assignReviewCase(archivist.principal, { caseId: applied.caseId, assigneeId: archivist.account.id, idempotencyKey: key() }, meta);
    const card = await getReviewCase(archivist.principal, { id: applied.caseId });
    await decideReviewCase(archivist.principal, { caseId: applied.caseId, decision: 'verify', reason: null, idempotencyKey: key(), organizationVersion: card.organization!.version }, meta);
  }
  return { owner: { account: owner, principal }, organizationId: applied.organizationId };
}

/** The owner checks out Federation for the organization and pays with a test card; the events are applied. */
async function federationSubscription(principal: ReturnType<typeof principalOf>, organizationId: string, interval: 'month' | 'year', card: 'succeeds' | 'fails_at_renewal' = 'succeeds') {
  const checkout = await startCheckout(principal, { planCode: 'federation', interval, organizationId }, meta);
  await testPay(principal, { checkoutId: checkout.checkoutId, card }, meta);
  await applyPendingBillingEvents();
  const [sub] = await getDb().select().from(billingSubscription).where(eq(billingSubscription.checkoutId, checkout.checkoutId));
  if (!sub) throw new Error('the federation subscription was not applied');
  return { checkoutId: checkout.checkoutId, subscription: sub };
}

const orgPlan = async (organizationId: string, now?: Date) => (await organizationPlan({ kind: 'organization', organizationId }, { now })).plan;
const userPlan = async (userId: string, now?: Date) => (await effectivePlan({ kind: 'user', userId }, { now })).plan;
const subscriptionRow = async (id: string) => (await getDb().select().from(billingSubscription).where(eq(billingSubscription.id, id)))[0]!;
const invoicesOf = async (subscriptionId: string) => getDb().select().from(billingInvoice).where(eq(billingInvoice.subscriptionId, subscriptionId)).orderBy(billingInvoice.createdAt);
const noticesOf = async (userId: string) =>
  getDb().select({ template: notification.template, payload: notification.payload }).from(notification).where(eq(notification.userId, userId));
const trialOf = async (organizationId: string) => (await getDb().select().from(federationTrial).where(eq(federationTrial.organizationId, organizationId)))[0];

let admin: Awaited<ReturnType<typeof staff>> | undefined;
const anAdmin = async () => (admin ??= await staff('m23-admin', 'admin'));

describe('Federation checkout', () => {
  it('the owner of an approved federation subscribes monthly ($99) with the test card; the plan follows the applied events', async () => {
    const { owner, organizationId } = await approvedOrganization('m23-monthly');
    const before = await organizationBilling(owner.principal, { organizationId });
    expect(before).toMatchObject({ you: { role: 'owner', canManage: true }, plan: { code: null }, subscription: null, offersNote: null, testModeLabel: 'Test mode, no real charge' });
    expect(before.offers.map((o) => `${o.planCode}/${o.interval}/${o.price}/${o.priceLabel}`)).toEqual([
      'federation/month/$99.00 a month/Proposed price (not final)',
      'federation/year/$990.00 a year/Proposed price (not final)',
    ]);
    // Only what exists now (CLAUDE.md §11).
    expect(before.benefits.length).toBeGreaterThan(0);

    const started = await startCheckout(owner.principal, { planCode: 'federation', interval: 'month', organizationId }, meta);
    const page = await testCheckout(owner.principal, { checkoutId: started.checkoutId });
    expect(page).toMatchObject({ planName: 'Federation', price: '$99.00 a month', backHref: `/dashboard/organization/${organizationId}/billing`, trialEndsAt: null });
    await testPay(owner.principal, { checkoutId: started.checkoutId, card: 'succeeds' }, meta);
    expect(await orgPlan(organizationId)).toBeNull();
    await applyPendingBillingEvents();
    expect(await orgPlan(organizationId)).toBe('federation');

    const [sub] = await getDb().select().from(billingSubscription).where(eq(billingSubscription.subjectOrganizationId, organizationId));
    expect(sub).toMatchObject({ status: 'active', planCode: 'federation', interval: 'month', subjectUserId: null });
    const [grant] = await getDb().select().from(entitlementGrant).where(eq(entitlementGrant.id, sub!.grantId!));
    expect(grant).toMatchObject({ source: 'stripe', planCode: 'federation', subjectOrganizationId: organizationId, subjectUserId: null });
    expect((await invoicesOf(sub!.id)).map((i) => i.amountCents)).toEqual([9900]);
    // The buyer is the organization, never an individual: the owner's own plan is unchanged.
    expect(await userPlan(owner.account.id)).toBe('free_student');
    expect((await myBilling(owner.principal)).subscription).toBeNull();
    expect((await noticesOf(owner.account.id)).map((n) => n.template)).toContain('billing.started');
    const after = await organizationBilling(owner.principal, { organizationId });
    expect(after.offers).toEqual([]);
    expect(after.subscription).toMatchObject({ status: 'active', canCancel: true });
    // A second checkout while it is live is refused.
    await expect(startCheckout(owner.principal, { planCode: 'federation', interval: 'year', organizationId }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('yearly costs $990 and is billed once a year', async () => {
    const { owner, organizationId } = await approvedOrganization('m23-yearly');
    const { subscription } = await federationSubscription(owner.principal, organizationId, 'year');
    expect(subscription.interval).toBe('year');
    expect((await invoicesOf(subscription.id)).map((i) => i.amountCents)).toEqual([99000]);
    const days = (subscription.currentPeriodEnd.getTime() - subscription.currentPeriodStart.getTime()) / DAY;
    expect(days).toBeGreaterThanOrEqual(365);
  });

  it('refuses another admin, a non-admin, an association, an organization not yet approved, an individual purchase and another account’s checkout', async () => {
    const { owner, organizationId } = await approvedOrganization('m23-refusals');
    const other = await createUser('m23-second-admin');
    await addOrganizationAdmin(owner.principal, { organizationId, email: other.email }, meta);
    const second = principalOf(other);
    await expect(startCheckout(second, { planCode: 'federation', interval: 'month', organizationId }, meta)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Another admin reads, without the offers or the forms.
    const read = await organizationBilling(second, { organizationId });
    expect(read).toMatchObject({ you: { role: 'admin', canManage: false }, offers: [], offersNote: 'Only an owner of the organization can choose its plan.' });

    const stranger = await member('m23-stranger');
    await expect(startCheckout(stranger.principal, { planCode: 'federation', interval: 'month', organizationId }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(organizationBilling(stranger.principal, { organizationId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Federation is never a plan of an account.
    await expect(startCheckout(owner.principal, { planCode: 'federation', interval: 'month' }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // An account plan is never bought for an organization.
    await expect(startCheckout(owner.principal, { planCode: 'premium_student', organizationId }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const association = await approvedOrganization('m23-association', 'association');
    await expect(startCheckout(association.owner.principal, { planCode: 'federation', interval: 'month', organizationId: association.organizationId }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await organizationBilling(association.owner.principal, { organizationId: association.organizationId })).offers).toEqual([]);
    const pending = await approvedOrganization('m23-pending', 'federation', { approve: false });
    await expect(startCheckout(pending.owner.principal, { planCode: 'federation', interval: 'month', organizationId: pending.organizationId }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });

    const started = await startCheckout(owner.principal, { planCode: 'federation', interval: 'month', organizationId }, meta);
    await expect(testCheckout(stranger.principal, { checkoutId: started.checkoutId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(testPay(stranger.principal, { checkoutId: started.checkoutId, card: 'succeeds' }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await getDb().select().from(billingSubscription).where(eq(billingSubscription.subjectOrganizationId, organizationId))).toEqual([]);
  });

  it('billing notices of an organization go to every current admin, with the organization’s billing page', async () => {
    const { owner, organizationId } = await approvedOrganization('m23-notices');
    const other = await createUser('m23-notices-admin');
    await addOrganizationAdmin(owner.principal, { organizationId, email: other.email }, meta);
    await federationSubscription(owner.principal, organizationId, 'month');
    for (const id of [owner.account.id, other.id]) {
      const started = (await noticesOf(id)).find((n) => n.template === 'billing.started');
      expect(started?.payload).toMatchObject({ organizationId });
    }
  });
});

describe('switching plans and billing periods (DEFAULT M23, question 2)', () => {
  it('monthly to yearly takes effect now with the unused part credited; yearly to monthly waits for the period end and can be taken back', async () => {
    const { owner, organizationId } = await approvedOrganization('m23-switch');
    const { subscription } = await federationSubscription(owner.principal, organizationId, 'month');
    const view = await organizationBilling(owner.principal, { organizationId });
    expect(view.subscription!.changeOptions.map((o) => `${o.planCode}/${o.interval}/${o.when}`)).toEqual(['federation/year/now']);

    const stranger = await member('m23-switch-stranger');
    await expect(changeSubscriptionPlan(stranger.principal, { subscriptionId: subscription.id, planCode: 'federation', interval: 'year' }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const other = await createUser('m23-switch-admin');
    await addOrganizationAdmin(owner.principal, { organizationId, email: other.email }, meta);
    await expect(changeSubscriptionPlan(principalOf(other), { subscriptionId: subscription.id, planCode: 'federation', interval: 'year' }, meta)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const changed = await changeSubscriptionPlan(owner.principal, { subscriptionId: subscription.id, planCode: 'federation', interval: 'year' }, meta);
    expect(changed).toMatchObject({ interval: 'year', scheduledChange: null });
    await applyPendingBillingEvents();
    const row = await subscriptionRow(subscription.id);
    expect(row).toMatchObject({ interval: 'year', planCode: 'federation', scheduledPlanCode: null });
    expect((row.currentPeriodEnd.getTime() - Date.now()) / DAY).toBeGreaterThan(360);
    // The first month was barely used: the yearly invoice is $990 less (almost) all of $99.
    const amounts = (await invoicesOf(subscription.id)).map((i) => i.amountCents);
    expect(amounts).toHaveLength(2);
    expect(amounts[1]).toBeLessThan(99000);
    expect(amounts[1]).toBeGreaterThanOrEqual(99000 - 9900);
    // The grant follows the new period; the plan never paused.
    const [grant] = await getDb().select().from(entitlementGrant).where(eq(entitlementGrant.id, row.grantId!));
    expect(grant!.endsAt!.getTime()).toBe(row.currentPeriodEnd.getTime());
    expect(await orgPlan(organizationId)).toBe('federation');
    expect((await noticesOf(owner.account.id)).map((n) => n.template)).toContain('billing.plan-changed');

    // Back to monthly: at the period end.
    const scheduled = await changeSubscriptionPlan(owner.principal, { subscriptionId: subscription.id, planCode: 'federation', interval: 'month' }, meta);
    expect(scheduled).toMatchObject({ interval: 'year', scheduledChange: { planCode: 'federation', interval: 'month' } });
    await applyPendingBillingEvents();
    expect(await subscriptionRow(subscription.id)).toMatchObject({ interval: 'year', scheduledPlanCode: 'federation', scheduledInterval: 'month' });
    expect((await invoicesOf(subscription.id))).toHaveLength(2);
    expect((await noticesOf(owner.account.id)).map((n) => n.template)).toContain('billing.change-scheduled');

    const kept = await cancelPlanChange(owner.principal, { subscriptionId: subscription.id }, meta);
    expect(kept.scheduledChange).toBeNull();
    await applyPendingBillingEvents();
    expect(await subscriptionRow(subscription.id)).toMatchObject({ interval: 'year', scheduledPlanCode: null, scheduledInterval: null });

    // Scheduled again, then the renewal bills the new period.
    await changeSubscriptionPlan(owner.principal, { subscriptionId: subscription.id, planCode: 'federation', interval: 'month' }, meta);
    await applyPendingBillingEvents();
    await moveTestClock((await anAdmin()).principal, { subscriptionId: subscription.id, step: 'period_end' }, meta);
    await applyPendingBillingEvents();
    expect(await subscriptionRow(subscription.id)).toMatchObject({ status: 'active', interval: 'month', scheduledPlanCode: null });
    expect((await invoicesOf(subscription.id)).at(-1)!.amountCents).toBe(9900);

    const actions = (await getDb().select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.subjectId, subscription.id))).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['billing.change_plan', 'billing.cancel_change']));
  });

  it('a Premium Student cannot switch to a plan of another audience; a cancelled subscription cannot change', async () => {
    const student = await member('m23-student-switch');
    const { subscription } = await paidSubscription(student.principal, 'premium_student');
    await expect(changeSubscriptionPlan(student.principal, { subscriptionId: subscription.id, planCode: 'pro_sifu', interval: 'month' }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(changeSubscriptionPlan(student.principal, { subscriptionId: subscription.id, planCode: 'federation', interval: 'month' }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await cancelSubscription(student.principal, { subscriptionId: subscription.id }, meta);
    await expect(changeSubscriptionPlan(student.principal, { subscriptionId: subscription.id, planCode: 'premium_student', interval: 'year' }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('the credit of an unused period is proportional', () => {
    const start = new Date('2026-11-01T00:00:00Z');
    const end = new Date('2026-12-01T00:00:00Z');
    const half = new Date('2026-11-16T00:00:00Z');
    expect(prorate({ amountCents: 9900, currentPeriodStart: start, currentPeriodEnd: end }, 99000, half)).toBe(99000 - 4950);
  });
});

describe('the federation trial', () => {
  it('an administrator starts a 12-month trial with no card; the admins are told; one trial per organization', async () => {
    const { owner, organizationId } = await approvedOrganization('m23-trial');
    const a = await anAdmin();
    const before = await adminFederationTrial(a.principal, { organizationId });
    expect(before).toMatchObject({ trial: null, canStart: true, defaultMonths: 12, months: [6, 12] });
    // Only an administrator with the second factor.
    const moderator = await staff('m23-trial-moderator', 'moderator');
    await expect(startFederationTrial(moderator.principal, { organizationId, reason: 'Demo trial' }, meta)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const unverified = await staff('m23-trial-unverified', 'admin', { unverified: true });
    await expect(startFederationTrial(unverified.principal, { organizationId, reason: 'Demo trial' }, meta)).rejects.toBeDefined();
    await expect(startFederationTrial(owner.principal, { organizationId, reason: 'Demo trial' }, meta)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(startFederationTrial(a.principal, { organizationId, reason: '' }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(startFederationTrial(a.principal, { organizationId, months: 3, reason: 'Demo trial' }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const now = new Date();
    const started = await startFederationTrial(a.principal, { organizationId, reason: 'Demo trial for a fictional federation' }, meta, now);
    expect(started.trial).toMatchObject({ status: 'active', months: 12 });
    const trial = (await trialOf(organizationId))!;
    expect(trial.endsAt.getTime()).toBe(addMonths(now, 12).getTime());
    expect(await orgPlan(organizationId)).toBe('federation');
    const [grant] = await getDb().select().from(entitlementGrant).where(eq(entitlementGrant.id, trial.grantId!));
    expect(grant).toMatchObject({ source: 'complimentary', planCode: 'federation', subjectOrganizationId: organizationId });
    expect(grant!.endsAt!.getTime()).toBe(trial.endsAt.getTime());
    // No card: nothing at the provider, no checkout, no invoice.
    expect(await getDb().select().from(billingCheckout).where(eq(billingCheckout.subjectOrganizationId, organizationId))).toEqual([]);
    expect((await noticesOf(owner.account.id)).map((n) => n.template)).toContain('federation.trial-started');
    const ownerView = await organizationBilling(owner.principal, { organizationId });
    expect(ownerView.trial).toMatchObject({ status: 'active', statusLabel: 'Trial running' });
    expect(ownerView.trial!.summary).toMatch(/no card and no charge/);

    await expect(startFederationTrial(a.principal, { organizationId, reason: 'Again' }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
    const actions = (await getDb().select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.subjectId, trial.id))).map((r) => r.action);
    expect(actions).toContain('federation_trial.start');
  });

  it('6 months when chosen; refused for an association, an organization not approved yet and one that pays already', async () => {
    const a = await anAdmin();
    const six = await approvedOrganization('m23-trial-six');
    const now = new Date();
    await startFederationTrial(a.principal, { organizationId: six.organizationId, months: '6', reason: 'Demo six months' }, meta, now);
    expect((await trialOf(six.organizationId))!.endsAt.getTime()).toBe(addMonths(now, 6).getTime());

    const association = await approvedOrganization('m23-trial-association', 'association');
    await expect(startFederationTrial(a.principal, { organizationId: association.organizationId, reason: 'Demo' }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
    const pending = await approvedOrganization('m23-trial-pending', 'federation', { approve: false });
    expect((await adminFederationTrial(a.principal, { organizationId: pending.organizationId })).canStart).toBe(false);
    await expect(startFederationTrial(a.principal, { organizationId: pending.organizationId, reason: 'Demo' }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
    const paying = await approvedOrganization('m23-trial-paying');
    await federationSubscription(paying.owner.principal, paying.organizationId, 'month');
    await expect(startFederationTrial(a.principal, { organizationId: paying.organizationId, reason: 'Demo' }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a reminder 14 days and 7 days before the end, each once; then the trial simply ends: no charge, nothing deleted', async () => {
    const { owner, organizationId } = await approvedOrganization('m23-trial-run');
    const other = await createUser('m23-trial-run-admin');
    await addOrganizationAdmin(owner.principal, { organizationId, email: other.email }, meta);
    await startFederationTrial((await anAdmin()).principal, { organizationId, months: 6, reason: 'Demo trial run' }, meta);
    // Member administration is part of Federation: the trial gives it.
    const memberPerson = await member('m23-trial-run-member');
    await addOrganizationMember(owner.principal, { organizationId, personSlug: memberPerson.slug }, meta);
    const trial = (await trialOf(organizationId))!;
    const at = (daysBefore: number) => new Date(trial.endsAt.getTime() - daysBefore * DAY);
    const reminders = async (userId: string) => (await noticesOf(userId)).filter((n) => n.template === 'federation.trial-ending').map((n) => (n.payload as { daysBefore: number }).daysBefore);

    await runFederationTrials(getDb(), at(20));
    expect(await reminders(owner.account.id)).toEqual([]);
    await runFederationTrials(getDb(), at(13.5));
    await runFederationTrials(getDb(), at(13));
    expect(await reminders(owner.account.id)).toEqual([14]);
    await runFederationTrials(getDb(), at(6.5));
    await runFederationTrials(getDb(), at(6));
    expect((await reminders(owner.account.id)).sort()).toEqual([14, 7]);
    expect((await reminders(other.id)).sort()).toEqual([14, 7]);

    const after = new Date(trial.endsAt.getTime() + 1000);
    // Other tests' trials may end at the same run; this one ends once.
    expect((await runFederationTrials(getDb(), after)).ended).toBeGreaterThanOrEqual(1);
    expect(await runFederationTrials(getDb(), after)).toMatchObject({ ended: 0 });
    expect(await trialOf(organizationId)).toMatchObject({ status: 'ended' });
    expect(await orgPlan(organizationId, after)).toBeNull();
    // No charge: no checkout, no subscription, no invoice. Nothing deleted.
    expect(await getDb().select().from(billingSubscription).where(eq(billingSubscription.subjectOrganizationId, organizationId))).toEqual([]);
    expect(await getDb().select().from(organizationMembership).where(eq(organizationMembership.organizationId, organizationId))).toHaveLength(1);
    const [org] = await getDb().select({ status: organization.status, deletedAt: organization.deletedAt }).from(organization).where(eq(organization.id, organizationId));
    expect(org).toMatchObject({ status: 'active', deletedAt: null });
    const ended = (await noticesOf(owner.account.id)).filter((n) => n.template === 'federation.trial-ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]!.payload).toMatchObject({ reason: 'expired', organizationId });
    // The owner may subscribe afterwards; no new trial.
    expect((await organizationBilling(owner.principal, { organizationId }, after)).offers).toHaveLength(2);
    expect((await adminFederationTrial((await anAdmin()).principal, { organizationId }, after)).canStart).toBe(false);
  });

  it('a trial that starts with less than 7 days of notice left gets only the 7-day reminder', async () => {
    const { owner, organizationId } = await approvedOrganization('m23-trial-late');
    await startFederationTrial((await anAdmin()).principal, { organizationId, months: 6, reason: 'Demo late' }, meta);
    const trial = (await trialOf(organizationId))!;
    await runFederationTrials(getDb(), new Date(trial.endsAt.getTime() - 3 * DAY));
    const steps = (await noticesOf(owner.account.id)).filter((n) => n.template === 'federation.trial-ending').map((n) => (n.payload as { daysBefore: number }).daysBefore);
    expect(steps).toEqual([7]);
  });

  it('an administrator ends a trial early; a trial whose grant is revoked directly follows it', async () => {
    const a = await anAdmin();
    const { owner, organizationId } = await approvedOrganization('m23-trial-end');
    await startFederationTrial(a.principal, { organizationId, reason: 'Demo end' }, meta);
    const trial = (await trialOf(organizationId))!;
    await expect(endFederationTrial(owner.principal, { trialId: trial.id, reason: 'No' }, meta)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const ended = await endFederationTrial(a.principal, { trialId: trial.id, reason: 'Demo: ended early' }, meta);
    expect(ended.trial).toMatchObject({ status: 'revoked' });
    expect(await orgPlan(organizationId, new Date(Date.now() + 1000))).toBeNull();
    expect((await noticesOf(owner.account.id)).find((n) => n.template === 'federation.trial-ended')?.payload).toMatchObject({ reason: 'revoked' });

    const other = await approvedOrganization('m23-trial-revoked-grant');
    await startFederationTrial(a.principal, { organizationId: other.organizationId, reason: 'Demo revoke' }, meta);
    const otherTrial = (await trialOf(other.organizationId))!;
    await revokeOrganizationPlan(a.principal, { grantId: otherTrial.grantId!, reason: 'Demo: revoked from the grants page' }, meta);
    expect(await runFederationTrials(getDb(), new Date(Date.now() + 1000))).toMatchObject({ ended: 1 });
    expect(await trialOf(other.organizationId)).toMatchObject({ status: 'revoked' });
  });

  it('subscribing during the trial: nothing is charged until the trial ends, then the chosen price', async () => {
    const { owner, organizationId } = await approvedOrganization('m23-trial-convert');
    await startFederationTrial((await anAdmin()).principal, { organizationId, months: 6, reason: 'Demo convert' }, meta);
    const trial = (await trialOf(organizationId))!;
    const started = await startCheckout(owner.principal, { planCode: 'federation', interval: 'year', organizationId }, meta);
    expect((await testCheckout(owner.principal, { checkoutId: started.checkoutId })).trialEndsAt).toBe(trial.endsAt.toISOString());
    await testPay(owner.principal, { checkoutId: started.checkoutId, card: 'succeeds' }, meta);
    await applyPendingBillingEvents();
    const [sub] = await getDb().select().from(billingSubscription).where(eq(billingSubscription.subjectOrganizationId, organizationId));
    expect(sub!.currentPeriodEnd.getTime()).toBe(trial.endsAt.getTime());
    expect((await invoicesOf(sub!.id)).map((i) => i.amountCents)).toEqual([0]);
    const converted = (await trialOf(organizationId))!;
    expect(converted).toMatchObject({ status: 'converted', convertedSubscriptionId: sub!.id });
    // The plan never paused: the subscription's grant holds it now, the trial's grant has ended.
    expect(await orgPlan(organizationId)).toBe('federation');
    const [trialGrant] = await getDb().select().from(entitlementGrant).where(eq(entitlementGrant.id, trial.grantId!));
    // (A grant ends at least a second after it starts: entitlement_grant_period.)
    expect(trialGrant!.endsAt!.getTime()).toBeLessThan(Date.now() + 2000);
    // While still in the trial's free period, every change waits for its end.
    const view = await organizationBilling(owner.principal, { organizationId });
    expect(view.subscription!.changeOptions.every((o) => o.when === 'period_end')).toBe(true);
    // The trial no longer reminds or ends anything.
    expect(await runFederationTrials(getDb(), new Date(trial.endsAt.getTime() - 3 * DAY))).toMatchObject({ reminders: 0, ended: 0 });

    await moveTestClock((await anAdmin()).principal, { subscriptionId: sub!.id, step: 'period_end' }, meta);
    await applyPendingBillingEvents();
    expect((await invoicesOf(sub!.id)).map((i) => i.amountCents)).toEqual([0, 99000]);
    expect(await subscriptionRow(sub!.id)).toMatchObject({ status: 'active' });
  });
});

describe('downstream independence (specification §10.3)', () => {
  /** A federation with a member school of a paying Professional Sifu and a member student paying Premium Student. */
  async function federationWithMembers(label: string) {
    const { owner, organizationId } = await approvedOrganization(label);
    // Linking schools and members is part of Federation: a test plan for the setup, revoked before
    // the federation's own subscription or trial begins (the links and members stay).
    const a = await anAdmin();
    await grantOrganizationPlan(a.principal, { organizationId, reason: 'M23 setup (fictional)' }, meta);
    const sifu = await member(`${label}-sifu`, { sifu: true });
    const sifuSub = await paidSubscription(sifu.principal, 'pro_sifu');
    const city = await getDb().execute<{ id: string }>(sql`SELECT id::text FROM place WHERE name = 'Plovdiv' AND country_code = 'BG' ORDER BY population DESC NULLS LAST LIMIT 1`);
    const saved = await createSchool(sifu.principal, { name: `Demo ${label} Hall`, placeId: city.rows[0]!.id, locationPrivacy: 'city_only', idempotencyKey: key() }, meta);
    await getDb().update(school).set({ status: 'active' }).where(eq(school.id, saved.id));
    const link = await requestOrganizationSchool(owner.principal, { organizationId, schoolSlug: saved.slug }, meta);
    await answerSchoolLink(sifu.principal, { linkId: link.linkId, accept: true }, meta);
    const student = await member(`${label}-student`);
    const studentSub = await paidSubscription(student.principal, 'premium_student');
    await addOrganizationMember(owner.principal, { organizationId, personSlug: student.slug }, meta);
    const [setup] = await getDb().select({ id: entitlementGrant.id }).from(entitlementGrant).where(eq(entitlementGrant.subjectOrganizationId, organizationId));
    await revokeOrganizationPlan(a.principal, { grantId: setup!.id, reason: 'M23 setup over (fictional)' }, meta);
    return { owner, organizationId, sifu, sifuSub: sifuSub.subscription, schoolId: saved.id, student, studentSub: studentSub.subscription };
  }

  async function expectMembersUntouched(f: Awaited<ReturnType<typeof federationWithMembers>>, at: Date) {
    expect(await userPlan(f.sifu.account.id, at)).toBe('pro_sifu');
    expect(await userPlan(f.student.account.id, at)).toBe('premium_student');
    expect(await subscriptionRow(f.sifuSub.id)).toMatchObject({ status: 'active', cancelAtPeriodEnd: false, planCode: 'pro_sifu' });
    expect(await subscriptionRow(f.studentSub.id)).toMatchObject({ status: 'active', cancelAtPeriodEnd: false, planCode: 'premium_student' });
    for (const sub of [f.sifuSub, f.studentSub]) {
      const [grant] = await getDb().select().from(entitlementGrant).where(eq(entitlementGrant.id, sub.grantId!));
      expect(grant).toMatchObject({ revokedAt: null });
      expect(grant!.endsAt!.getTime()).toBe(sub.currentPeriodEnd.getTime());
    }
    // The school keeps its public pin; the link and the membership stay.
    const pinned = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM v_public_school WHERE id = ${f.schoolId}::uuid`);
    expect(pinned.rows[0]!.n).toBe(1);
    const [link] = await getDb().select().from(organizationSchool).where(and(eq(organizationSchool.organizationId, f.organizationId), eq(organizationSchool.schoolId, f.schoolId)));
    expect(link?.status).toBe('accepted');
    expect(await getDb().select().from(organizationMembership).where(eq(organizationMembership.organizationId, f.organizationId))).toHaveLength(1);
    // No member hears of the federation's billing.
    for (const id of [f.sifu.account.id, f.student.account.id]) {
      const templates = (await noticesOf(id)).map((n) => n.template);
      expect(templates.filter((t) => t.startsWith('federation.'))).toEqual([]);
      expect((await noticesOf(id)).filter((n) => (n.payload as { organizationId?: string }).organizationId === f.organizationId)).toEqual([]);
    }
  }

  it('a cancelled federation subscription that ends leaves the member school’s Professional Sifu and the student’s Premium Student as they are', async () => {
    const f = await federationWithMembers('m23-down-cancel');
    const { subscription } = await federationSubscription(f.owner.principal, f.organizationId, 'month');
    await cancelSubscription(f.owner.principal, { subscriptionId: subscription.id }, meta);
    await applyPendingBillingEvents();
    await moveTestClock((await anAdmin()).principal, { subscriptionId: subscription.id, step: 'period_end' }, meta);
    await applyPendingBillingEvents();
    const at = new Date(Date.now() + 1000);
    expect(await subscriptionRow(subscription.id)).toMatchObject({ status: 'canceled' });
    expect(await orgPlan(f.organizationId, at)).toBeNull();
    await expectMembersUntouched(f, at);
  });

  it('a federation subscription that lapses after a failed renewal and its grace leaves the members’ plans as they are', async () => {
    const f = await federationWithMembers('m23-down-lapse');
    const { subscription } = await federationSubscription(f.owner.principal, f.organizationId, 'month', 'fails_at_renewal');
    await moveTestClock((await anAdmin()).principal, { subscriptionId: subscription.id, step: 'period_end' }, meta);
    await applyPendingBillingEvents();
    const due = await subscriptionRow(subscription.id);
    expect(due.status).toBe('past_due');
    const later = new Date(due.pastDueSince!.getTime() + 7 * DAY + 1000);
    await endExpiredGrace({ now: later });
    await applyPendingBillingEvents();
    expect(await subscriptionRow(subscription.id)).toMatchObject({ status: 'canceled', endReason: 'unpaid' });
    expect(await orgPlan(f.organizationId, later)).toBeNull();
    // The members' own periods are a month long: compare at a moment inside them.
    await expectMembersUntouched(f, new Date(Date.now() + 1000));
  });

  it('an expired or ended federation trial leaves the members’ plans as they are', async () => {
    const f = await federationWithMembers('m23-down-trial');
    await startFederationTrial((await anAdmin()).principal, { organizationId: f.organizationId, months: 6, reason: 'Demo downstream' }, meta);
    const trial = (await trialOf(f.organizationId))!;
    // The trial's end, as the daily job runs it, at its end; then the members, now.
    await runFederationTrials(getDb(), new Date(trial.endsAt.getTime() + 1000));
    expect(await trialOf(f.organizationId)).toMatchObject({ status: 'ended' });
    await expectMembersUntouched(f, new Date(Date.now() + 1000));

    const g = await federationWithMembers('m23-down-trial-end');
    await startFederationTrial((await anAdmin()).principal, { organizationId: g.organizationId, reason: 'Demo downstream end' }, meta);
    const gTrial = (await trialOf(g.organizationId))!;
    await endFederationTrial((await anAdmin()).principal, { trialId: gTrial.id, reason: 'Demo: ended early' }, meta);
    await expectMembersUntouched(g, new Date(Date.now() + 1000));
  });
});
