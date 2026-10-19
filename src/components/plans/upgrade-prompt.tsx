'use client';

// <UpgradePrompt> (milestone M08, In scope 4; plan §5.6): shown only at a real limit, where a
// request waits because of it, at the top of the list that limit holds back ("Student requests").
//
// Calm by default (review round 1, design-2 and a11y-webview-11): a one-line disclosure says what
// the account has now ("You have approved 5 of 5 students on Free Sifu.") and "What Professional
// Sifu adds". Opened, it lists the benefits of the higher plan that are part of the pilot (only
// features with availability 'now', through upgradeBenefits(); a benefit whose screens open later
// in the pilot says when, review round 1, design-1), the working price with "Proposed price (not
// final)" (DEFAULT D09), and two equally prominent actions: "Request pilot access" and "Not now",
// which closes it again. It never opens by itself, so it needs no stored dismissal. No countdown,
// no scarcity, nothing ticked in advance; the waiting requests stay pending and visible.
//
// Once the account has asked (now or earlier), only the allowance and the state of the request
// remain: no price, no benefits, no buttons (design-2). Works without JavaScript: <details> opens
// natively, the form posts and the page shows the outcome (src/server/forms/flash.ts); "Not now"
// is then a link back to the closed prompt.

import Link from 'next/link';
import { useActionState, useRef } from 'react';

import { FormMessage, useFocusOnError, useFormId } from '@/components/account/fields';
import { CheckIcon, ChevronDownIcon, PlannedIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { formatDay } from '@/lib/dates';
import { IDLE, type FormState } from '@/lib/form-state';
import type { UpgradeOffer } from '@/server/services/dashboard';
import { PILOT_ACCESS_FORM } from './form-ids';

const actionClass = cx(buttonVariants({ variant: 'secondary', size: 'lg' }), 'w-full');

export function UpgradePrompt({
  offer,
  requestAction,
  notNowHref,
  initial,
}: {
  offer: UpgradeOffer;
  requestAction: (previous: FormState, form: FormData) => Promise<FormState>;
  /** Where "Not now" goes without JavaScript: the same page with the prompt closed. */
  notNowHref: string;
  /** The outcome of a post without JavaScript (src/server/forms/flash.ts). */
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(requestAction, initial ?? IDLE);
  const generatedId = useFormId('pilot-access');
  // The outcome of a post without JavaScript is opened at its message: a fixed id (./form-ids.ts).
  const formId = initial ? PILOT_ACCESS_FORM : generatedId;
  useFocusOnError(formId, state);
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const asked = state.status === 'done' || offer.pilotRequest !== null;
  // Open only to show the outcome of a post that failed (the prompt never opens by itself).
  const openAtFirst = initial?.status === 'error';
  const to = offer.to;

  if (asked) {
    return (
      <div id="upgrade" data-testid="upgrade-prompt" data-state="asked" className="grid gap-3 rounded-sm border border-border-subtle bg-surface-1 px-4 py-3">
        <p data-testid="upgrade-allowance" className="text-ui font-semibold">
          {offer.allowance.sentence}
        </p>
        {state.status === 'done' ? (
          <FormMessage form={formId} state={state} single />
        ) : (
          <p data-testid="pilot-request-state" className="max-w-[60ch] text-ui text-fg-muted">
            You asked for pilot access to {offer.pilotRequest!.planName} on {formatDay(offer.pilotRequest!.createdAt)}. An administrator
            either gives you the plan or closes the request, and you get a notification either way. Nothing is charged.
          </p>
        )}
        <p className="text-sm">
          <Link href="/plans" className="link inline-flex min-h-11 items-center">
            Compare plans
          </Link>
        </p>
      </div>
    );
  }

  return (
    <details
      ref={details}
      id="upgrade"
      data-testid="upgrade-prompt"
      open={openAtFirst || undefined}
      className="group rounded-sm border border-border-strong bg-surface-1 [--seal-ground:var(--surface-1)]"
    >
      <summary
        ref={summary}
        data-testid="upgrade-summary"
        className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-sm px-4 py-3 outline-offset-2 [&::-webkit-details-marker]:hidden"
      >
        <span data-testid="upgrade-allowance" className="text-ui font-semibold">
          {offer.allowance.sentence}
        </span>
        <span className="inline-flex items-center gap-1.5 text-ui underline decoration-1 underline-offset-[0.2em]">
          What {to.name} adds
          <ChevronDownIcon size={18} className="transition-transform duration-(--duration-fast) group-open:rotate-180" />
        </span>
      </summary>

      <div className="grid gap-5 border-t border-border-subtle px-4 pt-4 pb-5 sm:px-6">
        <header className="grid gap-2">
          <h3 id="upgrade-heading" className="font-display text-2xl">
            {offer.heading}
          </h3>
          {offer.waiting ? <p className="max-w-[60ch] text-ui text-fg-muted">{offer.waiting.sentence}</p> : null}
        </header>

        <div className="grid gap-2">
          <h4 className="text-sm font-semibold">What {to.name} adds during the pilot</h4>
          <ul data-testid="upgrade-benefits" className="grid gap-3">
            {offer.benefits.map((benefit) => (
              <li key={benefit.feature} data-feature={benefit.feature} className="flex items-start gap-2 text-ui">
                <CheckIcon size={18} className="mt-0.5 shrink-0" />
                <span className="grid gap-0.5">
                  <span>
                    <span className="font-semibold">{benefit.label}:</span> {benefit.to}
                    <span className="text-fg-muted"> (now: {benefit.from.toLowerCase()})</span>
                  </span>
                  {benefit.opens ? (
                    <span data-testid="benefit-opens" className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
                      <PlannedIcon size={16} />
                      {benefit.opens}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p data-testid="upgrade-price" className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-xl leading-tight tabular">{to.price.text}</span>
          {to.price.label ? <span className="text-sm text-fg-muted">{to.price.label}</span> : null}
        </p>
        <p className="max-w-[60ch] text-sm text-fg-muted">
          There are no payments during the pilot. Request pilot access and an administrator can give you {to.name} as a test plan.
        </p>

        <div className="grid gap-3">
          <FormMessage form={formId} state={state} single />
          <div className="grid gap-3 sm:grid-cols-2">
            <form id={formId} action={action} aria-busy={pending || undefined}>
              <input type="hidden" name="planCode" value={to.code} />
              <button
                type="submit"
                data-testid="request-pilot-access"
                aria-disabled={pending || undefined}
                onClick={(event) => {
                  if (pending) event.preventDefault();
                }}
                className={actionClass}
              >
                {pending ? 'Sending the request…' : 'Request pilot access'}
                <span className="sr-only"> to {to.name}</span>
              </button>
            </form>
            <a
              href={notNowHref}
              data-testid="upgrade-not-now"
              onClick={(event) => {
                // With JavaScript: close the prompt in place and give the focus back to its line.
                if (!details.current) return;
                event.preventDefault();
                details.current.open = false;
                summary.current?.focus();
              }}
              className={actionClass}
            >
              Not now
            </a>
          </div>
        </div>
        <p className="text-sm">
          <Link href="/plans" className="link inline-flex min-h-11 items-center">
            Compare all plans
          </Link>
        </p>
      </div>
    </details>
  );
}
