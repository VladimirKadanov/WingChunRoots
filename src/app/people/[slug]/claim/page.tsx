// /people/<slug>/claim (ADR 0040): "Is this you? Ask to claim this profile". A signed-in account
// without a profile of its own asks the reviewers to make a public, unclaimed record of a living
// person its own (claims.request): the same review case of kind person_claim an invitation's claim
// opens, decided by an archivist or an administrator. claims.get says beforehand whether the record
// can be claimed and whether this account can claim it now, in plain words. A visitor is sent to
// sign in first and comes back here (landingPath skips onboarding for this page, which would make
// the account a profile of its own). Reads the session; no client module (claim-form.tsx). An
// account that has not confirmed the current documents is told so, without a link: /onboarding
// treats only an invitation as a claim, and would offer to make a profile instead (ADR 0040).

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { NameText } from '@/components/account/person-names';
import { PageRedirect } from '@/components/account/page-redirect';
import { REVIEW_LOAD_ERRORS } from '@/components/account/review-load-error-text';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { ClaimForm } from './claim-form';
import { CLAIM_FORM } from './form-ids';

export const instant = false;

export const metadata: Metadata = {
  title: 'Ask to claim this profile',
  robots: { index: false, follow: false },
};

type Params = Promise<{ slug: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

async function orMissing<T>(read: Promise<T>): Promise<T | 'missing'> {
  try {
    return await read;
  } catch (error) {
    if (rpcErrorCode(error) === 'NOT_FOUND' || rpcErrorCode(error) === 'BAD_REQUEST') return 'missing';
    throw error;
  }
}

function Frame({ slug, children }: { slug: string | null; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          {slug ? (
            <Link href={`/people/${slug}`} className="link inline-flex min-h-11 items-center">
              Back to the profile
            </Link>
          ) : (
            'Profile'
          )}
        </p>
        <h1 className="mt-2 font-display text-feature">Ask to claim this profile</h1>
        <div className="mt-8 grid gap-6">{children}</div>
      </div>
    </div>
  );
}

function Note({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className="grid max-w-[60ch] gap-2 rounded-sm bg-surface-2 px-4 py-4 text-ui">
      {children}
    </div>
  );
}

export default async function ClaimProfilePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug: raw } = await params;
  const slug = SLUG.test(raw) && raw.length <= 120 ? raw : null;
  const query = await searchParams;
  const path = slug ? `/people/${slug}/claim` : '/';
  const guard = await guardRoute(path);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const client = serverClient(await headers(), guard.principal);
  const loaded = slug ? await pageRead(Promise.all([orMissing(client.people.get({ slug })), orMissing(client.claims.get({ slug }))])) : (['missing', 'missing'] as const);
  if (!loaded) return <LoadError {...REVIEW_LOAD_ERRORS.claim} retryHref={path} />;
  const [profile, option] = loaded;
  if (profile === 'missing' || option === 'missing' || profile.visibility !== 'public' || profile.limited) {
    return (
      <Frame slug={null}>
        <Note testId="claim-not-found">
          <p>This profile is not on the public record, so there is nothing to claim here.</p>
        </Note>
      </Frame>
    );
  }
  const initial = await readFormResult(CLAIM_FORM, query.outcome);
  const caseLink = (id: string, label: string) => (
    <Link href={`/dashboard/cases/${id}`} prefetch={false} className="link inline-flex min-h-11 items-center" data-testid="claim-case-link">
      {label}
    </Link>
  );
  return (
    <Frame slug={profile.slug}>
      <p className="font-display text-xl">
        <NameText name={{ value: profile.displayName, lang: 'und-Latn' }} />
      </p>
      {!option.claimable ? (
        <Note testId="claim-not-claimable">
          <p>{option.recordRefusal}</p>
        </Note>
      ) : option.viewer.waitingHere && option.viewer.waitingCaseId ? (
        <Note testId="claim-waiting-here">
          <p>You have already asked to claim this profile. The reviewers have your claim.</p>
          <p>{caseLink(option.viewer.waitingCaseId, 'Follow your claim')}</p>
        </Note>
      ) : option.viewer.refusal ? (
        <Note testId="claim-refusal">
          <p>{option.viewer.refusal}</p>
          {option.viewer.waitingCaseId ? <p>{caseLink(option.viewer.waitingCaseId, 'Follow that claim')}</p> : null}
        </Note>
      ) : (
        <>
          <div className="grid max-w-[60ch] gap-3 text-ui text-fg-muted" data-testid="claim-explainer">
            <p>
              If this profile is about you, you can ask for it to become yours. Then you can keep it up to date yourself, answer your students’ requests and choose
              whether it is shown publicly.
            </p>
            <ul className="grid list-disc gap-1 pl-5">
              <li>A reviewer checks every claim before anything changes. Until then the profile stays as it is.</li>
              <li>They may ask you for evidence, such as a certificate or a photo from your school. You answer on the claim’s page.</li>
              <li>You can have one open claim at a time, and an account can have one profile.</li>
            </ul>
          </div>
          <ClaimForm personId={option.personId} slug={profile.slug} idempotencyKey={randomUUID()} initial={initial} />
        </>
      )}
    </Frame>
  );
}
