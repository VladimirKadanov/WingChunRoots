// /admin/archive (milestone M26, docs/adr/0034-archive-editor.md; control panel 2026-11,
// docs/adr/0035-control-panel.md): the archive editor's home, the table of lineages. The archive's
// figures, every lineage with its root, people, generations, sourced share and last edit, searched
// and sorted on the server (a plain GET form and links), and "New lineage" (?new=lineage opens the
// form). Records are kept in /admin/archive/people. For an archivist or an administrator whose
// session passed the second factor (guardRoute('/admin/archive')); others are told plainly. Each
// read and change goes through an archiveEditor procedure (the same ones /api/v1 serves). Reads the
// session.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { NameText } from '@/components/account/person-names';
import { LoadError } from '@/components/account/load-error';
import { ARCHIVE_LOAD_ERROR } from '@/components/account/load-errors/archive';
import { PageRedirect } from '@/components/account/page-redirect';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatShortDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { LINEAGE_SORTS } from '@/server/services/archive-grids';
import { LINEAGE_CREATE_FORM } from './form-ids';
import { CreateLineageForm } from './forms';
import { CardLabel, cell, Column, fieldClass, Figure, Header, Missing, number, rowClass, SortHeader, tableClass, theadClass } from './grid-parts';

export const instant = false;

export const metadata: Metadata = {
  title: 'Lineages · Archive editor',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;
type Sort = (typeof LINEAGE_SORTS)[number];

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

function href(q: string, sort: Sort, extra = '') {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (sort !== 'name') params.set('sort', sort);
  const search = params.toString();
  return `/admin/archive${search ? `?${search}` : ''}${extra}`;
}

const withNew = (to: string) => `${to}${to.includes('?') ? '&' : '?'}new=lineage#new-lineage`;

export default async function ArchiveEditorPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const q = one(query.q).trim().slice(0, 200);
  const sort: Sort = (LINEAGE_SORTS as readonly string[]).includes(one(query.sort)) ? (one(query.sort) as Sort) : 'name';
  const guard = await guardRoute('/admin/archive', href(q, sort));
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
  const data = await pageRead(client.archiveEditor.overview({ q: q || undefined, sort }));
  if (!data) return <LoadError {...ARCHIVE_LOAD_ERROR} retryHref="/admin/archive" />;
  const lineageResult = await readFormResult(LINEAGE_CREATE_FORM, query.outcome);
  const creating = one(query.new) === 'lineage' || lineageResult?.status === 'error';
  const sortLabel = { name: 'by name', people: 'most people first', links: 'most links first', sourced: 'least sourced first', edited: 'last edited first' }[sort];

  return (
    <Column wide>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-[46rem]">
          <p className="eyebrow">Archive</p>
          <h1 className="mt-2 font-display text-feature">Lineages</h1>
          <p className="mt-2 max-w-[64ch] text-sm text-fg-muted">
            Open a lineage to work on its tree and its links. A record stays off the public pages until one of its links is verified; every change needs a
            reason and is kept in the audit log.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/admin/archive/people" className={buttonVariants({ variant: 'secondary' })}>
            People &amp; records
          </Link>
          <Link href={withNew(href(q, sort))} className={buttonVariants({ variant: 'primary' })} data-testid="new-lineage-link">
            <span aria-hidden="true">+</span> New lineage
          </Link>
        </div>
      </header>

      <section aria-label="Archive figures" className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3" data-testid="archive-figures">
        <Figure label="Lineages" value={data.figures.lineages} />
        <Figure label="People on record" value={data.figures.people} href="/admin/archive/people" />
        <Figure label="Links" value={data.figures.links} note="Verified or in arbitration" />
        <Figure label="Need work" value={data.figures.needsWork} note="Links without a source or years" href={href(q, 'sourced')} />
      </section>

      {creating ? (
        <section id="new-lineage" aria-labelledby="new-lineage-heading" className="mt-8 grid max-w-[52rem] gap-4 rounded-md border border-border-strong bg-surface-1 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="new-lineage-heading" className="font-display text-2xl">
              New lineage
            </h2>
            <Link href={href(q, sort)} className="link inline-flex min-h-11 items-center text-ui">
              Close
            </Link>
          </div>
          <p className="max-w-[60ch] text-ui text-fg-muted">
            The explorer lists a lineage once its root record and at least one of its links are public. You can set the root now or later.
          </p>
          <CreateLineageForm initial={lineageResult} />
        </section>
      ) : null}

      <section id="lineages" aria-labelledby="lineages-heading" className="mt-8 grid gap-4">
        <h2 id="lineages-heading" className="sr-only">
          All lineages
        </h2>
        <form role="search" method="get" action="/admin/archive#lineages" className="flex flex-wrap items-end gap-3">
          <div className="grid min-w-0 flex-1 basis-[18rem] gap-1.5">
            <label htmlFor="lineage-q" className="text-sm font-semibold">
              Find a lineage
            </label>
            <input id="lineage-q" name="q" type="search" defaultValue={q} maxLength={200} autoComplete="off" className={fieldClass} />
          </div>
          <div className="grid min-w-0 basis-[14rem] gap-1.5">
            <label htmlFor="lineage-sort" className="text-sm font-semibold">
              Order
            </label>
            <select id="lineage-sort" name="sort" defaultValue={sort} className={fieldClass}>
              <option value="name">By name</option>
              <option value="people">Most people first</option>
              <option value="links">Most links first</option>
              <option value="sourced">Least sourced first</option>
              <option value="edited">Last edited first</option>
            </select>
          </div>
          <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
            Show
          </button>
          {q || sort !== 'name' ? (
            <Link href="/admin/archive#lineages" className="link inline-flex min-h-12 items-center text-ui">
              Clear
            </Link>
          ) : null}
        </form>

        <p className="text-sm text-fg-muted" data-testid="lineages-count" aria-live="polite">
          {data.rows.length === 0 ? (q ? 'No lineage matches.' : '') : `${number.format(data.rows.length)} ${data.rows.length === 1 ? 'lineage' : 'lineages'}, ${sortLabel}`}
        </p>

        {data.rows.length > 0 ? (
          <div className="@container">
            <table role="table" data-testid="archive-lineages" className={tableClass}>
              <caption className="sr-only">Lineages, {sortLabel}</caption>
              <thead role="rowgroup" className={theadClass}>
                <tr role="row" className="border-b border-border-strong">
                  <SortHeader label="Lineage" href={href(q, 'name', '#lineages')} current={sort === 'name'} className="pl-0" />
                  <Header label="Root" />
                  <SortHeader label="People" href={href(q, 'people', '#lineages')} current={sort === 'people'} className="text-right" />
                  <Header label="Generations" className="text-right" />
                  <SortHeader label="Completeness" href={href(q, 'sourced', '#lineages')} current={sort === 'sourced'} />
                  <SortHeader label="Last edited" href={href(q, 'edited', '#lineages')} current={sort === 'edited'} />
                  <Header label={<span className="sr-only">Open</span>} className="pr-0" />
                </tr>
              </thead>
              <tbody role="rowgroup" className="@max-[52rem]:grid @max-[52rem]:gap-3">
                {data.rows.map((l) => (
                  <tr role="row" key={l.id} data-lineage={l.slug} className={rowClass}>
                    <td role="cell" className={`${cell} pl-0`}>
                      <Link href={`/admin/archive/lineages/${l.slug}`} className="link inline-flex min-h-11 items-center font-semibold">
                        {l.name}
                      </Link>
                      <span className="block text-sm text-fg-muted">{l.listed ? 'In the explorer' : 'Not in the explorer yet'}</span>
                    </td>
                    <td role="cell" className={cell}>
                      <CardLabel>Root:</CardLabel>
                      {l.root ? <NameText name={l.root.name} /> : <Missing>No root yet</Missing>}
                    </td>
                    <td role="cell" className={`${cell} text-right tabular-nums @max-[52rem]:text-left`}>
                      <CardLabel>People:</CardLabel>
                      {number.format(l.people)}
                      <span className="block text-sm text-fg-muted">{l.links === 1 ? '1 link' : `${number.format(l.links)} links`}</span>
                    </td>
                    <td role="cell" className={`${cell} text-right tabular-nums @max-[52rem]:text-left`}>
                      <CardLabel>Generations:</CardLabel>
                      {l.generations ?? <span className="text-fg-muted">–</span>}
                    </td>
                    <td role="cell" className={cell}>
                      <CardLabel>Completeness:</CardLabel>
                      {l.sourced === null ? (
                        <span className="text-fg-muted">No links yet</span>
                      ) : (
                        <span className="grid gap-1">
                          <span className="whitespace-nowrap">{l.sourced}% sourced</span>
                          <span aria-hidden="true" className="block h-1 w-24 overflow-hidden rounded-full bg-surface-3">
                            <span className="block h-full bg-fg" style={{ width: `${l.sourced}%` }} />
                          </span>
                          {l.needsWork > 0 ? (
                            <Link href={`/admin/archive/lineages/${l.slug}/links?show=no_source`} className="link text-sm">
                              {number.format(l.needsWork)} need work
                            </Link>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td role="cell" className={`${cell} whitespace-nowrap`}>
                      <CardLabel>Last edited:</CardLabel>
                      {l.editedAt ? <time dateTime={l.editedAt}>{formatShortDay(l.editedAt)}</time> : <span className="text-fg-muted">Never</span>}
                    </td>
                    <td role="cell" className={`${cell} pr-0`}>
                      <span className="flex flex-wrap gap-x-4">
                        <Link href={`/admin/archive/lineages/${l.slug}`} className="link inline-flex min-h-11 items-center whitespace-nowrap">
                          Tree<span className="sr-only"> of {l.name}</span>
                        </Link>
                        <Link href={`/admin/archive/lineages/${l.slug}/links`} className="link inline-flex min-h-11 items-center whitespace-nowrap">
                          Links<span className="sr-only"> of {l.name}</span>
                        </Link>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !q ? (
          <p className="max-w-[56ch] text-ui text-fg-muted" data-testid="archive-no-lineages">
            No lineage yet.{' '}
            <Link href="/admin/archive?new=lineage#new-lineage" className="link">
              Create the first one
            </Link>
            , then add its records and links.
          </p>
        ) : null}
      </section>
    </Column>
  );
}
