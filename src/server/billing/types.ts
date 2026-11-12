// The billing provider boundary (milestone M22; docs/adr/0025-billing.md). The app talks to a
// provider only through BillingProvider; the provider's events reach the app only as
// NormalizedEvent, after their signature is verified (webhook.ts). Two implementations: the local
// test provider (test-provider.ts, the default and the only one CI uses) and the Stripe adapter
// (stripe.ts, test keys only).
//
// Nothing here carries card data, a name, an e-mail address or a postal address: a snapshot holds
// ids, states, times and amounts only.

import type { BILLING_INTERVALS, BILLING_PROVIDERS, BILLING_SUBSCRIPTION_STATUSES, BILLING_TEST_CARDS, PLAN_CODES } from '../db/schema/common';

export type BillingProviderName = (typeof BILLING_PROVIDERS)[number];
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
export type SubscriptionStatus = (typeof BILLING_SUBSCRIPTION_STATUSES)[number];
export type TestCard = (typeof BILLING_TEST_CARDS)[number];
type PlanCode = (typeof PLAN_CODES)[number];

/** The provider's subscription at one moment, as an event or an API answer gives it. */
export interface SubscriptionSnapshot {
  /** The provider's subscription id (sub_…, tsub_…). */
  id: string;
  /** The provider's customer id (cus_…, tcus_…). */
  customerId: string;
  /** The app's checkout id the subscription came from (the client reference), when the provider gives it. */
  checkoutRef: string | null;
  status: SubscriptionStatus;
  interval: BillingInterval;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  endedAt: Date | null;
  /**
   * M23: the plan the provider bills now, when it says (the test provider always; Stripe through the
   * subscription's metadata); null keeps the plan the app holds.
   */
  planCode?: PlanCode | null;
  /**
   * M23 (DEFAULT M23, question 2): the plan and billing period that start at the period end; null for
   * none; undefined when the provider does not say (the app keeps what it holds).
   */
  scheduledChange?: { planCode: PlanCode; interval: BillingInterval } | null;
  /**
   * The order of the provider's states, in ms: the test provider's version counter, Stripe's event
   * time. An event whose version is older than the state the app holds is stale and changes nothing.
   */
  version: number;
}

export interface InvoiceSnapshot {
  id: string;
  subscriptionId: string;
  status: 'paid' | 'failed';
  amountCents: number;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date;
}

/**
 * A provider event as the app reads it:
 * - `subscription`: the subscription changed (created, renewed, cancelled at the period end,
 *   resumed, past due, ended); carries its snapshot.
 * - `invoice`: an invoice was paid or failed; carries the invoice, and the snapshot when the
 *   provider gives one with it (the test provider does).
 * - `checkout`: a checkout finished (Stripe's checkout.session.completed): the checkout, its
 *   customer and subscription ids, without a snapshot.
 * - `ignored`: a type the app does not use (stored nowhere).
 */
export type NormalizedEvent =
  | { kind: 'subscription'; subscription: SubscriptionSnapshot }
  | { kind: 'invoice'; invoice: InvoiceSnapshot; subscription: SubscriptionSnapshot | null }
  | { kind: 'checkout'; checkoutRef: string; customerId: string | null; subscriptionId: string | null }
  | { kind: 'ignored' };

/** A verified provider event: its id, type and time, the app's reading and the redacted raw event. */
export interface VerifiedEvent {
  provider: BillingProviderName;
  eventId: string;
  type: string;
  createdAt: Date;
  normalized: NormalizedEvent;
  /** The raw event without card data, names, e-mail and postal addresses (redact.ts). */
  raw: unknown;
}

export interface CheckoutRequest {
  /** The app's checkout id: the client reference of the provider's session. */
  checkoutId: string;
  planCode: PlanCode;
  planName: string;
  interval: BillingInterval;
  amountCents: number;
  currency: string;
  /** The provider's customer id of the subject, when it has one already. */
  customerId: string | null;
  successUrl: string;
  cancelUrl: string;
  /** When the app's checkout expires (CHECKOUT_TTL_MINUTES): the provider's session expires then too. */
  expiresAt: Date;
  /**
   * M23: the end of the organization's Federation trial this checkout continues: nothing is charged
   * before it, and the first period ends then (specification §10.2). Null without a trial.
   */
  trialEndsAt?: Date | null;
}

/** M23: a change of plan or billing period, now (with proration) or at the period end. */
export interface PlanChange {
  planCode: PlanCode;
  planName: string;
  interval: BillingInterval;
  amountCents: number;
  currency: string;
  /** DEFAULT M23 (question 2): an upgrade takes effect now, with proration; a downgrade at the period end. */
  when: 'now' | 'period_end';
}

export interface CheckoutSession {
  /** Where the browser goes to pay: a page of the app (test) or the provider's hosted page. */
  url: string;
  /** The provider's session id (Stripe: cs_test_…); null for the test provider. */
  sessionId: string | null;
}

/** Thrown when the provider refuses or cannot be reached; carries no request or response body. */
export class BillingProviderError extends Error {
  constructor(
    readonly code: 'refused' | 'unavailable' | 'not_found' | 'unsupported',
    message: string,
  ) {
    super(message);
    this.name = 'BillingProviderError';
  }
}

/** Thrown by verifyWebhook for a request that is not a genuine, fresh event of the provider. */
export class WebhookSignatureError extends Error {
  constructor(message = 'The billing event signature is not valid.') {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

/** What every billing provider offers the app (docs/adr/0025-billing.md). */
export interface BillingProvider {
  readonly name: BillingProviderName;
  /** Starts a checkout for a subscription: where the browser goes to pay. */
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  /** Cancels at the end of the current period; access stays until then. The new state. */
  cancelAtPeriodEnd(subscriptionId: string): Promise<SubscriptionSnapshot>;
  /** Takes back a cancellation before the period ends. The new state. */
  resume(subscriptionId: string): Promise<SubscriptionSnapshot>;
  /** Ends the subscription now (the grace of an unpaid renewal has run out). The new state. */
  cancelNow(subscriptionId: string): Promise<SubscriptionSnapshot>;
  /**
   * Moves the subscription to another price of the same audience (Federation month ↔ year): now, with
   * proration and a new period from now, or at the end of the period (M23; DEFAULT M23, question 2).
   * DEFAULT M22 (question 4), no change offered while Federation was not sold, ends with M23, which
   * sells Federation monthly and yearly.
   */
  changePlan(subscriptionId: string, change: PlanChange): Promise<SubscriptionSnapshot>;
  /** M23: takes back a change scheduled for the period end. The new state. */
  cancelScheduledChange(subscriptionId: string): Promise<SubscriptionSnapshot>;
  /** Verifies the signature of a webhook request body and reads the event. Throws WebhookSignatureError. */
  verifyWebhook(body: string, headers: Headers, now?: Date): VerifiedEvent;
}
