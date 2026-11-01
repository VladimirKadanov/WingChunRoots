// /admin (milestone M02, In scope 7): a placeholder for the staff tools of later milestones,
// guarded by requireStaff2FA() (a staff role and a session that passed the second factor; other
// staff sessions are sent to /account/security). It shows only the number of failed e-mail
// deliveries, from the admin.overview procedure; a member, or anyone without a session, never
// gets that part of the page (it is not rendered, not hidden).

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PageRedirect } from '@/components/account/page-redirect';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { serverClient } from '@/server/rpc/server';

export const instant = false;

export const metadata: Metadata = {
  title: 'Administration',
  robots: { index: false },
};

/** The page's column: the heading, the text and the rules have the same width in every state. */
function Column({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">{children}</div>
    </div>
  );
}

export default async function AdminPage() {
  const guard = await guardRoute('/admin');
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) {
    return (
      <Column>
        <p className="eyebrow">Staff</p>
        <h1 className="mt-2 font-display text-feature">Not available</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted">This page is for moderators, archivists and administrators.</p>
        <p className="mt-8 border-t border-border-subtle pt-5 text-ui">
          <Link href="/account" className="link inline-flex min-h-11 items-center">
            Back to your account
          </Link>
        </p>
      </Column>
    );
  }
  const overview = await serverClient(await headers(), guard.principal).admin.overview();
  const failed = overview.failedEmailDeliveries;
  return (
    <Column>
      <p className="eyebrow">Staff</p>
      <h1 className="mt-2 font-display text-feature">Administration</h1>
      <p className="mt-3 max-w-[56ch] text-fg-muted">Historical teacher claims and archival edits are in the review queue. Moderation tools arrive in a later milestone of the pilot.</p>
      {/* M10a: the review queue, for every staff role. */}
      <p className="mt-5">
        <Link href="/admin/review" className={buttonVariants({ variant: 'primary' })} data-testid="review-queue-link">
          Review queue
        </Link>
      </p>
      <dl className="mt-8 grid gap-1 border-t border-border-subtle pt-5">
        <dt className="text-sm text-fg-muted">Failed e-mail deliveries</dt>
        <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span data-testid="failed-email-deliveries" className="font-display text-hero leading-none">
            {failed}
          </span>
          <span className="text-ui">
            {failed === 0
              ? 'None: every e-mail was delivered or is still being sent.'
              : `${failed === 1 ? 'One e-mail' : `${failed} e-mails`} could not be delivered. The details arrive with the review tools.`}
          </span>
        </dd>
      </dl>
      {/* M07: open account deletion requests, for administrators (docs/guides/admin-guide.bg.md). */}
      {guard.principal?.user.role === 'admin' ? (
        <section id="deletion-requests" aria-labelledby="deletion-requests-heading" className="mt-8 scroll-mt-4 border-t border-border-subtle pt-5">
          <h2 id="deletion-requests-heading" className="font-display text-2xl">
            Account deletion requests
          </h2>
          {overview.deletionRequests.length === 0 ? (
            <p className="mt-3 text-ui text-fg-muted">None open. When a member asks for their account to be deleted, the request appears here and you get a notification.</p>
          ) : (
            <>
              <p className="mt-3 max-w-[60ch] text-sm text-fg-muted">
                Carry each request out as the administration guide describes: delete the account&apos;s data and keep the links others
                confirmed as historical records until the legal review.
              </p>
              <ul className="mt-4 grid border-b border-border-subtle">
                {overview.deletionRequests.map((request) => (
                  <li key={request.caseId} data-deletion-request={request.caseId} className="grid gap-1 border-t border-border-subtle py-3 text-ui">
                    <p className="flex flex-wrap items-baseline gap-x-3">
                      {request.person ? (
                        <Link href={`/people/${request.person.slug}`} className="link font-semibold" lang={request.person.lang} translate="no">
                          {request.person.displayName}
                        </Link>
                      ) : (
                        <span className="font-semibold">An account without a profile</span>
                      )}
                      {request.accountEmail ? (
                        <span translate="no" className="text-sm text-fg-muted [overflow-wrap:anywhere]">
                          {request.accountEmail}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-fg-muted">
                      Asked on {formatDay(request.openedAt)} · {request.status === 'open' ? 'Open' : request.status === 'in_review' ? 'In review' : 'Needs information'} · case{' '}
                      <span translate="no" className="font-mono">
                        {request.caseId}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : null}
      {/* M08: the administrators' tool for test plans. */}
      {guard.principal?.user.role === 'admin' ? (
        <div className="mt-8 grid justify-items-start gap-2 border-t border-border-subtle pt-5">
          <Link href="/admin/grants" className={buttonVariants({ variant: 'secondary' })}>
            Plan grants
          </Link>
          <p className="text-sm text-fg-muted">Give and revoke test plans of the pilot, and answer pilot access requests.</p>
        </div>
      ) : null}
      <p className="mt-8 border-t border-border-subtle pt-5 text-ui">
        <Link href="/account" className="link inline-flex min-h-11 items-center">
          Back to your account
        </Link>
      </p>
    </Column>
  );
}
