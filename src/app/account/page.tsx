// /account (milestone M02): the signed-in account and its own person. The data comes from the
// account.me and account.twoFactor procedures (the same ones /api/v1 serves). Reads the session,
// so the page renders per request (instant = false, docs/adr/0004-auth.md).
//
// M08 adds the unread count of the notifications to the dashboard link. It is a convenience, not
// what the page is for: it is read with pageRead(), and when that read fails (a lock on the
// notification table past the statement timeout, say) the link simply leaves the count out and the
// page renders as it did before M08 (M08 polish, note 1; plan §5.6).

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
import { pageRead } from '@/server/rpc/form';
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
  const [me, tf, notifications] = await Promise.all([client.account.me(), client.account.twoFactor(), pageRead(client.notifications.list())]);
  // null when the read failed: serverClient() has logged it in one safe line; the link goes without the count.
  const unread = notifications?.unread ?? 0;
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
              {/* "There is", whatever the title's number ("terms of use" is plural; fix round 3, screens-7). */}
              {changed.length === 1 ? `There is a new version of the ${changed[0]!.title.toLowerCase()}` : 'There are new versions of the documents'}
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

        {/* Without a profile the heading itself says "Your account". */}
        <p className="eyebrow">{primary ? 'Your account' : 'Signed in'}</p>
        <h1 className="mt-2 text-feature [overflow-wrap:anywhere]">
          {primary ? <NameLine primary={primary.value} original={original} /> : <span className="font-display">Your account</span>}
        </h1>

        {/* M08: teachers, requests, schools, notifications and the plan; with the unread count (review round 1, design-7). */}
        <p className="mt-5">
          <Link href="/dashboard" data-testid="open-dashboard" className={buttonVariants({ variant: 'secondary' })}>
            Open your dashboard{unread > 0 ? ` (${unread} unread)` : ''}
            <ArrowRightIcon />
          </Link>
        </p>

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
                {/* M07: the profile editor and the privacy page. */}
                <div>
                  <Link href="/dashboard/profile" className={buttonVariants({ variant: 'secondary' })}>
                    Edit your profile
                  </Link>
                </div>
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
              {/* M07: consents and account deletion. */}
              <Link href="/account/privacy" className={buttonVariants({ variant: 'secondary' })}>
                Privacy and consents
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
