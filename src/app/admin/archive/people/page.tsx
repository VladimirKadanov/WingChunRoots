// /admin/archive/people (control panel 2026-11, docs/adr/0035-control-panel.md): the people and
// records grid of the archive editor. Every record, public or not, found on the server by any
// spelling of a name (Latin letters, Chinese characters, Jyutping, pinyin, the address), filtered
// (historical, members with accounts, not public, no teacher yet, possible duplicates, a lineage),
// 50 a page, all in the URL. "New record" (?new=record) opens the form beside a check for similar
// records (a GET form: the name is searched before anything is created). For an archivist or an
// administrator whose session passed the second factor. Reads the session.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { NameText } from '@/components/account/person-names';
import { LoadError } from '@/components/account/load-error';
import { PageRedirect } from '@/components/account/page-redirect';
import { getAdminT } from '@/components/admin/i18n/server';
import type { AdminT } from '@/components/admin/i18n/translate';
import { OutcomeNote } from '@/components/relationships/parts';
import { buttonVariants } from '@/components/ui/button-variants';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { archiveEditorOptions, type ArchiveRecordRef } from '@/server/services/archive-editor';
import { PEOPLE_FILTERS } from '@/server/services/archive-grids';
import { RECORD_CREATE_FORM } from '../form-ids';
import { CreateRecordForm } from '../forms';
import { CardLabel, cell, Chip, Chips, Column, CountLine, fieldClass, Header, Missing, Pager, rowClass, tableClass, theadClass } from '../grid-parts';
import { archiveLoadError, scriptLabel } from '../labels';
import { recordFacts } from '../parts';
import { loadErrorWords } from '@/components/admin/i18n/load-error-words';

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getAdminT();
  return { title: t('People & records · Archive editor'), robots: { index: false } };
}

type Search = Promise<Record<string, string | string[] | undefined>>;
type Show = (typeof PEOPLE_FILTERS)[number];

const SLUG = /^[a-z0-9-]{1,120}$/;
const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

interface Filters {
  q: string;
  show: Show;
  lineage: string;
}

function peopleHref(f: Filters, page = 1, extra = '') {
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  if (f.show !== 'everyone') params.set('show', f.show);
  if (f.lineage) params.set('lineage', f.lineage);
  if (page > 1) params.set('page', String(page));
  const search = params.toString();
  return `/admin/archive/people${search ? `?${search}` : ''}${extra}`;
}

function keptBy(t: AdminT, stewardship: ArchiveRecordRef['stewardship']): string {
  switch (stewardship) {
    case 'self':
      return t('Own account');
    case 'platform':
      return t('Archive');
    case 'unclaimed':
      return t('Unclaimed');
  }
}

function life(t: AdminT, status: ArchiveRecordRef['lifeStatus']): string {
  switch (status) {
    case 'living':
      return t('Living');
    case 'deceased':
      return t('Deceased');
    case 'unknown':
      return t('Not known');
  }
}

export default async function ArchivePeoplePage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const filters: Filters = {
    q: one(query.q).trim().slice(0, 200),
    show: (PEOPLE_FILTERS as readonly string[]).includes(one(query.show)) ? (one(query.show) as Show) : 'everyone',
    lineage: SLUG.test(one(query.lineage)) ? one(query.lineage) : '',
  };
  const pageNo = Math.min(10_000, Math.max(1, Number.parseInt(one(query.page), 10) || 1));
  const back = SLUG.test(one(query.back)) ? one(query.back) : '';
  const guard = await guardRoute('/admin/archive/people', peopleHref(filters, pageNo));
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  const t = await getAdminT();
  if (guard.forbidden) {
    return (
      <Column>
        <p className="eyebrow">{t('Archive editor')}</p>
        <h1 className="mt-2 font-display text-feature">{t('Not available')}</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted" data-testid="archive-denied">
          {t("You don't have access to the archive editor. It is available to archivists and administrators.")}
        </p>
      </Column>
    );
  }
  const recordResult = await readFormResult(RECORD_CREATE_FORM, query.outcome);
  const created = query.done === 'record' && SLUG.test(one(query.record)) ? one(query.record) : null;
  const creating = one(query.new) === 'record' || recordResult?.status === 'error' || (Boolean(back) && !created);
  const draftName = one(query.name).trim().slice(0, 120);
  const client = serverClient(await headers(), guard.principal);
  const [list, similar] = await Promise.all([
    pageRead(client.archiveEditor.people({ q: filters.q || undefined, show: filters.show, lineage: filters.lineage || undefined, page: pageNo })),
    creating && draftName.length >= 2 ? pageRead(client.archiveEditor.search({ q: draftName })) : Promise.resolve({ records: [] }),
  ]);
  if (!list || !similar) return <LoadError words={loadErrorWords(t)} {...archiveLoadError(t)} retryHref="/admin/archive/people" />;
  const filtered = Boolean(filters.q || filters.show !== 'everyone' || filters.lineage);
  const newHref = `${peopleHref(filters)}${peopleHref(filters).includes('?') ? '&' : '?'}new=record${back ? `&back=${back}` : ''}#new-record`;
  const chip = (show: Show) => peopleHref({ ...filters, show }, 1, '#people');
  // The outcome sentence around the new record's address (kept whole, so each language orders it its own way).
  const [createdBefore = '', createdAfter = ''] = t('The record is created, with the address {address}. It is not public yet: add a link to show it.').split('{address}');

  return (
    <Column wide>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-[46rem]">
          <p className="eyebrow">
            <Link href="/admin/archive" className="link inline-flex min-h-11 items-center">
              {t('Archive')}
            </Link>
          </p>
          <h1 className="mt-1 font-display text-feature">{t('People & records')}</h1>
          <p className="mt-2 text-sm text-fg-muted">
            {filtered ? t('{n} matching', { n: t.num(list.total) }) : t('{n} people on record', { n: t.num(list.total) })}
            {t(" · the search finds every spelling: Latin letters, Chinese characters, Jyutping, pinyin and the record's address, public or not.")}
          </p>
        </div>
        <Link href={newHref} className={buttonVariants({ variant: 'primary' })} data-testid="new-record-link">
          <span aria-hidden="true">+</span> {t('New record')}
        </Link>
      </header>

      {created ? (
        <div key={`${String(query.done)}-${String(query.n)}`} className="mt-5 max-w-[46rem]">
          <OutcomeNote testId="archive-outcome">
            {createdBefore}
            <code translate="no">{created}</code>
            {createdAfter}{' '}
            <Link href={`/admin/review/records/${created}`} className="link">
              {t('Open the record')}
            </Link>
            {back ? (
              <>
                {' · '}
                <Link href={`/admin/archive/lineages/${back}?q=${encodeURIComponent(created)}#add-link`} className="link">
                  {t('Back to the lineage')}
                </Link>
              </>
            ) : null}
          </OutcomeNote>
        </div>
      ) : null}

      <div className={`mt-6 grid gap-8 ${creating ? 'xl:grid-cols-[minmax(0,1fr)_30rem]' : ''}`}>
        <section id="people" aria-labelledby="people-heading" className="grid min-w-0 content-start gap-4">
          <h2 id="people-heading" className="sr-only">
            {t('Every record')}
          </h2>
          <form role="search" aria-label={t('Find a person')} method="get" action="/admin/archive/people#people" className="flex flex-wrap items-end gap-3">
            {filters.show !== 'everyone' ? <input type="hidden" name="show" value={filters.show} /> : null}
            <div className="grid min-w-0 flex-1 basis-[18rem] gap-1.5">
              <label htmlFor="people-q" className="text-sm font-semibold">
                {t('Find a person')}
              </label>
              <input id="people-q" name="q" type="search" defaultValue={filters.q} maxLength={200} autoComplete="off" className={fieldClass} />
            </div>
            <div className="grid min-w-0 basis-[14rem] gap-1.5">
              <label htmlFor="people-lineage" className="text-sm font-semibold">
                {t('Lineage')}
              </label>
              <select id="people-lineage" name="lineage" defaultValue={filters.lineage} className={fieldClass}>
                <option value="">{t('Every lineage')}</option>
                {list.lineages.map((l) => (
                  <option key={l.slug} value={l.slug}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
              {t('Search')}
            </button>
            {filtered ? (
              <Link href="/admin/archive/people#people" className="link inline-flex min-h-12 items-center text-ui">
                {t('Clear')}
              </Link>
            ) : null}
          </form>
          <Chips label={t('Show')}>
            <Chip href={chip('everyone')} current={filters.show === 'everyone'}>
              {t('Everyone')}
            </Chip>
            <Chip href={chip('historical')} current={filters.show === 'historical'}>
              {t('Historical (archive)')}
            </Chip>
            <Chip href={chip('members')} current={filters.show === 'members'}>
              {t('Members with accounts')}
            </Chip>
            <Chip href={chip('hidden')} current={filters.show === 'hidden'}>
              {t('Not public')}
            </Chip>
            <Chip href={chip('no_teacher')} current={filters.show === 'no_teacher'}>
              {t('No teacher yet · {n}', { n: t.num(list.counts.noTeacher) })}
            </Chip>
            <Chip href={chip('duplicates')} current={filters.show === 'duplicates'} testId="people-duplicates">
              {t('Possible duplicates · {n}', { n: t.num(list.counts.duplicates) })}
            </Chip>
          </Chips>

          <CountLine
            t={t}
            total={list.total}
            page={list.page}
            pageSize={list.pageSize}
            none={t('No people match.')}
            range={(vars) => t('People {from} to {to} of {total}', vars)}
            testId="people-count"
          />

          {list.rows.length > 0 ? (
            <div className="@container">
              <table role="table" data-testid="people-table" className={tableClass}>
                <caption className="sr-only">{t('People and records, by name')}</caption>
                <thead role="rowgroup" className={theadClass}>
                  <tr role="row" className="border-b border-border-strong">
                    <Header label={t('Name')} className="pl-0" />
                    <Header label={t('Original')} />
                    <Header label={t('Life')} />
                    <Header label={t('Lineages')} />
                    <Header label={t('Teachers')} className="text-right" />
                    <Header label={t('Students')} className="text-right" />
                    <Header label={t('Kept by')} />
                    <Header label={t('Public')} className="pr-0" />
                  </tr>
                </thead>
                <tbody role="rowgroup" className="@max-[52rem]:grid @max-[52rem]:gap-3">
                  {list.rows.map(({ record, lineages, teachers, students, duplicate }) => (
                    <tr role="row" key={record.id} data-record={record.slug} className={rowClass}>
                      <td role="cell" className={`${cell} pl-0`}>
                        <Link href={`/admin/review/records/${record.slug}`} className="link inline-flex min-h-11 items-center font-semibold">
                          <NameText name={record.name} />
                        </Link>
                        {duplicate ? (
                          <Link href={peopleHref({ q: record.name.value, show: 'duplicates', lineage: '' }, 1, '#people')} className="ml-2 text-sm text-review">
                            <span aria-hidden="true">?</span> {t('Possible duplicate')}
                          </Link>
                        ) : null}
                        <code className="block text-sm text-fg-muted" translate="no">
                          {record.slug}
                        </code>
                      </td>
                      <td role="cell" className={cell}>
                        <CardLabel>{t('Original:')}</CardLabel>
                        {record.original ? <NameText name={record.original} /> : <span className="text-fg-muted">{t('None')}</span>}
                      </td>
                      <td role="cell" className={`${cell} whitespace-nowrap`}>
                        <CardLabel>{t('Life:')}</CardLabel>
                        {record.lifeStatus === 'unknown' ? <Missing>{t('Not known')}</Missing> : life(t, record.lifeStatus)}
                      </td>
                      <td role="cell" className={cell}>
                        <CardLabel>{t('Lineages:')}</CardLabel>
                        {lineages.length > 0 ? (
                          <span className="flex flex-wrap gap-x-3">
                            {lineages.map((l) => (
                              <Link key={l.slug} href={`/admin/archive/lineages/${l.slug}?person=${record.slug}`} className="link inline-flex min-h-11 items-center">
                                {l.name}
                              </Link>
                            ))}
                          </span>
                        ) : (
                          <span className="text-fg-muted">{t('None yet')}</span>
                        )}
                      </td>
                      <td role="cell" className={`${cell} text-right tabular-nums @max-[52rem]:text-left`}>
                        <CardLabel>{t('Teachers:')}</CardLabel>
                        {teachers}
                      </td>
                      <td role="cell" className={`${cell} text-right tabular-nums @max-[52rem]:text-left`}>
                        <CardLabel>{t('Students:')}</CardLabel>
                        {students}
                      </td>
                      <td role="cell" className={`${cell} whitespace-nowrap`}>
                        <CardLabel>{t('Kept by:')}</CardLabel>
                        {keptBy(t, record.stewardship)}
                      </td>
                      <td role="cell" className={`${cell} pr-0 whitespace-nowrap`}>
                        <CardLabel>{t('Public:')}</CardLabel>
                        {record.shown ? t('Yes') : t('No')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="max-w-[56ch] text-ui text-fg-muted" data-testid="people-empty">
              {filtered ? t('No record matches. Try another spelling, clear the filters, or ') : t('No record yet. ')}
              <Link href={newHref} className="link">
                {t('create a new record')}
              </Link>
              .
            </p>
          )}
          <Pager t={t} page={list.page} pages={list.pages} href={(p) => peopleHref(filters, p, '#people')} label={t('Pages of people')} />
        </section>

        {creating ? (
          <section id="new-record" aria-labelledby="new-record-heading" className="grid min-w-0 content-start gap-4 rounded-md border border-border-strong bg-surface-1 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="new-record-heading" className="font-display text-2xl">
                {t('New historical record')}
              </h2>
              <Link href={peopleHref(filters)} className="link inline-flex min-h-11 items-center text-ui">
                {t('Close')}
              </Link>
            </div>
            <form method="get" action="/admin/archive/people#new-record" className="flex flex-wrap items-end gap-3" role="search" aria-label={t('Similar records')}>
              <input type="hidden" name="new" value="record" />
              {back ? <input type="hidden" name="back" value={back} /> : null}
              <div className="grid min-w-0 flex-1 basis-[14rem] gap-1.5">
                <label htmlFor="similar-q" className="text-sm font-semibold">
                  {t('Check the name first')}
                </label>
                <input id="similar-q" name="name" type="search" defaultValue={draftName} maxLength={120} autoComplete="off" className={fieldClass} />
              </div>
              <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
                {t('Find similar')}
              </button>
            </form>
            {draftName.length >= 2 ? (
              similar.records.length > 0 ? (
                <div className="grid gap-2 rounded-sm border border-review p-3" data-testid="similar-records">
                  <p className="text-ui font-semibold">
                    <span aria-hidden="true">? </span>
                    {t.n(similar.records.length, 'A similar record exists. Open one, or carry on below.', '{n} similar records exist. Open one, or carry on below.')}
                  </p>
                  <ul className="grid">
                    {similar.records.slice(0, 8).map((r) => (
                      <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 border-t border-border-subtle py-1">
                        <Link href={`/admin/review/records/${r.slug}`} className="link inline-flex min-h-11 items-center">
                          <NameText name={r.name} />
                        </Link>
                        {r.original ? <NameText name={r.original} /> : null}
                        <span className="text-sm text-fg-muted">{recordFacts(t, r)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-fg-muted" data-testid="similar-none">
                  {t('No record has a similar name.')}
                </p>
              )
            ) : null}
            <CreateRecordForm key={draftName} scripts={archiveEditorOptions().scripts.map((script) => ({ lang: script.lang, label: scriptLabel(t, script.label) }))} back={back || undefined} name={draftName || undefined} initial={recordResult} />
          </section>
        ) : null}
      </div>
    </Column>
  );
}
