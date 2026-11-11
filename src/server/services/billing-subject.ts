// The live subscription of an account or an organization, and what it means for M08's switch of the
// account type and for the deletion of an account (milestone M22; docs/adr/0025-billing.md). Apart
// from services/billing.ts so that services/plans.ts and services/privacy.ts can call it without
// importing the billing service, which imports plans.ts and organizations.ts (a cycle that leaves
// module constants uninitialized under CommonJS loaders).

import { and, eq, inArray } from 'drizzle-orm';

import { billingCheckout, billingSubscription } from '../db/schema';
import { BILLING_LIVE_STATUSES } from '../db/schema/common';
import { billingProvider } from '../billing/provider';
import { BillingProviderError } from '../billing/types';
import type { Executor } from '../entitlements/access';
import { PLANS } from '../entitlements/plans';
import { ServiceError } from './errors';

export type BillingSubject = { userId: string; organizationId: null } | { userId: null; organizationId: string };

/** The subject's live subscription (active or past due; at most one, by a partial unique index). */
export async function liveSubscriptionOf(tx: Executor, subject: BillingSubject): Promise<typeof billingSubscription.$inferSelect | null> {
  const [row] = await tx
    .select()
    .from(billingSubscription)
    .where(
      and(
        subject.userId ? eq(billingSubscription.subjectUserId, subject.userId) : eq(billingSubscription.subjectOrganizationId, subject.organizationId!),
        inArray(billingSubscription.status, [...BILLING_LIVE_STATUSES]),
      ),
    );
  return row ?? null;
}

/**
 * DEFAULT M22 (question 8): an account with a subscription that renews cannot switch to the other
 * account type, whose plan would leave the paid one dormant and still charged: it cancels first
 * (its plan stays until the period end, and the switch is then allowed). An open checkout of the
 * old type can no longer be paid. Under the account's lock (services/plans.ts, changeAccountType).
 */
export async function beforeAccountTypeChange(tx: Executor, userId: string, now: Date): Promise<void> {
  const live = await liveSubscriptionOf(tx, { userId, organizationId: null });
  if (live && !live.cancelAtPeriodEnd) {
    throw new ServiceError(
      'CONFLICT',
      `You pay for ${PLANS[live.planCode].name}. Cancel it on your billing page first; you keep it until the period ends, and then you can change your account type.`,
      { accountType: 'Cancel your subscription first.' },
    );
  }
  await tx
    .update(billingCheckout)
    .set({ status: 'expired', updatedAt: now })
    .where(and(eq(billingCheckout.status, 'open'), eq(billingCheckout.subjectUserId, userId)));
}

/**
 * Before an account is deleted (services/privacy.ts): its live subscriptions end at the provider at
 * once, so nothing renews or is charged for an account that no longer exists (the billing rows go
 * with the account). If the provider does not answer, or the subscription is of another provider
 * than this app's, nothing is deleted and the administrator tries again.
 */
export async function endSubscriptionsBeforeDeletion(tx: Executor, userId: string): Promise<number> {
  const live = await liveSubscriptionOf(tx, { userId, organizationId: null });
  if (!live) return 0;
  const provider = billingProvider();
  const refuse = () =>
    new ServiceError('CONFLICT', `The account pays for ${PLANS[live.planCode].name} and the payment provider could not end it; nothing was deleted. Try again in a moment.`);
  if (provider.name !== live.provider) throw refuse();
  try {
    await provider.cancelNow(live.providerSubscriptionId);
  } catch (error) {
    if (!(error instanceof BillingProviderError) || error.code !== 'not_found') throw refuse();
  }
  return 1;
}
