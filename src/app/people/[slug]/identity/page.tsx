// /people/<slug>/identity (ADR 0089; specification §16.1): "This account is pretending to be me".
// A signed-in account reports a public profile that another account runs: an impostor report when
// the reporter has no profile (they say this one is theirs, and choose how to prove it), a
// duplicate when they have one (their own profile is the proof). Nothing changes for the profile
// until a moderator checks it (decision 1); no identity documents are asked for (decision 2).
// Reads the session.

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { REVIEW_LOAD_ERRORS } from '@/components/account/review-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { PersonName } from '@/components/relationships/parts';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { IDENTITY_REPORT_FORM } from './form-ids';
import { IdentityReportForm } from './report-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'This account is pretending to be me',
  robots: { index: false, follow: false },
};

type Params = Promise<{ slug: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const SLUG = /^[a-z0-9-]{1,120}$/;

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
        <h1 className="mt-2 font-display text-feature">This account is pretending to be me</h1>
        <div className="mt-8 grid gap-6">{children}</div>
      </div>
    </div>
  );
}

function Note({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <p data-testid={testId} className="max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui">
      {children}
    </p>
  );
}

export default async function IdentityReportPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug: raw } = await params;
  const slug = SLUG.test(raw) ? raw : null;
  const query = await searchParams;
  const path = slug ? `/people/${slug}/identity` : '/';
  const guard = await guardRoute(path);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const loaded = slug ? await pageRead(orMissing(serverClient(await headers(), guard.principal).identity.get({ slug }))) : 'missing';
  if (!loaded) return <LoadError {...REVIEW_LOAD_ERRORS.identity} retryHref={path} />;
  if (loaded === 'missing') {
    return (
      <Frame slug={null}>
        <Note testId="identity-not-found">This profile is not on the public record, so there is nothing to report here.</Note>
      </Frame>
    );
  }
  const option = loaded;
  const initial = await readFormResult(IDENTITY_REPORT_FORM, query.outcome);
  return (
    <Frame slug={option.person.slug}>
      <PersonName person={option.person} />
      {option.refusal ? (
        <Note testId="identity-refused">
          {option.refusal}
          {option.openCaseId ? (
            <>
              {' '}
              <Link href={`/dashboard/cases/${option.openCaseId}`} className="link">
                Open your report
              </Link>
            </>
          ) : null}
        </Note>
      ) : (
        <>
          <div className="grid max-w-[60ch] gap-3 text-ui" data-testid="identity-explainer" data-type={option.type}>
            {option.type === 'impostor' ? (
              <p>
                Tell us that this profile is yours and that another account runs it. Nothing changes for the profile until a moderator has checked your report. If they find it credible, the profile is
                held: it cannot be renamed, hidden, deleted or handed over while an administrator decides. You then have 14 days to show that you are this person, in the way you choose below.
              </p>
            ) : (
              <p>
                You have a profile of your own. Tell us that this profile copies it or pretends to be you: your own profile is the proof. A moderator checks your report first, and an administrator
                decides it. An upheld report takes the copy off the public pages.
              </p>
            )}
            <p className="text-fg-muted">We never ask for identity documents. The account that holds the profile is told what is claimed once a moderator holds it, never who reported it.</p>
          </div>
          <IdentityReportForm personId={option.person.id} slug={option.person.slug ?? ''} routes={option.routes} detailsMax={option.detailsMax} idempotencyKey={randomUUID()} initial={initial} />
        </>
      )}
    </Frame>
  );
}
