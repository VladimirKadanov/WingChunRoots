// Ink along a route: the explorer's canvas (owner decision 2026-10-31, "Ink restyle"). The layout
// gives each link an orthogonal route (or a Bézier curve between lineages); the canvas rounds its
// corners and draws the state's ink along it, as the home page draws its curves (ink.ts). A module
// of its own, so that it comes with the explorer's lazy canvas and not with the first JavaScript
// of the pages that draw from ink.ts.

import { bezierPoint, brushWidth, r1, tangent, type Cubic, type InkShape, type Point } from './ink';
import type { VerificationState } from './tokens';

/** A drawn route: from `start`, straight runs and cubic curves. */
export interface Route {
  start: Point;
  pieces: readonly RoutePiece[];
}
export type RoutePiece = { kind: 'line'; to: Point } | { kind: 'cubic'; c1: Point; c2: Point; to: Point };

const same = (a: Point, b: Point) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
const distance = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const toward = (from: Point, to: Point, d: number): Point => {
  const l = distance(from, to);
  return [from[0] + ((to[0] - from[0]) * d) / l, from[1] + ((to[1] - from[1]) * d) / l];
};

/**
 * A polyline with its corners rounded. Each corner becomes a quadratic curve (written as a cubic)
 * whose control point is the corner: it leaves along one run and joins the next, `radius` from the
 * corner, or less where a run is short (half of a run between two corners, all of a run at an end).
 * Repeated points and points on a straight run are dropped first.
 */
export function roundedRoute(points: readonly Point[], radius: number): Route {
  const p: Point[] = [];
  for (const q of points) {
    const last = p[p.length - 1];
    if (last && same(last, q)) continue;
    const before = p[p.length - 2];
    if (last && before) {
      const cross = (last[0] - before[0]) * (q[1] - last[1]) - (last[1] - before[1]) * (q[0] - last[0]);
      const dot = (last[0] - before[0]) * (q[0] - last[0]) + (last[1] - before[1]) * (q[1] - last[1]);
      if (Math.abs(cross) < 1e-6 && dot > 0) {
        p[p.length - 1] = q;
        continue;
      }
    }
    p.push(q);
  }
  const pieces: RoutePiece[] = [];
  for (let i = 1; i < p.length - 1; i++) {
    const [a, b, c] = [p[i - 1]!, p[i]!, p[i + 1]!];
    const r = Math.min(radius, distance(a, b) * (i === 1 ? 1 : 0.5), distance(b, c) * (i === p.length - 2 ? 1 : 0.5));
    if (r < 0.5) {
      pieces.push({ kind: 'line', to: b });
      continue;
    }
    const enter = toward(b, a, r);
    const leave = toward(b, c, r);
    pieces.push({ kind: 'line', to: enter });
    pieces.push({
      kind: 'cubic',
      c1: [enter[0] + ((b[0] - enter[0]) * 2) / 3, enter[1] + ((b[1] - enter[1]) * 2) / 3],
      c2: [leave[0] + ((b[0] - leave[0]) * 2) / 3, leave[1] + ((b[1] - leave[1]) * 2) / 3],
      to: leave,
    });
  }
  if (p.length >= 2) pieces.push({ kind: 'line', to: p[p.length - 1]! });
  return { start: p[0] ?? [0, 0], pieces };
}

/** The route as an SVG path (M, L and C). */
export function routeD(route: Route): string {
  const q = (pt: Point) => `${r1(pt[0])},${r1(pt[1])}`;
  return `M${q(route.start)}${route.pieces.map((piece) => (piece.kind === 'line' ? `L${q(piece.to)}` : `C${q(piece.c1)} ${q(piece.c2)} ${q(piece.to)}`)).join('')}`;
}

/** A point along a route, with its unit normal and its distance from the start along the route. */
export interface RouteSample {
  x: number;
  y: number;
  nx: number;
  ny: number;
  len: number;
}

/** Points along a route: at most `step` apart on a straight run, closer on a curve. */
export function sampleRoute(route: Route, step = 16): RouteSample[] {
  const out: RouteSample[] = [];
  let at: Point = route.start;
  let len = 0;
  const push = (pt: Point, dx: number, dy: number) => {
    const m = Math.hypot(dx, dy);
    const prev = out[out.length - 1];
    const [nx, ny] = m > 1e-9 ? [-dy / m, dx / m] : prev ? [prev.nx, prev.ny] : [0, 0];
    if (prev) len += Math.hypot(pt[0] - prev.x, pt[1] - prev.y);
    out.push({ x: pt[0], y: pt[1], nx, ny, len });
  };
  for (const piece of route.pieces) {
    if (piece.kind === 'line') {
      const l = distance(at, piece.to);
      if (l < 1e-6) continue;
      const [dx, dy] = [piece.to[0] - at[0], piece.to[1] - at[1]];
      if (out.length === 0) push(at, dx, dy);
      const n = Math.max(1, Math.ceil(l / step));
      for (let k = 1; k <= n; k++) push([at[0] + (dx * k) / n, at[1] + (dy * k) / n], dx, dy);
    } else {
      const cubic: Cubic = [at, piece.c1, piece.c2, piece.to];
      let chord = 0;
      for (let k = 1; k <= 8; k++) chord += distance(bezierPoint(cubic, (k - 1) / 8), bezierPoint(cubic, k / 8));
      if (chord < 1e-6) continue;
      const n = Math.min(48, Math.max(4, Math.ceil(chord / (step / 2))));
      if (out.length === 0) {
        const d = tangent(cubic, 0);
        push(at, d[0], d[1]);
      }
      for (let k = 1; k <= n; k++) {
        const d = tangent(cubic, k / n);
        push(bezierPoint(cubic, k / n), d[0], d[1]);
      }
    }
    at = piece.to;
  }
  return out;
}

export interface RouteInkOptions {
  /** Width at the teacher's end. */
  w0: number;
  /** Width the stroke tapers to. */
  w1: number;
  /**
   * The width falls with the distance from the teacher, by e every `reach` units: links that share
   * their teacher's trunk have the same width along it. Without it, the width tapers over the
   * whole route (brushWidth), as on the home page.
   */
  reach?: number;
  /** A teacher of another lineage: a hollow ribbon with this dash (null: solid). */
  crossLineage?: { dash: string | null };
  /** Half the distance between the two lines of the state in arbitration. */
  doubleOffset?: number;
  /**
   * The length of the dashes under review and of the step between dots, as a multiple of the
   * full cards' (1): the compact cards are drawn at a smaller zoom, so their pattern is longer.
   */
  pattern?: number;
}

/** The brush touches down: half its width at the teacher's end, all of it this far along. */
const PRESS = 10;

function widthAlong(o: RouteInkOptions, total: number, w0: number, w1: number): (p: RouteSample) => number {
  if (o.reach === undefined) return (p) => brushWidth(total > 0 ? p.len / total : 0, w0, w1);
  const reach = o.reach;
  return (p) => (w1 + (w0 - w1) * Math.exp(-p.len / reach)) * (0.5 + 0.5 * Math.min(1, p.len / PRESS));
}

/** The point at a distance along the samples, between the two around it. */
function sampleAt(s: readonly RouteSample[], len: number, from = 0): { sample: RouteSample; index: number } {
  let i = Math.max(1, from);
  while (i < s.length - 1 && s[i]!.len < len) i++;
  const a = s[i - 1]!;
  const b = s[i]!;
  const t = b.len > a.len ? Math.min(1, Math.max(0, (len - a.len) / (b.len - a.len))) : 0;
  return { sample: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx: t < 1 ? a.nx : b.nx, ny: t < 1 ? a.ny : b.ny, len }, index: i };
}

function ribbonOf(points: readonly RouteSample[], width: (p: RouteSample) => number): string {
  const left: string[] = [];
  const right: string[] = [];
  for (const p of points) {
    const w = width(p) / 2;
    left.push(`${r1(p.x + p.nx * w)},${r1(p.y + p.ny * w)}`);
    right.push(`${r1(p.x - p.nx * w)},${r1(p.y - p.ny * w)}`);
  }
  return `M${left.join('L')}L${right.reverse().join('L')}Z`;
}

/** The samples from one distance to another, both ends where they fall between two samples. */
function stretch(s: readonly RouteSample[], a: number, b: number, from: number): { points: RouteSample[]; next: number } {
  const start = sampleAt(s, a, from);
  const end = sampleAt(s, b, start.index);
  const inner = s.slice(start.index, end.index).filter((p) => p.len > a && p.len < b);
  return { points: [start.sample, ...inner, end.sample], next: start.index };
}

/**
 * The shapes of one link along its route, in the states of inkShapes: a solid tapered stroke when
 * verified, a broken one under review, dots when unconfirmed, two thin lines in arbitration, and a
 * hollow ribbon for a teacher of another lineage.
 */
export function inkAlong(route: Route, state: VerificationState, options: RouteInkOptions): InkShape {
  const s = sampleRoute(route);
  if (s.length < 2) return { kind: 'fill', d: '' };
  const total = s[s.length - 1]!.len;
  if (options.crossLineage) {
    return { kind: 'hollow', d: ribbonOf(s, widthAlong(options, total, options.w0 * 1.7, options.w1 * 2)), dash: options.crossLineage.dash };
  }
  const width = widthAlong(options, total, options.w0, options.w1);
  switch (state) {
    case 'verified':
      return { kind: 'fill', d: ribbonOf(s, width) };
    case 'under_review': {
      const k = options.pattern ?? 1;
      let d = '';
      let from = 0;
      for (let at = 0; at < total; at += (11 + 6) * k) {
        const part = stretch(s, at, Math.min(total, at + 11 * k), from);
        from = part.next;
        if (part.points.length >= 2) d += ribbonOf(part.points, width);
      }
      return { kind: 'fill', d };
    }
    case 'unconfirmed': {
      // The step grows with the dot, so dots never touch where the stroke is wide (by the teacher):
      // a dotted link always reads as dots, never as a solid stroke (status never by colour alone).
      const step = 6.5 * (options.pattern ?? 1);
      const circles: { cx: number; cy: number; r: number }[] = [];
      let from = 0;
      for (let at = 2; at < total - 1; ) {
        const { sample, index } = sampleAt(s, at, from);
        from = index;
        const r = Math.max(1, width(sample) * 0.46);
        circles.push({ cx: r1(sample.x), cy: r1(sample.y), r: r1(r) });
        at += Math.max(step, 3.2 * r);
      }
      return { kind: 'dots', circles };
    }
    case 'arbitration': {
      const o = options.doubleOffset ?? 2.6;
      const line = (k: number) => `M${s.map((p) => `${r1(p.x + p.nx * k)},${r1(p.y + p.ny * k)}`).join('L')}`;
      return { kind: 'double', d: [line(o), line(-o)] };
    }
  }
}

