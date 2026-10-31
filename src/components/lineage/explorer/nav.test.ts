// Moving between people with the arrow keys (nav.ts; milestone M06, package A): ↑ to the one
// teacher drawn or a chooser with two or more (display-primary first, DEFAULT D05), ↓ to the drawn
// student nearest in x, ← and → along the same rank without wrapping, the summary node "and N
// more" in the students' row, hidden people and lines skipped, and the reason a move has no target.

import { describe, expect, it } from 'vitest';

import type { Box } from '@/lib/lineage-layout/types';

import type { LineageEdge, PersonNode, SummaryNode } from './canvas';
import type { FlowNode } from './graph-api';
import { navigate, NO_TARGET } from './nav';

const ROW = 120;

function person(id: string, rank: number, x: number, options: { hidden?: boolean; totals?: { teachers: number; students: number } } = {}): PersonNode {
  const slot: Box = { x, y: rank * ROW, width: 200, height: 64 };
  return {
    id,
    type: 'person',
    position: { x, y: rank * ROW },
    width: 200,
    height: 64,
    hidden: options.hidden ?? false,
    data: {
      name: `Demo ${id}`,
      original: null,
      generation: null,
      status: null,
      disputed: false,
      teachers: 0,
      more: 0,
      rank,
      focus: false,
      root: false,
      mark: 'other',
      slot,
      boxes: { full: slot, compact: slot, dot: slot },
      slug: `demo-${id}`,
      totals: options.totals ?? { teachers: 0, students: 0 },
      drawn: { teachers: 0, students: 0 },
      teacherNames: [],
    },
  };
}

function summary(teacherId: string, rank: number, x: number): SummaryNode {
  const slot: Box = { x, y: rank * ROW, width: 200, height: 64 };
  return {
    id: `more:${teacherId}`,
    type: 'more',
    position: { x, y: rank * ROW },
    width: 200,
    height: 64,
    ariaLabel: `and 7 more students of Demo ${teacherId}`,
    data: { teacherId, name: `Demo ${teacherId}`, slug: `demo-${teacherId}`, more: 7, rank, slot, boxes: { full: slot, compact: slot, dot: slot } },
  };
}

function line(teacher: string, student: string, kind: 'primary' | 'converging' | 'crossLineage' = 'primary', hidden = false): LineageEdge {
  const slot: Box = { x: 0, y: 0, width: 200, height: 64 };
  return {
    id: `${teacher}->${student}`,
    type: 'lineage',
    source: teacher,
    target: student,
    hidden,
    data: {
      stroke: 'verified',
      kind,
      lineageId: 'lineage',
      routedBy: 'elk',
      path: { type: 'orthogonal', points: [] },
      label: null,
      historical: false,
      ends: { teacher: { full: slot, compact: slot, dot: slot }, student: { full: slot, compact: slot, dot: slot } },
    },
  };
}

const graph = (nodes: FlowNode[], edges: LineageEdge[]) => ({ nodes, edges });

describe('navigate: up', () => {
  it('moves to the one teacher drawn', () => {
    const g = graph([person('t', 0, 0), person('s', 1, 0)], [line('t', 's')]);
    expect(navigate(g, 's', 'up')).toEqual({ kind: 'move', id: 't' });
  });

  it('opens the chooser with two or more teachers drawn, display-primary first (DEFAULT D05), then across the row', () => {
    const g = graph(
      [person('a', 0, 0), person('b', 0, 300), person('c', 0, 600), person('s', 1, 300)],
      [line('c', 's', 'primary'), line('b', 's', 'crossLineage'), line('a', 's', 'converging')],
    );
    expect(navigate(g, 's', 'up')).toEqual({ kind: 'choose', ids: ['c', 'a', 'b'] });
  });

  it('lists a teacher with two lines into the person once', () => {
    const g = graph([person('a', 0, 0), person('b', 0, 300), person('s', 1, 0)], [line('a', 's', 'converging'), line('a', 's', 'primary'), line('b', 's', 'converging')]);
    expect(navigate(g, 's', 'up')).toEqual({ kind: 'choose', ids: ['a', 'b'] });
  });

  it('skips hidden lines and hidden teachers: one left is a move, not a choice', () => {
    const g = graph(
      [person('a', 0, 0), person('b', 0, 300), person('c', 0, 600, { hidden: true }), person('s', 1, 0)],
      [line('a', 's'), line('b', 's', 'converging', true), line('c', 's', 'converging')],
    );
    expect(navigate(g, 's', 'up')).toEqual({ kind: 'move', id: 'a' });
  });

  it('says why when no teacher is drawn, with the teachers the record has and the view does not draw', () => {
    expect(navigate(graph([person('r', 0, 0)], []), 'r', 'up')).toEqual({ kind: 'none', reason: NO_TARGET.teachers });
    expect(NO_TARGET.teachers).toBe('No teachers drawn in this view.');
    const top = person('s', 0, 0, { totals: { teachers: 2, students: 0 } });
    expect(navigate(graph([top], []), 's', 'up')).toEqual({ kind: 'none', reason: 'No teachers drawn in this view (+2 teachers).' });
    const one = person('s', 0, 0, { totals: { teachers: 1, students: 0 } });
    expect(navigate(graph([one], []), 's', 'up')).toEqual({ kind: 'none', reason: 'No teachers drawn in this view (+1 teacher).' });
  });

  it('goes from a summary node to its teacher', () => {
    const g = graph([person('t', 0, 0), person('s', 1, 0), summary('t', 1, 300)], [line('t', 's')]);
    expect(navigate(g, 'more:t', 'up')).toEqual({ kind: 'move', id: 't' });
  });
});

describe('navigate: down', () => {
  it('moves to the drawn student nearest in x', () => {
    const g = graph(
      [person('t', 0, 500), person('a', 1, 0), person('b', 1, 450), person('c', 1, 900)],
      [line('t', 'a'), line('t', 'b'), line('t', 'c')],
    );
    expect(navigate(g, 't', 'down')).toEqual({ kind: 'move', id: 'b' });
  });

  it('never moves to a person in the next row who is not a student, nor to a hidden student', () => {
    const g = graph(
      [person('t', 0, 500), person('other', 1, 500), person('hidden', 1, 520, { hidden: true }), person('far', 1, 1500)],
      [line('t', 'hidden'), line('t', 'far')],
    );
    expect(navigate(g, 't', 'down')).toEqual({ kind: 'move', id: 'far' });
  });

  it('reaches the summary node in the students\' row', () => {
    const g = graph([person('t', 0, 900), person('a', 1, 0), summary('t', 1, 900)], [line('t', 'a')]);
    expect(navigate(g, 't', 'down')).toEqual({ kind: 'move', id: 'more:t' });
  });

  it('says why when no student is drawn', () => {
    expect(navigate(graph([person('s', 0, 0)], []), 's', 'down')).toEqual({ kind: 'none', reason: NO_TARGET.students });
    expect(NO_TARGET.students).toBe('No students drawn in this view.');
    const many = person('t', 0, 0, { totals: { teachers: 0, students: 14 } });
    expect(navigate(graph([many], []), 't', 'down')).toEqual({ kind: 'none', reason: 'No students drawn in this view (+14 students).' });
    const g = graph([person('t', 0, 0), summary('t', 1, 0)], []);
    expect(navigate(g, 'more:t', 'down')).toEqual({ kind: 'none', reason: NO_TARGET.students });
  });
});

describe('navigate: left and right', () => {
  const row = graph(
    [person('t', 0, 300), person('a', 1, 0), person('b', 1, 300), person('c', 1, 600), person('h', 1, 450, { hidden: true }), summary('t', 1, 900), person('g', 2, 310)],
    [line('t', 'a'), line('t', 'b'), line('t', 'c'), line('b', 'g')],
  );

  it('moves to the nearest person in the same rank, skipping hidden ones', () => {
    expect(navigate(row, 'b', 'right')).toEqual({ kind: 'move', id: 'c' });
    expect(navigate(row, 'b', 'left')).toEqual({ kind: 'move', id: 'a' });
    expect(navigate(row, 'g', 'left')).toEqual({ kind: 'none', reason: NO_TARGET.first });
  });

  it('has the summary node in the row', () => {
    expect(navigate(row, 'c', 'right')).toEqual({ kind: 'move', id: 'more:t' });
    expect(navigate(row, 'more:t', 'left')).toEqual({ kind: 'move', id: 'c' });
  });

  it('does not wrap at either end, and says so', () => {
    expect(navigate(row, 'a', 'left')).toEqual({ kind: 'none', reason: 'First in this row.' });
    expect(navigate(row, 'more:t', 'right')).toEqual({ kind: 'none', reason: 'Last in this row.' });
    expect(navigate(row, 't', 'right')).toEqual({ kind: 'none', reason: NO_TARGET.last });
  });
});

describe('navigate: from a node not drawn', () => {
  it('goes nowhere and says nothing', () => {
    expect(navigate(graph([person('h', 0, 0, { hidden: true })], []), 'h', 'up')).toEqual({ kind: 'none', reason: '' });
    expect(navigate(graph([], []), 'missing', 'down')).toEqual({ kind: 'none', reason: '' });
  });
});
