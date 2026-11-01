// Teachers and students of a person (plan §4.10; milestone M04) as register rows: the link's own
// stroke beside the name (Ink Register: every state is a stroke, a seal and a word), then the
// lineage (left out when the group heading names it), the training period and the state as a
// seal and a word. A relationship only its participants can see says so (DEFAULT D03).
//
// The cross-lineage mark belongs to a teacher's row only: it says the teacher came from another
// lineage than the person's own line. A student with teachers elsewhere reads "also a student of
// …" instead, the same words in the profile and the list view.

import { Fragment } from 'react';

import { LinkStroke } from '@/components/ink/link-stroke';
import { StatusBadge } from '@/components/ui/status-badge';
import { cx } from '@/lib/cx';
import type { LineageEdgeDto, LineageRefDto, StudentEntryDto } from '@/server/dto/public';
import { LatinName, LineageName, type PersonNameData, PersonLink } from './person-name';
import { isHistoricalRelation, periodText, relationStatus, strokeOf } from './status';

export type RelationEdge = Pick<LineageEdgeDto, 'id' | 'lineageId' | 'status' | 'visibility' | 'periods'> & {
  kind?: LineageEdgeDto['kind'];
  /** M10b (DEFAULT D04/D13): approved by a teacher not yet verified as an instructor. */
  approvedByUnverifiedInstructor?: boolean;
};

export interface RelationRow {
  person: PersonNameData & { id: string; visibility: 'public' | 'involved_only' };
  /** The person's relationships with the focus (usually one; one per lineage otherwise). */
  edges: RelationEdge[];
  /** A student's other public teachers (at most 3) and how many there are in all. */
  otherTeachers?: readonly { person: PersonNameData & { id: string }; lineageId: string }[];
  otherTeachersTotal?: number;
  /** A student's own public students. */
  studentCount?: number;
  /** Tells apart two people with the same name in one list ("since 1994"). */
  note?: string;
}

/**
 * A visual middle dot that a screen reader hears as a pause. In a flex row (`inFlex`) it takes
 * margins, because a flex row drops the spaces at the ends of its items; in running text it is
 * spaced with spaces, so a line can break after it.
 */
export function Sep({ inFlex = false }: { inFlex?: boolean }) {
  return (
    <>
      <span aria-hidden="true" className={inFlex ? 'mx-1.5 text-fg-subtle' : 'text-fg-subtle'}>
        {inFlex ? '·' : ' · '}
      </span>
      <span className="sr-only">, </span>
    </>
  );
}

/**
 * The seal-and-word badges of one relationship. A screen reader hears "Status: Verified,
 * Historical"; the cross-lineage mark only on a teacher's row (see the file comment).
 */
export function RelationBadges({ edge, role }: { edge: RelationEdge; role: 'teacher' | 'student' }) {
  const status = relationStatus(edge.status);
  const badges = [<StatusBadge key="status" state={status.kind} label={status.label} size="sm" />];
  if (isHistoricalRelation(edge.periods)) badges.push(<StatusBadge key="historical" state="historical" label="Historical" size="sm" />);
  if (role === 'teacher' && edge.kind === 'crossLineage') badges.push(<StatusBadge key="cross" state="cross_lineage" size="sm" />);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="sr-only">Status: </span>
      {badges.map((badge, i) => (
        <Fragment key={badge.key}>
          {i > 0 ? <span className="sr-only">, </span> : null}
          {badge}
        </Fragment>
      ))}
    </span>
  );
}

/**
 * The note on a relationship only its two participants can see (DEFAULT D03): a request until
 * it is confirmed, or a confirmed link that is not on the public record (for example because
 * the other person's record is private).
 */
function privateNote(edges: readonly RelationEdge[]) {
  const own = edges.filter((e) => e.visibility === 'involved_only');
  if (own.length === 0) return null;
  const request = own.some((e) => ['unconfirmed', 'under_review'].includes(relationStatus(e.status).kind));
  return (
    <p className="text-sm text-fg-muted">
      {request
        ? 'Visible only to the two people in this request until it is confirmed.'
        : 'Visible only to the two people in this link: it is not on the public record.'}
    </p>
  );
}

function lineageOf(lineages: ReadonlyMap<string, LineageRefDto>, id: string): string {
  return lineages.get(id)?.name ?? 'Lineage not named';
}

/** "also a student of Viktor Samplewood (Demo Lineage B) and 2 more". */
function AlsoStudentOf({ row, lineages }: { row: RelationRow; lineages: ReadonlyMap<string, LineageRefDto> }) {
  const others = row.otherTeachers ?? [];
  if (others.length === 0) return null;
  const more = (row.otherTeachersTotal ?? others.length) - others.length;
  return (
    <p data-also className="text-sm text-fg-muted">
      also a student of{' '}
      {others.map((t, i) => (
        <Fragment key={t.person.id}>
          {i > 0 ? (i === others.length - 1 && more === 0 ? ' and ' : ', ') : null}
          <LatinName name={t.person.displayName} />{' '}
          {/* The brackets move with the lineage's name, never a lone "(" at a line's end. */}
          <span className="inline-block max-w-full">
            (<LineageName name={lineageOf(lineages, t.lineageId)} />)
          </span>
        </Fragment>
      ))}
      {more > 0 ? ` and ${more.toLocaleString('en')} more` : null}
    </p>
  );
}

/** One relationship: lineage (unless the heading names it), period, own students, state. */
function EdgeLine({
  edge,
  role,
  lineages,
  groupLineageId,
  studentCount,
}: {
  edge: RelationEdge;
  role: 'teacher' | 'student';
  lineages: ReadonlyMap<string, LineageRefDto>;
  groupLineageId?: string | null;
  studentCount?: number;
}) {
  const parts = [
    edge.lineageId !== groupLineageId ? <LineageName key="lineage" name={lineageOf(lineages, edge.lineageId)} /> : null,
    // Proportional figures: a tabular comma between two periods reads as a gap.
    <span key="period">{periodText(edge.periods)}</span>,
    studentCount ? (
      <span key="students">
        has {studentCount.toLocaleString('en')} {studentCount === 1 ? 'student' : 'students'}
      </span>
    ) : null,
  ].filter(Boolean);
  return (
    <p data-relationship className="flex flex-wrap items-center gap-x-0 gap-y-1 text-sm text-fg-muted">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? <Sep inFlex /> : null}
          {part}
        </Fragment>
      ))}
      <Sep inFlex />
      <RelationBadges edge={edge} role={role} />
      {edge.approvedByUnverifiedInstructor ? (
        <>
          <Sep inFlex />
          <span data-unverified-approval>Approved by an unverified instructor</span>
        </>
      ) : null}
    </p>
  );
}

/**
 * The rows of a teachers or students list. `groupLineageId` is the lineage the heading names
 * (left out of each row); `columns` puts the relationship beside the name from the md width (the
 * list view's long student lists), so each student takes one line on a wide screen.
 */
export function RelationList({
  rows,
  lineages,
  role,
  label,
  groupLineageId,
  columns = false,
  nameSize = 'xl',
  className,
}: {
  rows: readonly RelationRow[];
  lineages: ReadonlyMap<string, LineageRefDto>;
  role: 'teacher' | 'student';
  /** The accessible name of the list. */
  label: string;
  groupLineageId?: string | null;
  columns?: boolean;
  /** The size of the names: the profile's few rows are larger than a long list's. */
  nameSize?: 'xl' | 'lg';
  className?: string;
}) {
  // DEFAULT D05: the display-primary teacher comes first; say so when there is a choice.
  const primaryFirst = role === 'teacher' && rows.length > 1 && rows[0]!.edges.some((e) => e.kind === 'primary');
  return (
    <ul aria-label={label} className={cx('grid', className)}>
      {rows.map((row, index) => {
        const first = row.edges[0];
        return (
          <li
            key={row.person.id}
            data-person={row.person.slug}
            // The name's link covers the row (PersonLink `stretched`): one target per person,
            // never under 44 px (a name and its relationship line), and rows stay short on a phone.
            className="relative grid min-h-11 grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 border-t border-border-subtle py-2 first:border-t-0 first:pt-0"
          >
            {/* The stroke sits level with the name (its line is the top of the row). */}
            <span aria-hidden="true" className="pt-px">
              {first ? <LinkStroke kind={strokeOf(role === 'teacher' ? first : { ...first, kind: undefined })} width={28} /> : null}
            </span>
            <div className={cx('grid min-w-0 gap-0.5', columns && 'md:grid-cols-[minmax(0,1fr)_auto] md:items-baseline md:gap-x-6')}>
              <div className="grid min-w-0 gap-0.5">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <PersonLink person={row.person} stretched className={cx('font-display', nameSize === 'xl' ? 'text-xl' : 'text-lg')} />
                  {row.note ? <span className="text-sm text-fg-muted">({row.note})</span> : null}
                  {primaryFirst && index === 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-caption font-semibold text-fg-muted uppercase">
                      <LinkStroke kind="verified" width={20} />
                      Primary teacher
                    </span>
                  ) : null}
                </p>
                {role === 'student' ? <AlsoStudentOf row={row} lineages={lineages} /> : null}
              </div>
              <div className={cx('grid min-w-0 gap-0.5', columns && 'md:justify-items-end md:[&>p]:justify-end')}>
                {row.edges.map((edge) => (
                  <EdgeLine
                    key={edge.id}
                    edge={edge}
                    role={role}
                    lineages={lineages}
                    groupLineageId={groupLineageId}
                    studentCount={edge === first ? row.studentCount : undefined}
                  />
                ))}
              </div>
              {privateNote(row.edges)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Groups edges by the other person, in the order given. */
export function groupRelations<E extends RelationEdge>(
  edges: readonly E[],
  otherOf: (edge: E) => string,
  personOf: (id: string) => RelationRow['person'] | undefined,
): RelationRow[] {
  const rows = new Map<string, RelationRow>();
  for (const edge of edges) {
    const id = otherOf(edge);
    const person = personOf(id);
    if (!person) continue;
    const row = rows.get(id) ?? { person, edges: [] };
    row.edges.push(edge);
    rows.set(id, row);
  }
  return [...rows.values()];
}

/** The rows of a page of students (people.students), in the order the API gives. */
export function studentRows(entries: readonly StudentEntryDto[]): RelationRow[] {
  return entries.map((entry) => ({
    person: entry.person,
    edges: entry.edges,
    otherTeachers: entry.otherTeachers,
    otherTeachersTotal: entry.otherTeachersTotal,
    studentCount: entry.studentCount,
  }));
}

/**
 * A seniority page's active and historical students as one list, earliest dated start first
 * (undated last), as people.students ordered them: each list is already in that order, and a tie
 * keeps the order given. Only public relationships date a student, as in the API.
 */
export function bySeniority(entries: readonly StudentEntryDto[]): StudentEntryDto[] {
  const start = (entry: StudentEntryDto) =>
    entry.edges
      .filter((e) => e.visibility === 'public')
      .flatMap((e) => e.periods)
      .map((p) => p.from)
      .filter((from): from is string => from !== null)
      .sort()[0] ?? null;
  const keyed = entries.map((entry) => ({ entry, start: start(entry) }));
  keyed.sort((a, b) => (a.start === b.start ? 0 : a.start === null ? 1 : b.start === null ? -1 : a.start < b.start ? -1 : 1));
  return keyed.map((k) => k.entry);
}

/** The one lineage every row of a list shares, or null (the heading can then name it). */
export function sharedLineage(rows: readonly RelationRow[]): string | null {
  const ids = new Set(rows.flatMap((r) => r.edges.map((e) => e.lineageId)));
  return ids.size === 1 ? [...ids][0]! : null;
}
