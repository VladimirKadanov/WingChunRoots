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
      <p className="mt-3 max-w-[56ch] text-fg-muted">The review and moderation tools arrive in later milestones of the pilot.</p>
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
      <p className="mt-8 border-t border-border-subtle pt-5 text-ui">
        <Link href="/account" className="link inline-flex min-h-11 items-center">
          Back to your account
        </Link>
      </p>
    </Column>
  );
}
