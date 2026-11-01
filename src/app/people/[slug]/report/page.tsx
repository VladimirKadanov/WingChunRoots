// /people/<slug>/report (milestone M10b, In scope 4; plan §6.2): "Report profile". A signed-in
// account reports a public profile for one of four reasons, with optional details
// (reports.create): a review case for the moderators. One report per account and profile, ever;
// a report hides nothing by itself (no automatic hiding: the milestone's Out of scope). A profile
// that is not public, or the account's own, is not reported here. Reads the session.

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { REVIEW_LOAD_ERRORS } from '@/components/account/review-load-error-text';
import { NameText } from '@/components/account/person-names';
import { PageRedirect } from '@/components/account/page-redirect';
import { OutcomeNote } from '@/components/relationships/parts';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { REPORT_REASON_LABELS } from '@/server/templates/review';
import { REPORT_FORM } from './form-ids';
import { ReportForm } from './report-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'Report profile',
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
        <h1 className="mt-2 font-display text-feature">Report profile</h1>
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

export default async function ReportProfilePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug: raw } = await params;
  const slug = SLUG.test(raw) ? raw : null;
  const query = await searchParams;
  const path = slug ? `/people/${slug}/report` : '/';
  const guard = await guardRoute(path);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const client = serverClient(await headers(), guard.principal);
  const loaded = slug ? await pageRead(Promise.all([orMissing(client.people.get({ slug })), client.reports.mine()])) : (['missing', { reports: [] }] as const);
  if (!loaded) return <LoadError {...REVIEW_LOAD_ERRORS.report} retryHref={path} />;
  const [profile, mine] = loaded;
  if (profile === 'missing' || profile.visibility !== 'public' || profile.limited) {
    return (
      <Frame slug={null}>
        <Note testId="report-not-found">This profile is not on the public record, so there is nothing to report here.</Note>
      </Frame>
    );
  }
  const reported = mine.reports.find((r) => r.personId === profile.id);
  const initial = await readFormResult(REPORT_FORM, query.outcome);
  return (
    <Frame slug={profile.slug}>
      <p className="font-display text-xl">
        <NameText name={{ value: profile.displayName, lang: 'und-Latn' }} />
      </p>
      {query.sent === '1' && reported ? (
        <OutcomeNote testId="report-sent">Thank you. Your report was sent to the moderators. A report hides nothing by itself; they check the profile and correct it where needed.</OutcomeNote>
      ) : profile.isOwn ? (
        <Note testId="report-own">
          This is your own profile. Correct it in{' '}
          <Link href="/dashboard/profile" className="link">
            Your profile
          </Link>{' '}
          instead.
        </Note>
      ) : reported ? (
        <Note testId="report-already">You have already reported this profile ({reported.reasonLabel.toLowerCase()}). The moderators have your report.</Note>
      ) : (
        <>
          <p className="max-w-[60ch] text-ui text-fg-muted">
            Tell the moderators what is wrong with this profile. Each account can report a profile once. The person is not told who reported it.
          </p>
          <ReportForm
            personId={profile.id}
            slug={profile.slug}
            reasons={Object.entries(REPORT_REASON_LABELS).map(([value, label]) => ({ value, label }))}
            idempotencyKey={randomUUID()}
            initial={initial}
          />
        </>
      )}
    </Frame>
  );
}
