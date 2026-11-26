// /claim/<token> (role replay 2026-11-25, P2-6, ADR 0074): the claim link an organization's admin
// made for a member its import added, and passed on themself. The token is the secret (only its
// SHA-256 is stored, single use): the page reads the link with claimLinks.get (the token in the
// request body, never in an API address) and, for a signed-in account that may, offers "Claim my
// record" (claimLinks.accept): a review case the reviewers decide, exactly like a claim from a
// profile page. A link never signs anyone in and never makes the record theirs by itself.
//
// An unknown, malformed, replaced or used token, and one of a record no longer unclaimed, gets the
// same "not found": nothing tells which tokens exist. The page is never indexed, and its address
// goes to no other site. Reads the session, so the page renders per request.

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { NameText } from '@/components/account/person-names';
import { REVIEW_LOAD_ERRORS } from '@/components/account/review-load-error-text';
import { buttonVariants } from '@/components/ui/button-variants';
import { getRequestPrincipal } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { AcceptClaimLinkForm } from './accept-form';
import { ACCEPT_CLAIM_LINK_FORM } from './form-ids';

export const instant = false;

export const metadata: Metadata = {
  title: 'Claim your record',
  robots: { index: false, follow: false },
  // The token is in the address: the Referer goes only to this site (see /invite/<token>).
  referrer: 'same-origin',
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
        <p className="eyebrow">Claim link</p>
        {children}
      </div>
    </div>
  );
}

const CLAIM_STATUS_TEXT = {
  pending: 'You asked to claim this record. A reviewer is checking your claim.',
  approved: 'Your claim was approved: this is now your profile.',
  rejected: 'The reviewers refused your claim. Their reason is on your claim.',
  withdrawn: 'Your claim was closed.',
} as const;

function Note({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <p data-testid={testId} className="mt-6 max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui">
      {children}
    </p>
  );
}

export default async function ClaimLinkPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { token: raw } = await params;
  const token = TOKEN.test(raw) ? raw : '';
  const query = await searchParams;
  const principal = await getRequestPrincipal();
  const read = token ? await pageRead(orMissing(serverClient(await headers(), principal).claimLinks.get({ token }))) : 'missing';
  if (!read) return <LoadError {...REVIEW_LOAD_ERRORS.claimLink} retryHref={`/claim/${token}`} />;
  if (read === 'missing') {
    return (
      <Frame>
        <h1 className="mt-2 font-display text-feature">Claim link not found</h1>
        <Note testId="claim-link-missing">
          This claim link is not valid. Check that you opened the whole link, or ask your organization for a new one: a link works only once, and a new one replaces the
          old.
        </Note>
      </Frame>
    );
  }
  const view = read;
  const here = `/claim/${token}`;
  const initial = await readFormResult(ACCEPT_CLAIM_LINK_FORM, query.outcome);

  return (
    <Frame>
      <h1 className="mt-2 font-display text-feature">Claim your record</h1>
      <div className="mt-3 grid max-w-[60ch] gap-3 text-ui" data-testid="claim-link-summary">
        <p>
          <span className="font-semibold">{view.organizationName}</span> added you as a member and gave you this link to claim your record:
        </p>
        <p className="flex flex-wrap items-baseline gap-x-3">
          <NameText name={view.name} className="font-display text-xl" />
          <span className="text-sm font-semibold">Unclaimed record</span>
        </p>
        <p className="text-fg-muted">
          Nothing about this record is public. A reviewer checks your claim first; once it is approved the record becomes your profile, and you choose what to
          show.
        </p>
      </div>

      <div className="mt-8 grid gap-4">
        {view.state === 'yours' ? (
          <p data-testid="claim-link-yours" data-claim-status={view.viewer.claimStatus ?? 'unknown'} className="mt-6 max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui">
            {CLAIM_STATUS_TEXT[view.viewer.claimStatus ?? 'pending']}{' '}
            {view.viewer.caseId ? (
              <Link href={`/dashboard/cases/${view.viewer.caseId}`} className="link">
                See your claim
              </Link>
            ) : null}
          </p>
        ) : !view.viewer.signedIn ? (
          <div className="grid gap-3" data-testid="claim-link-sign-in">
            <p className="max-w-[60ch] text-ui">
              To claim the record, sign in. If you have no account yet, create one: once you have confirmed your e-mail address and signed in, you come back here
              to claim it.
            </p>
            <p className="flex flex-wrap gap-3">
              <Link href={`/sign-in?next=${encodeURIComponent(here)}`} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
                Sign in to claim
              </Link>
              <Link href={`/sign-up?next=${encodeURIComponent(here)}`} className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
                Create an account
              </Link>
            </p>
          </div>
        ) : view.viewer.refusal ? (
          <Note testId="claim-link-refusal">
            {view.viewer.refusal}
            {view.viewer.confirmDocuments ? (
              <>
                {' '}
                <Link href={`/onboarding?next=${encodeURIComponent(here)}`} className="link">
                  Confirm the documents
                </Link>
              </>
            ) : null}
          </Note>
        ) : (
          <AcceptClaimLinkForm token={token} idempotencyKey={randomUUID()} initial={initial} />
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
          . If this is not you, you can ignore the link and tell the organization: nothing is published.
        </p>
      </div>
    </Frame>
  );
}
