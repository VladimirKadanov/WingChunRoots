// Expanding the view (plan §4.8; milestone M06, package C): "+N students" and "+N teachers" read
// the difference with lineage.ego ({ up: 0, down: 1 } or { up: 1, down: 0 }), merge it into the
// view by id, pin the people drawn so capFanout never drops them, and lay the view out again with
// the expand preset and the last scene's positions, while the pressed node keeps its screen point
// (the canvas's anchor). The expansions belong to the read (`key`) and are dropped with it; they
// are not in the URL (DEFAULT, no D number; ADR 0010).
//
// In the explorer's first JavaScript (explorer.tsx imports it): small, and nothing it imports is
// new to that chunk (TanStack Query, the oRPC client and state.ts are there already).

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { LayoutOptions, Point, Scene } from '@/lib/lineage-layout/types';
import { orpc } from '@/lib/rpc-client';
import type { LineageGraphDto } from '@/server/dto/public';

import type { ExpandDirection, Notice } from './graph-api';
import { isSummaryId } from './state';

export interface Expansions {
  /** The view: the answer with its expansions merged in (null while there is no answer). */
  graph: LineageGraphDto | null;
  /** The people an expansion drew: capFanout keeps them. */
  pinned: ReadonlySet<string>;
  /** The layout's options: the explorer preset for a read, the expand preset with the last positions for an expansion. */
  layoutOptions: LayoutOptions;
  /** The node whose screen point the next scene keeps (the pressed one), or null. */
  anchorId: string | null;
  onExpand: (id: string, direction: ExpandDirection) => void;
  /** The people whose expansion is loading or being laid out. */
  pending: ReadonlySet<string>;
  /** Said in the live region when an expansion is drawn. */
  notice: Notice | null;
}

const NOBODY: ReadonlySet<string> = new Set();
const EXPLORER_LAYOUT: LayoutOptions = { preset: 'explorer' };
/**
 * Presses that come quickly one after another are laid out once (plan §4.8: a short debounce;
 * DEFAULT, no D number): an expansion's answer waits this long for the next one before the view
 * is laid out again, and the layout worker drops the requests a newer one overtook (`stale`).
 */
export const RELAYOUT_DEBOUNCE_MS = 100;

/** The read of an expansion: the person and their direct students, or their direct teachers. */
export function expandInput(id: string, direction: ExpandDirection): { focusId: string; up: number; down: number } {
  return { focusId: id, up: direction === 'teachers' ? 1 : 0, down: direction === 'students' ? 1 : 0 };
}

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

/** The top left corners of a scene's nodes: the expand preset keeps each row's order from them. */
export function positionsOf(scene: Scene | null): Record<string, Point> {
  return Object.fromEntries((scene?.nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }]));
}

/** An expansion merged into the view, for the words said once it is drawn. */
export interface Done {
  id: string;
  direction: ExpandDirection;
  name: string;
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

interface State {
  /** The read the expansions belong to. */
  key: string;
  /** The dataVersion of the answer the expansions were merged into: a new answer drops them. */
  version: string | null;
  /** The view, or null: the answer as it is. */
  graph: LineageGraphDto | null;
  pinned: ReadonlySet<string>;
  layoutOptions: LayoutOptions;
  anchorId: string | null;
  /** Expansions being read. */
  loading: ReadonlySet<string>;
  /** Expansions merged and being laid out: the scene on screen when they were (the next scene is theirs). */
  laying: { scene: Scene | null; done: readonly Done[] } | null;
  /** `loading` and the people of `laying` as one set, which keeps its identity while they stay the same. */
  pending: ReadonlySet<string>;
  notice: Notice | null;
}

const fresh = (key: string, notice: Notice | null = null): State => ({
  key,
  version: null,
  graph: null,
  pinned: NOBODY,
  layoutOptions: EXPLORER_LAYOUT,
  anchorId: null,
  loading: NOBODY,
  laying: null,
  pending: NOBODY,
  notice,
});

/**
 * Whether expansions made on the read `made.key` over an answer of `made.version` still hold for
 * the read `key` and its `answer` (DEFAULT, no D number): a new read drops them, and so does a new
 * answer to the same read (another dataVersion: the record changed). No answer yet, or no
 * expansion yet (`version` null), keeps them.
 */
export function keepsExpansions(made: { key: string; version: string | null }, key: string, answer: Pick<LineageGraphDto, 'dataVersion'> | null): boolean {
  return made.key === key && (answer === null || made.version === null || made.version === answer.dataVersion);
}

/** The state with its busy people counted again. */
function counting(s: State): State {
  const pending = new Set([...s.loading, ...(s.laying?.done.map((d) => d.id) ?? [])]);
  const same = pending.size === s.pending.size && [...pending].every((id) => s.pending.has(id));
  return same ? s : { ...s, pending: pending.size === 0 ? NOBODY : pending };
}

/** A notice with a new key, so the same words are said again. */
const notice = (s: State, text: string): Notice => ({ key: (s.notice?.key ?? 0) + 1, text });

/** An expansion's answer, waiting for the next layout (RELAYOUT_DEBOUNCE_MS). */
interface Arrived extends Done {
  key: string;
  version: string;
  part: LineageGraphDto;
}

/**
 * The view of the explorer's read `key` (its answer, `answer`) with the expansions made on it.
 * `scene` is the scene on the canvas: its positions keep each row's order, and its people stay drawn.
 */
export function useExpansions(answer: LineageGraphDto | null, key: string, scene: Scene | null): Expansions {
  const client = useQueryClient();
  const [state, setState] = useState<State>(() => fresh(key));
  let s = state;
  // A new read drops the expansions, and so does a new answer to the same read (the record changed).
  if (!keepsExpansions(s, key, answer)) {
    s = fresh(key, s.key === key ? s.notice : null);
    setState(s);
  }
  // The expansions being laid out are drawn: say what they added.
  if (s.laying && scene && scene !== s.laying.scene && s.graph) {
    const before = new Set(s.laying.scene?.nodes.map((n) => n.id));
    const added = new Set(scene.nodes.filter((n) => !isSummaryId(n.id) && !before.has(n.id)).map((n) => n.id));
    s = counting({ ...s, laying: null, notice: notice(s, expansionWords(s.laying.done, s.graph, added)) });
    setState(s);
  }
  const own = s.graph !== null && answer !== null && s.version === answer.dataVersion;
  const graph = own ? s.graph : answer;

  // For the callbacks, which run after a render.
  const latest = useRef({ key, answer, graph, scene, pending: s.pending });
  useLayoutEffect(() => {
    latest.current = { key, answer, graph, scene, pending: s.pending };
  });
  const queue = useRef<Arrived[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const pendingTimer = timer;
    return () => clearTimeout(pendingTimer.current);
  }, []);

  /** Merges the answers that arrived into the view, for one new layout. */
  const publish = () => {
    timer.current = undefined;
    const now = latest.current;
    const arrived = queue.current.splice(0);
    const answerNow = now.answer;
    const items = answerNow ? arrived.filter((a) => a.key === now.key && a.version === answerNow.dataVersion) : [];
    setState((before) => {
      if (before.key !== now.key) return before;
      const loading = new Set(before.loading);
      for (const a of arrived) loading.delete(a.id);
      if (!answerNow || items.length === 0) return counting({ ...before, loading });
      const base = before.graph && before.version === answerNow.dataVersion ? before.graph : answerNow;
      let merged = base;
      for (const a of items) merged = mergeExpansion(merged, a.part, a.id);
      const done = items.map(({ id, direction, name }) => ({ id, direction, name }));
      // Nothing new to draw: said at once, with no layout to wait for.
      if (merged === base) return counting({ ...before, loading, notice: notice(before, expansionWords(done, base, NOBODY)) });
      const drawn = (now.scene?.nodes ?? []).filter((n) => !isSummaryId(n.id)).map((n) => n.id);
      return counting({
        ...before,
        version: answerNow.dataVersion,
        graph: merged,
        pinned: new Set([...before.pinned, ...drawn]),
        layoutOptions: { preset: 'expand', previousPositions: positionsOf(now.scene) },
        anchorId: items.at(-1)!.id,
        loading,
        laying: { scene: before.laying?.scene ?? now.scene, done: [...(before.laying?.done ?? []), ...done] },
      });
    });
  };

  const onExpand = (id: string, direction: ExpandDirection) => {
    const at = latest.current;
    const asked = at.answer;
    // A press while this person's expansion is loading or being laid out does nothing more.
    if (!asked || !at.graph || at.pending.has(id)) return;
    const name = at.graph.nodes.find((n) => n.id === id)?.displayName ?? '';
    setState((before) => (before.key === at.key ? counting({ ...before, loading: new Set([...before.loading, id]) }) : before));
    client.fetchQuery(orpc.lineage.ego.queryOptions({ input: expandInput(id, direction) })).then(
      (part) => {
        const now = latest.current;
        if (now.key !== at.key) return;
        if (now.graph && !sameRecord(now.graph, part)) {
          // The record changed since the view was read (DEFAULT, no D number): the expansions are
          // dropped and the view is read again, with every lineage answer kept in the browser.
          setState((before) => (before.key === at.key ? fresh(at.key, notice(before, 'The record has changed since this view was read; it is read again.')) : before));
          void client.invalidateQueries({ queryKey: orpc.lineage.key() });
          return;
        }
        queue.current.push({ key: at.key, version: asked.dataVersion, id, direction, name, part });
        clearTimeout(timer.current);
        timer.current = setTimeout(publish, RELAYOUT_DEBOUNCE_MS);
      },
      () => {
        setState((before) => {
          if (before.key !== at.key) return before;
          const loading = new Set(before.loading);
          loading.delete(id);
          return counting({ ...before, loading, notice: notice(before, `The ${direction} of ${name} could not be loaded. Nothing was changed.`) });
        });
      },
    );
  };

  return {
    graph,
    pinned: own ? s.pinned : NOBODY,
    layoutOptions: own ? s.layoutOptions : EXPLORER_LAYOUT,
    anchorId: own ? s.anchorId : null,
    onExpand,
    pending: s.pending,
    notice: s.notice,
  };
}
