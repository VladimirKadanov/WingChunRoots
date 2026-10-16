/**
 * Subgraph extraction for the layout tests and the benchmark: mimics what the explorer API
 * of M04 returns (plan §4.3, §6.3) from the synthetic dataset, without a database.
 */
import { compareStrings } from '../graph.ts';
import type { HiddenCount, LineageEdge, LineageGraph, LineageNode } from '../types.ts';
import { EGO_ANCHORS, anchorId, type AnchorSlug, type SyntheticDataset } from './synthetic.ts';

export interface ViewSpec {
  /** Focused person (node id). */
  focus: string;
  /** Rows of teachers above the focus: a number or `all` (plan §4.3). */
  up: number | 'all';
  /** Rows of students below the focus. */
  down: number;
  /** Students followed per teacher on the way down (the API's LIMIT in LATERAL, plan §6.3). */
  maxStudentsPerTeacher?: number;
  /** Follow only edges of this lineage on the way down (the "one lineage" view). */
  lineageId?: string;
  /**
   * Also show the teachers from another lineage of the people in the view, without their
   * own teachers: these are the cut-off teachers of plan §4.4.
   */
  includeForeignTeachers?: boolean;
  /** Stop the descent once the view has this many people. */
  maxNodes?: number;
  /** People always followed first on the way down (kept under the per-teacher limit). */
  pin?: readonly string[];
}

/** Extracts a view in the shape of plan §6.3, with `hiddenCounts` for what was left out. */
export function extractView(dataset: SyntheticDataset, spec: ViewSpec): LineageGraph {
  const { graph } = dataset;
  const teachersOf = new Map<string, LineageEdge[]>();
  const studentsOf = new Map<string, LineageEdge[]>();
  for (const node of graph.nodes) {
    teachersOf.set(node.id, []);
    studentsOf.set(node.id, []);
  }
  for (const edge of graph.edges) {
    teachersOf.get(edge.studentId)!.push(edge);
    studentsOf.get(edge.teacherId)!.push(edge);
  }
  if (!teachersOf.has(spec.focus)) throw new Error(`Unknown focus: ${spec.focus}`);

  // Descendant counts, for "the students with the most descendants first" (plan §4.8).
  const descendants = new Map<string, number>();
  const countDescendants = (id: string): number => {
    const known = descendants.get(id);
    if (known !== undefined) return known;
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      for (const e of studentsOf.get(stack.pop()!)!) {
        if (!seen.has(e.studentId)) {
          seen.add(e.studentId);
          stack.push(e.studentId);
        }
      }
    }
    descendants.set(id, seen.size);
    return seen.size;
  };
  const pinned = new Set(spec.pin ?? []);
  const maxNodes = spec.maxNodes ?? Number.POSITIVE_INFINITY;

  const included = new Set<string>([spec.focus]);
  // Teachers, all rows or `up` rows.
  const upRows = spec.up === 'all' ? Number.POSITIVE_INFINITY : spec.up;
  let frontier = [spec.focus];
  for (let row = 0; row < upRows && frontier.length > 0; row++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of teachersOf.get(id)!) {
        if (!included.has(e.teacherId)) {
          included.add(e.teacherId);
          next.push(e.teacherId);
        }
      }
    }
    frontier = next;
  }
  // Students, `down` rows, limited per teacher.
  frontier = [spec.focus];
  for (let row = 0; row < spec.down && frontier.length > 0 && included.size < maxNodes; row++) {
    const next: string[] = [];
    for (const id of frontier) {
      const students = studentsOf
        .get(id)!
        .filter((e) => spec.lineageId === undefined || e.lineageId === spec.lineageId)
        .map((e) => e.studentId)
        .sort(
          (a, b) =>
            Number(pinned.has(b)) - Number(pinned.has(a)) ||
            countDescendants(b) - countDescendants(a) ||
            compareStrings(a, b),
        );
      const limit = spec.maxStudentsPerTeacher ?? Number.POSITIVE_INFINITY;
      for (const student of students.slice(0, limit)) {
        if (included.size >= maxNodes) break;
        if (!included.has(student)) {
          included.add(student);
          next.push(student);
        }
      }
    }
    frontier = next;
  }
  if (spec.includeForeignTeachers) {
    for (const id of [...included]) {
      for (const e of teachersOf.get(id)!) {
        if (e.kind === 'crossLineage') included.add(e.teacherId);
      }
    }
  }

  return subgraphOf(dataset, included, spec.focus);
}

/**
 * The view that contains exactly `included`: every edge between them, and `hiddenCounts`
 * for their teachers and students outside it.
 */
export function subgraphOf(dataset: SyntheticDataset, included: ReadonlySet<string>, focus: string | null): LineageGraph {
  const { graph } = dataset;
  const hiddenTeachers = new Map<string, number>();
  const hiddenStudents = new Map<string, number>();
  for (const e of graph.edges) {
    const t = included.has(e.teacherId);
    const s = included.has(e.studentId);
    if (s && !t) hiddenTeachers.set(e.studentId, (hiddenTeachers.get(e.studentId) ?? 0) + 1);
    if (t && !s) hiddenStudents.set(e.teacherId, (hiddenStudents.get(e.teacherId) ?? 0) + 1);
  }
  const nodes: LineageNode[] = [];
  const hiddenCounts: Record<string, HiddenCount> = {};
  for (const node of graph.nodes) {
    if (!included.has(node.id)) continue;
    const teachers = hiddenTeachers.get(node.id) ?? 0;
    const students = hiddenStudents.get(node.id) ?? 0;
    nodes.push({ ...node, hasMoreChildren: students > 0 });
    if (teachers > 0 || students > 0) hiddenCounts[node.id] = { teachers, students };
  }
  const edges = graph.edges.filter((e) => included.has(e.teacherId) && included.has(e.studentId));
  return { focusId: focus, dataVersion: graph.dataVersion, nodes, edges, hiddenCounts };
}

/** Expanding a node ("+N students", plan §4.8): the view plus all students of `nodeId`. */
export function expandStudents(dataset: SyntheticDataset, view: LineageGraph, nodeId: string): LineageGraph {
  const included = new Set(view.nodes.map((n) => n.id));
  for (const e of dataset.graph.edges) {
    if (e.teacherId === nodeId) included.add(e.studentId);
  }
  return subgraphOf(dataset, included, view.focusId);
}

/** Ego view: all teachers and two rows of students (plan §4.3). */
export function egoView(dataset: SyntheticDataset, focus: string, maxStudentsPerTeacher?: number): LineageGraph {
  return extractView(dataset, { focus, up: 'all', down: 2, maxStudentsPerTeacher });
}

/** Ancestors of a person, the person included. */
export function ancestorsOf(dataset: SyntheticDataset, id: string): string[] {
  return extractView(dataset, { focus: id, up: 'all', down: 0 }).nodes.map((n) => n.id);
}

export interface NamedView {
  name: string;
  graph: LineageGraph;
}

/**
 * The views M03 tests and measures (milestone items 1, 5 and 6):
 * - the ego views of the anchor records (all teachers, two rows of students);
 * - one lineage (`demo-root-a`, three rows, with teachers from other lineages);
 * - the view around `demo-shared-ancestor`: both lineage roots below the common teacher,
 *   their branches and the edge from the other lineage between them;
 * - a view of about 500 people.
 */
export function standardViews(dataset: SyntheticDataset): NamedView[] {
  const id = (slug: AnchorSlug) => anchorId(dataset, slug);
  const twoLineages = id('demo-two-lineages');
  const views: NamedView[] = EGO_ANCHORS.map((slug) => ({ name: `ego:${slug}`, graph: egoView(dataset, id(slug)) }));
  views.push({
    name: 'lineage:demo-root-a',
    graph: extractView(dataset, {
      focus: id('demo-root-a'),
      up: 0,
      down: 3,
      lineageId: 'demo-lineage-a',
      includeForeignTeachers: true,
    }),
  });
  views.push({ name: 'around:demo-shared-ancestor', graph: sharedAncestorView(dataset) });
  views.push({
    name: 'view-500',
    graph: extractView(dataset, {
      focus: id('demo-shared-ancestor'),
      up: 0,
      down: 20,
      maxNodes: 500,
      includeForeignTeachers: true,
      pin: [...ancestorsOf(dataset, twoLineages), twoLineages],
    }),
  });
  return views;
}

/**
 * The view around `demo-shared-ancestor`: five rows below it, six students per teacher,
 * with the branches of `demo-two-lineages` always included, so that both lineage roots,
 * their common teacher and the edge from the other lineage between the branches are in it.
 */
export function sharedAncestorView(dataset: SyntheticDataset): LineageGraph {
  const twoLineages = anchorId(dataset, 'demo-two-lineages');
  return extractView(dataset, {
    focus: anchorId(dataset, 'demo-shared-ancestor'),
    up: 'all',
    down: 6,
    maxStudentsPerTeacher: 6,
    pin: [...ancestorsOf(dataset, twoLineages), twoLineages],
  });
}
