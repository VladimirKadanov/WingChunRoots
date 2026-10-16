import { describe, expect, it } from 'vitest';
import { LineageCycleError, LineageInputError } from './errors.ts';
import { computeRanks } from './ranks.ts';
import { demoGraph } from './testing/build.ts';
import { rankRuleViolations } from './testing/checks.ts';
import { LINEAGE_FIXTURE_PATH, loadLineageFixture } from './testing/fixture.ts';
import { anchorId, generateSyntheticLineage } from './testing/synthetic.ts';
import { egoView, sharedAncestorView, standardViews } from './testing/views.ts';
import type { LineageGraph } from './types.ts';

const dataset = generateSyntheticLineage();
const views = standardViews(dataset);
/** fixtures/lineage-600.json from M01 (milestone item 1). */
const fixture = loadLineageFixture();

/** rank(student) > rank(teacher) for every edge, and every cut-off teacher one row above its highest student. */
function expectRankRule(graph: LineageGraph, name: string) {
  const result = computeRanks(graph);
  expect(result.ranks.size, name).toBe(graph.nodes.length);
  expect(rankRuleViolations(graph, result), name).toEqual([]);
  for (const id of result.cutOff) {
    const students = graph.edges.filter((e) => e.teacherId === id).map((e) => result.ranks.get(e.studentId)!);
    expect(result.ranks.get(id), `${name}: cut-off ${id}`).toBe(Math.min(...students) - 1);
  }
}

describe('computeRanks (plan §4.4)', () => {
  it('gives roots rank 0 and every student max(rank of its teachers) + 1', () => {
    const graph = demoGraph(
      ['r', 'a', 'b', 'c', 'd'],
      [
        ['r', 'a'],
        ['a', 'b'],
        ['r', 'c'],
        ['b', 'd'],
        ['c', 'd', 'converging'],
      ],
    );
    const { ranks, rankCount, cutOff } = computeRanks(graph);
    expect(Object.fromEntries(ranks)).toEqual({ r: 0, a: 1, b: 2, c: 1, d: 3 });
    expect(rankCount).toBe(4);
    expect(cutOff.size).toBe(0);
  });

  it('counts edges to a teacher from another lineage', () => {
    // x is a deep teacher of another lineage; s must sit below x, not just below a.
    const graph = demoGraph(
      ['r', 'a', 'p', 'q', 'x', 's'],
      [
        ['r', 'a'],
        ['r', 'p'],
        ['p', 'q'],
        ['q', 'x'],
        ['a', 's'],
        ['x', 's', 'crossLineage'],
      ],
    );
    const { ranks } = computeRanks(graph);
    expect(ranks.get('s')).toBe(ranks.get('x')! + 1);
    expect(rankRuleViolations(graph, computeRanks(graph))).toEqual([]);
  });

  it('puts a cut-off teacher exactly one row above its highest student, not on row 0', () => {
    // t comes from another lineage without its own teachers (hidden: 2 teachers).
    const graph = demoGraph(
      ['r', 'a', 'b', 'c', 't'],
      [
        ['r', 'a'],
        ['a', 'b'],
        ['b', 'c'],
        ['t', 'c', 'crossLineage'],
      ],
      { hidden: { t: { teachers: 2, students: 5 } } },
    );
    const result = computeRanks(graph);
    expect([...result.cutOff]).toEqual(['t']);
    expect(result.ranks.get('c')).toBe(3);
    expect(result.ranks.get('t')).toBe(2);
    expect(rankRuleViolations(graph, result)).toEqual([]);
  });

  it('uses the highest student (minimum rank) of a cut-off teacher with several students', () => {
    const graph = demoGraph(
      ['r', 'a', 'b', 'c', 't'],
      [
        ['r', 'a'],
        ['a', 'b'],
        ['b', 'c'],
        ['t', 'c', 'crossLineage'],
        ['t', 'b', 'crossLineage'],
      ],
      { hidden: { t: { teachers: 1, students: 0 } } },
    );
    const { ranks } = computeRanks(graph);
    expect(ranks.get('t')).toBe(Math.min(ranks.get('b')!, ranks.get('c')!) - 1);
  });

  it('shifts every rank when a cut-off teacher would land above row 0', () => {
    // u's only teacher is the cut-off t: u is 0 in step 1, so t becomes -1 and all shift.
    const graph = demoGraph(
      ['r', 'a', 't', 'u'],
      [
        ['r', 'a'],
        ['t', 'u', 'crossLineage'],
      ],
      { hidden: { t: { teachers: 1, students: 0 } } },
    );
    const { ranks, rankCount } = computeRanks(graph);
    expect(Object.fromEntries(ranks)).toEqual({ t: 0, u: 1, r: 1, a: 2 });
    expect(Math.min(...ranks.values())).toBe(0);
    expect(rankCount).toBe(3);
  });

  it('treats a node without visible or hidden teachers as a root, even with hidden students', () => {
    const graph = demoGraph(['r', 'a'], [['r', 'a']], { hidden: { r: { teachers: 0, students: 9 } } });
    const result = computeRanks(graph);
    expect(result.cutOff.size).toBe(0);
    expect(result.ranks.get('r')).toBe(0);
  });

  it('fails with a typed error, not a loop, for a cycle', () => {
    const graph = demoGraph(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'd'],
        ['d', 'b', 'converging'],
      ],
    );
    let caught: unknown;
    try {
      computeRanks(graph);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LineageCycleError);
    const cycle = (caught as LineageCycleError).cycle;
    expect((caught as LineageCycleError).code).toBe('CYCLE');
    expect(cycle[0]).toBe(cycle[cycle.length - 1]);
    expect(new Set(cycle)).toEqual(new Set(['b', 'c', 'd']));
  });

  it('fails with a typed error for a self-loop and for a cycle through a teacher from another lineage', () => {
    expect(() => computeRanks(demoGraph(['a'], [['a', 'a']]))).toThrow(LineageCycleError);
    expect(() =>
      computeRanks(
        demoGraph(
          ['a', 'b'],
          [
            ['a', 'b'],
            ['b', 'a', 'crossLineage'],
          ],
        ),
      ),
    ).toThrow(LineageCycleError);
  });

  it('fails with a typed error for duplicate people and unknown endpoints (one person, one node)', () => {
    const duplicate = demoGraph(['a', 'b'], [['a', 'b']]);
    duplicate.nodes.push({ ...duplicate.nodes[0]! });
    expect(() => computeRanks(duplicate)).toThrow(LineageInputError);
    expect(() => computeRanks(demoGraph(['a'], [['a', 'zz']]))).toThrow(LineageInputError);
  });

  it.each(views.map((v) => [v.name, v.graph] as const))(
    'keeps rank(student) > rank(teacher) for every edge in %s',
    (name, graph) => {
      expectRankRule(graph, name);
    },
  );

  it('has cut-off teachers in the one-lineage view and the 500-person view', () => {
    for (const name of ['lineage:demo-root-a', 'view-500']) {
      const view = views.find((v) => v.name === name)!;
      const result = computeRanks(view.graph);
      // Teachers from another lineage shown without their own teachers.
      const foreign = [...result.cutOff].filter((id) =>
        view.graph.edges.some((e) => e.teacherId === id && e.kind === 'crossLineage'),
      );
      expect(foreign.length).toBeGreaterThan(0);
    }
  });

  it('keeps the rank rule around demo-shared-ancestor (two lineage roots, one edge between their branches)', () => {
    const graph = sharedAncestorView(dataset);
    const id = (slug: Parameters<typeof anchorId>[1]) => anchorId(dataset, slug);
    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const slug of ['demo-shared-ancestor', 'demo-root-a', 'demo-root-b', 'demo-two-lineages'] as const) {
      expect(ids.has(id(slug))).toBe(true);
    }
    const result = computeRanks(graph);
    const { ranks } = result;
    expect(ranks.get(id('demo-shared-ancestor'))).toBe(0);
    expect(ranks.get(id('demo-root-a'))).toBe(1);
    expect(ranks.get(id('demo-root-b'))).toBe(1);
    // The edge from lineage B links the two branches and decides the rank of demo-two-lineages.
    const cross = graph.edges.find((e) => e.studentId === id('demo-two-lineages') && e.kind === 'crossLineage')!;
    const primary = graph.edges.find((e) => e.studentId === id('demo-two-lineages') && e.kind === 'primary')!;
    expect(cross).toBeDefined();
    expect(ranks.get(cross.teacherId)!).toBeGreaterThan(ranks.get(primary.teacherId)!);
    expect(ranks.get(id('demo-two-lineages'))).toBe(ranks.get(cross.teacherId)! + 1);
    expect(rankRuleViolations(graph, result)).toEqual([]);
  });
});

describe(`computeRanks on ${LINEAGE_FIXTURE_PATH} from M01`, () => {
  it('keeps rank(student) > rank(teacher) for every edge in every standard view of the fixture', () => {
    for (const view of standardViews(fixture)) expectRankRule(view.graph, view.name);
  });

  it('keeps the rank rule in the ego view of every person in the fixture', () => {
    for (const node of fixture.graph.nodes) expectRankRule(egoView(fixture, node.id), `ego:${node.id}`);
  });
});
