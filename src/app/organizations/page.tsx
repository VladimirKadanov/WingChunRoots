// /organizations (milestone M15): the approved organizations, by name, with their kind and country.
// Public DTO only (organizations.list). An approval says an organization exists; it verifies no
// teacher or relationship (DEFAULT D04), and the page says so.
//
// ADR 0052: each organization is a card with its banner (or the drawn motif of its kind), its logo
// (or its monogram on a shield) and how many public schools and members it lists. The whole card
// is the name's link (its ::after covers the card), so the accessible name stays the name.

import type { Metadata } from 'next';
import Link from 'next/link';

import { Banner, Emblem } from '@/components/ink/ink-art';
import { ErrorPanel } from '@/components/lineage/states';
import { buttonVariants } from '@/components/ui/button-variants';
import { organizationMotif } from '@/lib/ink-art';
import { countryName } from '@/lib/regions';
import type { OrganizationSummaryDto } from '@/server/dto/organizations';
import { loadOrganizations } from './data';

export const instant = false;

export const metadata: Metadata = {
  title: 'Organizations',
  description: 'Wing Chun federations, associations and groups of schools whose application was approved.',
  alternates: { canonical: '/organizations' },
};

export default async function OrganizationsPage() {
  const list = await loadOrganizations();
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div>
        <h1 className="font-display text-feature">Organizations</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          Federations, associations and groups of schools whose application the reviewers approved. An organization lists its public members and the schools that
          accepted its link; it never decides who taught whom.
        </p>
        {list === null ? (
          <ErrorPanel title="The organizations could not be loaded." className="mt-6">
            <p className="text-sm text-fg-muted">Nothing was changed. Try again in a moment.</p>
            <Link href="/organizations" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Try again
            </Link>
          </ErrorPanel>
        ) : list.organizations.length === 0 ? (
          <div className="mt-8 grid gap-1" data-testid="no-organizations">
            <p className="text-fg-muted">No organization is listed yet.</p>
            <p className="text-sm text-fg-muted">
              Run a federation, an association or a group of schools?{' '}
              <Link href="/dashboard/organization" className="link inline-flex min-h-11 items-center">
                Apply for your organization
              </Link>
            </p>
          </div>
        ) : (
          <ul className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3" data-testid="organization-list">
            {list.organizations.map((org) => (
              <OrganizationCard key={org.slug} org={org} />
            ))}
          </ul>
        )}
        {/* The empty list carries this link itself. */}
        {list !== null && list.organizations.length === 0 ? null : (
          <p className="mt-8 text-sm">
            <Link href="/dashboard/organization" className="link inline-flex min-h-11 items-center">
              Apply for your organization
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

function OrganizationCard({ org }: { org: OrganizationSummaryDto }) {
  const country = org.countryCode ? (countryName(org.countryCode) ?? org.countryCode) : null;
  return (
    <li
      className="relative flex flex-col overflow-hidden rounded-md border border-border-subtle bg-surface-1 focus-within:border-fg hover:border-border-strong"
      data-testid="organization-row"
      data-slug={org.slug}
    >
      <Banner image={org.banner} slug={org.slug} motif={organizationMotif(org.kind)} sizes="card" className="aspect-[16/7]" testId="organization-card-banner" />
      <div className="flex flex-1 flex-col gap-2 p-4 pt-0">
        <Emblem logo={org.logo} name={org.name} shape="shield" className="relative z-10 -mt-7 size-14 shadow-sm" />
        <p className="text-label uppercase text-fg-muted">
          {org.kindLabel}
          {country ? ` · ${country}` : ''}
        </p>
        <h2 className="m-0 text-base font-normal">
          <Link
            href={`/organizations/${org.slug}`}
            className="inline-flex min-h-11 items-center font-display text-xl leading-tight [overflow-wrap:anywhere] after:absolute after:inset-0 after:content-['']"
          >
            {org.name}
          </Link>
        </h2>
        <p className="mt-auto flex gap-4 border-t border-border-subtle pt-3 text-sm text-fg-muted" data-testid="organization-counts">
          <span>{plural(org.schoolCount, 'school', 'schools')}</span>
          <span>{plural(org.memberCount, 'member', 'members')}</span>
        </p>
      </div>
    </li>
  );
}
