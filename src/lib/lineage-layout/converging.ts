/**
 * Students with several teachers in one lineage (plan §4.6): "a student with two teachers
 * stands horizontally between them, including exactly under the preferred one".
 *
 * ELK has no constraint of that kind, and neither its crossing minimization nor its node
 * placement gives it: with every edge in one pass, a hub's students with a second teacher
 * end up anywhere in the hub's fan, often thousands of pixels outside the span of their
 * teachers (review finding graph-6 of M05; the model order of `considerModelOrder` is not
 * the cause). So a view with such students is laid out in three steps:
 *
 * 1. ELK lays out the view with one incoming edge per student, the edge to the teacher
 *    preferred for display (D05): the other edges of those students are deferred. Ranks,
 *    model order and settings are those of the single pass (elk-graph.ts).
 * 2. The centres are moved as little as possible (least squares, separation.ts) so that
 *    every row keeps its order with the spacing of the preset, every such student lies
 *    between its leftmost and rightmost teacher of the lineage, and the focus spine is one
 *    vertical line through the centres of its cards. A student outside that span first moves
 *    within its row to the nearest point of it, but not past the people of its own lineage
 *    there; everyone else keeps the order of the first pass (with the expand preset the
 *    people shown before keep their previous order and are not moved, plan §4.8). A student
 *    whose teachers all stand on the spine stands on it too: one per row, the line holds one
 *    card (see the owner question of M05 for the second one). An edge spanning several rows
 *    passes each row in between at a waypoint, placed like a card of width 0: where the
 *    first pass routed it, or on the straight line for a deferred edge.
 * 3. ELK routes every edge with the positions fixed (INTERACTIVE crossing minimization and
 *    node placement, waypoints as nodes, ports at fixed positions: the incoming edges of a
 *    card at the middle of its top side, the outgoing ones where the first pass put them,
 *    the spine edge at the middle). The routes of an edge's segments are joined.
 *
 * Views without such students keep the single ELK pass (layout.ts). Pure TypeScript and
 * deterministic, like the rest of the module.
 */
import type { ElkEdgeSection, ElkExtendedEdge, ElkNode, ElkPoint, ElkPort } from 'elkjs/lib/elk.bundled.js';
import type { ElkGraphBuild } from './elk-graph.ts';
import { ElkLayoutError } from './errors.ts';
import { displayPrimaryTeacherEdge, orderLineage, type GraphIndex } from './graph.ts';
import { RANK_PSEUDO_Y } from './presets.ts';
import { roundCoord } from './scene.ts';
import { ConstraintGraph, solveSeparation, type SeparationVariable } from './separation.ts';
import type { RankResult } from './types.ts';

/** Weight of a waypoint against a card (1): edges give way before people move. */
const WAYPOINT_WEIGHT = 0.1;

/**
 * The ELK edges of the first pass to leave out: for every student with several incoming
 * ELK edges, all but the edge to the teacher preferred for display (or, without one, the
 * first in model order).
 */
export function deferredEdges(index: GraphIndex, build: ElkGraphBuild): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const edge of build.elkEdges) {
    const ids = incoming.get(edge.studentId);
    if (ids) ids.push(edge.id);
    else incoming.set(edge.studentId, [edge.id]);
  }
  const deferred = new Set<string>();
  for (const [studentId, ids] of incoming) {
    if (ids.length < 2) continue;
    const kept = displayPrimaryTeacherEdge(index, studentId)?.id ?? ids[0];
    for (const id of ids) if (id !== kept) deferred.add(id);
  }
  return deferred;
}

/** The ELK graph of the first pass: the graph of `buildElkGraph` without the deferred edges. */
export function firstPassGraph(build: ElkGraphBuild, deferred: ReadonlySet<string>): ElkNode {
  return { ...build.elkGraph, edges: (build.elkGraph.edges ?? []).filter((e) => !deferred.has(e.id)) };
}

/** A card or a waypoint in a row of the separation problem. */
interface Item {
  /** Index in `build.order` for a card, -1 for a waypoint. */
  node: number;
  rank: number;
  width: number;
  /** Centre after the first pass: the desired position. */
  x: number;
  /** Where the item goes in the order of its row (`x`, nudged for a moved student). */
  key: number;
  /** Tie-break of `key`: the middle of a moved student's span, so the leftmost span comes first. */
  tie: number;
  weight: number;
  variable: number;
  /** Final centre. */
  final: number;
}

export interface ConvergingPass {
  /** The ELK graph of the third step. */
  elkGraph: ElkNode;
  /**
   * Students that could not be placed between their teachers: a second student whose
   * teachers all stand on the spine, or one whose place would change the order of a row
   * the first pass or the expand preset fixed. Their ids, in model order.
   */
  unplaced: string[];
  /** Turns ELK's result for `elkGraph` into the result of a single pass for `buildScene`. */
  merge(laidOut: ElkNode): ElkNode;
}

function isVertical(a: ElkPoint, b: ElkPoint): boolean {
  return Math.abs(a.x - b.x) < 1e-6;
}

function sectionPoints(edge: ElkExtendedEdge | undefined): ElkPoint[] {
  const points: ElkPoint[] = [];
  for (const section of edge?.sections ?? []) {
    points.push(section.startPoint, ...(section.bendPoints ?? []), section.endPoint);
  }
  return points;
}

/** x where a route crosses the horizontal line at `y` on a vertical segment, if it does. */
function xAt(points: readonly ElkPoint[], y: number): number | undefined {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (isVertical(a, b) && Math.min(a.y, b.y) <= y && y <= Math.max(a.y, b.y)) return a.x;
  }
  return undefined;
}

/** Joins the points of an edge's segments: no repeated points, no points inside a straight run. */
export function joinRoute(points: readonly ElkPoint[]): ElkPoint[] {
  const out: ElkPoint[] = [];
  for (const p of points) {
    const next = { x: roundCoord(p.x), y: roundCoord(p.y) };
    const last = out[out.length - 1];
    if (last && last.x === next.x && last.y === next.y) continue;
    const before = out[out.length - 2];
    if (last && before && ((before.x === last.x && last.x === next.x) || (before.y === last.y && last.y === next.y))) {
      out[out.length - 1] = next;
    } else {
      out.push(next);
    }
  }
  return out;
}

/**
 * Steps 2 and 3 for a view with deferred edges: places the cards and waypoints from the
 * result of the first pass and returns the ELK graph that routes every edge.
 */
export function convergingPass(
  index: GraphIndex,
  ranks: RankResult,
  build: ElkGraphBuild,
  deferred: ReadonlySet<string>,
  firstPass: ElkNode,
): ConvergingPass {
  const presetOptions = build.elkGraph.layoutOptions ?? {};
  const spacing = Number(presetOptions['elk.spacing.nodeNode'] ?? '20');
  const children = new Map((firstPass.children ?? []).map((c) => [c.id, c]));
  const routes = new Map((firstPass.edges ?? []).map((e) => [e.id, e]));

  // Cards, with their centres after the first pass.
  const items: Item[] = [];
  const itemOf = new Map<string, number>();
  let height = 0;
  const rowCentre: (number | undefined)[] = [];
  build.order.forEach((id, node) => {
    const child = children.get(id);
    if (!child) throw new ElkLayoutError(`no position for node ${id}`);
    const width = child.width ?? 0;
    height = Math.max(height, child.height ?? 0);
    const rank = ranks.ranks.get(id)!;
    rowCentre[rank] ??= (child.y ?? 0) + (child.height ?? 0) / 2;
    itemOf.set(id, items.length);
    const x = (child.x ?? 0) + width / 2;
    items.push({ node, rank, width, x, key: x, tie: x, weight: 1, variable: -1, final: 0 });
  });

  // Students with several teachers in one lineage, in model order. A student outside the
  // span of its teachers moves in its row to the nearest point of the span (but not past
  // the people of its own lineage in that row); everyone else keeps the order of the
  // first pass.
  const teachersOf = new Map<string, { student: number; teachers: number[] }>();
  for (const edge of build.elkEdges) {
    const key = `${edge.studentId}\u0000${edge.lineageId}`;
    const entry = teachersOf.get(key);
    const teacher = itemOf.get(edge.teacherId)!;
    if (entry) entry.teachers.push(teacher);
    else teachersOf.set(key, { student: itemOf.get(edge.studentId)!, teachers: [teacher] });
  }
  const groups = [...teachersOf.values()]
    .filter((g) => g.teachers.length >= 2)
    .sort((a, b) => items[a.student]!.node - items[b.student]!.node);
  // With the expand preset the people shown before keep their order (plan §4.8): they are
  // never moved here, and in every row they take the places they hold after the first pass
  // in the order of their previous x (semi-interactive crossing minimization gives way to
  // the model order where the previous order departs from it).
  const previous = build.previous;
  if (previous) {
    const rowsOfCards: number[][] = [];
    items.forEach((item, i) => {
      if (previous.has(build.order[item.node]!)) (rowsOfCards[item.rank] ??= []).push(i);
    });
    for (const row of rowsOfCards) {
      if (!row) continue;
      const places = row.map((i) => items[i]!.x).sort((a, b) => a - b);
      const byPrevious = [...row].sort(
        (a, b) => previous.get(build.order[items[a]!.node]!)!.x - previous.get(build.order[items[b]!.node]!)!.x || a - b,
      );
      byPrevious.forEach((i, j) => {
        items[i]!.x = items[i]!.key = items[i]!.tie = places[j]!;
      });
    }
  }
  const extent = new Map<string, { from: number; to: number }>();
  for (const item of items) {
    const key = `${item.rank}\u0000${orderLineage(index, build.order[item.node]!)}`;
    const e = extent.get(key);
    if (e) {
      e.from = Math.min(e.from, item.x);
      e.to = Math.max(e.to, item.x);
    } else {
      extent.set(key, { from: item.x, to: item.x });
    }
  }
  const moved = new Set<number>();
  for (const group of groups) {
    group.teachers.sort((a, b) => items[a]!.x - items[b]!.x || items[a]!.node - items[b]!.node);
    const s = items[group.student]!;
    const from = items[group.teachers[0]!]!.x;
    const to = items[group.teachers[group.teachers.length - 1]!]!.x;
    if ((s.x >= from && s.x <= to) || previous?.has(build.order[s.node]!)) continue;
    const own = extent.get(`${s.rank}\u0000${orderLineage(index, build.order[s.node]!)}`)!;
    // Half a pixel inside the span, so that the student comes before (or after) a card
    // standing exactly at its end, such as the teacher's straight child.
    const inward = s.x > to ? -0.5 : 0.5;
    s.x = Math.min(own.to, Math.max(own.from, Math.min(to, Math.max(from, s.x))));
    s.key = s.x + inward;
    s.tie = (from + to) / 2;
    moved.add(group.student);
  }

  // Every edge as a chain of items: teacher, a waypoint in every row in between, student.
  const chains: number[][] = build.elkEdges.map((edge) => {
    const teacher = itemOf.get(edge.teacherId)!;
    const student = itemOf.get(edge.studentId)!;
    const t = items[teacher]!;
    const s = items[student]!;
    const span = s.rank - t.rank;
    const chain = [teacher];
    // The route of the first pass, unless the edge was not in it or one of its ends moved.
    const route =
      deferred.has(edge.id) || moved.has(teacher) || moved.has(student) ? [] : sectionPoints(routes.get(edge.id));
    for (let rank = t.rank + 1; rank < s.rank; rank++) {
      const y = rowCentre[rank];
      const x = (y === undefined ? undefined : xAt(route, y)) ?? t.x + ((s.x - t.x) * (rank - t.rank)) / span;
      chain.push(items.length);
      items.push({ node: -1, rank, width: 0, x, key: x, tie: x, weight: WAYPOINT_WEIGHT, variable: -1, final: 0 });
    }
    chain.push(student);
    return chain;
  });

  // Variables: one per item, except that the focus spine (cards and waypoints) is one.
  const spineEdges = new Set(build.spine.map((e) => e.id));
  const variables: SeparationVariable[] = [];
  let spineVariable = -1;
  build.elkEdges.forEach((edge, k) => {
    if (!spineEdges.has(edge.id)) return;
    if (spineVariable === -1) {
      spineVariable = variables.length;
      variables.push({ desired: 0, weight: 0 });
    }
    for (const i of chains[k]!) items[i]!.variable = spineVariable;
  });
  // A student whose leftmost and rightmost teachers are both on the spine has to stand on
  // it: one such student per row (the spine line holds one card per row).
  const spineRows = new Set(items.filter((item) => item.variable !== -1).map((item) => item.rank));
  for (const { student, teachers } of groups) {
    const s = items[student]!;
    const onSpine = (i: number) => spineVariable !== -1 && items[i]!.variable === spineVariable;
    if (onSpine(student) || !onSpine(teachers[0]!) || !onSpine(teachers[teachers.length - 1]!)) continue;
    if (spineRows.has(s.rank)) continue;
    s.variable = spineVariable;
    spineRows.add(s.rank);
  }
  for (const item of items) {
    if (item.variable === -1) {
      item.variable = variables.length;
      variables.push({ desired: item.x, weight: item.weight });
    } else {
      const v = variables[item.variable]!;
      v.desired = (v.desired * v.weight + item.x * item.weight) / (v.weight + item.weight);
      v.weight += item.weight;
    }
  }

  // Rows: the order of the first pass, with the spacing of the preset.
  const rows: number[][] = [];
  items.forEach((item, i) => (rows[item.rank] ??= []).push(i));
  const graph = new ConstraintGraph(variables.length);
  for (const row of rows) {
    if (!row) continue;
    // Cards before waypoints at the same x; then creation order (deterministic).
    row.sort(
      (a, b) =>
        items[a]!.key - items[b]!.key ||
        items[a]!.tie - items[b]!.tie ||
        Number(items[a]!.node === -1) - Number(items[b]!.node === -1) ||
        a - b,
    );
    for (let j = 1; j < row.length; j++) {
      const left = items[row[j - 1]!]!;
      const right = items[row[j]!]!;
      if (left.variable === right.variable) continue;
      graph.add(left.variable, right.variable, left.width / 2 + right.width / 2 + spacing, false);
    }
  }

  // Every student between its leftmost and rightmost teacher of each lineage.
  const unplaced: string[] = [];
  for (const { student, teachers } of groups) {
    const s = items[student]!.variable;
    const left = items[teachers[0]!]!.variable;
    const right = items[teachers[teachers.length - 1]!]!.variable;
    const ok = (left === s || graph.add(left, s, 0)) && (right === s || graph.add(s, right, 0));
    if (!ok) unplaced.push(build.order[items[student]!.node]!);
  }

  const solved = solveSeparation(variables, graph.constraints);
  for (const item of items) item.final = solved[item.variable]!;

  // Ports. Incoming: one port at the middle of the top side. Outgoing: where the first pass
  // put them; a deferred edge between its neighbours in the order of the next row; the
  // spine edge at the middle, with the others spread evenly on both sides of it.
  const outgoing: { k: number; next: number }[][] = items.map(() => []);
  build.elkEdges.forEach((_, k) => {
    const chain = chains[k]!;
    for (let j = 0; j + 1 < chain.length; j++) outgoing[chain[j]!]!.push({ k, next: chain[j + 1]! });
  });
  const portOffset = new Map<string, number>();
  const segmentId = (k: number, j: number) => `e${k}.${j}`;
  items.forEach((item, i) => {
    const outs = outgoing[i]!;
    if (outs.length === 0) return;
    if (item.node === -1) {
      for (const o of outs) portOffset.set(segmentId(o.k, chains[o.k]!.indexOf(i)), 0);
      return;
    }
    const byNext = [...outs].sort((a, b) => items[a.next]!.final - items[b.next]!.final || a.k - b.k);
    const spineAt = byNext.findIndex((o) => spineEdges.has(build.elkEdges[o.k]!.id));
    const w = item.width;
    if (spineAt !== -1) {
      const after = byNext.length - spineAt - 1;
      byNext.forEach((o, j) => {
        const offset =
          j < spineAt ? ((j + 1) * w) / 2 / (spineAt + 1) : j === spineAt ? w / 2 : w / 2 + ((j - spineAt) * w) / 2 / (after + 1);
        portOffset.set(segmentId(o.k, 0), offset);
      });
      return;
    }
    const startOf = (k: number) => routes.get(build.elkEdges[k]!.id)?.sections?.[0]?.startPoint.x;
    const left = children.get(build.order[item.node]!)?.x ?? 0;
    const kept = byNext
      .filter((o) => !deferred.has(build.elkEdges[o.k]!.id) && startOf(o.k) !== undefined)
      .map((o) => ({ ...o, offset: Math.min(w, Math.max(0, startOf(o.k)! - left)) }))
      .sort((a, b) => a.offset - b.offset || a.k - b.k);
    for (const o of kept) portOffset.set(segmentId(o.k, 0), o.offset);
    const slots: { k: number; next: number }[][] = Array.from({ length: kept.length + 1 }, () => []);
    for (const o of byNext) {
      if (portOffset.has(segmentId(o.k, 0))) continue;
      const x = items[o.next]!.final;
      slots[kept.filter((p) => items[p.next]!.final < x).length]!.push(o);
    }
    slots.forEach((slot, s) => {
      const from = s === 0 ? 0 : kept[s - 1]!.offset;
      const to = s === kept.length ? w : kept[s]!.offset;
      slot.forEach((o, j) => portOffset.set(segmentId(o.k, 0), from + ((j + 1) * (to - from)) / (slot.length + 1)));
    });
  });

  const hasIncoming = new Set<number>();
  for (const chain of chains) for (let j = 1; j < chain.length; j++) hasIncoming.add(chain[j]!);
  const elkChildren: ElkNode[] = items.map((item, i) => {
    const ports: ElkPort[] = [];
    if (hasIncoming.has(i)) {
      ports.push({ id: `p${i}`, x: item.width / 2, y: 0, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'NORTH' } });
    }
    for (const o of outgoing[i]!) {
      const id = segmentId(o.k, chains[o.k]!.indexOf(i));
      ports.push({ id: `${id}.out`, x: portOffset.get(id)!, y: height, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'SOUTH' } });
    }
    return {
      id: `n${i}`,
      width: item.width,
      height,
      x: item.final - item.width / 2,
      y: item.rank * RANK_PSEUDO_Y,
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      ports,
    };
  });
  const elkEdges: ElkExtendedEdge[] = [];
  chains.forEach((chain, k) => {
    for (let j = 0; j + 1 < chain.length; j++) {
      const id = segmentId(k, j);
      elkEdges.push({ id, sources: [`${id}.out`], targets: [`p${chain[j + 1]!}`] });
    }
  });
  const layoutOptions: Record<string, string> = {
    ...presetOptions,
    'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
    'elk.layered.nodePlacement.strategy': 'INTERACTIVE',
    'elk.layered.considerModelOrder.strategy': 'NONE',
  };
  delete layoutOptions['elk.layered.crossingMinimization.semiInteractive'];
  delete layoutOptions['elk.layered.crossingMinimization.forceNodeModelOrder'];
  const elkGraph: ElkNode = { id: build.elkGraph.id, layoutOptions, children: elkChildren, edges: elkEdges };

  const merge = (laidOut: ElkNode): ElkNode => {
    const placed = new Map((laidOut.children ?? []).map((c) => [c.id, c]));
    const routed = new Map((laidOut.edges ?? []).map((e) => [e.id, e]));
    const mergedChildren: ElkNode[] = build.order.map((id) => {
      const child = placed.get(`n${itemOf.get(id)!}`);
      if (!child) throw new ElkLayoutError(`no position for node ${id}`);
      return { id, x: child.x, y: child.y, width: child.width, height: child.height };
    });
    const mergedEdges: ElkExtendedEdge[] = build.elkEdges.map((edge, k) => {
      const points: ElkPoint[] = [];
      for (let j = 0; j + 1 < chains[k]!.length; j++) {
        const segment = sectionPoints(routed.get(segmentId(k, j)));
        if (segment.length === 0) throw new ElkLayoutError(`no route for edge ${edge.id}`);
        points.push(...segment);
      }
      const route = joinRoute(points);
      const section: ElkEdgeSection = {
        id: `${edge.id}:route`,
        startPoint: route[0]!,
        bendPoints: route.slice(1, -1),
        endPoint: route[route.length - 1]!,
      };
      return { id: edge.id, sources: [edge.teacherId], targets: [edge.studentId], sections: [section] };
    });
    return { ...laidOut, id: build.elkGraph.id, children: mergedChildren, edges: mergedEdges };
  };

  return { elkGraph, unplaced, merge };
}
