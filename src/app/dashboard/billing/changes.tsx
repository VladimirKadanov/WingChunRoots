// M23 (docs/adr/0026-federation-billing.md; DEFAULT M23, question 2): the change of plan or billing
// period scheduled for the end of the period, and the changes a subscription may make, on the
// account's and on an organization's billing page. Plain words and a date; no urgency (CLAUDE.md §11).

import { formatDay } from '@/lib/dates';
import type { FormState } from '@/lib/form-state';
import type { SubscriptionView } from '@/server/services/billing';
import { CancelChangeForm, ChangePlanForm } from './forms';

export function SubscriptionChanges({
  sub,
  results,
  cancelChangeResult,
  organizationId,
}: {
  sub: SubscriptionView;
  /** The outcome of a change form posted without JavaScript, by form id. */
  results: Record<string, FormState | null>;
  cancelChangeResult: FormState | null;
  organizationId?: string;
}) {
  if (!sub.scheduledChange && sub.changeOptions.length === 0) return null;
  return (
    <div className="grid gap-4 border-t border-border-subtle pt-4" data-testid="billing-changes">
      {sub.scheduledChange ? (
        <div className="grid gap-2" data-testid="scheduled-change">
          <p className="text-ui">
            <span className="font-semibold">Scheduled:</span>{' '}
            <span data-visual-date="">
              from {formatDay(sub.scheduledChange.startsOn)}, {sub.scheduledChange.planName} billed {sub.scheduledChange.interval === 'year' ? 'yearly' : 'monthly'} at{' '}
              {sub.scheduledChange.price} (proposed, test mode).
            </span>
          </p>
          <CancelChangeForm subscriptionId={sub.id} initial={cancelChangeResult} organizationId={organizationId} />
        </div>
      ) : null}
      {sub.changeOptions.length > 0 ? (
        <div className="grid gap-4">
          <h3 className="font-display text-xl">Change the billing</h3>
          {sub.changeOptions.map((option) => (
            <ChangePlanForm key={`${option.planCode}-${option.interval}`} subscriptionId={sub.id} option={option} initial={results[`${option.planCode}-${option.interval}`] ?? null} organizationId={organizationId} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
