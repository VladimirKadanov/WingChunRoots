// Expanding the view (plan §4.8; milestone M06, package C): "+N students" and "+N teachers" read
// the difference with lineage.ego ({ up: 0, down: 1 } or { up: 1, down: 0 }), merge it into the
// view by id (DEFAULT D03: a signed-in participant's own involved_only relationship comes with an
// expansion as with the view's read; expand-engine.ts mergeExpansion), pin the people drawn so
// capFanout never drops them, and lay the view out again with the expand preset and the last
// scene's positions, while the pressed node keeps its screen point (anchoredScene, and the
// canvas's anchor). The expansions belong to the read (`key`) and are dropped with it, or with a
// new answer to it (another dataVersion); they are not in the URL (DEFAULT, no D number; ADR 0010).
//
// In the explorer's first JavaScript (explorer.tsx imports it), so only the hook is here: the work
// of an expansion (the record check, the merge, the words, the anchor) is expand-engine.ts, a
// chunk of its own loaded with the first press while lineage.ego reads. This module is imported
// by nothing that loads later (expand-state.ts says why), and the reads through the explorer's
// query client are made here: the expansions' and the panel's list of a teacher's students.

import { useQueryClient } from '@tanstack/react-query';
import { type Dispatch, type RefObject, type SetStateAction, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { LayoutOptions, Point, Scene } from '@/lib/lineage-layout/types';
import { orpc } from '@/lib/rpc-client';
import type { LineageGraphDto } from '@/server/dto/public';

import type { Arrived } from './expand-engine';
import { counting, EXPLORER_LAYOUT, fresh, NOBODY, notice, provideStudents, type State } from './expand-state';
import type { ExpandDirection, Notice } from './graph-api';

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

/** The read of an expansion: the person and their direct students, or their direct teachers. */
export function expandInput(id: string, direction: ExpandDirection): { focusId: string; up: number; down: number } {
  return { focusId: id, up: direction === 'teachers' ? 1 : 0, down: direction === 'students' ? 1 : 0 };
}

/** The top left corners of a scene's nodes: the expand preset keeps each row's order from them. */
export function positionsOf(scene: Scene | null): Record<string, Point> {
  return Object.fromEntries((scene?.nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }]));
}

/** The layout of a view an expansion changed: the expand preset, each row's order kept from the scene on screen. */
export const expandLayout = (scene: Scene | null): LayoutOptions => ({ preset: 'expand', previousPositions: positionsOf(scene) });

/**
 * Whether expansions made on the read `made.key` over an answer of `made.version` still hold for
 * the read `key` and its `answer` (DEFAULT, no D number): a new read drops them, and so does a new
 * answer to the same read (another dataVersion: the record changed). No answer yet, or no
 * expansion yet (`version` null), keeps them.
 */
export function keepsExpansions(made: { key: string; version: string | null }, key: string, answer: Pick<LineageGraphDto, 'dataVersion'> | null): boolean {
  return made.key === key && (answer === null || made.version === null || made.version === answer.dataVersion);
}

/** The hook's last render, for the work that runs after it. */
export interface Latest {
  key: string;
  answer: LineageGraphDto | null;
  graph: LineageGraphDto | null;
  scene: Scene | null;
  pending: ReadonlySet<string>;
}

/** What the engine works with: the hook's state, its last render, and the answers waiting for a layout. */
export interface Work {
  latest: RefObject<Latest>;
  setState: Dispatch<SetStateAction<State>>;
  queue: Arrived[];
  timer: ReturnType<typeof setTimeout> | undefined;
  /** The layout of the merged view (expandLayout). */
  layout: (scene: Scene | null) => LayoutOptions;
  /** Reads the view again (the record changed since it was read), with every lineage answer kept in the browser. */
  reread: () => void;
}

type Engine = typeof import('./expand-engine');
/** The engine, once a press has loaded it: every expansion merged, laid out or said comes after one. */
let engine: Engine | undefined;
const loadEngine = (): Promise<Engine> => (engine ? Promise.resolve(engine) : import('./expand-engine').then((m) => (engine = m)));

/**
 * The scene of a layout, moved so that the node an expansion was made from (`anchorId`) keeps its
 * place in the flow, as `previous` (the scene on screen) has it: expand-engine.ts anchoredScene.
 * Without an anchor (a new read) the scene comes back as it is.
 */
export function anchoredScene(scene: Scene, previous: Scene | null, anchorId: string | null): Scene {
  return anchorId !== null && engine ? engine.anchoredScene(scene, previous, anchorId) : scene;
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
  // The expansions being laid out are drawn: say what they added (the engine laid them out, so it is here).
  if (s.laying && s.graph && scene && scene !== s.laying.scene && engine) {
    s = engine.drawn(s, scene);
    setState(s);
  }
  const own = s.graph !== null && answer !== null && s.version === answer.dataVersion;
  const graph = own ? s.graph : answer;

  // For the work after a render: the press, the answer, the layout.
  const latest = useRef<Latest>({ key, answer, graph, scene, pending: s.pending });
  useLayoutEffect(() => {
    latest.current = { key, answer, graph, scene, pending: s.pending };
  });
  const work = useRef<Work>({
    latest,
    setState,
    queue: [],
    timer: undefined,
    layout: expandLayout,
    reread: () => void client.invalidateQueries({ queryKey: orpc.lineage.key() }),
  });
  useEffect(() => {
    const pending = work.current;
    return () => clearTimeout(pending.timer);
  }, []);
  // The panel's list of a teacher's students reads its pages here (students-list.tsx).
  useEffect(() => provideStudents((input) => client.fetchQuery(orpc.people.students.queryOptions({ input }))), [client]);

  const onExpand = (id: string, direction: ExpandDirection) => {
    const at = latest.current;
    // A press while this person's expansion is loading or being laid out does nothing more.
    if (!at.answer || !at.graph || at.pending.has(id)) return;
    const name = at.graph.nodes.find((n) => n.id === id)?.displayName ?? '';
    setState((before) => (before.key === at.key ? counting({ ...before, loading: new Set([...before.loading, id]) }) : before));
    // The difference and the engine are read together.
    Promise.all([client.fetchQuery(orpc.lineage.ego.queryOptions({ input: expandInput(id, direction) })), loadEngine()]).then(
      ([part, e]) => e.arrived(work.current, at, id, direction, name, part),
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
