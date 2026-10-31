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
 *    every row keeps an order with the spacing of the preset, every such student lies
 *    between its leftmost and rightmost teacher of the lineage, and the focus spine is one
 *    vertical line through the centres of its cards. An edge spanning several rows passes
 *    each row in between at a waypoint, placed like a card of width 0. This takes three
 *    solves: (a) the rows in the order of the first pass, with the spine straight; (b) from
 *    there, top row first, a student outside the span of its teachers moves within its row
 *    to the nearest point of it (on the side of a spine card that faces the span), but not
 *    past the people of its own lineage there unless only that leaves a place; everyone else
 *    keeps the order of (a) (with the expand preset the people shown before keep their
 *    previous order and are not moved, plan §4.8); (c) the waypoints of an edge whose route
 *    in (b) is stale (deferred, a moved end, or a detour of more than a card) go to the gap
 *    of their row nearest the straight line between its ends. A student whose teachers all
 *    stand on the spine stands on it too: one per row, the line holds one card (see the owner
 *    question of M05 for a second one, and for one in a row of the spine: it stands a card
 *    step beside the line). A constraint that would contradict the others is never added: a
 *    student that is not between its teachers is reported (`LayoutStats.unplacedStudents`).
 * 3. ELK routes every edge with the positions fixed (INTERACTIVE crossing minimization and
 *    node placement, waypoints as nodes, ports at fixed positions: the incoming edges of a
 *    card at the middle of its top side, the outgoing ones where the first pass put them or,
 *    for an edge placed anew, between their neighbours, the spine edge at the middle). The
 *    routes of an edge's segments are joined.
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
/** Weight of a card once placed, while the waypoints of stale routes find their gaps. */
const PLACED_CARD_WEIGHT = 1e9;

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
  /** Desired centre: after the first pass, or where a moved student or edge wants to be. */
  x: number;
  /** Where the item goes in the order of its row (its place in the step before, nudged for a moved student). */
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
   * Students that do not stand between their teachers (to a pixel): no place there was left,
   * as for a student whose teachers all stand on the spine in a row where the place on the
   * spine line is taken, or (with the expand preset) a student shown before keeps its place
   * in its row. Their ids, in model order (`LayoutStats.unplacedStudents`).
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

/** Puts the waypoints of an edge's chain on the straight line between its two ends. */
function placeOnLine(items: Item[], chain: readonly number[], from: number, to: number): void {
  const span = chain.length - 1;
  for (let j = 1; j < span; j++) {
    const item = items[chain[j]!]!;
    item.x = item.key = item.tie = from + ((to - from) * j) / span;
  }
}

/**
 * Step (c) for one chain: each waypoint goes to a gap of its row (with the spacing on both sides
 * where the gap has room, else to its middle, and the cards then make room), choosing between
 * the nearest place left of the straight line between the chain's ends and the nearest one right
 * of it so that the route's sideways run is the shortest over all its rows. The gap nearest to
 * the line in each row on its own can send the route round a card on the right in one row and
 * round the next card on the left in the row below.
 */
function placeInGaps(
  items: Item[],
  rows: readonly (number[] | undefined)[],
  chain: readonly number[],
  at: (item: number) => number,
  spacing: number,
): void {
  const from = at(chain[0]!);
  const to = at(chain[chain.length - 1]!);
  const span = chain.length - 1;
  const options: number[][] = [];
  for (let j = 1; j < span; j++) {
    const line = from + ((to - from) * j) / span;
    const cards = (rows[items[chain[j]!]!.rank] ?? [])
      .filter((i) => items[i]!.node !== -1)
      .map((i) => ({ left: at(i) - items[i]!.width / 2, right: at(i) + items[i]!.width / 2 }))
      .sort((a, b) => a.left - b.left);
    const places: number[] = [];
    if (cards.length === 0) places.push(line);
    else {
      places.push(Math.min(line, cards[0]!.left - spacing), Math.max(line, cards[cards.length - 1]!.right + spacing));
      for (let c = 1; c < cards.length; c++) {
        const lo = cards[c - 1]!.right + spacing;
        const hi = cards[c]!.left - spacing;
        places.push(lo <= hi ? Math.min(hi, Math.max(lo, line)) : (cards[c - 1]!.right + cards[c]!.left) / 2);
      }
    }
    const left = places.filter((x) => x <= line).reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);
    const right = places.filter((x) => x >= line).reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
    options.push([...new Set([left, right].filter(Number.isFinite))]);
  }
  // The shortest sideways run through one place per row (a small dynamic programme).
  let cost = [0];
  let xs = [from];
  const choice: number[][] = [];
  for (const row of options) {
    const next = row.map((x) => {
      let best = 0;
      for (let p = 1; p < xs.length; p++) if (cost[p]! + Math.abs(x - xs[p]!) < cost[best]! + Math.abs(x - xs[best]!)) best = p;
      return { cost: cost[best]! + Math.abs(x - xs[best]!), from: best };
    });
    choice.push(next.map((n) => n.from));
    cost = next.map((n) => n.cost);
    xs = row;
  }
  let pick = 0;
  for (let p = 1; p < xs.length; p++) if (cost[p]! + Math.abs(to - xs[p]!) < cost[pick]! + Math.abs(to - xs[pick]!)) pick = p;
  for (let j = options.length - 1; j >= 0; j--) {
    const item = items[chain[j + 1]!]!;
    item.x = item.key = item.tie = options[j]![pick]!;
    pick = choice[j]![pick]!;
  }
}

/** Sideways travel of a chain beyond the distance between its ends, for the given centres. */
function detour(chain: readonly number[], centre: (item: number) => number): number {
  let travel = 0;
  for (let j = 1; j < chain.length; j++) travel += Math.abs(centre(chain[j]!) - centre(chain[j - 1]!));
  return travel - Math.abs(centre(chain[chain.length - 1]!) - centre(chain[0]!));
}

/** One half of "a student between its teachers": `x[right] ≥ x[left]` for `student`. */
interface Between {
  left: number;
  right: number;
  student: number;
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
  let widest = 0;
  const rowCentre: (number | undefined)[] = [];
  build.order.forEach((id, node) => {
    const child = children.get(id);
    if (!child) throw new ElkLayoutError(`no position for node ${id}`);
    const width = child.width ?? 0;
    height = Math.max(height, child.height ?? 0);
    widest = Math.max(widest, width);
    const rank = ranks.ranks.get(id)!;
    rowCentre[rank] ??= (child.y ?? 0) + (child.height ?? 0) / 2;
    itemOf.set(id, items.length);
    const x = (child.x ?? 0) + width / 2;
    items.push({ node, rank, width, x, key: x, tie: x, weight: 1, variable: -1, final: 0 });
  });

  // Students with several teachers in one lineage, from the top row down (a teacher is
  // always placed before its students), then in model order.
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
    .sort((a, b) => items[a.student]!.rank - items[b.student]!.rank || items[a.student]!.node - items[b.student]!.node);
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

  // Every edge as a chain of items: teacher, a waypoint in every row in between, student.
  // A waypoint starts where the first pass routed the edge, or on the straight line for a
  // deferred edge.
  const chains: number[][] = build.elkEdges.map((edge) => {
    const teacher = itemOf.get(edge.teacherId)!;
    const student = itemOf.get(edge.studentId)!;
    const t = items[teacher]!;
    const s = items[student]!;
    const span = s.rank - t.rank;
    const chain = [teacher];
    const route = deferred.has(edge.id) ? [] : sectionPoints(routes.get(edge.id));
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
  let variableCount = 0;
  let spineVariable = -1;
  build.elkEdges.forEach((edge, k) => {
    if (!spineEdges.has(edge.id)) return;
    if (spineVariable === -1) spineVariable = variableCount++;
    for (const i of chains[k]!) items[i]!.variable = spineVariable;
  });
  // A student whose teachers all stand on the spine has to stand on it too: one such
  // student per row (the spine line holds one card per row). It takes the place of the
  // spine and does not pull it towards its own place after the first pass. With the expand
  // preset a student shown before keeps its place in the order of its row instead.
  const onSpineLine = new Set<number>();
  if (spineVariable !== -1) {
    const spine = items.filter((item) => item.variable === spineVariable);
    const spineX = spine.reduce((sum, item) => sum + item.x * item.weight, 0) / spine.reduce((sum, item) => sum + item.weight, 0);
    const spineRows = new Set(spine.map((item) => item.rank));
    for (const { student, teachers } of groups) {
      const s = items[student]!;
      if (s.variable === spineVariable || spineRows.has(s.rank) || previous?.has(build.order[s.node]!)) continue;
      if (!teachers.every((t) => items[t]!.variable === spineVariable)) continue;
      s.variable = spineVariable;
      s.weight = 0;
      s.x = s.key = s.tie = spineX;
      spineRows.add(s.rank);
      onSpineLine.add(student);
    }
  }
  for (const item of items) if (item.variable === -1) item.variable = variableCount++;
  const sharesVariable = (ids: readonly number[]) => ids.every((i) => items[i]!.variable === items[ids[0]!]!.variable);

  const rows: number[][] = [];
  items.forEach((item, i) => (rows[item.rank] ??= []).push(i));

  /** The rows in the order of `key`, with the spacing of the preset (they never form a cycle). */
  const rowConstraints = (): ConstraintGraph => {
    const graph = new ConstraintGraph(variableCount);
    for (const row of rows) {
      if (!row) continue;
      // Cards before waypoints at the same place; then creation order (deterministic).
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
    return graph;
  };
  /** Positions of the variables closest to the desired centres of the items. */
  const solve = (graph: ConstraintGraph): number[] => {
    const variables: SeparationVariable[] = Array.from({ length: variableCount }, () => ({ desired: 0, weight: 0 }));
    for (const item of items) {
      if (item.weight === 0) continue;
      const v = variables[item.variable]!;
      v.desired = (v.desired * v.weight + item.x * item.weight) / (v.weight + item.weight);
      v.weight += item.weight;
    }
    for (const v of variables) if (v.weight === 0) v.weight = WAYPOINT_WEIGHT;
    return solveSeparation(variables, graph.constraints);
  };

  // (a) The rows in the order of the first pass, with the spine straightened.
  const straight = solve(rowConstraints());
  const desired = items.map((item) => item.x);
  const placed = items.map((item) => straight[item.variable]!);
  // Where the people of each lineage stand in each row.
  const extent = new Map<string, { from: number; to: number }>();
  items.forEach((item, i) => {
    if (item.node === -1) return;
    const key = `${item.rank}\u0000${orderLineage(index, build.order[item.node]!)}`;
    const e = extent.get(key);
    if (e) {
      e.from = Math.min(e.from, placed[i]!);
      e.to = Math.max(e.to, placed[i]!);
    } else {
      extent.set(key, { from: placed[i]!, to: placed[i]! });
    }
  });

  // (b) Every such student between its leftmost and rightmost teacher of the lineage, in
  // that order. A student outside that span moves in its row to the nearest point of it
  // (onto the side of a spine card that faces the span), but not past the people of its own
  // lineage there unless that is the only way (`free`); everyone else keeps the order of
  // (a). A student whose teachers all stand on the spine line, in a row where the place on
  // the line is taken, stands one card step beside it on the side it stood on in (a), and
  // the spans of its own students start from there. A constraint that would contradict the
  // others is never added; the student is reported if it ends up outside its span (`unplaced`).
  const place = (free: ReadonlySet<number>) => {
    items.forEach((item, i) => {
      item.x = desired[i]!;
      item.key = item.tie = placed[i]!;
    });
    // Where each card stands in this step, for the spans of the rows below it: its place in (a)
    // or, for a moved student, its key.
    const at = [...placed];
    const moved = new Set(onSpineLine);
    const clamped = new Set<number>();
    for (const group of groups) {
      const s = items[group.student]!;
      group.teachers.sort((a, b) => at[a]! - at[b]! || items[a]!.node - items[b]!.node);
      const from = at[group.teachers[0]!]!;
      const to = at[group.teachers[group.teachers.length - 1]!]!;
      if ((s.key >= from && s.key <= to) || previous?.has(build.order[s.node]!)) continue;
      const fromRight = s.key > to;
      let x = Math.min(to, Math.max(from, s.key));
      if (!free.has(group.student)) {
        const own = extent.get(`${s.rank}\u0000${orderLineage(index, build.order[s.node]!)}`)!;
        const kept = Math.min(own.to, Math.max(own.from, x));
        if (kept !== x) clamped.add(group.student);
        x = kept;
      }
      s.x = x;
      // Half a pixel inside the span, so that the student comes before (or after) a card
      // standing exactly at its end, such as the teacher's straight child or a spine card.
      s.key = to - from >= 1 ? x + (fromRight ? -0.5 : 0.5) : x;
      s.tie = (from + to) / 2;
      at[group.student] = s.key;
      if (to - from < 1 && Math.abs(x - from) < 1 && sharesVariable(group.teachers)) {
        // The place on the spine line is taken in this row (by the spine card, a spine edge or
        // another such student): the student comes right after it, on the side it came from.
        const line = items[group.teachers[0]!]!.variable;
        const taken = rows[s.rank]!.find((i) => i !== group.student && items[i]!.variable === line);
        if (taken !== undefined) {
          const side = fromRight ? 1 : -1;
          s.key = x + side * 0.5;
          at[group.student] = x + side * (s.width / 2 + items[taken]!.width / 2 + spacing);
        }
      }
      moved.add(group.student);
    }
    // The edges of a moved card cross the rows in between on the straight line.
    chains.forEach((chain, k) => {
      if (spineEdges.has(build.elkEdges[k]!.id)) return;
      if (!moved.has(chain[0]!) && !moved.has(chain[chain.length - 1]!)) return;
      placeOnLine(items, chain, items[chain[0]!]!.key, items[chain[chain.length - 1]!]!.key);
    });
    const graph = rowConstraints();
    const between: Between[] = [];
    const refused: { student: number; teachers: number[] }[] = [];
    // A variable can be both (the spine, or a student on the spine line).
    const add = (left: number, right: number, student: number) => {
      if (left === right) return true;
      if (!graph.add(left, right, 0)) return false;
      between.push({ left, right, student });
      return true;
    };
    for (const group of groups) {
      const s = items[group.student]!.variable;
      const left = add(items[group.teachers[0]!]!.variable, s, group.student);
      const right = add(s, items[group.teachers[group.teachers.length - 1]!]!.variable, group.student);
      if (!left || !right) refused.push(group);
    }
    return { moved, clamped, graph, between, refused };
  };
  let free = new Set<number>();
  let attempt = place(free);
  for (;;) {
    // The teachers all on the spine: no other place exists (see the owner question of M05).
    const failing = attempt.refused.filter((g) => !sharesVariable(g.teachers));
    if (failing.length === 0) break;
    const next = new Set(free);
    for (const g of failing) if (attempt.clamped.has(g.student)) next.add(g.student);
    if (next.size === free.size) for (const s of attempt.clamped) next.add(s);
    if (next.size === free.size) break;
    free = next;
    attempt = place(free);
  }
  let solved = solve(attempt.graph);

  // (c) The waypoints of a deferred edge, of an edge with a moved end, and of an edge that
  // would go far sideways and back (more than a card) go to gaps of their rows near the
  // straight line between its ends as placed in (b): in each row the nearest place left or
  // right of the line, whichever makes the shortest sideways run (placeInGaps). The cards keep their places
  // of (b) unless a waypoint needs more room, and every constraint of (b) is kept (the order
  // of the cards is that of (b), so the system still has a solution).
  const rerouted = new Set<number>();
  const at = (i: number) => solved[items[i]!.variable]!;
  chains.forEach((chain, k) => {
    const edge = build.elkEdges[k]!;
    if (chain.length <= 2 || spineEdges.has(edge.id)) return;
    const ends = [chain[0]!, chain[chain.length - 1]!];
    if (!deferred.has(edge.id) && !ends.some((i) => attempt.moved.has(i)) && detour(chain, at) <= widest) return;
    rerouted.add(k);
  });
  if (rerouted.size > 0) {
    items.forEach((item, i) => {
      item.x = item.key = item.tie = at(i);
      if (item.node !== -1 && item.weight > 0) item.weight = PLACED_CARD_WEIGHT;
    });
    for (const k of rerouted) placeInGaps(items, rows, chains[k]!, at, spacing);
    const graph = rowConstraints();
    for (const b of attempt.between) {
      if (!graph.add(b.left, b.right, 0)) attempt.refused.push(groups.find((g) => g.student === b.student)!);
    }
    solved = solve(graph);
  }
  for (const item of items) item.final = solved[item.variable]!;
  // A student whose constraint was refused, unless it stands between its teachers anyway (to a pixel).
  const outside = ({ student, teachers }: { student: number; teachers: number[] }) => {
    const xs = teachers.map((t) => items[t]!.final);
    const x = items[student]!.final;
    return x < Math.min(...xs) - 1 || x > Math.max(...xs) + 1;
  };
  const unplaced = [...new Set(attempt.refused.filter(outside).map((g) => g.student))]
    .sort((a, b) => items[a]!.node - items[b]!.node)
    .map((i) => build.order[items[i]!.node]!);

  // Ports. Outgoing: one trunk port at the middle of the bottom side of a card, shared by all
  // its outgoing edges, so that ELK routes the edges of one teacher as one hyperedge with a
  // common trunk (b5 of the M06 design review); a waypoint has one port per edge. Incoming:
  // one port at the middle of the top side, except for a student with two or more incoming
  // edges, which gets one port per edge, spread along the top side in the order of the x of
  // the item each edge comes from (b6, ADR 0005 item 10): the edges then no longer share one
  // vertical, so the edge of one teacher cannot run to the vertical of another and back, and
  // the trunks of its teachers do not become one hyperedge through it.
  const segmentId = (k: number, j: number) => `e${k}.${j}`;
  const incoming: { k: number; j: number; from: number }[][] = items.map(() => []);
  const outgoing: { k: number; j: number }[][] = items.map(() => []);
  chains.forEach((chain, k) => {
    for (let j = 0; j + 1 < chain.length; j++) {
      outgoing[chain[j]!]!.push({ k, j });
      incoming[chain[j + 1]!]!.push({ k, j, from: chain[j]! });
    }
  });
  const sourcePort = new Map<string, string>();
  const targetPort = new Map<string, string>();
  const elkChildren: ElkNode[] = items.map((item, i) => {
    const ports: ElkPort[] = [];
    const ins = incoming[i]!;
    if (ins.length >= 2 && item.node !== -1) {
      const byFrom = [...ins].sort((a, b) => items[a.from]!.final - items[b.from]!.final || a.k - b.k);
      // The spine edge keeps the middle, so the spine stays straight; the others spread evenly
      // on both sides of it.
      const spineAt = byFrom.findIndex((o) => spineEdges.has(build.elkEdges[o.k]!.id));
      const w = item.width;
      byFrom.forEach((o, n) => {
        const id = `p${i}.${n}`;
        let x = ((n + 1) * w) / (byFrom.length + 1);
        if (spineAt !== -1) {
          const after = byFrom.length - spineAt - 1;
          x = n < spineAt ? ((n + 1) * w) / 2 / (spineAt + 1) : n === spineAt ? w / 2 : w / 2 + ((n - spineAt) * w) / 2 / (after + 1);
        }
        ports.push({ id, x, y: 0, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'NORTH' } });
        targetPort.set(segmentId(o.k, o.j), id);
      });
    } else if (ins.length > 0) {
      ports.push({ id: `p${i}`, x: item.width / 2, y: 0, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'NORTH' } });
      for (const o of ins) targetPort.set(segmentId(o.k, o.j), `p${i}`);
    }
    const outs = outgoing[i]!;
    if (outs.length > 0 && item.node !== -1) {
      ports.push({ id: `n${i}.trunk`, x: item.width / 2, y: height, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'SOUTH' } });
      for (const o of outs) sourcePort.set(segmentId(o.k, o.j), `n${i}.trunk`);
    } else {
      for (const o of outs) {
        const id = `${segmentId(o.k, o.j)}.out`;
        ports.push({ id, x: 0, y: height, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'SOUTH' } });
        sourcePort.set(segmentId(o.k, o.j), id);
      }
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
      elkEdges.push({ id, sources: [sourcePort.get(id)!], targets: [targetPort.get(id)!] });
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
