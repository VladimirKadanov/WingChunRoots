// /invite/<token> (milestone M10b, In scope 2; plan §6.7): the invitation link a student had sent
// to a living teacher who is not on WingChunRoots yet. The token is the secret (32 random bytes;
// only its SHA-256 hash is stored, valid 14 days, single use): the page reads the invitation with
// invitations.get (the token in the request body, never in an API address) and, for a signed-in
// account that may, offers "Claim this profile" (invitations.accept): a review case an archivist
// decides; once approved the record becomes the account's profile and the student's request waits
// for its answer (M09). Until then nothing about it is public.
//
// An unknown or malformed token gets the same "not found" as any other: nothing tells which
// tokens exist. The page is never indexed and sends no referrer, so the token stays in the link.
// Reads the session, so the page renders per request.

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { REVIEW_LOAD_ERRORS } from '@/components/account/review-load-error-text';
import { NameText } from '@/components/account/person-names';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatDay } from '@/lib/dates';
import { getRequestPrincipal } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { AcceptForm } from './accept-form';
import { ACCEPT_FORM } from './form-ids';

export const instant = false;

export const metadata: Metadata = {
  title: 'Claim your profile',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type Params = Promise<{ token: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

async function orMissing<T>(read: Promise<T>): Promise<T | 'missing'> {
  try {
    return await read;
  } catch (error) {
    if (rpcErrorCode(error) === 'NOT_FOUND' || rpcErrorCode(error) === 'BAD_REQUEST') return 'missing';
    throw error;
  }
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">Invitation</p>
        {children}
      </div>
    </div>
  );
}

function Note({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <p data-testid={testId} className="mt-6 max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui">
      {children}
    </p>
  );
}

export default async function InvitationPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { token: raw } = await params;
  const token = TOKEN.test(raw) ? raw : '';
  const query = await searchParams;
  const principal = await getRequestPrincipal();
  const read = token ? await pageRead(orMissing(serverClient(await headers(), principal).invitations.get({ token }))) : 'missing';
  if (!read) return <LoadError {...REVIEW_LOAD_ERRORS.invitation} retryHref={`/invite/${token}`} />;
  if (read === 'missing') {
    return (
      <Frame>
        <h1 className="mt-2 font-display text-feature">Invitation not found</h1>
        <Note testId="invitation-missing">This invitation link is not valid. Check that you opened the whole link from the e-mail, or ask the person who invited you to send a new one.</Note>
      </Frame>
    );
  }
  const view = read;
  const here = `/invite/${token}`;
  const initial = await readFormResult(ACCEPT_FORM, query.outcome);

  if (view.state !== 'pending' && view.state !== 'yours') {
    return (
      <Frame>
        <h1 className="mt-2 font-display text-feature">{view.state === 'expired' ? 'Invitation expired' : view.state === 'used' ? 'Invitation used' : 'Invitation withdrawn'}</h1>
        <Note testId="invitation-closed">
          {view.state === 'expired'
            ? 'This invitation has expired. Ask the person who invited you to send a new one.'
            : view.state === 'used'
              ? 'This invitation has been used already. Each invitation works only once.'
              : 'This invitation no longer works: a newer one was sent, or the request was withdrawn. Ask the person who invited you to send a new one.'}
        </Note>
      </Frame>
    );
  }

  return (
    <Frame>
      <h1 className="mt-2 font-display text-feature">Claim your profile</h1>
      {view.studentNames && view.teacherNames ? (
        <div className="mt-3 grid max-w-[60ch] gap-3 text-ui" data-testid="invitation-summary">
          <p>
            <NameText name={view.studentNames[0]!} /> listed you as their teacher{view.lineageName ? ` in ${view.lineageName}` : ''} and invites you to claim
            the profile they started for you:
          </p>
          <p className="flex flex-wrap items-baseline gap-x-3">
            <span className="inline-flex flex-wrap items-baseline gap-x-[0.42em] font-display text-xl">
              {view.teacherNames.map((name, i) => (
                <NameText key={i} name={name} className={i === 0 ? undefined : 'text-[0.78em] text-fg-muted'} />
              ))}
            </span>
            {view.unclaimedRecord ? (
              <span className="text-sm font-semibold" data-testid="unclaimed-label">
                Unclaimed record
              </span>
            ) : null}
          </p>
          <p className="text-fg-muted">
            Nothing about this profile or the request is public. A reviewer checks your claim; after that you approve or decline the student’s request
            yourself.{view.expiresAt ? ` This link works until ${formatDay(view.expiresAt)}, and only once.` : ''}
          </p>
        </div>
      ) : null}

      <div className="mt-8 grid gap-4">
        {view.state === 'yours' ? (
          <Note testId="invitation-yours">
            You claimed this profile. {view.viewer.caseId ? (
              <Link href={`/dashboard/cases/${view.viewer.caseId}`} className="link">
                See your claim
              </Link>
            ) : null}
          </Note>
        ) : !view.viewer.signedIn ? (
          <div className="grid gap-3" data-testid="invitation-sign-in">
            <p className="max-w-[60ch] text-ui">To claim the profile, sign in. If you have no account yet, create one, confirm your e-mail address, then open this link again.</p>
            <p className="flex flex-wrap gap-3">
              <Link href={`/sign-in?next=${encodeURIComponent(here)}`} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
                Sign in to claim
              </Link>
              <Link href="/sign-up" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
                Create an account
              </Link>
            </p>
          </div>
        ) : view.viewer.refusal ? (
          <Note testId="invitation-refusal">{view.viewer.refusal}</Note>
        ) : (
          <AcceptForm token={token} idempotencyKey={randomUUID()} initial={initial} />
        )}
        <p className="max-w-[60ch] text-sm text-fg-muted">
          Read the{' '}
          <Link href="/legal/terms" className="link">
            terms of use
          </Link>{' '}
          and the{' '}
          <Link href="/legal/privacy" className="link">
            privacy notice
          </Link>
          . If you do not know this student, you can ignore the invitation: nothing is published.
        </p>
      </div>
    </Frame>
  );
}
