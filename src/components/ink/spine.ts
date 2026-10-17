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
