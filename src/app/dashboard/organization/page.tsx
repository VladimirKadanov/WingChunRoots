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
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { leaveForm } from './tools-form-ids';
import { ToolButton } from './tools-forms';
import { PersonName } from '@/components/relationships/parts';

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
  const client = serverClient(await headers(), guard.principal);
  const [view, own] = await Promise.all([pageRead(client.organizations.mine()), pageRead(client.organizationTools.memberships())]);
  if (!view || !own) return <LoadError {...ORGANIZATION_LOAD_ERRORS.mine} retryHref={PAGE} />;
  const memberships = await Promise.all(own.memberships.map(async (m) => ({ ...m, initial: await readFormResult(leaveForm(m.id), query.outcome) })));

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
          {query.done === 'membership-left' ? (
            <OutcomeNote testId="organization-membership-left">You left the organization. Your profile, teachers and students did not change; its admins were told.</OutcomeNote>
          ) : null}

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

          {/* M24: the account's own memberships and the separation rules (DEFAULT M24 question 9). */}
          {memberships.length > 0 ? (
            <section aria-labelledby="memberships" id="memberships" className="grid gap-4 border-t border-border-subtle pt-6" data-testid="my-memberships">
              <h2 id="memberships" className="font-display text-2xl">
                Your memberships
              </h2>
              <ul className="grid max-w-[62ch] gap-1 text-sm text-fg-muted" data-testid="separation-rules">
                <li>{own.rules.decides}</li>
                <li>{own.rules.goes}</li>
                <li>{own.rules.stays}</li>
                <li>{own.rules.told}</li>
              </ul>
              <ul className="grid gap-4">
                {memberships.map((m) => (
                  <li key={m.id} className="grid gap-1 border-b border-border-subtle pb-4" data-testid="my-membership" data-current={m.current}>
                    {m.organization.public ? (
                      <Link href={`/organizations/${m.organization.slug}`} className="link inline-flex min-h-11 items-center font-display text-xl [overflow-wrap:anywhere]">
                        {m.organization.name}
                      </Link>
                    ) : (
                      <span className="font-display text-xl [overflow-wrap:anywhere]">{m.organization.name}</span>
                    )}
                    <p className="text-sm text-fg-muted">
                      {m.organization.kindLabel} · {m.roleLabel}
                      {m.startsOn ? ` · since ${formatDay(m.startsOn)}` : ''}
                      {m.endsOn ? ` · ended ${formatDay(m.endsOn)}` : ''}
                    </p>
                    {m.recorded ? (
                      <p className="text-sm">
                        <span className="text-fg-muted">The organization records: </span>
                        {[m.recorded.rank, m.recorded.city].filter(Boolean).join(' · ')}
                      </p>
                    ) : null}
                    {m.claims.map((c) => (
                      <p key={c.id} className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
                        <span className="text-fg-muted">{c.statusLabel}:</span>
                        {c.teacher ? <PersonName person={c.teacher} className="text-sm" /> : <span>a removed profile</span>}
                        {c.startYear ? <span className="text-fg-muted">since {c.startYear}</span> : null}
                      </p>
                    ))}
                    {m.current ? (
                      <ToolButton
                        kind="leave"
                        formId={leaveForm(m.id)}
                        hidden={{ membershipId: m.id }}
                        label="Leave this organization"
                        pendingLabel="Leaving…"
                        initial={m.initial}
                        testId="my-membership-leave"
                        context={m.organization.name}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

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
