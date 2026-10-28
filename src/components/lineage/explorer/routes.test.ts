// The routes of descent a selection lights (routes.ts; milestone M06 In scope 3): two lineages, a
// shared ancestor, the cap of 5 routes, hidden ended training left out, the selected person's own
// ended training kept, the display-primary order (DEFAULT D05), and litFlow's object identity.

import { describe, expect, it } from 'vitest';

import type { Scene } from '@/lib/lineage-layout/types';
import type { LineageGraphDto } from '@/server/dto/public';
import { flowBase, selectFlow } from './explorer';
import { MAX_ROUTES, NO_ROUTES, routeList } from './route-list';
import { litFlow, litOf, NO_LIGHT } from './routes';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LINEAGE_A = id(900);
const LINEAGE_B = id(901);
const ENDED = [{ from: '1990', to: '1998', ongoing: false }];

interface Line {
  teacher: number;
  student: number;
  ended?: boolean;
  displayPrimary?: boolean;
  kind?: 'primary' | 'converging' | 'crossLineage';
  lineage?: string;
}

const edgeId = (line: Line) => id(10_000 + line.teacher * 100 + line.student);

/** A view of demo people 1..n with these lines, laid out one row per person (the layout does not matter here). */
function viewOf(count: number, lines: Line[], selected: number | null, showHistorical = false) {
  const people = Array.from({ length: count }, (_, i) => i + 1);
  const graph = {
    focusId: id(count),
    dataVersion: 'test',
    nodes: people.map((n) => ({
      id: id(n),
      slug: `demo-routes-${n}`,
      displayName: `Demo Person ${n}`,
      altNames: [],
      lifeStatus: 'living',
      claimState: 'unclaimed',
      lineageIds: [LINEAGE_A],
      childCount: 0,
      hasMoreChildren: false,
      visibility: 'public',
    })),
    edges: lines.map((line) => ({
      id: edgeId(line),
      teacherId: id(line.teacher),
      studentId: id(line.student),
      lineageId: line.lineage ?? LINEAGE_A,
      kind: line.kind ?? 'primary',
      status: 'verified',
      isDisplayPrimary: line.displayPrimary ?? true,
      visibility: 'public',
      periods: line.ended ? ENDED : [],
    })),
    lineages: [
      { id: LINEAGE_A, slug: 'demo-lineage-a', name: 'Demo Lineage A', rootPersonId: id(1) },
      { id: LINEAGE_B, slug: 'demo-lineage-b', name: 'Demo Lineage B', rootPersonId: null },
    ],
    hiddenCounts: {},
    truncated: false,
  } as unknown as LineageGraphDto;
  const box = (n: number) => ({ x: 0, y: n * 124, width: 200, height: 64 });
  const scene = {
    focusId: graph.focusId,
    dataVersion: 'test',
    nodes: people.map((n) => ({ id: id(n), rank: n, x: 0, y: n * 124, width: 200, height: 64, center: { x: 100, y: n * 124 + 32 }, boxes: { full: box(n), compact: box(n), dot: box(n) } })),
    edges: graph.edges.map((e) => ({ id: e.id, teacherId: e.teacherId, studentId: e.studentId, kind: e.kind, routedBy: 'elk', path: { type: 'orthogonal', points: [] } })),
  } as unknown as Scene;
  const base = flowBase(graph, scene, new Map(), showHistorical);
  const view = selectFlow(base, selected === null ? null : id(selected));
  const lit = litOf(view, graph, selected === null ? null : id(selected));
  return { graph, base, view, lit, routes: routeList(lit.routes, graph) };
}

const ids = (set: ReadonlySet<string>) => [...set].sort();
const people = (...ns: number[]) => ns.map(id).sort();
const routePeople = (routes: ReturnType<typeof routeList>) => routes.shown.map((r) => r.people.map((p) => Number(p.slice(-12))));

describe('litOf', () => {
  it('lights nothing without a selection', () => {
    const { lit } = viewOf(3, [{ teacher: 1, student: 2 }, { teacher: 2, student: 3 }], null);
    expect(lit).toBe(NO_LIGHT);
  });

  it('lights both routes of a person with teachers in two lineages, display-primary first', () => {
    // 1 → 2 → 5 in lineage A; 3 → 4 → 5 in lineage B (cross-lineage, not display-primary). 6 is a student of 5.
    const lines: Line[] = [
      { teacher: 3, student: 4, lineage: LINEAGE_B },
      { teacher: 4, student: 5, lineage: LINEAGE_B, kind: 'crossLineage', displayPrimary: false },
      { teacher: 1, student: 2 },
      { teacher: 2, student: 5 },
      { teacher: 5, student: 6 },
    ];
    const { lit, routes } = viewOf(6, lines, 5);
    expect(ids(lit.nodes)).toEqual(people(1, 2, 3, 4, 5));
    expect(ids(lit.edges)).toEqual(lines.slice(0, 4).map(edgeId).sort());
    // DEFAULT D05: the display-primary teacher's route first, though its line comes later in the answer.
    expect(routePeople(routes)).toEqual([
      [1, 2, 5],
      [3, 4, 5],
    ]);
    expect(routes.shown[0]!.edges).toEqual([edgeId(lines[2]!), edgeId(lines[3]!)]);
    expect(routes.total).toBe(2);
  });

  it('lights a shared ancestor once and keeps one route through each teacher', () => {
    // 1 → 2 → 4 and 1 → 3 → 4: one root, two routes.
    const lines: Line[] = [
      { teacher: 1, student: 2 },
      { teacher: 1, student: 3 },
      { teacher: 2, student: 4 },
      { teacher: 3, student: 4, kind: 'converging', displayPrimary: false },
    ];
    const { lit, routes } = viewOf(4, lines, 4);
    expect(ids(lit.nodes)).toEqual(people(1, 2, 3, 4));
    expect(lit.edges.size).toBe(4);
    expect(routePeople(routes)).toEqual([
      [1, 2, 4],
      [1, 3, 4],
    ]);
  });

  it('lists at most 5 routes, one through each own teacher first, and counts the rest', () => {
    // Person 10 has teachers 7, 8 and 9; each of them has teachers 1+2, 3+4 and 5+6: six routes.
    const lines: Line[] = [
      ...[1, 2].map((t) => ({ teacher: t, student: 7 })),
      ...[3, 4].map((t) => ({ teacher: t, student: 8 })),
      ...[5, 6].map((t) => ({ teacher: t, student: 9 })),
      { teacher: 7, student: 10 },
      { teacher: 8, student: 10, kind: 'converging' as const, displayPrimary: false },
      { teacher: 9, student: 10, kind: 'converging' as const, displayPrimary: false },
    ];
    const { lit, routes } = viewOf(10, lines, 10);
    expect(routes.total).toBe(6);
    expect(routes.shown).toHaveLength(MAX_ROUTES);
    // The first three routes go through each own teacher once, in D05 order.
    expect(routePeople(routes).slice(0, 3).map((r) => r[1])).toEqual([7, 8, 9]);
    // No route twice.
    expect(new Set(routes.shown.map((r) => r.edges.join(' '))).size).toBe(MAX_ROUTES);
    // Every person above 10 is lit, though one route is not listed.
    expect(lit.nodes.size).toBe(10);
  });

  it('leaves out ended training that is hidden, and keeps the selected person\'s own', () => {
    // 1 → 2 → 3 ongoing; 4 → 2 ended (hidden); 5 → 3 ended (the selected person's own: drawn).
    const lines: Line[] = [
      { teacher: 1, student: 2 },
      { teacher: 2, student: 3 },
      { teacher: 4, student: 2, ended: true, kind: 'converging', displayPrimary: false },
      { teacher: 5, student: 3, ended: true, kind: 'converging', displayPrimary: false },
    ];
    const { lit, view, routes } = viewOf(5, lines, 3);
    expect(view.edges.find((e) => e.id === edgeId(lines[3]!))!.hidden).toBe(false);
    expect(ids(lit.nodes)).toEqual(people(1, 2, 3, 5));
    expect(lit.edges.has(edgeId(lines[2]!))).toBe(false);
    expect(lit.edges.has(edgeId(lines[3]!))).toBe(true);
    expect(routePeople(routes)).toEqual([[1, 2, 3], [5, 3]]);
    // With show=historical the other ended line is drawn, and lit.
    const shown = viewOf(5, lines, 3, true);
    expect(ids(shown.lit.nodes)).toEqual(people(1, 2, 3, 4, 5));
    expect(shown.routes.total).toBe(3);
  });

  it('gives a selected person with no teacher drawn no route, and a hidden one no light', () => {
    const lines: Line[] = [{ teacher: 1, student: 2 }, { teacher: 3, student: 2, ended: true }, { teacher: 2, student: 4 }];
    const root = viewOf(4, lines, 1);
    expect(ids(root.lit.nodes)).toEqual(people(1));
    expect(root.routes).toEqual({ shown: [], total: 0 });
    expect(routeList(null, root.graph)).toBe(NO_ROUTES);
    // Person 3 is drawn only through an ended line: hidden until selected, so the view has no light for them.
    const { view, graph } = viewOf(4, lines, null);
    expect(view.nodes.find((n) => n.id === id(3))!.hidden).toBe(true);
    expect(litOf(view, graph, id(3))).toBe(NO_LIGHT);
  });
});

describe('litFlow', () => {
  const lines: Line[] = [
    { teacher: 1, student: 2 },
    { teacher: 2, student: 3 },
    { teacher: 2, student: 4 },
  ];

  it('gives new objects only to what a lit flag changes, the rest keeps its identity', () => {
    const { view, lit } = viewOf(4, lines, 3);
    const flow = litFlow(view, lit);
    expect(flow.nodes.filter((n, i) => n !== view.nodes[i]).map((n) => n.id)).toEqual([id(1), id(2), id(3)]);
    expect(flow.edges.filter((e, i) => e !== view.edges[i]).map((e) => e.id)).toEqual([edgeId(lines[0]!), edgeId(lines[1]!)]);
    expect(flow.nodes.filter((n) => n.data.lit).map((n) => n.id)).toEqual([id(1), id(2), id(3)]);
    expect(flow.edges.filter((e) => e.data?.lit).map((e) => e.id)).toEqual([edgeId(lines[0]!), edgeId(lines[1]!)]);
  });

  it('keeps the same flow when nothing is lit', () => {
    const { view } = viewOf(4, lines, null);
    expect(litFlow(view, NO_LIGHT)).toBe(view);
  });

  it('keeps one lit copy of a person lit by two selections in turn', () => {
    const { base, graph } = viewOf(4, lines, null);
    const first = selectFlow(base, id(3));
    const second = selectFlow(base, id(4));
    const a = litFlow(first, litOf(first, graph, id(3)));
    const b = litFlow(second, litOf(second, graph, id(4)));
    // Persons 1 and 2 and the line between them are lit by both: the same objects.
    expect(b.nodes[0]).toBe(a.nodes[0]);
    expect(b.nodes[1]).toBe(a.nodes[1]);
    expect(b.edges[0]).toBe(a.edges[0]);
    // Person 3 is no longer lit: back to the scene's own object.
    expect(b.nodes[2]).toBe(base.nodes[2]);
  });
});
