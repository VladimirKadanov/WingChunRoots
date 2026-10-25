// The explorer's URL state and reads (plan §4.3) and the large fan-out rule (plan §4.8).

import { describe, expect, it } from 'vitest';

import type { LineageGraphDto } from '@/server/dto/public';
import { capFanout, drawnByDefault, explorerRead, FANOUT_SHOWN, joinToBox, paramsFrom, viewKind } from './state';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const node = (n: number, childCount = 0) => ({
  id: id(n),
  slug: `demo-${n}`,
  displayName: `Demo Person ${String(n).padStart(3, '0')}`,
  altNames: [],
  lifeStatus: 'living',
  claimState: 'unclaimed' as const,
  lineageIds: [id(900)],
  childCount,
  hasMoreChildren: false,
  visibility: 'public' as const,
});
const edge = (teacher: number, student: number) => ({
  id: id(10_000 + teacher * 1000 + student),
  teacherId: id(teacher),
  studentId: id(student),
  lineageId: id(900),
  kind: 'primary' as const,
  status: 'verified' as const,
  isDisplayPrimary: true,
  visibility: 'public' as const,
  periods: [],
});

describe('paramsFrom and viewKind', () => {
  it('reads the URL with the same rules as the browser', () => {
    expect(paramsFrom({ focus: id(1).toUpperCase(), up: '2', down: 'x', show: 'historical', view: 'list' })).toEqual({
      focus: id(1),
      up: 2,
      down: null,
      lineage: null,
      show: 'historical',
      view: 'list',
    });
    expect(paramsFrom({ focus: 'not-an-id' }).focus).toBeNull();
    expect(viewKind({ up: null, down: null, lineage: null })).toBe('person');
    expect(viewKind({ up: 1, down: null, lineage: null })).toBe('generations');
    expect(viewKind({ up: 1, down: 1, lineage: id(900) })).toBe('lineage');
  });

  it('maps the three views to their reads (plan §4.3), within the API caps', () => {
    const base = { focus: id(1), up: null, down: null, lineage: null, show: null, view: 'graph' as const };
    expect(explorerRead(base, null, false)).toEqual({ procedure: 'ego', input: { focusId: id(1), up: 16, down: 2 } });
    expect(explorerRead(base, null, true)).toEqual({ procedure: 'ego', input: { focusId: id(1), up: 2, down: 1 } });
    expect(explorerRead({ ...base, up: 3, down: 99 }, null, false)).toEqual({ procedure: 'ego', input: { focusId: id(1), up: 3, down: 4 } });
    expect(explorerRead({ ...base, lineage: id(900) }, id(7), false)).toEqual({
      procedure: 'subtree',
      input: { rootId: id(7), lineageId: id(900), depth: 3 },
    });
    // DEFAULT D22: an unknown root starts the lineage at the focus.
    expect(explorerRead({ ...base, lineage: id(900) }, null, false).input).toMatchObject({ rootId: id(1) });
  });
});

describe('capFanout (plan §4.8)', () => {
  const many = Array.from({ length: 30 }, (_, i) => i + 2);
  const graph: LineageGraphDto = {
    focusId: id(1),
    dataVersion: 'test',
    nodes: [node(1), ...many.map((n) => node(n, n === 31 ? 5 : 0)), node(100), node(101)],
    edges: [...many.map((n) => edge(1, n)), edge(31, 100), edge(2, 101)],
    hiddenCounts: {},
    lineages: [{ id: id(900), slug: 'demo-lineage', name: 'Demo Lineage', rootPersonId: id(1) }],
    truncated: false,
  };

  it('draws at most 12 students of a teacher and counts the rest', () => {
    const { graph: capped, more } = capFanout(graph);
    expect(capped.edges.filter((e) => e.teacherId === id(1))).toHaveLength(FANOUT_SHOWN);
    expect(more.get(id(1))).toBe(30 - FANOUT_SHOWN);
  });

  it('keeps the students with the most students first, and drops what only a dropped student led to', () => {
    const { graph: capped } = capFanout(graph);
    const shown = new Set(capped.nodes.map((n) => n.id));
    expect(shown.has(id(31))).toBe(true);
    expect(shown.has(id(100))).toBe(true);
    // Every drawn edge joins two drawn people.
    for (const e of capped.edges) expect(shown.has(e.teacherId) && shown.has(e.studentId)).toBe(true);
  });

  it('leaves a small graph as it is', () => {
    const small = { ...graph, nodes: graph.nodes.slice(0, 4), edges: graph.edges.slice(0, 3) };
    expect(capFanout(small)).toEqual({ graph: small, more: new Map() });
  });

  it('draws the active students before those whose training ended, whatever their students (verified, active, most descendants)', () => {
    const ended = [{ from: '1980', to: '1990', ongoing: false, precision: 'year' as const }];
    // 15 ended students with 2 students each (2..16), 15 active ones with none (17..31).
    const mixed: LineageGraphDto = {
      ...graph,
      nodes: [node(1), ...many.map((n) => node(n, n <= 16 ? 2 : 0))],
      edges: many.map((n) => (n <= 16 ? { ...edge(1, n), periods: ended } : edge(1, n))),
    };
    const { graph: capped, more } = capFanout(mixed);
    const drawn = drawnByDefault(capped, false).edges.filter((e) => e.teacherId === id(1));
    expect(drawn).toHaveLength(FANOUT_SHOWN);
    expect(drawn.every((e) => e.periods.length === 0)).toBe(true);
    expect(more.get(id(1))).toBe(30 - FANOUT_SHOWN);
  });

  it('counts the students the read left out (hiddenCounts) in "+N students", only where the cap cut', () => {
    // The server's fan-out limit returned 30 of 105 students of 1; 2 has one more student than the answer holds.
    const read = { ...graph, hiddenCounts: { [id(1)]: { teachers: 0, students: 75 }, [id(2)]: { teachers: 0, students: 1 } } };
    const { more } = capFanout(read);
    expect(more.get(id(1))).toBe(30 - FANOUT_SHOWN + 75);
    // No chip where the cap left nothing out: those students are not "more" of a large fan-out.
    expect(more.has(id(2))).toBe(false);
  });

  it('counts students, not relationships: two relationships with one student are one student', () => {
    // 13 students of 1 (2..14); 14 also learnt from 1 in a second lineage, and sorts last.
    const twice: LineageGraphDto = {
      ...graph,
      nodes: [node(1), ...many.slice(0, 13).map((n) => node(n))],
      edges: [...many.slice(0, 13).map((n) => edge(1, n)), { ...edge(1, 14), id: id(99_999), lineageId: id(901), kind: 'crossLineage' as const }],
    };
    const { graph: capped, more } = capFanout(twice);
    expect(capped.nodes.map((n) => n.id)).not.toContain(id(14));
    expect(more.get(id(1))).toBe(1);
  });
});

describe('joinToBox (an edge reaches the smaller box of a compact or dot level of detail)', () => {
  // The compact box (120×36) centred in a 200×64 slot at (0, 0).
  const box = { x: 40, y: 14, width: 120, height: 36 };

  it('runs straight up from a bottom end below the box', () => {
    expect(joinToBox({ x: 100, y: 64 }, box)).toEqual([{ x: 100, y: 50 }]);
  });

  it('turns along the slot edge when the end lies beyond the box', () => {
    expect(joinToBox({ x: 10, y: 0 }, box)).toEqual([
      { x: 44, y: 14 },
      { x: 44, y: 0 },
    ]);
  });

  it('runs across from a side end, as a cross-lineage curve has', () => {
    expect(joinToBox({ x: 0, y: 32 }, box)).toEqual([{ x: 40, y: 32 }]);
    expect(joinToBox({ x: 200, y: 32 }, box)).toEqual([{ x: 160, y: 32 }]);
  });

  it('adds nothing when the end is on the box already', () => {
    expect(joinToBox({ x: 100, y: 50 }, box)).toEqual([]);
  });
});

describe('drawnByDefault (plan §4.6: ended training only with show=historical)', () => {
  const ended = [{ from: '1980', to: '1990', ongoing: false, precision: 'year' as const }];
  const graph: LineageGraphDto = {
    focusId: id(2),
    dataVersion: 'test',
    // 1 taught 2 long ago; 3 teaches 2 now; 2 teaches 4 now.
    nodes: [node(1), node(2), node(3), node(4)],
    edges: [{ ...edge(1, 2), periods: ended }, edge(3, 2), edge(2, 4)],
    hiddenCounts: {},
    lineages: [{ id: id(900), slug: 'demo-lineage', name: 'Demo Lineage', rootPersonId: null }],
    truncated: false,
  };

  it('leaves out ended training and the people linked only by it, never the focus', () => {
    const drawn = drawnByDefault(graph, false);
    expect(drawn.edges.map((e) => e.teacherId)).toEqual([id(3), id(2)]);
    expect(drawn.nodes.map((n) => n.id)).toEqual([id(2), id(3), id(4)]);
    const alone = drawnByDefault({ ...graph, focusId: id(1) }, false);
    expect(alone.nodes.map((n) => n.id)).toContain(id(1));
  });

  it('keeps everything with show=historical', () => {
    expect(drawnByDefault(graph, true)).toBe(graph);
  });
});
