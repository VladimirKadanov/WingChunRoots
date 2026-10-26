import { describe, expect, it } from 'vitest';
import { ConstraintGraph, solveSeparation, type SeparationConstraint, type SeparationVariable } from './separation.ts';

const vars = (...desired: number[]): SeparationVariable[] => desired.map((d) => ({ desired: d, weight: 1 }));

function violations(x: number[], constraints: readonly SeparationConstraint[]): SeparationConstraint[] {
  return constraints.filter((c) => x[c.right]! - x[c.left]! < c.gap - 1e-6);
}

/** Deterministic pseudo-random numbers (mulberry32). */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('solveSeparation (VPSC satisfy, plan §4.6)', () => {
  it('keeps the desired positions when they satisfy every constraint', () => {
    expect(solveSeparation(vars(0, 50, 100), [{ left: 0, right: 1, gap: 20 }, { left: 1, right: 2, gap: 20 }])).toEqual([
      0, 50, 100,
    ]);
  });

  it('splits a violated gap by weight, as least squares does', () => {
    expect(solveSeparation(vars(0, 0), [{ left: 0, right: 1, gap: 10 }])).toEqual([-5, 5]);
    const weighted = solveSeparation(
      [
        { desired: 0, weight: 3 },
        { desired: 0, weight: 1 },
      ],
      [{ left: 0, right: 1, gap: 8 }],
    );
    expect(weighted).toEqual([-2, 6]);
  });

  it('moves a chain of blocks as one', () => {
    const x = solveSeparation(vars(0, 0, 0), [
      { left: 0, right: 1, gap: 10 },
      { left: 1, right: 2, gap: 10 },
    ]);
    expect(x).toEqual([-10, 0, 10]);
  });

  it('places a variable between two others (a student between its teachers)', () => {
    // Teachers at 0 and 100, the student wants 300: it ends at the right teacher, which moves
    // towards it as far as their equal weights ask.
    const x = solveSeparation(vars(0, 100, 300), [
      { left: 0, right: 2, gap: 0 },
      { left: 2, right: 1, gap: 0 },
    ]);
    expect(x).toEqual([0, 200, 200]);
  });

  it('satisfies every constraint of random acyclic systems, the same way every time', () => {
    const next = random(20261025);
    for (let round = 0; round < 50; round++) {
      const size = 2 + Math.floor(next() * 30);
      const variables = Array.from({ length: size }, () => ({ desired: Math.round(next() * 1000), weight: 0.1 + next() }));
      const graph = new ConstraintGraph(size);
      for (let i = 0; i < size * 2; i++) {
        const a = Math.floor(next() * size);
        const b = Math.floor(next() * size);
        if (a !== b) graph.add(a, b, Math.round(next() * 100));
      }
      const x = solveSeparation(variables, graph.constraints);
      expect(violations(x, graph.constraints), `round ${round}`).toEqual([]);
      expect(solveSeparation(variables, graph.constraints)).toEqual(x);
    }
  });
});

describe('ConstraintGraph', () => {
  it('refuses a constraint that would close a cycle, so the system always has a solution', () => {
    const graph = new ConstraintGraph(3);
    expect(graph.add(0, 1, 10)).toBe(true);
    expect(graph.add(1, 2, 10)).toBe(true);
    expect(graph.add(2, 0, 0)).toBe(false);
    expect(graph.constraints).toHaveLength(2);
    expect(graph.reaches(0, 2)).toBe(true);
    expect(graph.reaches(2, 0)).toBe(false);
  });

  it('is what solveSeparation needs: a cycle passed directly is an error', () => {
    expect(() =>
      solveSeparation(vars(0, 0), [
        { left: 0, right: 1, gap: 0 },
        { left: 1, right: 0, gap: 0 },
      ]),
    ).toThrow('cycle');
  });
});
