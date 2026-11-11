// Paid plans in test mode (milestone M22; docs/adr/0025-billing.md) against PostGIS, on the seeded
// demo data, with the test provider of the app (never Stripe, never a network call): a checkout,
// the signed provider events through the webhook and the job's part, the plan grant that follows
// the subscription, duplicate, delayed and out-of-order events, a forged signature, an event that
// names another account, cancel and resume, a failed renewal and its grace, the plan-ending
// notices, the downgrade that keeps every record, the live-key refusal, and what is stored and
// logged (never card data or personal data). Fictional data only (D20).

import { createHmac, randomBytes } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv, stopAuthTestDatabase } from '../auth/test-support';
import { checkProductionSettings } from '../auth/startup';
import { checkBillingSettings, testWebhookSecret } from '../billing/config';
import { setBillingProvider } from '../billing/provider';
import { signPayload } from '../billing/signature';
import { createTestProvider, TEST_SIGNATURE_HEADER, type TestBillingProvider } from '../billing/test-provider';
import { createStripeProvider } from '../billing/stripe';
import { receiveWebhook } from '../billing/webhook';
import { getDb } from '../db';
import {
  auditLog,
  authUser,
  billingCheckout,
  billingEvent,
  billingInvoice,
  billingSubscription,
  billingTestSubscription,
  entitlementGrant,
  notification,
  teachingRelationship,
} from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { effectivePlan } from '../entitlements/access';
import { sendPlanEndNotices } from '../jobs/plan-expiry';
import { configureLogger, restoreLogger } from '../log';
import {
  adminBillingGet,
  adminBillingList,
  applyStoredEvent,
  cancelSubscription,
  endExpiredGrace,
  moveTestClock,
  myBilling,
  resumeSubscription,
  startCheckout,
  testCheckout,
  testPay,
} from './billing';
import { applyPendingBillingEvents, paidSubscription } from './billing.test-support';
import { setAccountType } from './plans';
import { carryOutDeletionFromCommandLine, requestAccountDeletion } from './privacy';
import { member, meta, newLineage, staff } from './relationships.test-support';

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

/** A fake key of a kind, built at run time (no key-like literal in the repository; gitleaks). */
const fakeKey = (prefix: string) => [prefix, randomBytes(12).toString('hex')].join('_');

/** A Stripe-signed request (Stripe-Signature: t=<seconds>,v1=<HMAC-SHA256 of "t.body">). */
function stripeRequest(body: string, secret: string): Request {
  const at = Math.floor(Date.now() / 1000);
  const signature = `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`;
  return new Request('http://127.0.0.1:3999/api/billing/webhook', { method: 'POST', body, headers: { 'stripe-signature': signature } });
}

/** A test provider whose events are kept, to deliver them later, twice or in another order. */
function capturingProvider(): { provider: TestBillingProvider; sent: Request[] } {
  const sent: Request[] = [];
  const provider = createTestProvider({
    deliver: async (request) => {
      sent.push(request);
      return new Response(null, { status: 200 });
    },
  });
  setBillingProvider(provider);
  return { provider, sent };
}

async function deliver(request: Request): Promise<Response> {
  return receiveWebhook(request.clone());
}

const planOf = async (userId: string, now?: Date) => (await effectivePlan({ kind: 'user', userId }, { now })).plan;
const noticesOf = async (userId: string) =>
  (await getDb().select({ template: notification.template, payload: notification.payload }).from(notification).where(eq(notification.userId, userId))).map((n) => n.template);
const subscriptionRow = async (id: string) => (await getDb().select().from(billingSubscription).where(eq(billingSubscription.id, id)))[0]!;

describe('checkout', () => {
  it('a Free Sifu buys Professional Sifu with the "succeeds" test card: the grant follows the applied events', async () => {
    const sifu = await member('m22-buyer', { sifu: true });
    expect(await planOf(sifu.account.id)).toBe('free_sifu');
    const before = await myBilling(sifu.principal);
    expect(before.offers.map((o) => `${o.planCode}/${o.interval}`)).toEqual(['pro_sifu/month']);
    expect(before.testModeLabel).toBe('Test mode, no real charge');

    const started = await startCheckout(sifu.principal, { planCode: 'pro_sifu' }, meta);
    expect(started.url).toBe(`/billing/test-checkout/${started.checkoutId}`);
    const page = await testCheckout(sifu.principal, { checkoutId: started.checkoutId });
    expect(page).toMatchObject({ planName: 'Professional Sifu', price: '$19.00 a month', status: 'open', priceLabel: 'Proposed price (not final)' });

    await testPay(sifu.principal, { checkoutId: started.checkoutId, card: 'succeeds' }, meta);
    // Stored, not yet applied: the plan follows the job.
    expect(await planOf(sifu.account.id)).toBe('free_sifu');
    expect(await applyPendingBillingEvents()).toEqual(['applied', 'applied']);
    expect(await planOf(sifu.account.id)).toBe('pro_sifu');

    const [sub] = await getDb().select().from(billingSubscription).where(eq(billingSubscription.subjectUserId, sifu.account.id));
    expect(sub).toMatchObject({ provider: 'test', status: 'active', planCode: 'pro_sifu', cancelAtPeriodEnd: false });
    const [grant] = await getDb().select().from(entitlementGrant).where(eq(entitlementGrant.id, sub!.grantId!));
    expect(grant).toMatchObject({ source: 'stripe', planCode: 'pro_sifu', subjectUserId: sifu.account.id });
    expect(grant!.endsAt!.getTime()).toBe(sub!.currentPeriodEnd.getTime());
    expect(await noticesOf(sifu.account.id)).toContain('billing.started');
    const [invoice] = await getDb().select().from(billingInvoice).where(eq(billingInvoice.subscriptionId, sub!.id));
    expect(invoice).toMatchObject({ status: 'paid', amountCents: 1900, currency: 'usd' });

    const after = await myBilling(sifu.principal);
    expect(after.offers).toEqual([]);
    expect(after.subscription).toMatchObject({ status: 'active', canCancel: true, canResume: false });
    expect(after.subscription!.invoices).toHaveLength(1);
    // A second checkout while the subscription is live is refused.
    await expect(startCheckout(sifu.principal, { planCode: 'pro_sifu' }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a declined test card creates no subscription, sends no event and leaves the checkout open', async () => {
    const student = await member('m22-declined');
    const started = await startCheckout(student.principal, { planCode: 'premium_student' }, meta);
    const events = await getDb().select({ n: sql<number>`count(*)::int` }).from(billingEvent);
    await expect(testPay(student.principal, { checkoutId: started.checkoutId, card: 'declines' }, meta)).rejects.toMatchObject({ code: 'CONFLICT', fields: { card: 'The test card was declined.' } });
    expect(await getDb().select({ n: sql<number>`count(*)::int` }).from(billingEvent)).toEqual(events);
    expect(await getDb().select().from(billingTestSubscription).where(eq(billingTestSubscription.checkoutRef, started.checkoutId))).toEqual([]);
    expect((await testCheckout(student.principal, { checkoutId: started.checkoutId })).status).toBe('open');
    expect(await planOf(student.account.id)).toBe('free_student');
  });

  it('refuses a free plan, the plan of the other account type, a planned plan, an unconfirmed address and another account’s checkout', async () => {
    const student = await member('m22-refused');
    await expect(startCheckout(student.principal, { planCode: 'free_student' }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(startCheckout(student.principal, { planCode: 'pro_sifu' }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // DEFAULT M22 (question 3): Federation is planned (D12), so it is not sold.
    await expect(startCheckout(student.principal, { planCode: 'federation', organizationId: '00000000-0000-4000-8000-000000000000' }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
    const unconfirmed = { ...student.principal, user: { ...student.principal.user, emailVerified: false } };
    await expect(startCheckout(unconfirmed, { planCode: 'premium_student' }, meta)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const other = await member('m22-other');
    const started = await startCheckout(student.principal, { planCode: 'premium_student' }, meta);
    await expect(testCheckout(other.principal, { checkoutId: started.checkoutId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(testPay(other.principal, { checkoutId: started.checkoutId, card: 'succeeds' }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // A new checkout replaces the earlier one, so no two can both be paid.
    const again = await startCheckout(student.principal, { planCode: 'premium_student' }, meta);
    expect((await testCheckout(student.principal, { checkoutId: started.checkoutId })).status).toBe('expired');
    expect((await testCheckout(student.principal, { checkoutId: again.checkoutId })).status).toBe('open');
  });
});

describe('provider events', () => {
  it('a duplicate delivery is stored and applied once; the second answer is 200 too', async () => {
    const { sent } = capturingProvider();
    const student = await member('m22-duplicate');
    const started = await startCheckout(student.principal, { planCode: 'premium_student' }, meta);
    await testPay(student.principal, { checkoutId: started.checkoutId, card: 'succeeds' }, meta);
    expect(sent).toHaveLength(2);
    for (const request of [...sent, ...sent]) expect((await deliver(request)).status).toBe(200);
    const ids = await Promise.all(sent.map(async (r) => (JSON.parse(await r.clone().text()) as { id: string }).id));
    const rows = await getDb().select().from(billingEvent).where(sql`${billingEvent.providerEventId} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
    expect(rows).toHaveLength(2);
    expect(await applyPendingBillingEvents()).toEqual(['applied', 'applied']);
    // Applying a processed event again changes nothing.
    expect((await applyStoredEvent(rows[0]!.id, { final: true })).outcome).toBe('duplicate');
    const grants = await getDb().select().from(entitlementGrant).where(and(eq(entitlementGrant.subjectUserId, student.account.id), eq(entitlementGrant.source, 'stripe')));
    expect(grants).toHaveLength(1);
    expect((await noticesOf(student.account.id)).filter((t) => t === 'billing.started')).toHaveLength(1);
  });

  it('out of order and delayed: an older state never overwrites a newer one', async () => {
    const { provider, sent } = capturingProvider();
    const student = await member('m22-order');
    const started = await startCheckout(student.principal, { planCode: 'premium_student' }, meta);
    const paid = await provider.pay(
      { checkoutId: started.checkoutId, planCode: 'premium_student', interval: 'month', amountCents: 400, currency: 'usd', customerId: null },
      'succeeds',
    );
    if (paid.outcome !== 'paid') throw new Error('not paid');
    await provider.cancelAtPeriodEnd(paid.subscriptionId);
    expect(sent).toHaveLength(3);
    // The cancellation (version 2) arrives first, then the creation (version 1), then the invoice.
    await deliver(sent[2]!);
    await applyPendingBillingEvents();
    await deliver(sent[1]!);
    await deliver(sent[0]!);
    expect(await applyPendingBillingEvents()).toEqual(['stale', 'applied']);
    const [sub] = await getDb().select().from(billingSubscription).where(eq(billingSubscription.subjectUserId, student.account.id));
    expect(sub).toMatchObject({ status: 'active', cancelAtPeriodEnd: true, providerVersion: 2 });
    expect(await planOf(student.account.id)).toBe('premium_student');
    expect(await getDb().select().from(billingInvoice).where(eq(billingInvoice.subscriptionId, sub!.id))).toHaveLength(1);
  });

  it('an event of a subscription the app does not know yet waits for it (the job retries), then is recorded as unknown', async () => {
    // A Stripe invoice event names its subscription only by id (the test provider's carry its state).
    const webhookSecret = fakeKey('whsec');
    const stripe = createStripeProvider({
      env: { STRIPE_SECRET_KEY: fakeKey('sk_test'), STRIPE_WEBHOOK_SECRET: webhookSecret },
      fetch: async () => {
        throw new Error('no network in tests');
      },
    });
    const id = `evt_${randomBytes(8).toString('hex')}`;
    const now = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id,
      object: 'event',
      type: 'invoice.paid',
      created: now,
      livemode: false,
      data: {
        object: {
          id: `in_${randomBytes(8).toString('hex')}`,
          object: 'invoice',
          subscription: `sub_${randomBytes(8).toString('hex')}`,
          status: 'paid',
          amount_paid: 400,
          amount_due: 400,
          currency: 'usd',
          period_start: now,
          period_end: now + 30 * 86400,
          created: now,
        },
      },
    });
    const response = await receiveWebhook(stripeRequest(body, webhookSecret), { provider: stripe });
    expect(response.status).toBe(200);
    const [row] = await getDb().select().from(billingEvent).where(eq(billingEvent.providerEventId, id));
    await expect(applyStoredEvent(row!.id, { final: false })).rejects.toThrow('not known yet');
    expect((await applyStoredEvent(row!.id, { final: true })).outcome).toBe('unknown');
  });

  it('a forged or old signature gets 400 and stores nothing', async () => {
    const before = await getDb().select({ n: sql<number>`count(*)::int` }).from(billingEvent);
    const body = JSON.stringify({ id: 'tevt_forged0000000001', object: 'event', type: 'subscription.created', created: 1, livemode: false, data: {} });
    const forged = signPayload(body, 'x'.repeat(40));
    const old = signPayload(body, testWebhookSecret(), new Date(Date.now() - 3600_000));
    for (const header of [forged, old, 't=1,v1=00', '']) {
      const response = await receiveWebhook(new Request('http://127.0.0.1:3999/api/billing/webhook', { method: 'POST', body, headers: header ? { [TEST_SIGNATURE_HEADER]: header } : {} }));
      expect(response.status).toBe(400);
    }
    expect(await getDb().select({ n: sql<number>`count(*)::int` }).from(billingEvent)).toEqual(before);
    expect((await receiveWebhook(new Request('http://127.0.0.1:3999/api/billing/webhook', { method: 'GET' }))).status).toBe(405);
  });

  it('an event that names another account’s checkout or customer changes nothing for either', async () => {
    const { provider, sent } = capturingProvider();
    const a = await member('m22-victim', { sifu: true });
    const b = await member('m22-other-account');
    const checkoutA = await startCheckout(a.principal, { planCode: 'pro_sifu' }, meta);
    await provider.pay({ checkoutId: checkoutA.checkoutId, planCode: 'pro_sifu', interval: 'month', amountCents: 1900, currency: 'usd', customerId: null }, 'succeeds');
    for (const request of sent) await deliver(request);
    await applyPendingBillingEvents();
    const subA = (await getDb().select().from(billingSubscription).where(eq(billingSubscription.subjectUserId, a.account.id)))[0]!;
    const customerA = (await getDb().select().from(billingTestSubscription).where(eq(billingTestSubscription.checkoutRef, checkoutA.checkoutId)))[0]!.customerId;

    // B's own checkout, paid with a subscription the provider says belongs to A's customer.
    const checkoutB = await startCheckout(b.principal, { planCode: 'premium_student' }, meta);
    const secret = testWebhookSecret();
    const forgedSub = (id: string, checkoutRef: string, customer: string, version: number, cancel = true) =>
      JSON.stringify({
        id: `tevt_${randomBytes(8).toString('hex')}`,
        object: 'event',
        type: 'subscription.updated',
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        data: {
          subscription: {
            id,
            object: 'subscription',
            customer,
            checkout_ref: checkoutRef,
            status: 'canceled',
            interval: 'month',
            cancel_at_period_end: cancel,
            current_period_start: new Date(Date.now() - DAY).toISOString(),
            current_period_end: new Date(Date.now() + 29 * DAY).toISOString(),
            ended_at: new Date().toISOString(),
            version,
          },
        },
      });
    const send = (body: string) =>
      receiveWebhook(new Request('http://127.0.0.1:3999/api/billing/webhook', { method: 'POST', body, headers: { [TEST_SIGNATURE_HEADER]: signPayload(body, secret) } }));
    // 1. A's subscription id, with B's checkout: the checkout's subject is not A's.
    await send(forgedSub(subA.providerSubscriptionId, checkoutB.checkoutId, customerA, 99));
    // 2. A new subscription of B's checkout under A's customer.
    await send(forgedSub(`tsub_${randomBytes(8).toString('hex')}`, checkoutB.checkoutId, customerA, 1));
    // 3. A's subscription id with another customer.
    await send(forgedSub(subA.providerSubscriptionId, checkoutA.checkoutId, `tcus_${randomBytes(8).toString('hex')}`, 100));
    expect(await applyPendingBillingEvents()).toEqual(['mismatch', 'mismatch', 'mismatch']);
    expect(await subscriptionRow(subA.id)).toMatchObject({ status: 'active', cancelAtPeriodEnd: false });
    expect(await planOf(a.account.id)).toBe('pro_sifu');
    expect(await getDb().select().from(billingSubscription).where(eq(billingSubscription.subjectUserId, b.account.id))).toEqual([]);
  });
});

describe('the lifecycle', () => {
  it('cancel at the period end keeps the plan until then; resume takes it back; another account cannot do either', async () => {
    const sifu = await member('m22-cancel', { sifu: true });
    const { subscription } = await paidSubscription(sifu.principal, 'pro_sifu');
    const other = await member('m22-not-mine');
    await expect(cancelSubscription(other.principal, { subscriptionId: subscription.id }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const cancelled = await cancelSubscription(sifu.principal, { subscriptionId: subscription.id }, meta);
    expect(cancelled).toMatchObject({ status: 'active', cancelAtPeriodEnd: true, canResume: true, canCancel: false });
    expect(await planOf(sifu.account.id)).toBe('pro_sifu');
    // Its webhook event follows and is then a repeat.
    await applyPendingBillingEvents();
    expect((await subscriptionRow(subscription.id)).cancelAtPeriodEnd).toBe(true);
    expect(await noticesOf(sifu.account.id)).toContain('billing.cancel-scheduled');

    await expect(resumeSubscription(other.principal, { subscriptionId: subscription.id }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const resumed = await resumeSubscription(sifu.principal, { subscriptionId: subscription.id }, meta);
    expect(resumed).toMatchObject({ cancelAtPeriodEnd: false, canCancel: true });
    await applyPendingBillingEvents();
    expect(await noticesOf(sifu.account.id)).toContain('billing.resumed');
    const actions = (await getDb().select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.subjectId, subscription.id))).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['billing.cancel', 'billing.resume', 'billing.subscription']));
  });

  it('the test clock ends a cancelled subscription at its period end: the plan ends, every confirmed link and school stays', async () => {
    const sifu = await member('m22-downgrade', { sifu: true });
    const student = await member('m22-downgrade-student');
    const lineageId = await newLineage('m22');
    await getDb().insert(teachingRelationship).values({ teacherPersonId: sifu.personId, studentPersonId: student.personId, lineageId, status: 'verified', visibility: 'public' });
    const { subscription } = await paidSubscription(sifu.principal, 'pro_sifu');
    await cancelSubscription(sifu.principal, { subscriptionId: subscription.id }, meta);
    await applyPendingBillingEvents();
    const admin = await staff('m22-clock-admin', 'admin');
    await moveTestClock(admin.principal, { subscriptionId: subscription.id, step: 'period_end' }, meta);
    await applyPendingBillingEvents();
    const ended = await subscriptionRow(subscription.id);
    expect(ended).toMatchObject({ status: 'canceled', endReason: 'canceled' });
    expect(await planOf(sifu.account.id, new Date(Date.now() + 1000))).toBe('free_sifu');
    // D06/D08: the confirmed link stays confirmed and public; the grant row stays as history.
    const [link] = await getDb().select().from(teachingRelationship).where(eq(teachingRelationship.teacherPersonId, sifu.personId));
    expect(link).toMatchObject({ status: 'verified', visibility: 'public' });
    expect(await getDb().select().from(entitlementGrant).where(eq(entitlementGrant.id, subscription.grantId!))).toHaveLength(1);
    // A cancellation's end is announced by the plan notice of M18 (paid wording), not billing.ended.
    expect(await noticesOf(sifu.account.id)).not.toContain('billing.ended');
    await sendPlanEndNotices(getDb(), new Date(Date.now() + 2000));
    const [expired] = await getDb()
      .select({ payload: notification.payload })
      .from(notification)
      .where(and(eq(notification.userId, sifu.account.id), eq(notification.template, 'plan.expired')));
    expect(expired?.payload).toMatchObject({ planCode: 'pro_sifu', paid: true, nextPlanCode: 'free_sifu' });
    // An ended subscription cannot be resumed or moved; a new checkout is allowed again.
    await expect(resumeSubscription(sifu.principal, { subscriptionId: subscription.id }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(moveTestClock(admin.principal, { subscriptionId: subscription.id, step: 'period_end' }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await myBilling(sifu.principal)).offers.map((o) => o.planCode)).toEqual(['pro_sifu']);
  });

  it('a renewal with the "fails at renewal" card: past due, access for the 7-day grace, then the plan ends', async () => {
    const student = await member('m22-grace');
    const { subscription } = await paidSubscription(student.principal, 'premium_student', 'fails_at_renewal');
    const admin = await staff('m22-grace-admin', 'admin');
    await moveTestClock(admin.principal, { subscriptionId: subscription.id, step: 'period_end' }, meta);
    await applyPendingBillingEvents();
    const due = await subscriptionRow(subscription.id);
    expect(due.status).toBe('past_due');
    expect(due.pastDueSince).not.toBeNull();
    expect(await planOf(student.account.id)).toBe('premium_student');
    expect(await noticesOf(student.account.id)).toContain('billing.payment-failed');
    const [failed] = await getDb().select().from(billingInvoice).where(and(eq(billingInvoice.subscriptionId, subscription.id), eq(billingInvoice.status, 'failed')));
    expect(failed).toBeDefined();
    // A past-due subscription has nothing to resume; its notices are the billing ones, not the plan's.
    expect((await myBilling(student.principal)).subscription).toMatchObject({ status: 'past_due', canResume: false, statusLabel: 'Payment failed' });
    await sendPlanEndNotices(getDb(), new Date(Date.now() + 3 * DAY));
    expect(await noticesOf(student.account.id)).not.toContain('plan.expiring');

    // Within the grace: nothing ends. After it: the subscription and its plan end, with the notice.
    expect((await endExpiredGrace({ now: new Date(Date.now() + 6 * DAY) })).ended).toBe(0);
    const later = new Date(due.pastDueSince!.getTime() + 7 * DAY + 1000);
    expect((await endExpiredGrace({ now: later })).ended).toBe(1);
    expect(await subscriptionRow(subscription.id)).toMatchObject({ status: 'canceled', endReason: 'unpaid' });
    expect(await planOf(student.account.id, later)).toBe('free_student');
    expect(await noticesOf(student.account.id)).toContain('billing.ended');
    // The provider is asked to end it too; its event is then stale (an ended subscription stays ended).
    expect((await applyPendingBillingEvents()).every((o) => o === 'stale')).toBe(true);
  });

  it('the plan-ending notice comes for a cancelled subscription, never for a renewing one', async () => {
    const renewing = await member('m22-renewing');
    const r = await paidSubscription(renewing.principal, 'premium_student');
    const cancelling = await member('m22-cancelling');
    const c = await paidSubscription(cancelling.principal, 'premium_student');
    await cancelSubscription(cancelling.principal, { subscriptionId: c.subscription.id }, meta);
    const soon = new Date(r.subscription.currentPeriodEnd.getTime() - 3 * DAY);
    await sendPlanEndNotices(getDb(), soon);
    expect(await noticesOf(renewing.account.id)).not.toContain('plan.expiring');
    const [expiring] = await getDb()
      .select({ payload: notification.payload })
      .from(notification)
      .where(and(eq(notification.userId, cancelling.account.id), eq(notification.template, 'plan.expiring')));
    expect(expiring?.payload).toMatchObject({ planCode: 'premium_student', paid: true });
  });

  it('an account whose subscription renews cannot change its account type until it cancels (DEFAULT M22, question 8)', async () => {
    const sifu = await member('m22-type', { sifu: true });
    const { subscription } = await paidSubscription(sifu.principal, 'pro_sifu');
    await expect(setAccountType(sifu.principal, { accountType: 'student' }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
    await cancelSubscription(sifu.principal, { subscriptionId: subscription.id }, meta);
    expect((await setAccountType(sifu.principal, { accountType: 'student' }, meta)).changed).toBe(true);
    // The Professional Sifu of a Student account is not resumed: it would renew unused.
    const view = await myBilling(sifu.principal);
    expect(view.subscription).toMatchObject({ id: subscription.id, cancelAtPeriodEnd: true, canResume: false });
    await expect(resumeSubscription(sifu.principal, { subscriptionId: subscription.id }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await subscriptionRow(subscription.id)).cancelAtPeriodEnd).toBe(true);
  });

  it('a paid checkout that was replaced or expired before its events were applied never becomes a plan, and the provider ends it', async () => {
    const sifu = await member('m22-replaced', { sifu: true });
    const checkout = await startCheckout(sifu.principal, { planCode: 'pro_sifu' }, meta);
    await testPay(sifu.principal, { checkoutId: checkout.checkoutId, card: 'succeeds' }, meta);
    // The account changes its type before the worker applies the events: the checkout expires.
    expect((await setAccountType(sifu.principal, { accountType: 'student' }, meta)).changed).toBe(true);
    const outcomes = await applyPendingBillingEvents();
    expect(outcomes).toContain('conflict');
    expect(await getDb().select().from(billingSubscription).where(eq(billingSubscription.subjectUserId, sifu.account.id))).toHaveLength(0);
    expect(await planOf(sifu.account.id)).toBe('free_student');
    const [providerSide] = await getDb().select().from(billingTestSubscription).where(eq(billingTestSubscription.checkoutRef, checkout.checkoutId));
    expect(providerSide).toMatchObject({ status: 'canceled' });
    // Its "deleted" event changes nothing either.
    expect(await applyPendingBillingEvents()).not.toContain('applied');
    expect(await getDb().select().from(billingSubscription).where(eq(billingSubscription.subjectUserId, sifu.account.id))).toHaveLength(0);
    const [row] = await getDb().select({ status: billingCheckout.status }).from(billingCheckout).where(eq(billingCheckout.id, checkout.checkoutId));
    expect(row!.status).toBe('expired');
  });
});

describe('account deletion', () => {
  it('ends a paid subscription at the provider before the account and its billing rows go', async () => {
    const student = await member('m22-delete');
    const { checkoutId, subscription } = await paidSubscription(student.principal, 'premium_student');
    const { request } = await requestAccountDeletion(student.principal, { confirm: true }, meta);
    await carryOutDeletionFromCommandLine(request.id);
    const [providerSide] = await getDb().select().from(billingTestSubscription).where(eq(billingTestSubscription.checkoutRef, checkoutId));
    expect(providerSide).toMatchObject({ status: 'canceled' });
    expect(await getDb().select().from(billingSubscription).where(eq(billingSubscription.id, subscription.id))).toHaveLength(0);
    // The provider's "deleted" event finds nothing to change.
    expect(await applyPendingBillingEvents()).not.toContain('applied');
  });
});

describe('the demo data (D20)', () => {
  it('demo-premium-student renews, demo-free-sifu-5 had a cancelled Pro Sifu subscription that ended, and both keep their plans', async () => {
    const byEmail = async (email: string) => {
      const [u] = await getDb().select({ id: authUser.id, email: authUser.email }).from(authUser).where(eq(authUser.email, email));
      return { user: { id: u!.id, email: u!.email, emailVerified: true, role: 'user' as const, twoFactorEnabled: false }, session: { id: 'demo-session', expiresAt: new Date(Date.now() + 3_600_000), twoFactorVerifiedAt: null }, via: 'cookie' as const };
    };
    const premium = await myBilling(await byEmail('demo-premium-student@example.test'));
    expect(premium.plan.code).toBe('premium_student');
    expect(premium.subscription).toMatchObject({ status: 'active', cancelAtPeriodEnd: false, planCode: 'premium_student', canCancel: true });
    expect(premium.subscription!.invoices).toHaveLength(1);
    expect(new Date(premium.subscription!.currentPeriodEnd).getTime()).toBeGreaterThan(Date.now() + 7 * DAY);

    const sifu = await myBilling(await byEmail('demo-free-sifu-5@example.test'));
    expect(sifu.plan.code).toBe('free_sifu');
    expect(sifu.subscription).toMatchObject({ status: 'canceled', cancelAtPeriodEnd: true, planCode: 'pro_sifu', canResume: false });
    expect(sifu.offers.map((o) => o.planCode)).toEqual(['pro_sifu']);
    // demo-pro-sifu-8 keeps its test plan only (the M08 downgrade test revokes it).
    const pro = await myBilling(await byEmail('demo-pro-sifu-8@example.test'));
    expect(pro.subscription).toBeNull();
  });
});

describe('staff', () => {
  it('admins read the subscriptions and their events, read-only; other roles cannot', async () => {
    const student = await member('m22-admin-view');
    const { subscription } = await paidSubscription(student.principal, 'premium_student');
    const admin = await staff('m22-admin', 'admin');
    const list = await adminBillingList(admin.principal, {});
    expect(list.rows.some((row) => row.id === subscription.id)).toBe(true);
    const detail = await adminBillingGet(admin.principal, { subscriptionId: subscription.id });
    expect(detail.events.map((e) => e.outcome)).toEqual(expect.arrayContaining(['applied']));
    const moderator = await staff('m22-moderator', 'moderator');
    await expect(adminBillingList(moderator.principal, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(adminBillingList(student.principal, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(moveTestClock(moderator.principal, { subscriptionId: subscription.id, step: 'period_end' }, meta)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('secrets, card data and logs', () => {
  it('refuses a live key or any key but a Stripe test key, at start and wherever the adapter is made', () => {
    const live = fakeKey('sk_live');
    const restricted = fakeKey('rk_live');
    expect(() => checkBillingSettings({ STRIPE_SECRET_KEY: live })).toThrow(/live key/);
    expect(() => checkBillingSettings({ BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: restricted })).toThrow(/live key/);
    expect(() => checkBillingSettings({ BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: fakeKey('pk_test') })).toThrow(/test secret key/);
    expect(() => checkBillingSettings({ BILLING_PROVIDER: 'stripe' })).toThrow(/not set/);
    expect(() => checkBillingSettings({ BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: fakeKey('sk_test') })).toThrow(/STRIPE_WEBHOOK_SECRET/);
    expect(() => checkBillingSettings({ BILLING_PROVIDER: 'paypal' })).toThrow(/BILLING_PROVIDER/);
    expect(checkBillingSettings({ BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: fakeKey('sk_test'), STRIPE_WEBHOOK_SECRET: fakeKey('whsec') })).toBe('stripe');
    expect(checkBillingSettings({})).toBe('test');
    // The start of the web process (src/instrumentation.ts) refuses it in every environment.
    expect(() => checkProductionSettings({ NODE_ENV: 'development', STRIPE_SECRET_KEY: live })).toThrow(/live key/);
    expect(() => createStripeProvider({ env: { STRIPE_SECRET_KEY: live, STRIPE_WEBHOOK_SECRET: fakeKey('whsec') } })).toThrow(/live key/);
    // No message carries the value.
    try {
      checkBillingSettings({ STRIPE_SECRET_KEY: live });
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(live);
    }
  });

  it('stores a Stripe event without card or personal data and logs only its id and type', async () => {
    const webhookSecret = fakeKey('whsec');
    const stripe = createStripeProvider({
      env: { STRIPE_SECRET_KEY: fakeKey('sk_test'), STRIPE_WEBHOOK_SECRET: webhookSecret },
      fetch: async () => {
        throw new Error('no network in tests');
      },
    });
    const id = `evt_${randomBytes(8).toString('hex')}`;
    const body = JSON.stringify({
      id,
      object: 'event',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      data: {
        object: {
          id: `cs_test_${randomBytes(8).toString('hex')}`,
          object: 'checkout.session',
          mode: 'subscription',
          customer: `cus_${randomBytes(6).toString('hex')}`,
          subscription: `sub_${randomBytes(6).toString('hex')}`,
          client_reference_id: '0190a5c0-0000-7000-8000-0000000000a9',
          metadata: { checkout_ref: '0190a5c0-0000-7000-8000-0000000000a9' },
          customer_details: { email: 'demo-buyer@example.test', name: 'Demo Buyer', address: { city: 'Demo City' } },
          payment_method_details: { card: { last4: '4242', brand: 'visa' } },
        },
      },
    });
    const lines: string[] = [];
    const previous = configureLogger({ destination: { write: (line: string) => void lines.push(line) } });
    try {
      const response = await receiveWebhook(stripeRequest(body, webhookSecret), { provider: stripe });
      expect(response.status).toBe(200);
    } finally {
      restoreLogger(previous);
    }
    const [row] = await getDb().select().from(billingEvent).where(eq(billingEvent.providerEventId, id));
    expect(row).toMatchObject({ provider: 'stripe', providerType: 'checkout.session.completed', outcome: 'pending' });
    const stored = JSON.stringify(row!.raw);
    for (const secret of ['demo-buyer@example.test', 'Demo Buyer', 'Demo City', '4242', 'visa']) expect(stored).not.toContain(secret);
    expect(lines.join('\n')).toContain(id);
    for (const secret of ['demo-buyer@example.test', 'Demo Buyer', '4242', webhookSecret]) expect(lines.join('\n')).not.toContain(secret);
    // Unknown checkout: recorded as such on the last attempt, nothing else changes.
    expect((await applyStoredEvent(row!.id, { final: true })).outcome).toBe('unknown');
  });

  it('a whole test purchase logs no address, name or card', async () => {
    const lines: string[] = [];
    const previous = configureLogger({ destination: { write: (line: string) => void lines.push(line) } });
    let email = '';
    try {
      const sifu = await member('m22-logs', { sifu: true });
      email = sifu.account.email;
      const { subscription } = await paidSubscription(sifu.principal, 'pro_sifu');
      await cancelSubscription(sifu.principal, { subscriptionId: subscription.id }, meta);
      await applyPendingBillingEvents();
    } finally {
      restoreLogger(previous);
    }
    const log = lines.join('\n');
    expect(log).toContain('[billing]');
    expect(log).not.toContain(email);
    expect(log).not.toMatch(/4242|4000 0000/);
    const raw = await getDb().select({ raw: billingEvent.raw }).from(billingEvent);
    expect(JSON.stringify(raw)).not.toContain(email);
    const users = await getDb().select({ id: authUser.id }).from(authUser).where(eq(authUser.email, email));
    expect(users).toHaveLength(1);
    const checkouts = await getDb().select().from(billingCheckout).where(eq(billingCheckout.subjectUserId, users[0]!.id));
    expect(JSON.stringify(checkouts)).not.toMatch(/4242/);
  });
});
