// The explorer canvas's view (plan §4.3, §4.8, §5.8 (e)): where the first view of a scene
// starts, the moves of the view take the motion tokens, and every fit of the whole view stops at
// the cards' own size.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { motion } from '@/design/tokens';
import { NODE_SIZES } from '@/lib/lineage-layout/presets';
import { COLUMN_HEADER_SPACE } from '@/lib/lineage-layout/scene';
import type { Box, DetailLevel, Scene, SceneEdge, SceneNode } from '@/lib/lineage-layout/types';
import { cubicBezier, DETAIL_ZOOM, FIT_OPTIONS, fitViewStart, largeViewStart, ms, READABLE_ZOOM, shiftIntoView, VIEW_MOTION, whenMovesEnd, wholeFitZoom, wholeViewStart } from './canvas';

const SLOT = { width: 200, height: 64 };
const ROW = 200;

/**
 * A laid-out scene: people by rank and x (the left of their 200×64 slot), the top of their row
 * (y, `rank` × 200 unless given), and teacher → student links.
 */
function sceneOf(people: readonly { id: string; rank: number; x: number; y?: number }[], links: readonly [string, string][], focusId: string): Scene {
  const nodes: SceneNode[] = people.map((p) => {
    const y = p.y ?? p.rank * ROW;
    const box = { x: p.x, y, ...SLOT };
    const center = { x: p.x + SLOT.width / 2, y: y + SLOT.height / 2 };
    // The box of each level of detail, centred on the slot (as the layout's scene makes them).
    const centred = (level: DetailLevel): Box => ({ x: center.x - NODE_SIZES[level].width / 2, y: center.y - NODE_SIZES[level].height / 2, ...NODE_SIZES[level] });
    return {
      id: p.id,
      rank: p.rank,
      cutOff: false,
      onSpine: false,
      ...box,
      center,
      boxes: { full: centred('full'), compact: centred('compact'), dot: centred('dot') },
    };
  });
  const edges: SceneEdge[] = links.map(([teacherId, studentId]) => ({
    id: `${teacherId}>${studentId}`,
    teacherId,
    studentId,
    lineageId: 'demo-lineage',
    kind: 'primary',
    routedBy: 'elk',
    onSpine: false,
    bends: 0,
    path: { type: 'orthogonal', points: [] },
  }));
  const width = Math.max(...people.map((p) => p.x + SLOT.width));
  const height = Math.max(...nodes.map((n) => n.y + n.height));
  return {
    version: 1,
    dataVersion: 'test',
    focusId,
    preset: 'explorer',
    nodePlacement: 'BRANDES_KOEPF',
    nodeSize: 'full',
    width,
    height,
    bounds: { x: 0, y: 0, width, height },
    rowY: [0, ROW, 2 * ROW, 3 * ROW],
    nodes,
    edges,
    spine: [],
    bands: [{ lineageId: 'demo-lineage', x: 0, width, nodes: nodes.length }],
  };
}

/**
 * A wide lineage like demo-lineage-b: the root above its five students, who are far apart above
 * their own students (48 people in all).
 */
function wideLineage(): Scene {
  const people = [{ id: 'root', rank: 0, x: 8252 }];
  const links: [string, string][] = [];
  const students = [2019, 4236, 6710, 9028, 13305];
  students.forEach((x, i) => {
    people.push({ id: `s${i}`, rank: 1, x });
    links.push(['root', `s${i}`]);
    for (let j = 0; j < 8; j++) {
      people.push({ id: `s${i}g${j}`, rank: 2, x: x - 900 + j * 224 });
      links.push([`s${i}`, `s${i}g${j}`]);
    }
  });
  return sceneOf(people, links, 'root');
}

/**
 * Demo Lineage A at its root as the Lineage view lays it out: the root's nearest student 280 px to
 * its left, two students of both below them (rows 136 and 480 px down: the edges of a wide teacher
 * run between), and the root's other students thousands of pixels away (41 people in all).
 */
function lineageA(): Scene {
  const people = [
    { id: 'root', rank: 0, x: 11696, y: 12 },
    { id: 'student', rank: 1, x: 11416, y: 136 },
    { id: 'both-left', rank: 2, x: 11472, y: 480 },
    { id: 'both-right', rank: 2, x: 11696, y: 480 },
    { id: 'grand', rank: 2, x: 11248, y: 480 },
  ];
  const links: [string, string][] = [
    ['root', 'student'],
    ['root', 'both-left'],
    ['root', 'both-right'],
    ['student', 'both-left'],
    ['student', 'both-right'],
    ['student', 'grand'],
  ];
  [1132, 3805, 24676, 27588].forEach((x, i) => {
    people.push({ id: `far${i}`, rank: 1, x, y: 136 });
    links.push(['root', `far${i}`]);
    for (let j = 0; j < 9; j++) {
      people.push({ id: `far${i}g${j}`, rank: 2, x: x - 900 + j * 224, y: 480 });
      links.push([`far${i}`, `far${i}g${j}`]);
    }
  });
  return sceneOf(people, links, 'root');
}

/** The box of a person's slot on the pane when the view starts there. */
function paneBox(scene: Scene, id: string, start: { x: number; y: number; zoom: number }, pane: { width: number; height: number }): Box {
  const n = scene.nodes.find((node) => node.id === id)!;
  return { x: (n.x - start.x) * start.zoom + pane.width / 2, y: (n.y - start.y) * start.zoom + pane.height / 2, width: n.width * start.zoom, height: n.height * start.zoom };
}

/** Whether the slot of a person lies inside the pane when the view starts there. */
function onScreen(scene: Scene, id: string, start: { x: number; y: number; zoom: number }, pane: { width: number; height: number }): boolean {
  const box = paneBox(scene, id, start, pane);
  return box.x >= 0 && box.y >= 0 && box.x + box.width <= pane.width && box.y + box.height <= pane.height;
}

const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('the first view of a scene', () => {
  const desktop = { width: 1208, height: 766 };
  const phone = { width: 390, height: 600 };

  it('fits a scene whole when the pane shows all its drawn people as cards, not counting people hidden by default', () => {
    // A teacher above three students, and three more students thousands of pixels away whose only
    // links ended: laid out, hidden until asked for.
    const people = [
      { id: 'p0', rank: 0, x: 224 },
      ...[0, 1, 2].map((j) => ({ id: `p${j + 1}`, rank: 1, x: j * 224 })),
      ...[0, 1, 2].map((j) => ({ id: `p${j + 4}`, rank: 1, x: 20000 + j * 224 })),
    ];
    const scene = sceneOf(people, people.slice(1).map((p) => ['p0', p.id] as [string, string]), 'p0');
    const ended = new Set(['p4', 'p5', 'p6', 'p0>p4', 'p0>p5', 'p0>p6']);
    expect(largeViewStart(scene, ended, desktop)).toBeNull();
    // Counted, the far three would make every person a dot: the view starts at the focus.
    expect(largeViewStart(scene, new Set(), desktop)).not.toBeNull();
  });

  it('starts a view at the focus whenever its whole fit makes every person a dot, however few people it has', () => {
    // Forty-three people in one row, three of them hidden by default: forty drawn, 0.11 when fitted whole.
    const people = Array.from({ length: 43 }, (_, i) => ({ id: `p${i}`, rank: i === 0 ? 0 : 1, x: i * 224 }));
    const scene = sceneOf(people, people.slice(1).map((p) => ['p0', p.id] as [string, string]), 'p0');
    const hidden = new Set(['p40', 'p41', 'p42', 'p0>p40', 'p0>p41', 'p0>p42']);
    expect(wholeFitZoom(scene.nodes.filter((n) => !hidden.has(n.id)), desktop)).toBeLessThan(READABLE_ZOOM);
    const start = largeViewStart(scene, hidden, desktop)!;
    expect(start.zoom).toBeGreaterThanOrEqual(DETAIL_ZOOM.full);
    expect(onScreen(scene, 'p0', start, desktop)).toBe(true);
  });

  /**
   * A person view like demo-hub-a's on a phone: the focus under its teacher, above `count` students
   * in one row (224 px apart), 2 + count people in all.
   */
  function hub(count: number): Scene {
    const middle = ((count - 1) * 224) / 2;
    const people = [
      { id: 'teacher', rank: 0, x: middle },
      { id: 'hub', rank: 1, x: middle },
      ...Array.from({ length: count }, (_, j) => ({ id: `s${j}`, rank: 2, x: j * 224 })),
    ];
    const links: [string, string][] = [['teacher', 'hub'], ...Array.from({ length: count }, (_, j) => ['hub', `s${j}`] as [string, string])];
    return sceneOf(people, links, 'hub');
  }

  it('opens a small view whose whole fit would be dots at the focus, in full cards, with the people that fit beside it', () => {
    // Fourteen people: fitted whole at 390 px, 0.13, every one a dot.
    const scene = hub(12);
    expect(scene.nodes).toHaveLength(14);
    expect(wholeFitZoom(scene.nodes, phone)).toBeLessThan(READABLE_ZOOM);
    const start = largeViewStart(scene, new Set(), phone)!;
    expect(start).not.toBeNull();
    expect(start.zoom).toBe(DETAIL_ZOOM.full);
    expect(onScreen(scene, 'hub', start, phone)).toBe(true);
    // Its teacher above it, and the students nearest below it (two full cards fit side by side at 390 px).
    expect(onScreen(scene, 'teacher', start, phone)).toBe(true);
    const students = scene.nodes.filter((n) => n.id.startsWith('s') && onScreen(scene, n.id, start, phone));
    expect(students.length).toBeGreaterThanOrEqual(1);
  });

  it('leaves no empty canvas above the top row when the view starts at a person below it (b7)', () => {
    // On a tall phone the frame of the hub, its teacher and two students is shorter than the pane:
    // centred, it would leave the canvas above the teacher's row empty.
    const tall = { width: 390, height: 844 };
    const scene = hub(12);
    const start = largeViewStart(scene, new Set(), tall)!;
    expect(onScreen(scene, 'teacher', start, tall)).toBe(true);
    // The teacher's row, the top of the view, meets the pane's margin (OVERLAY_GAP on a phone).
    expect(paneBox(scene, 'teacher', start, tall).y).toBeCloseTo(12, 0);
    // With two lineage columns, the room for their headers stays above it.
    const columns: Scene = { ...scene, bands: [scene.bands[0]!, { lineageId: 'demo-lineage-2', x: 9000, width: 448, nodes: 0 }] };
    const withHeaders = largeViewStart(columns, new Set(), tall)!;
    expect(paneBox(columns, 'teacher', withHeaders, tall).y).toBeCloseTo(12 + COLUMN_HEADER_SPACE * withHeaders.zoom, 0);
  });

  it('decides by the pane: the same view is fitted whole on a desktop and starts at the focus on a phone', () => {
    // Ten people, 1768 px wide: 0.60 on the desktop pane (compact chips), 0.19 at 390 px.
    const scene = hub(8);
    expect(wholeFitZoom(scene.nodes, desktop)).toBeGreaterThanOrEqual(READABLE_ZOOM);
    expect(largeViewStart(scene, new Set(), desktop)).toBeNull();
    expect(wholeFitZoom(scene.nodes, phone)).toBeLessThan(READABLE_ZOOM);
    const start = largeViewStart(scene, new Set(), phone)!;
    expect(start.zoom).toBe(DETAIL_ZOOM.full);
    expect(onScreen(scene, 'hub', start, phone)).toBe(true);
  });

  it('measures the whole fit as React Flow fits the view, never past the cards\' own size', () => {
    // React Flow's padding of 0.15: floor((size - size / 1.15) / 2) on each side.
    const scene = hub(12);
    expect(wholeFitZoom(scene.nodes, desktop)).toBeCloseTo((1208 - 2 * 78) / (11 * 224 + 200), 9);
    expect(wholeFitZoom(scene.nodes, phone)).toBeCloseTo((390 - 2 * 25) / (11 * 224 + 200), 9);
    expect(wholeFitZoom([{ x: 0, y: 0, width: 200, height: 64 }], desktop)).toBe(FIT_OPTIONS.maxZoom);
    // The threshold is the zoom below which every person is a dot (lodOf).
    expect(READABLE_ZOOM).toBe(DETAIL_ZOOM.compact);
    expect(DETAIL_ZOOM).toEqual({ full: 0.75, compact: 0.4 });
  });

  it('opens the Lineage view on its root with the nearest of its students, in full cards', () => {
    const scene = wideLineage();
    const start = largeViewStart(scene, new Set(), desktop)!;
    expect(start.zoom).toBeGreaterThanOrEqual(0.75);
    expect(start.zoom).toBeLessThanOrEqual(1);
    expect(onScreen(scene, 'root', start, desktop)).toBe(true);
    // The student 776 px to the right of the root; the others are thousands of pixels away.
    expect(onScreen(scene, 's3', start, desktop)).toBe(true);
  });

  it('skips a student whose link is hidden by default', () => {
    const scene = wideLineage();
    const start = largeViewStart(scene, new Set(['s3', 'root>s3', ...Array.from({ length: 8 }, (_, j) => `s3>s3g${j}`)]), desktop)!;
    expect(onScreen(scene, 'root', start, desktop)).toBe(true);
    // The next nearest, 1542 px to the left, is too far for full cards: the root alone, at the
    // top of the pane inside a whole-view fit's padding (nobody is above it).
    expect(start.x).toBe(8352);
    expect(start.zoom).toBe(1);
    expect(paneBox(scene, 'root', start, desktop).y).toBeCloseTo((766 - 766 / (1 + FIT_OPTIONS.padding)) / 2, 6);
  });

  it('on a phone keeps full cards and the root alone when no student fits beside it', () => {
    const scene = wideLineage();
    // At the top of the pane, 12 px down, and the rows below fill the rest.
    expect(largeViewStart(scene, new Set(), phone)).toEqual({ x: 8352, y: (600 / 2 - 12) / 0.75, zoom: 0.75 });
  });

  describe('on a phone, with the legend and the zoom buttons over the pane', () => {
    // The pane of the Lineage view at 390x844, and its overlays as the explorer draws them: the
    // legend across the bottom (two lines), the zoom buttons above its right end.
    const legend = { x: 12, y: 461, width: 302, height: 64 };
    const buttons = { x: 332, y: 375, width: 46, height: 134 };
    const pane = { width: 390, height: 537, overlays: [legend, buttons] };

    it('frames the root and its nearest student in full cards, clear of both, and the row below above the legend', () => {
      const scene = lineageA();
      const start = largeViewStart(scene, new Set(), pane)!;
      expect(start.zoom).toBe(0.75);
      for (const id of ['root', 'student']) {
        expect(onScreen(scene, id, start, pane), id).toBe(true);
        for (const overlay of pane.overlays) expect(overlap(paneBox(scene, id, start, pane), overlay), `${id} under an overlay`).toBe(false);
      }
      // Nobody is drawn above the root: the view starts at the top of the pane, 12 px down, and the
      // students of both, the next row, are on the pane above the legend.
      expect(paneBox(scene, 'root', start, pane).y).toBeCloseTo(12, 6);
      for (const id of ['both-left', 'both-right']) {
        const box = paneBox(scene, id, start, pane);
        expect(box.y, id).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height, id).toBeLessThanOrEqual(legend.y);
      }
    });

    it('frames the students of both too where nothing lies over the pane: the overlays are what leaves them out', () => {
      const scene = lineageA();
      const start = largeViewStart(scene, new Set(), { width: pane.width, height: pane.height })!;
      for (const id of ['root', 'student', 'both-left', 'both-right']) expect(onScreen(scene, id, start, pane), id).toBe(true);
    });

    it('moves a centred frame up to keep the overlays\' inset from the zoom buttons', () => {
      // A student of the second row with two of its own students: 318 by 198 px at 0.75, which
      // centred on the pane would end 7.5 px above the zoom buttons, closer than their 12 px inset.
      const scene = { ...wideLineage(), focusId: 's1' };
      const start = largeViewStart(scene, new Set(), pane)!;
      for (const id of ['s1', 's1g4', 's1g5']) {
        expect(onScreen(scene, id, start, pane), id).toBe(true);
        for (const overlay of pane.overlays) expect(overlap(paneBox(scene, id, start, pane), overlay), `${id} under an overlay`).toBe(false);
      }
      const bottom = paneBox(scene, 's1g4', start, pane);
      expect(bottom.y + bottom.height).toBeLessThanOrEqual(buttons.y - 12 + 1e-6);
      // Moved up past the inset until the top row meets the pane's margin, with no empty canvas
      // above it (b7 of the M06 design review): 3 px higher than the inset alone would put it.
      expect(paneBox(scene, 'root', start, pane).y).toBeCloseTo(12, 6);
      expect(buttons.y - 12 - (bottom.y + bottom.height)).toBeCloseTo(3, 0);
    });
  });

  describe('a small view on a short phone, with the legend and the zoom buttons over the pane', () => {
    /**
     * The person view of demo-two-lineages on a phone as the layout places it: two teachers'
     * teachers, the two teachers, the focus, and its two students (rows 124 px apart).
     */
    function twoLineages(): Scene {
      const people = [
        { id: 'root-a', rank: 0, x: 45, y: 12 },
        { id: 'root-b', rank: 0, x: 269, y: 12 },
        { id: 'teacher-a', rank: 1, x: 45, y: 136 },
        { id: 'teacher-b', rank: 1, x: 269, y: 136 },
        { id: 'focus', rank: 2, x: 45, y: 260 },
        { id: 'student-a', rank: 3, x: 12, y: 384 },
        { id: 'student-b', rank: 3, x: 236, y: 384 },
      ];
      const links: [string, string][] = [
        ['root-a', 'teacher-a'],
        ['root-b', 'teacher-b'],
        ['teacher-a', 'focus'],
        ['teacher-b', 'focus'],
        ['focus', 'student-a'],
        ['focus', 'student-b'],
      ];
      return sceneOf(people, links, 'focus');
    }
    // The pane at 393x659 (an iPhone 15's viewport), 352 px high: the legend wraps to two lines.
    const legend = { x: 12, y: 276, width: 305, height: 64 };
    const buttons = { x: 335, y: 190, width: 46, height: 134 };
    const short = { width: 393, height: 352, overlays: [legend, buttons] };
    /** A person's box as drawn at the start's level of detail, on the pane. */
    const drawnBox = (scene: Scene, id: string, start: { x: number; y: number; zoom: number }, pane: { width: number; height: number }): Box => {
      const n = scene.nodes.find((node) => node.id === id)!;
      const box = n.boxes[start.zoom >= DETAIL_ZOOM.full ? 'full' : start.zoom >= DETAIL_ZOOM.compact ? 'compact' : 'dot'];
      return { x: (box.x - start.x) * start.zoom + pane.width / 2, y: (box.y - start.y) * start.zoom + pane.height / 2, width: box.width * start.zoom, height: box.height * start.zoom };
    };

    it('fits it whole clear of the legend, where React Flow\'s fit would draw its bottom row under the legend', () => {
      const scene = twoLineages();
      const fit = wholeFitZoom(scene.nodes, short);
      // React Flow's fit, centred at its zoom: the students' row lies under the legend.
      const centred = { x: 12 + 457 / 2, y: 12 + 436 / 2, zoom: fit };
      expect(overlap(drawnBox(scene, 'student-a', centred, short), legend)).toBe(true);
      expect(largeViewStart(scene, new Set(), short)).toBeNull();
      const start = wholeViewStart(scene, new Set(), short)!;
      expect(start).not.toBeNull();
      expect(start.zoom).toBeGreaterThanOrEqual(READABLE_ZOOM);
      expect(start.zoom).toBeLessThanOrEqual(fit);
      for (const n of scene.nodes) {
        expect(onScreen(scene, n.id, start, short), n.id).toBe(true);
        for (const overlay of short.overlays) expect(overlap(paneBox(scene, n.id, start, short), overlay), `${n.id} under an overlay`).toBe(false);
        // The overlays' inset: 12 px clear of the legend below it.
        expect(paneBox(scene, n.id, start, short).y + paneBox(scene, n.id, start, short).height, n.id).toBeLessThanOrEqual(legend.y - 12 + 1e-6);
      }
      // A frame narrow enough to pass beside the zoom buttons, not one that stops above them.
      expect(start.zoom).toBeGreaterThan((buttons.y - 12 - 12) / 436);
    });

    it('keeps React Flow\'s fit where it draws everyone clear of the overlays: at 390x844, and with nothing over the pane', () => {
      const scene = twoLineages();
      // The pane at 390x844 (the legend on two lines there too): compact chips, all of them clear.
      const pane390 = { width: 390, height: 537, overlays: [{ x: 12, y: 461, width: 302, height: 64 }, { x: 332, y: 375, width: 46, height: 134 }] };
      expect(wholeFitZoom(scene.nodes, pane390)).toBeLessThan(DETAIL_ZOOM.full);
      expect(wholeViewStart(scene, new Set(), pane390)).toBeNull();
      expect(largeViewStart(scene, new Set(), pane390)).toBeNull();
      expect(wholeViewStart(scene, new Set(), { width: short.width, height: short.height })).toBeNull();
    });

    it('moves the whole fit up, at its zoom, where it would end under the zoom buttons', () => {
      // The pane at 412x839 (a Pixel 7's viewport): full cards, the legend on one line; centred, the
      // right student's card would reach 6 px under the zoom buttons.
      const scene = twoLineages();
      const buttons412 = { x: 354, y: 370, width: 46, height: 134 };
      const tall = { width: 412, height: 532, overlays: [{ x: 12, y: 483, width: 312, height: 37 }, buttons412] };
      const fit = wholeFitZoom(scene.nodes, tall);
      expect(fit).toBeGreaterThanOrEqual(DETAIL_ZOOM.full);
      const start = wholeViewStart(scene, new Set(), tall)!;
      expect(start.zoom).toBeCloseTo(fit, 9);
      for (const n of scene.nodes) {
        expect(onScreen(scene, n.id, start, tall), n.id).toBe(true);
        for (const overlay of tall.overlays) expect(overlap(paneBox(scene, n.id, start, tall), overlay), `${n.id} under an overlay`).toBe(false);
      }
      const bottom = paneBox(scene, 'student-b', start, tall);
      expect(bottom.y + bottom.height).toBeLessThanOrEqual(buttons412.y - 12 + 1e-6);
    });

    it('opens it like a large view when the fit clear of the overlays would make every person a dot', () => {
      // The legend as tall as most of the pane: whole, clear of it, the people would be dots.
      const scene = twoLineages();
      const tallLegend = { ...short, overlays: [{ x: 12, y: 150, width: 305, height: 190 }, buttons] };
      expect(wholeFitZoom(scene.nodes, tallLegend)).toBeGreaterThanOrEqual(READABLE_ZOOM);
      expect(wholeViewStart(scene, new Set(), tallLegend)).toBeNull();
      const start = largeViewStart(scene, new Set(), tallLegend)!;
      expect(start).not.toBeNull();
      expect(start.zoom).toBe(DETAIL_ZOOM.full);
      expect(onScreen(scene, 'focus', start, tallLegend)).toBe(true);
    });

    it('"Fit the whole view" fits it whole clear of the overlays even where that makes every person a dot (screens-6)', () => {
      // The same pane: the first view opens like a large view, but the button shows all of it, in
      // dots, with nobody under the legend or the buttons (not React Flow's fit, which draws its
      // lower rows under the legend).
      const scene = twoLineages();
      const tallLegend = { ...short, overlays: [{ x: 12, y: 150, width: 305, height: 190 }, buttons] };
      const fit = wholeFitZoom(scene.nodes, tallLegend);
      const centred = { x: 12 + 457 / 2, y: 12 + 436 / 2, zoom: fit };
      expect(overlap(drawnBox(scene, 'student-a', centred, tallLegend), tallLegend.overlays[0]!)).toBe(true);
      const start = fitViewStart(scene, new Set(), tallLegend)!;
      expect(start).not.toBeNull();
      expect(start.zoom).toBeLessThan(READABLE_ZOOM);
      expect(start.zoom).toBeLessThanOrEqual(fit);
      for (const n of scene.nodes) {
        expect(onScreen(scene, n.id, start, tallLegend), n.id).toBe(true);
        for (const overlay of tallLegend.overlays) expect(overlap(paneBox(scene, n.id, start, tallLegend), overlay), `${n.id} under an overlay`).toBe(false);
      }
      // Where the first view fits it whole clear of the overlays, the button shows that same view.
      expect(fitViewStart(scene, new Set(), short)).toEqual(wholeViewStart(scene, new Set(), short));
      // Where React Flow's fit draws everyone clear (nothing over the pane), the button keeps it.
      expect(fitViewStart(scene, new Set(), { width: short.width, height: short.height })).toBeNull();
    });
  });

  it('starts at the top of the pane when the people above the focus are hidden by default', () => {
    // The root's links ended: nobody is drawn above its students' row.
    const hidden = new Set(['root', ...Array.from({ length: 5 }, (_, i) => `root>s${i}`)]);
    const scene = { ...wideLineage(), focusId: 's3' };
    const start = largeViewStart(scene, hidden, desktop)!;
    expect(onScreen(scene, 's3', start, desktop)).toBe(true);
    expect(paneBox(scene, 's3', start, desktop).y).toBeCloseTo((766 - 766 / (1 + FIT_OPTIONS.padding)) / 2, 6);
  });

  it('brings the teacher drawn above the focus into the first view', () => {
    const scene = { ...wideLineage(), focusId: 's1g4' };
    const start = largeViewStart(scene, new Set(), desktop)!;
    expect(onScreen(scene, 's1g4', start, desktop)).toBe(true);
    expect(onScreen(scene, 's1', start, desktop)).toBe(true);
    expect(start.zoom).toBe(1);
  });

  it('shows the focus with its nearest students when its own teacher is out of reach', () => {
    const scene = { ...wideLineage(), focusId: 's1' };
    const start = largeViewStart(scene, new Set(), desktop)!;
    expect(onScreen(scene, 's1', start, desktop)).toBe(true);
    // The root is 4016 px away; the focus's own students, 224 px apart below it, are near.
    expect(onScreen(scene, 'root', start, desktop)).toBe(false);
    expect(onScreen(scene, 's1g3', start, desktop)).toBe(true);
    expect(onScreen(scene, 's1g4', start, desktop)).toBe(true);
    expect(start.zoom).toBeGreaterThanOrEqual(0.75);
  });
});

describe('the moves of the view', () => {
  it('take their durations and curve from the motion tokens', () => {
    expect(`${VIEW_MOTION.buttons}ms`).toBe(motion.duration.base);
    expect(`${VIEW_MOTION.scene}ms`).toBe(motion.duration.slow);
    expect(ms('250ms')).toBe(250);
    // The people slide along --ease-out (globals.css); the view moves along the same curve.
    const out = cubicBezier(motion.easing.out);
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) expect(VIEW_MOTION.ease(t)).toBeCloseTo(out(t), 9);
  });

  it('read a cubic-bezier() timing function as CSS does', () => {
    const linear = cubicBezier('cubic-bezier(0, 0, 1, 1)');
    for (const t of [0, 0.2, 0.5, 0.8, 1]) expect(linear(t)).toBeCloseTo(t, 6);
    // CSS `ease-out` (0, 0, 0.58, 1) at the curve's parameter 1/2: x = 3·0.58/8 + 1/8 = 0.3425, y = 3/8 + 1/8 = 0.5.
    expect(cubicBezier('cubic-bezier(0, 0, 0.58, 1)')(0.3425)).toBeCloseTo(0.5, 6);
    const out = cubicBezier(motion.easing.out);
    expect(out(0)).toBe(0);
    expect(out(1)).toBe(1);
    let previous = 0;
    for (let t = 0.05; t < 1; t += 0.05) {
      expect(out(t)).toBeGreaterThanOrEqual(previous);
      previous = out(t);
    }
    // An ease-out curve: ahead of the clock all the way.
    expect(out(0.5)).toBeGreaterThan(0.5);
    expect(() => cubicBezier('ease-out')).toThrow();
  });
});

describe('a reveal that waits for the view\'s running moves (CanvasHandle ensureVisible)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs at once while no move runs', () => {
    const then = vi.fn();
    whenMovesEnd({ current: 0 }, then);
    expect(then).toHaveBeenCalledTimes(1);
  });

  it('waits while a move runs, and runs once it has ended', () => {
    vi.useFakeTimers();
    const moves = { current: 1 };
    const then = vi.fn();
    whenMovesEnd(moves, then);
    vi.advanceTimersByTime(200);
    expect(then).not.toHaveBeenCalled();
    moves.current = 0;
    vi.advanceTimersByTime(16);
    expect(then).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(then).toHaveBeenCalledTimes(1);
  });

  it('runs a second later at most, for a move that never ends', () => {
    vi.useFakeTimers();
    const then = vi.fn();
    whenMovesEnd({ current: 1 }, then);
    vi.advanceTimersByTime(990);
    expect(then).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30);
    expect(then).toHaveBeenCalledTimes(1);
  });

  it('never runs once cancelled: a newer reveal, a move to another node, a pan by the user', () => {
    vi.useFakeTimers();
    const moves = { current: 1 };
    const then = vi.fn();
    const cancel = whenMovesEnd(moves, then);
    vi.advanceTimersByTime(100);
    cancel();
    moves.current = 0;
    vi.advanceTimersByTime(2000);
    expect(then).not.toHaveBeenCalled();
  });
});

describe('fitting the whole view', () => {
  it('never zooms past the cards’ own size, for the first view and the button alike', () => {
    expect(FIT_OPTIONS.maxZoom).toBe(1);
  });
});

describe('a selected person when the pane gets shorter (a phone\'s panel opens below the graph)', () => {
  // A 393 px pane, 196 px tall once the panel is open, as on an iPhone 15 (393x659), with the
  // legend across its bottom and the zoom buttons at the right above it.
  const legend: Box = { x: 12, y: 130, width: 305, height: 54 };
  const zoom: Box = { x: 335, y: 36, width: 46, height: 132 };
  const pane = { width: 393, height: 196, overlays: [legend, zoom] };
  const card = (x: number, y: number): Box => ({ x, y, width: 141, height: 45 });

  it('stays where it is while it is wholly in view and clear of the overlays', () => {
    expect(shiftIntoView(card(126, 40), pane)).toBe(0);
  });

  it('moves up just enough to stand clear of the legend, when it went below the pane\'s new bottom edge', () => {
    // The focus of the person view: 197 px down the 352 px pane, out of the 196 px one.
    const shift = shiftIntoView(card(126, 197), pane);
    expect(197 + shift + 45).toBe(legend.y - 12);
  });

  it('moves up out from under the legend', () => {
    const shift = shiftIntoView(card(126, 100), pane);
    expect(100 + shift + 45).toBe(legend.y - 12);
  });

  it('keeps clear of the zoom buttons when its width reaches their column and it fits above them', () => {
    const shift = shiftIntoView(card(240, 300), { ...pane, height: 400, overlays: [{ ...zoom, y: 240 }] });
    expect(300 + shift + 45).toBe(240 - 12);
  });

  it('stays inside the pane when it cannot stand clear of the overlays, and never above its top margin', () => {
    // Across the zoom buttons' column (from 36 px down): no room above them, so only the pane counts.
    const shift = shiftIntoView(card(240, 170), pane);
    expect(170 + shift + 45).toBe(196 - 12);
    // A pane too short for the card: its top stays at the margin.
    expect(shiftIntoView(card(126, 30), { width: 393, height: 50 })).toBe(12 - 30);
    // Never down.
    expect(shiftIntoView(card(126, 5), { width: 393, height: 50 })).toBe(0);
  });
});
