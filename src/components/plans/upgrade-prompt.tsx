// <UpgradePrompt> (milestone M08, In scope 4; plan §5.6): shown only at a real limit, where a
// request waits because of it. It says what the account has now ("You have approved 5 of 5
// students on Free Sifu."), the benefits of the higher plan that exist in this release (only
// features with availability 'now', from the plan matrix through upgradeBenefits()), the working
// price with "Proposed price (not final)" (DEFAULT D09), and two equally prominent actions:
// "Request pilot access" and "Not now". No countdown, no scarcity, nothing ticked in advance; the
// waiting requests stay pending and visible.

import Link from 'next/link';

import { CheckIcon } from '@/components/icons';
import type { FormState } from '@/lib/form-state';
import type { UpgradeOffer } from '@/server/services/dashboard';
import { UpgradeActions } from './upgrade-actions';

export function UpgradePrompt({
  offer,
  requestAction,
  notNowHref,
  initial,
}: {
  offer: UpgradeOffer;
  requestAction: (previous: FormState, form: FormData) => Promise<FormState>;
  notNowHref: string;
  initial?: FormState | null;
}) {
  const waiting = offer.waiting?.sentence ?? null;
  return (
    <section
      id="upgrade"
      aria-labelledby="upgrade-heading"
      data-testid="upgrade-prompt"
      className="grid gap-5 rounded-sm border border-border-strong bg-surface-1 p-4 [--seal-ground:var(--surface-1)] sm:p-6"
    >
      <header className="grid gap-2">
        <p className="eyebrow">Your plan: {offer.from.name}</p>
        <h2 id="upgrade-heading" className="font-display text-2xl">
          {offer.heading}
        </h2>
        <p data-testid="upgrade-allowance" className="text-ui font-semibold">
          {offer.allowance.sentence}
        </p>
        {waiting ? <p className="max-w-[60ch] text-ui text-fg-muted">{waiting}</p> : null}
      </header>

      <div className="grid gap-2">
        <h3 className="text-sm font-semibold">What {offer.to.name} gives you in this release</h3>
        <ul data-testid="upgrade-benefits" className="grid gap-2">
          {offer.benefits.map((benefit) => (
            <li key={benefit.feature} data-feature={benefit.feature} className="flex items-start gap-2 text-ui">
              <CheckIcon size={18} className="mt-0.5" />
              <span>
                <span className="font-semibold">{benefit.label}:</span> {benefit.to}
                <span className="text-fg-muted"> (now: {benefit.from.toLowerCase()})</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p data-testid="upgrade-price" className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-3xl leading-none tabular">{offer.to.price.text}</span>
        <span className="text-sm text-fg-muted">{offer.to.price.label}</span>
      </p>
      <p className="max-w-[60ch] text-sm text-fg-muted">
        There are no payments during the pilot. Request pilot access and an administrator can give you {offer.to.name} as a test plan.
      </p>

      <UpgradeActions
        action={requestAction}
        planCode={offer.to.code}
        planName={offer.to.name}
        request={offer.pilotRequest}
        notNowHref={notNowHref}
        initial={initial}
      />
      <p className="text-sm">
        <Link href="/plans" className="link inline-flex min-h-11 items-center">
          Compare all plans
        </Link>
      </p>
    </section>
  );
}
