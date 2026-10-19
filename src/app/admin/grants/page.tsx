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

import { FormMessage } from '@/components/account/fields';
import { LoadError } from '@/components/account/load-error';
import { LOAD_ERRORS } from '@/components/account/load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { buttonVariants } from '@/components/ui/button-variants';
import { isoDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { grantHorizon, listGrantsInput } from '@/server/services/grants';
import { CLOSED_REQUEST_MESSAGE } from './form-ids';
import { CreateGrantForm, GivePlanDisclosure, PilotRequestItem } from './forms';
import { GrantsTable, hrefWith } from './grants-table';

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

/**
 * This page's address for `?next=` (review round 2, recheck-7): an administrator sent to sign in or
 * to verify the session comes back to the request being answered and the list as it was.
 */
function returnPath(query: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const key of ['request', 'q', 'sort', 'dir', 'page'] as const) {
    const value = one(query[key]);
    if (value) params.set(key, value.slice(0, 320));
  }
  const search = params.toString();
  return search ? `/admin/grants?${search}` : '/admin/grants';
}

export default async function AdminGrantsPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const guard = await guardRoute('/admin/grants', returnPath(query));
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
  // Each parameter is checked against the field of grants.list: an unknown or malformed value falls
  // back to the default instead of an error page.
  const field = listGrantsInput.shape;
  const request = valid(field.request.safeParse(one(query.request)));
  // A failed read shows the error state in the app shell, with "Try again" on the same address
  // (final check, requirements-2). Its line in the server log names neither the search nor the
  // account (security-1).
  const list = await pageRead(
    serverClient(await headers(), guard.principal).grants.list({
      q: valid(field.q.safeParse(one(query.q)?.slice(0, 320) || undefined)),
      sort: valid(field.sort.safeParse(one(query.sort))),
      dir: valid(field.dir.safeParse(one(query.dir))),
      page: valid(field.page.safeParse(one(query.page))),
      request,
    }),
  );
  if (!list) return <LoadError {...LOAD_ERRORS.grants} retryHref={returnPath(query)} />;
  const [created, revoked, closedRequest] = await Promise.all([
    readFormResult('create-grant', query.outcome),
    readFormResult('revoke-grant', query.outcome),
    readFormResult('close-request', query.outcome),
  ]);
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
        {/* Each open request has two answers: give the plan, or close it with a reason (review
            round 2, recheck-5). The section stays when none is open, to say so. */}
        <Section id="pilot-requests" title="Pilot access requests">
          {closedRequest?.status === 'done' ? <FormMessage form={CLOSED_REQUEST_MESSAGE} state={closedRequest} single /> : null}
          {list.requests.length > 0 ? (
            <ul data-testid="pilot-requests" className="grid max-w-[46rem]">
              {list.requests.map((item) => (
                <PilotRequestItem
                  key={item.id}
                  request={item}
                  back={hrefWith(list, {})}
                  initial={closedRequest?.status === 'error' && closedRequest.values?.requestId === item.id ? closedRequest : null}
                />
              ))}
            </ul>
          ) : (
            <p data-testid="no-pilot-requests" className="max-w-[56ch] text-ui text-fg-muted">
              {list.q ? 'No open pilot access request matches this search.' : 'No pilot access request is waiting for an answer.'}
            </p>
          )}
        </Section>

        <section id="give-plan" aria-labelledby="give-plan-heading" className="grid content-start gap-4 border-t border-border-subtle pt-6">
          <h2 id="give-plan-heading" className="sr-only">
            Give a test plan
          </h2>
          {/* Open when an open pilot request is being answered, and to show the outcome of a post
              without JavaScript; otherwise closed until the admin opens it. A request that is no
              longer open is said to be answered (final check, screens-4). Keyed by the request in
              the address, not by the prefill: a grant closes the request and the prefill goes away,
              but the form keeps its success message. */}
          <GivePlanDisclosure
            key={request ?? 'new'}
            openAtFirst={list.prefill !== null || created !== null}
            answeredAtFirst={Boolean(request) && list.prefill === null && created === null}
          >
            <CreateGrantForm
              plans={list.grantablePlans}
              prefill={list.prefill}
              today={isoDay(now)}
              horizon={isoDay(grantHorizon(now))}
              initial={created}
            />
          </GivePlanDisclosure>
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
