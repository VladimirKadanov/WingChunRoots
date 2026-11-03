// /dashboard/organization (milestone M15; specification §4.3, docs/adr/0018-organizations.md): the
// organizations the signed-in account administers, each with its approval and its plan as two
// separate states (DEFAULT D04), and the way to apply for one. An organization's admins are
// accounts, apart from any person's membership (DEFAULT D12). The data comes from
// organizations.mine. Reads the session, so the page renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { ORGANIZATION_LOAD_ERRORS } from '@/components/account/organization-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { OutcomeNote } from '@/components/relationships/parts';
import { buttonVariants } from '@/components/ui/button-variants';
import { guardRoute } from '@/server/auth/web';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';

export const instant = false;

export const metadata: Metadata = {
  title: 'Your organizations',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const PAGE = '/dashboard/organization';

export default async function OrganizationsDashboardPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const view = await pageRead(serverClient(await headers(), guard.principal).organizations.mine());
  if (!view) return <LoadError {...ORGANIZATION_LOAD_ERRORS.mine} retryHref={PAGE} />;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard" className="link inline-flex min-h-11 items-center">
            Dashboard
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Your organizations</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          A federation, an association or a group of schools can apply for a page. The reviewers check the application. An approved organization’s page lists its public
          members and the schools that accepted its link; it never changes who taught whom.
        </p>

        <div className="mt-8 grid gap-8">
          {query.done === 'left' ? <OutcomeNote testId="organization-left">You are no longer an admin of that organization.</OutcomeNote> : null}

          {view.organizations.length > 0 ? (
            <ul className="grid gap-4" data-testid="my-organizations">
              {view.organizations.map((org) => (
                <li key={org.id} className="grid gap-1 border-b border-border-subtle pb-4" data-testid="my-organization" data-status={org.status}>
                  <Link href={`${PAGE}/${org.id}`} className="link inline-flex min-h-11 items-center font-display text-xl [overflow-wrap:anywhere]">
                    {org.name}
                  </Link>
                  <p className="text-sm text-fg-muted">
                    {org.kindLabel} · You: {org.roleLabel}
                  </p>
                  <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    <div className="flex gap-1.5">
                      <dt className="text-fg-muted">Approval:</dt>
                      <dd className="font-semibold">{org.approvalLabel}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="text-fg-muted">Plan:</dt>
                      <dd className="font-semibold">{org.plan.label}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ui text-fg-muted" data-testid="no-organizations">
              You do not administer an organization.
            </p>
          )}

          {view.canApply ? (
            <p>
              <Link href={`${PAGE}/apply`} className={buttonVariants({ variant: view.organizations.length > 0 ? 'secondary' : 'primary', size: 'lg' })} data-testid="organization-apply-link">
                Apply for an organization
              </Link>
            </p>
          ) : view.refusal ? (
            <p className="max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui" data-testid="organization-apply-refusal">
              {view.refusal}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
