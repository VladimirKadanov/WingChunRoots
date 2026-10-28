// The summary nodes "and N more" (canvas.tsx summaryNodes; milestone M06, package F): a
// `more:<teacherId>` scene node becomes a node of its own, named after its teacher and with the
// teacher's count of students not drawn: a plain button, never selected, one of the graph's
// many stops (roving tabindex).

import { describe, expect, it } from 'vitest';

import type { Scene } from '@/lib/lineage-layout/types';

import { type PersonNode, summaryNodes } from './canvas';

const box = { x: 240, y: 124, width: 200, height: 64 };
const sceneNode = (id: string) => ({ id, rank: 1, ...box, center: { x: 340, y: 156 }, boxes: { full: box, compact: box, dot: box } });
const teacher = { id: 't', data: { name: 'Demo Teacher', slug: 'demo-teacher', more: 5 } } as unknown as PersonNode;

describe('summaryNodes', () => {
  it('makes a summary node of every `more:` scene node, and of nothing else', () => {
    const scene = { focusId: 't', dataVersion: 'test', nodes: [sceneNode('t'), sceneNode('more:t')], edges: [] } as unknown as Scene;
    const [more, ...rest] = summaryNodes(scene, [teacher]);
    expect(rest).toEqual([]);
    expect(more).toMatchObject({
      id: 'more:t',
      type: 'more',
      position: { x: 240, y: 124 },
      selectable: false,
      draggable: false,
      ariaRole: 'button',
      ariaLabel: 'and 5 more students of Demo Teacher',
      data: { teacherId: 't', name: 'Demo Teacher', slug: 'demo-teacher', more: 5, rank: 1 },
    });
    // Described by what it opens (relations.ts summaryText), in a hidden element of the node's view.
    expect(more!.domAttributes).toEqual({ tabIndex: -1, 'aria-roledescription': undefined, 'aria-describedby': 'rel-more:t' });
  });

  it('says "student" for one left out', () => {
    const scene = { focusId: 't', dataVersion: 'test', nodes: [sceneNode('t'), sceneNode('more:t')], edges: [] } as unknown as Scene;
    const one = { id: 't', data: { name: 'Demo Teacher', slug: 'demo-teacher', more: 1 } } as unknown as PersonNode;
    expect(summaryNodes(scene, [one])[0]!.ariaLabel).toBe('and 1 more student of Demo Teacher');
  });

  it('is empty for a scene without summary nodes', () => {
    expect(summaryNodes({ focusId: 't', dataVersion: 'test', nodes: [sceneNode('t')], edges: [] } as unknown as Scene, [teacher])).toEqual([]);
  });
});
