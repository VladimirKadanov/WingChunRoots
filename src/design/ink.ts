// Ink geometry of the "Ink Register" direction: a tapered brush stroke along a cubic Bézier,
// drawn differently for each verification state (plan §4.6: never colour alone). Pure
// TypeScript, ported from the Ink Lineage prototype (docs/design/prototypes/ink-lineage.html),
// so server components render the strokes as static SVG and the explorer (M05) can reuse it.

import type { VerificationState } from './tokens';

export type Point = readonly [number, number];
/** Cubic Bézier control points: start, two handles, end. */
export type Cubic = readonly [Point, Point, Point, Point];

export type InkShape =
  | { kind: 'fill'; d: string }
  | { kind: 'dots'; circles: { cx: number; cy: number; r: number }[] }
  | { kind: 'double'; d: [string, string] }
  | { kind: 'hollow'; d: string; dash: string | null };

interface Sample {
  t: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
  len: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function bezierPoint(p: Cubic, t: number): [number, number] {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]];
}

function tangent(p: Cubic, t: number): [number, number] {
  const u = 1 - t;
  return [
    3 * u * u * (p[1][0] - p[0][0]) + 6 * u * t * (p[2][0] - p[1][0]) + 3 * t * t * (p[3][0] - p[2][0]),
    3 * u * u * (p[1][1] - p[0][1]) + 6 * u * t * (p[2][1] - p[1][1]) + 3 * t * t * (p[3][1] - p[2][1]),
  ];
}

function sample(p: Cubic, n: number): Sample[] {
  const out: Sample[] = [];
  let len = 0;
  let prev: [number, number] | null = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const pt = bezierPoint(p, t);
    const d = tangent(p, t);
    const m = Math.hypot(d[0], d[1]) || 1;
    if (prev) len += Math.hypot(pt[0] - prev[0], pt[1] - prev[1]);
    out.push({ t, x: pt[0], y: pt[1], nx: -d[1] / m, ny: d[0] / m, len });
    prev = pt;
  }
  return out;
}

/** Brush width along the stroke: full pressure after the first 7%, tapering to `w1`. */
export function brushWidth(t: number, w0: number, w1: number): number {
  const press = 0.5 + 0.5 * Math.min(1, t / 0.07);
  return (w1 + (w0 - w1) * Math.pow(1 - t, 1.25)) * press;
}

function ribbon(s: Sample[], i0: number, i1: number, w0: number, w1: number): string {
  const left: string[] = [];
  const right: string[] = [];
  for (let i = i0; i <= i1; i++) {
    const p = s[i]!;
    const w = brushWidth(p.t, w0, w1) / 2;
    left.push(`${r1(p.x + p.nx * w)},${r1(p.y + p.ny * w)}`);
    right.push(`${r1(p.x - p.nx * w)},${r1(p.y - p.ny * w)}`);
  }
  return `M${left.join('L')}L${right.reverse().join('L')}Z`;
}

function indexAt(s: Sample[], len: number): number {
  let i = 0;
  while (i < s.length - 1 && s[i]!.len < len) i++;
  return i;
}

function dashedRibbon(s: Sample[], w0: number, w1: number, dash: number, gap: number): string {
  const total = s[s.length - 1]!.len;
  let d = '';
  for (let at = 0; at < total; at += dash + gap) {
    const a = indexAt(s, at);
    const b = indexAt(s, Math.min(total, at + dash));
    if (b > a) d += ribbon(s, a, b, w0, w1);
  }
  return d;
}

function dotsAlong(s: Sample[], w0: number, w1: number, step: number) {
  const total = s[s.length - 1]!.len;
  const circles: { cx: number; cy: number; r: number }[] = [];
  for (let at = 2; at < total - 1; at += step) {
    const p = s[indexAt(s, at)]!;
    circles.push({ cx: r1(p.x), cy: r1(p.y), r: r1(Math.max(1, brushWidth(p.t, w0, w1) * 0.46)) });
  }
  return circles;
}

function offset(s: Sample[], o: number): string {
  return `M${s.map((p) => `${r1(p.x + p.nx * o)},${r1(p.y + p.ny * o)}`).join('L')}`;
}

export interface InkOptions {
  /** Width at the start of the stroke (the teacher's end). */
  w0?: number;
  /** Width at the end (the student's end). */
  w1?: number;
  /** Samples along the curve. */
  n?: number;
  /** A link to a teacher of another lineage: a hollow ribbon with the state's dash. */
  crossLineage?: boolean;
}

/**
 * The shapes of one link. Verified: a solid tapered stroke. Under review: a broken stroke.
 * Unconfirmed: dots. In arbitration: two thin parallel lines. Cross-lineage: hollow.
 */
export function inkShapes(p: Cubic, state: VerificationState, options: InkOptions = {}): InkShape {
  const w0 = options.w0 ?? 5.6;
  const w1 = options.w1 ?? 1.4;
  const s = sample(p, options.n ?? 40);
  if (options.crossLineage) {
    const dash = { verified: null, under_review: '7 4', unconfirmed: '1.6 3.4', arbitration: '9 3 2 3' }[state];
    return { kind: 'hollow', d: ribbon(s, 0, s.length - 1, w0 * 1.7, w1 * 2), dash };
  }
  switch (state) {
    case 'verified':
      return { kind: 'fill', d: ribbon(s, 0, s.length - 1, w0, w1) };
    case 'under_review':
      return { kind: 'fill', d: dashedRibbon(s, w0, w1, 11, 6) };
    case 'unconfirmed':
      return { kind: 'dots', circles: dotsAlong(s, w0, w1, 6.5) };
    case 'arbitration':
      return { kind: 'double', d: [offset(s, 2.6), offset(s, -2.6)] };
  }
}

// Ink along a route: the explorer's canvas (owner decision 2026-10-31, "Ink restyle"). The layout
// gives each link an orthogonal route (or a Bézier curve between lineages); the canvas rounds its
// corners and draws the state's ink along it, as the home page draws its curves. The functions
// above stay as they are: the home page and the lineage pages draw from them.

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
      let d = '';
      let from = 0;
      for (let at = 0; at < total; at += 11 + 6) {
        const part = stretch(s, at, Math.min(total, at + 11), from);
        from = part.next;
        if (part.points.length >= 2) d += ribbonOf(part.points, width);
      }
      return { kind: 'fill', d };
    }
    case 'unconfirmed': {
      const circles: { cx: number; cy: number; r: number }[] = [];
      let from = 0;
      for (let at = 2; at < total - 1; at += 6.5) {
        const { sample, index } = sampleAt(s, at, from);
        from = index;
        circles.push({ cx: r1(sample.x), cy: r1(sample.y), r: r1(Math.max(1, width(sample) * 0.46)) });
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

/** Dots as one path of circles (two arcs each): one element for a whole dotted link. */
export function dotsD(circles: readonly { cx: number; cy: number; r: number }[]): string {
  return circles.map((c) => `M${r1(c.cx - c.r)},${c.cy}a${c.r},${c.r} 0 1,0 ${r1(2 * c.r)},0a${c.r},${c.r} 0 1,0 ${r1(-2 * c.r)},0`).join('');
}
