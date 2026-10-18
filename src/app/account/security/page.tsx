// /account/security (milestone M02, In scope 2 and 7): two-factor authentication with TOTP. Shows
// the setup (QR code, the secret as text, backup codes, the first code), or, for a session that
// has not passed the second factor, the check that staff pages require (`?next=/admin`).

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { AuthFrame } from '@/components/account/auth-frame';
import { PageRedirect } from '@/components/account/page-redirect';
import { TwoFactorState, type TwoFactorStateKind } from '@/components/account/two-factor-state';
import { safeNextPath } from '@/server/auth/guards';
import { isStaffRole } from '@/server/auth/principal';
import { guardRoute } from '@/server/auth/web';
import { serverClient } from '@/server/rpc/server';
import { TwoFactorSetup, VerifySessionForm } from './forms';

export const instant = false;

export const metadata: Metadata = {
  title: 'Security',
  robots: { index: false },
};

const NOTES = [
  {
    title: 'Why a second factor',
    text: 'A password can leak. With two-factor authentication, signing in also needs the code that changes every 30 seconds in your app.',
  },
  {
    title: 'Staff accounts',
    text: 'Moderators, archivists and administrators keep it on, and every staff session passes the second factor before it opens a staff page.',
  },
  {
    title: 'After you turn it on',
    text: 'Every other session of your account ends, so any device that was signed in signs in again with a code.',
  },
] as const;

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function SecurityPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute('/account/security');
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const next = safeNextPath(query.next, '');
  const me = await serverClient(await headers(), guard.principal).account.me();
  const staff = isStaffRole(me.user.role);
  const justEnabled = query.enabled === '1';
  const justVerified = query.verified === '1';

  let status: { state: TwoFactorStateKind; text: string };
  let body: ReactNode;
  if (!me.user.twoFactorEnabled) {
    status = { state: 'off', text: 'Two-factor authentication is off.' };
    body = <TwoFactorSetup pending={me.twoFactorSetupPending} />;
  } else if (!me.session.twoFactorVerified) {
    status = { state: 'unverified', text: 'On, but this session has not passed the second factor yet.' };
    body = (
      <div className="grid gap-4">
        <p className="max-w-[56ch] text-ui">
          {staff
            ? 'Staff pages open only in a session that has passed the second factor. Enter the current code to verify this one.'
            : 'Enter the current code to verify this session.'}
        </p>
        <VerifySessionForm next={next} />
      </div>
    );
  } else {
    status = { state: 'on', text: 'On. This session has passed the second factor.' };
    body = (
      <div className="grid gap-3 text-ui">
        {staff ? <p>Staff accounts keep two-factor authentication on.</p> : null}
        {next ? (
          <p>
            <Link href={next} className="link inline-flex min-h-11 items-center">
              Continue to the page you asked for
            </Link>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <AuthFrame eyebrow="Account" title="Security" notes={NOTES} notesLabel="About two-factor authentication">
      {justEnabled || justVerified ? (
        <p role="status" className="mb-6 flex gap-2 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-sm">
          <span aria-hidden="true" className="font-semibold">
            ✓
          </span>
          <span>
            {justEnabled
              ? 'Two-factor authentication is on. Other sessions of your account have ended.'
              : 'This session has passed the second factor.'}
          </span>
        </p>
      ) : null}
      <section aria-labelledby="two-factor-heading" className="grid gap-5">
        <div className="grid gap-1">
          <h2 id="two-factor-heading" className="font-display text-2xl">
            Two-factor authentication
          </h2>
          <p className="text-ui font-semibold">
            <TwoFactorState state={status.state}>{status.text}</TwoFactorState>
          </p>
        </div>
        {body}
      </section>
      <p className="mt-10 border-t border-border-subtle pt-5 text-ui">
        <Link href="/account" className="link inline-flex min-h-11 items-center">
          Back to your account
        </Link>
      </p>
    </AuthFrame>
  );
}
