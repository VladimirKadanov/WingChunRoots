// /plans (milestone M08, In scope 5; plan §5.6, §6.5): the five plans of specification §3.1 from
// the plan matrix (src/server/entitlements/plans.ts, through the plans.catalog service), grouped by
// who they are for. Features that are not part of the current release say "Planned — not available
// yet"; every price is a proposal (DEFAULT D09), and the pilot takes no payments. A static page:
// the same for every visitor, no session read.
//
// Drawn as a register ledger (review round 1, design-3, design-4, design-10): hairline rows, a
// solid ink stroke for what the pilot has and a dotted pencil stroke for what is planned, the same
// vocabulary as the home page's "How a link earns its seal". A check means the plan has it, a dash
// that it does not, and a neutral value has no mark ("Browse only"). On a phone each feature takes
// the full width with the two plans' values under it, and the planned features sit behind a
// closed disclosure; from md up they follow in the same table.

import type { Metadata } from 'next';
import Link from 'next/link';

import { CheckIcon, ChevronDownIcon, DashIcon, PlannedIcon } from '@/components/icons';
import { LinkStroke } from '@/components/ink/link-stroke';
import { cx } from '@/lib/cx';
import type { PlanCode } from '@/server/entitlements/plans';
import { type PlanCatalog, planCatalog, type PlanSummary } from '@/server/services/plans';

export const metadata: Metadata = {
  title: 'Plans',
  description: 'The plans of the WingChunRoots pilot: what each includes, which features are planned, and proposed prices that are not final.',
};

type Feature = PlanCatalog['features'][number];

const GROUPS: readonly { id: string; title: string; lead: string; codes: readonly PlanCode[] }[] = [
  {
    id: 'students',
    title: 'For students',
    lead: 'In the pilot both student plans give the same: your profile, your teachers and your place in the lineage. What Premium Student adds is planned.',
    codes: ['free_student', 'premium_student'],
  },
  {
    id: 'instructors',
    title: 'For instructors (Sifu)',
    lead: 'Free Sifu counts up to 5 approved students; Professional Sifu has no limit and a public pin for your school. Approvals open with teacher requests, and the pin with the map, later in the pilot.',
    codes: ['free_sifu', 'pro_sifu'],
  },
];

/** "Planned — not available yet": a shape and the words, never colour alone. */
function PlannedTag({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cx('inline-flex items-start gap-1.5 text-label font-semibold text-fg-muted', className)}>
      <PlannedIcon size={16} className="mt-px shrink-0" />
      <span>{label}</span>
    </span>
  );
}

/** A plan's entry in the register: its name, its price (or "Free") and what it is for. */
function PlanEntry({ plan, plannedLabel }: { plan: PlanSummary; plannedLabel: string }) {
  return (
    <article aria-labelledby={`plan-${plan.code}`} className="grid content-start gap-2 border-t-2 border-fg pt-3">
      <h3 id={`plan-${plan.code}`} className="font-display text-2xl">
        {plan.name}
      </h3>
      {plan.availability === 'planned' ? <PlannedTag label={plannedLabel} /> : null}
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="font-display text-xl leading-tight tabular">{plan.price.text}</span>
        {plan.price.label ? <span className="text-sm text-fg-muted">{plan.price.label}</span> : null}
      </p>
      <p className="max-w-[48ch] text-ui text-fg-muted">{plan.summary}</p>
    </article>
  );
}

function Value({ value, planned }: { value: Feature['values'][PlanCode]; planned: boolean }) {
  return (
    <span data-mark={value.mark} className={cx('flex items-start gap-1.5', (planned || value.mark !== 'included') && 'text-fg-muted')}>
      {value.mark === 'included' ? (
        <CheckIcon size={16} className="mt-0.5 shrink-0" />
      ) : value.mark === 'not_included' ? (
        <DashIcon size={16} className="mt-0.5 shrink-0" />
      ) : null}
      <span className="min-w-0 break-words hyphens-auto">{value.label}</span>
    </span>
  );
}

function FeatureName({ feature, plannedLabel }: { feature: Feature; plannedLabel: string }) {
  return (
    <span className="grid gap-1">
      <span className="font-semibold">
        {feature.label}
        {feature.availability === 'planned' ? <span className="sr-only"> ({plannedLabel})</span> : null}
      </span>
      {feature.opens ? (
        <span data-testid="feature-opens" className="inline-flex items-start gap-1.5 text-sm font-normal text-fg-muted">
          <PlannedIcon size={16} className="mt-0.5 shrink-0" />
          {feature.opens}
        </span>
      ) : null}
      {feature.note ? <span className="max-w-[60ch] text-sm font-normal text-fg-muted">{feature.note}</span> : null}
    </span>
  );
}

// Explicit roles: below sm the rows are grids (one feature over its two values), and a table whose
// display changes keeps its semantics only with them.
const rowClass = 'border-b border-border-subtle align-top max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-3';

function GroupRows({ group, plans, plannedLabel }: { group: { id: string; title: string; features: Feature[] }; plans: PlanSummary[]; plannedLabel: string }) {
  const planned = group.id === 'planned';
  return (
    <tbody role="rowgroup" data-group={group.id} className={cx('max-sm:grid', planned && 'max-md:hidden')}>
      <tr role="row" className="max-sm:grid">
        <th role="rowheader" scope="rowgroup" colSpan={plans.length + 1} className="pt-6 pb-2 text-left">
          <span className="inline-flex items-center gap-2">
            <LinkStroke kind={planned ? 'unconfirmed' : 'verified'} width={36} />
            {planned ? <PlannedTag label={group.title} /> : <span className="text-label font-semibold">{group.title}</span>}
          </span>
        </th>
      </tr>
      {group.features.map((feature) => (
        <tr role="row" key={feature.key} data-feature={feature.key} data-availability={feature.availability} className={rowClass}>
          <th role="rowheader" scope="row" className="py-3 pr-3 font-normal break-words hyphens-auto max-sm:col-span-2 max-sm:pb-1.5">
            <FeatureName feature={feature} plannedLabel={plannedLabel} />
          </th>
          {plans.map((plan) => (
            <td role="cell" key={plan.code} className="px-2 py-3 sm:px-3 max-sm:px-0 max-sm:pt-0">
              <Value value={feature.values[plan.code]} planned={planned} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

function Head({ plans }: { plans: PlanSummary[] }) {
  return (
    <thead role="rowgroup" className="max-sm:grid">
      <tr role="row" className="border-b border-border-strong max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-3">
        <th role="columnheader" scope="col" className="py-3 pr-3 align-bottom text-sm font-semibold text-fg-muted max-sm:sr-only">
          Feature
        </th>
        {plans.map((plan) => (
          <th
            role="columnheader"
            key={plan.code}
            scope="col"
            className="px-2 py-3 align-bottom font-display text-base font-normal leading-tight break-words hyphens-auto min-[360px]:text-lg sm:px-3 max-sm:px-0"
          >
            {plan.name}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/**
 * The features of two plans side by side. The features of this release come first; from md up the
 * planned ones follow under their own heading row, "Planned — not available yet", and each says so
 * to a screen reader as well. Below md the planned rows move to <PlannedFeatures>.
 */
function CompareTable({ catalog, plans, caption }: { catalog: PlanCatalog; plans: PlanSummary[]; caption: string }) {
  const groups = [
    { id: 'now', title: 'In the pilot', features: catalog.features.filter((f) => f.availability === 'now') },
    { id: 'planned', title: catalog.plannedLabel, features: catalog.features.filter((f) => f.availability === 'planned') },
  ];
  return (
    <table role="table" className="w-full table-fixed border-collapse text-left text-sm sm:text-ui max-sm:grid">
      <caption className="sr-only">{caption}</caption>
      <colgroup>
        <col className="w-[38%] sm:w-[44%]" />
        {plans.map((plan) => (
          <col key={plan.code} />
        ))}
      </colgroup>
      <Head plans={plans} />
      {groups.map((group) => (
        <GroupRows key={group.id} group={group} plans={plans} plannedLabel={catalog.plannedLabel} />
      ))}
    </table>
  );
}

/** Below md: the planned features behind a closed disclosure, so the phone page stays short. */
function PlannedFeatures({ catalog, plans, caption }: { catalog: PlanCatalog; plans: PlanSummary[]; caption: string }) {
  const features = catalog.features.filter((f) => f.availability === 'planned');
  return (
    <details data-testid="planned-features" className="group border-t border-border-subtle md:hidden">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <LinkStroke kind="unconfirmed" width={36} />
          <PlannedTag label={`${catalog.plannedLabel} (${features.length})`} />
        </span>
        <ChevronDownIcon size={18} className="text-fg-muted transition-transform duration-(--duration-fast) group-open:rotate-180" />
      </summary>
      <table role="table" className="w-full table-fixed border-collapse text-left text-sm max-sm:grid">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          <col className="w-[38%]" />
          {plans.map((plan) => (
            <col key={plan.code} />
          ))}
        </colgroup>
        <Head plans={plans} />
        <tbody role="rowgroup" data-group="planned" className="max-sm:grid">
          {features.map((feature) => (
            <tr role="row" key={feature.key} data-feature={feature.key} data-availability={feature.availability} className={rowClass}>
              <th role="rowheader" scope="row" className="py-3 pr-3 font-normal break-words hyphens-auto max-sm:col-span-2 max-sm:pb-1.5">
                <FeatureName feature={feature} plannedLabel={catalog.plannedLabel} />
              </th>
              {plans.map((plan) => (
                <td role="cell" key={plan.code} className="px-2 py-3 sm:px-3 max-sm:px-0 max-sm:pt-0">
                  <Value value={feature.values[plan.code]} planned />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
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
        <p data-testid="plans-banner" className="mt-6 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-ui font-semibold">
          {catalog.banner}
        </p>

        <div className="mt-10 grid gap-12">
          {GROUPS.map((group) => {
            const plans = group.codes.map((code) => catalog.plans.find((plan) => plan.code === code)!);
            const names = plans.map((plan) => plan.name).join(' and ');
            return (
              <section key={group.id} id={group.id} aria-labelledby={`${group.id}-heading`} className="grid scroll-mt-4 gap-5 border-t border-border-subtle pt-6">
                <header className="grid gap-2">
                  <h2 id={`${group.id}-heading`} className="font-display text-2xl sm:text-3xl">
                    {group.title}
                  </h2>
                  <p data-testid="plans-lead" className="max-w-[60ch] text-ui">
                    {group.lead}
                  </p>
                </header>
                <div className="grid gap-5 sm:grid-cols-2 sm:gap-x-8">
                  {plans.map((plan) => (
                    <PlanEntry key={plan.code} plan={plan} plannedLabel={catalog.plannedLabel} />
                  ))}
                </div>
                <CompareTable catalog={catalog} plans={plans} caption={`What ${names} include`} />
                <PlannedFeatures catalog={catalog} plans={plans} caption={`Planned features of ${names}`} />
              </section>
            );
          })}

          <section id="organizations" aria-labelledby="organizations-heading" className="grid scroll-mt-4 gap-5 border-t border-border-subtle pt-6">
            <header className="grid gap-2">
              <h2 id="organizations-heading" className="font-display text-2xl sm:text-3xl">
                For organizations
              </h2>
              <p className="max-w-[60ch] text-ui">For associations and federations with affiliated schools. It is not part of the pilot.</p>
            </header>
            <div className="grid gap-5 sm:grid-cols-2 sm:gap-x-8">
              <PlanEntry plan={federation} plannedLabel={catalog.plannedLabel} />
              <div className="grid content-start gap-2 border-t border-dashed border-border-strong pt-3 text-ui">
                <h3 className="text-sm font-semibold text-fg-muted">What it would add</h3>
                <ul className="grid gap-1.5">
                  {catalog.federationExtras.map((extra) => (
                    <li key={extra} className="flex items-start gap-2">
                      <PlannedIcon size={16} className="mt-1 shrink-0 text-fg-muted" />
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
            Account type and plan
          </Link>
          . Choosing Sifu sets the Free Sifu plan; it doesn&apos;t verify you as an instructor, an archivist does that separately.
        </p>
      </div>
    </div>
  );
}
