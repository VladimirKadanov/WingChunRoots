// The lineage names over the columns and the generation rails beside them (owner decision
// 2026-10-31, the Ink Lineage direction): columnMarks reads both from the scene's bands and the
// cards' generation labels (D22: read from the view, never stored).

import { describe, expect, it } from 'vitest';

import type { Box, Scene } from '@/lib/lineage-layout/types';
import type { GenerationLabel } from '../generation';
import { columnMarks, type PersonNode } from './canvas';

const SLOT = { width: 200, height: 64 };
const box = (x: number, y: number): Box => ({ x, y, ...SLOT });

function person(id: string, rank: number, x: number, extra: { generation?: GenerationLabel | null; root?: boolean; hidden?: boolean } = {}): PersonNode {
  const y = rank * 160;
  const slot = box(x, y);
  return {
    id,
    type: 'person',
    position: { x, y },
    hidden: extra.hidden ?? false,
    data: {
      name: `Demo ${id}`,
      original: null,
      generation: extra.generation ?? null,
      status: null,
      disputed: false,
      teachers: 0,
      more: 0,
      rank,
      focus: false,
      root: extra.root ?? false,
      mark: extra.root ? 'founder' : 'other',
      slot,
      boxes: { full: slot, compact: slot, dot: slot },
      slug: `demo-${id}`,
      totals: { teachers: 0, students: 0 },
      drawn: { teachers: 0, students: 0 },
      teacherNames: [],
    },
  };
}

const gen = (generation: number, rootId: string): GenerationLabel => ({ kind: 'lineage', generation, rootId, rootName: `Demo ${rootId}`, lineageName: 'Demo Lineage' });

function scene(bands: Scene['bands']): Scene {
  return { version: 1, focusId: null, width: 1000, height: 600, nodes: [], edges: [], bands } as unknown as Scene;
}

describe('columnMarks', () => {
  const bands: Scene['bands'] = [
    { lineageId: 'la', x: 0, width: 424, nodes: 4 },
    { lineageId: 'lb', x: 520, width: 200, nodes: 2 },
  ];
  const names = new Map([
    ['la', 'Demo Lineage A'],
    ['lb', 'Demo Lineage B'],
  ]);

  it('names each column above the top row when there are two or more, and numbers the rows that agree', () => {
    const nodes = [
      person('ra', 0, 0, { root: true }),
      person('a1', 1, 0, { generation: gen(2, 'ra') }),
      person('a2', 1, 224, { generation: gen(2, 'ra') }),
      person('a3', 2, 0, { generation: gen(3, 'ra') }),
      person('rb', 0, 520, { root: true }),
      person('b1', 2, 520, { generation: gen(3, 'rb') }),
    ];
    const marks = columnMarks(scene(bands), nodes, names);
    expect(marks.headers).toEqual([
      { lineageId: 'la', name: 'Demo Lineage A', x: 0, y: 0, width: 424 },
      { lineageId: 'lb', name: 'Demo Lineage B', x: 520, y: 0, width: 200 },
    ]);
    expect(marks.rails).toEqual([
      { lineageId: 'la', x: 0, rows: [{ y: 32, generation: 1 }, { y: 192, generation: 2 }, { y: 352, generation: 3 }] },
      // Generation 3 two rows below its root: the number is the label's, not the row's.
      { lineageId: 'lb', x: 520, rows: [{ y: 32, generation: 1 }, { y: 352, generation: 3 }] },
    ]);
  });

  it('leaves a row blank where its people disagree or one has no generation in the lineage, and names no single column', () => {
    const nodes = [
      person('ra', 0, 0, { root: true }),
      person('a1', 1, 0, { generation: gen(2, 'ra') }),
      person('a2', 1, 224, { generation: { kind: 'view', below: 1, anchorId: 'ra', anchorName: 'Demo ra' } }),
      person('a3', 2, 0, { generation: gen(3, 'ra') }),
      person('a4', 2, 224, { generation: gen(4, 'ra') }),
      // Hidden people are not drawn and do not count.
      person('a5', 2, 224, { generation: gen(9, 'ra'), hidden: true }),
    ];
    const marks = columnMarks(scene([bands[0]!]), nodes, names);
    expect(marks.headers).toEqual([]);
    expect(marks.rails).toEqual([{ lineageId: 'la', x: 0, rows: [{ y: 32, generation: 1 }] }]);
  });

  it('numbers no row of a column whose rows count from different roots, and names no column without a known name', () => {
    const nodes = [
      person('a1', 1, 0, { generation: gen(2, 'ra') }),
      person('a3', 2, 0, { generation: gen(2, 'rc') }),
      person('b1', 1, 520, { generation: gen(5, 'rb') }),
    ];
    const marks = columnMarks(scene(bands), nodes, new Map([['lb', 'Demo Lineage B']]));
    expect(marks.headers.map((h) => h.lineageId)).toEqual(['lb']);
    expect(marks.rails).toEqual([{ lineageId: 'lb', x: 520, rows: [{ y: 192, generation: 5 }] }]);
  });
});
