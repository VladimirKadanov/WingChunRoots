// Billing in test mode (milestone M22; docs/adr/0025-billing.md; plan §"Фаза 2", D06, D08, D09).
//
// - billing_customer: the provider's customer of an account or an organization (exactly one).
// - billing_checkout: a checkout the app started for a subject and a plan; its id travels to the
//   provider as the client reference, so a provider event names the checkout, and the subject always
//   comes from this row, never from the event.
// - billing_subscription: the subscription as the app knows it from the provider's events: status,
//   the paid period, cancel_at_period_end, the last applied provider version (stale events never
//   overwrite newer state) and the entitlement_grant (source 'stripe') it drives. At most one live
//   subscription (active or past_due) per subject.
// - billing_event: every verified provider event, stored before it is applied (idempotent by the
//   provider's event id), with a redacted copy of the raw event (no card data, no names, no
//   addresses) and what applying it did.
// - billing_invoice: the provider's invoices (the payment history), idempotent by invoice id.
// - billing_test_subscription: the test provider's own store (src/server/billing/test-provider.ts),
//   the "provider side" of a test subscription; the app's tables never read it.
//
// - federation_trial (M23; docs/adr/0026-federation-billing.md): a Federation trial of an
//   organization, without a card (specification §10.2): its period, the complimentary grant it
//   gives, and how it ended (converted into a subscription, ran out, or revoked by an administrator).
//
// M23 adds to billing_subscription and billing_test_subscription the change of plan or billing
// period that is scheduled for the end of the period (DEFAULT M23, question 2), and to
// billing_checkout the end of the organization's trial, when the checkout continues one (the first
// charge then comes at the trial's end).
//
// Only app_rw reads and writes these tables; app_public_ro has no privilege on any of them.

import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { authUser } from './auth';
import {
  BILLING_CHECKOUT_STATUSES,
  BILLING_END_REASONS,
  BILLING_EVENT_OUTCOMES,
  BILLING_INTERVALS,
  BILLING_INVOICE_STATUSES,
  BILLING_LIVE_STATUSES,
  BILLING_PROVIDERS,
  BILLING_SUBSCRIPTION_STATUSES,
  BILLING_TEST_CARDS,
  FEDERATION_TRIAL_MONTHS,
  FEDERATION_TRIAL_STATUSES,
  idColumn,
  inList,
  PLAN_CODES,
  timestamps,
} from './common';
import { entitlementGrant } from './entitlements';
import { organization } from './organizations';

const liveStatuses = sql.raw(BILLING_LIVE_STATUSES.map((s) => `'${s}'`).join(', '));

export const billingCustomer = pgTable(
  'billing_customer',
  {
    id: idColumn(),
    provider: text('provider', { enum: BILLING_PROVIDERS }).notNull(),
    providerCustomerId: text('provider_customer_id').notNull(),
    subjectUserId: uuid('subject_user_id').references(() => authUser.id, { onDelete: 'cascade' }),
    subjectOrganizationId: uuid('subject_organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('billing_customer_provider_key').on(t.provider, t.providerCustomerId),
    uniqueIndex('billing_customer_user_key').on(t.provider, t.subjectUserId).where(sql`${t.subjectUserId} IS NOT NULL`),
    uniqueIndex('billing_customer_organization_key').on(t.provider, t.subjectOrganizationId).where(sql`${t.subjectOrganizationId} IS NOT NULL`),
    check('billing_customer_one_subject', sql`num_nonnulls(${t.subjectUserId}, ${t.subjectOrganizationId}) = 1`),
    check('billing_customer_provider_check', inList(t.provider.name, BILLING_PROVIDERS)),
    check('billing_customer_provider_id_length', sql`char_length(${t.providerCustomerId}) BETWEEN 1 AND 255`),
  ],
);

export const billingCheckout = pgTable(
  'billing_checkout',
  {
    id: idColumn(),
    provider: text('provider', { enum: BILLING_PROVIDERS }).notNull(),
    subjectUserId: uuid('subject_user_id').references(() => authUser.id, { onDelete: 'cascade' }),
    subjectOrganizationId: uuid('subject_organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    /** The account that started it (the organization's owner for a Federation). */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    planCode: text('plan_code', { enum: PLAN_CODES }).notNull(),
    interval: text('interval', { enum: BILLING_INTERVALS }).notNull(),
    /** The proposed price at the time (DEFAULT D09), in cents of `currency`. */
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('usd'),
    status: text('status', { enum: BILLING_CHECKOUT_STATUSES }).notNull().default('open'),
    /** The provider's checkout session (Stripe: cs_test_…); null for the test provider. */
    providerSessionId: text('provider_session_id'),
    /** The provider's subscription the checkout became. */
    providerSubscriptionId: text('provider_subscription_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** M23: the end of the organization's trial this checkout continues; nothing is charged before it. */
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index('billing_checkout_user_idx').on(t.subjectUserId, t.createdAt),
    index('billing_checkout_organization_idx').on(t.subjectOrganizationId),
    index('billing_checkout_created_by_user_id_idx').on(t.createdByUserId),
    check('billing_checkout_one_subject', sql`num_nonnulls(${t.subjectUserId}, ${t.subjectOrganizationId}) = 1`),
    check('billing_checkout_provider_check', inList(t.provider.name, BILLING_PROVIDERS)),
    check('billing_checkout_plan_code_check', inList(t.planCode.name, PLAN_CODES)),
    check('billing_checkout_interval_check', inList(t.interval.name, BILLING_INTERVALS)),
    check('billing_checkout_status_check', inList(t.status.name, BILLING_CHECKOUT_STATUSES)),
    check('billing_checkout_amount', sql`${t.amountCents} > 0`),
    check('billing_checkout_completed', sql`(${t.status} = 'completed') = (${t.completedAt} IS NOT NULL)`),
  ],
);

export const billingSubscription = pgTable(
  'billing_subscription',
  {
    id: idColumn(),
    provider: text('provider', { enum: BILLING_PROVIDERS }).notNull(),
    providerSubscriptionId: text('provider_subscription_id').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => billingCustomer.id, { onDelete: 'cascade' }),
    checkoutId: uuid('checkout_id').references(() => billingCheckout.id, { onDelete: 'set null' }),
    subjectUserId: uuid('subject_user_id').references(() => authUser.id, { onDelete: 'cascade' }),
    subjectOrganizationId: uuid('subject_organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    planCode: text('plan_code', { enum: PLAN_CODES }).notNull(),
    interval: text('interval', { enum: BILLING_INTERVALS }).notNull(),
    status: text('status', { enum: BILLING_SUBSCRIPTION_STATUSES }).notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
    /** When the app first saw the subscription past due: the grace runs BILLING_GRACE_DAYS from here. */
    pastDueSince: timestamp('past_due_since', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endReason: text('end_reason', { enum: BILLING_END_REASONS }),
    /** The provider's object version of the last applied state (ms); an older event is stale. */
    providerVersion: bigint('provider_version', { mode: 'number' }).notNull(),
    /** The plan grant (source 'stripe') this subscription drives; its ends_at is the paid-through date. */
    grantId: uuid('grant_id').references(() => entitlementGrant.id, { onDelete: 'set null' }),
    /** M23 (DEFAULT M23, question 2): the plan and billing period that start at current_period_end. */
    scheduledPlanCode: text('scheduled_plan_code', { enum: PLAN_CODES }),
    scheduledInterval: text('scheduled_interval', { enum: BILLING_INTERVALS }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('billing_subscription_provider_key').on(t.provider, t.providerSubscriptionId),
    uniqueIndex('billing_subscription_one_live_user_key').on(t.subjectUserId).where(sql`${t.subjectUserId} IS NOT NULL AND ${t.status} IN (${liveStatuses})`),
    uniqueIndex('billing_subscription_one_live_organization_key')
      .on(t.subjectOrganizationId)
      .where(sql`${t.subjectOrganizationId} IS NOT NULL AND ${t.status} IN (${liveStatuses})`),
    index('billing_subscription_user_idx').on(t.subjectUserId, t.createdAt),
    index('billing_subscription_organization_idx').on(t.subjectOrganizationId),
    index('billing_subscription_customer_id_idx').on(t.customerId),
    index('billing_subscription_checkout_id_idx').on(t.checkoutId),
    index('billing_subscription_grant_id_idx').on(t.grantId),
    index('billing_subscription_past_due_idx').on(t.pastDueSince).where(sql`${t.status} = 'past_due'`),
    check('billing_subscription_one_subject', sql`num_nonnulls(${t.subjectUserId}, ${t.subjectOrganizationId}) = 1`),
    check('billing_subscription_provider_check', inList(t.provider.name, BILLING_PROVIDERS)),
    check('billing_subscription_plan_code_check', inList(t.planCode.name, PLAN_CODES)),
    check('billing_subscription_interval_check', inList(t.interval.name, BILLING_INTERVALS)),
    check('billing_subscription_status_check', inList(t.status.name, BILLING_SUBSCRIPTION_STATUSES)),
    check('billing_subscription_end_reason_check', sql`${t.endReason} IS NULL OR ${inList(t.endReason.name, BILLING_END_REASONS)}`),
    check('billing_subscription_period', sql`${t.currentPeriodEnd} > ${t.currentPeriodStart}`),
    check('billing_subscription_ended', sql`(${t.status} = 'canceled') = (${t.endedAt} IS NOT NULL AND ${t.endReason} IS NOT NULL)`),
    check('billing_subscription_past_due_since', sql`${t.status} <> 'past_due' OR ${t.pastDueSince} IS NOT NULL`),
    check('billing_subscription_scheduled_change', sql`(${t.scheduledPlanCode} IS NULL) = (${t.scheduledInterval} IS NULL)`),
    check('billing_subscription_scheduled_plan_code_check', sql`${t.scheduledPlanCode} IS NULL OR ${inList(t.scheduledPlanCode.name, PLAN_CODES)}`),
    check('billing_subscription_scheduled_interval_check', sql`${t.scheduledInterval} IS NULL OR ${inList(t.scheduledInterval.name, BILLING_INTERVALS)}`),
  ],
);

export const billingEvent = pgTable(
  'billing_event',
  {
    id: idColumn(),
    provider: text('provider', { enum: BILLING_PROVIDERS }).notNull(),
    providerEventId: text('provider_event_id').notNull(),
    /** The provider's own event type (customer.subscription.updated, subscription.updated, …). */
    providerType: text('provider_type').notNull(),
    /** The app's reading of it (src/server/billing/types.ts, NormalizedEvent). */
    normalized: jsonb('normalized').notNull(),
    /** The verified raw event with card data, names, e-mail addresses and addresses removed (redact.ts). */
    raw: jsonb('raw').notNull(),
    /** The provider's subscription the event is about, when it names one. */
    objectId: text('object_id'),
    outcome: text('outcome', { enum: BILLING_EVENT_OUTCOMES }).notNull().default('pending'),
    subscriptionId: uuid('subscription_id').references(() => billingSubscription.id, { onDelete: 'set null' }),
    /** When the provider created the event. */
    providerCreatedAt: timestamp('provider_created_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('billing_event_provider_key').on(t.provider, t.providerEventId),
    index('billing_event_subscription_idx').on(t.subscriptionId, t.receivedAt),
    index('billing_event_object_idx').on(t.provider, t.objectId),
    index('billing_event_received_idx').on(t.receivedAt),
    check('billing_event_provider_check', inList(t.provider.name, BILLING_PROVIDERS)),
    check('billing_event_outcome_check', inList(t.outcome.name, BILLING_EVENT_OUTCOMES)),
    check('billing_event_processed', sql`(${t.outcome} = 'pending') = (${t.processedAt} IS NULL)`),
  ],
);

export const billingInvoice = pgTable(
  'billing_invoice',
  {
    id: idColumn(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => billingSubscription.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: BILLING_PROVIDERS }).notNull(),
    providerInvoiceId: text('provider_invoice_id').notNull(),
    status: text('status', { enum: BILLING_INVOICE_STATUSES }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('billing_invoice_provider_key').on(t.provider, t.providerInvoiceId),
    index('billing_invoice_subscription_idx').on(t.subscriptionId, t.issuedAt),
    check('billing_invoice_provider_check', inList(t.provider.name, BILLING_PROVIDERS)),
    check('billing_invoice_status_check', inList(t.status.name, BILLING_INVOICE_STATUSES)),
    check('billing_invoice_amount', sql`${t.amountCents} >= 0`),
  ],
);

/**
 * The test provider's side of a subscription (src/server/billing/test-provider.ts): what a real
 * provider would hold. Its version grows with every change and is the version of its events.
 */
export const billingTestSubscription = pgTable(
  'billing_test_subscription',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id').notNull(),
    /** The app's checkout id (the client reference). */
    checkoutRef: uuid('checkout_ref').notNull(),
    planCode: text('plan_code', { enum: PLAN_CODES }).notNull(),
    interval: text('interval', { enum: BILLING_INTERVALS }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    /** Which test card pays it: never a card number. */
    card: text('card', { enum: BILLING_TEST_CARDS }).notNull(),
    status: text('status', { enum: BILLING_SUBSCRIPTION_STATUSES }).notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    version: bigint('version', { mode: 'number' }).notNull(),
    /** M23: the change the test provider applies at the period end (DEFAULT M23, question 2). */
    scheduledPlanCode: text('scheduled_plan_code', { enum: PLAN_CODES }),
    scheduledInterval: text('scheduled_interval', { enum: BILLING_INTERVALS }),
    scheduledAmountCents: integer('scheduled_amount_cents'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('billing_test_subscription_checkout_key').on(t.checkoutRef),
    check('billing_test_subscription_card_check', inList(t.card.name, BILLING_TEST_CARDS)),
    check('billing_test_subscription_status_check', inList(t.status.name, BILLING_SUBSCRIPTION_STATUSES)),
    check('billing_test_subscription_period', sql`${t.currentPeriodEnd} > ${t.currentPeriodStart}`),
    check(
      'billing_test_subscription_scheduled_change',
      sql`(${t.scheduledPlanCode} IS NULL) = (${t.scheduledInterval} IS NULL) AND (${t.scheduledPlanCode} IS NULL) = (${t.scheduledAmountCents} IS NULL)`,
    ),
  ],
);

/**
 * M23 (specification §10.2; docs/adr/0026-federation-billing.md): a Federation trial without a card.
 * An administrator starts it for an approved federation; it gives a complimentary Federation grant
 * from starts_at to ends_at. DEFAULT M23 (question 4): one trial per organization, ever.
 */
export const federationTrial = pgTable(
  'federation_trial',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    months: integer('months').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: text('status', { enum: FEDERATION_TRIAL_STATUSES }).notNull().default('active'),
    /** The complimentary Federation grant of the trial. */
    grantId: uuid('grant_id').references(() => entitlementGrant.id, { onDelete: 'set null' }),
    startedByUserId: uuid('started_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    /** The administrator's reason, kept in the audit log too. */
    reason: text('reason').notNull(),
    /** When it stopped being active: converted, ran out (ends_at) or revoked. */
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedByUserId: uuid('ended_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    /** The subscription it was converted into (the organization subscribed during the trial). */
    convertedSubscriptionId: uuid('converted_subscription_id').references(() => billingSubscription.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('federation_trial_organization_key').on(t.organizationId),
    index('federation_trial_active_idx').on(t.endsAt).where(sql`${t.status} = 'active'`),
    index('federation_trial_grant_id_idx').on(t.grantId),
    index('federation_trial_started_by_user_id_idx').on(t.startedByUserId),
    index('federation_trial_ended_by_user_id_idx').on(t.endedByUserId),
    index('federation_trial_converted_subscription_id_idx').on(t.convertedSubscriptionId),
    check('federation_trial_status_check', inList(t.status.name, FEDERATION_TRIAL_STATUSES)),
    check('federation_trial_months_check', sql.raw(`"months" IN (${FEDERATION_TRIAL_MONTHS.join(', ')})`)),
    check('federation_trial_period', sql`${t.endsAt} > ${t.startsAt}`),
    check('federation_trial_ended', sql`(${t.status} = 'active') = (${t.endedAt} IS NULL)`),
    check('federation_trial_reason_length', sql`char_length(btrim(${t.reason})) BETWEEN 1 AND 500`),
  ],
);
