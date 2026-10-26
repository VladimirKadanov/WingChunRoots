// The generation label (plan §4.4, D22): "Generation N from {root}" only when the chain reaches
// the lineage root with every edge verified, otherwise "N generations below {name} in this view".

import { describe, expect, it } from 'vitest';

import { generationLabels, generationText } from './generation';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LINEAGE = id(900);
const node = (n: number, name: string) => ({
  id: id(n),
  slug: `demo-${n}`,
  displayName: name,
  altNames: [],
  lifeStatus: 'living',
  claimState: 'unclaimed' as const,
  lineageIds: [LINEAGE],
  childCount: 0,
  hasMoreChildren: false,
  visibility: 'public' as const,
});
const edge = (teacher: number, student: number, status: 'verified' | 'under_review' = 'verified', isDisplayPrimary = true) => ({
  id: id(1000 + teacher * 10 + student),
  teacherId: id(teacher),
  studentId: id(student),
  lineageId: LINEAGE,
  kind: 'primary' as const,
  status,
  isDisplayPrimary,
  visibility: 'public' as const,
  periods: [],
});
const lineage = (rootPersonId: string | null) => [{ id: LINEAGE, slug: 'demo-lineage-a', name: 'Demo Lineage A', rootPersonId }];

describe('generationLabels', () => {
  const nodes = [node(1, 'Demo Root'), node(2, 'Demo Teacher'), node(3, 'Demo Student')];

  it('counts generations from the lineage root when every edge is verified (the root is generation 1)', () => {
    const labels = generationLabels({ nodes, edges: [edge(1, 2), edge(2, 3)], lineages: lineage(id(1)) });
    expect(labels.get(id(1))).toBeUndefined();
    expect(generationText(labels.get(id(2))!)).toBe('Generation 2 from Demo Root');
    expect(generationText(labels.get(id(3))!)).toBe('Generation 3 from Demo Root');
  });

  it('says "generations below … in this view" when an edge on the chain is not verified', () => {
    const labels = generationLabels({ nodes, edges: [edge(1, 2, 'under_review'), edge(2, 3)], lineages: lineage(id(1)) });
    expect(generationText(labels.get(id(2))!)).toBe('1 generation below Demo Root in this view');
    expect(generationText(labels.get(id(3))!)).toBe('2 generations below Demo Root in this view');
  });

  it('says "generations below … in this view" when the view root is not the lineage root, or the root is unknown (DEFAULT D22)', () => {
    const view = { nodes: nodes.slice(1), edges: [edge(2, 3)] };
    expect(generationText(generationLabels({ ...view, lineages: lineage(id(1)) }).get(id(3))!)).toBe('1 generation below Demo Teacher in this view');
    expect(generationText(generationLabels({ ...view, lineages: lineage(null) }).get(id(3))!)).toBe('1 generation below Demo Teacher in this view');
    expect(generationLabels({ ...view, lineages: lineage(null) }).get(id(2))).toBeUndefined();
  });

  it('follows the display-primary teacher of a person with two teachers (DEFAULT D05)', () => {
    const two = [...nodes, node(4, 'Demo Second Teacher')];
    const labels = generationLabels({ nodes: two, edges: [edge(1, 2), edge(2, 3, 'verified', false), edge(4, 3, 'verified', true)], lineages: lineage(id(1)) });
    expect(generationText(labels.get(id(3))!)).toBe('1 generation below Demo Second Teacher in this view');
  });
});

describe('generationLabels across lineages', () => {
  it('gives no generation of a lineage to a chain that leaves it on the way to its root', () => {
    const OTHER = '00000000-0000-4000-8000-000000000902';
    const nodes = [node(1, 'Demo Root'), node(2, 'Demo Teacher'), node(3, 'Demo Student')];
    // Root -> Teacher in lineage A, Teacher -> Student in another lineage: the student is not a generation of A.
    const edges = [edge(1, 2), { ...edge(2, 3), lineageId: OTHER }];
    const lineages = [...lineage(id(1)), { id: OTHER, slug: 'demo-lineage-other', name: 'Demo Lineage Other', rootPersonId: null }];
    expect(generationText(generationLabels({ nodes, edges, lineages }).get(id(3))!)).toBe('2 generations below Demo Root in this view');
    expect(generationText(generationLabels({ nodes, edges, lineages }).get(id(2))!)).toBe('Generation 2 from Demo Root');
  });
});

describe('generationLabels for a teacher in two lineages (demo-two-lineages)', () => {
  // Root A -> Teacher A -> Instructor (lineage A, display-primary); Root B -> Teacher B -> Instructor
  // (lineage B); the instructor teaches one student in each lineage.
  const B = '00000000-0000-4000-8000-000000000902';
  const inB = <E extends { lineageId: string }>(e: E): E => ({ ...e, lineageId: B });
  const nodes = [
    node(1, 'Demo Root A'),
    node(2, 'Demo Teacher A'),
    node(3, 'Demo Instructor'),
    node(4, 'Demo Student A'),
    node(5, 'Demo Root B'),
    node(6, 'Demo Teacher B'),
    node(7, 'Demo Student B'),
  ];
  const lineages = [...lineage(id(1)), { id: B, slug: 'demo-lineage-b', name: 'Demo Lineage B', rootPersonId: id(5) }];
  const edges = (teacherB: 'verified' | 'under_review' = 'verified') => [
    edge(1, 2),
    edge(2, 3),
    inB(edge(5, 6)),
    inB(edge(6, 3, teacherB, false)),
    edge(3, 4),
    inB(edge(3, 7)),
  ];

  it('counts a student of lineage B in lineage B, although the teacher\'s display-primary teacher is in lineage A', () => {
    const labels = generationLabels({ nodes, edges: edges(), lineages });
    expect(generationText(labels.get(id(3))!)).toBe('Generation 3 from Demo Root A');
    expect(generationText(labels.get(id(4))!)).toBe('Generation 4 from Demo Root A');
    expect(generationText(labels.get(id(7))!)).toBe('Generation 4 from Demo Root B');
    expect(generationText(labels.get(id(6))!)).toBe('Generation 2 from Demo Root B');
  });

  it('falls back to the display-primary chain in this view when the chain in lineage B is not verified', () => {
    const labels = generationLabels({ nodes, edges: edges('under_review'), lineages });
    expect(generationText(labels.get(id(7))!)).toBe('3 generations below Demo Root A in this view');
    expect(generationText(labels.get(id(4))!)).toBe('Generation 4 from Demo Root A');
  });
});
