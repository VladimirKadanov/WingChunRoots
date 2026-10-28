// The explorer's URL state and reads (plan §4.3) and the large fan-out rule (plan §4.8).

import { describe, expect, it } from 'vitest';

import type { LineageGraphDto } from '@/server/dto/public';
import { indexGraph, modelOrder } from '@/lib/lineage-layout/graph';
import { computeRanks } from '@/lib/lineage-layout/ranks';
import {
  capFanout,
  drawnByDefault,
  explorerHref,
  explorerRead,
  FANOUT_SHOWN,
  isSummaryId,
  joinToBox,
  paramsFrom,
  summaryIdOf,
  summaryTeacherOf,
  toLayoutGraph,
  viewKind,
  withSummaryNodes,
} from './state';

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

  it('writes a view back as the address it was read from, with the server\'s extra keys (Retry, the list view\'s pages)', () => {
    const query = { focus: id(1), up: '1', down: '3', lineage: id(900), show: 'historical', view: 'list' };
    const href = explorerHref(paramsFrom(query), { page: '2', routes: 'all' });
    expect(href.startsWith('/explore?')).toBe(true);
    const back = new URL(href, 'http://localhost').searchParams;
    expect(Object.fromEntries(back)).toEqual({ ...query, page: '2', routes: 'all' });
    expect(paramsFrom(Object.fromEntries(back))).toEqual(paramsFrom(query));
    // The defaults are left out, as the browser leaves them out.
    expect(explorerHref(paramsFrom({ focus: id(1) }))).toBe(`/explore?focus=${id(1)}`);
    expect(explorerHref(paramsFrom({}))).toBe('/explore');
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

describe('capFanout with pinned students (milestone M06: an expansion never drops a person drawn)', () => {
  const many = Array.from({ length: 30 }, (_, i) => i + 2);
  const graph: LineageGraphDto = {
    focusId: id(1),
    dataVersion: 'test',
    nodes: [node(1), ...many.map((n) => node(n))],
    edges: many.map((n) => edge(1, n)),
    hiddenCounts: {},
    lineages: [{ id: id(900), slug: 'demo-lineage', name: 'Demo Lineage', rootPersonId: id(1) }],
    truncated: false,
  };

  it('draws the pinned students beyond the first 12, and counts only the rest', () => {
    // 2..31 sort by name: 29, 30 and 31 are past the cap.
    const pinned = new Set([id(29), id(30), id(31)]);
    const { graph: capped, more } = capFanout(graph, FANOUT_SHOWN, pinned);
    const drawn = new Set(capped.edges.filter((e) => e.teacherId === id(1)).map((e) => e.studentId));
    for (const p of pinned) expect(drawn.has(p)).toBe(true);
    expect(drawn.size).toBe(FANOUT_SHOWN);
    expect(more.get(id(1))).toBe(30 - FANOUT_SHOWN);
  });

  it('draws every pinned student when there are more than 12 of them', () => {
    const pinned = new Set(many.slice(0, 20).map(id));
    const { graph: capped, more } = capFanout(graph, FANOUT_SHOWN, pinned);
    expect(capped.edges.filter((e) => e.teacherId === id(1))).toHaveLength(20);
    expect(more.get(id(1))).toBe(10);
  });

  it('gives M05\'s result with no pins', () => {
    expect(capFanout(graph, FANOUT_SHOWN, new Set())).toEqual(capFanout(graph));
  });
});

describe('withSummaryNodes (milestone M06: the summary node "and N more")', () => {
  const many = Array.from({ length: 30 }, (_, i) => i + 2);
  const graph: LineageGraphDto = {
    focusId: id(1),
    dataVersion: 'test',
    nodes: [node(1, 30), ...many.map((n) => node(n))],
    edges: many.map((n) => edge(1, n)),
    hiddenCounts: {},
    lineages: [{ id: id(900), slug: 'demo-lineage', name: 'Demo Lineage', rootPersonId: id(1) }],
    truncated: false,
  };

  it('adds one node and its pseudo-edge for a teacher whose drawn students reached the cap', () => {
    const { graph: capped, more } = capFanout(graph);
    const layout = toLayoutGraph(capped);
    const withMore = withSummaryNodes(layout, more);
    const added = withMore.nodes.filter((n) => isSummaryId(n.id));
    expect(added.map((n) => n.id)).toEqual([summaryIdOf(id(1))]);
    const pseudo = withMore.edges.filter((e) => isSummaryId(e.id));
    expect(pseudo).toHaveLength(1);
    expect(pseudo[0]).toMatchObject({ teacherId: id(1), studentId: summaryIdOf(id(1)), lineageId: id(900) });
    expect(summaryTeacherOf(pseudo[0]!.id)).toBe(id(1));
    expect(summaryTeacherOf(summaryIdOf(id(1)))).toBe(id(1));
    // The people and relationships are those of the capped graph, unchanged.
    expect(withMore.nodes.filter((n) => !isSummaryId(n.id))).toEqual(layout.nodes);
    expect(withMore.edges.filter((e) => !isSummaryId(e.id))).toEqual(layout.edges);
  });

  it('ranks the summary node in its teacher\'s students\' row, and orders it after them', () => {
    const { graph: capped, more } = capFanout(graph);
    const withMore = withSummaryNodes(toLayoutGraph(capped), more);
    const { ranks } = computeRanks(withMore);
    expect(ranks.get(summaryIdOf(id(1)))).toBe(ranks.get(id(1))! + 1);
    const order = modelOrder(indexGraph(withMore));
    expect(order.at(-1)).toBe(summaryIdOf(id(1)));
  });

  it('adds nothing where nothing is left out, or where fewer students than the cap are drawn', () => {
    const layout = toLayoutGraph(graph);
    expect(withSummaryNodes(layout, new Map())).toBe(layout);
    // A view that draws 3 of the 30 students (a down=0 view and its expansions keep only the button).
    const few = toLayoutGraph({ ...graph, nodes: graph.nodes.slice(0, 4), edges: graph.edges.slice(0, 3) });
    expect(withSummaryNodes(few, new Map([[id(1), 27]]))).toBe(few);
    // A teacher that is not in the graph, or a count of zero.
    expect(withSummaryNodes(layout, new Map([[id(77), 5]]))).toBe(layout);
    expect(withSummaryNodes(layout, new Map([[id(1), 0]]))).toBe(layout);
  });
});
