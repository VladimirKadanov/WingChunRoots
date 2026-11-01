// /admin/review/records/<slug> (milestone M10a, In scope 5; plan §6.6): the archival edit of a
// record kept by the platform or unclaimed. Only an archivist edits it (archive.update): the name
// in Latin letters, the name in its own script, the life status and the English biography, with a
// required reason and optional evidence, kept in the audit row person.update (reason, evidence_ids).
// Other reviewers read the record and are told who edits it; a record kept by its owner is never
// edited here. A non-staff account sees the explicit denied state. Reads the session.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { NameText } from '@/components/account/person-names';
import { LoadError } from '@/components/account/load-error';
import { REVIEW_LOAD_ERRORS } from '@/components/account/review-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { OutcomeNote } from '@/components/relationships/parts';
import { formatSize } from '@/lib/file-size';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { ARCHIVE_FORM } from '../../form-ids';
import { ArchiveForm } from '../../forms';

export const instant = false;

export const metadata: Metadata = {
  title: 'Archival record',
  robots: { index: false },
};

type Params = Promise<{ slug: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/** A read that answers 404 (or a malformed address): 'missing', for the page's own not-found state. */
async function orMissing<T>(read: Promise<T>): Promise<T | 'missing'> {
  try {
    return await read;
  } catch (error) {
    if (rpcErrorCode(error) === 'NOT_FOUND' || rpcErrorCode(error) === 'BAD_REQUEST') return 'missing';
    throw error;
  }
}

const SLUG = /^[a-z0-9-]{1,120}$/;

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/admin/review" className="link inline-flex min-h-11 items-center">
            Review queue
          </Link>
        </p>
        {children}
      </div>
    </div>
  );
}

export default async function ArchiveRecordPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  const query = await searchParams;
  const path = SLUG.test(slug) ? `/admin/review/records/${slug}` : '/admin/review';
  const guard = await guardRoute('/admin/review', path);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) {
    return (
      <Frame>
        <h1 className="mt-2 font-display text-feature">Not available</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted" data-testid="review-denied">
          You don&apos;t have access to the review queue. It is available to archivists, moderators and administrators.
        </p>
      </Frame>
    );
  }
  const record = await pageRead(orMissing(serverClient(await headers(), guard.principal).archive.get({ slug })));
  if (record === 'missing') {
    return (
      <Frame>
        <h1 className="mt-2 font-display text-feature">No such record</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted">No record has this address. Check the part after /people/ in the profile&apos;s address.</p>
      </Frame>
    );
  }
  if (!record) return <LoadError {...REVIEW_LOAD_ERRORS.review} retryHref={path} />;
  const initial = await readFormResult(ARCHIVE_FORM, query.outcome);
  const done = query.done === 'saved' ? 'The record is saved. The change and its reason are in the audit log.' : query.done === 'unchanged' ? 'Nothing changed, so nothing was saved.' : null;

  return (
    <Frame>
      <h1 className="mt-2 font-display text-feature">
        <NameText name={{ value: record.primaryName || record.slug, lang: 'und-Latn' }} />
      </h1>
      <p className="mt-3 flex flex-wrap gap-x-3 text-ui text-fg-muted" data-testid="record-facts">
        <span>{record.kind === 'historical' ? 'Historical record' : 'Record'}</span>
        <span>Kept by {record.stewardship === 'self' ? 'its owner' : record.stewardship === 'platform' ? 'the platform' : 'nobody (unclaimed)'}</span>
        <span>{record.visibility === 'public' ? 'Public' : 'Not public'}</span>
      </p>
      {/* It takes the focus (OutcomeNote, the M09 pattern; M10a review, screens-5). Keyed by `n`, new
          for every save (actions.ts doneAt): a second save mounts a new note, which takes the focus. */}
      {done ? (
        <div key={`${String(query.done)}-${String(query.n)}`} className="mt-5">
          <OutcomeNote testId="record-outcome">{done}</OutcomeNote>
        </div>
      ) : null}
      <div className="mt-8 grid gap-8">
        {record.files.length > 0 ? (
          <section aria-labelledby="record-evidence" className="grid gap-2">
            <h2 id="record-evidence" className="font-display text-2xl">
              Linked evidence
            </h2>
            <ul className="grid gap-1" data-testid="record-files">
              {record.files.map((file) => (
                <li key={file.id} className="flex flex-wrap items-baseline gap-x-2">
                  {file.href ? (
                    <a href={file.href} className="link inline-flex min-h-11 items-center" translate="no">
                      {file.name ?? `${file.kindLabel} file`}
                    </a>
                  ) : (
                    <span translate="no">{file.name ?? `${file.kindLabel} file`}</span>
                  )}
                  <span className="text-sm text-fg-muted">
                    {file.kindLabel} · {formatSize(file.sizeBytes)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {record.editable ? (
          <ArchiveForm record={record} initial={initial} />
        ) : (
          <p className="max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui" data-testid="archive-refusal">
            {record.refusal}
          </p>
        )}
      </div>
    </Frame>
  );
}
