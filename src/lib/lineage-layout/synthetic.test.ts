import { describe, expect, it } from 'vitest';
import { computeRanks } from './ranks.ts';
import {
  ANCHOR_SLUGS,
  DEFAULT_SEED,
  LINEAGES,
  anchorId,
  generateSyntheticLineage,
  isPublicEdge,
} from './testing/synthetic.ts';
import { expandStudents, standardViews } from './testing/views.ts';

describe('synthetic lineage generator', () => {
  const dataset = generateSyntheticLineage();
  const { graph } = dataset;

  it('is deterministic: the same seed gives the same graph, byte for byte', () => {
    const again = generateSyntheticLineage({ seed: DEFAULT_SEED });
    expect(JSON.stringify(again)).toBe(JSON.stringify(dataset));
    const other = generateSyntheticLineage({ seed: 7 });
    expect(JSON.stringify(generateSyntheticLineage({ seed: 7 }))).toBe(JSON.stringify(other));
    expect(JSON.stringify(other.graph)).not.toBe(JSON.stringify(graph));
  });

  it('has about 600 fictional people in 3 lineages, in the shape of plan §6.3', () => {
    expect(graph.nodes.length).toBeGreaterThanOrEqual(550);
    expect(graph.nodes.length).toBeLessThanOrEqual(650);
    const lineages = new Set(graph.edges.map((e) => e.lineageId));
    expect([...lineages].sort()).toEqual([LINEAGES.a, LINEAGES.b, LINEAGES.c]);
    for (const node of graph.nodes) {
      expect(node.displayName).toMatch(/^Demo /);
      expect(dataset.slugById[node.id]).toMatch(/^demo-/);
      expect(node).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          altNames: expect.any(Array),
          lifeStatus: expect.any(String),
          claimState: expect.any(String),
          lineageIds: expect.any(Array),
          childCount: expect.any(Number),
          hasMoreChildren: expect.any(Boolean),
        }),
      );
    }
    for (const edge of graph.edges) {
      expect(edge).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          teacherId: expect.any(String),
          studentId: expect.any(String),
          lineageId: expect.any(String),
          kind: expect.stringMatching(/^(primary|converging|crossLineage)$/),
          status: expect.any(String),
          isDisplayPrimary: expect.any(Boolean),
          visibility: expect.stringMatching(/^(public|involved_only)$/),
          periods: expect.any(Array),
        }),
      );
    }
    expect(graph.hiddenCounts).toEqual({});
  });

  it('has the anchor records of M01 under the same slugs', () => {
    for (const slug of ANCHOR_SLUGS) expect(dataset.idBySlug[slug]).toBeDefined();
    for (const slug of [
      'demo-root-a',
      'demo-root-b',
      'demo-shared-ancestor',
      'demo-two-lineages',
      'demo-converging',
      'demo-hub-a',
    ]) {
      expect(dataset.idBySlug[slug]).toBeDefined();
    }
  });

  it('has hubs with at least 120 students', () => {
    for (const slug of ['demo-hub-a', 'demo-hub-b'] as const) {
      const id = anchorId(dataset, slug);
      expect(graph.edges.filter((e) => e.teacherId === id).length).toBeGreaterThanOrEqual(120);
    }
  });

  it('has the shapes the anchors stand for', () => {
    const teachersOf = (id: string) => graph.edges.filter((e) => e.studentId === id);
    const shared = anchorId(dataset, 'demo-shared-ancestor');
    // demo-shared-ancestor teaches both lineage roots.
    expect(teachersOf(anchorId(dataset, 'demo-root-a')).map((e) => e.teacherId)).toEqual([shared]);
    expect(teachersOf(anchorId(dataset, 'demo-root-b')).map((e) => e.teacherId)).toEqual([shared]);
    // demo-two-lineages: two teachers in different lineages and a student in each lineage.
    const two = anchorId(dataset, 'demo-two-lineages');
    const twoTeachers = teachersOf(two);
    expect(new Set(twoTeachers.map((e) => e.lineageId)).size).toBe(2);
    expect(twoTeachers.some((e) => e.kind === 'crossLineage')).toBe(true);
    const twoStudents = graph.edges.filter((e) => e.teacherId === two);
    expect(new Set(twoStudents.map((e) => e.lineageId))).toEqual(new Set([LINEAGES.a, LINEAGES.b]));
    // demo-converging: two teachers in the same lineage.
    const convergingTeachers = teachersOf(anchorId(dataset, 'demo-converging'));
    expect(convergingTeachers.length).toBe(2);
    expect(new Set(convergingTeachers.map((e) => e.lineageId)).size).toBe(1);
    expect(convergingTeachers.map((e) => e.kind).sort()).toEqual(['converging', 'primary']);
  });

  it('has the mix of milestone M01: second teachers, other lineages, historical only', () => {
    const people = graph.nodes.length;
    const withSameLineageSecondTeacher = new Set(graph.edges.filter((e) => e.kind === 'converging').map((e) => e.studentId));
    const withOtherLineageTeacher = new Set(graph.edges.filter((e) => e.kind === 'crossLineage').map((e) => e.studentId));
    expect(withSameLineageSecondTeacher.size / people).toBeGreaterThanOrEqual(0.06);
    expect(withSameLineageSecondTeacher.size / people).toBeLessThanOrEqual(0.1);
    expect(withOtherLineageTeacher.size / people).toBeGreaterThanOrEqual(0.02);
    expect(withOtherLineageTeacher.size / people).toBeLessThanOrEqual(0.04);
    const historicalOnly = graph.nodes.filter((n) => {
      const incoming = graph.edges.filter((e) => e.studentId === n.id);
      return incoming.length > 0 && incoming.every((e) => e.periods.every((p) => !p.ongoing));
    });
    expect(historicalOnly.length / people).toBeGreaterThanOrEqual(0.01);
    expect(historicalOnly.length / people).toBeLessThanOrEqual(0.03 + 3 / people);
    const statuses = new Set(graph.edges.map((e) => e.status));
    for (const status of ['verified', 'pending_teacher', 'awaiting_claim', 'under_review', 'in_arbitration']) {
      expect(statuses).toContain(status);
    }
  });

  it('builds public views only: no pending, awaiting-claim or under-review relationship, not even as a count', () => {
    // Plan §6.2, §6.4, §4.14: an anonymous view reads v_public_edge only, and so do its counters.
    const hidden = graph.edges.filter((e) => !isPublicEdge(e));
    expect(hidden.length).toBeGreaterThan(0);
    const publicStudents = new Map<string, number>();
    for (const e of graph.edges.filter(isPublicEdge)) publicStudents.set(e.teacherId, (publicStudents.get(e.teacherId) ?? 0) + 1);
    for (const node of graph.nodes) expect(node.childCount, node.id).toBe(publicStudents.get(node.id) ?? 0);
    const hiddenIds = new Set(hidden.map((e) => e.id));
    for (const view of standardViews(dataset)) {
      expect(view.graph.edges.filter((e) => hiddenIds.has(e.id)), view.name).toEqual([]);
      for (const e of view.graph.edges) expect(isPublicEdge(e), `${view.name} ${e.id}`).toBe(true);
    }
    // Expanding a teacher of a pending student does not reveal that student.
    const pending = hidden[0]!;
    const base = standardViews(dataset).find((v) => v.graph.nodes.some((n) => n.id === pending.teacherId))!;
    const expanded = expandStudents(dataset, base.graph, pending.teacherId);
    expect(expanded.edges.some((e) => e.id === pending.id)).toBe(false);
  });

  it('is acyclic, so every person gets a rank', () => {
    const ranks = computeRanks(graph);
    expect(ranks.ranks.size).toBe(graph.nodes.length);
    expect(ranks.rankCount).toBeGreaterThanOrEqual(7);
  });
});
