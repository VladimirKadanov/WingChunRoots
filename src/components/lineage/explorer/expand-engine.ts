// The work of an expansion (plan §4.8; milestone M06, package C), out of the explorer's first
// JavaScript: expand.ts loads it with the first press of "+N students" or "+N teachers" (a chunk of
// its own, read while lineage.ego reads the difference). It checks the answer against the view,
// merges it by id, hands the merged view to the layout with the expand preset and the last scene's
// positions (expand.ts expandLayout, through Work), keeps the pressed node's place in the new
// scene, and says what the expansion added once it is drawn.
//
// Its only runtime imports are expand-state.ts and state.ts, which the explorer shares with its
// later chunks anyway: not TanStack Query, the oRPC client or expand.ts (expand-state.ts says why);
// expand.ts hands it what it needs (Work).

import type { Point, Scene } from '@/lib/lineage-layout/types';
import type { LineageGraphDto } from '@/server/dto/public';

import type { Latest, Work } from './expand';
import { counting, type Done, fresh, notice, type State } from './expand-state';
import type { ExpandDirection } from './graph-api';
import { isSummaryId } from './state';

/**
 * Presses that come quickly one after another are laid out once (plan §4.8: a short debounce;
 * DEFAULT, no D number): an expansion's answer waits this long for the next one before the view
 * is laid out again, and the layout worker drops the requests a newer one overtook (`stale`).
 */
export const RELAYOUT_DEBOUNCE_MS = 100;

/** Every public teacher of each person in an answer: those it shows and those it counts in hiddenCounts. */
function teacherTotals(graph: LineageGraphDto): Map<string, number> {
  const shown = new Map<string, Set<string>>();
  for (const e of graph.edges) if (e.visibility === 'public') shown.set(e.studentId, (shown.get(e.studentId) ?? new Set()).add(e.teacherId));
  return new Map(graph.nodes.map((n) => [n.id, (graph.hiddenCounts[n.id]?.teachers ?? 0) + (shown.get(n.id)?.size ?? 0)]));
}

const personWords = (n: LineageGraphDto['nodes'][number]) =>
  JSON.stringify([n.slug, n.displayName, n.altNames, n.lifeStatus, n.claimState, n.lineageIds, n.childCount, n.visibility]);
const edgeWords = (e: LineageGraphDto['edges'][number]) =>
  JSON.stringify([e.teacherId, e.studentId, e.lineageId, e.kind, e.status, e.isDisplayPrimary, e.visibility, e.periods]);

/**
 * Whether two answers say the same of the people and the relationships both hold: their names,
 * states and counts, and every relationship's ends, state and periods. An answer's dataVersion is
 * a hash of the answer itself, so reads of different people never share one: this is what tells
 * that the record changed between the view's read and an expansion's.
 */
export function sameRecord(view: LineageGraphDto, part: LineageGraphDto): boolean {
  const people = new Map(view.nodes.map((n) => [n.id, n]));
  const lines = new Map(view.edges.map((e) => [e.id, e]));
  const viewTeachers = teacherTotals(view);
  const partTeachers = teacherTotals(part);
  for (const n of part.nodes) {
    const there = people.get(n.id);
    if (there && (personWords(there) !== personWords(n) || viewTeachers.get(n.id) !== partTeachers.get(n.id))) return false;
  }
  for (const e of part.edges) {
    const there = lines.get(e.id);
    if (there && edgeWords(there) !== edgeWords(e)) return false;
  }
  return true;
}

/**
 * The view with an expansion's answer merged in, by id: only the people and relationships it does
 * not hold yet are added, so merging the same answer again changes nothing (the same object comes
 * back). hiddenCounts and hasMoreChildren are counted again over the merged view, as the server
 * counts them (public relationships only): students from childCount, teachers from what each answer
 * shows and counts, the expansion's own count winning for the expanded person.
 *
 * DEFAULT D03: a signed-in participant's own involved_only relationship comes with an expansion as
 * it comes with the view's read (the same procedure for the same viewer), and never in a count.
 */
export function mergeExpansion(view: LineageGraphDto, part: LineageGraphDto, expandedId: string): LineageGraphDto {
  const hasPerson = new Set(view.nodes.map((n) => n.id));
  const hasLine = new Set(view.edges.map((e) => e.id));
  const newPeople = part.nodes.filter((n) => !hasPerson.has(n.id));
  const newLines = part.edges.filter((e) => !hasLine.has(e.id));
  if (newPeople.length === 0 && newLines.length === 0) return view;

  const edges = [...view.edges, ...newLines];
  const fromView = teacherTotals(view);
  const fromPart = teacherTotals(part);
  const teachersOf = (id: string) => (id === expandedId || !fromView.has(id) ? fromPart.get(id) : fromView.get(id)) ?? 0;
  const shownTeachers = new Map<string, Set<string>>();
  const shownStudents = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.visibility !== 'public') continue;
    shownTeachers.set(e.studentId, (shownTeachers.get(e.studentId) ?? new Set()).add(e.teacherId));
    shownStudents.set(e.teacherId, (shownStudents.get(e.teacherId) ?? new Set()).add(e.studentId));
  }
  const hiddenCounts: LineageGraphDto['hiddenCounts'] = {};
  const nodes = [...view.nodes, ...newPeople].map((n) => {
    const students = shownStudents.get(n.id)?.size ?? 0;
    const teachers = Math.max(0, teachersOf(n.id) - (shownTeachers.get(n.id)?.size ?? 0));
    const hiddenStudents = Math.max(0, n.childCount - students);
    if (teachers > 0 || hiddenStudents > 0) hiddenCounts[n.id] = { teachers, students: hiddenStudents };
    const more = n.childCount > students;
    return n.hasMoreChildren === more ? n : { ...n, hasMoreChildren: more };
  });
  const lineages = new Map(view.lineages.map((l) => [l.id, l]));
  for (const l of part.lineages) if (!lineages.has(l.id)) lineages.set(l.id, l);
  return {
    ...view,
    nodes,
    edges,
    hiddenCounts,
    // In the server's order (lineage-graph.ts assembleGraph).
    lineages: [...lineages.values()].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id)),
    truncated: view.truncated || part.truncated,
  };
}

/**
 * The scene of an expansion moved so that the pressed node keeps its place in the flow (its top
 * left corner in `previous`, the scene on screen). React Flow draws only the nodes in view
 * (onlyRenderVisibleElements): a scene that put the pressed node outside the old view would take
 * it, and the keyboard focus in it, out of the DOM until the view's anchor move brought it back,
 * and the focus-loss guard would have moved the focus to another person by then. With its place
 * kept, the view does not move at all (canvas.tsx FitOnScene: the anchor's delta is zero) and the
 * others slide around it. Any other scene comes back as it is.
 */
export function anchoredScene(scene: Scene, previous: Scene | null, anchorId: string | null): Scene {
  const before = anchorId === null ? undefined : previous?.nodes.find((n) => n.id === anchorId);
  const after = anchorId === null ? undefined : scene.nodes.find((n) => n.id === anchorId);
  if (!before || !after || (before.x === after.x && before.y === after.y)) return scene;
  const dx = before.x - after.x;
  const dy = before.y - after.y;
  const point = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  const box = <T extends Point>(b: T): T => ({ ...b, x: b.x + dx, y: b.y + dy });
  return {
    ...scene,
    bounds: box(scene.bounds),
    rowY: scene.rowY.map((y) => y + dy),
    nodes: scene.nodes.map((n) => ({
      ...n,
      x: n.x + dx,
      y: n.y + dy,
      center: point(n.center),
      boxes: { full: box(n.boxes.full), compact: box(n.boxes.compact), dot: box(n.boxes.dot) },
    })),
    edges: scene.edges.map((e) => ({
      ...e,
      path:
        e.path.type === 'orthogonal'
          ? { ...e.path, points: e.path.points.map(point) }
          : { ...e.path, start: point(e.path.start), control1: point(e.path.control1), control2: point(e.path.control2), end: point(e.path.end), midpoint: point(e.path.midpoint) },
    })),
  };
}

const counted = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/**
 * The notice once expansions are drawn: how many people each added to the drawing ("Added 12
 * students of {name}."), or, for one that added nobody, that the rest are in the view already:
 * only their ended training is not drawn (up=1 reads every public teacher, and beyond the cap
 * "+N students" opens the list instead of expanding).
 */
export function expansionWords(done: readonly Done[], graph: LineageGraphDto, added: ReadonlySet<string>): string {
  return done
    .map(({ id, direction, name }) => {
      const people = new Set<string>();
      for (const e of graph.edges) {
        const other = direction === 'students' ? (e.teacherId === id ? e.studentId : null) : e.studentId === id ? e.teacherId : null;
        if (other !== null && added.has(other)) people.add(other);
      }
      const one = direction === 'students' ? 'student' : 'teacher';
      return people.size > 0
        ? `Added ${counted(people.size, one)} of ${name}.`
        : `Every ${one} of ${name} on the record is in this view; ended training is drawn with Show ended training.`;
    })
    .join(' ');
}

/** The state once the scene of the expansions being laid out is on the canvas: what they added is said. */
export function drawn(s: State, scene: Scene): State {
  if (!s.laying || !s.graph) return s;
  const before = new Set(s.laying.scene?.nodes.map((n) => n.id));
  const added = new Set(scene.nodes.filter((n) => !isSummaryId(n.id) && !before.has(n.id)).map((n) => n.id));
  return counting({ ...s, laying: null, notice: notice(s, expansionWords(s.laying.done, s.graph, added)) });
}

/** An expansion's answer, waiting for the next layout (RELAYOUT_DEBOUNCE_MS). */
export interface Arrived extends Done {
  key: string;
  version: string;
  part: LineageGraphDto;
}

/** Merges the answers that arrived into the view, for one new layout. */
function publish(work: Work): void {
  work.timer = undefined;
  const now = work.latest.current;
  const arrived = work.queue.splice(0);
  const answerNow = now.answer;
  const items = answerNow ? arrived.filter((a) => a.key === now.key && a.version === answerNow.dataVersion) : [];
  work.setState((before) => {
    if (before.key !== now.key) return before;
    const loading = new Set(before.loading);
    for (const a of arrived) loading.delete(a.id);
    if (!answerNow || items.length === 0) return counting({ ...before, loading });
    const base = before.graph && before.version === answerNow.dataVersion ? before.graph : answerNow;
    let merged = base;
    for (const a of items) merged = mergeExpansion(merged, a.part, a.id);
    const done = items.map(({ id, direction, name }) => ({ id, direction, name }));
    // Nothing new to draw: said at once, with no layout to wait for.
    if (merged === base) return counting({ ...before, loading, notice: notice(before, expansionWords(done, base, new Set())) });
    const drawnIds = (now.scene?.nodes ?? []).filter((n) => !isSummaryId(n.id)).map((n) => n.id);
    return counting({
      ...before,
      version: answerNow.dataVersion,
      graph: merged,
      pinned: new Set([...before.pinned, ...drawnIds]),
      layoutOptions: work.layout(now.scene),
      anchorId: items.at(-1)!.id,
      loading,
      laying: { scene: before.laying?.scene ?? now.scene, done: [...(before.laying?.done ?? []), ...done] },
    });
  });
}

/**
 * The answer of an expansion pressed at `at` (the render of the press): checked against the view,
 * then queued for the next layout. A record that changed since the view was read (DEFAULT, no D
 * number) drops the expansions and reads the view again, with every lineage answer kept in the
 * browser.
 */
export function arrived(work: Work, at: Latest, id: string, direction: ExpandDirection, name: string, part: LineageGraphDto): void {
  const now = work.latest.current;
  if (now.key !== at.key || !at.answer) return;
  if (now.graph && !sameRecord(now.graph, part)) {
    work.setState((before) => (before.key === at.key ? fresh(at.key, notice(before, 'The record has changed since this view was read; it is read again.')) : before));
    work.reread();
    return;
  }
  work.queue.push({ key: at.key, version: at.answer.dataVersion, id, direction, name, part });
  clearTimeout(work.timer);
  work.timer = setTimeout(() => publish(work), RELAYOUT_DEBOUNCE_MS);
}
