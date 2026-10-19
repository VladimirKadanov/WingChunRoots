// /people/[slug] (plan §4.10, §6.3; milestone M04): a person's public profile. The header (names
// in every script, readings, one line of facts) comes from people.get; the teachers from
// lineage.ego and the students from people.students (the earliest first, as on a register). Both
// are read before the page is rendered, so teachers and students are in the first HTML and work
// without JavaScript. A person the viewer may not see gets the same "Not on the record" page, with
// status 404, as a missing address (src/proxy.ts, plan §6.4). The page reads the session (a
// participant also sees their own pending requests, DEFAULT D03), so it renders per request.
//
// Errors (plan §5.6, In scope 6): a failed profile read shows the page's own error state inside
// the app shell. A failed teachers-and-students read keeps the header and shows the error under
// the sections' own headings: on the server as a Retry link (a reload, without JavaScript), and
// in the browser as the catchError boundary's Retry button, which fetches the page again.

import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { ArrowRightIcon } from '@/components/icons';
import { LineageKey } from '@/components/lineage/key';
import { FocusAfterRetry, LineageBoundary } from '@/components/lineage/lineage-boundary';
import {
  countText,
  FactStrip,
  foundedLineages,
  pendingText,
  PersonCounts,
  PersonHeading,
  PersonReadings,
  PersonViews,
  PrivateRecordNotice,
} from '@/components/lineage/person-header';
import { PersonLayout } from '@/components/lineage/person-layout';
import { LineageName } from '@/components/lineage/person-name';
import { notOnRecordMetadata, PersonNotFound } from '@/components/lineage/person-not-found';
import { bySeniority, groupRelations, RelationList, type RelationRow, sharedLineage, studentRows } from '@/components/lineage/relation-list';
import { EmptyState, FailedSections, ProfileError, Section, SectionError } from '@/components/lineage/states';
import { asStudentEdges, kindsOf, sameNameNotes, startYear } from '@/components/lineage/status';
import { buttonVariants } from '@/components/ui/button-variants';
import type { LineageGraphDto, PersonProfileDto, StudentsPageDto } from '@/server/dto/public';
import { failure, lineageClient, profileFor } from './data';

export const instant = false;

/** Students listed on the profile, the earliest first; the list view has them all. */
const STUDENTS_ON_PROFILE = 12;
/** A longer text than this is clamped to three lines on the profile, with "Read all". */
const BIO_CLAMP = 240;

const RELATION_HEADINGS = [
  { id: 'teachers-heading', title: 'Teachers' },
  { id: 'students-heading', title: 'Students' },
] as const;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const read = await profileFor(params);
  if (read.state === 'none') return notOnRecordMetadata;
  if (read.state === 'failed') return { title: 'Profile not loaded', robots: { index: false, follow: false } };
  // A private record is never indexed; public profiles wait for hosting (plan §3.3).
  return { title: read.profile.displayName, robots: { index: false } };
}

type RelationsRead = { ok: true; teachers: LineageGraphDto; students: StudentsPageDto } | { ok: false };

/** Teachers (one generation up) and the first students, read together before rendering. */
async function readRelations(profile: PersonProfileDto): Promise<RelationsRead> {
  const client = await lineageClient();
  const [teachers, students] = await Promise.allSettled([
    client.lineage.ego({ focusId: profile.id, up: 1, down: 0, fanoutLimit: 1 }),
    client.people.students({ slug: profile.slug, page: 1, pageSize: STUDENTS_ON_PROFILE, order: 'seniority' }),
  ]);
  for (const [section, read] of [
    ['teachers', teachers],
    ['students', students],
  ] as const) {
    if (read.status === 'rejected') console.error(`[person-page] the ${section} could not be loaded: ${failure(read.reason)}`);
  }
  if (teachers.status === 'rejected' || students.status === 'rejected') return { ok: false };
  return { ok: true, teachers: teachers.value, students: students.value };
}

/**
 * Thrown inside a Suspense boundary when the read failed, so the server sends that boundary's
 * fallback (the error with a Retry link) and the browser hands the error to the catchError
 * boundary around it (the error with a Retry button). The message names no person and no query.
 */
function RelationsReadFailed(): never {
  throw new Error('The teachers and students could not be loaded.');
}

/** The teachers, the display-primary one first (DEFAULT D05), then by name. */
function teacherRows(profile: PersonProfileDto, graph: LineageGraphDto): RelationRow[] {
  const people = new Map(graph.nodes.map((n) => [n.id, n]));
  const rank = (row: RelationRow) => (row.edges.some((e) => e.kind === 'primary') ? 0 : 1);
  return groupRelations(
    graph.edges.filter((e) => e.studentId === profile.id),
    (e) => e.teacherId,
    (id) => people.get(id),
  ).sort((a, b) => rank(a) - rank(b) || a.person.displayName.localeCompare(b.person.displayName, 'en'));
}

/** Same names in one list get a note in words (design review: "Anna Notreal" twice). */
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

function Relations({ profile, teachers: graph, students: page }: { profile: PersonProfileDto; teachers: LineageGraphDto; students: StudentsPageDto }) {
  const lineages = new Map([...graph.lineages, ...page.lineages].map((l) => [l.id, l]));
  const lineageName = (id: string) => lineages.get(id)?.name;
  const teachers = withNotes(teacherRows(profile, graph), lineageName);
  // The viewer's own requests first (only the participants see them), then the earliest.
  const students = withNotes(studentRows([...page.own, ...bySeniority([...page.active, ...page.historical])]), lineageName);
  const hiddenTeachers = graph.hiddenCounts[profile.id]?.teachers ?? 0;
  // The viewer's own requests are shown to them and never counted (DEFAULT D03): say so.
  const pendingTeachers = teachers.filter((t) => t.edges.every((e) => e.visibility === 'involved_only')).length;
  const publicStudents = page.activeTotal + page.historicalTotal;
  const listHref = `/people/${profile.slug}/lineage`;
  const founded = foundedLineages(profile);
  const shownPublic = students.length - page.own.length;
  const studentLineage = sharedLineage(students);
  const descendants = profile.counts.descendants;

  return (
    <div className="grid gap-10">
      <FocusAfterRetry targetId="teachers-heading" statusId="relations-status" message="Teachers and students loaded." />
      <Section id="teachers-heading" title="Teachers" count={countText(profile.counts.teachers)} focusable>
        {pendingTeachers > 0 ? <p className="text-sm text-fg-muted">{pendingText(pendingTeachers)}</p> : null}
        {teachers.length > 0 ? (
          <RelationList rows={teachers} lineages={lineages} role="teacher" label={`Teachers of ${profile.displayName}`} />
        ) : founded.length > 0 ? (
          // DEFAULT D22: a founder is named only when the record says so.
          <EmptyState>
            Founder of{' '}
            {founded.map((l, i) => (
              <span key={l.id}>
                {i > 0 ? ' and ' : null}
                <LineageName name={l.name} />
              </span>
            ))}{' '}
            as recorded. No earlier teacher is on the record.
          </EmptyState>
        ) : (
          <EmptyState>No teachers are on the record.</EmptyState>
        )}
        {hiddenTeachers > 0 ? (
          <p className="text-sm text-fg-muted">
            {hiddenTeachers} more {hiddenTeachers === 1 ? 'teacher is' : 'teachers are'} on the record.{' '}
            <Link href={listHref} prefetch={false} className="link inline-flex min-h-11 items-center">
              See them in the list view
            </Link>
          </p>
        ) : null}
      </Section>

      <Section id="students-heading" title="Students" count={countText(profile.counts.students)}>
        {page.own.length > 0 ? <p className="text-sm text-fg-muted">{pendingText(page.own.length)}</p> : null}
        {students.length > 0 ? (
          <>
            {publicStudents > shownPublic ? (
              <p className="text-sm text-fg-muted">
                The {shownPublic.toLocaleString('en')} earliest of {publicStudents.toLocaleString('en')}, by the year their training began.
                {studentLineage && lineages.get(studentLineage) ? (
                  <>
                    {' '}
                    All in <LineageName name={lineages.get(studentLineage)!.name} />.
                  </>
                ) : null}
              </p>
            ) : studentLineage && lineages.get(studentLineage) ? (
              <p className="text-sm text-fg-muted">
                All in <LineageName name={lineages.get(studentLineage)!.name} />.
              </p>
            ) : null}
            <RelationList
              rows={students}
              lineages={lineages}
              role="student"
              groupLineageId={studentLineage}
              nameSize="lg"
              label={`Students of ${profile.displayName}`}
            />
          </>
        ) : (
          <EmptyState>No students are on the record.</EmptyState>
        )}
        {publicStudents > shownPublic || descendants > publicStudents ? (
          <p>
            <Link href={listHref} prefetch={false} className={buttonVariants({ variant: 'secondary' })}>
              {publicStudents > shownPublic
                ? `All ${publicStudents.toLocaleString('en')} students in the list view`
                : `All ${countText(descendants, profile.counts.descendantsCapped)} descendants in the list view`}
              <ArrowRightIcon />
            </Link>
          </p>
        ) : null}
        {publicStudents > shownPublic && descendants > publicStudents ? (
          <p className="text-sm text-fg-muted">
            {countText(descendants, profile.counts.descendantsCapped)} descendants in all, with the routes of descent, in the same view.
          </p>
        ) : null}
      </Section>
    </div>
  );
}

function About({ bio }: { bio: string }) {
  return (
    <section aria-labelledby="about-heading" className="grid gap-3 border-t border-border-subtle pt-6">
      <h2 id="about-heading" className="font-display text-2xl">
        About
      </h2>
      {bio.length > BIO_CLAMP ? (
        // Clamped to three lines until "Read all" is opened (a <details>, no JavaScript needed).
        <div className="group/bio grid gap-1">
          <p aria-hidden="true" className="line-clamp-3 max-w-[62ch] text-base text-fg-muted group-has-[details[open]]/bio:hidden">
            {bio}
          </p>
          <details>
            <summary className="link inline-flex min-h-11 cursor-pointer list-none items-center text-ui [&::-webkit-details-marker]:hidden">
              <span className="group-has-[details[open]]/bio:hidden">Read all</span>
              <span className="hidden group-has-[details[open]]/bio:inline">Show less</span>
            </summary>
            <p className="max-w-[62ch] text-base text-fg-muted">{bio}</p>
          </details>
        </div>
      ) : (
        <p className="max-w-[62ch] text-base text-fg-muted">{bio}</p>
      )}
    </section>
  );
}

export default async function PersonPage({ params }: Props) {
  const read = await profileFor(params);
  if (read.state === 'none') return <PersonNotFound />;
  if (read.state === 'failed') return <ProfileError retryHref={`/people/${encodeURIComponent(read.slug)}`} />;
  const { profile } = read;
  const relations = await readRelations(profile);
  const here = `/people/${profile.slug}`;
  // The key lists what the rows draw: the teachers' strokes, and the students' without the
  // cross-lineage curve.
  const shownEdges = relations.ok
    ? [
        ...relations.teachers.edges.filter((e) => e.studentId === profile.id),
        ...asStudentEdges([...relations.students.own, ...relations.students.active, ...relations.students.historical].flatMap((s) => s.edges)),
      ]
    : [];
  const pending = relations.ok
    ? {
        teachers: relations.teachers.edges.filter((e) => e.studentId === profile.id && e.visibility === 'involved_only').length,
        students: relations.students.own.length,
      }
    : undefined;

  return (
    <PersonLayout
      header={
        <>
          <p className="eyebrow">Person on the record</p>
          <PersonHeading profile={profile} />
          <PersonReadings profile={profile} />
          <FactStrip profile={profile} />
          {profile.visibility === 'involved_only' ? <PrivateRecordNotice own={profile.isOwn} limited={profile.limited} /> : null}
        </>
      }
      rail={
        <>
          <PersonViews profile={profile} current="profile" />
          <PersonCounts profile={profile} pending={pending} className="hidden xl:grid" />
          <LineageKey kinds={kindsOf(shownEdges)} />
        </>
      }
    >
      <p id="relations-status" role="status" className="sr-only" />
      <LineageBoundary what="teachers and students" headings={RELATION_HEADINGS}>
        {relations.ok ? (
          <Relations profile={profile} teachers={relations.teachers} students={relations.students} />
        ) : (
          <Suspense
            fallback={
              <FailedSections headings={RELATION_HEADINGS}>
                <SectionError what="teachers and students" retryHref={here} />
              </FailedSections>
            }
          >
            <RelationsReadFailed />
          </Suspense>
        )}
      </LineageBoundary>
      {profile.bio ? <About bio={profile.bio} /> : null}
    </PersonLayout>
  );
}
