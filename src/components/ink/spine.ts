// Geometry of an ink spine: one tapered stroke per link down a column of rows, as in the Ink
// Lineage prototype. Pure, so the server renders the static spine and the client re-inks it.

import { bezierPoint, inkShapes, type Cubic, type InkShape } from '@/design/ink';
import type { VerificationState } from '@/design/tokens';

/** A gentle sway, so the column reads as brushwork and not as a ruler line. */
const SWAY = [22, 26, 17, 24, 19, 27, 18, 23];

export interface SpineSegment {
  index: number;
  shape: InkShape;
  /** Where the link's seal sits (top-left corner of a 13 px seal). */
  seal: { x: number; y: number };
  state: VerificationState;
}

export interface SpineNode {
  index: number;
  x: number;
  y: number;
}

export function spineGeometry(states: VerificationState[], rowHeight: number, offsetY: number) {
  const count = states.length + 1;
  const nodes: SpineNode[] = Array.from({ length: count }, (_, i) => ({
    index: i,
    x: SWAY[i % SWAY.length]!,
    y: i * rowHeight + offsetY,
  }));
  const segments: SpineSegment[] = states.map((state, i) => {
    const a = nodes[i]!;
    const b = nodes[i + 1]!;
    const y0 = a.y + 7;
    const y1 = b.y - 6;
    const pull = (y1 - y0) * 0.55;
    const curve: Cubic = [
      [a.x, y0],
      [a.x, y0 + pull],
      [b.x, y1 - pull],
      [b.x, y1],
    ];
    const mid = bezierPoint(curve, 0.52);
    return {
      index: i,
      state,
      shape: inkShapes(curve, state, { w0: 6.4, w1: 1.6, n: 24 }),
      seal: { x: Math.round((mid[0] - 6.5) * 10) / 10, y: Math.round((mid[1] - 6.5) * 10) / 10 },
    };
  });
  return { nodes, segments, height: count * rowHeight };
}

/**
 * Timing of the ink trace (motion tokens in src/design/tokens.ts): one link per step, each
 * stroke drawn for --duration-ink-draw and its seal pressed SEAL_DELAY later for
 * --duration-slow. The step shrinks for long lines so the whole trace, the last seal included,
 * ends within --duration-ink-total (1 s, ADR 0006).
 */
export const INK_TOTAL = 1000;
export const INK_STEP = 110;
export const INK_DRAW = 220;
export const SEAL_DELAY = 130;
export const SEAL_PRESS = 250;

/** The delay between generations when `links` links are traced. */
export function inkStep(links: number): number {
  if (links <= 1) return INK_STEP;
  return Math.min(INK_STEP, Math.floor((INK_TOTAL - Math.max(INK_DRAW, SEAL_DELAY + SEAL_PRESS)) / (links - 1)));
}

/** When the trace of `links` links ends (ms). */
export function inkTraceEnd(links: number): number {
  if (links <= 0) return 0;
  return (links - 1) * inkStep(links) + Math.max(INK_DRAW, SEAL_DELAY + SEAL_PRESS);
}
