// /account (milestone M02): the signed-in account and its own person. The data comes from the
// account.me and account.twoFactor procedures (the same ones /api/v1 serves). Reads the session,
// so the page renders per request (instant = false, docs/adr/0004-auth.md).
//
// M08 adds the unread count of the notifications to the dashboard link. It is a convenience, not
// what the page is for: it is read with pageRead(), and when that read fails (a lock on the
// notification table past the statement timeout, say) the link simply leaves the count out and the
// page renders as it did before M08 (M08 polish, note 1; plan §5.6).
//
// Since the usability review of 2026-11 it is the overview of Settings: the heading says so, the
// address signed in comes right under it, and the sections (profile, sign-in and security, plan and
// billing, notifications, privacy) are listed as rows with a line each, under the same section row
// (SettingsNav) as every settings page. The profile summary, the account's register, its other
// places (organizations, administration) and signing out follow, signing out last.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PageRedirect } from '@/components/account/page-redirect';
import { NameLine, NameList } from '@/components/account/person-names';
import { SETTINGS_SECTIONS, SettingsNav, type SettingsSection } from '@/components/account/settings-nav';
import { TwoFactorState, type TwoFactorStateKind } from '@/components/account/two-factor-state';
import { AlertIcon, ArrowRightIcon, LockIcon } from '@/components/icons';
import { LegalLinks } from '@/components/legal/legal-links';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { isStaffRole } from '@/server/auth/principal';
import { guardRoute } from '@/server/auth/web';
import { documentsFor } from '@/server/legal/documents';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { SignOutForm } from '@/components/account/sign-out-form';
import { signOutAction } from './actions';

export const instant = false;

export const metadata: Metadata = {
  title: 'Settings',
  robots: { index: false },
};

/** The one line under each section of the overview. Overview itself is this page. */
const SECTION_LINES: Record<Exclude<SettingsSection, 'overview'>, { title: string; text: string }> = {
  profile: { title: 'Profile', text: 'Your names, how they are written, and whether your profile is public.' },
  security: { title: 'Sign-in and security', text: 'Your password and sign-in address, two-factor authentication and your other devices.' },
  plan: { title: 'Plan and billing', text: 'Student or Sifu, the plan in effect, and billing and invoices.' },
  notifications: { title: 'Notification settings', text: 'Which notices also come to you by e-mail.' },
  privacy: { title: 'Privacy', text: 'Your consents, what is public, and deleting your account.' },
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
      {/* The whole account waits on this, so it comes first. */}
      {changed.length > 0 ? (
        <div className="max-w-[46rem]">
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
              <Link href="/onboarding?next=%2Faccount" className="link inline-flex min-h-11 items-center font-semibold">
                Read and confirm
              </Link>
            </p>
          </div>
        </div>
      ) : null}

      <SettingsNav current="overview" className="mb-8" />
      <div className="max-w-[46rem]">
        <p className="eyebrow">Your account</p>
        <h1 className="mt-2 font-display text-feature">Settings</h1>
        {/* "Am I signed in?" is answered first, in words (usability review 2026-11). */}
        <p data-testid="signed-in-as" className="mt-3 text-ui text-fg-muted [overflow-wrap:anywhere]">
          Signed in as{' '}
          <strong className="font-semibold text-fg" translate="no">
            {me.user.email}
          </strong>
        </p>

        {/* M08: teachers, requests, schools, notifications and the plan; with the unread count (review round 1, design-7). */}
        <p className="mt-5">
          <Link href="/dashboard" data-testid="open-dashboard" className={buttonVariants({ variant: 'secondary' })}>
            Open your dashboard{unread > 0 ? ` (${unread} unread)` : ''}
            <ArrowRightIcon />
          </Link>
        </p>

        <ul aria-label="Settings sections" data-testid="settings-sections" className="mt-8 border-t border-border-subtle">
          {SETTINGS_SECTIONS.filter((section) => section.key !== 'overview').map((section) => {
            const line = SECTION_LINES[section.key as Exclude<SettingsSection, 'overview'>];
            return (
              <li key={section.key} className="border-b border-border-subtle">
                <Link href={section.href} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-3 hover:bg-surface-2">
                  <span className="grid gap-0.5">
                    <span className="text-ui font-semibold text-fg">{line.title}</span>
                    <span className="text-sm text-fg-muted">{line.text}</span>
                    {section.key === 'security' ? (
                      <span className="mt-1 text-sm">
                        <TwoFactorState state={twoFactor.kind}>Two-factor: {twoFactor.text}</TwoFactorState>
                      </span>
                    ) : null}
                  </span>
                  <ArrowRightIcon className="text-fg-muted" />
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-10 grid gap-10">
          <Section id="profile-heading" title="Profile">
            {me.person && primary ? (
              <div className="grid gap-5">
                <p data-testid="account-name" className="text-2xl [overflow-wrap:anywhere]">
                  <NameLine primary={primary.value} original={original} />
                </p>
                {/* The Latin-script name is the line above; the other spellings are listed here. */}
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
                {/* M07: the profile editor. */}
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
                  <Link href="/onboarding?next=%2Faccount" className={cx(buttonVariants({ variant: 'primary', size: 'lg' }))}>
                    Set up your profile
                    <ArrowRightIcon />
                  </Link>
                </div>
              </div>
            )}
          </Section>

          <Section id="account-heading" title="Account">
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
              {tf.status === 'pending' ? (
                <Link href="/account/security" className={buttonVariants({ variant: 'secondary' })}>
                  Finish the two-factor setup
                </Link>
              ) : null}
              {/* M15: the organizations this account administers, and the application. */}
              <Link href="/dashboard/organization" className={buttonVariants({ variant: 'secondary' })} data-testid="account-organizations">
                Organizations
              </Link>
              {staff ? (
                <Link href="/admin" className={buttonVariants({ variant: 'secondary' })}>
                  Administration
                </Link>
              ) : null}
            </div>
          </Section>

          {/* Signing out comes last, on its own, away from the links above. */}
          <div className="border-t border-border-subtle pt-6">
            <SignOutForm action={signOutAction} />
          </div>
          <LegalLinks className="-mx-1.5" />
        </div>
      </div>
    </div>
  );
}
