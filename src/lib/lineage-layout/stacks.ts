/**
 * Stacked students (ADR 0017): in the Lineage view a teacher's students who have no students of
 * their own in the view stand in a block of two columns under the teacher instead of all in one
 * row. A generation of 60 to 90 people in one row is 13 000 to 20 000 px wide whatever the order
 * (ADR 0017 measures it), so a large Lineage view was a strip that "Fit" could only show as dots.
 *
 * Only with `LayoutOptions.stackLeaves` (the explorer's Lineage view); every other view keeps one
 * row per generation, as plan §4.4 lays them out.
 *
 * A teacher's students are stacked when at least STACK_MIN of them are leaves: each with no
 * outgoing edge in the view, one incoming edge (from this teacher, not from another lineage), one
 * row below the teacher and in the teacher's lineage column, and neither the focus nor on its
 * spine. For the layout they become one node of the block's width and of a card's height, with one
 * edge from the teacher (`planStacks`), so ranks, model order, the lineage columns, the converging
 * pass and ELK treat the block like any card. The scene then puts the students in the block
 * (`stackedPlaces`) and turns the block's route into one route per student (`stackedRoute`):
 *
 * - the first tier stands on the row's line, like every other card of the row, so the row still
 *   starts at one height (`Scene.rowY`); the next tiers hang below it, TIER_GAP apart, and the next
 *   row starts below the deepest block of the row (the row's band);
 * - the route comes down the block's middle (a lane in the gap between the two columns) and turns
 *   into the middle of each student's top side in the gap above the student's tier, so every link
 *   still enters its card at the middle of the top (ADR 0010 b5, b6), and the routes of one teacher
 *   share one trunk;
 * - above a row with a block the scene keeps FEED_SPACE free, below every track ELK routed, so the
 *   turns to the first tier have a level of their own that no other teacher's run uses.
 *
 * Pure TypeScript and deterministic, like the rest of the module.
 */
import { displayPrimaryTeacherEdge, modelOrder, type GraphIndex } from './graph.ts';
import type { LineageEdge, LineageGraph, LineageNode, Point, RankResult, Size } from './types.ts';

/** The fewest leaf students of one teacher that are stacked: two stand in a row as wide as a block. */
export const STACK_MIN = 3;

/** Columns of a block: one lane in the middle reaches both, and a block is as wide as two cards of a row. */
export const STACK_COLUMNS = 2;

/** The gap between two tiers of a block, in px: the turn to a student runs along its middle, 12 px from each card. */
export const TIER_GAP = 24;

/** Room kept free above a row with a block, below ELK's tracks, in px: the turns to its first tier run along its middle. */
export const FEED_SPACE = 24;

/** The prefix of a block's node id (followed by the teacher's id). */
export const STACK_PREFIX = 'stack:';

/** A block of stacked students. */
export interface Stack {
  /** The block's node id in the laid-out graph. */
  id: string;
  /** The id of the block's edge from the teacher in the laid-out graph. */
  edgeId: string;
  teacherId: string;
  /** The students, in model order: row by row, left column first. */
  students: string[];
  /** The edge from the teacher of each student, in the order of `students`. */
  edges: LineageEdge[];
  tiers: number;
  /** The block's slot: two columns of cards a card gap apart, and its tiers TIER_GAP apart. */
  width: number;
  height: number;
}

export interface StackPlan {
  /** The graph laid out: every block's students replaced by the block and its edge. */
  graph: LineageGraph;
  /** The blocks by node id. */
  stacks: Map<string, Stack>;
  /** The size of every block's node for ELK: the block's width and a card's height. */
  sizes: Map<string, Size>;
}

/**
 * The blocks of a view and the graph laid out with them, or null when no teacher has STACK_MIN
 * leaf students. `bandOf` gives every person's lineage column (lineageBands), `ranks` the rows of
 * the view, `card` the size of a card and `gap` the gap between two cards of a row.
 */
export function planStacks(
  index: GraphIndex,
  ranks: RankResult,
  bandOf: ReadonlyMap<string, string>,
  focusId: string | null,
  spine: ReadonlySet<string>,
  card: Size,
  gap: number,
): StackPlan | null {
  const { graph } = index;
  const leavesOf = new Map<string, LineageEdge[]>();
  for (const node of graph.nodes) {
    const id = node.id;
    if (id === focusId || spine.has(id)) continue;
    if (index.studentEdges.get(id)!.length > 0) continue;
    const incoming = index.teacherEdges.get(id)!;
    if (incoming.length !== 1) continue;
    const edge = incoming[0]!;
    if (edge.kind === 'crossLineage') continue;
    if (ranks.ranks.get(id) !== ranks.ranks.get(edge.teacherId)! + 1) continue;
    if (bandOf.get(id) !== bandOf.get(edge.teacherId)) continue;
    const list = leavesOf.get(edge.teacherId);
    if (list) list.push(edge);
    else leavesOf.set(edge.teacherId, [edge]);
  }
  const position = new Map(modelOrder(index).map((id, i) => [id, i]));
  const stacks = new Map<string, Stack>();
  const sizes = new Map<string, Size>();
  const stacked = new Set<string>();
  const teachers = [...leavesOf.keys()].sort((a, b) => position.get(a)! - position.get(b)!);
  for (const teacherId of teachers) {
    const edges = leavesOf.get(teacherId)!;
    const id = `${STACK_PREFIX}${teacherId}`;
    if (edges.length < STACK_MIN || index.nodes.has(id)) continue;
    edges.sort((a, b) => position.get(a.studentId)! - position.get(b.studentId)!);
    const tiers = Math.ceil(edges.length / STACK_COLUMNS);
    const width = STACK_COLUMNS * card.width + (STACK_COLUMNS - 1) * gap;
    const stack: Stack = {
      id,
      edgeId: `${id}:edge`,
      teacherId,
      students: edges.map((e) => e.studentId),
      edges,
      tiers,
      width,
      height: tiers * card.height + (tiers - 1) * TIER_GAP,
    };
    stacks.set(id, stack);
    sizes.set(id, { width, height: card.height });
    for (const e of edges) stacked.add(e.studentId);
  }
  if (stacks.size === 0) return null;

  // The block takes the place of its first student in the model order: same lineage, start year and name.
  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];
  for (const node of graph.nodes) if (!stacked.has(node.id)) nodes.push(node);
  for (const edge of graph.edges) if (!stacked.has(edge.studentId)) edges.push(edge);
  for (const stack of stacks.values()) {
    const first = index.nodes.get(stack.students[0]!)!;
    const firstEdge = displayPrimaryTeacherEdge(index, first.id) ?? stack.edges[0]!;
    nodes.push({
      id: stack.id,
      displayName: first.displayName,
      altNames: [],
      lifeStatus: 'unknown',
      claimState: 'unclaimed',
      lineageIds: [firstEdge.lineageId],
      childCount: 0,
      hasMoreChildren: false,
    });
    edges.push({ ...firstEdge, id: stack.edgeId, studentId: stack.id, kind: 'primary', isDisplayPrimary: true });
  }
  return { graph: { ...graph, nodes, edges }, stacks, sizes };
}

/** The top-left corner of every student's slot in a block whose slot starts at `at`. */
export function stackedPlaces(stack: Stack, at: Point, card: Size, gap: number): Point[] {
  return stack.students.map((_, i) => ({
    x: at.x + (i % STACK_COLUMNS) * (card.width + gap),
    y: at.y + Math.floor(i / STACK_COLUMNS) * (card.height + TIER_GAP),
  }));
}

/** Points without repeats and without points in the middle of a straight run. */
export function simplifyRoute(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const before = out[out.length - 2];
    if (last && before && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * The route to a student of a block: the block's route without its end (the middle of the block's
 * top), down the block's lane to the gap above the student's tier (above the first tier: the level
 * FEED_SPACE / 2 above the block), across to the middle of the student's slot and down into it.
 * `slot` is the student's slot; `top` the top of the block.
 */
export function stackedRoute(blockRoute: readonly Point[], top: number, slot: Point, card: Size): Point[] {
  const end = blockRoute[blockRoute.length - 1]!;
  const lane = end.x;
  const turn = slot.y === top ? top - FEED_SPACE / 2 : slot.y - TIER_GAP / 2;
  const centre = slot.x + card.width / 2;
  return simplifyRoute([...blockRoute.slice(0, -1), { x: lane, y: turn }, { x: centre, y: turn }, { x: centre, y: slot.y }]);
}
