// /admin/review (milestone M10a, In scope 4 and 5; plan §5.6, §6.6, §6.7): the review queue.
// Archivists, moderators and administrators whose session passed the second factor see the open
// cases (review.list), filtered by kind, status and assignee, oldest first; each opens its case
// card (/admin/review/<id>). The archival edit starts here too: a record's address (its slug)
// opens it at /admin/review/records/<slug>. A signed-in account without a staff role sees the
// explicit denied state (plan §5.6); a staff session without the second factor is sent to verify.
//
// The filters are a plain GET form and the state is in the URL, so the page works without
// JavaScript and ships none of its own. Reads the session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { REVIEW_LOAD_ERRORS } from '@/components/account/review-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { buttonVariants } from '@/components/ui/button-variants';
import { guardRoute } from '@/server/auth/web';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { ReviewListInput } from '@/server/services/review';
import { ReviewTable } from './review-table';

export const instant = false;

export const metadata: Metadata = {
  title: 'Review queue',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value.slice(0, 40) : undefined);

const selectClass = 'block min-h-12 w-full rounded-sm border border-border-strong bg-surface-1 px-4 text-field text-fg';

function returnPath(query: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const key of ['kind', 'status', 'assigned', 'sort', 'page'] as const) {
    const value = one(query[key]);
    if (value) params.set(key, value);
  }
  const search = params.toString();
  return search ? `/admin/review?${search}` : '/admin/review';
}

export default async function ReviewQueuePage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const guard = await guardRoute('/admin/review', returnPath(query));
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) {
    return (
      <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
        <div className="max-w-[46rem]" data-testid="review-denied">
          <p className="eyebrow">Administration</p>
          <h1 className="mt-2 font-display text-feature">Not available</h1>
          <p className="mt-3 max-w-[56ch] text-fg-muted">
            You don&apos;t have access to the review queue. It is available to archivists, moderators and administrators.
          </p>
          <p className="mt-8 border-t border-border-subtle pt-5 text-ui">
            <Link href="/account" className="link inline-flex min-h-11 items-center">
              Back to your account
            </Link>
          </p>
        </div>
      </div>
    );
  }
  // An unknown or malformed parameter falls back to its default in the service (review.list).
  const input = {
    kind: one(query.kind) || undefined,
    status: one(query.status) || undefined,
    assigned: one(query.assigned) || undefined,
    sort: one(query.sort) || undefined,
    page: one(query.page) || undefined,
  } as ReviewListInput;
  const client = serverClient(await headers(), guard.principal);
  const list = await pageRead(client.review.list(input).catch(() => client.review.list({})));
  if (!list) return <LoadError {...REVIEW_LOAD_ERRORS.review} retryHref={returnPath(query)} />;
  const archivist = guard.principal?.user.role === 'archivist';

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <header className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/admin" className="link inline-flex min-h-11 items-center">
            Administration
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Review queue</h1>
        <p className="mt-3 max-w-[60ch] text-fg-muted">
          Claims that wait for a decision, oldest first. Take a case to open its evidence; an archivist or an administrator verifies or refuses a
          historical teacher claim. Every decision is kept in the audit log.
        </p>
      </header>

      <div className="mt-8 grid gap-10">
        <form method="get" action="/admin/review" role="search" aria-label="Filter the queue" className="grid gap-4 rounded-sm border border-border-subtle p-4" data-testid="queue-filters">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <label htmlFor="filter-kind" className="text-sm font-semibold">
                Kind
              </label>
              <select id="filter-kind" name="kind" defaultValue={list.filters.kind ?? ''} className={selectClass}>
                <option value="">Any kind</option>
                {list.kinds.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="filter-status" className="text-sm font-semibold">
                Status
              </label>
              <select id="filter-status" name="status" defaultValue={list.filters.status} className={selectClass}>
                {list.statuses.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="filter-assigned" className="text-sm font-semibold">
                Assigned to
              </label>
              <select id="filter-assigned" name="assigned" defaultValue={list.filters.assigned} className={selectClass}>
                <option value="any">Anyone</option>
                <option value="me">Me</option>
                <option value="none">Nobody yet</option>
              </select>
            </div>
          </div>
          {list.filters.sort !== 'oldest' ? <input type="hidden" name="sort" value={list.filters.sort} /> : null}
          <div>
            <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
              Show cases
            </button>
          </div>
        </form>

        <ReviewTable list={list} />

        <section aria-labelledby="archive-heading" className="grid gap-3 border-t border-border-subtle pt-6">
          <h2 id="archive-heading" className="font-display text-2xl">
            Archival records
          </h2>
          <p className="max-w-[60ch] text-ui text-fg-muted">
            {archivist
              ? 'Correct a record kept by the platform or unclaimed, with a reason and optional evidence. Enter the record’s address: the part after /people/.'
              : 'Archivists correct records kept by the platform or unclaimed. You can open a record to read it.'}
          </p>
          <form method="get" action="/admin/review/records" className="grid gap-3 sm:max-w-[34rem]" data-testid="record-lookup">
            <label htmlFor="record-slug" className="text-sm font-semibold">
              Record address
            </label>
            <input id="record-slug" name="slug" autoComplete="off" maxLength={120} pattern="[a-z0-9\-]+" className={selectClass} />
            <div>
              <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
                Open the record
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
