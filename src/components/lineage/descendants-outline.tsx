// The descendants of a person as an outline (plan §4.10, item 4; milestone M04): nested lists
// with <details>/<summary> and links, rendered on the server and open for the first two
// generations, so it works without JavaScript. Not the WAI-ARIA tree pattern (no role=tree):
// without JavaScript that pattern promises arrow-key navigation the page cannot give.
//
// A teaching record is not a tree: a person with two teachers in this outline appears under each,
// marked "(also a student of …)". Their own students are listed once, under the shallowest mention;
// the other mention links there. One identity, several mentions, one profile.

import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

import { ChevronDownIcon } from '@/components/icons';
import type { LineageGraphDto, LineageNodeDto } from '@/server/dto/public';
import { LatinName, PersonLink, profileHref } from './person-name';

/** Generations open when the page loads (plan §4.10: expanded on the server to two levels). */
const OPEN_LEVELS = 2;

const byName = (a: LineageNodeDto, b: LineageNodeDto) => a.displayName.localeCompare(b.displayName, 'en') || a.id.localeCompare(b.id);

function students(n: number) {
  return `${n.toLocaleString('en')} ${n === 1 ? 'student' : 'students'}`;
}

export function DescendantsOutline({ graph, rootId, depth }: { graph: LineageGraphDto; rootId: string; depth: number }) {
  const people = new Map(graph.nodes.map((n) => [n.id, n]));
  const children = new Map<string, LineageNodeDto[]>();
  const teachers = new Map<string, string[]>();
  for (const e of graph.edges) {
    const student = people.get(e.studentId);
    if (!student || !people.has(e.teacherId)) continue;
    const list = children.get(e.teacherId) ?? [];
    if (!list.some((s) => s.id === student.id)) list.push(student);
    children.set(e.teacherId, list);
    teachers.set(e.studentId, [...new Set([...(teachers.get(e.studentId) ?? []), e.teacherId])]);
  }
  for (const list of children.values()) list.sort(byName);

  // Who is listed with their students: the shallowest mention, and among mentions at the same
  // generation the first in reading order. Breadth-first, so someone who is also a direct student
  // of the root is expanded at the first level, not under a longer route that is read earlier.
  const expandedUnder = new Map<string, string>();
  let generation = [rootId];
  for (let level = 1; level <= depth && generation.length > 0; level += 1) {
    const next: string[] = [];
    for (const id of generation) {
      for (const child of children.get(id) ?? []) {
        if (child.id === rootId || expandedUnder.has(child.id)) continue;
        expandedUnder.set(child.id, id);
        next.push(child.id);
      }
    }
    generation = next;
  }

  const item = (person: LineageNodeDto, parentId: string, level: number): ReactNode => {
    const others = (teachers.get(person.id) ?? []).filter((t) => t !== parentId).map((t) => people.get(t)!);
    const kids = children.get(person.id) ?? [];
    const expandedHere = expandedUnder.get(person.id) === parentId;
    const firstParent = people.get(expandedUnder.get(person.id) ?? '');
    const hiddenStudents = person.childCount - kids.length;
    return (
      <li key={`${parentId}-${person.id}`} id={expandedHere ? `outline-${person.slug}` : undefined} className="grid gap-0.5 py-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <PersonLink person={person} className="text-base font-semibold" />
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
        </span>
        {!expandedHere && kids.length > 0 && firstParent ? (
          <span className="pl-1 text-sm text-fg-muted">
            <Link href={`#outline-${person.slug}`} className="link inline-flex min-h-11 items-center">
              <span>
                {students(kids.length)} listed under <LatinName name={firstParent.displayName} />
              </span>
            </Link>
          </span>
        ) : expandedHere && kids.length > 0 ? (
          <details open={level < OPEN_LEVELS} className="group pl-1">
            <summary className="inline-flex min-h-11 items-center gap-1.5 text-sm text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
              {/* The disclosure mark: points right when closed, down when open (not by colour). */}
              <ChevronDownIcon size={16} className="-rotate-90 transition-transform [details[open]>summary>&]:rotate-0" />
              <span>
                {students(kids.length)}{' '}
                <span className="sr-only">
                  of <LatinName name={person.displayName} />
                </span>
              </span>
            </summary>
            <ul className="ml-2 border-l border-border-subtle pl-4">{kids.map((kid) => item(kid, person.id, level + 1))}</ul>
            {hiddenStudents > 0 ? (
              <p className="ml-2 pl-4 text-sm text-fg-muted">
                <Link href={`${profileHref(person.slug)}/lineage`} prefetch={false} className="link inline-flex min-h-11 items-center">
                  <span>
                    {students(hiddenStudents)} more in <LatinName name={person.displayName} />’s list
                  </span>
                </Link>
              </p>
            ) : null}
          </details>
        ) : person.childCount > 0 ? (
          <span className="pl-1 text-sm">
            <Link href={`${profileHref(person.slug)}/lineage`} prefetch={false} className="link inline-flex min-h-11 items-center">
              <span>
                {students(person.childCount)}: open <LatinName name={person.displayName} />’s list
              </span>
            </Link>
          </span>
        ) : null}
      </li>
    );
  };

  const first = children.get(rootId) ?? [];
  return (
    <ul aria-label="Descendants" className="grid">
      {first.map((child) => item(child, rootId, 1))}
    </ul>
  );
}
