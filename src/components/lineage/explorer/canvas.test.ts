// The explorer canvas's view (plan §4.3, §4.8, §5.8 (e)): where the first view of a large scene
// starts, the moves of the view take the motion tokens, and every fit of the whole view stops at
// the cards' own size.

import { describe, expect, it } from 'vitest';

import { motion } from '@/design/tokens';
import type { Scene, SceneEdge, SceneNode } from '@/lib/lineage-layout/types';
import { cubicBezier, FIT_OPTIONS, largeViewStart, ms, VIEW_MOTION } from './canvas';

const SLOT = { width: 200, height: 64 };
const ROW = 200;

/** A laid-out scene: people by rank and x (the left of their 200×64 slot), and teacher → student links. */
function sceneOf(people: readonly { id: string; rank: number; x: number }[], links: readonly [string, string][], focusId: string): Scene {
  const nodes: SceneNode[] = people.map((p) => {
    const box = { x: p.x, y: p.rank * ROW, ...SLOT };
    return {
      id: p.id,
      rank: p.rank,
      cutOff: false,
      onSpine: false,
      ...box,
      center: { x: p.x + SLOT.width / 2, y: p.rank * ROW + SLOT.height / 2 },
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
  const height = Math.max(...people.map((p) => p.rank * ROW + SLOT.height));
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

/** Whether the slot of a person lies inside the pane when the view starts there. */
function onScreen(scene: Scene, id: string, start: { x: number; y: number; zoom: number }, pane: { width: number; height: number }): boolean {
  const n = scene.nodes.find((node) => node.id === id)!;
  const left = (n.x - start.x) * start.zoom + pane.width / 2;
  const top = (n.y - start.y) * start.zoom + pane.height / 2;
  return left >= 0 && top >= 0 && left + n.width * start.zoom <= pane.width && top + n.height * start.zoom <= pane.height;
}

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
    // The next nearest, 1542 px to the left, is too far for full cards: the root alone, a quarter down.
    expect(start).toEqual({ x: 8352, y: 32 + 766 / 4, zoom: 1 });
  });

  it('on a phone keeps full cards and the root alone when no student fits beside it', () => {
    const scene = wideLineage();
    expect(largeViewStart(scene, new Set(), phone)).toEqual({ x: 8352, y: 32 + 600 / 4 / 0.75, zoom: 0.75 });
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
