// The descendants of a person as an outline (plan §4.10, item 4; milestone M04): nested lists
// with <details>/<summary> and links, rendered on the server and open for the first two
// generations, so it works without JavaScript. Not the WAI-ARIA tree pattern (no role=tree):
// without JavaScript that pattern promises arrow-key navigation the page cannot give.
//
// A teaching record is not a tree: a person with two teachers in this outline appears under each,
// marked "(also a student of …)". Their own students are listed once, under the shallowest mention;
// the other mention links there. One identity, several mentions, one profile.
//
// Each row is the person's own line (design review round 1): the disclosure control at its start
// (a chevron in a ring, 32 px with a mouse and 44 px on a touch screen), the name in the display
// face, the year training began, and the state as a seal and a word when it is not a public
// verified link (a viewer's own request, DEFAULT D03). Counts are of public links only: a request
// is shown to its two participants and never counted. Two people with the same name under one
// teacher are told apart in words. The list view already lists every student of the person, so
// there the first level holds only the students who teach (`teachingOnly`).

import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

import { ChevronDownIcon } from '@/components/icons';
import type { LineageEdgeDto, LineageGraphDto, LineageNodeDto } from '@/server/dto/public';
import { LatinName, PersonLink, profileHref } from './person-name';
import { RelationBadges } from './relation-list';
import { isHistoricalRelation, periodText, relationStatus, sameNameNotes, startYear } from './status';

/** Generations open when the page loads (plan §4.10: expanded on the server to two levels). */
const OPEN_LEVELS = 2;

const byName = (a: LineageNodeDto, b: LineageNodeDto) => a.displayName.localeCompare(b.displayName, 'en') || a.id.localeCompare(b.id);

function students(n: number) {
  return `${n.toLocaleString('en')} ${n === 1 ? 'student' : 'students'}`;
}

/** "since 1996", or the period of a training that has ended ("1981–1983"). */
function yearText(edges: readonly LineageEdgeDto[]): string | null {
  const ended = edges.length > 0 && edges.every((e) => isHistoricalRelation(e.periods));
  if (ended) return periodText(edges.flatMap((e) => e.periods));
  const year = edges.map((e) => startYear(e.periods)).filter((y): y is string => y !== null).sort()[0];
  return year ? `since ${year}` : null;
}

export interface OutlineSummary {
  /** First-level people shown, and how many first-level people there are in all. */
  shown: number;
  total: number;
}

export function outlineSummary(graph: LineageGraphDto, rootId: string, teachingOnly: boolean): OutlineSummary {
  const first = new Map<string, LineageNodeDto>();
  const people = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const e of graph.edges) {
    const student = people.get(e.studentId);
    if (e.teacherId === rootId && student && e.visibility === 'public') first.set(student.id, student);
  }
  const all = [...first.values()];
  const teaching = all.filter((p) => p.childCount > 0);
  return { shown: teachingOnly ? teaching.length : all.length, total: all.length };
}

export function DescendantsOutline({
  graph,
  rootId,
  depth,
  teachingOnly = false,
}: {
  graph: LineageGraphDto;
  rootId: string;
  depth: number;
  /** List only the first-level students who have students of their own. */
  teachingOnly?: boolean;
}) {
  const people = new Map(graph.nodes.map((n) => [n.id, n]));
  const lineageNames = new Map(graph.lineages.map((l) => [l.id, l.name]));
  const children = new Map<string, LineageNodeDto[]>();
  const teachers = new Map<string, string[]>();
  const links = new Map<string, LineageEdgeDto[]>();
  for (const e of graph.edges) {
    const student = people.get(e.studentId);
    if (!student || !people.has(e.teacherId)) continue;
    const key = `${e.teacherId}>${e.studentId}`;
    links.set(key, [...(links.get(key) ?? []), e]);
    const list = children.get(e.teacherId) ?? [];
    if (!list.some((s) => s.id === student.id)) list.push(student);
    children.set(e.teacherId, list);
    teachers.set(e.studentId, [...new Set([...(teachers.get(e.studentId) ?? []), e.teacherId])]);
  }
  for (const list of children.values()) list.sort(byName);
  const edgesOf = (teacherId: string, studentId: string) => links.get(`${teacherId}>${studentId}`) ?? [];
  const isPublicLink = (teacherId: string, studentId: string) => edgesOf(teacherId, studentId).some((e) => e.visibility === 'public');

  let first = children.get(rootId) ?? [];
  if (teachingOnly) first = first.filter((p) => p.childCount > 0 || (children.get(p.id) ?? []).length > 0);

  // Who is listed with their students: the shallowest mention, and among mentions at the same
  // generation the first in reading order. Breadth-first, so someone who is also a direct student
  // of the root is expanded at the first level, not under a longer route that is read earlier.
  const expandedUnder = new Map<string, string>();
  let generation = [rootId];
  for (let level = 1; level <= depth && generation.length > 0; level += 1) {
    const next: string[] = [];
    for (const id of generation) {
      for (const child of id === rootId ? first : (children.get(id) ?? [])) {
        if (child.id === rootId || expandedUnder.has(child.id)) continue;
        expandedUnder.set(child.id, id);
        next.push(child.id);
      }
    }
    generation = next;
  }

  const list = (parentId: string, kids: readonly LineageNodeDto[], level: number, label?: string): ReactNode => {
    // Same names under one teacher: the year training began, else the lineage (the "also a
    // student of" note beside each mention already names any other teacher).
    const notes = sameNameNotes(
      kids.map((kid) => {
        const edges = edgesOf(parentId, kid.id);
        return {
          id: kid.id,
          displayName: kid.displayName,
          year: startYear(edges.flatMap((e) => e.periods)),
          lineage: edges.map((e) => lineageNames.get(e.lineageId)).find(Boolean) ?? null,
        };
      }),
    );
    return (
      <ul aria-label={label} className={level === 1 ? 'grid' : 'ml-4 grid border-l border-border-strong pl-2 pointer-coarse:ml-[1.375rem]'}>
        {kids.map((kid) => item(kid, parentId, level, notes.get(kid.id)))}
      </ul>
    );
  };

  const item = (person: LineageNodeDto, parentId: string, level: number, note: string | undefined): ReactNode => {
    const others = (teachers.get(person.id) ?? []).filter((t) => t !== parentId).map((t) => people.get(t)!);
    const kids = children.get(person.id) ?? [];
    const publicKids = kids.filter((k) => isPublicLink(person.id, k.id));
    const ownRequests = kids.length - publicKids.length;
    const expandedHere = expandedUnder.get(person.id) === parentId;
    const firstParent = people.get(expandedUnder.get(person.id) ?? '');
    const hiddenStudents = Math.max(0, person.childCount - publicKids.length);
    const edges = edgesOf(parentId, person.id);
    const year = yearText(edges);
    // A link that is not public and verified says so: a seal and a word, and who can see it.
    const marked = edges.find((e) => e.visibility !== 'public' || relationStatus(e.status).kind !== 'verified');
    const request = edges.length > 0 && edges.every((e) => e.visibility === 'involved_only');
    const count = `${students(publicKids.length)}${ownRequests > 0 ? ` and your ${ownRequests === 1 ? 'request' : 'requests'}` : ''}`;

    return (
      <li key={`${parentId}-${person.id}`} id={expandedHere ? `outline-${person.slug}` : undefined} data-person={person.slug} className="relative pl-8 pointer-coarse:pl-11">
        <div className="flex flex-wrap items-center gap-x-2">
          <PersonLink person={person} compact className={level === 1 ? 'font-display text-lg' : 'font-display text-base'} />
          {year ? <span className="text-sm text-fg-muted tabular">{year}</span> : null}
          {note ? <span className="text-sm text-fg-muted">({note})</span> : null}
          {marked ? <RelationBadges edge={marked} role="student" /> : null}
          {others.length > 0 ? (
            <span className="text-sm text-fg-muted" data-also>
              (also a student of{' '}
              {others.map((o, i) => (
                <Fragment key={o.id}>
                  {i > 0 ? ' and ' : null}
                  <LatinName name={o.displayName} />
                </Fragment>
              ))}
              )
            </span>
          ) : null}
        </div>
        {request ? <p className="text-sm text-fg-muted">Visible only to the two people in this request until it is confirmed.</p> : null}
        {!expandedHere && kids.length > 0 && firstParent ? (
          <p className="text-sm text-fg-muted">
            <Link href={`#outline-${person.slug}`} className="link inline-flex min-h-8 items-center pointer-coarse:min-h-11">
              <span>
                {students(publicKids.length)} listed under <LatinName name={firstParent.displayName} />
              </span>
            </Link>
          </p>
        ) : expandedHere && kids.length > 0 ? (
          <details open={level < OPEN_LEVELS} className="group/outline">
            <summary className="absolute top-0 left-0 grid size-8 cursor-pointer list-none place-items-center rounded-xs pointer-coarse:size-11 [&::-webkit-details-marker]:hidden">
              {/* The disclosure mark: points right when closed, down when open (not by colour). */}
              <span aria-hidden="true" className="grid size-6 place-items-center rounded-xs border border-border-strong bg-bg text-fg">
                <ChevronDownIcon size={14} className="-rotate-90 transition-transform group-open/outline:rotate-0" />
              </span>
              <span className="sr-only">
                {count} of <LatinName name={person.displayName} />
              </span>
            </summary>
            {list(person.id, kids, level + 1)}
            {hiddenStudents > 0 ? (
              <p className="ml-4 border-l border-border-strong pl-10 text-sm text-fg-muted pointer-coarse:ml-[1.375rem] pointer-coarse:pl-[3.25rem]">
                <Link href={`${profileHref(person.slug)}/lineage`} prefetch={false} className="link inline-flex min-h-8 items-center pointer-coarse:min-h-11">
                  <span>
                    {students(hiddenStudents)} more in <LatinName name={person.displayName} />’s list
                  </span>
                </Link>
              </p>
            ) : null}
          </details>
        ) : person.childCount > 0 ? (
          <p className="text-sm text-fg-muted">
            <Link href={`${profileHref(person.slug)}/lineage`} prefetch={false} className="link inline-flex min-h-8 items-center pointer-coarse:min-h-11">
              <span>
                {students(person.childCount)}: open <LatinName name={person.displayName} />’s list
              </span>
            </Link>
          </p>
        ) : null}
      </li>
    );
  };

  return list(rootId, first, 1, 'Descendants');
}
