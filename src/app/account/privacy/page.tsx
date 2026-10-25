// /account/privacy, "Privacy and consents" (milestone M07, In scope 5; plan §6.2, §6.6): whether the
// profile is public, every consent with its state and date, withdrawing an optional consent
// (consent.withdraw: a new consent_record row, audited), and asking for the account to be deleted
// (account.requestDeletion: a review case for the administrators). Data from account.privacy.
// Reads the session: rendered per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { CONSENT_LABELS } from '@/components/account/consents';
import { LoadError } from '@/components/account/load-error';
import { LOAD_ERRORS } from '@/components/account/load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { CheckIcon, DashIcon, LockIcon } from '@/components/icons';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { DeletionRequestForm, WithdrawConsentForm } from './forms';

export const instant = false;

export const metadata: Metadata = {
  title: 'Privacy and consents',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const CONSENT_TEXT: Record<string, { title: string; text: string }> = {
  age_18_plus: { title: 'Adults only', text: CONSENT_LABELS.age_18_plus },
  terms: { title: 'Terms of use', text: CONSENT_LABELS.terms },
  authenticity_declaration: { title: 'What you record', text: CONSENT_LABELS.authenticity_declaration },
  privacy_ack: { title: 'Privacy notice', text: CONSENT_LABELS.privacy_ack },
  publication: { title: 'Publication of your profile', text: 'Show my profile publicly: my names, city and confirmed links appear in search and on my page.' },
};

const STATE_TEXT = { granted: 'Given', withdrawn: 'Withdrawn', outdated: 'Given for an earlier version', never: 'Not given' } as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-4 border-t border-border-subtle pt-6">
      <h2 id={`${id}-heading`} className="font-display text-2xl">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function PrivacyPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute('/account/privacy');
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const privacy = await pageRead(serverClient(await headers(), guard.principal).account.privacy());
  if (!privacy) return <LoadError {...LOAD_ERRORS.privacy} retryHref="/account/privacy" />;
  const [withdrawPublication, withdrawPrivacy, deletion] = await Promise.all([
    readFormResult('withdraw-publication', query.outcome),
    readFormResult('withdraw-privacy_ack', query.outcome),
    readFormResult('deletion', query.outcome),
  ]);
  const isPublic = privacy.profile?.visibility === 'public';

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">Your account</p>
        <h1 className="mt-2 font-display text-feature">Privacy and consents</h1>
        <p className="mt-3 max-w-[60ch] text-fg-muted">
          What you agreed to, what is public, and how to leave. Every change here is recorded with its date, and nothing is rewritten.
        </p>

        <div className="mt-8 grid gap-10">
          <Section id="profile" title="Your profile">
            {privacy.profile ? (
              <div className="grid gap-4">
                <p className="flex items-start gap-2 text-ui">
                  {isPublic ? (
                    <>
                      <span aria-hidden="true">◎</span>
                      <span>
                        <strong className="font-semibold">Public.</strong> Your names, city and confirmed links appear in search and on your
                        page.
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
                <p className="flex flex-wrap gap-x-5 text-ui">
                  <Link href="/dashboard/profile" className="link inline-flex min-h-11 items-center">
                    Edit your profile
                  </Link>
                  {isPublic ? (
                    <Link href={`/people/${privacy.profile.slug}`} className="link inline-flex min-h-11 items-center">
                      See your public profile
                    </Link>
                  ) : null}
                </p>
              </div>
            ) : (
              <p className="text-ui text-fg-muted">
                You have no profile yet.{' '}
                <Link href="/onboarding" className="link">
                  Set it up
                </Link>{' '}
                when you are ready.
              </p>
            )}
          </Section>

          <Section id="consents" title="Your consents">
            <p className="max-w-[60ch] text-sm text-fg-muted">
              The first three are needed to keep an account: to withdraw them, ask for your account to be deleted below. The others are
              optional, and you can withdraw them here at any time.
            </p>
            <ul className="mt-4 grid border-b border-border-subtle">
              {privacy.consents.map((consent) => {
                const text = CONSENT_TEXT[consent.kind]!;
                const given = consent.state === 'granted';
                const canWithdraw = !consent.required && (given || consent.state === 'outdated' || (consent.kind === 'publication' && isPublic));
                return (
                  <li key={consent.kind} data-consent={consent.kind} className="grid gap-2 border-t border-border-subtle py-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-x-4">
                      <h3 className="text-ui font-semibold">
                        {text.title}
                        <span className="font-normal text-fg-muted">{consent.required ? ' · required' : ' · optional'}</span>
                      </h3>
                      <p data-testid={`consent-state-${consent.kind}`} className="flex items-center gap-1.5 text-sm">
                        {given ? <CheckIcon size={16} /> : <DashIcon size={16} />}
                        <span className={given ? 'font-semibold' : 'text-fg-muted'}>{STATE_TEXT[consent.state]}</span>
                        {consent.at ? <span className="text-fg-muted">· {formatDay(consent.at)}</span> : null}
                      </p>
                    </div>
                    <p className="max-w-[62ch] text-sm text-fg-muted">{text.text}</p>
                    {consent.kind === 'publication' && !canWithdraw && privacy.profile ? (
                      <p className="text-sm">
                        <Link href="/dashboard/profile" className="link inline-flex min-h-11 items-center">
                          Make your profile public in the profile editor
                        </Link>
                      </p>
                    ) : null}
                    {consent.required ? null : (
                      <WithdrawConsentForm
                        kind={consent.kind as 'publication' | 'privacy_ack'}
                        label={consent.kind === 'publication' ? 'Withdraw and make my profile private' : 'Withdraw'}
                        available={canWithdraw}
                        initial={consent.kind === 'publication' ? withdrawPublication : withdrawPrivacy}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-sm text-fg-muted">
              The documents:{' '}
              <Link href="/legal/terms" className="link">
                terms of use
              </Link>{' '}
              and{' '}
              <Link href="/legal/privacy" className="link">
                privacy notice
              </Link>
              .
            </p>
          </Section>

          <Section id="delete-account" title="Delete your account">
            <div className="grid gap-5">
              {privacy.deletionRequest ? null : (
                <div className="grid max-w-[62ch] gap-2 text-ui text-fg-muted">
                  <p>Asking for deletion sends your request to the administrators, who carry it out by hand during the pilot.</p>
                  <ul className="grid list-disc gap-1 pl-5 text-sm">
                    <li>Your sign-in, consents and profile details (names in their own script, biography, city, year) are deleted.</li>
                    <li>
                      Links that your teachers or students confirmed stay as historical records, under your name in Latin letters, until the
                      legal review of the pilot decides how long they are kept.
                    </li>
                    <li>The record of who changed what keeps ids and dates, never your names.</li>
                  </ul>
                </div>
              )}
              <DeletionRequestForm openRequest={privacy.deletionRequest} initial={deletion} />
            </div>
          </Section>
        </div>

        <p className="mt-10 border-t border-border-subtle pt-5 text-ui">
          <Link href="/account" className="link inline-flex min-h-11 items-center">
            Back to your account
          </Link>
        </p>
      </div>
    </div>
  );
}
