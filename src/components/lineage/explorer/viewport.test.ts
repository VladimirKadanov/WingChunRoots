// The view's maths of the M06 explorer (viewport.ts; milestone M06, package F): the visible area of
// the pane, the smallest move that shows a person whole and clear of the overlays (b3), what React
// Flow draws, the nearest person to a point, and the anchor of an expansion.

import { describe, expect, it } from 'vitest';

import { anchorDelta, ensureVisible, inVisibleArea, isDrawn, nearest, onPane, placeNear, VIEW_GAP, visibleArea } from './viewport';

const card = { x: 0, y: 0, width: 200, height: 64 };
const pane = { width: 1000, height: 700 };

describe('visibleArea', () => {
  it('is the pane inside VIEW_GAP from every edge, never negative', () => {
    expect(visibleArea(pane)).toEqual({ x: VIEW_GAP, y: VIEW_GAP, width: 1000 - 2 * VIEW_GAP, height: 700 - 2 * VIEW_GAP });
    expect(visibleArea({ width: 10, height: 10 })).toEqual({ x: VIEW_GAP, y: VIEW_GAP, width: 0, height: 0 });
  });
});

describe('inVisibleArea', () => {
  it('holds for a box inside the area and clear of the overlays only', () => {
    expect(inVisibleArea({ x: 100, y: 100, width: 200, height: 64 }, pane)).toBe(true);
    // Over the edge's gap, or past it.
    expect(inVisibleArea({ x: 4, y: 100, width: 200, height: 64 }, pane)).toBe(false);
    expect(inVisibleArea({ x: 900, y: 100, width: 200, height: 64 }, pane)).toBe(false);
    // Under the legend.
    const legend = { x: 12, y: 600, width: 400, height: 88 };
    expect(inVisibleArea({ x: 100, y: 560, width: 200, height: 64 }, { ...pane, overlays: [legend] })).toBe(false);
    // An overlay of no size covers nothing.
    expect(inVisibleArea({ x: 100, y: 560, width: 200, height: 64 }, { ...pane, overlays: [{ x: 0, y: 0, width: 0, height: 700 }] })).toBe(true);
  });
});

describe('placeNear', () => {
  it('keeps the wished-for place when it is free, pulls it into the area, and passes an overlay on its nearest side', () => {
    expect(placeNear({ width: 200, height: 64 }, { x: 300, y: 200 }, pane)).toEqual({ x: 300, y: 200 });
    expect(placeNear({ width: 200, height: 64 }, { x: -50, y: 900 }, pane)).toEqual({ x: VIEW_GAP, y: 700 - VIEW_GAP - 64 });
    // The zoom buttons in the bottom right corner: a card wished under them goes above them.
    const zoom = { x: 944, y: 500, width: 44, height: 172 };
    const at = placeNear({ width: 200, height: 64 }, { x: 760, y: 600 }, { ...pane, overlays: [zoom] })!;
    expect(at).toEqual({ x: 944 - VIEW_GAP - 200, y: 600 });
  });

  it('is null when the box is larger than the area', () => {
    expect(placeNear({ width: 200, height: 64 }, { x: 0, y: 0 }, { width: 210, height: 300 })).toBeNull();
  });
});

describe('ensureVisible', () => {
  const view = { x: 0, y: 0, zoom: 1 };

  it('leaves a person already wholly in view where they are', () => {
    expect(ensureVisible({ ...card, x: 300, y: 300 }, view, pane)).toBeNull();
  });

  it('moves the view only as far as it must, at the same zoom', () => {
    // 150 px past the right edge: the view moves left until the card is VIEW_GAP inside it.
    const next = ensureVisible({ ...card, x: 950, y: 300 }, view, pane)!;
    expect(next.zoom).toBe(1);
    expect(onPane({ ...card, x: 950, y: 300 }, next)).toEqual({ x: 1000 - VIEW_GAP - 200, y: 300, width: 200, height: 64 });
    // Above the top edge, at another zoom: the view moves down, the zoom stays.
    const zoomed = { x: -100, y: -400, zoom: 0.8 };
    const up = ensureVisible({ ...card, x: 400, y: 300 }, zoomed, pane)!;
    expect(up.zoom).toBe(0.8);
    expect(onPane({ ...card, x: 400, y: 300 }, up).y).toBeCloseTo(VIEW_GAP);
  });

  it('keeps the person clear of an overlay', () => {
    const legend = { x: 12, y: 560, width: 600, height: 128 };
    const next = ensureVisible({ ...card, x: 100, y: 580 }, view, { ...pane, overlays: [legend] })!;
    const box = onPane({ ...card, x: 100, y: 580 }, next);
    expect(inVisibleArea(box, { ...pane, overlays: [legend] })).toBe(true);
    expect(box.y + box.height).toBeLessThanOrEqual(legend.y - VIEW_GAP + 0.5);
  });

  it('zooms out to a zoom at which the card fits, never below minZoom', () => {
    // A pane only 100 px tall between its edges' gaps: a 64 px card fits at zoom 1.25 or less.
    const short = { width: 400, height: 100 };
    const next = ensureVisible({ ...card, x: 0, y: 500 }, { x: 0, y: 0, zoom: 2 }, short, { minZoom: 0.4 })!;
    expect(next.zoom).toBeLessThan(2);
    expect(next.zoom).toBeGreaterThanOrEqual(0.4);
    expect(inVisibleArea(onPane({ ...card, x: 0, y: 500 }, next), short)).toBe(true);
  });

  it('puts a card that fits nowhere at the top of the pane at minZoom', () => {
    const tiny = { width: 120, height: 40 };
    const next = ensureVisible({ ...card, x: 0, y: 500 }, { x: 0, y: 0, zoom: 1 }, tiny, { minZoom: 0.4 })!;
    expect(next.zoom).toBe(0.4);
    expect(onPane({ ...card, x: 0, y: 500 }, next).y).toBe(VIEW_GAP);
  });

  it('never zooms in to show a person', () => {
    const next = ensureVisible({ ...card, x: 2000, y: 0 }, { x: 0, y: 0, zoom: 0.5 }, pane, { minZoom: 0.4 })!;
    expect(next.zoom).toBe(0.5);
  });
});

describe('isDrawn', () => {
  it('holds for a box with any part on the pane, as onlyRenderVisibleElements draws it', () => {
    expect(isDrawn({ ...card, x: 950, y: 10 }, { x: 0, y: 0, zoom: 1 }, pane)).toBe(true);
    expect(isDrawn({ ...card, x: 1000, y: 10 }, { x: 0, y: 0, zoom: 1 }, pane)).toBe(false);
    expect(isDrawn({ ...card, x: 1000, y: 10 }, { x: -10, y: 0, zoom: 1 }, pane)).toBe(true);
    expect(isDrawn({ ...card, x: 0, y: -100 }, { x: 0, y: 0, zoom: 1 }, pane)).toBe(false);
  });
});

describe('nearest', () => {
  it('picks the box whose centre is nearest, and null for none', () => {
    const boxes = [
      { id: 'a', box: { x: 0, y: 0, width: 10, height: 10 } },
      { id: 'b', box: { x: 100, y: 100, width: 10, height: 10 } },
    ];
    expect(nearest({ x: 90, y: 90 }, boxes)).toBe('b');
    expect(nearest({ x: 0, y: 0 }, boxes)).toBe('a');
    expect(nearest({ x: 0, y: 0 }, [])).toBeNull();
  });
});

describe('anchorDelta', () => {
  it('moves the view against the person\'s move, scaled by the zoom, so they keep their screen point', () => {
    const before = { x: 400, y: 248 };
    const after = { x: 520, y: 248 };
    const zoom = 0.75;
    const delta = anchorDelta(before, after, zoom);
    expect(delta).toEqual({ x: -90, y: 0 });
    const view = { x: 30, y: 40, zoom };
    expect(onPane({ ...card, ...after }, { ...view, x: view.x + delta.x, y: view.y + delta.y }).x).toBe(onPane({ ...card, ...before }, view).x);
  });
});
