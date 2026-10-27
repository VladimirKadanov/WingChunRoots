// Expanding the view (plan §4.8; milestone M06, package C): the read of an expansion, the merge by
// id, the record check, when expansions are dropped, and the words said once they are drawn.

import { describe, expect, it } from 'vitest';

import type { Scene } from '@/lib/lineage-layout/types';
import type { LineageGraphDto } from '@/server/dto/public';

import { expandInput, expansionWords, keepsExpansions, mergeExpansion, positionsOf, sameRecord } from './expand';
import { capFanout, FANOUT_SHOWN } from './state';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LINEAGE = id(900);
const node = (n: number, childCount = 0) => ({
  id: id(n),
  slug: `demo-${n}`,
  displayName: `Demo Person ${String(n).padStart(3, '0')}`,
  altNames: [],
  lifeStatus: 'living',
  claimState: 'unclaimed' as const,
  lineageIds: [LINEAGE],
  childCount,
  hasMoreChildren: false,
  visibility: 'public' as const,
});
const edge = (teacher: number, student: number) => ({
  id: id(10_000 + teacher * 1000 + student),
  teacherId: id(teacher),
  studentId: id(student),
  lineageId: LINEAGE,
  kind: 'primary' as const,
  status: 'verified' as const,
  isDisplayPrimary: true,
  visibility: 'public' as const,
  periods: [],
});
const lineage = (n: number, name: string) => ({ id: id(n), slug: `demo-lineage-${n}`, name, rootPersonId: null });

// The view: 1 teaches 2; 2 has 3 students (none in the view) and one more teacher (5) the read
// left out; 1 has one teacher the read left out.
const view: LineageGraphDto = {
  focusId: id(2),
  dataVersion: 'view',
  nodes: [node(1, 1), { ...node(2, 3), hasMoreChildren: true }],
  edges: [edge(1, 2)],
  hiddenCounts: { [id(1)]: { teachers: 1, students: 0 }, [id(2)]: { teachers: 1, students: 3 } },
  lineages: [lineage(900, 'Demo Lineage B')],
  truncated: false,
};

// The expansion of 2's students (up 0, down 1): 2 and its three students, one of them with students of its own.
const students: LineageGraphDto = {
  focusId: id(2),
  dataVersion: 'students',
  nodes: [{ ...node(2, 3), hasMoreChildren: false }, node(3), node(4, 2), node(6)],
  edges: [edge(2, 3), edge(2, 4), edge(2, 6)],
  hiddenCounts: { [id(2)]: { teachers: 2, students: 0 }, [id(4)]: { teachers: 0, students: 2 } },
  lineages: [lineage(900, 'Demo Lineage B'), lineage(901, 'Demo Lineage A')],
  truncated: false,
};

describe('expandInput', () => {
  it('reads one generation in the pressed direction only', () => {
    expect(expandInput(id(2), 'students')).toEqual({ focusId: id(2), up: 0, down: 1 });
    expect(expandInput(id(2), 'teachers')).toEqual({ focusId: id(2), up: 1, down: 0 });
  });
});

describe('mergeExpansion', () => {
  it('adds only the people and relationships the view does not hold, once', () => {
    const merged = mergeExpansion(view, students, id(2));
    expect(merged.nodes.map((n) => n.id)).toEqual([id(1), id(2), id(3), id(4), id(6)]);
    expect(merged.edges.map((e) => e.id)).toEqual([edge(1, 2).id, edge(2, 3).id, edge(2, 4).id, edge(2, 6).id]);
    // The view's own record of a person it held is kept.
    expect(merged.nodes[0]).toBe(view.nodes[0]);
    // The view's read stays the view's.
    expect(merged.focusId).toBe(view.focusId);
    expect(merged.dataVersion).toBe(view.dataVersion);
  });

  it('is idempotent: the same answer again changes nothing and gives back the same object', () => {
    const merged = mergeExpansion(view, students, id(2));
    expect(mergeExpansion(merged, students, id(2))).toBe(merged);
    // An answer with nothing new (the view itself) as well.
    expect(mergeExpansion(view, view, id(2))).toBe(view);
  });

  it('never holds a person or a relationship twice, whatever the order of expansions', () => {
    const teachers: LineageGraphDto = {
      ...students,
      dataVersion: 'teachers',
      nodes: [node(1, 1), node(2, 3), node(5, 1)],
      edges: [edge(1, 2), edge(5, 2)],
      hiddenCounts: { [id(1)]: { teachers: 1, students: 0 }, [id(2)]: { teachers: 0, students: 3 } },
    };
    for (const merged of [
      mergeExpansion(mergeExpansion(view, students, id(2)), teachers, id(2)),
      mergeExpansion(mergeExpansion(view, teachers, id(2)), students, id(2)),
    ]) {
      expect(new Set(merged.nodes.map((n) => n.id)).size).toBe(merged.nodes.length);
      expect(new Set(merged.edges.map((e) => e.id)).size).toBe(merged.edges.length);
      expect(merged.nodes).toHaveLength(6);
      expect(merged.edges).toHaveLength(5);
    }
  });

  it('counts what is still not shown again, as the server counts it, and updates hasMoreChildren', () => {
    const merged = mergeExpansion(view, students, id(2));
    // 2: every student shown; its teachers from the expansion's own count (2, neither read), one of them shown in the view.
    expect(merged.hiddenCounts[id(2)]).toEqual({ teachers: 1, students: 0 });
    expect(merged.nodes.find((n) => n.id === id(2))!.hasMoreChildren).toBe(false);
    // 4: new to the view, its students not read.
    expect(merged.hiddenCounts[id(4)]).toEqual({ teachers: 0, students: 2 });
    expect(merged.nodes.find((n) => n.id === id(4))!.hasMoreChildren).toBe(true);
    // 1: the view's count stays (1 teacher left out), its one student shown.
    expect(merged.hiddenCounts[id(1)]).toEqual({ teachers: 1, students: 0 });
    // Nobody with nothing left out has an entry.
    expect(merged.hiddenCounts[id(3)]).toBeUndefined();
  });

  it('never counts an involved_only relationship as shown (DEFAULT D03)', () => {
    const own: LineageGraphDto = {
      ...students,
      nodes: [node(2, 3), node(3), node(7)],
      edges: [edge(2, 3), { ...edge(2, 7), visibility: 'involved_only' as const, status: 'pending_teacher' as const }],
      hiddenCounts: { [id(2)]: { teachers: 2, students: 2 } },
    };
    const merged = mergeExpansion(view, own, id(2));
    expect(merged.edges.map((e) => e.studentId)).toContain(id(7));
    // 3 public students, one of them shown: the pending request is not one of them.
    expect(merged.hiddenCounts[id(2)]!.students).toBe(2);
  });

  it('joins the lineages in the server\'s order and keeps a truncated read truncated', () => {
    const merged = mergeExpansion(view, { ...students, truncated: true }, id(2));
    expect(merged.lineages.map((l) => l.name)).toEqual(['Demo Lineage A', 'Demo Lineage B']);
    expect(merged.truncated).toBe(true);
    expect(mergeExpansion({ ...view, truncated: true }, students, id(2)).truncated).toBe(true);
  });

  it('keeps every person drawn before an expansion when the cap is applied with them pinned', () => {
    // 1 has 20 students; the view read 12 of them (2..13). The expansion of 1's students reads all
    // 20, and those it adds (14..21) have students of their own: the cap alone would draw them first.
    const first = Array.from({ length: 12 }, (_, i) => i + 2);
    const rest = Array.from({ length: 8 }, (_, i) => i + 14);
    const narrow: LineageGraphDto = {
      ...view,
      focusId: id(1),
      nodes: [node(1, 20), ...first.map((n) => node(n))],
      edges: first.map((n) => edge(1, n)),
      hiddenCounts: { [id(1)]: { teachers: 0, students: 8 } },
    };
    const part: LineageGraphDto = {
      ...narrow,
      nodes: [node(1, 20), ...first.map((n) => node(n)), ...rest.map((n) => node(n, 1))],
      edges: [...first, ...rest].map((n) => edge(1, n)),
      hiddenCounts: Object.fromEntries(rest.map((n) => [id(n), { teachers: 0, students: 1 }])),
    };
    const merged = mergeExpansion(narrow, part, id(1));
    expect(merged.hiddenCounts[id(1)]).toBeUndefined();
    const drawnBefore = capFanout(narrow).graph.nodes.map((n) => n.id);
    const unpinned = new Set(capFanout(merged).graph.nodes.map((n) => n.id));
    expect(drawnBefore.every((p) => unpinned.has(p))).toBe(false);
    const { graph: capped, more } = capFanout(merged, FANOUT_SHOWN, new Set(drawnBefore));
    const pinned = new Set(capped.nodes.map((n) => n.id));
    for (const p of drawnBefore) expect(pinned.has(p)).toBe(true);
    expect(more.get(id(1))).toBe(rest.length);
  });
});

describe('sameRecord', () => {
  it('holds when the shared people and relationships read the same', () => {
    expect(sameRecord(view, students)).toBe(true);
    // Another dataVersion alone (each answer has its own) is no change of the record.
    expect(sameRecord(view, { ...view, dataVersion: 'other' })).toBe(true);
  });

  it('fails when a shared person or relationship changed', () => {
    expect(sameRecord(view, { ...students, nodes: [{ ...node(2, 4), hasMoreChildren: true }, ...students.nodes.slice(1)] })).toBe(false);
    expect(sameRecord(view, { ...view, nodes: [{ ...node(1, 1), displayName: 'Demo Person Renamed' }, view.nodes[1]!] })).toBe(false);
    expect(sameRecord(view, { ...view, edges: [{ ...edge(1, 2), status: 'in_arbitration' as const }] })).toBe(false);
    // A teacher of a shared person was added to the record (the view counted 2 teachers of 2).
    expect(sameRecord(view, { ...view, hiddenCounts: { ...view.hiddenCounts, [id(2)]: { teachers: 2, students: 3 } } })).toBe(false);
  });
});

describe('keepsExpansions', () => {
  it('keeps the expansions of the same read over the same answer', () => {
    expect(keepsExpansions({ key: 'a', version: 'v1' }, 'a', { dataVersion: 'v1' })).toBe(true);
    // No answer yet, or no expansion yet.
    expect(keepsExpansions({ key: 'a', version: 'v1' }, 'a', null)).toBe(true);
    expect(keepsExpansions({ key: 'a', version: null }, 'a', { dataVersion: 'v2' })).toBe(true);
  });

  it('drops them for another read, or a new answer to the same read (the record changed)', () => {
    expect(keepsExpansions({ key: 'a', version: 'v1' }, 'b', { dataVersion: 'v1' })).toBe(false);
    expect(keepsExpansions({ key: 'a', version: 'v1' }, 'a', { dataVersion: 'v2' })).toBe(false);
    expect(keepsExpansions({ key: 'a', version: null }, 'b', null)).toBe(false);
  });
});

describe('expansionWords', () => {
  const merged = mergeExpansion(view, students, id(2));

  it('says how many people each expansion added, one or more', () => {
    const added = new Set([id(3), id(4), id(6)]);
    expect(expansionWords([{ id: id(2), direction: 'students', name: 'Demo Person 002' }], merged, added)).toBe('Added 3 students of Demo Person 002.');
    expect(expansionWords([{ id: id(2), direction: 'students', name: 'Demo Person 002' }], merged, new Set([id(3)]))).toBe(
      'Added 1 student of Demo Person 002.',
    );
    expect(
      expansionWords(
        [
          { id: id(2), direction: 'students', name: 'Demo Person 002' },
          { id: id(2), direction: 'teachers', name: 'Demo Person 002' },
        ],
        merged,
        new Set([id(1), id(3)]),
      ),
    ).toBe('Added 1 student of Demo Person 002. Added 1 teacher of Demo Person 002.');
  });

  it('says that the rest are in the view when an expansion added nobody', () => {
    expect(expansionWords([{ id: id(2), direction: 'teachers', name: 'Demo Person 002' }], merged, new Set())).toBe(
      'Every teacher of Demo Person 002 on the record is in this view; ended training is drawn with Show ended training.',
    );
  });
});

describe('positionsOf', () => {
  it('gives the top left corner of every node of the scene, and nothing without a scene', () => {
    const scene = { nodes: [{ id: id(1), x: 10, y: 20 }, { id: id(2), x: 30, y: 144 }] } as unknown as Scene;
    expect(positionsOf(scene)).toEqual({ [id(1)]: { x: 10, y: 20 }, [id(2)]: { x: 30, y: 144 } });
    expect(positionsOf(null)).toEqual({});
  });
});
