// /admin/organizations (milestone M15): every organization with its approval and its plan, two
// separate states (DEFAULT D04), for administrators with a verified second factor. An application
// is decided in the review queue; a plan is given on the organization's page here (DEFAULT D09:
// a test or complimentary Federation grant, never charged).

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { ORGANIZATION_LOAD_ERRORS } from '@/components/account/organization-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { guardRoute } from '@/server/auth/web';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';

export const instant = false;

export const metadata: Metadata = {
  title: 'Organizations',
  robots: { index: false },
};

const PAGE = '/admin/organizations';

export default async function AdminOrganizationsPage() {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/admin" />;
  const view = await pageRead(serverClient(await headers(), guard.principal).organizations.adminList());
  if (!view) return <LoadError {...ORGANIZATION_LOAD_ERRORS.admin} retryHref={PAGE} />;
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[52rem]">
        <p className="eyebrow">
          <Link href="/admin" className="link inline-flex min-h-11 items-center">
            Administration
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Organizations</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          Approval is decided in the review queue. The plan is separate: give an approved organization a test or complimentary Federation plan here.
        </p>
        {view.organizations.length === 0 ? (
          <p className="mt-8 text-fg-muted">No organization has applied.</p>
        ) : (
          <ul className="mt-8 grid" data-testid="admin-organizations">
            {view.organizations.map((org) => (
              <li key={org.id} className="grid gap-1 border-b border-border-subtle py-4" data-testid="admin-organization" data-status={org.status}>
                <Link href={`${PAGE}/${org.id}`} className="link inline-flex min-h-11 items-center font-display text-lg [overflow-wrap:anywhere]">
                  {org.name}
                </Link>
                <p className="text-sm text-fg-muted">
                  {org.kindLabel}
                  {org.countryCode ? ` · ${org.countryCode}` : ''} · {org.admins === 1 ? '1 admin' : `${org.admins} admins`}
                </p>
                <p className="flex flex-wrap gap-x-6 text-sm">
                  <span>
                    <span className="text-fg-muted">Approval: </span>
                    <span className="font-semibold">{org.approvalLabel}</span>
                  </span>
                  <span>
                    <span className="text-fg-muted">Plan: </span>
                    <span className="font-semibold">{org.plan.label}</span>
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
