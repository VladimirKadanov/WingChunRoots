// /admin/archive (milestone M26, docs/adr/0034-archive-editor.md): the archive editor's home. Every
// lineage with its root and how many links it has, a new lineage, the record search (public or not,
// a plain GET form) and a new historical record. For an archivist or an administrator whose session
// passed the second factor (guardRoute('/admin/archive')); others are told plainly. Each read and
// change goes through an archiveEditor procedure (the same ones /api/v1 serves). Reads the session.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { NameText } from '@/components/account/person-names';
import { LoadError } from '@/components/account/load-error';
import { ARCHIVE_LOAD_ERROR } from '@/components/account/load-errors/archive';
import { PageRedirect } from '@/components/account/page-redirect';
import { OutcomeNote } from '@/components/relationships/parts';
import { buttonVariants } from '@/components/ui/button-variants';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { LINEAGE_CREATE_FORM, RECORD_CREATE_FORM } from './form-ids';
import { CreateLineageForm, CreateRecordForm } from './forms';
import { RecordLine } from './parts';

export const instant = false;

export const metadata: Metadata = {
  title: 'Archive editor',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const SLUG = /^[a-z0-9-]{1,120}$/;
const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

function Column({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">{children}</div>;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="grid content-start gap-4 border-t border-border-subtle pt-6">
      <h2 id={`${id}-heading`} className="font-display text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function ArchiveEditorPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const q = one(query.q).trim().slice(0, 200);
  const back = SLUG.test(one(query.back)) ? one(query.back) : '';
  const guard = await guardRoute('/admin/archive', q ? `/admin/archive?q=${encodeURIComponent(q)}` : '/admin/archive');
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) {
    return (
      <Column>
        <div className="max-w-[46rem]">
          <p className="eyebrow">Archive editor</p>
          <h1 className="mt-2 font-display text-feature">Not available</h1>
          <p className="mt-3 max-w-[56ch] text-fg-muted" data-testid="archive-denied">
            You don&apos;t have access to the archive editor. It is available to archivists and administrators.
          </p>
          <p className="mt-8 border-t border-border-subtle pt-5 text-ui">
            <Link href="/admin" className="link inline-flex min-h-11 items-center">
              Back to administration
            </Link>
          </p>
        </div>
      </Column>
    );
  }
  const client = serverClient(await headers(), guard.principal);
  const [data, found] = await Promise.all([pageRead(client.archiveEditor.lineages()), q ? pageRead(client.archiveEditor.search({ q })) : Promise.resolve({ records: [] })]);
  if (!data || !found) return <LoadError {...ARCHIVE_LOAD_ERROR} retryHref="/admin/archive" />;
  const [lineageResult, recordResult] = await Promise.all([readFormResult(LINEAGE_CREATE_FORM, query.outcome), readFormResult(RECORD_CREATE_FORM, query.outcome)]);
  const created = query.done === 'record' && SLUG.test(one(query.record)) ? one(query.record) : null;

  return (
    <Column>
      <header className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/admin" className="link inline-flex min-h-11 items-center">
            Administration
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Archive editor</h1>
        <p className="mt-3 max-w-[60ch] text-fg-muted">
          Create lineages and the records of historical teachers, and record the links between them with their sources. A record stays off the
          public pages until one of its links is verified; a record whose life status is not known stays off them until a death is established.
          Every change needs a reason and is kept in the audit log.
        </p>
      </header>
      {created ? (
        <div key={`${String(query.done)}-${String(query.n)}`} className="mt-5 max-w-[46rem]">
          <OutcomeNote testId="archive-outcome">
            The record is created, with the address <code translate="no">{created}</code>. It is not public yet: add a link to show it.{' '}
            <Link href={`/admin/review/records/${created}`} className="link">
              Open the record
            </Link>
            {back ? (
              <>
                {' · '}
                <Link href={`/admin/archive/lineages/${back}?q=${encodeURIComponent(created)}#add-link`} className="link">
                  Back to the lineage
                </Link>
              </>
            ) : null}
          </OutcomeNote>
        </div>
      ) : null}

      <div className="mt-8 grid gap-10">
        <Section id="lineages" title="Lineages">
          {data.lineages.length > 0 ? (
            <ul className="grid max-w-[52rem]" data-testid="archive-lineages">
              {data.lineages.map((l) => (
                <li key={l.id} className="grid gap-1 border-b border-border-subtle py-3" data-lineage={l.slug}>
                  <Link href={`/admin/archive/lineages/${l.slug}`} className="link inline-flex min-h-11 items-center font-semibold">
                    {l.name}
                  </Link>
                  <span className="text-sm text-fg-muted">
                    {l.root ? (
                      <>
                        Root: <NameText name={l.root.name} />
                      </>
                    ) : (
                      'Root not known'
                    )}
                    {' · '}
                    {l.links === 1 ? '1 link' : `${l.links} links`}
                    {' · '}
                    {l.listed ? 'In the explorer' : 'Not in the explorer yet'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="max-w-[56ch] text-ui text-fg-muted" data-testid="archive-no-lineages">
              No lineage yet. Create the first one below, then add its records and links.
            </p>
          )}
        </Section>

        <Section id="new-lineage" title="New lineage">
          <p className="max-w-[60ch] text-ui text-fg-muted">
            The explorer lists a lineage once its root record and at least one of its links are public. You can set the root now or later.
          </p>
          <div className="max-w-[46rem]">
            <CreateLineageForm initial={lineageResult} />
          </div>
        </Section>

        <Section id="find" title="Find a record">
          <form method="get" action="/admin/archive#find" className="flex max-w-[40rem] flex-wrap items-end gap-3" role="search">
            <div className="grid min-w-0 flex-1 gap-1.5">
              <label htmlFor="archive-search" className="text-ui font-semibold">
                Name or address
              </label>
              <input id="archive-search" name="q" type="search" defaultValue={q} maxLength={200} autoComplete="off" className="min-h-12 rounded-sm border border-border bg-surface px-3 text-ui" />
            </div>
            <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
              Search
            </button>
          </form>
          <p className="max-w-[60ch] text-sm text-fg-muted">Finds every record by any spelling of a name (Latin letters, Chinese characters, Jyutping, pinyin), public or not.</p>
          {q ? (
            found.records.length > 0 ? (
              <ul className="grid max-w-[52rem]" data-testid="archive-search-results">
                {found.records.map((r) => (
                  <RecordLine key={r.id} record={r} />
                ))}
              </ul>
            ) : (
              <p className="text-ui" data-testid="archive-search-empty">
                No record matches. Create it below.
              </p>
            )
          ) : null}
        </Section>

        <Section id="new-record" title="New historical record">
          <div className="max-w-[46rem]">
            <CreateRecordForm scripts={data.options.scripts} back={back || undefined} initial={recordResult} />
          </div>
        </Section>
      </div>
    </Column>
  );
}
