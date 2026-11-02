import { describe, expect, it } from 'vitest';
import { LineageInputError } from './errors.ts';
import { createElkEngine, layoutLineage } from './layout.ts';
import { NODE_SIZES } from './presets.ts';
import { FEED_SPACE, STACK_COLUMNS, TIER_GAP, simplifyRoute } from './stacks.ts';
import { demoGraph } from './testing/build.ts';
import { outsideBands, overlappingCards, positionsOf, routeFaults, rowsIncrease, sharedRuns, yOrderViolations } from './testing/checks.ts';
import { loadLineageFixture } from './testing/fixture.ts';
import { generateSyntheticLineage } from './testing/synthetic.ts';
import { standardViews } from './testing/views.ts';
import type { LineageGraph, Scene } from './types.ts';

const card = NODE_SIZES.full;
const dataset = generateSyntheticLineage();
const fixture = loadLineageFixture();
const lineageViews = [
  ['synthetic lineage:demo-root-a', standardViews(dataset).find((v) => v.name === 'lineage:demo-root-a')!.graph],
  ['fixture lineage:demo-root-a', standardViews(fixture).find((v) => v.name === 'lineage:demo-root-a')!.graph],
  ['fixture around:demo-shared-ancestor', standardViews(fixture).find((v) => v.name === 'around:demo-shared-ancestor')!.graph],
] as const;

/** Every person one node, every edge one route, rows as bands, nothing through a card, no shared run. */
function expectSoundStacks(graph: LineageGraph, scene: Scene, name: string) {
  expect(new Set(scene.nodes.map((n) => n.id)), name).toEqual(new Set(graph.nodes.map((n) => n.id)));
  expect(scene.nodes.length, name).toBe(graph.nodes.length);
  expect(new Set(scene.edges.map((e) => e.id)), name).toEqual(new Set(graph.edges.map((e) => e.id)));
  expect(scene.edges.length, name).toBe(graph.edges.length);
  expect(rowsIncrease(scene), name).toBe(true);
  expect(outsideBands(scene), name).toEqual([]);
  expect(overlappingCards(scene), name).toEqual([]);
  expect(routeFaults(scene), name).toEqual([]);
  expect(sharedRuns(scene), name).toEqual([]);
  expect(yOrderViolations(scene), name).toEqual([]);
}

/** A teacher T with five students who teach no one (s1–s5), one who does (u, with student v). */
const hub = () =>
  demoGraph(['r', 't', 's1', 's2', 's3', 's4', 's5', 'u', 'v'], [
    ['r', 't'],
    ['t', 's1'],
    ['t', 's2'],
    ['t', 's3'],
    ['t', 's4'],
    ['t', 's5'],
    ['t', 'u'],
    ['u', 'v'],
  ]);

describe('stacked students (stackLeaves, ADR 0017)', () => {
  it('is off by default: without the option, or with false, the scene is the one of one row per generation', async () => {
    for (const [name, graph] of lineageViews) {
      const plain = JSON.stringify(await layoutLineage(graph));
      expect(JSON.stringify(await layoutLineage(graph, { stackLeaves: false })), name).toBe(plain);
    }
  });

  it('stacks the leaf students of a teacher in two columns below the row line, tiers TIER_GAP apart', async () => {
    const scene = await layoutLineage(hub(), { stackLeaves: true });
    const at = new Map(scene.nodes.map((n) => [n.id, n]));
    const s = ['s1', 's2', 's3', 's4', 's5'].map((id) => at.get(id)!);
    const row = scene.rowY[2]!;
    // Row by row, left column first, in model order.
    expect(s.map((n) => n.y)).toEqual([row, row, row + card.height + TIER_GAP, row + card.height + TIER_GAP, row + 2 * (card.height + TIER_GAP)]);
    expect(s[1]!.x - s[0]!.x).toBe(card.width + 24);
    expect(s[2]!.x).toBe(s[0]!.x);
    expect(s[3]!.x).toBe(s[1]!.x);
    expect(STACK_COLUMNS).toBe(2);
    // u teaches v: u stays a card of the row, on the row's line, and v's row starts below the block.
    expect(at.get('u')!.y).toBe(row);
    expect(scene.rowY[3]!).toBeGreaterThan(s[4]!.y + card.height);
    expectSoundStacks(hub(), scene, 'hub');
  });

  it('routes each stacked student down the lane between the columns and into the middle of its top side', async () => {
    const scene = await layoutLineage(hub(), { stackLeaves: true });
    const at = new Map(scene.nodes.map((n) => [n.id, n]));
    const lane = at.get('s1')!.x + card.width + 12;
    for (const id of ['s1', 's2', 's3', 's4', 's5']) {
      const edge = scene.edges.find((e) => e.studentId === id)!;
      if (edge.path.type !== 'orthogonal') throw new Error('a stacked student is routed orthogonally');
      const points = edge.path.points;
      const student = at.get(id)!;
      const end = points[points.length - 1]!;
      expect(end).toEqual({ x: student.center.x, y: student.y });
      // The turn into the student runs in the gap above its tier: FEED_SPACE / 2 above the first.
      const turn = points[points.length - 2]!;
      expect(turn.y).toBe(student.y === scene.rowY[2] ? student.y - FEED_SPACE / 2 : student.y - TIER_GAP / 2);
      // …from the lane, which every route of the block passes.
      expect(points.some((p) => p.x === lane)).toBe(true);
      expect(edge.bends).toBe(points.length - 2);
    }
  });

  it('leaves in the row the focus, a student with two teachers, a student of another lineage and a teacher with two leaves', async () => {
    const graph = demoGraph(['r', 't', 'a', 'b', 'c', 'd', 'w', 'x1', 'x2', 'y'], [
      ['r', 't'],
      ['r', 'w'],
      ['t', 'a'],
      ['t', 'b'],
      ['t', 'c'],
      ['t', 'd'],
      ['w', 'd', 'converging'],
      ['w', 'x1'],
      ['w', 'x2'],
      ['y', 'c', 'crossLineage'],
    ]);
    graph.focusId = 'a';
    const scene = await layoutLineage(graph, { stackLeaves: true });
    const row = scene.rowY[2]!;
    // a is the focus, c has a teacher of another lineage, d two teachers: only b is left, too few
    // to stack; w has two leaves only.
    for (const node of scene.nodes) expect(node.y, node.id).toBe(scene.rowY[node.rank]);
    expect(scene.nodes.filter((n) => n.rank === 2).every((n) => n.y === row)).toBe(true);
    expectSoundStacks(graph, scene, 'kept in the row');
  });

  it('keeps every property in the lineage views of the synthetic data and the fixture, and makes them narrower', async () => {
    for (const [name, graph] of lineageViews) {
      const plain = await layoutLineage(graph);
      const stacked = await layoutLineage(graph, { stackLeaves: true });
      expectSoundStacks(graph, stacked, name);
      expect(stacked.bounds.width, name).toBeLessThan(plain.bounds.width);
      // The same people in the same rows.
      const rank = new Map(plain.nodes.map((n) => [n.id, n.rank]));
      for (const node of stacked.nodes) expect(node.rank, `${name} ${node.id}`).toBe(rank.get(node.id));
    }
  }, 60_000);

  it('gives byte-for-byte identical output for the same input, whatever the order of the input arrays', async () => {
    const graph = lineageViews[1][1];
    const first = JSON.stringify(await layoutLineage(graph, { stackLeaves: true }, createElkEngine()));
    expect(JSON.stringify(await layoutLineage(structuredClone(graph), { stackLeaves: true }, createElkEngine()))).toBe(first);
    const reversed: LineageGraph = { ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() };
    expect(JSON.stringify(await layoutLineage(reversed, { stackLeaves: true }))).toBe(first);
  });

  it('keeps the blocks where they were with the expand preset', async () => {
    const graph = hub();
    const before = await layoutLineage(graph, { stackLeaves: true });
    const after = await layoutLineage(graph, { stackLeaves: true, preset: 'expand', previousPositions: positionsOf(before) });
    expectSoundStacks(graph, after, 'expand');
    const order = (s: Scene) => s.nodes.filter((n) => n.rank === 2).sort((a, b) => a.x - b.x || a.y - b.y).map((n) => n.id);
    expect(order(after)).toEqual(order(before));
  });

  it('rejects a stackLeaves that is not true or false as invalid input', async () => {
    await expect(layoutLineage(hub(), { stackLeaves: 'yes' as unknown as boolean })).rejects.toBeInstanceOf(LineageInputError);
  });

  it('simplifyRoute drops repeated points and points in the middle of a straight run', () => {
    expect(
      simplifyRoute([
        { x: 0, y: 0 },
        { x: 0, y: 5 },
        { x: 0, y: 5 },
        { x: 0, y: 10 },
        { x: 4, y: 10 },
        { x: 8, y: 10 },
        { x: 8, y: 12 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 8, y: 10 },
      { x: 8, y: 12 },
    ]);
  });
});
