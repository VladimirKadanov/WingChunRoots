// The explorer canvas's view (plan §4.3, §4.8, §5.8 (e)): where the first view of a large scene
// starts, the moves of the view take the motion tokens, and every fit of the whole view stops at
// the cards' own size.

import { describe, expect, it } from 'vitest';

import { motion } from '@/design/tokens';
import type { Box, Scene, SceneEdge, SceneNode } from '@/lib/lineage-layout/types';
import { cubicBezier, FIT_OPTIONS, largeViewStart, ms, VIEW_MOTION } from './canvas';

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
    return {
      id: p.id,
      rank: p.rank,
      cutOff: false,
      onSpine: false,
      ...box,
      center: { x: p.x + SLOT.width / 2, y: y + SLOT.height / 2 },
      boxes: { full: box, compact: box, dot: box },
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

  it('fits a scene of up to 40 drawn people whole, not counting people hidden by default', () => {
    const people = Array.from({ length: 43 }, (_, i) => ({ id: `p${i}`, rank: i === 0 ? 0 : 1, x: i * 224 }));
    const scene = sceneOf(people, people.slice(1).map((p) => ['p0', p.id] as [string, string]), 'p0');
    expect(largeViewStart(scene, new Set(), desktop)).not.toBeNull();
    // Three people whose only links ended: laid out, hidden until asked for; the view has 40.
    expect(largeViewStart(scene, new Set(['p40', 'p41', 'p42', 'p0>p40', 'p0>p41', 'p0>p42']), desktop)).toBeNull();
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
      expect(bottom.y + bottom.height).toBeCloseTo(buttons.y - 12, 6);
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

describe('fitting the whole view', () => {
  it('never zooms past the cards’ own size, for the first view and the button alike', () => {
    expect(FIT_OPTIONS.maxZoom).toBe(1);
  });
});
