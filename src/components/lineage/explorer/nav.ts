// Moving between people with the arrow keys (plan §4.9; milestone M06, package A), pure: ↑ to a
// teacher (a chooser with two or more drawn), ↓ to the drawn student nearest in x, ← and → to the
// nearest person in the same rank without wrapping; the summary node "and N more" is in the
// students' row (↓ and ←/→ reach it; ↑ from it goes to its teacher). A move with no target says why
// ("No teachers drawn in this view.", "First in this row."), for the live region.
//
// "Drawn" is the view's drawing, not the screen: a node off screen (onlyRenderVisibleElements) is
// a target, and the canvas moves the view to it (canvas.tsx setActive). Hidden nodes and lines
// (ended training, hidden until shown) are not.

import type { LineageEdge, PersonNode } from './canvas';
import type { FlowNode } from './graph-api';
import { isSummaryId, summaryIdOf, summaryTeacherOf } from './state';

export type Direction = 'up' | 'down' | 'left' | 'right';

/** Where a key moves: to a node, to a choice between teachers, or nowhere (with the reason, for the live region). */
export type NavTarget = { kind: 'move'; id: string } | { kind: 'choose'; ids: string[] } | { kind: 'none'; reason: string };

/** The drawn graph the keys move in. */
export interface NavGraph {
  nodes: readonly FlowNode[];
  edges: readonly LineageEdge[];
}

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The reasons a move has no target (the live region says them). */
export const NO_TARGET = {
  teachers: 'No teachers drawn in this view.',
  students: 'No students drawn in this view.',
  first: 'First in this row.',
  last: 'Last in this row.',
} as const;

/** "No teachers drawn in this view." and, when the record has teachers not drawn, the expand button's words. */
function noneDrawn(base: string, notDrawn: number, one: string, many: string): string {
  return notDrawn > 0 ? `${base.slice(0, -1)} (+${counted(notDrawn, one, many)}).` : base;
}

/**
 * The order of a person's teachers in the chooser (DEFAULT D05: display-primary first): the
 * student's primary line, then other teachers in the same lineage, then teachers in another
 * lineage; across the row from left to right among equals.
 */
const KIND_ORDER: Record<string, number> = { primary: 0, converging: 1, crossLineage: 2 };

const centreX = (n: FlowNode) => n.position.x + (n.width ?? n.data.slot.width) / 2;
const isPerson = (n: FlowNode): n is PersonNode => !isSummaryId(n.id);

export function navigate(graph: NavGraph, from: string, direction: Direction): NavTarget {
  const shown = new Map(graph.nodes.filter((n) => !n.hidden).map((n) => [n.id, n]));
  const node = shown.get(from);
  if (!node) return { kind: 'none', reason: '' };
  const lines = graph.edges.filter((e) => !e.hidden && shown.has(e.source) && shown.has(e.target));

  if (direction === 'up') {
    if (isSummaryId(from)) {
      const teacher = summaryTeacherOf(from);
      return shown.has(teacher) ? { kind: 'move', id: teacher } : { kind: 'none', reason: NO_TARGET.teachers };
    }
    // One entry per teacher (a person may have two lines with one teacher), its best line's kind.
    const teachers = new Map<string, number>();
    for (const e of lines) {
      if (e.target !== from) continue;
      const order = KIND_ORDER[e.data?.kind ?? ''] ?? 3;
      teachers.set(e.source, Math.min(order, teachers.get(e.source) ?? Infinity));
    }
    const ids = [...teachers.keys()].sort((a, b) => teachers.get(a)! - teachers.get(b)! || centreX(shown.get(a)!) - centreX(shown.get(b)!) || a.localeCompare(b));
    if (ids.length === 1) return { kind: 'move', id: ids[0]! };
    if (ids.length > 1) return { kind: 'choose', ids };
    const inRecord = isPerson(node) ? node.data.totals.teachers : 0;
    return { kind: 'none', reason: noneDrawn(NO_TARGET.teachers, inRecord - teachers.size, 'teacher', 'teachers') };
  }

  if (direction === 'down') {
    const students = new Set(lines.filter((e) => e.source === from).map((e) => e.target));
    // The summary node of this teacher's students not drawn is in the students' row too.
    if (!isSummaryId(from) && shown.has(summaryIdOf(from))) students.add(summaryIdOf(from));
    const x = centreX(node);
    let best: { id: string; distance: number } | null = null;
    for (const id of students) {
      const distance = Math.abs(centreX(shown.get(id)!) - x);
      if (!best || distance < best.distance || (distance === best.distance && id < best.id)) best = { id, distance };
    }
    if (best) return { kind: 'move', id: best.id };
    const inRecord = isPerson(node) ? node.data.totals.students : 0;
    return { kind: 'none', reason: noneDrawn(NO_TARGET.students, inRecord - students.size, 'student', 'students') };
  }

  // ← and →: the people in the same rank, left to right; no wrapping at either end.
  const row = [...shown.values()]
    .filter((n) => n.data.rank === node.data.rank)
    .sort((a, b) => centreX(a) - centreX(b) || a.id.localeCompare(b.id));
  const at = row.findIndex((n) => n.id === from);
  const next = row[direction === 'left' ? at - 1 : at + 1];
  if (next) return { kind: 'move', id: next.id };
  return { kind: 'none', reason: direction === 'left' ? NO_TARGET.first : NO_TARGET.last };
}
