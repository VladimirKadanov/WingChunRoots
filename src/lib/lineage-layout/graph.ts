import { LineageCycleError, LineageInputError } from './errors.ts';
import type { LineageEdge, LineageGraph, LineageNode } from './types.ts';

/** Adjacency index of a validated lineage graph. */
export interface GraphIndex {
  graph: LineageGraph;
  nodes: Map<string, LineageNode>;
  /** Incoming edges (from teachers) of every node, in input order. */
  teacherEdges: Map<string, LineageEdge[]>;
  /** Outgoing edges (to students) of every node, in input order. */
  studentEdges: Map<string, LineageEdge[]>;
  /** Topological order of all nodes (teachers before students), over every edge. */
  order: string[];
}

/**
 * Validates the input and builds the adjacency index.
 *
 * Throws `LineageInputError` for a node or an edge that is not an object, for duplicate node
 * or edge ids and for edges whose endpoints are not nodes of the view, and
 * `LineageCycleError` for a cycle (a self-loop included). Malformed input therefore reaches
 * the page as `INVALID_INPUT`, never as a plain TypeError that would pass for `ELK_FAILED`.
 */
export function indexGraph(graph: LineageGraph): GraphIndex {
  if (!isObject(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new LineageInputError('The graph must have the arrays `nodes` and `edges` (plan §6.3).');
  }
  if (graph.hiddenCounts != null && !isObject(graph.hiddenCounts)) {
    throw new LineageInputError('`hiddenCounts` must be an object keyed by node id (plan §6.3).');
  }
  const nodes = new Map<string, LineageNode>();
  const teacherEdges = new Map<string, LineageEdge[]>();
  const studentEdges = new Map<string, LineageEdge[]>();
  for (const node of graph.nodes) {
    if (!isObject(node)) {
      throw new LineageInputError('Every node must be an object (plan §6.3).');
    }
    if (typeof node.id !== 'string' || node.id === '') {
      throw new LineageInputError('Every node needs a non-empty string id.');
    }
    if (nodes.has(node.id)) {
      // D05: one person is always exactly one node.
      throw new LineageInputError(`Duplicate node id: ${node.id}`);
    }
    nodes.set(node.id, node);
    teacherEdges.set(node.id, []);
    studentEdges.set(node.id, []);
  }
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (!isObject(edge)) {
      throw new LineageInputError('Every edge must be an object (plan §6.3).');
    }
    if (typeof edge.id !== 'string' || edge.id === '') {
      throw new LineageInputError('Every edge needs a non-empty string id.');
    }
    if (edgeIds.has(edge.id)) {
      throw new LineageInputError(`Duplicate edge id: ${edge.id}`);
    }
    edgeIds.add(edge.id);
    if (!nodes.has(edge.teacherId)) {
      throw new LineageInputError(`Edge ${edge.id} has a teacher that is not in the view: ${edge.teacherId}`);
    }
    if (!nodes.has(edge.studentId)) {
      throw new LineageInputError(`Edge ${edge.id} has a student that is not in the view: ${edge.studentId}`);
    }
    if (edge.teacherId === edge.studentId) {
      throw new LineageCycleError([edge.teacherId, edge.studentId]);
    }
    studentEdges.get(edge.teacherId)!.push(edge);
    teacherEdges.get(edge.studentId)!.push(edge);
  }
  const order = topologicalOrder({ graph, nodes, teacherEdges, studentEdges });
  return { graph, nodes, teacherEdges, studentEdges, order };
}

/**
 * Topological order of all nodes (teachers before students), over every edge including the
 * edges to teachers from another lineage. Throws `LineageCycleError` when there is a cycle.
 */
export function topologicalOrder(index: Omit<GraphIndex, 'order'>): string[] {
  const indegree = new Map<string, number>();
  for (const [id, edges] of index.teacherEdges) indegree.set(id, edges.length);
  const queue: string[] = [];
  for (const node of index.graph.nodes) {
    if (indegree.get(node.id) === 0) queue.push(node.id);
  }
  const order: string[] = [];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]!;
    order.push(id);
    for (const edge of index.studentEdges.get(id)!) {
      const left = indegree.get(edge.studentId)! - 1;
      indegree.set(edge.studentId, left);
      if (left === 0) queue.push(edge.studentId);
    }
  }
  if (order.length !== index.nodes.size) {
    const remaining = new Set(index.graph.nodes.map((n) => n.id).filter((id) => indegree.get(id)! > 0));
    throw new LineageCycleError(findCycle(index, remaining));
  }
  return order;
}

/** Finds one cycle among the nodes left over by Kahn's algorithm (iterative DFS). */
function findCycle(index: Omit<GraphIndex, 'order'>, remaining: Set<string>): string[] {
  const state = new Map<string, 'open' | 'done'>();
  for (const start of remaining) {
    if (state.has(start)) continue;
    const path: string[] = [];
    const stack: { id: string; next: number }[] = [{ id: start, next: 0 }];
    state.set(start, 'open');
    path.push(start);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const out = index.studentEdges.get(frame.id)!;
      if (frame.next < out.length) {
        const to = out[frame.next]!.studentId;
        frame.next++;
        if (!remaining.has(to)) continue;
        const seen = state.get(to);
        if (seen === 'open') {
          return [...path.slice(path.indexOf(to)), to];
        }
        if (seen === undefined) {
          state.set(to, 'open');
          path.push(to);
          stack.push({ id: to, next: 0 });
        }
      } else {
        state.set(frame.id, 'done');
        path.pop();
        stack.pop();
      }
    }
  }
  // Unreachable for a graph that Kahn's algorithm could not finish.
  return [...remaining];
}

/** Ordinal string comparison: identical in every JavaScript engine, unlike localeCompare. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The incoming edge preferred for display (D05), never an edge from another lineage. */
export function displayPrimaryTeacherEdge(index: GraphIndex, nodeId: string): LineageEdge | undefined {
  const candidates = index.teacherEdges.get(nodeId)!.filter((e) => e.kind !== 'crossLineage');
  const preferred = candidates.filter((e) => e.isDisplayPrimary);
  if (preferred.length > 0) {
    return [...preferred].sort((a, b) => compareStrings(a.id, b.id))[0];
  }
  // DEFAULT D05: a single teacher in the same lineage is the preferred one even when the
  // flag is missing; with several unflagged teachers there is no preferred edge.
  return candidates.length === 1 ? candidates[0] : undefined;
}

function startYear(edge: LineageEdge | undefined): number {
  if (!edge) return Number.POSITIVE_INFINITY;
  let year = Number.POSITIVE_INFINITY;
  for (const period of edge.periods ?? []) {
    const match = /^(-?\d{1,4})/.exec(period.from ?? '');
    if (match) year = Math.min(year, Number(match[1]));
  }
  return year;
}

/**
 * The lineage a node is ordered by (plan §4.5): the lineage of the edge to the teacher
 * preferred for display, otherwise the first of the node's own lineages.
 */
export function orderLineage(
  index: GraphIndex,
  nodeId: string,
  primary: LineageEdge | undefined = displayPrimaryTeacherEdge(index, nodeId),
): string {
  return primary?.lineageId ?? [...(index.nodes.get(nodeId)!.lineageIds ?? [])].sort(compareStrings)[0] ?? '';
}

/**
 * Model order of the nodes (plan §4.5): by lineage, then by the year the person started
 * with the teacher preferred for display, then by name, then by id. Lineages stay in
 * adjacent blocks and the order does not depend on the order of the input arrays, so the
 * layout is stable between visits.
 */
export function modelOrder(index: GraphIndex): string[] {
  const keys = new Map<string, { lineage: string; year: number; name: string }>();
  for (const node of index.graph.nodes) {
    const primary = displayPrimaryTeacherEdge(index, node.id);
    keys.set(node.id, { lineage: orderLineage(index, node.id, primary), year: startYear(primary), name: node.displayName ?? '' });
  }
  return index.graph.nodes
    .map((n) => n.id)
    .sort((a, b) => {
      const ka = keys.get(a)!;
      const kb = keys.get(b)!;
      return (
        compareStrings(ka.lineage, kb.lineage) ||
        (ka.year === kb.year ? 0 : ka.year < kb.year ? -1 : 1) ||
        compareStrings(ka.name, kb.name) ||
        compareStrings(a, b)
      );
    });
}

/**
 * The focus spine (plan §4.5): the chain of preferred edges from the focused person up to
 * the root of the view. Edges to a teacher from another lineage are never on the spine,
 * because ELK does not route them (plan §4.6). Returns edge ids from the focus upwards.
 */
export function focusSpine(index: GraphIndex, focusId: string | null | undefined): LineageEdge[] {
  const spine: LineageEdge[] = [];
  if (!focusId || !index.nodes.has(focusId)) return spine;
  const seen = new Set<string>([focusId]);
  let current = focusId;
  for (;;) {
    const edge = displayPrimaryTeacherEdge(index, current);
    if (!edge || seen.has(edge.teacherId)) break;
    spine.push(edge);
    seen.add(edge.teacherId);
    current = edge.teacherId;
  }
  return spine;
}

/** A non-null object that is not an array. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
