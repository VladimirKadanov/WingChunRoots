// The explorer's URL state and reads (plan §4.3) and the large fan-out rule (plan §4.8).

import { describe, expect, it } from 'vitest';

import type { LineageGraphDto } from '@/server/dto/public';
import { capFanout, explorerRead, FANOUT_SHOWN, paramsFrom, viewKind } from './state';

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
});
