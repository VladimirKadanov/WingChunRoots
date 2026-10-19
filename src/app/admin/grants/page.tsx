// /admin/grants (milestone M08, In scope 3; plan §6.5): administrators give and revoke test plans
// of the pilot, each with a reason, a start and an end, audited as grant.create and grant.revoke.
// Open "Request pilot access" requests are listed first; "Give …" opens the form, filled in. The
// form waits behind a "Give a test plan…" disclosure, so the table of grants, the page's main
// content, sits near the top (review round 1, design-6). Guarded by
// requireStaff2FA(['admin']): an administrator whose session passed the second factor (others are
// told plainly, or sent to verify the session). The data and both actions go through the
// grants.list, grants.create and grants.revoke procedures (the same ones /api/v1 serves).
// DEFAULT D06/D08: revoking never touches a confirmed link.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PageRedirect } from '@/components/account/page-redirect';
import { ChevronDownIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { formatDay, isoDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { serverClient } from '@/server/rpc/server';
import { grantHorizon, listGrantsInput } from '@/server/services/grants';
import { CreateGrantForm } from './forms';
import { GrantsTable } from './grants-table';

export const instant = false;

export const metadata: Metadata = {
  title: 'Plan grants',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : undefined);
const valid = <T,>(result: { success: true; data: T } | { success: false }): T | undefined => (result.success ? result.data : undefined);

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="grid content-start gap-4 border-t border-border-subtle pt-6">
      <h2 id={`${id}-heading`} className="font-display text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function AdminGrantsPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute('/admin/grants');
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) {
    return (
      <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
        <div className="max-w-[46rem]">
          <p className="eyebrow">Administration</p>
          <h1 className="mt-2 font-display text-feature">Not available</h1>
          <p className="mt-3 max-w-[56ch] text-fg-muted">You don&apos;t have access to plan grants. They are available to administrators.</p>
          <p className="mt-8 border-t border-border-subtle pt-5 text-ui">
            <Link href="/account" className="link inline-flex min-h-11 items-center">
              Back to your account
            </Link>
          </p>
        </div>
      </div>
    );
  }
  const query = await searchParams;
  // Each parameter is checked against the field of grants.list: an unknown or malformed value falls
  // back to the default instead of an error page.
  const field = listGrantsInput.shape;
  const request = valid(field.request.safeParse(one(query.request)));
  const list = await serverClient(await headers(), guard.principal).grants.list({
    q: valid(field.q.safeParse(one(query.q)?.slice(0, 320) || undefined)),
    sort: valid(field.sort.safeParse(one(query.sort))),
    dir: valid(field.dir.safeParse(one(query.dir))),
    page: valid(field.page.safeParse(one(query.page))),
    request,
  });
  const [created, revoked] = await Promise.all([readFormResult('create-grant', query.outcome), readFormResult('revoke-grant', query.outcome)]);
  const now = new Date();

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <header className="max-w-[46rem]">
        <p className="eyebrow">Administration</p>
        <h1 className="mt-2 font-display text-feature">Plan grants</h1>
        <p className="mt-3 max-w-[60ch] text-fg-muted">
          Give a test plan of the pilot to an account, or revoke one. There are no payments in the pilot. Every grant and revocation is
          kept in the audit log with its reason; confirmed links never change.
        </p>
      </header>

      <div className="mt-8 grid gap-10">
        {list.requests.length > 0 ? (
          <Section id="pilot-requests" title="Pilot access requests">
            <ul data-testid="pilot-requests" className="grid max-w-[46rem]">
              {list.requests.map((item) => (
                <li key={item.id} className="grid gap-1 border-b border-border-subtle py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-4">
                  <span className="grid gap-0.5">
                    <span translate="no" className="font-semibold [overflow-wrap:anywhere]">
                      {item.email}
                    </span>
                    <span className="text-sm text-fg-muted">
                      {item.planName} · asked on {formatDay(item.createdAt)}
                    </span>
                  </span>
                  <Link href={`/admin/grants?request=${item.id}#give-plan`} className="link inline-flex min-h-11 items-center text-ui">
                    Give {item.planName}
                    <span className="sr-only"> to {item.email}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <section id="give-plan" aria-labelledby="give-plan-heading" className="grid content-start gap-4 border-t border-border-subtle pt-6">
          <h2 id="give-plan-heading" className="sr-only">
            Give a test plan
          </h2>
          {/* Open when a pilot request is being answered, and to show the outcome of a post without
              JavaScript; otherwise closed until the admin opens it. */}
          <details open={Boolean(request) || created !== null || undefined} className="group max-w-[46rem]">
            <summary
              data-testid="give-plan-toggle"
              className={cx(buttonVariants({ variant: 'secondary', size: 'lg' }), 'cursor-pointer list-none [&::-webkit-details-marker]:hidden')}
            >
              Give a test plan…
              <ChevronDownIcon size={18} className="transition-transform duration-(--duration-fast) group-open:rotate-180" />
            </summary>
            <div className="pt-4">
              {/* Keyed by the request in the address, not by the prefill: a grant closes the request and
                  the prefill goes away, but the form keeps its success message. */}
              <CreateGrantForm
                key={request ?? 'new'}
                plans={list.grantablePlans}
                prefill={list.prefill}
                today={isoDay(now)}
                horizon={isoDay(grantHorizon(now))}
                initial={created}
              />
            </div>
          </details>
        </section>

        <Section id="grants" title="Grants">
          <form role="search" action="/admin/grants" method="get" className="flex max-w-[34rem] flex-wrap items-end gap-3">
            <div className="grid min-w-0 flex-1 gap-1.5">
              <label htmlFor="grants-q" className="text-sm font-semibold">
                Find by e-mail
              </label>
              <input
                id="grants-q"
                name="q"
                type="search"
                defaultValue={list.q}
                maxLength={320}
                autoComplete="off"
                spellCheck={false}
                translate="no"
                className="block min-h-12 w-full min-w-0 rounded-sm border border-border-strong bg-surface-1 px-4 text-field text-fg hover:border-fg-muted focus-visible:border-fg"
              />
            </div>
            <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
              Search
            </button>
            {list.q ? (
              <Link href="/admin/grants" className="link inline-flex min-h-12 items-center text-ui">
                Show all
              </Link>
            ) : null}
          </form>
          <GrantsTable list={list} revoked={revoked} />
        </Section>

        <p className="border-t border-border-subtle pt-5 text-ui">
          <Link href="/admin" className="link inline-flex min-h-11 items-center">
            Back to administration
          </Link>
        </p>
      </div>
    </div>
  );
}
