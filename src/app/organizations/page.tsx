// /organizations (milestone M15): the approved organizations, by name, with their kind and country.
// Public DTO only (organizations.list). An approval says an organization exists; it verifies no
// teacher or relationship (DEFAULT D04), and the page says so.

import type { Metadata } from 'next';
import Link from 'next/link';

import { ErrorPanel } from '@/components/lineage/states';
import { buttonVariants } from '@/components/ui/button-variants';
import { countryName } from '@/lib/regions';
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
      <div className="max-w-[46rem]">
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
          <p className="mt-8 text-fg-muted" data-testid="no-organizations">
            No organization is listed yet.
          </p>
        ) : (
          <ul className="mt-8 grid" data-testid="organization-list">
            {list.organizations.map((org) => (
              <li key={org.slug} className="grid gap-1 border-b border-border-subtle py-4" data-testid="organization-row" data-slug={org.slug}>
                <Link href={`/organizations/${org.slug}`} className="link inline-flex min-h-11 items-center font-display text-lg [overflow-wrap:anywhere]">
                  {org.name}
                </Link>
                <p className="text-sm text-fg-muted">
                  {org.kindLabel}
                  {org.countryCode ? ` · ${countryName(org.countryCode) ?? org.countryCode}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-8 text-sm">
          <Link href="/dashboard/organization" className="link inline-flex min-h-11 items-center">
            Apply for your organization
          </Link>
        </p>
      </div>
    </div>
  );
}
