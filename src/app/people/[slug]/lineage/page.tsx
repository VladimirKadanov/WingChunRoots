// /people/[slug]/lineage (plan §4.10; milestone M04): the list view of a person's lineage, a full
// alternative to the graph. Teachers with lineage, period, status in words and whether the
// training has ended; the routes of descent, drawn as an ink spine; the students, active and
// historical, as register rows in pages; and the descendants as a nested outline. Everything is
// read before the first byte is sent and rendered on the server, so the page works without
// JavaScript (streamed Suspense content would need inline scripts). A section whose read fails
// says so in place, under its own heading, with a Retry link that is a plain reload; the rest of
// the page stands. A person the viewer may not see gets "Not on the record", never indexed, the
// same as a missing address (plan §6.4; status 200 until the owner decides, ADR 0008).

import type { Metadata } from 'next';
import Link from 'next/link';

import { DescendantsOutline, outlineIntro, outlineSummary } from '@/components/lineage/descendants-outline';
import { LineageKey } from '@/components/lineage/key';
import {
  countText,
  FactStrip,
  pendingText,
  PersonCounts,
  PersonHeading,
  PersonReadings,
  PersonViews,
  PrivateRecordNotice,
} from '@/components/lineage/person-header';
import { PersonLayout } from '@/components/lineage/person-layout';
import { LatinName, LineageName } from '@/components/lineage/person-name';
import { notOnRecordMetadata, PersonNotFound } from '@/components/lineage/person-not-found';
import { groupRelations, RelationList, type RelationRow, sharedLineage, studentRows } from '@/components/lineage/relation-list';
import { RoutesOfDescent } from '@/components/lineage/routes-of-descent';
import { EmptyState, ProfileError, Section, SectionError } from '@/components/lineage/states';
import { asStudentEdges, kindsOf, sameNameNotes, startYear, studentTotalsText } from '@/components/lineage/status';
import type { LineageRefDto, PersonProfileDto, StudentsPageDto } from '@/server/dto/public';
import { failure, lineageClient, profileFor } from '../data';

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
  const read = await profileFor(params);
  if (read.state === 'none') return notOnRecordMetadata;
  if (read.state === 'failed') return { title: 'Lineage list not loaded', robots: { index: false, follow: false } };
  return { title: `${read.profile.displayName} · Lineage list`, robots: { index: false } };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A page number from the query, or 1 when it is missing or not a page the API serves. */
function pageFrom(value: string | undefined): number {
  const page = value && /^\d{1,4}$/.test(value) ? Number(value) : 1;
  return page >= 1 && page <= MAX_PAGE ? page : 1;
}

/** Same names in one list get a note in words (design review: two "Oscar Stubbard"). */
function withNotes(rows: RelationRow[], lineageName: (id: string) => string | undefined): RelationRow[] {
  const notes = sameNameNotes(
    rows.map((row) => ({
      id: row.person.id,
      displayName: row.person.displayName,
      year: startYear(row.edges.flatMap((e) => e.periods)),
      lineage: row.edges.map((e) => lineageName(e.lineageId)).find(Boolean) ?? null,
    })),
  );
  return rows.map((row) => ({ ...row, note: notes.get(row.person.id) }));
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
  const lineageName = (id: string) => lineages.get(id)?.name;
  const total = data.activeTotal + data.historicalTotal;
  const groups = [
    { key: 'own', title: 'Visible only to you and them', rows: studentRows(data.own), total: data.own.length },
    { key: 'active', title: 'Active', rows: studentRows(data.active), total: data.activeTotal },
    { key: 'historical', title: 'Historical (training ended)', rows: studentRows(data.historical), total: data.historicalTotal },
  ]
    .filter((g) => g.rows.length > 0)
    .map((g) => ({ ...g, rows: withNotes(g.rows, lineageName), lineage: sharedLineage(g.rows) }));

  if (total === 0 && data.own.length === 0) {
    return (
      <EmptyState>
        No students of <LatinName name={name} /> are on the record.
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-6">
      <p className="text-ui text-fg-muted">
        {studentTotalsText(data.activeTotal, data.historicalTotal)}
        {data.pageCount > 1 ? `, ${data.pageSize} to a page, by name` : ''}.
        {data.own.length > 0 ? ` ${pendingText(data.own.length)}.` : ''}
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
              {group.lineage && lineages.get(group.lineage) ? (
                <>
                  {' · '}
                  <LineageName name={lineages.get(group.lineage)!.name} />
                </>
              ) : null}
            </h3>
            <RelationList
              rows={group.rows}
              lineages={lineages}
              role="student"
              groupLineageId={group.lineage}
              columns
              nameSize="lg"
              label={`${group.title}: students of ${name}`}
            />
          </section>
        ))
      )}
      <Pager page={data.page} pageCount={data.pageCount} href={href} />
    </div>
  );
}

const CONTENTS = [
  { id: 'teachers-heading', label: 'Teachers' },
  { id: 'routes-heading', label: 'Routes' },
  { id: 'students-heading', label: 'Students' },
  { id: 'descendants-heading', label: 'Descendants' },
] as const;

/** The jump links: one row that scrolls sideways on a phone, a column in the side rail. */
function OnThisPage() {
  return (
    <nav aria-label="On this page" className="-mx-1 overflow-x-auto px-1 xl:mx-0 xl:overflow-visible xl:px-0">
      <ul className="flex snap-x gap-2 xl:grid xl:gap-0">
        {CONTENTS.map((c) => (
          <li key={c.id} className="shrink-0 snap-start">
            <a
              href={`#${c.id}`}
              className="inline-flex min-h-11 items-center rounded-xs border border-border-subtle px-3 text-ui whitespace-nowrap hover:border-border-strong xl:w-full xl:rounded-none xl:border-0 xl:px-0 xl:underline xl:decoration-border-strong xl:underline-offset-[0.3em] xl:hover:decoration-current"
            >
              {c.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The list view of `slug` at students page `n`, with or without "all routes". */
function listHref(slug: string, n: number, routesAll: boolean): string {
  const base = `/people/${encodeURIComponent(slug)}/lineage`;
  const search = new URLSearchParams();
  if (n > 1) search.set('page', String(n));
  if (routesAll) search.set('routes', 'all');
  return search.size > 0 ? `${base}?${search}` : base;
}

export default async function LineageListPage({ params, searchParams }: Props) {
  const read = await profileFor(params);
  if (read.state === 'none') return <PersonNotFound />;
  const query = await searchParams;
  const page = pageFrom(single(query.page));
  const allRoutes = single(query.routes) === 'all';
  // Retry opens the same view again: the same students page and routes (validated, review round 2).
  if (read.state === 'failed') return <ProfileError retryHref={listHref(read.slug, page, allRoutes)} />;
  const profile: PersonProfileDto = read.profile;
  /** This view at students page `n`, with or without "all routes" (kept as it is by default). */
  const viewHref = (n: number, routesAll = allRoutes) => listHref(profile.slug, n, routesAll);
  const here = viewHref(page);
  const pageHref = (n: number) => `${viewHref(n)}#students-heading`;

  const client = await lineageClient();
  const [teachersRead, routesRead, studentsRead, outlineRead] = await Promise.allSettled([
    client.lineage.ego({ focusId: profile.id, up: 1, down: 0, fanoutLimit: 1 }),
    client.lineage.paths({ focusId: profile.id, limit: allRoutes ? ROUTES_ALL : ROUTES_SHOWN }),
    client.people.students({ slug: profile.slug, page }),
    client.lineage.subtree({ rootId: profile.id, depth: OUTLINE_DEPTH }),
  ]);
  for (const [section, result] of [
    ['teachers', teachersRead],
    ['routes', routesRead],
    ['students', studentsRead],
    ['descendants', outlineRead],
  ] as const) {
    if (result.status === 'rejected') console.error(`[lineage-list] the ${section} section could not be loaded: ${failure(result.reason)}`);
  }

  const teacherLineages = new Map(teachersRead.status === 'fulfilled' ? teachersRead.value.lineages.map((l) => [l.id, l]) : []);
  const teachers =
    teachersRead.status === 'fulfilled'
      ? withNotes(
          groupRelations(
            teachersRead.value.edges.filter((e) => e.studentId === profile.id),
            (e) => e.teacherId,
            (id) => teachersRead.value.nodes.find((n) => n.id === id),
          ).sort(
            // The display-primary teacher first (DEFAULT D05), then by name.
            (a, b) =>
              Number(!a.edges.some((e) => e.kind === 'primary')) - Number(!b.edges.some((e) => e.kind === 'primary')) ||
              a.person.displayName.localeCompare(b.person.displayName, 'en'),
          ),
          (id) => teacherLineages.get(id)?.name,
        )
      : null;
  const pendingTeachers = teachers?.filter((t) => t.edges.every((e) => e.visibility === 'involved_only')).length ?? 0;
  const outline = outlineRead.status === 'fulfilled' ? outlineRead.value : null;
  // The key lists what the page draws: the teachers' and the routes' strokes, the students' rows
  // (no cross-lineage curve), and the states the outline marks with a seal.
  const legendEdges = [
    ...(teachers ?? []).flatMap((t) => t.edges),
    ...(routesRead.status === 'fulfilled' ? routesRead.value.edges : []),
    ...asStudentEdges(
      studentsRead.status === 'fulfilled'
        ? [...studentsRead.value.active, ...studentsRead.value.historical, ...studentsRead.value.own].flatMap((s) => s.edges)
        : [],
    ),
    ...(outline?.edges ?? []).filter((e) => e.visibility !== 'public' || e.status !== 'verified').map((e) => ({ status: e.status, periods: [] })),
  ];
  const outlineCounts = outline ? outlineSummary(outline, profile.id, true) : null;

  return (
    <PersonLayout
      header={
        <>
          <p className="eyebrow">Lineage list</p>
          <PersonHeading profile={profile} prefix="Lineage of " />
          <PersonReadings profile={profile} />
          <FactStrip profile={profile} />
          {profile.visibility === 'involved_only' ? <PrivateRecordNotice own={profile.isOwn} limited={profile.limited} /> : null}
        </>
      }
      rail={
        <>
          <PersonViews profile={profile} current="list" />
          <OnThisPage />
          <PersonCounts
            profile={profile}
            pending={{ teachers: pendingTeachers, students: studentsRead.status === 'fulfilled' ? studentsRead.value.own.length : 0 }}
            className="hidden xl:grid"
          />
          <LineageKey kinds={kindsOf(legendEdges)} />
        </>
      }
    >
      <Section id="teachers-heading" title="Teachers" count={countText(profile.counts.teachers)}>
        {teachers === null ? (
          <SectionError what="teachers" retryHref={here} />
        ) : teachers.length > 0 ? (
          <>
            {pendingTeachers > 0 ? <p className="text-sm text-fg-muted">{pendingText(pendingTeachers)}</p> : null}
            <RelationList rows={teachers} lineages={teacherLineages} role="teacher" label={`Teachers of ${profile.displayName}`} />
          </>
        ) : (
          <EmptyState>
            No teachers of <LatinName name={profile.displayName} /> are on the record.
          </EmptyState>
        )}
      </Section>

      <Section
        id="routes-heading"
        title="Routes of descent"
        count={routesRead.status === 'fulfilled' && routesRead.value.totalPaths > 0 ? countText(routesRead.value.totalPaths, routesRead.value.totalPathsCapped) : undefined}
      >
        {routesRead.status === 'fulfilled' ? (
          <RoutesOfDescent paths={routesRead.value} focusName={profile.displayName} moreHref={allRoutes ? null : `${viewHref(page, true)}#routes-heading`} />
        ) : (
          <SectionError what="routes of descent" retryHref={here} />
        )}
      </Section>

      <Section id="students-heading" title="Students" count={countText(profile.counts.students)}>
        {studentsRead.status === 'fulfilled' ? (
          <Students data={studentsRead.value} name={profile.displayName} href={pageHref} />
        ) : (
          <SectionError what="students" retryHref={here} />
        )}
      </Section>

      <Section id="descendants-heading" title="Descendants" count={countText(profile.counts.descendants, profile.counts.descendantsCapped)}>
        {outline && outlineCounts ? (
          outlineCounts.listed > 0 ? (
            <div className="grid gap-3">
              <p className="text-ui text-fg-muted">{outlineIntro(outlineCounts)}</p>
              <DescendantsOutline graph={outline} rootId={profile.id} depth={OUTLINE_DEPTH} teachingOnly />
              {outline.truncated ? (
                <p className="text-sm text-fg-muted">
                  The outline stops at {outline.nodes.length.toLocaleString('en')} people; each person’s own list has the rest.
                </p>
              ) : null}
            </div>
          ) : outlineCounts.total > 0 ? (
            <EmptyState>
              None of the students of <LatinName name={profile.displayName} /> has students of their own on the record.
            </EmptyState>
          ) : (
            <EmptyState>
              No descendants of <LatinName name={profile.displayName} /> are on the record.
            </EmptyState>
          )
        ) : (
          <SectionError what="descendants" retryHref={here} />
        )}
      </Section>
    </PersonLayout>
  );
}
