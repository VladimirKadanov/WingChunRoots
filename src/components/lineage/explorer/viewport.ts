// The view's maths for the M06 explorer (milestone M06, package F): where a person can be shown on
// the canvas pane, how far the view moves so that a person is wholly in view (a key move, a
// selection, the phone's sheet coming up), what React Flow draws (onlyRenderVisibleElements), and
// how far the view moves so that a person keeps their screen point when a new layout moves them
// (an expansion). Pure: no React, no DOM, no React Flow. M05's first-view maths (FIT_OPTIONS,
// wholeViewStart, largeViewStart, shiftIntoView) stays in canvas.tsx with its tests.
//
// Coordinates: a flow point p lands on the pane at p * zoom + (x, y) (React Flow's transform). A
// box "on the pane" is in the pane's own CSS pixels, with (0, 0) at its top left corner.

import type { Box, Point } from '@/lib/lineage-layout/types';

/** React Flow's view: a flow point p lands on the pane at p * zoom + (x, y). */
export interface View {
  x: number;
  y: number;
  zoom: number;
}

/**
 * The canvas pane: its size and what lies over it, in the pane's own pixels: the overlays (the
 * legend, the zoom buttons) and the covers (the desktop panel over the canvas, a phone's sheet at
 * full height). A person under one of them can be neither seen nor tapped.
 */
export interface PaneArea {
  width: number;
  height: number;
  overlays?: readonly Box[];
}

/** The overlays' inset from the pane's edges (canvas.tsx OVERLAY_GAP, 0.75rem): a person shown keeps this far from both. */
export const VIEW_GAP = 12;
/** Rounding slack, in px: a box exactly on the area's edge is inside it. */
const SLACK = 0.5;

/** A flow box where the view draws it on the pane. */
export function onPane(box: Box, view: View): Box {
  return { x: box.x * view.zoom + view.x, y: box.y * view.zoom + view.y, width: box.width * view.zoom, height: box.height * view.zoom };
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const solid = (b: Box) => b.width > 0 && b.height > 0;

/** The part of the pane a person can be shown in: inside VIEW_GAP from its edges. The overlays are cut out of it by inVisibleArea. */
export function visibleArea(pane: PaneArea): Box {
  return { x: VIEW_GAP, y: VIEW_GAP, width: Math.max(0, pane.width - 2 * VIEW_GAP), height: Math.max(0, pane.height - 2 * VIEW_GAP) };
}

/** Whether a box on the pane lies wholly inside the visible area and under none of the overlays. */
export function inVisibleArea(box: Box, pane: PaneArea): boolean {
  const area = visibleArea(pane);
  const inside =
    box.x >= area.x - SLACK &&
    box.y >= area.y - SLACK &&
    box.x + box.width <= area.x + area.width + SLACK &&
    box.y + box.height <= area.y + area.height + SLACK;
  return inside && !(pane.overlays ?? []).filter(solid).some((o) => overlaps(box, o));
}

/**
 * Where on the pane a box of this size can lie, wholly in the visible area and clear of the
 * overlays (VIEW_GAP away from each), nearest to `at` (its wished-for top left corner); null where
 * there is no such place. The places tried are the wished-for one pulled into the area and those
 * beside each overlay, so the box moves no further than it must.
 */
export function placeNear(size: { width: number; height: number }, at: Point, pane: PaneArea): Point | null {
  const area = visibleArea(pane);
  if (size.width > area.width + SLACK || size.height > area.height + SLACK) return null;
  const overlays = (pane.overlays ?? []).filter(solid);
  const clampX = (x: number) => Math.min(Math.max(x, area.x), area.x + area.width - size.width);
  const clampY = (y: number) => Math.min(Math.max(y, area.y), area.y + area.height - size.height);
  const xs = new Set([clampX(at.x), area.x, area.x + area.width - size.width]);
  const ys = new Set([clampY(at.y), area.y, area.y + area.height - size.height]);
  for (const o of overlays) {
    xs.add(clampX(o.x - VIEW_GAP - size.width)).add(clampX(o.x + o.width + VIEW_GAP));
    ys.add(clampY(o.y - VIEW_GAP - size.height)).add(clampY(o.y + o.height + VIEW_GAP));
  }
  let best: { at: Point; distance: number } | null = null;
  for (const x of xs) {
    for (const y of ys) {
      const box = { x, y, ...size };
      if (!inVisibleArea(box, pane)) continue;
      const distance = (x - at.x) ** 2 + (y - at.y) ** 2;
      if (!best || distance < best.distance) best = { at: { x, y }, distance };
    }
  }
  return best?.at ?? null;
}

/**
 * The view that shows a person (`node`, a flow box) wholly in the visible area, clear of the
 * overlays, moved as little as it can be; null when the view shows them so already (DEFAULT, no D
 * number; milestone M06 b3). Where the person fits nowhere at this zoom (a full card on a short
 * phone above the legend), the view zooms out to the largest zoom at which they fit, never below
 * `minZoom` (the smallest zoom with names, READABLE_ZOOM). Where they fit nowhere even there, the
 * card is put at the top of the pane, under the toolbar, centred where it was across the pane,
 * and its lower part may lie under what covers the bottom of the pane; never above the pane.
 */
export function ensureVisible(node: Box, view: View, pane: PaneArea, options: { minZoom?: number } = {}): View | null {
  const now = onPane(node, view);
  if (inVisibleArea(now, pane)) return null;
  const minZoom = Math.min(options.minZoom ?? view.zoom, view.zoom);
  // The point the card is centred on now: it stays as near to it as it can.
  const centre = { x: now.x + now.width / 2, y: now.y + now.height / 2 };
  const viewAt = (zoom: number, at: Point): View => ({ x: at.x - node.x * zoom, y: at.y - node.y * zoom, zoom });
  for (let zoom = view.zoom; ; zoom = Math.max(minZoom, zoom * 0.9)) {
    const size = { width: node.width * zoom, height: node.height * zoom };
    const at = placeNear(size, { x: centre.x - size.width / 2, y: centre.y - size.height / 2 }, pane);
    if (at) return viewAt(zoom, at);
    if (zoom <= minZoom) break;
  }
  const area = visibleArea(pane);
  const width = node.width * minZoom;
  const x = Math.min(Math.max(centre.x - width / 2, area.x), Math.max(area.x, area.x + area.width - width));
  return viewAt(minZoom, { x, y: area.y });
}

/**
 * Whether React Flow draws a node at this view (onlyRenderVisibleElements: any part of its box on
 * the pane, as React Flow's getNodesInside with `partially`).
 */
export function isDrawn(node: Box, view: View, pane: { width: number; height: number }): boolean {
  const box = onPane(node, view);
  const width = Math.min(box.x + box.width, pane.width) - Math.max(box.x, 0);
  const height = Math.min(box.y + box.height, pane.height) - Math.max(box.y, 0);
  return width > 0 && height > 0;
}

/** The id of the box whose centre lies nearest to `point` (both on the pane or both in the flow), or null for none. */
export function nearest(point: Point, boxes: readonly { id: string; box: Box }[]): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const { id, box } of boxes) {
    const distance = (box.x + box.width / 2 - point.x) ** 2 + (box.y + box.height / 2 - point.y) ** 2;
    if (!best || distance < best.distance) best = { id, distance };
  }
  return best?.id ?? null;
}

/**
 * How far the view moves (in pane pixels) so that a person a new layout moves from `before` to
 * `after` (flow points, e.g. their top left corners) keeps their screen point (an expansion,
 * milestone M06 In scope 4: the pressed node stays where it was on the screen).
 */
export function anchorDelta(before: Point, after: Point, zoom: number): Point {
  return { x: (before.x - after.x) * zoom, y: (before.y - after.y) * zoom };
}
