// The explorer's nodes and edges for React Flow (buildFlow; milestone M05): selecting a person
// shows their ended training, but the generation labels stay those of the view (graph-17). And
// egoPart, the phone's smaller person view cut from the desktop one for the skeleton (ci-webkit-2).

import { describe, expect, it } from 'vitest';

import type { Scene } from '@/lib/lineage-layout/types';
import { generationText } from '../generation';
import { buildFlow, egoPart } from './explorer';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LINEAGE = id(900);
const node = (n: number, name: string) => ({
  id: id(n),
  slug: `demo-${n}`,
  displayName: name,
  altNames: [],
  lifeStatus: 'living' as const,
  claimState: 'unclaimed' as const,
  lineageIds: [LINEAGE],
  childCount: 0,
  hasMoreChildren: false,
  visibility: 'public' as const,
});
const ENDED = [{ from: '1990', to: '1998', ongoing: false }];
const edge = (teacher: number, student: number, periods: { from: string | null; to: string | null; ongoing: boolean }[] = []) => ({
  id: id(1000 + teacher * 10 + student),
  teacherId: id(teacher),
  studentId: id(student),
  lineageId: LINEAGE,
  kind: 'primary' as const,
  status: 'verified' as const,
  isDisplayPrimary: true,
  visibility: 'public' as const,
  periods,
});

// Root -> Teacher is ended training (hidden by default); Teacher -> Student is ongoing.
const graph = {
  focusId: id(3),
  dataVersion: 'test',
  nodes: [node(1, 'Demo Root'), node(2, 'Demo Teacher'), node(3, 'Demo Student')],
  edges: [edge(1, 2, ENDED), edge(2, 3)],
  lineages: [{ id: LINEAGE, slug: 'demo-lineage-a', name: 'Demo Lineage A', rootPersonId: id(1) }],
  hiddenCounts: {},
} as unknown as Parameters<typeof buildFlow>[0];

const box = (rank: number) => ({ x: 0, y: rank * 124, width: 200, height: 64 });
const scene = {
  focusId: id(3),
  dataVersion: 'test',
  nodes: [1, 2, 3].map((n) => ({ id: id(n), rank: n - 1, x: 0, y: (n - 1) * 124, width: 200, height: 64, center: { x: 100, y: (n - 1) * 124 + 32 }, boxes: { full: box(n - 1), compact: box(n - 1), dot: box(n - 1) } })),
  edges: graph.edges.map((e) => ({ id: e.id, teacherId: e.teacherId, studentId: e.studentId, kind: 'primary', routedBy: 'elk', path: { type: 'orthogonal', points: [] } })),
} as unknown as Scene;

const labelOf = (flow: ReturnType<typeof buildFlow>, n: number) => {
  const label = flow.nodes.find((x) => x.id === id(n))!.data.generation;
  return label ? generationText(label) : null;
};

describe('buildFlow', () => {
  it('shows the selected person\'s ended training without changing any generation label', () => {
    const before = buildFlow(graph, scene, new Map(), false, null);
    const selected = buildFlow(graph, scene, new Map(), false, id(2));
    // Selecting the teacher draws the ended line to the root, and the root with it.
    expect(before.edges.find((e) => e.id === graph.edges[0]!.id)!.hidden).toBe(true);
    expect(selected.edges.find((e) => e.id === graph.edges[0]!.id)!.hidden).toBe(false);
    expect(selected.nodes.find((n) => n.id === id(1))!.hidden).toBe(false);
    // The labels are those of the view as drawn before the selection.
    expect(labelOf(before, 3)).toBe('1 generation below Demo Teacher in this view');
    expect(labelOf(selected, 3)).toBe('1 generation below Demo Teacher in this view');
    expect(labelOf(selected, 2)).toBe(labelOf(before, 2));
  });

  it('counts ended training in the labels with show=historical', () => {
    expect(labelOf(buildFlow(graph, scene, new Map(), true, null), 3)).toBe('Generation 3 from Demo Root');
  });
});

describe('egoPart', () => {
  // Four generations of teachers above the focus (5), two of students below it; 9 is a second
  // teacher of 7, a student of the focus. The desktop read holds all of them.
  const people = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const desktop = {
    ...graph,
    focusId: id(5),
    nodes: people.map((n) => node(n, `Demo Person ${n}`)),
    edges: [edge(1, 2), edge(2, 3), edge(3, 4), edge(4, 5), edge(5, 6), edge(5, 7), edge(9, 7), edge(6, 8)],
  } as unknown as Parameters<typeof egoPart>[0];
  const ids = (g: Parameters<typeof egoPart>[0]) => g.nodes.map((n) => n.id).sort();

  it('keeps the generations a phone reads (2 up, 1 down) and the links between them', () => {
    const phone = egoPart(desktop, 2, 1);
    expect(ids(phone)).toEqual([3, 4, 5, 6, 7].map(id).sort());
    expect(phone.edges.map((e) => [e.teacherId, e.studentId])).toEqual([
      [id(3), id(4)],
      [id(4), id(5)],
      [id(5), id(6)],
      [id(5), id(7)],
    ]);
  });

  it('walks up through teachers and down through students only, as the server does: not to a student\'s other teacher', () => {
    expect(ids(egoPart(desktop, 16, 2))).toEqual(ids(desktop).filter((n) => n !== id(9)));
  });

  it('leaves an answer without a focus as it is', () => {
    expect(egoPart({ ...desktop, focusId: null }, 2, 1)).toEqual({ ...desktop, focusId: null });
  });
});
