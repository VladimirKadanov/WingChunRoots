// /dashboard/students/invite (role replay 2026-11-25, P1-3): a Sifu's invite link for their
// students, /join/<slug>, as text to copy and as a QR code to print or show on a phone. A student
// who opens it signs up (or in), sets up their profile and lands on the request form with this
// teacher chosen; the teacher confirms the request as any other (Student requests). The link is the
// public profile's address under /join, so it works only while the profile is public, and it needs
// no secret: it says nothing a public profile does not. The QR modules are computed on the server
// (src/server/auth/totp.ts), so the encoder never ships to the browser.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { PageRedirect } from '@/components/account/page-redirect';
import { QrCode } from '@/components/account/qr-code';
import { ArrowRightIcon } from '@/components/icons';
import { PublishProfileForm } from '@/components/relationships/forms';
import { buttonVariants } from '@/components/ui/button-variants';
import { appUrl } from '@/server/auth/env';
import { qrModules } from '@/server/auth/totp';
import { guardRoute } from '@/server/auth/web';
import { serverClient } from '@/server/rpc/server';
import { showProfilePubliclyAction } from '../../teachers/actions';

export const instant = false;

export const metadata: Metadata = {
  title: 'Invite your students',
  robots: { index: false },
};

const PAGE = '/dashboard/students/invite';

function Note({ testId, children }: { testId: string; children: React.ReactNode }) {
  return (
    <div data-testid={testId} className="grid justify-items-start gap-3 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-4 text-ui">
      {children}
    </div>
  );
}

export default async function InviteStudentsPage() {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const client = serverClient(await headers(), guard.principal);
  const [me, mine] = await Promise.all([client.account.me(), client.plans.mine()]);
  const own = me.person;
  const link = own ? new URL(`/join/${own.slug}`, appUrl()).toString() : null;
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="grid max-w-[46rem] gap-6">
        <p className="eyebrow max-lg:hidden print:hidden">
          <Link href="/dashboard/students/requests" className="link inline-flex min-h-11 items-center">
            Student requests
          </Link>
        </p>
        <h1 className="font-display text-feature">Invite your students</h1>
        {mine.accountType !== 'sifu' ? (
          <Note testId="invite-needs-sifu">
            <p>Invite links are for teachers: a Sifu account confirms its students. Your account is a Student account.</p>
            <Link href="/account/plan" className={buttonVariants({ variant: 'secondary' })}>
              Plan and billing
              <ArrowRightIcon />
            </Link>
          </Note>
        ) : !own ? (
          <Note testId="invite-needs-profile">
            <p>Your students find you by your profile, so set it up first.</p>
            <Link href={`/onboarding?${new URLSearchParams({ next: PAGE })}`} className={buttonVariants({ variant: 'primary' })}>
              Set up your profile
              <ArrowRightIcon />
            </Link>
          </Note>
        ) : own.visibility !== 'public' ? (
          <Note testId="invite-needs-public">
            <p>The link opens your public profile, and your profile is private. Show it publicly and the link works from then on.</p>
            {/* Journey review 2026-11-26 (P2-3): the choice right here, not one page away. */}
            <PublishProfileForm action={showProfilePubliclyAction} page="invite" />
          </Note>
        ) : null}
        {link && mine.accountType === 'sifu' && own?.visibility === 'public' ? (
          <section aria-labelledby="invite-link-heading" className="grid gap-4" data-testid="invite-link">
            <p className="max-w-[60ch] text-ui text-fg-muted">
              Share this link with your students, or print this page for your school. A student who opens it creates an account, adds their name and sends you
              a request with you already chosen. You confirm each request in Student requests, as always.
            </p>
            <h2 id="invite-link-heading" className="font-display text-2xl">
              Your invite link
            </h2>
            <label htmlFor="invite-link-text" className="text-sm font-semibold">
              Link
            </label>
            <input
              id="invite-link-text"
              readOnly
              value={link}
              translate="no"
              className="block min-h-12 w-full rounded-sm border border-border-strong bg-surface-1 px-4 text-field text-fg"
              data-testid="invite-link-text"
            />
            <QrCode qr={qrModules(link)} label="QR code of your invite link" />
            <p className="text-sm text-fg-muted">Scan it with a phone camera: it opens the same link.</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
