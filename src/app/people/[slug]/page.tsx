// /people/[slug] (plan §4.10, §6.3; milestone M04): a person's public profile. The header (names,
// life, place at city level, the record keeper, counts) comes from people.get; teachers and
// students from lineage.ego, inside a catchError boundary with Retry, so a failed lineage read
// leaves the rest of the page standing. A person the viewer may not see gets the same "Not on the
// record" page as a missing address (plan §6.4). The page reads the session (a participant also
// sees their own pending requests, DEFAULT D03), so it renders per request.

import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { ArrowRightIcon } from '@/components/icons';
import { LineageBoundary } from '@/components/lineage/lineage-boundary';
import { notOnRecordMetadata, PersonNotFound } from '@/components/lineage/person-not-found';
import {
  PersonCounts,
  PersonFacts,
  PersonNames,
  PersonViews,
  PrivateRecordNotice,
} from '@/components/lineage/person-header';
import { groupRelations, RelationList, type RelationRow } from '@/components/lineage/relation-list';
import { EmptyState, RelationsSkeleton } from '@/components/lineage/states';
import { StatusLegend } from '@/components/lineage/status-legend';
import { kindsOf } from '@/components/lineage/status';
import { buttonVariants } from '@/components/ui/button-variants';
import type { PersonProfileDto } from '@/server/dto/public';
import { lineageClient, profileFor } from './data';

export const instant = false;

/** Students listed on the profile; the list view has them all. */
const STUDENTS_ON_PROFILE = 12;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await profileFor(params);
  if (!profile) return notOnRecordMetadata;
  return {
    title: profile.displayName,
    // A private record is never indexed; public profiles wait for hosting (plan §3.3).
    robots: { index: false },
  };
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-4 border-t border-border-subtle pt-6">
      <h2 id={id} className="font-display text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Teachers and students from the ego network: one generation each way. */
async function Relations({ profile }: { profile: PersonProfileDto }) {
  const client = await lineageClient();
  const graph = await client.lineage.ego({ focusId: profile.id, up: 1, down: 1, fanoutLimit: STUDENTS_ON_PROFILE });
  const people = new Map(graph.nodes.map((n) => [n.id, n]));
  const lineages = new Map(graph.lineages.map((l) => [l.id, l]));
  const byName = (a: RelationRow, b: RelationRow) => a.person.displayName.localeCompare(b.person.displayName, 'en');
  // The display-primary teacher first (DEFAULT D05: a visual preference, never hiding the others).
  const teacherRank = (row: RelationRow) => (row.edges.some((e) => e.kind === 'primary') ? 0 : 1);
  const teachers = groupRelations(
    graph.edges.filter((e) => e.studentId === profile.id),
    (e) => e.teacherId,
    (id) => people.get(id),
  ).sort((a, b) => teacherRank(a) - teacherRank(b) || byName(a, b));
  // Own requests first (only the participants see them), then by name.
  const ownFirst = (row: RelationRow) => (row.edges.some((e) => e.visibility === 'involved_only') ? 0 : 1);
  const students = groupRelations(
    graph.edges.filter((e) => e.teacherId === profile.id),
    (e) => e.studentId,
    (id) => people.get(id),
  ).sort((a, b) => ownFirst(a) - ownFirst(b) || byName(a, b));
  const hidden = graph.hiddenCounts[profile.id] ?? { teachers: 0, students: 0 };
  const listHref = `/people/${profile.slug}/lineage`;
  const shownEdges = graph.edges.filter((e) => e.studentId === profile.id || e.teacherId === profile.id);

  return (
    <div className="grid gap-10">
      <Section id="teachers-heading" title="Teachers">
        {teachers.length > 0 ? (
          <RelationList rows={teachers} lineages={lineages} label={`Teachers of ${profile.displayName}`} />
        ) : (
          <EmptyState>No teachers on the record yet.</EmptyState>
        )}
        {hidden.teachers > 0 ? (
          <p className="text-sm text-fg-muted">
            {hidden.teachers} more {hidden.teachers === 1 ? 'teacher is' : 'teachers are'} on the record.{' '}
            <Link href={listHref} prefetch={false} className="link">
              See them in the list view
            </Link>
          </p>
        ) : null}
      </Section>

      <Section id="students-heading" title="Students">
        {students.length > 0 ? (
          <RelationList rows={students} lineages={lineages} label={`Students of ${profile.displayName}`} />
        ) : (
          <EmptyState>No students on the record yet.</EmptyState>
        )}
        {hidden.students > 0 ? (
          <p>
            <Link href={listHref} prefetch={false} className={buttonVariants({ variant: 'secondary' })}>
              All {profile.counts.students.toLocaleString('en')} students in the list view
              <ArrowRightIcon />
            </Link>
          </p>
        ) : null}
      </Section>

      <StatusLegend kinds={kindsOf(shownEdges, ['verified'])} id="profile-key" />
    </div>
  );
}

export default async function PersonPage({ params }: Props) {
  const profile = await profileFor(params);
  if (!profile) return <PersonNotFound />;
  const listHref = `/people/${profile.slug}/lineage`;
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="grid max-w-[52rem] gap-10">
        <header className="grid gap-5">
          <p className="eyebrow">Person on the record</p>
          <h1 className="text-feature [overflow-wrap:anywhere]">
            <PersonNames profile={profile} />
          </h1>
          {profile.visibility === 'involved_only' ? <PrivateRecordNotice own={profile.isOwn} /> : null}
          <PersonFacts profile={profile} />
          <PersonCounts profile={profile} />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <PersonViews profile={profile} current="profile" />
            <Link href={listHref} prefetch={false} className="link inline-flex min-h-11 items-center text-ui">
              Routes of descent and all descendants
            </Link>
          </div>
        </header>

        {profile.bio ? (
          <section aria-labelledby="about-heading" className="grid gap-3 border-t border-border-subtle pt-6">
            <h2 id="about-heading" className="font-display text-2xl">
              About
            </h2>
            <p className="max-w-[62ch] text-base text-fg-muted">{profile.bio}</p>
          </section>
        ) : null}

        <LineageBoundary what="teachers and students">
          <Suspense fallback={<RelationsSkeleton what="teachers and students" noScriptHref={listHref} />}>
            <Relations profile={profile} />
          </Suspense>
        </LineageBoundary>
      </div>
    </div>
  );
}
