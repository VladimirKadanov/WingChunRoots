// /plans (milestone M08, In scope 5; plan §5.6, §6.5): the five plans of specification §3.1 from
// the plan matrix (src/server/entitlements/plans.ts, through the plans.catalog service), grouped by
// who they are for. Features that are not part of the current release say "Planned — not available
// yet"; every price is a proposal (DEFAULT D09), and the pilot takes no payments. A static page:
// the same for every visitor, no session read.

import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { CheckIcon, DashIcon, PlannedIcon } from '@/components/icons';
import { cx } from '@/lib/cx';
import type { PlanCode } from '@/server/entitlements/plans';
import { type PlanCatalog, planCatalog, type PlanSummary } from '@/server/services/plans';

export const metadata: Metadata = {
  title: 'Plans',
  description: 'The plans of the WingChunRoots pilot: what each includes, which features are planned, and proposed prices that are not final.',
};

type Feature = PlanCatalog['features'][number];

const GROUPS: readonly { id: string; title: string; text: string; codes: readonly PlanCode[] }[] = [
  {
    id: 'students',
    title: 'For students',
    text: 'For everyone who trains: your profile, your teachers and your place in the lineage.',
    codes: ['free_student', 'premium_student'],
  },
  {
    id: 'instructors',
    title: 'For instructors (Sifu)',
    text: 'For those who teach: the students you approve and, with Professional Sifu, your school on the map.',
    codes: ['free_sifu', 'pro_sifu'],
  },
];

/** "Planned — not available yet": a shape and the words, never colour alone. */
function PlannedTag({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cx('inline-flex items-start gap-1.5 text-label font-semibold text-fg-muted', className)}>
      <PlannedIcon size={16} className="mt-px" />
      <span>{label}</span>
    </span>
  );
}

function PriceLine({ plan }: { plan: PlanSummary }) {
  return (
    <p className="grid gap-0.5">
      <span className="font-display text-3xl leading-none tabular">{plan.price.text}</span>
      <span className="text-sm text-fg-muted">{plan.price.label}</span>
    </p>
  );
}

function PlanCard({ plan, plannedLabel }: { plan: PlanSummary; plannedLabel: string }) {
  return (
    <article aria-labelledby={`plan-${plan.code}`} className="grid content-start gap-3 rounded-sm border border-border-subtle bg-surface-1 p-4 sm:p-5">
      <header className="grid gap-1">
        <p className="eyebrow">{plan.tier}</p>
        <h3 id={`plan-${plan.code}`} className="font-display text-2xl">
          {plan.name}
        </h3>
        {plan.availability === 'planned' ? <PlannedTag label={plannedLabel} /> : null}
      </header>
      <PriceLine plan={plan} />
      <p className="max-w-[48ch] text-ui text-fg-muted">{plan.summary}</p>
    </article>
  );
}

function Value({ value, muted }: { value: { label: string; included: boolean }; muted: boolean }) {
  return (
    <span className={cx('flex items-start gap-1.5', (muted || !value.included) && 'text-fg-muted')}>
      {value.included ? <CheckIcon size={16} className="mt-0.5" /> : <DashIcon size={16} className="mt-0.5" />}
      <span className="min-w-0">{value.label}</span>
    </span>
  );
}

function FeatureName({ feature, plannedLabel }: { feature: Feature; plannedLabel: string }): ReactNode {
  return (
    <span className="grid gap-1">
      <span className="font-semibold">
        {feature.label}
        {feature.availability === 'planned' ? <span className="sr-only"> ({plannedLabel})</span> : null}
      </span>
      {feature.note ? <span className="text-sm font-normal text-fg-muted">{feature.note}</span> : null}
    </span>
  );
}

/**
 * The features of two plans side by side: three columns, narrow enough for a phone. The features
 * of this release come first; the planned ones follow under their own heading row, "Planned — not
 * available yet", and each says so to a screen reader as well.
 */
function CompareTable({ catalog, codes, caption }: { catalog: PlanCatalog; codes: readonly PlanCode[]; caption: string }) {
  const plans = codes.map((code) => catalog.plans.find((plan) => plan.code === code)!);
  const groups = [
    { id: 'now', title: 'In the pilot', features: catalog.features.filter((f) => f.availability === 'now') },
    { id: 'planned', title: catalog.plannedLabel, features: catalog.features.filter((f) => f.availability === 'planned') },
  ];
  return (
    <table className="w-full table-fixed border-collapse text-left text-sm sm:text-ui">
      <caption className="sr-only">{caption}</caption>
      <colgroup>
        <col className="w-[38%] sm:w-[44%]" />
        {plans.map((plan) => (
          <col key={plan.code} />
        ))}
      </colgroup>
      <thead>
        <tr className="border-b border-border-strong">
          <th scope="col" className="py-3 pr-3 align-bottom text-sm font-semibold text-fg-muted">
            Feature
          </th>
          {plans.map((plan) => (
            <th key={plan.code} scope="col" className="px-2 py-3 align-bottom font-display text-lg font-normal leading-tight sm:px-3">
              {plan.name}
            </th>
          ))}
        </tr>
      </thead>
      {groups.map((group) => (
        <tbody key={group.id} data-group={group.id}>
          <tr>
            <th scope="rowgroup" colSpan={plans.length + 1} className="pt-6 pb-2 text-left">
              {group.id === 'planned' ? (
                <PlannedTag label={group.title} />
              ) : (
                <span className="text-sm font-semibold text-fg-muted">{group.title}</span>
              )}
            </th>
          </tr>
          {group.features.map((feature) => (
            <tr key={feature.key} data-feature={feature.key} data-availability={feature.availability} className="border-b border-border-subtle align-top">
              <th scope="row" className="py-3 pr-3 font-normal [overflow-wrap:anywhere]">
                <FeatureName feature={feature} plannedLabel={catalog.plannedLabel} />
              </th>
              {plans.map((plan) => (
                <td key={plan.code} className="px-2 py-3 [overflow-wrap:anywhere] sm:px-3">
                  <Value value={feature.values[plan.code]} muted={feature.availability === 'planned'} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}

export default function PlansPage() {
  const catalog = planCatalog();
  const federation = catalog.plans.find((plan) => plan.code === 'federation')!;
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[60rem]">
        <p className="eyebrow">Plans</p>
        <h1 className="mt-2 font-display text-feature">Plans of the pilot</h1>
        <p className="mt-3 max-w-[60ch] text-fg-muted">
          Every account starts on a free plan: Free Student, or Free Sifu for instructors. During the pilot, an administrator can give a
          test plan instead of a payment.
        </p>
        <p
          data-testid="plans-banner"
          className="mt-6 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-ui font-semibold"
        >
          {catalog.banner}
        </p>

        <div className="mt-10 grid gap-12">
          {GROUPS.map((group) => (
            <section key={group.id} aria-labelledby={`${group.id}-heading`} className="grid gap-5 border-t border-border-subtle pt-6">
              <header className="grid gap-1">
                <h2 id={`${group.id}-heading`} className="font-display text-2xl sm:text-3xl">
                  {group.title}
                </h2>
                <p className="max-w-[60ch] text-ui text-fg-muted">{group.text}</p>
              </header>
              <div className="grid gap-3 sm:grid-cols-2">
                {group.codes.map((code) => (
                  <PlanCard key={code} plan={catalog.plans.find((plan) => plan.code === code)!} plannedLabel={catalog.plannedLabel} />
                ))}
              </div>
              <CompareTable catalog={catalog} codes={group.codes} caption={`What ${group.codes.map((code) => catalog.plans.find((p) => p.code === code)!.name).join(' and ')} include`} />
            </section>
          ))}

          <section aria-labelledby="organizations-heading" className="grid gap-5 border-t border-border-subtle pt-6">
            <header className="grid gap-1">
              <h2 id="organizations-heading" className="font-display text-2xl sm:text-3xl">
                For organizations
              </h2>
              <p className="max-w-[60ch] text-ui text-fg-muted">For associations and federations with affiliated schools. It is not part of the pilot.</p>
            </header>
            <div className="grid gap-3 sm:grid-cols-2">
              <PlanCard plan={federation} plannedLabel={catalog.plannedLabel} />
              <div className="grid content-start gap-2 text-ui">
                <h3 className="text-sm font-semibold text-fg-muted">What it would add</h3>
                <ul className="grid gap-1.5">
                  {catalog.federationExtras.map((extra) => (
                    <li key={extra} className="flex items-start gap-2">
                      <PlannedIcon size={16} className="mt-1 text-fg-muted" />
                      <span>{extra}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </div>

        <p className="mt-12 border-t border-border-subtle pt-5 text-ui text-fg-muted">
          Student or Sifu is your choice in{' '}
          <Link href="/dashboard/settings" className="link text-fg">
            your dashboard settings
          </Link>
          . Choosing Sifu sets the Free Sifu plan and verifies nothing: an archivist checks instructors separately. The matrix is version{' '}
          <span className="tabular">{catalog.version}</span>.
        </p>
      </div>
    </div>
  );
}
