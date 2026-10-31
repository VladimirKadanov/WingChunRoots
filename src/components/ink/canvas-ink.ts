// The explorer's ink along its routes (owner decision 2026-10-31, "Ink restyle"; ADR 0009 item 11),
// in a module of its own so that it comes with the lazy canvas, not with the page's first
// JavaScript (the legend draws its samples from link-stroke.tsx).

import { type InkShape } from '@/design/ink';
import { inkAlong, type Route } from '@/design/ink-route';
import { linkStyles } from '@/design/tokens';
import type { LinkKind } from './link-stroke';

/**
 * The explorer's ink at the two levels of detail that draw it (plan §4.8): the compact chips are
 * drawn at a smaller zoom, so their ink is wider and its dashes and dots longer apart. The width
 * falls with the distance from the teacher (`reach`), so the links of one teacher share their
 * trunk at one width (b5).
 */
export const CANVAS_INK = {
  full: { w0: 5.6, w1: 1.4, reach: 90, doubleOffset: 2.6 },
  compact: { w0: 9, w1: 2.8, reach: 90, doubleOffset: 4.5, pattern: 1.6 },
} as const;

/**
 * A link of the explorer in ink along its route: the state's shape (inkAlong), a thin ribbon for
 * ended training, and for a teacher of another lineage a hollow ribbon with the long dash of the
 * cross-lineage stroke (plan §4.6: long-dashed), tapering over its whole length.
 */
export function canvasInk(kind: LinkKind, route: Route, lod: keyof typeof CANVAS_INK): InkShape {
  const o = CANVAS_INK[lod];
  if (kind === 'cross_lineage') return inkAlong(route, 'verified', { w0: o.w0, w1: o.w1, crossLineage: { dash: linkStyles.cross_lineage.dash } });
  if (kind === 'historical') return inkAlong(route, 'verified', { w0: o.w0 * 0.36, w1: o.w1 * 0.7, reach: o.reach });
  return inkAlong(route, kind, o);
}
