// /account (milestone M02): the signed-in account and its own person. The data comes from the
// account.me procedure (the same one /api/v1/account/me serves). Reads the session, so the page
// renders per request (instant = false, docs/adr/0004-auth.md).

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PageRedirect } from '@/components/account/page-redirect';
import { NameList, NameText } from '@/components/account/person-names';
import { ArrowRightIcon, LockIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { guardRoute } from '@/server/auth/web';
import { serverClient } from '@/server/rpc/server';
import { signOutAction } from './actions';

export const instant = false;

export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false },
};

const ROLE_LABELS = { user: 'Member', moderator: 'Moderator', archivist: 'Archivist', admin: 'Administrator' } as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-border-subtle pt-6">
      <h2 id={id} className="font-display text-2xl">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function AccountPage() {
  const guard = await guardRoute('/account');
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const me = await serverClient(await headers()).account.me();
  const primary = me.person?.names.find((name) => name.isPrimary);

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">Your account</p>
        <h1 className="mt-2 font-display text-feature [overflow-wrap:anywhere]">{primary ? <NameText name={primary} /> : 'Your account'}</h1>

        <div className="mt-8 grid gap-10">
          <Section id="profile-heading" title="Profile">
            {me.person ? (
              <div className="grid gap-5">
                <NameList names={me.person.names} />
                <p className="flex items-start gap-2 text-ui">
                  {me.person.visibility === 'public' ? (
                    <>
                      <span aria-hidden="true">◎</span>
                      <span>
                        <strong className="font-semibold">Public.</strong> Anyone can see your names and confirmed links.
                      </span>
                    </>
                  ) : (
                    <>
                      <LockIcon size={18} className="mt-0.5 shrink-0" />
                      <span>
                        <strong className="font-semibold">Private.</strong> Only the people involved in a link and the reviewers can see
                        your profile.
                      </span>
                    </>
                  )}
                </p>
                <p className="text-sm text-fg-muted">Editing names and visibility arrives in a later version of the pilot.</p>
              </div>
            ) : (
              <div className="grid gap-4">
                <p className="max-w-[56ch] text-ui text-fg-muted">
                  Your profile is not set up yet. Add your name so teachers and students can find and confirm you.
                </p>
                <div>
                  <Link href="/onboarding" className={cx(buttonVariants({ variant: 'primary', size: 'lg' }))}>
                    Set up your profile
                    <ArrowRightIcon />
                  </Link>
                </div>
              </div>
            )}
          </Section>

          <Section id="sign-in-heading" title="Sign-in and security">
            <dl className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[10rem_minmax(0,1fr)]">
              <dt className="pt-3 text-sm text-fg-muted sm:border-t sm:border-border-subtle sm:pb-3">E-mail</dt>
              <dd className="border-b border-border-subtle pb-3 text-ui [overflow-wrap:anywhere] sm:border-t sm:border-b-0 sm:pt-3">
                {me.user.email}
              </dd>
              <dt className="pt-3 text-sm text-fg-muted sm:border-t sm:border-border-subtle sm:pb-3">Role</dt>
              <dd className="border-b border-border-subtle pb-3 text-ui sm:border-t sm:border-b-0 sm:pt-3">{ROLE_LABELS[me.user.role]}</dd>
              <dt className="pt-3 text-sm text-fg-muted sm:border-t sm:border-border-subtle sm:pb-3">Two-factor</dt>
              <dd className="border-b border-border-subtle pb-3 text-ui sm:border-t sm:border-b-0 sm:pt-3">
                {me.user.twoFactorEnabled ? '✓ On' : '– Off'}
              </dd>
            </dl>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/account/security" className={buttonVariants({ variant: 'secondary' })}>
                Security settings
              </Link>
              <form action={signOutAction}>
                <button type="submit" className={buttonVariants({ variant: 'ghost' })}>
                  Sign out
                </button>
              </form>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
