// /people/[slug]/lineage (plan §4.10; milestone M04): the list view of a person's lineage, a full
// alternative to the graph. Teachers with lineage, period, status in words and whether the
// training has ended; the routes of descent; the students, active and historical, in pages; and
// the descendants as a nested outline. Everything is read before the first byte is sent and
// rendered on the server, so the page works without JavaScript (streamed Suspense content would
// need inline scripts). A section whose read fails says so in place, with a Retry link that is a
// plain reload; the rest of the page stands.

import type { Metadata } from 'next';
import Link from 'next/link';

import { DescendantsOutline } from '@/components/lineage/descendants-outline';
import { PersonCounts, PersonNames, PersonViews, PrivateRecordNotice } from '@/components/lineage/person-header';
import { notOnRecordMetadata, PersonNotFound } from '@/components/lineage/person-not-found';
import { LatinName } from '@/components/lineage/person-name';
import { groupRelations, RelationList, type RelationRow } from '@/components/lineage/relation-list';
import { RoutesOfDescent } from '@/components/lineage/routes-of-descent';
import { EmptyState, SectionError } from '@/components/lineage/states';
import { StatusLegend } from '@/components/lineage/status-legend';
import { kindsOf } from '@/components/lineage/status';
import { cx } from '@/lib/cx';
import type { LineageRefDto, StudentEntryDto, StudentsPageDto } from '@/server/dto/public';
import { lineageClient, profileFor } from '../data';

export const instant = false;

/** Routes shown by default, and with "show all" (the lineage.paths ceiling). */
const ROUTES_SHOWN = 10;
const ROUTES_ALL = 200;
/** Generations read for the outline: two open on load, the third behind a closed <details>. */
const OUTLINE_DEPTH = 3;
/** The students pages the API serves (lineage studentsInput). */
const MAX_PAGE = 1000;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await profileFor(params);
  if (!profile) return notOnRecordMetadata;
  return { title: `${profile.displayName} · Lineage list`, robots: { index: false } };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A page number from the query, or 1 when it is missing or not a page the API serves. */
function pageFrom(value: string | undefined): number {
  const page = value && /^\d{1,4}$/.test(value) ? Number(value) : 1;
  return page >= 1 && page <= MAX_PAGE ? page : 1;
}

/** The reason a section failed, for the server log: a code or an error name, never the data. */
function failure(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'code' in reason && typeof reason.code === 'string') return reason.code;
  return reason instanceof Error ? reason.name : 'unknown';
}

function Section({ id, title, children, className }: { id: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cx('grid scroll-mt-24 content-start gap-4 border-t border-border-subtle pt-6', className)}>
      <h2 id={id} className="font-display text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

function studentRows(entries: readonly StudentEntryDto[]): RelationRow[] {
  return entries.map((entry) => ({ person: entry.person, edges: entry.edges }));
}

function Pager({ page, pageCount, href }: { page: number; pageCount: number; href: (page: number) => string }) {
  if (pageCount <= 1) return null;
  const link = 'link inline-flex min-h-11 items-center';
  return (
    <nav aria-label="Pages of students" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-ui">
      {page > 1 ? (
        <Link href={href(page - 1)} prefetch={false} className={link} rel="prev">
          Previous page
        </Link>
      ) : null}
      <span className="tabular text-fg-muted" aria-current="page">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={href(page + 1)} prefetch={false} className={link} rel="next">
          Next page
        </Link>
      ) : null}
    </nav>
  );
}

function Students({ data, name, href }: { data: StudentsPageDto; name: string; href: (page: number) => string }) {
  const lineages = new Map<string, LineageRefDto>(data.lineages.map((l) => [l.id, l]));
  const total = data.activeTotal + data.historicalTotal;
  const groups = [
    { key: 'own', title: 'Visible only to you and them', rows: studentRows(data.own), total: data.own.length },
    { key: 'active', title: 'Active', rows: studentRows(data.active), total: data.activeTotal },
    { key: 'historical', title: 'Historical (training ended)', rows: studentRows(data.historical), total: data.historicalTotal },
  ].filter((g) => g.rows.length > 0);

  if (total === 0 && data.own.length === 0) {
    return (
      <EmptyState>
        No students of <LatinName name={name} /> are on the record yet.
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-6">
      <p className="text-ui text-fg-muted">
        {data.activeTotal.toLocaleString('en')} active and {data.historicalTotal.toLocaleString('en')} historical{' '}
        {total === 1 ? 'student' : 'students'}
        {data.pageCount > 1 ? `, ${data.pageSize} to a page` : ''}.
      </p>
      {groups.length === 0 ? (
        <EmptyState>
          There are no students on this page.{' '}
          <Link href={href(1)} prefetch={false} className="link inline-flex min-h-11 items-center">
            Go to the first page
          </Link>
        </EmptyState>
      ) : (
        groups.map((group) => (
          <section key={group.key} aria-labelledby={`students-${group.key}`} className="grid gap-3">
            <h3 id={`students-${group.key}`} className="eyebrow">
              {group.title} · {group.total.toLocaleString('en')}
            </h3>
            <RelationList rows={group.rows} lineages={lineages} detail="full" label={`${group.title}: students of ${name}`} />
          </section>
        ))
      )}
      <Pager page={data.page} pageCount={data.pageCount} href={href} />
    </div>
  );
}

export default async function LineageListPage({ params, searchParams }: Props) {
  const profile = await profileFor(params);
  if (!profile) return <PersonNotFound />;
  const query = await searchParams;
  const page = pageFrom(single(query.page));
  const allRoutes = single(query.routes) === 'all';
  const base = `/people/${profile.slug}/lineage`;
  /** This view at students page `n`, with or without "all routes" (kept as it is by default). */
  const viewHref = (n: number, routesAll = allRoutes) => {
    const search = new URLSearchParams();
    if (n > 1) search.set('page', String(n));
    if (routesAll) search.set('routes', 'all');
    return search.size > 0 ? `${base}?${search}` : base;
  };
  const here = viewHref(page);
  const pageHref = (n: number) => `${viewHref(n)}#students-heading`;

  const client = await lineageClient();
  const [teachersRead, routesRead, studentsRead, outlineRead] = await Promise.allSettled([
    client.lineage.ego({ focusId: profile.id, up: 1, down: 0, fanoutLimit: 1 }),
    client.lineage.paths({ focusId: profile.id, limit: allRoutes ? ROUTES_ALL : ROUTES_SHOWN }),
    client.people.students({ slug: profile.slug, page }),
    client.lineage.subtree({ rootId: profile.id, depth: OUTLINE_DEPTH }),
  ]);
  for (const [section, read] of [
    ['teachers', teachersRead],
    ['routes', routesRead],
    ['students', studentsRead],
    ['descendants', outlineRead],
  ] as const) {
    if (read.status === 'rejected') console.error(`[lineage-list] the ${section} section could not be loaded: ${failure(read.reason)}`);
  }

  const teachers =
    teachersRead.status === 'fulfilled'
      ? groupRelations(
          teachersRead.value.edges.filter((e) => e.studentId === profile.id),
          (e) => e.teacherId,
          (id) => teachersRead.value.nodes.find((n) => n.id === id),
        ).sort(
          // The display-primary teacher first (DEFAULT D05), then by name.
          (a, b) =>
            Number(!a.edges.some((e) => e.kind === 'primary')) - Number(!b.edges.some((e) => e.kind === 'primary')) ||
            a.person.displayName.localeCompare(b.person.displayName, 'en'),
        )
      : null;
  const teacherLineages = new Map(teachersRead.status === 'fulfilled' ? teachersRead.value.lineages.map((l) => [l.id, l]) : []);
  const legendEdges = [
    ...(teachersRead.status === 'fulfilled' ? teachersRead.value.edges : []),
    ...(routesRead.status === 'fulfilled' ? routesRead.value.edges : []),
    ...(studentsRead.status === 'fulfilled'
      ? [...studentsRead.value.active, ...studentsRead.value.historical, ...studentsRead.value.own].flatMap((s) => s.edges)
      : []),
  ];

  const contents = [
    { id: 'teachers-heading', label: 'Teachers' },
    { id: 'routes-heading', label: 'Routes of descent' },
    { id: 'students-heading', label: 'Students' },
    { id: 'descendants-heading', label: 'Descendants' },
  ];

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="grid max-w-[52rem] gap-10">
        <header className="grid gap-5">
          <p className="eyebrow">Lineage list</p>
          <h1 className="text-feature [overflow-wrap:anywhere]">
            <PersonNames profile={profile} />
          </h1>
          {profile.visibility === 'involved_only' ? <PrivateRecordNotice own={profile.isOwn} /> : null}
          <PersonCounts profile={profile} />
          <PersonViews profile={profile} current="list" />
          <nav aria-label="On this page">
            <ul className="flex flex-wrap gap-x-5 text-ui">
              {contents.map((c) => (
                <li key={c.id}>
                  <a href={`#${c.id}`} className="link inline-flex min-h-11 items-center">
                    {c.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <Section id="teachers-heading" title="Teachers">
          {teachers === null ? (
            <SectionError what="teachers" retryHref={here} />
          ) : teachers.length > 0 ? (
            <RelationList rows={teachers} lineages={teacherLineages} detail="full" label={`Teachers of ${profile.displayName}`} />
          ) : (
            <EmptyState>
              No teachers of <LatinName name={profile.displayName} /> are on the record yet.
            </EmptyState>
          )}
        </Section>

        <Section id="routes-heading" title="Routes of descent">
          {routesRead.status === 'fulfilled' ? (
            <RoutesOfDescent
              paths={routesRead.value}
              focusName={profile.displayName}
              moreHref={allRoutes ? null : `${viewHref(page, true)}#routes-heading`}
            />
          ) : (
            <SectionError what="routes of descent" retryHref={here} />
          )}
        </Section>

        <Section id="students-heading" title="Students">
          {studentsRead.status === 'fulfilled' ? (
            <Students data={studentsRead.value} name={profile.displayName} href={pageHref} />
          ) : (
            <SectionError what="students" retryHref={here} />
          )}
        </Section>

        <Section id="descendants-heading" title="Descendants">
          {outlineRead.status === 'fulfilled' ? (
            outlineRead.value.edges.some((e) => e.teacherId === profile.id) ? (
              <div className="grid gap-3">
                <p className="text-ui text-fg-muted">
                  Students and their students, {OUTLINE_DEPTH} generations deep; the first two are open. Someone with two teachers here is listed
                  under both.
                </p>
                <DescendantsOutline graph={outlineRead.value} rootId={profile.id} depth={OUTLINE_DEPTH} />
                {outlineRead.value.truncated ? (
                  <p className="text-sm text-fg-muted">
                    The outline stops at {outlineRead.value.nodes.length.toLocaleString('en')} people; each person’s own list has the rest.
                  </p>
                ) : null}
              </div>
            ) : (
              <EmptyState>
                No descendants of <LatinName name={profile.displayName} /> are on the record yet.
              </EmptyState>
            )
          ) : (
            <SectionError what="descendants" retryHref={here} />
          )}
        </Section>

        <StatusLegend kinds={kindsOf(legendEdges, ['verified'])} id="list-key" />
      </div>
    </div>
  );
}
