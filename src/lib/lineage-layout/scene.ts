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

/**
 * Horizontal reach of the control points of a curve between people side by side: half the 24 px
 * gap between two cards of a row (`elk.spacing.nodeNode`), so the curve turns into the gap beside
 * each of the two people instead of running along their rows.
 */
const RUN_REACH = 12;

/** Room kept between a curve's run along the gap between two rows and the cards above and below it, in px. */
const RUN_CLEARANCE = 8;

/** The steepest extra drop at the two ends that the search in runHeights tries, in px. */
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
 * The control heights of a curve from `y0` (the teacher's centre line) down to `y3` (the
 * student's) whose run keeps to the gap between `top` and `bottom`: it is at the gap's middle at
 * t = 0.5 and drops out of the teacher's row and into the student's side as steeply as the gap
 * allows without swinging out of it.
 */
function runHeights(y0: number, y3: number, top: number, bottom: number): { y1: number; y2: number } {
  const level = (top + bottom) / 2;
  const room = (bottom - top) / 2 - RUN_CLEARANCE;
  const d0 = level - y0;
  const d3 = y3 - level;
  const heights = (extra: number) => ({ y1: level + (2 * d0 + d3) / 3 + extra, y2: level - (d0 + 2 * d3) / 3 - extra });
  const fits = (extra: number) => {
    const { y1, y2 } = heights(extra);
    return runSwing(y0, y1, y2, y3, level) <= room;
  };
  let lo = 0;
  let hi = RUN_MAX_EXTRA;
  if (!fits(lo)) return heights(lo);
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return heights(lo);
}

/**
 * A cubic Bézier curve between the side attachment points of teacher and student
 * (plan §4.6). When the two boxes overlap horizontally the curve leaves and enters on the
 * same side and bulges outwards. Otherwise it leaves the teacher on the side facing the
 * student, drops into `gap` (the gap above the student's row), keeps to it and drops into the
 * student's side facing the teacher. So a long curve never runs behind the cards of the two
 * rows: along the rows' centre lines it did, and showed only as short stubs between the cards
 * that read as links between people of one generation.
 */
export function bezierBetween(teacher: SceneNode, student: SceneNode, gap?: { top: number; bottom: number }): BezierPath {
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
    const reach = Math.min(RUN_REACH, Math.abs(ex - sx) / 2);
    const { y1, y2 } = runHeights(teacher.center.y, student.center.y, gap?.top ?? teacher.y + teacher.height, gap?.bottom ?? student.y);
    start = point(sx, teacher.center.y);
    end = point(ex, student.center.y);
    control1 = point(sx + side * reach, y1);
    control2 = point(ex - side * reach, y2);
  }
  const midpoint = point(
    cubicAt(start.x, control1.x, control2.x, end.x, 0.5),
    cubicAt(start.y, control1.y, control2.y, end.y, 0.5),
  );
  return { type: 'bezier', start, control1, control2, end, midpoint };
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
    // The gap above the student's row: the student is always in a lower row than the teacher.
    const above = rowBottom[student.rank - 1];
    const gap = { top: above !== undefined && above <= student.y ? above : teacher.y + teacher.height, bottom: student.y };
    edges.push({
      id: edge.id,
      teacherId: edge.teacherId,
      studentId: edge.studentId,
      lineageId: edge.lineageId,
      kind: edge.kind,
      routedBy: 'scene',
      onSpine: false,
      bends: 0,
      path: bezierBetween(teacher, student, gap),
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
