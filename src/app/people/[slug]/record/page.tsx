// /people/<slug>/record (milestone M25, In scope 3; specification §16.1): a shared archival
// record's change history and "Propose a correction". A record kept by the archive or unclaimed is
// shared: no school or organization edits it alone. Anyone reads its change history (the date, the
// kind of change and the fields it changed; never who made it or the reason); a signed-in account
// proposes a change, which an archivist approves or rejects with a reason (records.propose).
// Reads the session.

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { REVIEW_LOAD_ERRORS } from '@/components/account/review-load-error-text';
import { OutcomeNote } from '@/components/relationships/parts';
import { formatDay } from '@/lib/dates';
import { getRequestPrincipal } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { PROPOSE_FORM } from './form-ids';
import { ProposeForm } from './propose-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'Record history',
  robots: { index: false, follow: false },
};

type Params = Promise<{ slug: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const SLUG = /^[a-z0-9-]{1,120}$/;

async function orRefused<T>(read: Promise<T>): Promise<T | 'missing' | 'not-shared'> {
  try {
    return await read;
  } catch (error) {
    const code = rpcErrorCode(error);
    if (code === 'NOT_FOUND' || code === 'BAD_REQUEST') return 'missing';
    if (code === 'FORBIDDEN') return 'not-shared';
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
        <h1 className="mt-2 font-display text-feature">Record history</h1>
        <div className="mt-8 grid gap-8">{children}</div>
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

export default async function RecordPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug: raw } = await params;
  const slug = SLUG.test(raw) ? raw : null;
  const query = await searchParams;
  const path = slug ? `/people/${slug}/record` : '/';
  const principal = await getRequestPrincipal();
  const client = serverClient(await headers(), principal);
  const loaded = slug
    ? await pageRead(Promise.all([orRefused(client.records.history({ slug })), principal ? orRefused(client.records.proposeOptions({ slug })) : Promise.resolve('signed-out' as const)]))
    : (['missing', 'missing'] as const);
  if (!loaded) return <LoadError {...REVIEW_LOAD_ERRORS.record} retryHref={path} />;
  const [history, options] = loaded;
  if (history === 'missing' || history === 'not-shared') {
    return (
      <Frame slug={null}>
        <Note testId="record-not-shared">This is not a shared archival record. A profile kept by its own person is corrected by them.</Note>
      </Frame>
    );
  }
  const initial = await readFormResult(PROPOSE_FORM, query.outcome);
  return (
    <Frame slug={history.slug}>
      {query.sent === '1' ? (
        <OutcomeNote testId="record-sent">
          Your proposal was sent to the archivists. Nothing on the record changes until they approve it; you get a notification when they decide.
        </OutcomeNote>
      ) : null}
      <p className="max-w-[60ch] text-ui text-fg-muted">
        This record is kept by the archive for everyone. No school or organization changes it alone: a correction is proposed with a reason, and an
        archivist approves or rejects it. Every change is kept below.
      </p>

      <section aria-labelledby="record-history" className="grid gap-3" data-testid="record-history">
        <h2 id="record-history" className="font-display text-2xl">
          Changes
        </h2>
        {history.revisions.length === 0 ? (
          <p className="text-sm text-fg-muted" data-testid="record-history-empty">
            No change has been made to this record since its history began.
          </p>
        ) : (
          <ol className="grid gap-2 text-sm">
            {history.revisions.map((r) => (
              <li key={r.id} data-source={r.source}>
                {formatDay(r.createdAt)} · <span className="font-semibold">{r.sourceLabel}</span> · {r.changed.join(', ')}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="record-propose" className="grid gap-4 border-t border-border-subtle pt-6">
        <h2 id="record-propose" className="font-display text-2xl">
          Propose a correction
        </h2>
        {options === 'signed-out' ? (
          <p className="text-sm">
            <Link href={`/sign-in?next=${encodeURIComponent(path)}`} className="link inline-flex min-h-11 items-center">
              Sign in to propose a correction
            </Link>
          </p>
        ) : options === 'missing' || options === 'not-shared' ? (
          <Note testId="record-no-proposal">This record cannot take a proposal now.</Note>
        ) : options.pendingCaseId ? (
          <Note testId="record-pending">
            Your proposal for this record waits for the archivists.{' '}
            <Link href={`/dashboard/cases/${options.pendingCaseId}`} className="link">
              Open the case
            </Link>
          </Note>
        ) : (
          <ProposeForm
            record={{
              personId: options.personId,
              slug: options.slug,
              primaryName: options.fields.primaryName,
              originalName: options.fields.originalName,
              originalLang: options.fields.originalLang,
              lifeStatus: options.fields.lifeStatus,
              bio: options.fields.bio,
              scripts: options.scripts,
            }}
            idempotencyKey={randomUUID()}
            initial={initial}
          />
        )}
      </section>
    </Frame>
  );
}
