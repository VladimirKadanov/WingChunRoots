import { describe, expect, it } from 'vitest';

import { arrangement, CONTROLS_EDGE, CONTROLS_GAP, placeControls, type Strip } from './controls-layout';

// The groups as a phone draws them: "Canvas tools" with one 44 px button, "Zoom" with three
// (44 px buttons, a 1 px line between them and a 1 px frame around); with a fine pointer the tools
// have two ("Keyboard shortcuts" too).
const TOOLS: Strip = { long: 46, short: 46 };
const TOOLS_FINE: Strip = { long: 91, short: 46 };
const ZOOM: Strip = { long: 136, short: 46 };
const PHONE = [TOOLS, ZOOM];
const RIGHT = 12;
// The legend at the bottom left (two lines on a 393 px phone) and the attribution's 44 px hit area at the bottom right.
const legend = (frame: { width: number; height: number }) => ({ x: 12, y: frame.height - 12 - 64, width: frame.width - 88, height: 64 });
const attribution = (frame: { width: number; height: number }) => ({ x: frame.width - 56, y: frame.height - 44, width: 56, height: 44 });

describe('arrangement', () => {
  it('lays the groups one above the other (upright or lying) or side by side, CONTROLS_GAP apart', () => {
    expect(arrangement(PHONE, 'column')).toEqual({ width: 46, height: 46 + CONTROLS_GAP + 136 });
    expect(arrangement(PHONE, 'stack')).toEqual({ width: 136, height: 46 + CONTROLS_GAP + 46 });
    expect(arrangement(PHONE, 'row')).toEqual({ width: 46 + CONTROLS_GAP + 136, height: 46 });
    expect(arrangement([TOOLS_FINE, ZOOM], 'column')).toEqual({ width: 46, height: 91 + CONTROLS_GAP + 136 });
    expect(arrangement([TOOLS_FINE, ZOOM], 'stack')).toEqual({ width: 136, height: 46 + CONTROLS_GAP + 46 });
    expect(arrangement([], 'row')).toEqual({ width: 0, height: 0 });
  });
});

describe('placeControls', () => {
  it('keeps the column at the bottom right, above the attribution, when it fits (an idle phone)', () => {
    const frame = { width: 393, height: 352 };
    const place = placeControls(frame, RIGHT, PHONE, [legend(frame), attribution(frame)], { row: true });
    // The legend lies left of the column; the attribution under it.
    expect(place).toEqual({ kind: 'column', bottom: 44 + CONTROLS_GAP });
  });

  it('stacks the groups, each in a row, above the legend when the column does not fit (a short phone with the panel open)', () => {
    // The sheet at its peek, and M05's panel below the graph (the stack just fits).
    for (const height of [223, 196]) {
      const frame = { width: 393, height };
      const place = placeControls(frame, RIGHT, PHONE, [legend(frame), attribution(frame)], { row: true });
      // The stack spans the legend's right end: it stands above the legend's top.
      expect(place).toEqual({ kind: 'stack', bottom: 12 + 64 + CONTROLS_GAP });
      expect(place.bottom + 100 + CONTROLS_EDGE).toBeLessThanOrEqual(frame.height);
    }
  });

  it('lays both groups in one row above the legend where not even the stack fits (a phone with the sheet at half height)', () => {
    const frame = { width: 390, height: 147 };
    const place = placeControls(frame, RIGHT, PHONE, [legend(frame), attribution(frame)], { row: true });
    expect(place).toEqual({ kind: 'row', bottom: 12 + 64 + CONTROLS_GAP });
    expect(place.bottom + 46 + CONTROLS_EDGE).toBeLessThanOrEqual(frame.height);
    expect(placeControls({ width: 393, height: 195 }, RIGHT, PHONE, [legend({ width: 393, height: 195 })], { row: true }).kind).toBe('row');
  });

  it('shows no buttons in a sliver of canvas where not even the row fits (a short phone with the sheet at half height)', () => {
    const frame = { width: 393, height: 54 };
    expect(placeControls(frame, RIGHT, PHONE, [legend(frame), attribution(frame)], { row: true }).kind).toBe('none');
  });

  it('never lays rows from 768 px, where the panel lies over the canvas beside the column', () => {
    const tall = { width: 620, height: 259 };
    expect(placeControls(tall, RIGHT, PHONE, [attribution(tall)], { row: false }).kind).toBe('column');
    const low = { width: 620, height: 200 };
    expect(placeControls(low, RIGHT, PHONE, [attribution(low)], { row: false }).kind).toBe('none');
    expect(placeControls(low, RIGHT, PHONE, [attribution(low)], { row: true }).kind).toBe('stack');
  });

  it('stands only above what lies under it: the bottom edge inset, else CONTROLS_GAP above the highest thing beneath', () => {
    const frame = { width: 1200, height: 800 };
    // Nothing under the column: the edge inset.
    expect(placeControls(frame, RIGHT, [TOOLS_FINE, ZOOM], [{ x: 12, y: 760, width: 300, height: 28 }], { row: true })).toEqual({ kind: 'column', bottom: CONTROLS_EDGE });
    // A desktop attribution, 18 px tall at the bottom right corner.
    expect(placeControls(frame, RIGHT, [TOOLS_FINE, ZOOM], [{ x: 1144, y: 782, width: 56, height: 18 }], { row: true })).toEqual({
      kind: 'column',
      bottom: 18 + CONTROLS_GAP,
    });
    // Empty boxes (an overlay not drawn) take no room.
    expect(placeControls(frame, RIGHT, [TOOLS_FINE, ZOOM], [{ x: 1144, y: 400, width: 0, height: 0 }], { row: true }).bottom).toBe(CONTROLS_EDGE);
  });

  it('shows nothing without groups or without a frame', () => {
    expect(placeControls({ width: 393, height: 352 }, RIGHT, [], [], { row: true }).kind).toBe('none');
    expect(placeControls({ width: 0, height: 0 }, RIGHT, PHONE, [], { row: true }).kind).toBe('none');
  });

  it('needs the whole column inside the frame, CONTROLS_EDGE from its top', () => {
    const height = CONTROLS_EDGE + 190 + CONTROLS_EDGE;
    expect(placeControls({ width: 393, height }, RIGHT, PHONE, [], { row: false }).kind).toBe('column');
    expect(placeControls({ width: 393, height: height - 1 }, RIGHT, PHONE, [], { row: false }).kind).toBe('none');
  });
});
