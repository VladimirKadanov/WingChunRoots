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
