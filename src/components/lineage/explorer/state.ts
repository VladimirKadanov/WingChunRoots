// The explorer's state in the URL (plan §4.3; milestone M05): ?focus=<id>&up=2&down=2&lineage=<id>
// &show=historical&view=graph|list, so every view can be shared and survives a reload. nuqs reads
// it in the browser (explorer.tsx) and paramsFrom() on the server, with the same rules, so the
// server's first read and the client's first query are the same request.
//
// Three views (plan §4.3):
//   - person (the default): every ancestor (up=all) and 2 generations of students; under 640 px
//     it starts at up=2, down=1;
//   - generations: `up` and `down` set, changed with step buttons;
//   - lineage: `lineage` set: the lineage's root (DEFAULT D22: the focus when the root is unknown)
//     and 3 generations below it.

import type { LineageGraphDto } from '@/server/dto/public';
import type { AltName, Box, LineageGraph, Point } from '@/lib/lineage-layout/types';

import { isHistoricalRelation } from '../status';

/** The caps of the lineage API (src/server/services/lineage-graph.ts). */
export const MAX_UP = 16;
export const MAX_DOWN = 4;
export const MAX_LINEAGE_DEPTH = 6;
/** Plan §4.3: the person view's defaults, and on a narrow screen. */
export const PERSON_DEFAULTS = { up: MAX_UP, down: 2 } as const;
export const NARROW_DEFAULTS = { up: 2, down: 1 } as const;
export const GENERATIONS_DEFAULT = 2;
export const LINEAGE_DEFAULT_DEPTH = 3;
/** Below this width (CSS px) the explorer starts small (plan §4.3). */
export const NARROW_QUERY = '(max-width: 639px)';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** A whole number of up to two digits from the URL, or null. */
export function parseCount(value: string | null | undefined): number | null {
  return value && /^\d{1,2}$/.test(value) ? Number(value) : null;
}

/** The explorer's params from a page's search params (the same rules as the nuqs parsers). */
export function paramsFrom(query: Record<string, string | string[] | undefined>): ExplorerParams {
  const one = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const id = (key: string) => {
    const value = one(key);
    return isUuid(value) ? value.toLowerCase() : null;
  };
  return {
    focus: id('focus'),
    up: parseCount(one('up')),
    down: parseCount(one('down')),
    lineage: id('lineage'),
    show: one('show') === 'historical' ? 'historical' : null,
    view: one('view') === 'list' ? 'list' : 'graph',
  };
}

export type ViewKind = 'person' | 'generations' | 'lineage';

export interface ExplorerParams {
  focus: string | null;
  up: number | null;
  down: number | null;
  lineage: string | null;
  show: 'historical' | null;
  view: 'graph' | 'list';
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function viewKind(params: Pick<ExplorerParams, 'up' | 'down' | 'lineage'>): ViewKind {
  if (params.lineage) return 'lineage';
  return params.up !== null || params.down !== null ? 'generations' : 'person';
}

/** The read a view needs: lineage.ego for a person or N generations, lineage.subtree for a lineage. */
export type ExplorerRead =
  | { procedure: 'ego'; input: { focusId: string; up: number; down: number } }
  | { procedure: 'subtree'; input: { rootId: string; lineageId: string; depth: number } };

/**
 * The read of `params` (with a focus). `lineageRoot` is the lineage's public root, when known;
 * `narrow` applies the small defaults of the person view.
 */
export function explorerRead(params: ExplorerParams & { focus: string }, lineageRoot: string | null, narrow: boolean): ExplorerRead {
  const kind = viewKind(params);
  if (kind === 'lineage') {
    return {
      procedure: 'subtree',
      input: { rootId: lineageRoot ?? params.focus, lineageId: params.lineage!, depth: clamp(params.down ?? LINEAGE_DEFAULT_DEPTH, 1, MAX_LINEAGE_DEPTH) },
    };
  }
  if (kind === 'generations') {
    return {
      procedure: 'ego',
      input: {
        focusId: params.focus,
        up: clamp(params.up ?? GENERATIONS_DEFAULT, 0, MAX_UP),
        down: clamp(params.down ?? GENERATIONS_DEFAULT, 0, MAX_DOWN),
      },
    };
  }
  const defaults = narrow ? NARROW_DEFAULTS : PERSON_DEFAULTS;
  return { procedure: 'ego', input: { focusId: params.focus, ...defaults } };
}

/** Plan §4.8: above about 12 visible students of one teacher, the first ones are drawn and the rest counted. */
export const FANOUT_SHOWN = 12;

/**
 * The graph with at most FANOUT_SHOWN students drawn under each teacher (plan §4.8: "verified,
 * active, with the most descendants"): verified relationships first, then the active ones (the
 * training has not ended), then the display-primary ones, then the students with the most students
 * of their own, then by name. A student left out is drawn anyway when another teacher in the view
 * keeps it; everything only reachable through left-out students goes too. `more` counts, per
 * teacher whose students the cap cut, every student not drawn: those of the answer left out here
 * and the public ones the read itself left out (hiddenCounts: the server's fan-out limit). The
 * expand buttons that show them come with M06; the list view has them all.
 */
export function capFanout(graph: LineageGraphDto, shown = FANOUT_SHOWN): { graph: LineageGraphDto; more: Map<string, number> } {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const byTeacher = new Map<string, LineageGraphDto['edges']>();
  for (const e of graph.edges) byTeacher.set(e.teacherId, [...(byTeacher.get(e.teacherId) ?? []), e]);
  const kept = new Set<string>();
  const more = new Map<string, number>();
  const active = (e: LineageGraphDto['edges'][number]) => Number(!isHistoricalRelation(e.periods));
  for (const [teacherId, edges] of byTeacher) {
    const sorted = [...edges].sort(
      (a, b) =>
        Number(b.status === 'verified') - Number(a.status === 'verified') ||
        active(b) - active(a) ||
        Number(b.isDisplayPrimary) - Number(a.isDisplayPrimary) ||
        (nodes.get(b.studentId)?.childCount ?? 0) - (nodes.get(a.studentId)?.childCount ?? 0) ||
        (nodes.get(a.studentId)?.displayName ?? '').localeCompare(nodes.get(b.studentId)?.displayName ?? '', 'en'),
    );
    // The focus's link to each of its teachers is always drawn (its own students are capped like anyone's).
    const forced = sorted.filter((e) => e.studentId === graph.focusId);
    const rest = sorted.filter((e) => !forced.includes(e));
    const keep = [...forced, ...rest.slice(0, Math.max(0, shown - forced.length))];
    for (const e of keep) kept.add(e.id);
    if (sorted.length > keep.length) more.set(teacherId, sorted.length - keep.length);
  }
  if (more.size === 0) return { graph, more };
  // Reachable from the view's top people (no teacher in the view) and the focus, along kept edges.
  const students = new Set(graph.edges.map((e) => e.studentId));
  const reachable = new Set(graph.nodes.filter((n) => !students.has(n.id) || n.id === graph.focusId).map((n) => n.id));
  const queue = [...reachable];
  const keptBy = new Map<string, LineageGraphDto['edges']>();
  for (const e of graph.edges) if (kept.has(e.id)) keptBy.set(e.teacherId, [...(keptBy.get(e.teacherId) ?? []), e]);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const e of keptBy.get(id) ?? []) {
      if (!reachable.has(e.studentId)) {
        reachable.add(e.studentId);
        queue.push(e.studentId);
      }
    }
  }
  // The focus's own teachers are reachable upwards too (the person view draws every ancestor).
  const teachersOf = new Map<string, string[]>();
  for (const e of graph.edges) teachersOf.set(e.studentId, [...(teachersOf.get(e.studentId) ?? []), e.teacherId]);
  const up = [...reachable];
  while (up.length > 0) {
    const id = up.shift()!;
    for (const t of teachersOf.get(id) ?? []) {
      if (!reachable.has(t)) {
        reachable.add(t);
        up.push(t);
      }
    }
  }
  // Every relationship between two people who are drawn is drawn (a second teacher is never
  // hidden), so "more" counts what is really left out: students, not relationships (a student
  // may have two with one teacher, in two lineages).
  const edges = graph.edges.filter((e) => reachable.has(e.teacherId) && reachable.has(e.studentId));
  const drawn = new Map<string, Set<string>>();
  for (const e of edges) drawn.set(e.teacherId, (drawn.get(e.teacherId) ?? new Set()).add(e.studentId));
  const left = new Map<string, number>();
  for (const [teacherId, all] of byTeacher) {
    const n = new Set(all.map((e) => e.studentId)).size - (drawn.get(teacherId)?.size ?? 0);
    // The students the read did not return are not drawn either (public counts only).
    if (n > 0) left.set(teacherId, n + (graph.hiddenCounts[teacherId]?.students ?? 0));
  }
  return { graph: { ...graph, nodes: graph.nodes.filter((n) => reachable.has(n.id)), edges }, more: left };
}

/**
 * The address of a view, with the keys the browser writes (nuqs leaves out what is at its
 * default), and `extra` keys after them: the server's links into the explorer (Retry, the list
 * view's pages and "all routes").
 */
export function explorerHref(params: ExplorerParams, extra: Readonly<Record<string, string>> = {}): string {
  const search = new URLSearchParams();
  if (params.focus) search.set('focus', params.focus);
  if (params.up !== null) search.set('up', String(params.up));
  if (params.down !== null) search.set('down', String(params.down));
  if (params.lineage) search.set('lineage', params.lineage);
  if (params.show) search.set('show', params.show);
  if (params.view === 'list') search.set('view', 'list');
  for (const [key, value] of Object.entries(extra)) search.set(key, value);
  return search.size > 0 ? `/explore?${search}` : '/explore';
}

/** A stable key for a read (the server's first read is reused by the client when the keys match). */
export const readKey = (read: ExplorerRead) => JSON.stringify(read);

/** The graph as the layout module reads it (its own optional fields instead of nulls). */
export function toLayoutGraph(graph: LineageGraphDto): LineageGraph {
  return {
    focusId: graph.focusId,
    dataVersion: graph.dataVersion,
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      displayName: n.displayName,
      altNames: n.altNames.map(
        (a): AltName => ({ value: a.value, script: a.script, lang: a.lang, ...(a.romanization ? { romanization: a.romanization } : {}) }),
      ),
      lifeStatus: n.lifeStatus,
      claimState: n.claimState,
      lineageIds: n.lineageIds,
      childCount: n.childCount,
      hasMoreChildren: n.hasMoreChildren,
    })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      teacherId: e.teacherId,
      studentId: e.studentId,
      lineageId: e.lineageId,
      kind: e.kind,
      status: e.status,
      isDisplayPrimary: e.isDisplayPrimary,
      visibility: e.visibility,
      periods: e.periods,
    })),
    hiddenCounts: graph.hiddenCounts,
  };
}

/**
 * The way from the route's end `at` (on the border of the full-size slot) to the border of the
 * smaller `box` drawn at a compact or dot level of detail: straight up or down from a top or bottom
 * end, across from a side end, with a turn when the end lies beyond the box. Empty when the end is
 * on the box already.
 */
export function joinToBox(at: Point, box: Box): Point[] {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const inset = Math.min(4, box.width / 2, box.height / 2);
  if (at.y < box.y || at.y > box.y + box.height) {
    const x = clamp(at.x, box.x + inset, box.x + box.width - inset);
    const y = at.y < box.y ? box.y : box.y + box.height;
    return x === at.x ? [{ x, y }] : [{ x, y }, { x, y: at.y }];
  }
  if (at.x < box.x || at.x > box.x + box.width) {
    const x = at.x < box.x ? box.x : box.x + box.width;
    const y = clamp(at.y, box.y + inset, box.y + box.height - inset);
    return y === at.y ? [{ x, y }] : [{ x, y }, { x: at.x, y }];
  }
  return [];
}

/**
 * The people and lines drawn before anyone is selected: ended training only with show=historical
 * (plan §4.6), and nobody whose every line in the view is ended training, except the focus. The
 * skeleton takes its shape from this, as the canvas draws it.
 */
export function drawnByDefault(graph: LineageGraphDto, showHistorical: boolean): LineageGraphDto {
  if (showHistorical) return graph;
  const edges = graph.edges.filter((e) => !isHistoricalRelation(e.periods));
  const linked = new Set(graph.edges.flatMap((e) => [e.teacherId, e.studentId]));
  const kept = new Set(edges.flatMap((e) => [e.teacherId, e.studentId]));
  return { ...graph, nodes: graph.nodes.filter((n) => !linked.has(n.id) || kept.has(n.id) || n.id === graph.focusId), edges };
}
