import { afterEach, describe, expect, it, vi } from 'vitest';

import { LineageReadError, readDeadline, searchRoutes, type UpEdge, withinBudget } from './lineage-graph';

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

describe('withinBudget: a cached read inside the procedure deadline (final check, privacy-security-1)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers with the read when it is done in time', async () => {
    await expect(withinBudget(readDeadline(1_000), async () => 'answer')).resolves.toBe('answer');
  });

  it('fails as a cancelled statement (57014) when the deadline passes first, and the read keeps running', async () => {
    vi.useFakeTimers();
    let finish: (value: string) => void = () => undefined;
    const read = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const filled = vi.fn();
    const answer = withinBudget(readDeadline(2_000), () => read.then((value) => (filled(value), value)));
    const settled = answer.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const error = await settled;
    expect(error).toBeInstanceOf(LineageReadError);
    expect((error as LineageReadError).code).toBe('57014');
    // The cached read was not cancelled: it still finishes (and fills the cache), with no timer left.
    finish('late');
    await vi.advanceTimersByTimeAsync(0);
    expect(filled).toHaveBeenCalledWith('late');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer when the read settles first, also when the read fails', async () => {
    vi.useFakeTimers();
    await expect(withinBudget(readDeadline(2_000), async () => 'fast')).resolves.toBe('fast');
    expect(vi.getTimerCount()).toBe(0);
    await expect(withinBudget(readDeadline(2_000), async () => Promise.reject(new LineageReadError('40001')))).rejects.toMatchObject({ code: '40001' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a spent deadline fails at once, without starting the read', async () => {
    const read = vi.fn(async () => 'never');
    await expect(withinBudget(readDeadline(0), read)).rejects.toMatchObject({ code: '57014' });
    expect(read).not.toHaveBeenCalled();
  });
});
