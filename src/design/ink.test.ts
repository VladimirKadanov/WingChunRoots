import { describe, expect, it } from 'vitest';
import { brushWidth, dotsD, inkShapes, type Cubic, type Point } from './ink';
import { inkAlong, roundedRoute, routeD, sampleRoute } from './ink-route';
import { VERIFICATION_STATES } from './tokens';

const curve: Cubic = [
  [3, 11],
  [21, 3],
  [41, 18],
  [59, 9],
];

describe('ink strokes', () => {
  it('draws every state as a different kind of shape (never colour alone)', () => {
    const kinds = VERIFICATION_STATES.map((state) => {
      const shape = inkShapes(curve, state);
      return shape.kind === 'fill' ? `fill:${shape.d.split('M').length - 1}` : shape.kind;
    });
    // verified is one ribbon, under review several dashes, unconfirmed dots, arbitration two lines.
    expect(kinds[0]).toBe('dots');
    expect(kinds[1]).toMatch(/^fill:[2-9]/);
    expect(kinds[2]).toBe('fill:1');
    expect(kinds[3]).toBe('double');
  });
  it('draws cross-lineage links hollow, with the state in the dash', () => {
    expect(inkShapes(curve, 'verified', { crossLineage: true })).toMatchObject({ kind: 'hollow', dash: null });
    expect(inkShapes(curve, 'under_review', { crossLineage: true })).toMatchObject({ kind: 'hollow', dash: '7 4' });
  });
  it('tapers from the teacher to the student', () => {
    expect(brushWidth(0.1, 6, 1.5)).toBeGreaterThan(brushWidth(0.9, 6, 1.5));
  });
  it('is deterministic', () => {
    expect(inkShapes(curve, 'verified')).toEqual(inkShapes(curve, 'verified'));
  });
});

describe('ink along a route (the explorer, owner decision 2026-10-31)', () => {
  // Down from a teacher's port, across, and down into the student: the shape of an orthogonal route.
  const route: Point[] = [
    [0, 0],
    [0, 40],
    [120, 40],
    [120, 100],
  ];

  it('rounds each corner with a quadratic curve whose control point is the corner, leaving the ends where they were', () => {
    const r = roundedRoute(route, 16);
    expect(r.start).toEqual([0, 0]);
    expect(r.pieces.map((p) => p.kind)).toEqual(['line', 'cubic', 'line', 'cubic', 'line']);
    expect(r.pieces[0]).toEqual({ kind: 'line', to: [0, 24] });
    const corner = r.pieces[1]!;
    // A quadratic from (0, 24) over (0, 40) to (16, 40), written as a cubic.
    expect(corner.kind === 'cubic' && corner.to).toEqual([16, 40]);
    expect(corner.kind === 'cubic' && corner.c1[0]).toBeCloseTo(0);
    expect(corner.kind === 'cubic' && corner.c1[1]).toBeCloseTo(24 + (16 * 2) / 3);
    expect(r.pieces[4]).toEqual({ kind: 'line', to: [120, 100] });
    expect(routeD(r)).toMatch(/^M0,0L0,24C/);
  });

  it('keeps a corner within half of a run between two corners, and drops repeated and straight-through points', () => {
    const r = roundedRoute(
      [
        [0, 0],
        [0, 0],
        [0, 20],
        [0, 30],
        [10, 30],
        [10, 80],
      ],
      16,
    );
    // The run across is 10 long: each of its corners takes at most 5 of it.
    const corners = r.pieces.filter((p) => p.kind === 'cubic');
    expect(corners).toHaveLength(2);
    expect(corners[0]!.to).toEqual([5, 30]);
    expect(r.pieces[0]).toEqual({ kind: 'line', to: [0, 25] });
  });

  it('samples a route with the distance along it and unit normals', () => {
    const s = sampleRoute(roundedRoute(route, 16));
    expect(s[0]).toMatchObject({ x: 0, y: 0, len: 0 });
    expect(Math.hypot(s[0]!.nx, s[0]!.ny)).toBeCloseTo(1);
    for (let i = 1; i < s.length; i++) expect(s[i]!.len).toBeGreaterThan(s[i - 1]!.len);
    // Shorter than the polyline (160 + 60 = 220... 40 + 120 + 60): the corners cut across.
    expect(s[s.length - 1]!.len).toBeLessThan(220);
    expect(s[s.length - 1]!.len).toBeGreaterThan(200);
  });

  it('draws every state as a different kind of shape, as inkShapes does', () => {
    const r = roundedRoute(route, 16);
    const kinds = VERIFICATION_STATES.map((state) => {
      const shape = inkAlong(r, state, { w0: 5.6, w1: 1.4, reach: 90 });
      return shape.kind === 'fill' ? `fill:${shape.d.split('M').length - 1}` : shape.kind;
    });
    expect(kinds[0]).toBe('dots');
    expect(kinds[1]).toMatch(/^fill:\d{2}/);
    expect(kinds[2]).toBe('fill:1');
    expect(kinds[3]).toBe('double');
    expect(inkAlong(r, 'verified', { w0: 5.6, w1: 1.4, crossLineage: { dash: '9 3 2 3' } })).toMatchObject({ kind: 'hollow', dash: '9 3 2 3' });
  });

  it('gives links that share a trunk the same width along it, falling with the distance from the teacher', () => {
    const short = inkAlong(roundedRoute(route, 16), 'verified', { w0: 5.6, w1: 1.4, reach: 90 });
    const long = inkAlong(roundedRoute([...route.slice(0, 3), [120, 400]], 16), 'verified', { w0: 5.6, w1: 1.4, reach: 90 });
    // The first points of the left edge (down the trunk) are the same in both.
    const left = (d: string) => (d.slice(1).split('Z')[0] ?? '').split('L').slice(0, 3);
    expect(short.kind === 'fill' && left(short.d)).toEqual(long.kind === 'fill' && left(long.d));
    // Half the width where the brush touches down, nearly all of it 10 along, thinner further on.
    const width = (d: string, i: number) => {
      const points = (d.slice(1).split('Z')[0] ?? '').split('L').map((p) => p.split(',').map(Number) as [number, number]);
      return Math.abs(points[i]![0] - points[points.length - 1 - i]![0]);
    };
    expect(long.kind === 'fill' && width(long.d, 0)).toBeCloseTo(2.8, 0);
    expect(long.kind === 'fill' && width(long.d, 1)).toBeGreaterThan(width(long.kind === 'fill' ? long.d : '', 2));
  });

  it('keeps the dots of an unconfirmed link apart where the stroke is widest, at both levels of the explorer', () => {
    // The explorer's widths (CANVAS_INK): the full cards, and the compact ones drawn wider.
    for (const options of [
      { w0: 5.6, w1: 1.4, reach: 90 },
      { w0: 9, w1: 2.8, reach: 90, pattern: 1.6 },
    ]) {
      const shape = inkAlong(roundedRoute(route, 24), 'unconfirmed', options);
      if (shape.kind !== 'dots') throw new Error(shape.kind);
      expect(shape.circles.length).toBeGreaterThan(10);
      for (let i = 1; i < shape.circles.length; i++) {
        const [a, b] = [shape.circles[i - 1]!, shape.circles[i]!];
        // A gap of at least the smaller dot's radius between two dots in a row.
        expect(Math.hypot(b.cx - a.cx, b.cy - a.cy) - a.r - b.r).toBeGreaterThanOrEqual(Math.min(a.r, b.r) - 0.25);
      }
    }
  });

  it('draws dots as one path of circles', () => {
    expect(dotsD([{ cx: 10, cy: 5, r: 2 }])).toBe('M8,5a2,2 0 1,0 4,0a2,2 0 1,0 -4,0');
  });

  it('is deterministic and leaves the curves of inkShapes as they were', () => {
    const r = roundedRoute(route, 16);
    expect(inkAlong(r, 'under_review', { w0: 5.6, w1: 1.4, reach: 90 })).toEqual(inkAlong(r, 'under_review', { w0: 5.6, w1: 1.4, reach: 90 }));
    expect(inkShapes(curve, 'verified', { n: 4 })).toEqual({
      kind: 'fill',
      d: expect.stringMatching(/^M[\d.,L-]+Z$/),
    });
  });
});
