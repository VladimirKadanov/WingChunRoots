// /account (milestone M02): the signed-in account and its own person. The data comes from the
// account.me and account.twoFactor procedures (the same ones /api/v1 serves). Reads the session,
// so the page renders per request (instant = false, docs/adr/0004-auth.md).

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PageRedirect } from '@/components/account/page-redirect';
import { NameLine, NameList } from '@/components/account/person-names';
import { TwoFactorState, type TwoFactorStateKind } from '@/components/account/two-factor-state';
import { AlertIcon, ArrowRightIcon, LockIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { isStaffRole } from '@/server/auth/principal';
import { guardRoute } from '@/server/auth/web';
import { documentsFor } from '@/server/legal/documents';
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

function Row({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <>
      <dt className="pt-3 text-sm text-fg-muted sm:border-t sm:border-border-subtle sm:pb-3">{label}</dt>
      <dd className={cx('border-b border-border-subtle pb-3 text-ui sm:border-t sm:border-b-0 sm:pt-3', className)}>{children}</dd>
    </>
  );
}

export default async function AccountPage() {
  const guard = await guardRoute('/account');
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const client = serverClient(await headers(), guard.principal);
  const [me, tf] = await Promise.all([client.account.me(), client.account.twoFactor()]);
  const names = me.person?.names ?? [];
  const primary = names.find((name) => name.isPrimary);
  const original = names.find((name) => !name.isPrimary && name.kind !== 'romanization');
  const changed = documentsFor(me.missingConsents);
  const staff = isStaffRole(me.user.role);

  const twoFactor: { kind: TwoFactorStateKind; text: string } =
    tf.status === 'off'
      ? { kind: 'off', text: 'Off' }
      : tf.status === 'pending'
        ? { kind: 'pending', text: 'Setup not finished' }
        : tf.sessionVerified
          ? { kind: 'on', text: 'On' }
          : { kind: 'unverified', text: 'On, not yet verified in this session' };

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        {/* The whole account waits on this, so it comes first. */}
        {changed.length > 0 ? (
          <div role="status" className="mb-8 grid gap-1 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-ui">
            <p className="flex items-start gap-2 font-semibold">
              <AlertIcon size={18} className="mt-0.5" />
              {changed.length === 1 ? `The ${changed[0]!.title.toLowerCase()} has a new version` : 'The documents have new versions'}
            </p>
            <ul className="grid gap-0.5 pl-6.5 text-sm text-fg-muted">
              {changed.map((document) => (
                <li key={document.id}>
                  {document.title}, draft of {document.date}: {document.changes}
                </li>
              ))}
            </ul>
            <p className="pl-6.5">
              <Link href="/onboarding" className="link inline-flex min-h-11 items-center font-semibold">
                Read and confirm
              </Link>
            </p>
          </div>
        ) : null}

        <p className="eyebrow">Your account</p>
        <h1 className="mt-2 text-feature [overflow-wrap:anywhere]">
          {primary ? <NameLine primary={primary.value} original={original} /> : <span className="font-display">Your account</span>}
        </h1>

        <div className="mt-8 grid gap-10">
          <Section id="profile-heading" title="Profile">
            {me.person ? (
              <div className="grid gap-5">
                {/* The Latin-script name is the heading above; the other spellings are listed here. */}
                {names.some((name) => !name.isPrimary) ? <NameList names={names.filter((name) => !name.isPrimary)} /> : null}
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
              <Row label="E-mail" className="[overflow-wrap:anywhere]">
                <span translate="no">{me.user.email}</span>
              </Row>
              <Row label="Role">{ROLE_LABELS[me.user.role]}</Row>
              <Row label="Two-factor">
                <TwoFactorState state={twoFactor.kind}>{twoFactor.text}</TwoFactorState>
              </Row>
            </dl>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/account/security" className={buttonVariants({ variant: 'secondary' })}>
                {tf.status === 'pending' ? 'Finish the two-factor setup' : 'Security settings'}
              </Link>
              {staff ? (
                <Link href="/admin" className={buttonVariants({ variant: 'secondary' })}>
                  Administration
                </Link>
              ) : null}
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
