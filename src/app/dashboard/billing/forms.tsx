'use client';

// The forms of /dashboard/billing (milestone M22): choose a paid plan (a test-mode checkout), cancel
// at the end of the period, and resume. Each posts to a thin Server Action and works without
// JavaScript (src/server/forms/flash.ts). Plain words and a date; no countdown, no urgency
// (CLAUDE.md §11).

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';

import { FormMessage, SubmitButton, useFocusOnError } from '@/components/account/fields';
import { IDLE, type FormState } from '@/lib/form-state';
import { cancelSubscriptionAction, resumeSubscriptionAction, startCheckoutAction } from './actions';
import { CANCEL_FORM, CHECKOUT_FORM, RESUME_FORM } from './form-ids';

export interface OfferView {
  planCode: string;
  planName: string;
  interval: 'month' | 'year';
  price: string;
  priceLabel: string;
  summary: string;
}

/** One paid plan this account may choose, with its proposed price and the test-mode label. */
export function CheckoutForm({ offer, testModeLabel, chosen, initial }: { offer: OfferView; testModeLabel: string; chosen: boolean; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(startCheckoutAction, initial ?? IDLE);
  // One offer per account type (its paid plan, monthly), so one fixed id for the outcome without JavaScript.
  const formId = CHECKOUT_FORM;
  useFocusOnError(formId, state);
  return (
    <form
      id={formId}
      action={action}
      noValidate
      aria-busy={pending || undefined}
      data-testid={`offer-${offer.planCode}`}
      className={`grid gap-3 rounded-sm border p-4 ${chosen ? 'border-2 border-fg' : 'border-border-strong'}`}
    >
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="planCode" value={offer.planCode} />
      <input type="hidden" name="interval" value={offer.interval} />
      <h3 className="font-display text-2xl">{offer.planName}</h3>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="font-display text-xl tabular">{offer.price}</span>
        <span className="text-sm text-fg-muted">{offer.priceLabel}</span>
      </p>
      <p className="max-w-[52ch] text-ui text-fg-muted">{offer.summary}</p>
      <p className="text-sm font-semibold">{testModeLabel}. You can cancel at any time; the plan then runs to the end of the period.</p>
      <div>
        <SubmitButton pending={pending} pendingLabel="Opening the checkout…">
          Choose {offer.planName}
        </SubmitButton>
      </div>
    </form>
  );
}

export function CancelForm({ subscriptionId, planName, until, initial }: { subscriptionId: string; planName: string; until: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(cancelSubscriptionAction, initial ?? IDLE);
  useFocusOnError(CANCEL_FORM, state);
  return (
    <form id={CANCEL_FORM} action={action} noValidate aria-busy={pending || undefined} className="grid gap-3" data-testid="cancel-form">
      <FormMessage form={CANCEL_FORM} state={state} single />
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <p className="max-w-[60ch] text-ui text-fg-muted">
        Cancelling stops the renewal. You keep {planName} until <span data-visual-date="">{until}</span>; after that your account has its free plan, and every confirmed link,
        school and photo stays.
      </p>
      <div>
        <SubmitButton pending={pending} pendingLabel="Cancelling…" variant="secondary">
          Cancel at the end of the period
        </SubmitButton>
      </div>
    </form>
  );
}

export function ResumeForm({ subscriptionId, initial }: { subscriptionId: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(resumeSubscriptionAction, initial ?? IDLE);
  useFocusOnError(RESUME_FORM, state);
  return (
    <form id={RESUME_FORM} action={action} noValidate aria-busy={pending || undefined} className="grid gap-3" data-testid="resume-form">
      <FormMessage form={RESUME_FORM} state={state} single />
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <div>
        <SubmitButton pending={pending} pendingLabel="Resuming…">
          Resume the subscription
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * While a paid checkout waits for the provider's event to be applied (a few seconds), the page reads
 * itself again every 2 seconds, at most 15 times; the "Check again" link does the same without
 * JavaScript. It says what it is doing, never a countdown.
 */
export function ConfirmingRefresh() {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (tries >= 15) return;
    const timer = setTimeout(() => {
      router.refresh();
      setTries((n) => n + 1);
    }, 2000);
    return () => clearTimeout(timer);
  }, [router, tries]);
  return null;
}
