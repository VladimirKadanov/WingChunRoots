// Helpers of the billing tests (milestone M22): a paid test subscription for an account, and the
// worker's part (applying the stored provider events) run in-process. Tests only.

import { asc, eq, isNull } from 'drizzle-orm';

import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { billingEvent, billingSubscription } from '../db/schema';
import type { TestCard } from '../billing/types';
import { applyStoredEvent, startCheckout, testPay } from './billing';
import { meta } from './relationships.test-support';

/** Applies every stored event not processed yet, oldest first, as the job would (its last attempt). */
export async function applyPendingBillingEvents(now?: Date): Promise<string[]> {
  const pending = await getDb().select({ id: billingEvent.id }).from(billingEvent).where(isNull(billingEvent.processedAt)).orderBy(asc(billingEvent.receivedAt), asc(billingEvent.id));
  const outcomes: string[] = [];
  for (const { id } of pending) outcomes.push((await applyStoredEvent(id, { final: true, now })).outcome);
  return outcomes;
}

/** Checks out and pays the paid plan of the account's type with a test card; returns the subscription. */
export async function paidSubscription(principal: Principal, planCode: 'premium_student' | 'pro_sifu', card: TestCard = 'succeeds') {
  const checkout = await startCheckout(principal, { planCode }, meta);
  await testPay(principal, { checkoutId: checkout.checkoutId, card }, meta);
  await applyPendingBillingEvents();
  const [sub] = await getDb().select().from(billingSubscription).where(eq(billingSubscription.checkoutId, checkout.checkoutId));
  if (!sub) throw new Error('the test subscription was not applied');
  return { checkoutId: checkout.checkoutId, subscription: sub };
}
