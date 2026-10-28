// Where the buttons over the canvas lie (milestone M06 In scope 5, package D): the "Zoom" group of
// M05 and the "Canvas tools" group ("Center on selection", and "Keyboard shortcuts" with a fine
// pointer), at the canvas frame's bottom right. Pure: no React, no DOM.
//
// A phone's canvas is short: the explorer's bars take its top, and a selection's panel or bottom
// sheet takes its bottom (at the peek the canvas of a 393x659 iPhone is about 200 to 220 px tall,
// at half height about 50 px). The groups stand in a column, the "Canvas tools" above "Zoom"
// (M05's place), when the column fits the frame. Else, on a phone, their buttons are laid out in
// rows: first each group in a row of its own, one above the other (a stack: as narrow as the
// "Zoom" group, so the people left of it keep the room above the legend), then both groups side by
// side in one row. Else, in a sliver of canvas above a raised sheet, they are not shown (their keys
// +, −, 0 and ? still work, and lowering the sheet brings them back). DEFAULT, no D number (plan
// In scope 5: "if the controls do not fit inside the canvas there, lays the overlays out as a row").
//
// What else lies along the frame's bottom edge (the legend, React Flow's attribution with its
// 44 px hit area on a phone) stays clear: the buttons stand CONTROLS_GAP above whatever of it lies
// under them, so none of them is ever covered and none covers it. The first view and the moves of
// the view keep people clear of the buttons wherever they are (data-canvas-overlay, canvas.tsx).

import type { Box } from '@/lib/lineage-layout/types';

export interface Size {
  width: number;
  height: number;
}

/** A group of buttons, a strip of square buttons: its length along the strip and its thickness across it. */
export interface Strip {
  long: number;
  short: number;
}

/**
 * How the groups lie: one above the other with their buttons in a column (column) or each in a row
 * (stack), side by side in one row (row), or not shown (none: no room).
 */
export type ControlsKind = 'column' | 'stack' | 'row' | 'none';
type Shown = Exclude<ControlsKind, 'none'>;

export interface ControlsPlace {
  kind: ControlsKind;
  /** The buttons' distance from the frame's bottom edge, in px. */
  bottom: number;
}

/** Between the groups, and between the buttons and what lies under them. */
export const CONTROLS_GAP = 8;
/** The buttons' least distance from the frame's top and bottom edges (the overlays' inset, canvas.tsx OVERLAY_GAP). */
export const CONTROLS_EDGE = 12;
/** Where M05 put the column (Tailwind bottom-7): the first render, before anything is measured. */
export const CONTROLS_START: ControlsPlace = { kind: 'column', bottom: 28 };

/**
 * The size of the groups laid out one way: one above the other, each upright (column) or lying
 * (stack), or side by side, each lying (row); CONTROLS_GAP between them.
 */
export function arrangement(strips: readonly Strip[], kind: Shown): Size {
  const gaps = CONTROLS_GAP * Math.max(0, strips.length - 1);
  const sum = (part: 'long' | 'short') => strips.reduce((total, s) => total + s[part], 0) + gaps;
  const most = (part: 'long' | 'short') => strips.reduce((m, s) => Math.max(m, s[part]), 0);
  if (kind === 'column') return { width: most('short'), height: sum('long') };
  if (kind === 'stack') return { width: most('long'), height: sum('short') };
  return { width: sum('long'), height: most('short') };
}

/**
 * Where the buttons lie in a frame of this size: `right` is their inset from the frame's right
 * edge; `below` holds what else lies along the frame's bottom edge, in the frame's pixels (each
 * one from its top down to the bottom edge counts as taken). A column when it fits; when it does
 * not and `row` allows it, a stack, else a row (a phone: from 768 px the selection's panel lies
 * over the canvas at the right, beside the column, where a wider arrangement would go under it);
 * else not shown.
 */
export function placeControls(frame: Size, right: number, strips: readonly Strip[], below: readonly Box[], options: { row: boolean }): ControlsPlace {
  if (strips.length === 0 || frame.width <= 0 || frame.height <= 0) return { kind: 'none', bottom: CONTROLS_EDGE };
  const kinds: Shown[] = options.row ? ['column', 'stack', 'row'] : ['column'];
  for (const kind of kinds) {
    const size = arrangement(strips, kind);
    const left = frame.width - right - size.width;
    let bottom = CONTROLS_EDGE;
    for (const b of below) {
      if (b.width <= 0 || b.height <= 0) continue;
      if (b.x < frame.width - right && b.x + b.width > left) bottom = Math.max(bottom, frame.height - b.y + CONTROLS_GAP);
    }
    if (left >= 0 && bottom + size.height + CONTROLS_EDGE <= frame.height) return { kind, bottom };
  }
  return { kind: 'none', bottom: CONTROLS_EDGE };
}
