// The words of /admin/billing and /admin/billing/[id] in the control panel's language
// (docs/adr/0043-admin-bulgarian.md). The service gives English labels (statusLabel, price); these
// say the same from the values, so a Bulgarian page carries no English. Plan names stay as they are.

import type { AdminT } from '@/components/admin/i18n/translate';
import type { SubscriptionStatus } from '@/server/services/billing';

/** The state of a subscription in words, as the service's statusLabel. */
export function subscriptionStatusLabel(t: AdminT, status: SubscriptionStatus, cancelAtPeriodEnd: boolean): string {
  if (status === 'active' && cancelAtPeriodEnd) return t('Cancels at the period end');
  switch (status) {
    case 'active': return t('Active');
    case 'past_due': return t('Payment failed');
    case 'canceled': return t('Ended');
    default: return t('Not paid');
  }
}

/** Who carries the subscription's payments. */
export function providerLabel(t: AdminT, provider: string): string {
  return provider === 'test' ? t('Test provider') : t('Stripe test mode');
}

/** "$19.00 a month" (the service's price) in the control panel's language; anything else as it is. */
export function priceLabel(t: AdminT, price: string): string {
  const monthly = /^(.+) a month$/.exec(price);
  if (monthly) return t('{amount} a month', { amount: monthly[1]! });
  const yearly = /^(.+) a year$/.exec(price);
  if (yearly) return t('{amount} a year', { amount: yearly[1]! });
  return price;
}
