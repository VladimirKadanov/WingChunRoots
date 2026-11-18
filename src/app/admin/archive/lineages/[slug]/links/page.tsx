// /admin/archive/lineages/<slug>/links (control panel 2026-11, docs/adr/0035-control-panel.md): the
// links of one lineage as a grid. Filtered on the server by status, a missing source or missing
// years, the teacher's generation and a teacher or student (any spelling), sorted by a column, 50 a
// page, all in the URL. A row opens the link beside the grid (?link=<id>): its years, its source in
// full, how it was established, a form that corrects the years and the source in place, and "End
// this link" for one entered here by mistake. There is no bulk
// action: ending a link needs its own reason. For an archivist or an administrator whose session
// passed the second factor. Reads the session.

import { randomUUID } from 'node:crypto';

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
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { LINK_FILTERS, LINK_SORTS, type ArchiveLinkRow } from '@/server/services/archive-grids';
import { LINK_EDIT_FORM, LINK_END_FORM } from '../../../form-ids';
import { EditLinkForm } from '../../../edit-link-form';
import { EndLinkForm } from '../../../forms';
import { CardLabel, cell, Chip, Chips, Column, CountLine, fieldClass, Header, LinkStatus, Missing, Pager, rowClass, SortHeader, tableClass, theadClass, years } from '../../../grid-parts';
import { archiveLoadError } from '../../../labels';
import { WorkspaceHeader } from '../workspace';
import { loadErrorWords } from '@/components/admin/i18n/load-error-words';

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getAdminT();
  return { title: t('Links · Archive editor'), robots: { index: false } };
}

type Params = Promise<{ slug: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;
type Show = (typeof LINK_FILTERS)[number];
type Sort = (typeof LINK_SORTS)[number];

const SLUG = /^[a-z0-9-]{1,120}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

interface Filters {
  q: string;
  show: Show;
  generation: number | null;
  sort: Sort;
}

async function orMissing<T>(read: Promise<T>): Promise<T | 'missing'> {
  try {
    return await read;
  } catch (error) {
    if (rpcErrorCode(error) === 'NOT_FOUND') return 'missing';
    throw error;
  }
}

function sourceLine(t: AdminT, link: ArchiveLinkRow) {
  if (link.source) return <span className="line-clamp-2 [overflow-wrap:anywhere]">{link.source}</span>;
  if (link.path === 'teacher_approval') return <span className="text-fg-muted">{t('Approved by the teacher')}</span>;
  return <Missing>{t('No source')}</Missing>;
}

export default async function ArchiveLinksPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  const query = await searchParams;
  const filters: Filters = {
    q: one(query.q).trim().slice(0, 200),
    show: (LINK_FILTERS as readonly string[]).includes(one(query.show)) ? (one(query.show) as Show) : 'active',
    generation: /^\d{1,2}$/.test(one(query.generation)) && Number(one(query.generation)) >= 1 ? Number(one(query.generation)) : null,
    sort: (LINK_SORTS as readonly string[]).includes(one(query.sort)) ? (one(query.sort) as Sort) : 'generation',
  };
  const pageNo = Math.min(10_000, Math.max(1, Number.parseInt(one(query.page), 10) || 1));
  const open = UUID.test(one(query.link)) ? one(query.link) : '';
  const base = SLUG.test(slug) ? `/admin/archive/lineages/${slug}/links` : '/admin/archive';
  const href = (f: Filters, page = 1, link = '', anchor = '#links') => {
    const p = new URLSearchParams();
    if (f.q) p.set('q', f.q);
    if (f.show !== 'active') p.set('show', f.show);
    if (f.generation) p.set('generation', String(f.generation));
    if (f.sort !== 'generation') p.set('sort', f.sort);
    if (page > 1) p.set('page', String(page));
    if (link) p.set('link', link);
    const s = p.toString();
    return `${base}${s ? `?${s}` : ''}${anchor}`;
  };
  const guard = await guardRoute('/admin/archive', href(filters, pageNo, open, ''));
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  const t = await getAdminT();
  if (guard.forbidden) {
    return (
      <Column>
        <h1 className="mt-2 font-display text-feature">{t('Not available')}</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted" data-testid="archive-denied">
          {t("You don't have access to the archive editor. It is available to archivists and administrators.")}
        </p>
      </Column>
    );
  }
  const client = serverClient(await headers(), guard.principal);
  const list = await pageRead(
    orMissing(
      client.archiveEditor.links({
        slug,
        q: filters.q || undefined,
        show: filters.show,
        generation: filters.generation ?? undefined,
        sort: filters.sort,
        page: pageNo,
        link: open || undefined,
      }),
    ),
  );
  if (list === 'missing') {
    return (
      <Column>
        <h1 className="mt-2 font-display text-feature">{t('No such lineage')}</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted">
          {t('No lineage has this address.')}{' '}
          <Link href="/admin/archive" className="link">
            {t('Open it from the list of lineages')}
          </Link>
          .
        </p>
      </Column>
    );
  }
  if (!list) return <LoadError words={loadErrorWords(t)} {...archiveLoadError(t)} retryHref={base} />;
  const endResult = await readFormResult(LINK_END_FORM, query.outcome);
  const editResult = await readFormResult(LINK_EDIT_FORM, query.outcome);
  const selected = list.selected;
  const chip = (show: Show) => href({ ...filters, show });
  const sortLabel = { generation: t('by generation'), teacher: t('by teacher'), student: t('by student'), years: t('by years'), edited: t('last edited first') }[filters.sort];
  const filtered = Boolean(filters.q || filters.show !== 'active' || filters.generation);

  return (
    <Column wide>
      <WorkspaceHeader
        t={t}
        lineage={list.lineage}
        tab="links"
        action={
          <Link href={`/admin/archive/lineages/${list.lineage.slug}#add-link`} className={buttonVariants({ variant: 'primary' })}>
            <span aria-hidden="true">+</span> {t('Add link')}
          </Link>
        }
      />
      {query.done === 'ended' ? (
        <div key={`ended-${String(query.n)}`} className="mt-5 max-w-[46rem]">
          <OutcomeNote testId="archive-outcome">{t('The link is ended and off the public pages. Its history and your reason are kept.')}</OutcomeNote>
        </div>
      ) : null}
      {query.done === 'edited' || query.done === 'unchanged' ? (
        <div key={`edited-${String(query.n)}`} className="mt-5 max-w-[46rem]">
          <OutcomeNote testId="archive-outcome">
            {query.done === 'edited'
              ? t('The link’s years and source are saved. Its status and history are unchanged; your reason is in the audit log.')
              : t('Nothing changed: the years and the source were already these.')}
          </OutcomeNote>
        </div>
      ) : null}

      <div className={`mt-6 grid gap-8 ${selected ? 'xl:grid-cols-[minmax(0,1fr)_26rem]' : ''}`}>
        <section id="links" aria-labelledby="links-heading" className="grid min-w-0 content-start gap-4">
          <h2 id="links-heading" className="sr-only">
            {t('Links of {name}', { name: list.lineage.name })}
          </h2>
          <form role="search" aria-label={t('Find links')} method="get" action={`${base}#links`} className="flex flex-wrap items-end gap-3">
            {filters.show !== 'active' ? <input type="hidden" name="show" value={filters.show} /> : null}
            <div className="grid min-w-0 flex-1 basis-[16rem] gap-1.5">
              <label htmlFor="links-q" className="text-sm font-semibold">
                {t('Find a teacher or student')}
              </label>
              <input id="links-q" name="q" type="search" defaultValue={filters.q} maxLength={200} autoComplete="off" className={fieldClass} />
            </div>
            <div className="grid min-w-0 basis-[10rem] gap-1.5">
              <label htmlFor="links-generation" className="text-sm font-semibold">
                {t("Teacher's generation")}
              </label>
              <select id="links-generation" name="generation" defaultValue={filters.generation ? String(filters.generation) : ''} className={fieldClass}>
                <option value="">{t('Every generation')}</option>
                {Array.from({ length: Math.max(list.generations, filters.generation ?? 0) }, (_, i) => (
                  <option key={i + 1} value={String(i + 1)}>
                    {t('Generation {n}', { n: i + 1 })}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid min-w-0 basis-[11rem] gap-1.5">
              <label htmlFor="links-sort" className="text-sm font-semibold">
                {t('Order')}
              </label>
              <select id="links-sort" name="sort" defaultValue={filters.sort} className={fieldClass}>
                <option value="generation">{t('By generation')}</option>
                <option value="teacher">{t('By teacher')}</option>
                <option value="student">{t('By student')}</option>
                <option value="years">{t('By years')}</option>
                <option value="edited">{t('Last edited first')}</option>
              </select>
            </div>
            <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
              {t('Show')}
            </button>
            {filtered || filters.sort !== 'generation' ? (
              <Link href={`${base}#links`} className="link inline-flex min-h-12 items-center text-ui">
                {t('Clear')}
              </Link>
            ) : null}
          </form>
          <Chips label={t('Status')}>
            <Chip href={chip('active')} current={filters.show === 'active'}>
              {t('Every active · {n}', { n: t.num(list.counts.active) })}
            </Chip>
            <Chip href={chip('verified')} current={filters.show === 'verified'}>
              {t('Verified · {n}', { n: t.num(list.counts.verified) })}
            </Chip>
            <Chip href={chip('in_arbitration')} current={filters.show === 'in_arbitration'}>
              {t('In arbitration · {n}', { n: t.num(list.counts.in_arbitration) })}
            </Chip>
            <Chip href={chip('no_source')} current={filters.show === 'no_source'} testId="links-no-source">
              {t('No source · {n}', { n: t.num(list.counts.no_source) })}
            </Chip>
            <Chip href={chip('no_years')} current={filters.show === 'no_years'}>
              {t('Years missing · {n}', { n: t.num(list.counts.no_years) })}
            </Chip>
            <Chip href={chip('ended')} current={filters.show === 'ended'}>
              {t('Ended · {n}', { n: t.num(list.counts.ended) })}
            </Chip>
          </Chips>

          <CountLine
            t={t}
            total={list.total}
            page={list.page}
            pageSize={list.pageSize}
            none={t('No links match.')}
            range={(vars) => t('Links {from} to {to} of {total}', vars)}
            testId="links-count"
          />

          {list.rows.length > 0 ? (
            <div className="@container">
              <table role="table" data-testid="lineage-links" className={tableClass}>
                <caption className="sr-only">{t('Links, {order}', { order: sortLabel })}</caption>
                <thead role="rowgroup" className={theadClass}>
                  <tr role="row" className="border-b border-border-strong">
                    <SortHeader t={t} label={t('Teacher')} href={href({ ...filters, sort: 'teacher' })} current={filters.sort === 'teacher'} className="pl-0" />
                    <SortHeader t={t} label={t('Student')} href={href({ ...filters, sort: 'student' })} current={filters.sort === 'student'} />
                    <SortHeader t={t} label={t('Gen')} href={href({ ...filters, sort: 'generation' })} current={filters.sort === 'generation'} />
                    <SortHeader t={t} label={t('Years')} href={href({ ...filters, sort: 'years' })} current={filters.sort === 'years'} />
                    <Header label={t('Status')} />
                    <Header label={t('Source')} />
                    <SortHeader t={t} label={t('Edited')} href={href({ ...filters, sort: 'edited' })} current={filters.sort === 'edited'} />
                    <Header label={<span className="sr-only">{t.x('verb', 'Open')}</span>} className="pr-0" />
                  </tr>
                </thead>
                <tbody role="rowgroup" className="@max-[52rem]:grid @max-[52rem]:gap-3">
                  {list.rows.map((link) => (
                    <tr role="row" key={link.id} data-relationship={link.id} aria-current={link.id === open ? 'true' : undefined} className={`${rowClass} aria-[current=true]:bg-surface-3`}>
                      <td role="cell" className={`${cell} pl-0`}>
                        <CardLabel>{t('Teacher:')}</CardLabel>
                        <Link href={`/admin/archive/lineages/${list.lineage.slug}?person=${link.teacher.slug}`} className="link">
                          <NameText name={link.teacher.name} />
                        </Link>
                      </td>
                      <td role="cell" className={cell}>
                        <CardLabel>{t('Student:')}</CardLabel>
                        <span aria-hidden="true" className="mr-1 text-fg-muted @max-[52rem]:hidden">
                          →
                        </span>
                        <Link href={`/admin/archive/lineages/${list.lineage.slug}?person=${link.student.slug}`} className="link">
                          <NameText name={link.student.name} />
                        </Link>
                      </td>
                      <td role="cell" className={`${cell} whitespace-nowrap tabular-nums`}>
                        <CardLabel>{t('Generation:')}</CardLabel>
                        {link.generation === null ? <span className="text-fg-muted">{t('Not connected')}</span> : `${link.generation}→${link.generation + 1}`}
                      </td>
                      <td role="cell" className={`${cell} whitespace-nowrap`}>
                        <CardLabel>{t('Years:')}</CardLabel>
                        {link.fromYear === null ? <Missing>{t('Not known')}</Missing> : years(t, link.fromYear, link.toYear)}
                      </td>
                      <td role="cell" className={cell}>
                        <CardLabel>{t('Status:')}</CardLabel>
                        <LinkStatus t={t} status={link.status} />
                        <span className="block text-sm text-fg-muted">{link.shown ? t('Public') : t('Not public')}</span>
                      </td>
                      <td role="cell" className={`${cell} max-w-[22rem] text-sm`}>
                        <CardLabel>{t('Source:')}</CardLabel>
                        {sourceLine(t, link)}
                      </td>
                      <td role="cell" className={`${cell} whitespace-nowrap`}>
                        <CardLabel>{t('Edited:')}</CardLabel>
                        <time dateTime={link.editedAt}>{t.shortDay(link.editedAt)}</time>
                      </td>
                      <td role="cell" className={`${cell} pr-0`}>
                        <Link href={href(filters, list.page, link.id, '#link-panel')} className="link inline-flex min-h-11 items-center whitespace-nowrap">
                          {t.x('verb', 'Open')}
                          <span className="sr-only">{t(' the link from {teacher} to {student}', { teacher: link.teacher.name.value, student: link.student.name.value })}</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="max-w-[56ch] text-ui text-fg-muted" data-testid="lineage-no-links">
              {filtered ? t('No link matches these filters. Clear them to see every link.') : t('No link yet. ')}
              {!filtered ? (
                <Link href={`/admin/archive/lineages/${list.lineage.slug}#add-link`} className="link">
                  {t('Add the first one')}
                </Link>
              ) : null}
            </p>
          )}
          <Pager t={t} page={list.page} pages={list.pages} href={(p) => href(filters, p)} label={t('Pages of links')} />
        </section>

        {selected ? (
          <aside id="link-panel" aria-labelledby="link-panel-heading" className="grid min-w-0 content-start gap-4 rounded-md border border-border-strong bg-surface-1 p-5" data-testid="link-panel">
            <div className="flex items-start justify-between gap-3">
              <h2 id="link-panel-heading" className="font-display text-2xl">
                <NameText name={selected.teacher.name} /> <span aria-hidden="true">→</span>
                <span className="sr-only"> {t('to')} </span> <NameText name={selected.student.name} />
              </h2>
              <Link href={href(filters, list.page)} className="link inline-flex min-h-11 min-w-11 items-center justify-center text-ui">
                {t('Close')}
              </Link>
            </div>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-ui">
              <dt className="text-fg-muted">{t('Status')}</dt>
              <dd>
                <LinkStatus t={t} status={selected.status} /> · {selected.shown ? t('Public') : t('Not public')}
              </dd>
              <dt className="text-fg-muted">{t('Years')}</dt>
              <dd>{years(t, selected.fromYear, selected.toYear)}</dd>
              <dt className="text-fg-muted">{t('Generation')}</dt>
              <dd>{selected.generation === null ? t('Not connected to the root') : `${selected.generation} → ${selected.generation + 1}`}</dd>
              <dt className="text-fg-muted">{t('Established')}</dt>
              <dd>{selected.path === 'committee_review' ? t('By staff, on a source') : t('Approved by the teacher')}</dd>
              <dt className="text-fg-muted">{t('Source')}</dt>
              <dd className="whitespace-pre-line [overflow-wrap:anywhere]">{selected.source ?? (selected.path === 'teacher_approval' ? t('Approved by the teacher') : t('None'))}</dd>
            </dl>
            <p className="flex flex-wrap gap-x-4 text-ui">
              <Link href={`/admin/review/records/${selected.teacher.slug}`} className="link inline-flex min-h-11 items-center">
                {t("Teacher's record")}
              </Link>
              <Link href={`/admin/review/records/${selected.student.slug}`} className="link inline-flex min-h-11 items-center">
                {t("Student's record")}
              </Link>
            </p>
            {selected.editable ? (
              <details className="border-t border-border-subtle pt-4" open={editResult?.values?.relationshipId === selected.id || undefined} data-testid="link-edit">
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-ui font-semibold">{t('Correct the years or the source')}</summary>
                <p className="mt-2 mb-3 text-sm text-fg-muted">{t('The link stays verified with its history; the change and your reason go to the audit log.')}</p>
                <EditLinkForm t={t} link={selected} slug={list.lineage.slug} initial={editResult?.values?.relationshipId === selected.id ? editResult : null} />
              </details>
            ) : null}
            {selected.endable ? (
              <div className="grid gap-2 border-t border-border-subtle pt-4">
                <p className="text-sm text-fg-muted">{t('Entered by mistake? End it with a reason.')}</p>
                <EndLinkForm
                  relationshipId={selected.id}
                  slug={list.lineage.slug}
                  idempotencyKey={randomUUID()}
                  initial={endResult?.values?.relationshipId === selected.id ? endResult : null}
                  fromLinks
                />
              </div>
            ) : selected.status !== 'revoked' ? (
              <p className="border-t border-border-subtle pt-4 text-sm text-fg-muted">
                {t(
                  "This link was approved by the teacher or involves a member's own record. It is not edited or ended here: the member changes it through their review flow, or dispute it through arbitration from the record's page.",
                )}
              </p>
            ) : null}
          </aside>
        ) : null}
      </div>
    </Column>
  );
}
