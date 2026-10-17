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
 * A cubic Bézier curve between the side attachment points of teacher and student
 * (plan §4.6). When the two boxes overlap horizontally the curve leaves and enters on the
 * same side and bulges outwards; otherwise it leaves the teacher on the side facing the
 * student and enters the student on the side facing the teacher.
 */
export function bezierBetween(teacher: SceneNode, student: SceneNode): BezierPath {
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
    const reach = Math.max(BEZIER_MIN_REACH, Math.abs(ex - sx) / 2);
    start = point(sx, teacher.center.y);
    end = point(ex, student.center.y);
    control1 = point(sx + side * reach, teacher.center.y);
    control2 = point(ex - side * reach, student.center.y);
  }
  const midpoint = point(
    cubicAt(start.x, control1.x, control2.x, end.x, 0.5),
    cubicAt(start.y, control1.y, control2.y, end.y, 0.5),
  );
  return { type: 'bezier', start, control1, control2, end, midpoint };
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
  for (const edge of build.crossLineageEdges) {
    edges.push({
      id: edge.id,
      teacherId: edge.teacherId,
      studentId: edge.studentId,
      lineageId: edge.lineageId,
      kind: edge.kind,
      routedBy: 'scene',
      onSpine: false,
      bends: 0,
      path: bezierBetween(byId.get(edge.teacherId)!, byId.get(edge.studentId)!),
    });
  }
  const position = new Map(build.order.map((id, i) => [id, i]));
  edges.sort(
    (a, b) =>
      position.get(a.teacherId)! - position.get(b.teacherId)! ||
      position.get(a.studentId)! - position.get(b.studentId)! ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const rowY: number[] = [];
  for (const node of nodes) {
    const current = rowY[node.rank];
    rowY[node.rank] = current === undefined ? node.y : Math.min(current, node.y);
  }

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
