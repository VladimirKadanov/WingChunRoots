// The billing module without a database (milestone M22; docs/adr/0025-billing.md): the settings
// that refuse a live key, the webhook signature, the Stripe adapter's mapping against recorded
// fictional events (./fixtures), its requests through a fake fetch (never the network), the
// redaction of what is stored, and the test provider's event format. Every key here is built at
// run time, so the repository holds nothing that looks like a real key (gitleaks).

import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BillingConfigError, billingProviderName, checkBillingSettings, stripeSecretKey, testWebhookSecret } from './config';
import { redactEvent } from './redact';
import { signPayload, verifySignature, WEBHOOK_TOLERANCE_SECONDS } from './signature';
import { createStripeProvider, formEncode, normalizeStripeEvent, stripeStatus } from './stripe';
import { addInterval, normalizeTestEvent } from './test-provider';
import { WebhookSignatureError } from './types';

const fakeKey = (prefix: string) => [prefix, randomBytes(12).toString('hex')].join('_');
const fixture = (name: string): unknown => JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'));
const stripeSignature = (body: string, secret: string, at = Math.floor(Date.now() / 1000)) =>
  `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`;

describe('settings', () => {
  it('uses the test provider by default and refuses any other name', () => {
    expect(billingProviderName({})).toBe('test');
    expect(billingProviderName({ BILLING_PROVIDER: 'stripe' })).toBe('stripe');
    expect(() => billingProviderName({ BILLING_PROVIDER: 'live' })).toThrow(BillingConfigError);
  });

  it('accepts only a Stripe test secret key, and says so without the value', () => {
    for (const prefix of ['sk_live', 'rk_live']) {
      const key = fakeKey(prefix);
      expect(() => stripeSecretKey({ STRIPE_SECRET_KEY: key })).toThrow(/live key/);
      try {
        stripeSecretKey({ STRIPE_SECRET_KEY: key });
      } catch (error) {
        expect((error as Error).message).not.toContain(key);
      }
    }
    for (const prefix of ['rk_test', 'pk_test', 'pk_live', 'whsec']) expect(() => stripeSecretKey({ STRIPE_SECRET_KEY: fakeKey(prefix) })).toThrow(/test secret key/);
    expect(() => stripeSecretKey({})).toThrow(/not set/);
    const test = fakeKey('sk_test');
    expect(stripeSecretKey({ STRIPE_SECRET_KEY: ` ${test} ` })).toBe(test);
  });

  it('refuses a live key at start even with the test provider, and Stripe without its webhook secret', () => {
    expect(() => checkBillingSettings({ STRIPE_SECRET_KEY: fakeKey('sk_live') })).toThrow(/live key/);
    expect(() => checkBillingSettings({ BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: fakeKey('sk_test') })).toThrow(/STRIPE_WEBHOOK_SECRET/);
    expect(checkBillingSettings({ BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: fakeKey('sk_test'), STRIPE_WEBHOOK_SECRET: fakeKey('whsec') })).toBe('stripe');
    expect(checkBillingSettings({ STRIPE_SECRET_KEY: fakeKey('sk_test') })).toBe('test');
  });

  it('derives the test provider key from MAIL_SEAL_KEY unless it has its own', () => {
    const seal = 'x'.repeat(40);
    expect(testWebhookSecret({ MAIL_SEAL_KEY: seal })).toBe(testWebhookSecret({ MAIL_SEAL_KEY: seal }));
    expect(testWebhookSecret({ MAIL_SEAL_KEY: seal })).not.toBe(testWebhookSecret({ MAIL_SEAL_KEY: 'y'.repeat(40) }));
    expect(testWebhookSecret({ MAIL_SEAL_KEY: seal, BILLING_TEST_WEBHOOK_SECRET: 'z'.repeat(32) })).toBe('z'.repeat(32));
    expect(() => testWebhookSecret({ BILLING_TEST_WEBHOOK_SECRET: 'short' })).toThrow(/32/);
    expect(() => testWebhookSecret({})).toThrow(/MAIL_SEAL_KEY/);
  });
});

describe('webhook signature', () => {
  const secret = 's'.repeat(40);
  const body = '{"id":"tevt_demo0001"}';
  const now = new Date('2026-11-11T10:00:00Z');

  it('accepts its own signature within the tolerance, and one of several v1 values', () => {
    expect(() => verifySignature(body, signPayload(body, secret, now), secret, now)).not.toThrow();
    const late = new Date(now.getTime() + (WEBHOOK_TOLERANCE_SECONDS - 1) * 1000);
    expect(() => verifySignature(body, signPayload(body, secret, now), secret, late)).not.toThrow();
    const t = Math.floor(now.getTime() / 1000);
    const good = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    expect(() => verifySignature(body, `t=${t},v1=${'0'.repeat(64)},v1=${good}`, secret, now)).not.toThrow();
  });

  it('refuses another body, another key, an old or future time, a missing or malformed header', () => {
    const header = signPayload(body, secret, now);
    expect(() => verifySignature(`${body} `, header, secret, now)).toThrow(WebhookSignatureError);
    expect(() => verifySignature(body, header, 'o'.repeat(40), now)).toThrow(WebhookSignatureError);
    expect(() => verifySignature(body, header, secret, new Date(now.getTime() + (WEBHOOK_TOLERANCE_SECONDS + 1) * 1000))).toThrow(/too old/);
    expect(() => verifySignature(body, header, secret, new Date(now.getTime() - (WEBHOOK_TOLERANCE_SECONDS + 1) * 1000))).toThrow(/too old/);
    expect(() => verifySignature(body, null, secret, now)).toThrow(/no signature/);
    expect(() => verifySignature(body, 'v1=abc', secret, now)).toThrow(/malformed/);
    expect(() => verifySignature(body, `t=${Math.floor(now.getTime() / 1000)},v0=abc`, secret, now)).toThrow(/malformed/);
    expect(() => verifySignature(body, 'x'.repeat(3000), secret, now)).toThrow(WebhookSignatureError);
  });
});

describe('the Stripe adapter', () => {
  it('maps a subscription update (period on the item, metadata checkout_ref)', () => {
    const read = normalizeStripeEvent(fixture('customer.subscription.updated'));
    expect(read).toMatchObject({ id: 'evt_1DemoSubUpdated0000000001', type: 'customer.subscription.updated' });
    expect(read.normalized).toEqual({
      kind: 'subscription',
      subscription: {
        id: 'sub_1DemoSubscription000000001',
        customerId: 'cus_DemoCustomer0001',
        checkoutRef: '0190a5c0-0000-7000-8000-00000000c0de',
        status: 'active',
        interval: 'month',
        cancelAtPeriodEnd: true,
        currentPeriodStart: new Date(1793865600 * 1000),
        currentPeriodEnd: new Date(1796544000 * 1000),
        endedAt: null,
        version: 1794470400 * 1000,
      },
    });
  });

  it('maps a failed invoice (the subscription under parent.subscription_details) and a completed checkout', () => {
    expect(normalizeStripeEvent(fixture('invoice.payment_failed')).normalized).toEqual({
      kind: 'invoice',
      subscription: null,
      invoice: {
        id: 'in_1DemoInvoice00000000001',
        subscriptionId: 'sub_1DemoSubscription000000001',
        status: 'failed',
        amountCents: 1900,
        currency: 'usd',
        periodStart: new Date(1796544000 * 1000),
        periodEnd: new Date(1799222400 * 1000),
        issuedAt: new Date(1796544000 * 1000),
      },
    });
    expect(normalizeStripeEvent(fixture('checkout.session.completed')).normalized).toEqual({
      kind: 'checkout',
      checkoutRef: '0190a5c0-0000-7000-8000-00000000c0de',
      customerId: 'cus_DemoCustomer0001',
      subscriptionId: 'sub_1DemoSubscription000000001',
    });
  });

  it('refuses a live event and ignores the types it does not use', () => {
    const live = { ...(fixture('customer.subscription.updated') as Record<string, unknown>), livemode: true };
    expect(() => normalizeStripeEvent(live)).toThrow(/test mode only/);
    const other = { ...(fixture('customer.subscription.updated') as Record<string, unknown>), type: 'customer.created' };
    expect(normalizeStripeEvent(other).normalized).toEqual({ kind: 'ignored' });
  });

  it('reads the statuses of Stripe as the app’s', () => {
    expect(['active', 'trialing', 'past_due', 'unpaid', 'paused', 'canceled', 'incomplete_expired', 'incomplete'].map(stripeStatus)).toEqual([
      'active',
      'active',
      'past_due',
      'past_due',
      'past_due',
      'canceled',
      'canceled',
      'incomplete',
    ]);
  });

  it('encodes a request as Stripe’s form body', () => {
    expect(formEncode({ mode: 'subscription', line_items: [{ quantity: 1, price_data: { unit_amount: 1900 } }], skip: undefined, none: null })).toBe(
      'mode=subscription&line_items%5B0%5D%5Bquantity%5D=1&line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=1900',
    );
  });

  it('verifies the Stripe-Signature header and stores the event without card or personal data', () => {
    const webhookSecret = fakeKey('whsec');
    const stripe = createStripeProvider({ env: { STRIPE_SECRET_KEY: fakeKey('sk_test'), STRIPE_WEBHOOK_SECRET: webhookSecret }, fetch: async () => new Response(null, { status: 500 }) });
    const body = readFileSync(path.join(import.meta.dirname, 'fixtures', 'checkout.session.completed.json'), 'utf8');
    const verified = stripe.verifyWebhook(body, new Headers({ 'stripe-signature': stripeSignature(body, webhookSecret, 1793865600) }), new Date(1793865600 * 1000));
    expect(verified).toMatchObject({ provider: 'stripe', eventId: 'evt_1DemoCheckoutDone00000001', type: 'checkout.session.completed' });
    const stored = JSON.stringify(verified.raw);
    for (const personal of ['demo-buyer@example.test', 'Demo Buyer', 'Demo City']) expect(stored).not.toContain(personal);
    expect(stored).toContain('cs_test_DemoSession0001');
    expect(() => stripe.verifyWebhook(body, new Headers({ 'stripe-signature': stripeSignature(body, fakeKey('whsec'), 1793865600) }), new Date(1793865600 * 1000))).toThrow(WebhookSignatureError);
  });

  it('calls Stripe with the test key, form bodies and an idempotency key, and only follows its own checkout page', async () => {
    const key = fakeKey('sk_test');
    const calls: { url: string; init: RequestInit }[] = [];
    let answer: Record<string, unknown> = { id: 'cs_test_Demo0001', url: 'https://checkout.stripe.com/c/pay/cs_test_Demo0001', livemode: false };
    const stripe = createStripeProvider({
      env: { STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: fakeKey('whsec') },
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    const request = {
      checkoutId: '0190a5c0-0000-7000-8000-00000000c0de',
      planCode: 'pro_sifu' as const,
      planName: 'Professional Sifu',
      interval: 'month' as const,
      amountCents: 1900,
      currency: 'usd',
      customerId: null,
      successUrl: 'http://localhost:3000/dashboard/billing?checkout=0190a5c0-0000-7000-8000-00000000c0de#outcome',
      cancelUrl: 'http://localhost:3000/dashboard/billing?checkout=0190a5c0-0000-7000-8000-00000000c0de&cancelled=1#outcome',
      expiresAt: new Date(Date.now() + 60 * 60_000),
    };
    expect(await stripe.createCheckout(request)).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_Demo0001', sessionId: 'cs_test_Demo0001' });
    const [call] = calls;
    expect(call!.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    const headers = new Headers(call!.init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${key}`);
    expect(headers.get('idempotency-key')).toBe('wcr-checkout-0190a5c0-0000-7000-8000-00000000c0de');
    const form = new URLSearchParams(String(call!.init.body));
    expect(form.get('mode')).toBe('subscription');
    expect(form.get('client_reference_id')).toBe(request.checkoutId);
    expect(form.get('subscription_data[metadata][checkout_ref]')).toBe(request.checkoutId);
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('1900');
    expect(form.get('expires_at')).toBe(String(Math.floor(request.expiresAt.getTime() / 1000)));
    // Another address than Stripe's hosted checkout is never followed.
    answer = { id: 'cs_test_Demo0002', url: 'https://example.test/pay', livemode: false };
    await expect(stripe.createCheckout(request)).rejects.toMatchObject({ code: 'unavailable' });
    // An answer in live mode is refused.
    answer = { id: 'sub_Demo0001', object: 'subscription', livemode: true };
    await expect(stripe.cancelAtPeriodEnd('sub_Demo0001')).rejects.toMatchObject({ code: 'refused' });
    const cancel = calls.at(-1)!;
    expect(cancel.url).toBe('https://api.stripe.com/v1/subscriptions/sub_Demo0001');
    expect(String(cancel.init.body)).toBe('cancel_at_period_end=true');
  });

  it('cannot be made with a live key', () => {
    expect(() => createStripeProvider({ env: { STRIPE_SECRET_KEY: fakeKey('sk_live'), STRIPE_WEBHOOK_SECRET: fakeKey('whsec') } })).toThrow(/live key/);
  });
});

describe('redaction', () => {
  it('removes card data, names, e-mail addresses, phones and addresses, and keeps the ids', () => {
    const out = JSON.stringify(
      redactEvent({
        id: 'evt_demo',
        data: {
          object: {
            id: 'pi_demo',
            customer_email: 'demo@example.test',
            billing_details: { name: 'Demo Person', address: { line1: '1 Demo Street' } },
            payment_method_details: { card: { last4: '4242', brand: 'visa', fingerprint: 'abc' } },
            description: 'Paid by demo-other@example.test',
            metadata: { checkout_ref: '0190a5c0-0000-7000-8000-00000000c0de' },
          },
        },
      }),
    );
    for (const gone of ['demo@example.test', 'Demo Person', '1 Demo Street', '4242', 'visa', 'abc', 'demo-other@example.test']) expect(out).not.toContain(gone);
    expect(out).toContain('pi_demo');
    expect(out).toContain('0190a5c0-0000-7000-8000-00000000c0de');
  });
});

describe('the test provider', () => {
  it('adds a calendar month (the last day of a shorter month) or a year', () => {
    expect(addInterval(new Date('2026-01-31T09:00:00Z'), 'month').toISOString()).toBe('2026-02-28T09:00:00.000Z');
    expect(addInterval(new Date('2026-11-11T09:00:00Z'), 'month').toISOString()).toBe('2026-12-11T09:00:00.000Z');
    expect(addInterval(new Date('2028-02-29T09:00:00Z'), 'year').toISOString()).toBe('2029-03-01T09:00:00.000Z');
  });

  it('reads its own events and refuses a live or malformed one', () => {
    const subscription = {
      id: 'tsub_demo00000001',
      customer: 'tcus_demo00000001',
      checkout_ref: '0190a5c0-0000-7000-8000-00000000c0de',
      status: 'active',
      interval: 'month',
      cancel_at_period_end: false,
      current_period_start: '2026-11-01T09:00:00.000Z',
      current_period_end: '2026-12-01T09:00:00.000Z',
      ended_at: null,
      version: 3,
    };
    const event = { id: 'tevt_demo00000001', object: 'event', type: 'subscription.updated', created: 1794470400, livemode: false, data: { subscription } };
    expect(normalizeTestEvent(event).normalized).toMatchObject({ kind: 'subscription', subscription: { id: 'tsub_demo00000001', version: 3, status: 'active' } });
    expect(() => normalizeTestEvent({ ...event, livemode: true })).toThrow(WebhookSignatureError);
    expect(() => normalizeTestEvent({ ...event, id: 'evt_other' })).toThrow(WebhookSignatureError);
    expect(normalizeTestEvent({ ...event, type: 'something.else' }).normalized).toEqual({ kind: 'ignored' });
  });
});
