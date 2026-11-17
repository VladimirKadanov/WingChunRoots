// /admin/archive/lineages/<slug> (milestone M26, docs/adr/0034-archive-editor.md): one lineage of the
// archive editor. Its links (teacher → student, the years, the source, whether the public pages show
// them), "End this link" for a link entered here by mistake, "Add a link" with the record search
// (a plain GET form whose results fill the teacher or the student) and the lineage's name,
// description and root. For an archivist or an administrator whose session passed the second factor.
// Reads the session.

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
import { LINEAGE_EDIT_FORM, LINK_ADD_FORM, LINK_END_FORM } from '../../form-ids';
import { AddLinkForm, EditLineageForm, EndLinkForm } from '../../forms';
import { RecordLine } from '../../parts';

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

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <p className="eyebrow">
        <Link href="/admin/archive" className="link inline-flex min-h-11 items-center">
          Archive editor
        </Link>
      </p>
      {children}
    </div>
  );
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

const years = (from: number | null, to: number | null) => (from === null ? 'Years not known' : to === null ? `From ${from}` : from === to ? String(from) : `${from}–${to}`);

export default async function ArchiveLineagePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  const query = await searchParams;
  const q = one(query.q).trim().slice(0, 200);
  const teacher = SLUG.test(one(query.teacher)) ? one(query.teacher) : '';
  const student = SLUG.test(one(query.student)) ? one(query.student) : '';
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
  const [view, found] = await Promise.all([pageRead(orMissing(client.archiveEditor.lineage({ slug }))), q ? pageRead(client.archiveEditor.search({ q })) : Promise.resolve({ records: [] })]);
  if (view === 'missing') {
    return (
      <Frame>
        <h1 className="mt-2 font-display text-feature">No such lineage</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted">No lineage has this address. Open it from the list of the archive editor.</p>
      </Frame>
    );
  }
  if (!view || !found) return <LoadError {...ARCHIVE_LOAD_ERROR} retryHref={path} />;
  const [editResult, addResult, endResult] = await Promise.all([
    readFormResult(LINEAGE_EDIT_FORM, query.outcome),
    readFormResult(LINK_ADD_FORM, query.outcome),
    readFormResult(LINK_END_FORM, query.outcome),
  ]);
  const done = typeof query.done === 'string' ? (DONE[query.done] ?? null) : null;
  // The search keeps the teacher and the student chosen so far; each result fills one of them.
  const pick = (role: 'teacher' | 'student', recordSlug: string) => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    const chosen = { teacher, student, [role]: recordSlug };
    if (chosen.teacher) next.set('teacher', chosen.teacher);
    if (chosen.student) next.set('student', chosen.student);
    return `${path}?${next.toString()}#add-link`;
  };

  return (
    <Frame>
      <h1 className="mt-2 font-display text-feature">{view.name}</h1>
      <p className="mt-3 flex flex-wrap gap-x-3 text-ui text-fg-muted" data-testid="lineage-facts">
        <span>
          {view.root ? (
            <>
              Root: <NameText name={view.root.name} />
            </>
          ) : (
            'Root not known'
          )}
        </span>
        <span>{view.links.length === 1 ? '1 link' : `${view.links.length} links`}</span>
        <span>{view.listed ? 'In the explorer' : 'Not in the explorer yet'}</span>
      </p>
      {view.description ? <p className="mt-3 max-w-[60ch] whitespace-pre-line text-ui">{view.description}</p> : null}
      {done ? (
        <div key={`${String(query.done)}-${String(query.n)}`} className="mt-5 max-w-[46rem]">
          <OutcomeNote testId="archive-outcome">{done}</OutcomeNote>
        </div>
      ) : null}

      <div className="mt-8 grid gap-10">
        <Section id="links" title="Links">
          {view.links.length > 0 ? (
            <ul className="grid max-w-[52rem]" data-testid="lineage-links">
              {view.links.map((link) => (
                <li key={link.id} className="grid gap-1 border-b border-border-subtle py-3" data-relationship={link.id}>
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm text-fg-muted">Teacher</span>
                    <Link href={`/admin/review/records/${link.teacher.slug}`} className="link">
                      <NameText name={link.teacher.name} />
                    </Link>
                    <span aria-hidden="true">→</span>
                    <span className="text-sm text-fg-muted">Student</span>
                    <Link href={`/admin/review/records/${link.student.slug}`} className="link">
                      <NameText name={link.student.name} />
                    </Link>
                  </span>
                  <span className="text-sm text-fg-muted">
                    {years(link.fromYear, link.toYear)}
                    {' · '}
                    {link.status === 'verified' ? 'Verified' : link.status === 'in_arbitration' ? 'In arbitration' : 'Ended'}
                    {' · '}
                    {link.shown ? 'Public' : 'Not public'}
                    {' · '}
                    {link.path === 'committee_review' ? 'Established by staff' : 'Approved by the teacher'}
                  </span>
                  {link.source ? <span className="max-w-[60ch] whitespace-pre-line text-sm">Source: {link.source}</span> : null}
                  {link.endable ? (
                    <details className="mt-1 max-w-[40rem]" open={endResult?.status === 'error' && endResult.values?.relationshipId === link.id}>
                      <summary className="inline-flex min-h-11 cursor-pointer items-center text-ui font-semibold">End this link…</summary>
                      <div className="mt-2">
                        <EndLinkForm
                          relationshipId={link.id}
                          slug={view.slug}
                          idempotencyKey={randomUUID()}
                          initial={endResult?.values?.relationshipId === link.id ? endResult : null}
                        />
                      </div>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="max-w-[56ch] text-ui text-fg-muted" data-testid="lineage-no-links">
              No link yet. Add the first one below.
            </p>
          )}
        </Section>

        <Section id="add-link" title="Add a link">
          <p className="max-w-[60ch] text-ui text-fg-muted">
            Find the teacher and the student, choose each, and give the source. Both must be records kept by the platform; a member&apos;s own
            links are confirmed by their teacher or by a claim. A record that is not in the archive yet:{' '}
            <Link href={`/admin/archive?back=${view.slug}#new-record`} className="link">
              create it first
            </Link>
            .
          </p>
          <form method="get" action={`${path}#add-link`} className="flex max-w-[40rem] flex-wrap items-end gap-3" role="search">
            {teacher ? <input type="hidden" name="teacher" value={teacher} /> : null}
            {student ? <input type="hidden" name="student" value={student} /> : null}
            <div className="grid min-w-0 flex-1 gap-1.5">
              <label htmlFor="lineage-search" className="text-ui font-semibold">
                Find a record
              </label>
              <input id="lineage-search" name="q" type="search" defaultValue={q} maxLength={200} autoComplete="off" className="min-h-12 rounded-sm border border-border bg-surface px-3 text-ui" />
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
                <Link href={`/admin/archive?back=${view.slug}#new-record`} className="link">
                  Create it
                </Link>
                .
              </p>
            )
          ) : null}
          <div className="max-w-[46rem]">
            {/* Keyed by the chosen records, so a new choice from the search fills the fields again. */}
            <AddLinkForm key={`${teacher}|${student}`} lineage={view} teacherSlug={teacher || undefined} studentSlug={student || undefined} idempotencyKey={randomUUID()} initial={addResult} />
          </div>
        </Section>

        <Section id="details" title="Lineage details">
          <div className="max-w-[46rem]">
            <EditLineageForm lineage={{ id: view.id, slug: view.slug, name: view.name, description: view.description, rootSlug: view.root?.slug ?? null }} initial={editResult} />
          </div>
        </Section>
      </div>
    </Frame>
  );
}
