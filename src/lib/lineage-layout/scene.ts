import type { ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { ElkGraphBuild } from './elk-graph.ts';
import { ElkLayoutError } from './errors.ts';
import { NODE_SIZES } from './presets.ts';
import type {
  BezierPath,
  Box,
  DetailLevel,
  LineageGraph,
  OrthogonalPath,
  Point,
  RankResult,
  Scene,
  SceneEdge,
  SceneNode,
} from './types.ts';

const DETAIL_LEVELS: readonly DetailLevel[] = ['full', 'compact', 'dot'];

/** Minimum horizontal reach of a Bézier control point, in px. */
const BEZIER_MIN_REACH = 48;

/** The least gap between two cards of a row (`elk.spacing.nodeNode`), in px. */
const CARD_GAP = 24;

/**
 * Horizontal reach of the control points of a curve that drops into the gap between two rows:
 * half the gap between two cards, so the curve turns into the gap beside each of the two people
 * instead of running along their rows.
 */
const RUN_REACH = CARD_GAP / 2;

/** Room kept between a curve's run along the gap between two rows and the cards above and below it, in px. */
const RUN_CLEARANCE = 8;

/** The steepest extra drop at the two ends that the searches in runHeights try, in px. */
const RUN_MAX_EXTRA = 1000;

/** A curve whose run is longer than this has its label near the student: two cards and their gaps. */
export const LABEL_NEAR_STUDENT_RUN = 2 * (NODE_SIZES.full.width + 24);

/** How far before the student's side the label of a long curve sits: half a card and half a gap. */
const LABEL_LEAD = NODE_SIZES.full.width / 2 + 12;

/** How far above the student's centre line a label's centre stays: half a card, half a label and some room. */
const LABEL_CLEAR_OF_STUDENT = NODE_SIZES.full.height / 2 + 17;

/**
 * Rounds to 1/100 px and turns -0 into 0, so that the serialized scene is byte for byte
 * the same on every run and every engine.
 */
export function roundCoord(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

function point(x: number, y: number): Point {
  return { x: roundCoord(x), y: roundCoord(y) };
}

function centredBox(center: Point, level: DetailLevel): Box {
  const { width, height } = NODE_SIZES[level];
  return { x: roundCoord(center.x - width / 2), y: roundCoord(center.y - height / 2), width, height };
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * How far a curve whose run should stay at height `level` swings past it: towards the student in
 * the first half (it drops too far) and back towards the teacher in the second (it climbs back).
 */
function runSwing(y0: number, y1: number, y2: number, y3: number, level: number): number {
  let swing = 0;
  for (let i = 1; i < 64; i++) {
    const t = i / 64;
    swing = Math.max(swing, (cubicAt(y0, y1, y2, y3, t) - level) * (t <= 0.5 ? 1 : -1));
  }
  return swing;
}

/**
 * The room a curve between people side by side has (bezierBetween): the gap above the student's
 * row, and the facing sides of the nearest cards between the two people in the teacher's row and
 * in the student's row (null when no card stands between them there).
 */
export interface RunSpace {
  /** The bottom of the row above the student's, or the teacher's own bottom. */
  top: number;
  /** The top of the student's row. */
  bottom: number;
  /** The x of the side facing the teacher of the nearest card between them in the teacher's row. */
  teacherRow: number | null;
  /** The x of the side facing the student of the nearest card between them in the student's row. */
  studentRow: number | null;
}

/** A curve between people side by side: its four x coordinates and what it must keep clear of. */
interface RunEnds {
  x: readonly [number, number, number, number];
  /** +1 when the student is right of the teacher, -1 when left. */
  side: number;
  teacher: SceneNode;
  student: SceneNode;
  space: RunSpace;
}

/**
 * Whether the curve is below the teacher's row wherever it passes a card of that row, and above
 * the student's row wherever it passes a card of that row (RunSpace). Each row is checked on
 * the half of the curve near it: the far half keeps to the gap (runHeights) or, on an S, to the
 * far side of the middle between the two people's centre lines.
 */
function clearOfNeighbours(ends: RunEnds, y: readonly [number, number, number, number]): boolean {
  const [x0, x1, x2, x3] = ends.x;
  const { side, space } = ends;
  const below = ends.teacher.y + ends.teacher.height + RUN_CLEARANCE;
  const above = ends.student.y - RUN_CLEARANCE;
  for (let i = 1; i < 256; i++) {
    const t = i / 256;
    const x = cubicAt(x0, x1, x2, x3, t);
    const h = cubicAt(y[0], y[1], y[2], y[3], t);
    if (t <= 0.5 && space.teacherRow !== null && (x - space.teacherRow) * side >= 0 && h < below) return false;
    if (t >= 0.5 && space.studentRow !== null && (space.studentRow - x) * side >= 0 && h > above) return false;
  }
  return true;
}

/**
 * The control heights of a curve from the teacher's centre line down to the student's whose run
 * keeps to the gap between `top` and `bottom`: it is at the gap's middle at t = 0.5, and it drops
 * out of the teacher's row before it passes a card of that row and into the student's side after
 * it passes the cards of the student's row. It drops only as steeply as that needs: a steeper
 * drop swings the run across the gap and, between near people, into a loop. When the gap is too
 * low for a long run to drop that steeply, it drops as steeply as the gap allows.
 */
function runHeights(ends: RunEnds): { y1: number; y2: number } {
  const { top, bottom } = ends.space;
  const y0 = ends.teacher.center.y;
  const y3 = ends.student.center.y;
  const level = (top + bottom) / 2;
  const room = (bottom - top) / 2 - RUN_CLEARANCE;
  const d0 = level - y0;
  const d3 = y3 - level;
  // With extra = 0 the curve falls without a swing and is level at t = 0.5; extra steepens both ends.
  const heights = (extra: number) => ({ y1: level + (2 * d0 + d3) / 3 + extra, y2: level - (d0 + 2 * d3) / 3 - extra });
  const fits = (extra: number) => {
    const { y1, y2 } = heights(extra);
    return runSwing(y0, y1, y2, y3, level) <= room;
  };
  const clear = (extra: number) => {
    const { y1, y2 } = heights(extra);
    return clearOfNeighbours(ends, [y0, y1, y2, y3]);
  };
  if (!fits(0) || clear(0)) return heights(0);
  // The steepest drop that keeps to the gap…
  let lo = 0;
  let hi = RUN_MAX_EXTRA;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  if (!clear(lo)) return heights(lo);
  // …and the gentlest one, no steeper than that, that clears the cards of the two rows.
  let gentle = 0;
  let steep = lo;
  for (let i = 0; i < 24; i++) {
    const mid = (gentle + steep) / 2;
    if (clear(mid)) steep = mid;
    else gentle = mid;
  }
  return heights(steep);
}

/**
 * A cubic Bézier curve between the side attachment points of teacher and student
 * (plan §4.6). When the two boxes overlap horizontally the curve leaves and enters on the
 * same side and bulges outwards. Otherwise it leaves the teacher on the side facing the student
 * and enters the student on the side facing the teacher: as an S with level ends when that
 * passes no card of the two rows, else dropping into the gap above the student's row (`space`),
 * keeping to it and dropping into the student's side. So a long curve never runs behind the
 * cards of the two rows: along the rows' centre lines it did, and showed only as short stubs
 * between the cards that read as links between people of one generation. Without `space`, the
 * gap is the one between the two people's boxes and cards stand a card gap away from each of them.
 */
export function bezierBetween(teacher: SceneNode, student: SceneNode, space?: RunSpace): BezierPath {
  const dx = student.center.x - teacher.center.x;
  const dy = student.center.y - teacher.center.y;
  const overlap = Math.abs(dx) < (teacher.width + student.width) / 2;
  let start: Point;
  let end: Point;
  let control1: Point;
  let control2: Point;
  if (overlap) {
    const side = dx >= 0 ? 1 : -1;
    const sx = side > 0 ? teacher.x + teacher.width : teacher.x;
    const ex = side > 0 ? student.x + student.width : student.x;
    const outer = side > 0 ? Math.max(sx, ex) : Math.min(sx, ex);
    const reach = Math.max(BEZIER_MIN_REACH, Math.abs(dy) / 4);
    start = point(sx, teacher.center.y);
    end = point(ex, student.center.y);
    control1 = point(outer + side * reach, teacher.center.y);
    control2 = point(outer + side * reach, student.center.y);
  } else {
    const side = dx > 0 ? 1 : -1;
    const sx = side > 0 ? teacher.x + teacher.width : teacher.x;
    const ex = side > 0 ? student.x : student.x + student.width;
    const run = space ?? {
      top: teacher.y + teacher.height,
      bottom: student.y,
      teacherRow: Math.abs(ex - sx) > 2 * CARD_GAP ? sx + side * CARD_GAP : null,
      studentRow: Math.abs(ex - sx) > 2 * CARD_GAP ? ex - side * CARD_GAP : null,
    };
    start = point(sx, teacher.center.y);
    end = point(ex, student.center.y);
    // The S with level ends, when it passes no card of the two rows.
    const sReach = Math.max(BEZIER_MIN_REACH, Math.abs(ex - sx) / 2);
    const s: RunEnds = { x: [sx, sx + side * sReach, ex - side * sReach, ex], side, teacher, student, space: run };
    if (clearOfNeighbours(s, [teacher.center.y, teacher.center.y, student.center.y, student.center.y])) {
      control1 = point(sx + side * sReach, teacher.center.y);
      control2 = point(ex - side * sReach, student.center.y);
    } else {
      const reach = Math.min(RUN_REACH, Math.abs(ex - sx) / 2);
      const { y1, y2 } = runHeights({ x: [sx, sx + side * reach, ex - side * reach, ex], side, teacher, student, space: run });
      control1 = point(sx + side * reach, y1);
      control2 = point(ex - side * reach, y2);
    }
  }
  const midpoint = point(
    cubicAt(start.x, control1.x, control2.x, end.x, 0.5),
    cubicAt(start.y, control1.y, control2.y, end.y, 0.5),
  );
  return { type: 'bezier', start, control1, control2, end, midpoint };
}

/**
 * The room of a curve from `teacher` to `student` in a scene (RunSpace): the gap above the
 * student's row, which is always lower than the teacher's (ranks), and the nearest cards between
 * the two people in their rows.
 */
function runSpace(teacher: SceneNode, student: SceneNode, nodes: readonly SceneNode[], rowBottom: readonly number[]): RunSpace {
  const side = student.center.x > teacher.center.x ? 1 : -1;
  const sx = side > 0 ? teacher.x + teacher.width : teacher.x;
  const ex = side > 0 ? student.x : student.x + student.width;
  const lo = Math.min(sx, ex);
  const hi = Math.max(sx, ex);
  let teacherRow: number | null = null;
  let studentRow: number | null = null;
  for (const node of nodes) {
    if (node === teacher || node === student || node.x + node.width <= lo || node.x >= hi) continue;
    // The side of the card that faces the teacher, and the side that faces the student.
    const facingTeacher = side > 0 ? node.x : node.x + node.width;
    const facingStudent = side > 0 ? node.x + node.width : node.x;
    if (node.rank === teacher.rank && (teacherRow === null || (facingTeacher - teacherRow) * side < 0)) teacherRow = facingTeacher;
    if (node.rank === student.rank && (studentRow === null || (facingStudent - studentRow) * side > 0)) studentRow = facingStudent;
  }
  const above = rowBottom[student.rank - 1];
  return {
    top: above !== undefined && above <= student.y ? above : teacher.y + teacher.height,
    bottom: student.y,
    teacherRow,
    studentRow,
  };
}

/**
 * Where the "Teacher in {lineage}" label of a curve goes (plan §4.6): its midpoint, or, on a
 * curve whose run is longer than LABEL_NEAR_STUDENT_RUN, on the run half a card before the
 * student, so the label is on screen whenever the student is; the midpoint of such a curve lies
 * far from both people (graph-7). Never past the point where the curve leaves the height of its
 * run to drop into the student's side.
 */
export function bezierLabelPoint(path: BezierPath): Point {
  const run = path.end.x - path.start.x;
  if (Math.abs(run) <= LABEL_NEAR_STUDENT_RUN) return path.midpoint;
  const at = (t: number) => ({
    x: cubicAt(path.start.x, path.control1.x, path.control2.x, path.end.x, t),
    y: cubicAt(path.start.y, path.control1.y, path.control2.y, path.end.y, t),
  });
  // x runs one way along the curve: the first t from the middle that is LABEL_LEAD from the end.
  const target = path.end.x - Math.sign(run) * LABEL_LEAD;
  let lo = 0.5;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if ((at(mid).x - target) * Math.sign(run) < 0) lo = mid;
    else hi = mid;
  }
  // Back along the curve while the label there would reach down into the student's row.
  const drop = Math.sign(path.end.y - path.midpoint.y);
  let t = lo;
  while (t > 0.5 && (path.end.y - at(t).y) * drop < LABEL_CLEAR_OF_STUDENT) t = Math.max(0.5, t - 1 / 256);
  const p = at(t);
  return point(p.x, p.y);
}

/**
 * Turns the ELK result into a scene: node slots with boxes for the three levels of detail,
 * orthogonal paths for the edges ELK routed and Bézier curves for edges to a teacher from
 * another lineage (plan §4.1, §4.6).
 */
export function buildScene(graph: LineageGraph, ranks: RankResult, build: ElkGraphBuild, laidOut: ElkNode): Scene {
  const elkChildren = new Map((laidOut.children ?? []).map((c) => [c.id, c]));
  const spineEdgeIds = new Set(build.spine.map((e) => e.id));
  const spineNodeIds = new Set<string>();
  for (const edge of build.spine) {
    spineNodeIds.add(edge.studentId);
    spineNodeIds.add(edge.teacherId);
  }
  const focusId = build.focusId;
  if (focusId && elkChildren.has(focusId)) spineNodeIds.add(focusId);

  const nodes: SceneNode[] = build.order.map((id) => {
    const child = elkChildren.get(id);
    if (!child) throw new ElkLayoutError(`no position for node ${id}`);
    const x = roundCoord(child.x ?? 0);
    const y = roundCoord(child.y ?? 0);
    const width = child.width ?? NODE_SIZES[build.nodeSize].width;
    const height = child.height ?? NODE_SIZES[build.nodeSize].height;
    const center = point(x + width / 2, y + height / 2);
    const boxes = Object.fromEntries(DETAIL_LEVELS.map((level) => [level, centredBox(center, level)])) as Record<
      DetailLevel,
      Box
    >;
    return {
      id,
      rank: ranks.ranks.get(id)!,
      cutOff: ranks.cutOff.has(id),
      onSpine: spineNodeIds.has(id),
      x,
      y,
      width,
      height,
      center,
      boxes,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const elkEdgeResults = new Map((laidOut.edges ?? []).map((e) => [e.id, e]));
  const edges: SceneEdge[] = [];
  for (const edge of build.elkEdges) {
    const routed = elkEdgeResults.get(edge.id);
    const sections = routed && 'sections' in routed ? (routed.sections ?? []) : [];
    if (sections.length === 0) throw new ElkLayoutError(`no route for edge ${edge.id}`);
    const points: Point[] = [];
    for (const section of sections) {
      for (const p of [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]) {
        const next = point(p.x, p.y);
        const last = points[points.length - 1];
        if (!last || last.x !== next.x || last.y !== next.y) points.push(next);
      }
    }
    const path: OrthogonalPath = { type: 'orthogonal', points };
    edges.push({
      id: edge.id,
      teacherId: edge.teacherId,
      studentId: edge.studentId,
      lineageId: edge.lineageId,
      kind: edge.kind,
      routedBy: 'elk',
      onSpine: spineEdgeIds.has(edge.id),
      bends: Math.max(0, points.length - 2),
      path,
    });
  }
  const rowY: number[] = [];
  const rowBottom: number[] = [];
  for (const node of nodes) {
    const current = rowY[node.rank];
    rowY[node.rank] = current === undefined ? node.y : Math.min(current, node.y);
    rowBottom[node.rank] = Math.max(rowBottom[node.rank] ?? Number.NEGATIVE_INFINITY, node.y + node.height);
  }

  for (const edge of build.crossLineageEdges) {
    const teacher = byId.get(edge.teacherId)!;
    const student = byId.get(edge.studentId)!;
    edges.push({
      id: edge.id,
      teacherId: edge.teacherId,
      studentId: edge.studentId,
      lineageId: edge.lineageId,
      kind: edge.kind,
      routedBy: 'scene',
      onSpine: false,
      bends: 0,
      path: bezierBetween(teacher, student, runSpace(teacher, student, nodes, rowBottom)),
    });
  }
  const position = new Map(build.order.map((id, i) => [id, i]));
  edges.sort(
    (a, b) =>
      position.get(a.teacherId)! - position.get(b.teacherId)! ||
      position.get(a.studentId)! - position.get(b.studentId)! ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  // Bounds of everything drawn: ELK's canvas, grown to include the Bézier curves (a cubic
  // curve stays inside the convex hull of its control points, which may bulge left of 0).
  let minX = 0;
  let minY = 0;
  let maxX = laidOut.width ?? 0;
  let maxY = laidOut.height ?? 0;
  for (const edge of edges) {
    if (edge.path.type !== 'bezier') continue;
    for (const p of [edge.path.start, edge.path.control1, edge.path.control2, edge.path.end]) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  return {
    version: 1,
    dataVersion: graph.dataVersion,
    focusId: build.focusId,
    preset: build.preset,
    nodePlacement: build.nodePlacement,
    nodeSize: build.nodeSize,
    width: roundCoord(laidOut.width ?? 0),
    height: roundCoord(laidOut.height ?? 0),
    bounds: { x: roundCoord(minX), y: roundCoord(minY), width: roundCoord(maxX - minX), height: roundCoord(maxY - minY) },
    rowY: Array.from(rowY, (y) => y ?? 0),
    nodes,
    edges,
    spine: build.spine.map((e) => e.id),
  };
}
