// The counts of a person's expand buttons (plan §4.8; milestone M06, package C).

import { describe, expect, it } from 'vitest';

import type { LineageGraphDto } from '@/server/dto/public';

import { countsInView, expandCounts } from './node-controls';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const node = (n: number, childCount = 0) => ({
  id: id(n),
  slug: `demo-${n}`,
  displayName: `Demo Person ${n}`,
  altNames: [],
  lifeStatus: 'living',
  claimState: 'unclaimed' as const,
  lineageIds: [id(900)],
  childCount,
  hasMoreChildren: false,
  visibility: 'public' as const,
});
const ENDED = [{ from: '1980', to: '1990', ongoing: false, precision: 'year' as const }];
const edge = (teacher: number, student: number, periods: typeof ENDED = []) => ({
  id: id(10_000 + teacher * 1000 + student),
  teacherId: id(teacher),
  studentId: id(student),
  lineageId: id(900),
  kind: 'primary' as const,
  status: 'verified' as const,
  isDisplayPrimary: true,
  visibility: 'public' as const,
  periods,
});

describe('expandCounts', () => {
  it('counts the students and teachers not drawn', () => {
    expect(expandCounts({ more: 0, totals: { teachers: 3, students: 5 }, drawn: { teachers: 1, students: 2 } })).toEqual({
      students: 3,
      teachers: 2,
      list: false,
    });
    expect(expandCounts({ more: 0, totals: { teachers: 1, students: 0 }, drawn: { teachers: 1, students: 0 } })).toEqual({
      students: 0,
      teachers: 0,
      list: false,
    });
  });

  it('opens the list beyond the cap, with the count of those the cap left out', () => {
    expect(expandCounts({ more: 117, totals: { teachers: 1, students: 129 }, drawn: { teachers: 1, students: 12 } })).toEqual({
      students: 117,
      teachers: 0,
      list: true,
    });
  });
});

describe('countsInView', () => {
  // 1 taught 2 long ago; 3 teaches 2; 2 teaches 4 and 5 (5's training ended); 2 has 4 students and one more teacher on the record.
  const graph: LineageGraphDto = {
    focusId: id(2),
    dataVersion: 'test',
    nodes: [node(1, 1), node(2, 4), node(3, 1), node(4), node(5)],
    edges: [edge(1, 2, ENDED), edge(3, 2), edge(2, 4), edge(2, 5, ENDED)],
    hiddenCounts: { [id(2)]: { teachers: 1, students: 2 } },
    lineages: [],
    truncated: false,
  };

  it('counts as the node does: ended training drawn only with show=historical', () => {
    expect(countsInView(graph, id(2), 0, false)).toEqual({ students: 3, teachers: 2, list: false });
    expect(countsInView(graph, id(2), 0, true)).toEqual({ students: 2, teachers: 1, list: false });
  });

  it('gives the list beyond the cap', () => {
    expect(countsInView(graph, id(2), 7, false)).toEqual({ students: 7, teachers: 2, list: true });
  });
});
