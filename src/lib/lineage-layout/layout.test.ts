import { describe, expect, it } from 'vitest';
import { buildElkGraph } from './elk-graph.ts';
import { LineageCycleError, LineageInputError } from './errors.ts';
import { indexGraph } from './graph.ts';
import { createElkEngine, layoutLineage, layoutLineageWithStats } from './layout.ts';
import { CHOSEN_NODE_PLACEMENT, NODE_SIZES } from './presets.ts';
import { computeRanks, computeRanksIndexed } from './ranks.ts';
import { demoGraph } from './testing/build.ts';
import {
  positionsOf,
  ranksWithSeveralY,
  rowOrderFlips,
  rowsIncrease,
  spineBends,
  yOrderViolations,
} from './testing/checks.ts';
import { LINEAGE_FIXTURE_PATH, loadLineageFixture } from './testing/fixture.ts';
import { EGO_ANCHORS, anchorId, generateSyntheticLineage, type LineageDataset } from './testing/synthetic.ts';
import { egoView, expandStudents, sharedAncestorView, standardViews } from './testing/views.ts';
import type { LayoutOptions, LineageGraph, NodePlacement, PresetName, Scene } from './types.ts';

const dataset = generateSyntheticLineage();
const views = standardViews(dataset);
/** fixtures/lineage-600.json from M01 (milestone item 1). */
const fixture = loadLineageFixture();

/** Every person is one node, every rank one row, and y follows the rank for every edge. */
function expectRowsFollowRanks(graph: LineageGraph, scene: Scene, name: string) {
  const ranks = computeRanks(graph);
  // Every person is exactly one node.
  expect(scene.nodes.length, name).toBe(graph.nodes.length);
  expect(new Set(scene.nodes.map((n) => n.id)), name).toEqual(new Set(graph.nodes.map((n) => n.id)));
  // ELK's layers are exactly our ranks: one row per rank, same rank → same y.
  for (const node of scene.nodes) expect(node.rank, name).toBe(ranks.ranks.get(node.id));
  expect(ranksWithSeveralY(scene), name).toEqual([]);
  expect(scene.rowY.length, name).toBe(ranks.rankCount);
  expect(rowsIncrease(scene), name).toBe(true);
  for (const node of scene.nodes) expect(node.y, name).toBe(scene.rowY[node.rank]);
  // y follows the rank for every edge, including edges to a teacher from another lineage.
  expect(yOrderViolations(scene), name).toEqual([]);
  expect(scene.edges.length, name).toBe(graph.edges.length);
}

/** The focus spine of the ego view of an anchor record is straight (chosen algorithm). */
async function expectStraightSpine(data: LineageDataset, slug: (typeof EGO_ANCHORS)[number]) {
  const graph = egoView(data, anchorId(data, slug));
  const scene = await layoutLineage(graph);
  expect(scene.nodePlacement).toBe(CHOSEN_NODE_PLACEMENT);
  const spineEdges = scene.edges.filter((e) => e.onSpine);
  expect(spineEdges.length, slug).toBe(scene.spine.length);
  for (const edge of spineEdges) {
    expect(edge.bends, `${slug} ${edge.id}`).toBe(0);
    // Straight down: one vertical segment from the teacher to the student.
    if (edge.path.type !== 'orthogonal') throw new Error('spine edges are routed by ELK');
    expect(edge.path.points.length, `${slug} ${edge.id}`).toBe(2);
    expect(edge.path.points[0]!.x, `${slug} ${edge.id}`).toBe(edge.path.points[1]!.x);
  }
  expect(spineBends(scene), slug).toBe(0);
}

describe('layoutLineage: rows follow the ranks', () => {
  it.each(views.map((v) => [v.name, v.graph] as const))('%s', async (name, graph) => {
    expectRowsFollowRanks(graph, await layoutLineage(graph), name);
  });
});

describe(`layoutLineage on ${LINEAGE_FIXTURE_PATH} from M01`, () => {
  it('keeps rows = ranks and y following the rank in every standard view of the fixture', async () => {
    const fixtureViews = standardViews(fixture);
    expect(fixtureViews.length).toBe(views.length);
    for (const view of fixtureViews) expectRowsFollowRanks(view.graph, await layoutLineage(view.graph), view.name);
  });

  it('keeps the focus spine free of bend points in the ego views of the fixture anchors (chosen algorithm)', async () => {
    for (const slug of EGO_ANCHORS) await expectStraightSpine(fixture, slug);
  });
});

describe('why the ranks are handed to ELK (plan §4.4)', () => {
  it('ELK LONGEST_PATH_SOURCE would not put demo-two-lineages below its teacher from another lineage', async () => {
    const graph = sharedAncestorView(dataset);
    const two = anchorId(dataset, 'demo-two-lineages');
    const cross = graph.edges.find((e) => e.studentId === two && e.kind === 'crossLineage')!;
    const index = indexGraph(graph);
    const { elkGraph } = buildElkGraph(index, computeRanksIndexed(index));
    elkGraph.layoutOptions = { ...elkGraph.layoutOptions, 'elk.layered.layering.strategy': 'LONGEST_PATH_SOURCE' };
    const laidOut = await createElkEngine().layout(elkGraph);
    const y = new Map((laidOut.children ?? []).map((c) => [c.id, c.y!]));
    // Without our ranks the student is not below its teacher from lineage B …
    expect(y.get(two)!).toBeLessThanOrEqual(y.get(cross.teacherId)!);
    // … with them (INTERACTIVE, y = rank × 200) it is.
    const scene = await layoutLineage(graph);
    const byId = new Map(scene.nodes.map((n) => [n.id, n]));
    expect(byId.get(two)!.y).toBeGreaterThan(byId.get(cross.teacherId)!.y);
  });
});

describe('layoutLineage: edges', () => {
  it('draws edges to a teacher from another lineage as Bézier curves, not routed by ELK', async () => {
    const graph = sharedAncestorView(dataset);
    const scene = await layoutLineage(graph);
    const cross = scene.edges.filter((e) => e.kind === 'crossLineage');
    expect(cross.length).toBeGreaterThan(0);
    const byId = new Map(scene.nodes.map((n) => [n.id, n]));
    for (const edge of cross) {
      expect(edge.routedBy).toBe('scene');
      expect(edge.path.type).toBe('bezier');
      if (edge.path.type !== 'bezier') continue;
      const teacher = byId.get(edge.teacherId)!;
      const student = byId.get(edge.studentId)!;
      // Side attachment points, vertically centred on the boxes.
      expect([teacher.x, teacher.x + teacher.width]).toContain(edge.path.start.x);
      expect(edge.path.start.y).toBe(teacher.center.y);
      expect([student.x, student.x + student.width]).toContain(edge.path.end.x);
      expect(edge.path.end.y).toBe(student.center.y);
      // The label point lies between the two ends.
      expect(edge.path.midpoint.y).toBeGreaterThan(edge.path.start.y);
      expect(edge.path.midpoint.y).toBeLessThan(edge.path.end.y);
    }
    for (const edge of scene.edges.filter((e) => e.kind !== 'crossLineage')) {
      expect(edge.routedBy).toBe('elk');
      expect(edge.path.type).toBe('orthogonal');
      if (edge.path.type !== 'orthogonal') continue;
      // Orthogonal: every segment is horizontal or vertical.
      const points = edge.path.points;
      expect(points.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        expect(a.x === b.x || a.y === b.y).toBe(true);
      }
    }
    // The scene bounds contain every curve.
    for (const edge of cross) {
      if (edge.path.type !== 'bezier') continue;
      for (const p of [edge.path.control1, edge.path.control2]) {
        expect(p.x).toBeGreaterThanOrEqual(scene.bounds.x);
        expect(p.x).toBeLessThanOrEqual(scene.bounds.x + scene.bounds.width);
      }
    }
  });

  it('gives each node boxes for the three levels of detail, centred on its slot', async () => {
    const scene = await layoutLineage(egoView(dataset, anchorId(dataset, 'demo-converging')), { nodeSize: 'compact' });
    for (const node of scene.nodes) {
      expect([node.width, node.height]).toEqual([NODE_SIZES.compact.width, NODE_SIZES.compact.height]);
      for (const level of ['full', 'compact', 'dot'] as const) {
        const box = node.boxes[level];
        expect([box.width, box.height]).toEqual([NODE_SIZES[level].width, NODE_SIZES[level].height]);
        expect(box.x + box.width / 2).toBeCloseTo(node.center.x, 5);
        expect(box.y + box.height / 2).toBeCloseTo(node.center.y, 5);
      }
    }
  });

  it.each(EGO_ANCHORS)(
    'keeps the focus spine free of bend points in the ego view of %s (chosen algorithm)',
    async (slug) => {
      await expectStraightSpine(dataset, slug);
    },
  );

  it('has a non-empty spine for the anchors below a root', async () => {
    for (const slug of ['demo-root-a', 'demo-root-b', 'demo-two-lineages', 'demo-converging', 'demo-hub-a'] as const) {
      const scene = await layoutLineage(egoView(dataset, anchorId(dataset, slug)));
      expect(scene.spine.length, slug).toBeGreaterThan(0);
    }
  });
});

describe('layoutLineage: determinism', () => {
  const graph = sharedAncestorView(dataset);
  const presets: PresetName[] = ['explorer', 'expand', 'print'];
  const placements: NodePlacement[] = ['NETWORK_SIMPLEX', 'BRANDES_KOEPF'];

  it.each(presets.flatMap((preset) => placements.map((placement) => [preset, placement] as const)))(
    'gives byte-for-byte identical output for the same input (%s, %s)',
    async (preset, nodePlacement) => {
      const base = await layoutLineage(graph);
      const options: LayoutOptions = { preset, nodePlacement };
      if (preset === 'expand') options.previousPositions = positionsOf(base);
      const first = JSON.stringify(await layoutLineage(graph, options, createElkEngine()));
      const second = JSON.stringify(await layoutLineage(graph, options, createElkEngine()));
      const shared = JSON.stringify(await layoutLineage(structuredClone(graph), options));
      const sharedAgain = JSON.stringify(await layoutLineage(structuredClone(graph), options));
      expect(second).toBe(first);
      expect(shared).toBe(first);
      expect(sharedAgain).toBe(first);
    },
  );

  it('does not depend on the order of the input arrays', async () => {
    const reversed: LineageGraph = { ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() };
    expect(JSON.stringify(await layoutLineage(reversed))).toBe(JSON.stringify(await layoutLineage(graph)));
  });

  it('print uses wider spacing than the explorer', async () => {
    const explorer = await layoutLineage(graph);
    const print = await layoutLineage(graph, { preset: 'print' });
    expect(print.rowY[1]! - print.rowY[0]!).toBeGreaterThan(explorer.rowY[1]! - explorer.rowY[0]!);
  });
});

describe('layoutLineage: errors and stats', () => {
  it('rejects a cyclic input with LineageCycleError', async () => {
    const graph = demoGraph(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'a', 'crossLineage'],
      ],
    );
    await expect(layoutLineage(graph)).rejects.toBeInstanceOf(LineageCycleError);
    await expect(layoutLineage(graph)).rejects.toMatchObject({ code: 'CYCLE' });
  });

  it('rejects unknown presets, node sizes and placements as invalid input', async () => {
    const graph = demoGraph(['r', 'a'], [['r', 'a']]);
    const bad: LayoutOptions[] = [
      { preset: 'constructor' as PresetName },
      { preset: 'bogus' as PresetName },
      { nodeSize: 'toString' as LayoutOptions['nodeSize'] },
      { nodePlacement: 'FOO' as NodePlacement },
    ];
    for (const options of bad) {
      await expect(layoutLineage(graph, options)).rejects.toBeInstanceOf(LineageInputError);
      await expect(layoutLineage(graph, options)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('rejects malformed graphs, options and previous positions as invalid input, not as an ELK failure', async () => {
    const graph = demoGraph(['r', 'a'], [['r', 'a']]);
    const badGraphs = [
      { ...graph, nodes: [null] },
      { ...graph, edges: [null] },
      { ...graph, nodes: [...graph.nodes, 'demo-x'] },
      { ...graph, hiddenCounts: 'demo' },
    ] as unknown as LineageGraph[];
    const badOptions = [
      null,
      'expand',
      { preset: 'expand', previousPositions: 'demo' },
      { preset: 'expand', previousPositions: { r: null } },
      { preset: 'expand', previousPositions: { r: { x: Number.NaN, y: 0 } } },
      { preset: 'expand', previousPositions: { r: { x: '10', y: 0 } } },
    ] as unknown as LayoutOptions[];
    for (const bad of badGraphs) {
      await expect(layoutLineage(bad)).rejects.toMatchObject({ name: 'LineageInputError', code: 'INVALID_INPUT' });
    }
    for (const options of badOptions) {
      await expect(layoutLineage(graph, options)).rejects.toMatchObject({ name: 'LineageInputError', code: 'INVALID_INPUT' });
    }
  });

  it('reads hidden counts and previous positions by own key only', async () => {
    const graph = demoGraph(['constructor', 'toString'], [['constructor', 'toString']]);
    const ranks = computeRanks(graph);
    // Object.prototype.constructor is not a hidden teacher count: `constructor` is a root.
    expect(ranks.cutOff.size).toBe(0);
    expect(ranks.ranks.get('constructor')).toBe(0);
    const scene = await layoutLineage(graph, { preset: 'expand', previousPositions: {} });
    expect(scene.nodes.map((n) => n.id).sort()).toEqual(['constructor', 'toString']);
  });

  it('lays out an empty view and a single person', async () => {
    const empty = await layoutLineage({ focusId: null, dataVersion: 'demo', nodes: [], edges: [], hiddenCounts: {} });
    expect(empty.nodes).toEqual([]);
    const single = await layoutLineage(demoGraph(['solo'], [], { focusId: 'solo' }));
    expect(single.nodes.length).toBe(1);
    expect(single.nodes[0]!.onSpine).toBe(true);
  });

  it('reports timings and counts', async () => {
    const graph = sharedAncestorView(dataset);
    const { stats } = await layoutLineageWithStats(graph);
    expect(stats.nodes).toBe(graph.nodes.length);
    expect(stats.elkEdges + stats.crossLineageEdges).toBe(graph.edges.length);
    expect(stats.totalMs).toBeGreaterThanOrEqual(stats.elkMs);
  });
});

describe('expanding a node with the expand preset (plan §4.5, §4.8)', () => {
  it('keeps the order of the existing people in each row (semiInteractive with the previous x)', async () => {
    const cases: [string, LineageGraph, string][] = [
      ['around demo-shared-ancestor, +students of demo-hub-a', sharedAncestorView(dataset), anchorId(dataset, 'demo-hub-a')],
    ];
    for (const slug of EGO_ANCHORS) {
      const base = egoView(dataset, anchorId(dataset, slug), 3);
      const expandable = [...base.nodes].reverse().find((n) => (base.hiddenCounts[n.id]?.students ?? 0) > 0);
      if (expandable) cases.push([`ego ${slug} (3 per teacher)`, base, expandable.id]);
    }
    expect(cases.length).toBeGreaterThanOrEqual(5);
    let explorerFlips = 0;
    for (const [name, base, nodeId] of cases) {
      const before = await layoutLineage(base);
      const expanded = expandStudents(dataset, base, nodeId);
      expect(expanded.nodes.length, name).toBeGreaterThan(base.nodes.length);
      const after = await layoutLineage(expanded, { preset: 'expand', previousPositions: positionsOf(before) });
      const result = rowOrderFlips(before, after);
      expect(result.flips, name).toBe(0);
      explorerFlips += rowOrderFlips(before, await layoutLineage(expanded)).flips;
    }
    // Without semiInteractive the order does change, so the test above is not vacuous.
    expect(explorerFlips).toBeGreaterThan(0);
  });

  it('keeps every rank, except that a newly shown teacher can push its student down', async () => {
    const base = sharedAncestorView(dataset);
    const expanded = expandStudents(dataset, base, anchorId(dataset, 'demo-hub-a'));
    const before = computeRanks(base).ranks;
    const after = computeRanks(expanded).ranks;
    const added = new Set(expanded.nodes.map((n) => n.id).filter((id) => !before.has(id)));
    for (const [id, rank] of before) {
      if (after.get(id) === rank) continue;
      // Only people with a newly shown teacher move, and only downwards.
      expect(after.get(id)!).toBeGreaterThan(rank);
      const newTeacher = expanded.edges.some((e) => e.studentId === id && added.has(e.teacherId));
      const movedTeacher = expanded.edges.some(
        (e) => e.studentId === id && before.has(e.teacherId) && after.get(e.teacherId) !== before.get(e.teacherId),
      );
      expect(newTeacher || movedTeacher, id).toBe(true);
    }
  });
});
