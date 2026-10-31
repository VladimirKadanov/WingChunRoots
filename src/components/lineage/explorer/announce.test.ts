// What the live region says (announce.ts; milestone M06, package A): "{name}. {Status}. {T}
// teachers, {S} students. {generation label}." with the record's totals, one and many, the
// generation label of DEFAULT D22 in both its forms, the card's words for a person without a
// status, a summary node's name; and the announcer: a key move after a short quiet (the last of a
// burst only), a notice at once in place of a move still waiting.

import { describe, expect, it } from 'vitest';

import type { Box } from '@/lib/lineage-layout/types';

import { announce, createAnnouncer } from './announce';
import type { PersonNode, PersonNodeData, SummaryNode } from './canvas';

const slot: Box = { x: 0, y: 0, width: 200, height: 64 };

function person(data: Partial<PersonNodeData>): PersonNode {
  return {
    id: 'p',
    type: 'person',
    position: { x: 0, y: 0 },
    data: {
      name: 'Demo Person',
      original: null,
      generation: null,
      status: null,
      disputed: false,
      teachers: 0,
      more: 0,
      rank: 0,
      focus: false,
      root: false,
      mark: 'other',
      slot,
      boxes: { full: slot, compact: slot, dot: slot },
      slug: 'demo-person',
      totals: { teachers: 0, students: 0 },
      drawn: { teachers: 0, students: 0 },
      teacherNames: [],
      ...data,
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('announce', () => {
  it('says the name, the status, the totals in the record and the generation label', () => {
    const node = person({
      status: { kind: 'verified', label: 'Verified' },
      totals: { teachers: 2, students: 14 },
      generation: { kind: 'lineage', generation: 3, rootId: 'r', rootName: 'Demo Root', lineageName: 'Demo Lineage' },
    });
    expect(announce(node)).toBe('Demo Person. Verified. 2 teachers, 14 students. Generation 3 from Demo Root.');
  });

  it('counts one and many', () => {
    const node = person({ status: { kind: 'unconfirmed', label: 'Pending' }, totals: { teachers: 1, students: 1 } });
    expect(announce(node)).toBe('Demo Person. Pending. 1 teacher, 1 student.');
    expect(announce(person({ status: { kind: 'verified', label: 'Verified' }, totals: { teachers: 0, students: 0 } }))).toContain('0 teachers, 0 students.');
  });

  it('uses the view form of the generation label where the chain does not reach the lineage root (DEFAULT D22)', () => {
    const one = person({ status: { kind: 'verified', label: 'Verified' }, generation: { kind: 'view', below: 1, anchorId: 'a', anchorName: 'Demo Anchor' } });
    expect(announce(one)).toBe('Demo Person. Verified. 0 teachers, 0 students. 1 generation below Demo Anchor in this view.');
    const two = person({ status: { kind: 'verified', label: 'Verified' }, generation: { kind: 'view', below: 2, anchorId: 'a', anchorName: 'Demo Anchor' } });
    expect(announce(two)).toMatch(/ 2 generations below Demo Anchor in this view\.$/);
  });

  it('reads a person without a status edge as the card does', () => {
    expect(announce(person({ root: true, totals: { teachers: 0, students: 3 } }))).toBe('Demo Person. Root of this lineage. 0 teachers, 3 students.');
    expect(announce(person({ root: false, totals: { teachers: 1, students: 3 } }))).toBe('Demo Person. Top of this view. 1 teacher, 3 students.');
  });

  it('says a summary node by its name', () => {
    const node: SummaryNode = {
      id: 'more:t',
      type: 'more',
      position: { x: 0, y: 0 },
      ariaLabel: 'and 7 more students of Demo Teacher',
      data: { teacherId: 't', name: 'Demo Teacher', slug: 'demo-teacher', more: 7, rank: 1, slot, boxes: { full: slot, compact: slot, dot: slot } },
    };
    expect(announce(node)).toBe('and 7 more students of Demo Teacher.');
  });
});

describe('createAnnouncer', () => {
  it('speaks a key move after the quiet, and only the last of a burst', async () => {
    const said: string[] = [];
    const announcer = createAnnouncer((text) => said.push(text), 20);
    announcer.move('first');
    announcer.move('second');
    announcer.move('third');
    expect(said).toEqual([]);
    await sleep(60);
    expect(said).toEqual(['third']);
    announcer.dispose();
  });

  it('speaks a notice at once, in place of a move still waiting', async () => {
    const said: string[] = [];
    const announcer = createAnnouncer((text) => said.push(text), 20);
    announcer.move('moved');
    announcer.notice('Added 12 students of Demo Teacher.');
    expect(said).toEqual(['Added 12 students of Demo Teacher.']);
    await sleep(60);
    expect(said).toEqual(['Added 12 students of Demo Teacher.']);
    announcer.dispose();
  });

  it('drops a move still waiting when disposed', async () => {
    const said: string[] = [];
    const announcer = createAnnouncer((text) => said.push(text), 20);
    announcer.move('moved');
    announcer.dispose();
    await sleep(60);
    expect(said).toEqual([]);
  });
});
