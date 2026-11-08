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
//
// M10b: "Report profile" under a public profile that is not the viewer's own (/people/<slug>/report).
// M19: the "Training passport" section (passport.get: the public DTO only, as the plan of the
// person's account shows it); "Manage your passport" on one's own; staff with a verified second
// factor can remove an entry it shows.

import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { UpcomingEvents } from '@/components/events/event-list';
import { GalleryGrid } from '@/components/gallery/gallery-grid';
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
  PersonIdentity,
  PersonReadings,
  PersonViews,
  PrivateRecordNotice,
} from '@/components/lineage/person-header';
import { PersonLayout } from '@/components/lineage/person-layout';
import { PhotoControl } from '@/components/lineage/photo-control';
import { PassportView } from '@/components/passport/passport-view';
import { LineageName } from '@/components/lineage/person-name';
import { notOnRecordMetadata, PersonNotFound } from '@/components/lineage/person-not-found';
import { bySeniority, groupRelations, RelationList, type RelationRow, sharedLineage, studentRows } from '@/components/lineage/relation-list';
import { EmptyState, FailedSections, ProfileError, Section, SectionError } from '@/components/lineage/states';
import { asStudentEdges, kindsOf, sameNameNotes, startYear } from '@/components/lineage/status';
import { buttonVariants } from '@/components/ui/button-variants';
import type { EventListDto } from '@/server/dto/events';
import { PASSPORT_KIND_LABELS, type PassportDto } from '@/server/dto/passport';
import type { LineageGraphDto, PersonProfileDto, StudentsPageDto } from '@/server/dto/public';
import { hasStaff2FA } from '@/server/auth/guards';
import { getRequestPrincipal } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import type { GalleryView } from '@/server/services/gallery';
import { failure, lineageClient, profileFor } from './data';
import { PASSPORT_REMOVE_FORM } from './form-ids';
import { PassportRemoveForm } from './passport-remove-form';

export const instant = false;

/** Students listed on the profile, the earliest first; the list view has them all. */
const STUDENTS_ON_PROFILE = 12;
/** M17: the upcoming events on a profile; the rest are one link away. */
const EVENTS_ON_PROFILE = 3;
/** A longer text than this is clamped to three lines on the profile, with "Read all". */
const BIO_CLAMP = 240;

const RELATION_HEADINGS = [
  { id: 'teachers-heading', title: 'Teachers' },
  { id: 'students-heading', title: 'Students' },
] as const;

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

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

/**
 * M16: the person's gallery (gallery.get: public people, the owner and staff with a second
 * factor). A failed read only leaves the section out; the profile itself is already there.
 */
async function readGallery(profile: PersonProfileDto): Promise<GalleryView | null> {
  if (profile.limited) return null;
  try {
    return await (await lineageClient()).gallery.get({ slug: profile.slug });
  } catch (error) {
    // NOT_FOUND is an answer, not a failure: a person this viewer sees in full (people.get) but
    // who is not public (involved_only, seen by the teacher who added them) shows no gallery.
    if (failure(error) === 'NOT_FOUND') return null;
    console.error(`[person-page] the gallery could not be loaded: ${failure(error)}`);
    return null;
  }
}

/**
 * M17: the person's upcoming events (as organizer or instructor), from events.list: only events
 * that name them as a public person. A failed read only leaves the section out.
 */
async function readEvents(profile: PersonProfileDto): Promise<EventListDto | null> {
  if (profile.limited || profile.visibility !== 'public') return null;
  try {
    return await (await lineageClient()).events.list({ when: 'upcoming', person: profile.slug, limit: EVENTS_ON_PROFILE });
  } catch (error) {
    console.error(`[person-page] the events could not be loaded: ${failure(error)}`);
    return null;
  }
}

/**
 * M19: the person's training passport (passport.get: public people only, the public DTO). A failed
 * read only leaves the section out.
 */
async function readPassport(profile: PersonProfileDto): Promise<PassportDto | null> {
  if (profile.limited || profile.visibility !== 'public') return null;
  try {
    return await (await lineageClient()).passport.get({ slug: profile.slug });
  } catch (error) {
    if (failure(error) === 'NOT_FOUND') return null;
    console.error(`[person-page] the passport could not be loaded: ${failure(error)}`);
    return null;
  }
}

/** The entries staff can remove: those the profile shows. */
function removableEntries(passport: PassportDto): { value: string; label: string }[] {
  const all = [...(passport.currentRank ? [passport.currentRank] : []), ...passport.timeline.flatMap((y) => y.items)];
  const seen = new Set<string>();
  return all
    .filter((e) => {
      const key = `${e.kind}:${e.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((e) => ({ value: `${e.kind}:${e.id}`, label: `${PASSPORT_KIND_LABELS[e.kind]}: ${e.title} (${e.dateText})` }));
}

/** M16: "Photos": the grid and its viewer; for the owner the count and "Manage photos". */
function Photos({ gallery }: { gallery: GalleryView }) {
  if (gallery.photos.length === 0 && !gallery.canChange) return null;
  return (
    <section aria-labelledby="photos-heading" className="grid gap-4 border-t border-border-subtle pt-6" data-testid="profile-gallery">
      <h2 id="photos-heading" className="font-display text-2xl">
        Photos
        {gallery.photos.length > 0 ? (
          <span className="text-fg-subtle tabular">
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, </span>
            {gallery.photos.length}
          </span>
        ) : null}
      </h2>
      {gallery.photos.length > 0 ? (
        <GalleryGrid photos={gallery.photos} name={gallery.displayName} label={`Photos of ${gallery.displayName}`} />
      ) : (
        <p className="text-fg-muted">No photos in your gallery yet.</p>
      )}
      {gallery.canChange ? (
        <p className="flex flex-wrap items-center gap-x-3 text-sm text-fg-muted">
          {gallery.allowance ? <span data-testid="gallery-allowance">{gallery.allowance.sentence}</span> : null}
          <Link href="/dashboard/photos" prefetch={false} className="link inline-flex min-h-11 items-center" data-testid="manage-photos">
            Manage photos
          </Link>
        </p>
      ) : null}
    </section>
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

export default async function PersonPage({ params, searchParams }: Props) {
  const read = await profileFor(params);
  if (read.state === 'none') return <PersonNotFound />;
  if (read.state === 'failed') return <ProfileError retryHref={`/people/${encodeURIComponent(read.slug)}`} />;
  const { profile } = read;
  const [relations, gallery, events, passport] = await Promise.all([readRelations(profile), readGallery(profile), readEvents(profile), readPassport(profile)]);
  const here = `/people/${profile.slug}`;
  const query = await searchParams;
  const passportStaff = passport !== null && hasStaff2FA(await getRequestPrincipal());
  const removable = passportStaff ? removableEntries(passport) : [];
  const removeOutcome = removable.length > 0 ? await readFormResult(PASSPORT_REMOVE_FORM, query.outcome) : null;
  // The key lists what the rows draw: the teachers' strokes, and the students' without the
  // cross-lineage curve.
  const shownEdges = relations.ok
    ? [
        ...relations.teachers.edges.filter((e) => e.studentId === profile.id),
        ...asStudentEdges([...relations.students.own, ...relations.students.active, ...relations.students.historical].flatMap((s) => s.edges)),
      ]
    : [];
  // People beside the public counts, as in the sections: a teacher whose every relationship with
  // this person is the viewer's own request, and the students of the own rows (one per student).
  const pending = relations.ok
    ? {
        teachers: teacherRows(profile, relations.teachers).filter((t) => t.edges.every((e) => e.visibility === 'involved_only')).length,
        students: relations.students.own.length,
      }
    : undefined;

  return (
    <PersonLayout
      header={
        <>
          <PersonIdentity profile={profile}>
            <p className="eyebrow">Person on the record</p>
            <PersonHeading profile={profile} />
            <PersonReadings profile={profile} />
            <FactStrip profile={profile} />
          </PersonIdentity>
          {/* M14: the owner's photo controls (their own record only, never a limited view). */}
          {profile.isOwn && !profile.limited ? <PhotoControl hasPhoto={Boolean(profile.photo)} /> : null}
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
      {passport ? (
        <PassportView
          passport={passport}
          own={profile.isOwn}
          footer={
            <>
              {query['passport-removed'] === '1' && passportStaff ? (
                <p role="status" className="text-sm font-semibold" data-testid="passport-removed">
                  The entry was removed. Its owner was told why.
                </p>
              ) : null}
              {profile.isOwn ? (
                <p className="text-sm">
                  <Link href="/dashboard/passport" prefetch={false} className="link inline-flex min-h-11 items-center" data-testid="manage-passport">
                    Manage your passport
                  </Link>
                </p>
              ) : null}
              {removable.length > 0 ? (
                <section aria-labelledby="passport-moderation" className="grid gap-3 rounded-sm border border-border-strong p-4" data-testid="passport-moderation">
                  <h3 id="passport-moderation" className="font-display text-lg">
                    Moderation
                  </h3>
                  <PassportRemoveForm slug={profile.slug} entries={removable} initial={removeOutcome} />
                </section>
              ) : null}
            </>
          }
        />
      ) : null}
      {gallery ? <Photos gallery={gallery} /> : null}
      {events ? (
        <UpcomingEvents
          items={events.items}
          total={events.total}
          allHref={`/events?person=${profile.slug}`}
          className="grid gap-1 border-t border-border-subtle pt-6"
          headingClassName="font-display text-2xl"
        />
      ) : null}
      {/* M10b: "Report profile" for a public profile that is not the viewer's own (one report per
          account and profile; the page asks to sign in first). */}
      {profile.visibility === 'public' && !profile.isOwn && !profile.limited ? (
        <p className="border-t border-border-subtle pt-6 text-sm text-fg-muted">
          Something wrong on this profile?{' '}
          <Link href={`${here}/report`} prefetch={false} className="link inline-flex min-h-11 items-center" data-testid="report-profile">
            Report profile
          </Link>
        </p>
      ) : null}
    </PersonLayout>
  );
}
