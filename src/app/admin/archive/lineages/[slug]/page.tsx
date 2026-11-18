// /admin/archive/lineages/<slug> (milestone M26, docs/adr/0034-archive-editor.md; control panel
// 2026-11, docs/adr/0035-control-panel.md): one lineage's workspace in the archive editor. The tree
// as an outline, generation by generation: only the root and the branches opened in the address
// (?open=<slug>,<slug>) are read and drawn, so a lineage of thousands never renders at once; a
// branch lists at most 50 students and the links grid has the rest. The person chosen
// (?person=<slug>) opens beside it with their teachers and students here, "Add a teacher" and
// "Add a student". Below: "Add a link" with the record search (a plain GET form whose results fill
// the teacher or the student) and the lineage's name, description and root. The links themselves
// are in the grid at ./links. For an archivist or an administrator whose session passed the second
// factor. Reads the session.

import { randomUUID } from 'node:crypto';

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
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { TREE_CHILDREN_LIMIT, TREE_OPEN_LIMIT, type ArchivePersonLink, type ArchiveTreeNode } from '@/server/services/archive-grids';
import { LINEAGE_EDIT_FORM, LINK_ADD_FORM } from '../../form-ids';
import { AddLinkForm, EditLineageForm } from '../../forms';
import { Column, fieldClass, LinkStatus, Missing, number, years } from '../../grid-parts';
import { RecordLine, recordFacts } from '../../parts';
import { WorkspaceHeader } from './workspace';

export const instant = false;

export const metadata: Metadata = {
  title: 'Lineage · Archive editor',
  robots: { index: false },
};

type Params = Promise<{ slug: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const SLUG = /^[a-z0-9-]{1,120}$/;
const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

const DONE: Record<string, string> = {
  created: 'The lineage is created. Add its records and links below; the explorer lists it once its root and a link are public.',
  saved: 'The lineage is saved. The change and its reason are in the audit log.',
  unchanged: 'Nothing changed, so nothing was saved.',
  linked: 'The link is verified and shown on the public pages. The source and the evidence are kept with it.',
  'linked-hidden':
    'The link is verified. It stays off the public pages until both records are public: a record whose life status is not known is shown once a death is established.',
  ended: 'The link is ended and off the public pages. Its history and your reason are kept.',
};

async function orMissing<T>(read: Promise<T>): Promise<T | 'missing'> {
  try {
    return await read;
  } catch (error) {
    if (rpcErrorCode(error) === 'NOT_FOUND' || rpcErrorCode(error) === 'BAD_REQUEST') return 'missing';
    throw error;
  }
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

function Frame({ children }: { children: ReactNode }) {
  return (
    <Column>
      <p className="eyebrow">
        <Link href="/admin/archive" className="link inline-flex min-h-11 items-center">
          Lineages
        </Link>
      </p>
      {children}
    </Column>
  );
}

/** The mark of a node's link from its teacher: verified, in arbitration, or without a source. */
function NodeMark({ node }: { node: ArchiveTreeNode }) {
  if (!node.link) return <span className="w-14 shrink-0 text-sm text-fg-muted">Root</span>;
  if (!node.link.sourced) {
    return (
      <span className="inline-flex w-14 shrink-0 items-center gap-1 text-sm text-review">
        <span aria-hidden="true">?</span>
        <span className="sr-only">No source</span>
        <span aria-hidden="true" className="text-xs">
          source
        </span>
      </span>
    );
  }
  return node.link.status === 'verified' ? (
    <span className="inline-flex w-14 shrink-0 items-center gap-1 text-sm text-verified">
      <span aria-hidden="true">✓</span>
      <span className="sr-only">Verified</span>
    </span>
  ) : (
    <span className="inline-flex w-14 shrink-0 items-center gap-1 text-sm text-review">
      <span aria-hidden="true">⚖</span>
      <span className="sr-only">In arbitration</span>
    </span>
  );
}

function PersonLinks({ title, links, empty, edit, select, footer }: { title: ReactNode; links: ArchivePersonLink[]; empty: string; edit: (id: string) => string; select: (slug: string) => string; footer?: ReactNode }) {
  return (
    <div className="grid gap-2">
      <h3 className="flex flex-wrap items-baseline justify-between gap-x-3 text-ui font-semibold">{title}</h3>
      {links.length > 0 ? (
        <ul className="grid">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-2 border-t border-border-subtle py-1">
              <LinkStatus status={l.status} />
              <Link href={select(l.other.slug)} className="link inline-flex min-h-11 items-center font-semibold">
                <NameText name={l.other.name} />
              </Link>
              <span className="text-sm text-fg-muted">
                {years(l.fromYear, l.toYear)}
                {l.students > 0 ? ` · ${l.students === 1 ? '1 student' : `${number.format(l.students)} students`}` : ''}
              </span>
              {l.sourced ? null : <Missing>No source</Missing>}
              <Link href={edit(l.id)} className="link ml-auto inline-flex min-h-11 items-center text-sm">
                Open link<span className="sr-only"> with {l.other.name.value}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">{empty}</p>
      )}
      {footer}
    </div>
  );
}

export default async function ArchiveLineagePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  const query = await searchParams;
  const q = one(query.q).trim().slice(0, 200);
  const teacher = SLUG.test(one(query.teacher)) ? one(query.teacher) : '';
  const student = SLUG.test(one(query.student)) ? one(query.student) : '';
  const person = SLUG.test(one(query.person)) ? one(query.person) : '';
  const open = [...new Set(one(query.open).split(',').filter((s) => SLUG.test(s)))].slice(0, TREE_OPEN_LIMIT);
  const path = SLUG.test(slug) ? `/admin/archive/lineages/${slug}` : '/admin/archive';
  const guard = await guardRoute('/admin/archive', path);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) {
    return (
      <Frame>
        <h1 className="mt-2 font-display text-feature">Not available</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted" data-testid="archive-denied">
          You don&apos;t have access to the archive editor. It is available to archivists and administrators.
        </p>
      </Frame>
    );
  }
  const client = serverClient(await headers(), guard.principal);
  const [tree, found, panel] = await Promise.all([
    pageRead(orMissing(client.archiveEditor.tree({ slug, open }))),
    q ? pageRead(client.archiveEditor.search({ q })) : Promise.resolve({ records: [] }),
    person ? pageRead(orMissing(client.archiveEditor.person({ slug, person }))) : Promise.resolve(null),
  ]);
  if (tree === 'missing') {
    return (
      <Frame>
        <h1 className="mt-2 font-display text-feature">No such lineage</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted">No lineage has this address. Open it from the list of the archive editor.</p>
      </Frame>
    );
  }
  if (!tree || !found || (person && panel === null)) return <LoadError {...ARCHIVE_LOAD_ERROR} retryHref={path} />;
  const view = tree.lineage;
  const chosen = panel === 'missing' ? null : panel;
  const [editResult, addResult] = await Promise.all([readFormResult(LINEAGE_EDIT_FORM, query.outcome), readFormResult(LINK_ADD_FORM, query.outcome)]);
  const done = typeof query.done === 'string' ? (DONE[query.done] ?? null) : null;

  /** The address of the workspace with these choices, keeping the rest. */
  const at = (change: { open?: string[]; person?: string | null; teacher?: string; student?: string; q?: string }, anchor = '') => {
    const next = new URLSearchParams();
    const o = change.open ?? open;
    if (o.length > 0) next.set('open', o.join(','));
    const p = change.person === undefined ? person : change.person;
    if (p) next.set('person', p);
    const qq = change.q ?? q;
    if (qq) next.set('q', qq);
    const t = change.teacher ?? teacher;
    const s = change.student ?? student;
    if (t) next.set('teacher', t);
    if (s) next.set('student', s);
    const search = next.toString();
    return `${path}${search ? `?${search}` : ''}${anchor}`;
  };
  // The search keeps the teacher and the student chosen so far; each result fills one of them.
  const pick = (role: 'teacher' | 'student', recordSlug: string) => at({ [role]: recordSlug }, '#add-link');
  const toggle = (nodeSlug: string) => (open.includes(nodeSlug) ? open.filter((s) => s !== nodeSlug) : [...open, nodeSlug].slice(-TREE_OPEN_LIMIT));
  const linkPanel = (id: string) => `${path}/links?show=all&link=${id}#link-panel`;

  const renderNode = (node: ArchiveTreeNode): ReactNode => {
    const isOpen = node.children !== null;
    const selected = node.record.slug === person;
    return (
      <li key={`${node.record.id}-${node.link?.id ?? 'top'}`} data-node={node.record.slug} className="grid">
        <div className={`flex min-h-11 items-center gap-2 rounded-sm px-1 ${selected ? 'bg-surface-3 shadow-[inset_2px_0_0_var(--fg)]' : 'hover:bg-surface-2'}`}>
          <span className="w-12 shrink-0 text-xs text-fg-muted tabular-nums">Gen {node.generation}</span>
          {node.students > 0 ? (
            <Link
              href={at({ open: toggle(node.record.slug) }, `#node-${node.record.slug}`)}
              aria-expanded={isOpen}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg"
            >
              <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
              <span className="sr-only">
                {isOpen ? 'Close' : 'Open'} the students of {node.record.name.value}
              </span>
            </Link>
          ) : (
            <span className="size-11 shrink-0" aria-hidden="true" />
          )}
          <NodeMark node={node} />
          <Link
            id={`node-${node.record.slug}`}
            href={at({ person: node.record.slug }, '#person-panel')}
            aria-current={selected ? 'true' : undefined}
            className="link inline-flex min-h-11 min-w-0 items-center font-semibold aria-[current=true]:no-underline"
          >
            <NameText name={node.record.name} />
          </Link>
          <span className="truncate text-sm text-fg-muted">
            {node.students === 0 ? 'no students' : node.students === 1 ? '1 student' : `${number.format(node.students)} students`}
            {node.link && node.link.fromYear !== null ? ` · ${years(node.link.fromYear, node.link.toYear)}` : ''}
          </span>
        </div>
        {node.children ? (
          <ul className="ml-6 grid border-l border-border-subtle pl-2">
            {node.children.map(renderNode)}
            {node.students > node.children.length ? (
              <li>
                <Link href={`${path}/links?q=${encodeURIComponent(node.record.slug)}`} className="link inline-flex min-h-11 items-center pl-14 text-sm">
                  + {number.format(node.students - node.children.length)} more students of {node.record.name.value} in the links table
                </Link>
              </li>
            ) : null}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <Column wide>
      <WorkspaceHeader
        lineage={view}
        tab="tree"
        action={
          <Link href={`/admin/archive/people?new=record&back=${view.slug}#new-record`} className={buttonVariants({ variant: 'primary' })}>
            <span aria-hidden="true">+</span> Add person
          </Link>
        }
      />
      {view.description ? <p className="mt-3 max-w-[60ch] whitespace-pre-line text-ui">{view.description}</p> : null}
      {done ? (
        <div key={`${String(query.done)}-${String(query.n)}`} className="mt-5 max-w-[46rem]">
          <OutcomeNote testId="archive-outcome">{done}</OutcomeNote>
        </div>
      ) : null}

      <div className={`mt-6 grid gap-8 ${chosen ? 'xl:grid-cols-[minmax(0,1fr)_28rem]' : ''}`}>
        <section id="tree" aria-labelledby="tree-heading" className="grid min-w-0 content-start gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="tree-heading" className="font-display text-2xl">
              Tree
            </h2>
            <form method="get" action={`${path}/links#links`} role="search" aria-label="Find in this lineage" className="flex flex-wrap items-end gap-2">
              <label htmlFor="tree-find" className="sr-only">
                Find in this lineage
              </label>
              <input id="tree-find" name="q" type="search" placeholder="Find in this lineage" maxLength={200} autoComplete="off" className={`${fieldClass} w-64`} />
              <input type="hidden" name="show" value="all" />
              <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
                Find
              </button>
              {/* The tree shows active links only; ended ones are listed in the links grid. */}
              <Link href={`${path}/links?show=ended#links`} className="link inline-flex min-h-11 items-center text-ui">
                {'Ended'} links
              </Link>
              {open.length > 0 ? (
                <Link href={at({ open: [] })} className="link inline-flex min-h-11 items-center text-ui">
                  Close every branch
                </Link>
              ) : null}
            </form>
          </div>
          {tree.top.length > 0 ? (
            <>
              {!view.root ? (
                <p className="text-sm text-fg-muted">
                  <Missing>No root yet</Missing> These are the teachers with no teacher in this lineage
                  {tree.topTotal > tree.top.length ? ` (the first ${tree.top.length} of ${number.format(tree.topTotal)})` : ''}. Set the root in the lineage
                  details.
                </p>
              ) : null}
              <ul className="grid" data-testid="lineage-tree">
                {tree.top.map(renderNode)}
              </ul>
              <p className="text-sm text-fg-muted">
                Only the open branches load, so a lineage of any size stays fast. A branch lists its first {TREE_CHILDREN_LIMIT} students; the links table has every
                link.
              </p>
            </>
          ) : (
            <p className="max-w-[56ch] text-ui text-fg-muted" data-testid="lineage-no-links">
              No link yet. Add the first one below.
            </p>
          )}
        </section>

        {chosen ? (
          <aside id="person-panel" aria-labelledby="person-panel-heading" className="grid min-w-0 content-start gap-5 rounded-md border border-border-strong bg-surface-1 p-5" data-testid="person-panel">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="person-panel-heading" className="font-display text-2xl">
                  <NameText name={chosen.record.name} />
                </h2>
                {chosen.record.original ? <NameText name={chosen.record.original} className="text-ui" /> : null}
              </div>
              <Link href={at({ person: null })} className="link inline-flex min-h-11 min-w-11 items-center justify-center text-ui">
                Close
              </Link>
            </div>
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-ui">
              <dt className="text-fg-muted">Record</dt>
              <dd>{recordFacts(chosen.record)}</dd>
              <dt className="text-fg-muted">Generation</dt>
              <dd>{chosen.generation === null ? 'Not connected to the root' : `${chosen.generation} in ${view.name}`}</dd>
              {chosen.lineages.length > 0 ? (
                <>
                  <dt className="text-fg-muted">Also in</dt>
                  <dd className="flex flex-wrap gap-x-3">
                    {chosen.lineages.map((l) => (
                      <Link key={l.slug} href={`/admin/archive/lineages/${l.slug}?person=${chosen.record.slug}`} className="link">
                        {l.name}
                      </Link>
                    ))}
                  </dd>
                </>
              ) : null}
            </dl>
            <p className="flex flex-wrap gap-x-4 text-ui">
              <Link href={`/admin/review/records/${chosen.record.slug}`} className="link inline-flex min-h-11 items-center">
                Edit the record
              </Link>
            </p>
            <PersonLinks
              title={
                <>
                  <span>Teachers · {chosen.teachers.length}</span>
                  {chosen.record.stewardship !== 'self' ? (
                    <Link href={at({ student: chosen.record.slug, teacher: '' }, '#add-link')} className="link inline-flex min-h-11 items-center text-sm font-normal">
                      + Add a teacher
                    </Link>
                  ) : null}
                </>
              }
              links={chosen.teachers}
              empty="No teacher in this lineage yet."
              edit={linkPanel}
              select={(s) => at({ person: s }, '#person-panel')}
            />
            <PersonLinks
              title={
                <>
                  <span>Students · {number.format(chosen.studentsTotal)}</span>
                  {chosen.record.stewardship !== 'self' ? (
                    <Link href={at({ teacher: chosen.record.slug, student: '' }, '#add-link')} className="link inline-flex min-h-11 items-center text-sm font-normal">
                      + Add a student
                    </Link>
                  ) : null}
                </>
              }
              links={chosen.students}
              empty="No student in this lineage yet."
              edit={linkPanel}
              select={(s) => at({ person: s }, '#person-panel')}
              footer={
                chosen.studentsTotal > chosen.students.length ? (
                  <Link href={`${path}/links?q=${encodeURIComponent(chosen.record.slug)}`} className="link inline-flex min-h-11 items-center text-sm">
                    All {number.format(chosen.studentsTotal)} in the links table
                  </Link>
                ) : null
              }
            />
            {chosen.sources.length > 0 ? (
              <div className="grid gap-1">
                <h3 className="text-ui font-semibold">Sources</h3>
                <ul className="grid gap-1 text-sm">
                  {chosen.sources.map((s) => (
                    <li key={s} className="whitespace-pre-line [overflow-wrap:anywhere]">
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {chosen.record.stewardship === 'self' ? (
              <p className="text-sm text-fg-muted">This is a member&apos;s own record. Their teachers confirm their links, or they send a claim with evidence.</p>
            ) : null}
          </aside>
        ) : person && panel === 'missing' ? (
          <p className="text-ui text-fg-muted">No record has the address {person}.</p>
        ) : null}
      </div>

      <div className="mt-10 grid gap-10">
        <Section id="add-link" title="Add a link">
          <p className="max-w-[60ch] text-ui text-fg-muted">
            Find the teacher and the student, choose each, and give the source. Both must be records kept by the platform; a member&apos;s own links are
            confirmed by their teacher or by a claim. A record that is not in the archive yet:{' '}
            <Link href={`/admin/archive/people?new=record&back=${view.slug}#new-record`} className="link">
              create it first
            </Link>
            .
          </p>
          <form method="get" action={`${path}#add-link`} className="flex max-w-[40rem] flex-wrap items-end gap-3" role="search" aria-label="Find a record for the link">
            {teacher ? <input type="hidden" name="teacher" value={teacher} /> : null}
            {student ? <input type="hidden" name="student" value={student} /> : null}
            {person ? <input type="hidden" name="person" value={person} /> : null}
            {open.length > 0 ? <input type="hidden" name="open" value={open.join(',')} /> : null}
            <div className="grid min-w-0 flex-1 gap-1.5">
              <label htmlFor="lineage-search" className="text-ui font-semibold">
                Find a record
              </label>
              <input id="lineage-search" name="q" type="search" defaultValue={q} maxLength={200} autoComplete="off" className={fieldClass} />
            </div>
            <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
              Search
            </button>
          </form>
          {q ? (
            found.records.length > 0 ? (
              <ul className="grid max-w-[52rem]" data-testid="archive-search-results">
                {found.records.map((r) => (
                  <RecordLine key={r.id} record={r}>
                    {r.stewardship !== 'self' ? (
                      <>
                        <Link href={pick('teacher', r.slug)} className="link inline-flex min-h-11 items-center">
                          Use as teacher
                        </Link>
                        <Link href={pick('student', r.slug)} className="link inline-flex min-h-11 items-center">
                          Use as student
                        </Link>
                      </>
                    ) : null}
                  </RecordLine>
                ))}
              </ul>
            ) : (
              <p className="text-ui" data-testid="archive-search-empty">
                No record matches.{' '}
                <Link href={`/admin/archive/people?new=record&back=${view.slug}&name=${encodeURIComponent(q)}#new-record`} className="link">
                  Create it
                </Link>
                .
              </p>
            )
          ) : null}
          <div className="max-w-[46rem]">
            {/* Keyed by the chosen records, so a new choice from the search fills the fields again. */}
            <AddLinkForm
              key={`${teacher}|${student}`}
              lineage={view}
              teacherSlug={teacher || undefined}
              studentSlug={student || undefined}
              idempotencyKey={randomUUID()}
              initial={addResult}
              person={person || undefined}
            />
          </div>
        </Section>

        <Section id="details" title="Lineage details">
          <div className="max-w-[46rem]">
            <EditLineageForm lineage={{ id: view.id, slug: view.slug, name: view.name, description: view.description, rootSlug: view.root?.slug ?? null }} initial={editResult} />
          </div>
        </Section>
      </div>
    </Column>
  );
}
