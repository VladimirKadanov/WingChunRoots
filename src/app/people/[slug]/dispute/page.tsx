// /people/<slug>/dispute (milestone M25, In scope 2; specification §16.1): "Report a lineage
// error". A signed-in account reports that one public relationship of a public profile is wrong,
// with the grounds, details and evidence (disputes.report): a review case for the moderators. A
// report changes nothing by itself and no status moves at an accusation; a moderator who upholds
// it sets the relationship "under review" (in arbitration). The people involved never learn who
// reported. Reads the session.

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { REVIEW_LOAD_ERRORS } from '@/components/account/review-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { OutcomeNote, PersonName } from '@/components/relationships/parts';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { LINEAGE_REPORT_GROUND_LABELS } from '@/server/templates/review';
import { DisputeForm } from './dispute-form';
import { DISPUTE_FORM } from './form-ids';

export const instant = false;

export const metadata: Metadata = {
  title: 'Report a lineage error',
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
        <h1 className="mt-2 font-display text-feature">Report a lineage error</h1>
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

export default async function DisputePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug: raw } = await params;
  const slug = SLUG.test(raw) ? raw : null;
  const query = await searchParams;
  const path = slug ? `/people/${slug}/dispute` : '/';
  const guard = await guardRoute(path);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const client = serverClient(await headers(), guard.principal);
  const loaded = slug ? await pageRead(orMissing(client.disputes.relationships({ slug }))) : 'missing';
  if (loaded === null) return <LoadError {...REVIEW_LOAD_ERRORS.dispute} retryHref={path} />;
  if (loaded === 'missing') {
    return (
      <Frame slug={null}>
        <Note testId="dispute-not-found">This profile is not on the public record, so there is nothing to report here.</Note>
      </Frame>
    );
  }
  const open = loaded.relationships.filter((r) => !r.reported && r.status === 'verified');
  const initial = await readFormResult(DISPUTE_FORM, query.outcome);
  return (
    <Frame slug={loaded.slug}>
      {query.sent === '1' ? (
        <OutcomeNote testId="dispute-sent">
          Thank you. Your report was sent to the moderators with its evidence. A report changes nothing by itself: they check it and decide, with a
          reason. The people involved are not told who reported.
        </OutcomeNote>
      ) : null}
      <p className="max-w-[60ch] text-ui text-fg-muted">
        If a public teaching relationship on this profile is wrong, tell the moderators and show them why. Nothing changes while they look at it. A
        report that is not upheld counts against no one.
      </p>
      {loaded.relationships.length > 0 ? (
        <ul className="grid gap-3" data-testid="dispute-relationships">
          {loaded.relationships.map((r) => (
            <li key={r.id} className="grid gap-0.5 text-sm" data-status={r.status}>
              <span>
                {r.role === 'teacher' ? 'Student: ' : 'Teacher: '}
                <PersonName person={r.other} className="text-sm" /> · {r.lineageName}
              </span>
              {r.status === 'in_arbitration' ? (
                <span className="font-semibold">Under review by the moderators</span>
              ) : r.reported ? (
                <span className="font-semibold">You reported this; the moderators have your report</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {open.length === 0 ? (
        <Note testId="dispute-nothing">There is no public relationship here that you can report now.</Note>
      ) : (
        <DisputeForm
          slug={loaded.slug}
          relationships={open.map((r) => ({ value: r.id, label: `${r.role === 'teacher' ? 'Student' : 'Teacher'}: ${r.other.name.value} (${r.lineageName})` }))}
          grounds={Object.entries(LINEAGE_REPORT_GROUND_LABELS).map(([value, label]) => ({ value, label }))}
          idempotencyKey={randomUUID()}
          initial={initial}
        />
      )}
    </Frame>
  );
}
