import { describe, expect, it } from 'vitest';

import type { LineageEdgeDto, LineageGraphDto, LineageNodeDto } from '@/server/dto/public';
import { outlineIntro, outlineSummary } from './descendants-outline';

const uuid = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

function node(n: number, childCount: number, visibility: 'public' | 'involved_only' = 'public'): LineageNodeDto {
  return {
    id: uuid(n),
    slug: `demo-outline-${n}`,
    displayName: `Outline ${n} Notreal`,
    altNames: [],
    lifeStatus: 'living',
    claimState: 'unclaimed',
    lineageIds: [],
    childCount,
    hasMoreChildren: false,
    visibility,
  };
}

function edge(teacher: number, student: number, visibility: 'public' | 'involved_only' = 'public'): LineageEdgeDto {
  return {
    id: uuid(1000 + teacher * 100 + student),
    teacherId: uuid(teacher),
    studentId: uuid(student),
    lineageId: uuid(999),
    kind: 'primary',
    status: visibility === 'public' ? 'verified' : 'pending_teacher',
    isDisplayPrimary: true,
    visibility,
    periods: [],
  };
}

const graph = (nodes: LineageNodeDto[], edges: LineageEdgeDto[]): LineageGraphDto => ({
  focusId: uuid(1),
  dataVersion: 'test',
  nodes,
  edges,
  hiddenCounts: {},
  lineages: [],
  truncated: false,
});

describe('outlineSummary and outlineIntro (the list view: students who teach)', () => {
  it('counts the public students who teach and every row the outline lists', () => {
    // 2 teaches (public), 3 does not; 4 has only the viewer's own request below them.
    const g = graph([node(1, 3), node(2, 1), node(3, 0), node(4, 0), node(5, 0), node(6, 0)], [edge(1, 2), edge(1, 3), edge(1, 4), edge(2, 5), edge(4, 6, 'involved_only')]);
    expect(outlineSummary(g, uuid(1), true)).toEqual({ listed: 2, shown: 1, total: 3 });
    expect(outlineSummary(g, uuid(1), false)).toEqual({ listed: 3, shown: 3, total: 3 });
    expect(outlineIntro({ listed: 2, shown: 1, total: 3 })).toMatch(/^1 of 3 students teach; each is listed/);
    expect(outlineIntro({ listed: 3, shown: 3, total: 3 })).toMatch(/^Every student here has students of their own; /);
  });

  it('lists a row that only the viewer’s own request puts there, with no count in the sentence', () => {
    // No public student teaches; 2's only student is the viewer's own request.
    const g = graph([node(1, 1), node(2, 0), node(3, 0, 'involved_only')], [edge(1, 2), edge(2, 3, 'involved_only')]);
    const summary = outlineSummary(g, uuid(1), true);
    expect(summary).toEqual({ listed: 1, shown: 0, total: 1 });
    expect(outlineIntro(summary)).toMatch(/^Each person is listed with their students/);
    expect(outlineIntro(summary)).not.toMatch(/\d/);
  });
});
