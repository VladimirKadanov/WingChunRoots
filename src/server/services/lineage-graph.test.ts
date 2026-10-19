import { describe, expect, it } from 'vitest';

import { searchRoutes, type UpEdge } from './lineage-graph';

/** Teacher edges per student, in the order the search tries them (primary first). */
function graph(edges: [student: string, teacher: string][]): Map<string, UpEdge[]> {
  const up = new Map<string, UpEdge[]>();
  for (const [student, teacher] of edges) {
    up.set(student, [...(up.get(student) ?? []), { id: `${teacher}>${student}`, teacherId: teacher, studentId: student }]);
  }
  return up;
}

const people = (up: Map<string, UpEdge[]>) => new Set([...up.keys(), ...[...up.values()].flat().map((e) => e.teacherId)]);
const tops = (routes: { nodes: string[] }[]) => routes.map((r) => r.nodes.at(-1));

describe('searchRoutes', () => {
  // focus has a primary teacher p at the foot of a crossed ladder (4 routes up) and a second
  // teacher f without teachers.
  const ladder = graph([
    ['focus', 'p'],
    ['focus', 'f'],
    ['p', 'a1'],
    ['p', 'b1'],
    ['a1', 'a0'],
    ['a1', 'b0'],
    ['b1', 'b0'],
    ['b1', 'a0'],
  ]);

  it('finds the route along primary teachers first, and every route once', () => {
    const { routes, capped } = searchRoutes('focus', ladder, people(ladder), true);
    expect(capped).toBe(false);
    expect(routes[0]!.nodes).toEqual(['focus', 'p', 'a1', 'a0']);
    expect(routes).toHaveLength(5);
    expect(new Set(routes.map((r) => r.edges.join(' '))).size).toBe(5);
  });

  it('keeps one route through each teacher of the focus when the cap is reached in one branch', () => {
    const { routes, capped } = searchRoutes('focus', ladder, people(ladder), true, { budget: 1_000, cap: 2, depth: 32 });
    expect(capped).toBe(true);
    // The first pass: one route through p (primary first) and the one through f; then the cap.
    expect(routes.slice(0, 2).map((r) => r.nodes)).toEqual([
      ['focus', 'p', 'a1', 'a0'],
      ['focus', 'f'],
    ]);
  });

  it('a person whose teachers were not read (past the ancestor cap) ends no route', () => {
    const read = new Set(['focus', 'p', 'f', 'a1', 'b1', 'b0']);
    const { routes, capped } = searchRoutes('focus', ladder, read, false);
    expect(capped).toBe(true);
    expect(tops(routes)).not.toContain('a0');
    expect(tops(routes).sort()).toEqual(['b0', 'b0', 'f']);
  });

  it('stops after the work budget and says there may be more', () => {
    const { capped } = searchRoutes('focus', ladder, people(ladder), true, { budget: 3, cap: 1_000, depth: 32 });
    expect(capped).toBe(true);
  });

  it('a person without teachers has no routes; a loop in the record is not followed', () => {
    expect(searchRoutes('alone', new Map(), new Set(['alone']), true)).toEqual({ routes: [], capped: false });
    const loop = graph([
      ['x', 'y'],
      ['y', 'x'],
      ['y', 'z'],
    ]);
    expect(searchRoutes('x', loop, people(loop), true).routes.map((r) => r.nodes)).toEqual([['x', 'y', 'z']]);
  });
});
