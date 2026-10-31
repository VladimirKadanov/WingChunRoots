/**
 * Plan §4.6: "a student with two teachers stands horizontally between them, including exactly
 * under the preferred one" (review finding graph-6 of M05), in the views the explorer opens on
 * the demo data and in the views of M03, with and without the explorer's fan-out cap.
 */
import { describe, expect, it } from 'vitest';
import { capFanout } from '@/components/lineage/explorer/state';
import { deferredEdges, joinRoute } from './converging.ts';
import { buildElkGraph } from './elk-graph.ts';
import { indexGraph } from './graph.ts';
import { layoutLineage, layoutLineageWithStats } from './layout.ts';
import { NODE_SIZES, explorerLayout } from './presets.ts';
import { computeRanksIndexed } from './ranks.ts';
import { demoGraph } from './testing/build.ts';
import { positionsOf, rowOrderFlips, spineBends } from './testing/checks.ts';
import { loadLineageFixture } from './testing/fixture.ts';
import { LINEAGES, anchorId, generateSyntheticLineage, type AnchorSlug, type LineageDataset } from './testing/synthetic.ts';
import { extractView, lineageIdOf, standardViews, type NamedView } from './testing/views.ts';
import type { LineageGraph, Scene } from './types.ts';

/** The explorer's fan-out cap (FANOUT_SHOWN students per teacher, "+N more"), as it draws a view. */
function capped(graph: LineageGraph): LineageGraph | undefined {
  const result = capFanout(graph as unknown as Parameters<typeof capFanout>[0]);
  return result.more.size > 0 ? (result.graph as unknown as LineageGraph) : undefined;
}

/** The ego views the explorer opens (plan §4.3): person view, narrow screen, generations. */
const EGO_READS = [
  { up: 16, down: 2 },
  { up: 2, down: 1 },
  { up: 2, down: 2 },
  { up: 1, down: 2 },
] as const;
const EGO_SLUGS: AnchorSlug[] = ['demo-root-a', 'demo-root-b', 'demo-hub-a', 'demo-converging'];
/** The lineage roots of the demo data (`lineages[].rootPersonId` of the fixture). */
const LINEAGE_ROOTS: [slug: string, root: AnchorSlug][] = [
  [LINEAGES.a, 'demo-root-a'],
  [LINEAGES.b, 'demo-root-b'],
  [LINEAGES.c, 'demo-root-c'],
];

/** The views of the explorer on a dataset, as the lineage API answers them (plan §6.3). */
function explorerViews(data: LineageDataset): NamedView[] {
  const views: NamedView[] = [];
  for (const [slug, root] of LINEAGE_ROOTS) {
    views.push({
      name: `lineage view of ${slug}`,
      graph: extractView(data, { focus: anchorId(data, root), up: 0, down: 3, lineageId: lineageIdOf(data, slug) }),
    });
  }
  for (const slug of EGO_SLUGS) {
    for (const { up, down } of EGO_READS) {
      views.push({
        name: `ego view of ${slug}, up ${up}, down ${down}`,
        // The API follows at most 50 students per teacher (fanoutLimit).
        graph: extractView(data, { focus: anchorId(data, slug), up, down, maxStudentsPerTeacher: 50 }),
      });
    }
  }
  return views;
}

function withCapped(views: NamedView[]): NamedView[] {
  return views.flatMap((v) => {
    const graph = capped(v.graph);
    return graph ? [v, { name: `${v.name}, fan-out capped`, graph }] : [v];
  });
}

const fixture = loadLineageFixture();
const synthetic = generateSyntheticLineage();
const VIEWS: NamedView[] = withCapped([
  ...explorerViews(fixture).map((v) => ({ ...v, name: `fixture: ${v.name}` })),
  ...standardViews(fixture).map((v) => ({ ...v, name: `fixture: ${v.name}` })),
  ...standardViews(synthetic).map((v) => ({ ...v, name: `synthetic: ${v.name}` })),
]);

interface Converging {
  student: string;
  teachers: string[];
}

/** Students with two or more teachers in one lineage whose edges ELK routes. */
function convergingStudents(scene: Scene): Converging[] {
  const groups = new Map<string, Converging>();
  for (const e of scene.edges) {
    // Edges to a teacher from another lineage are Bézier curves outside ELK (plan §4.6).
    if (e.kind === 'crossLineage') continue;
    const key = `${e.studentId}\u0000${e.lineageId}`;
    const group = groups.get(key);
    if (group) group.teachers.push(e.teacherId);
    else groups.set(key, { student: e.studentId, teachers: [e.teacherId] });
  }
  return [...groups.values()].filter((g) => g.teachers.length >= 2);
}

/**
 * Students outside the span of their teachers' card centres (1 px tolerance), split into
 * the one case the straight focus spine leaves no room for (see the test below) and all
 * others.
 */
function outsideTheirTeachers(scene: Scene) {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const converging = convergingStudents(scene);
  const teacherSet = (g: Converging) => [...g.teachers].sort().join(' ');
  const outside: string[] = [];
  const besideTheSpine: string[] = [];
  const besideTheSpineIds: string[] = [];
  for (const group of converging) {
    const student = byId.get(group.student)!;
    const xs = group.teachers.map((id) => byId.get(id)!.center.x);
    const [from, to] = [Math.min(...xs), Math.max(...xs)];
    if (student.center.x >= from - 1 && student.center.x <= to + 1) continue;
    const text = `${group.student} at ${student.center.x}, teachers at ${xs.join(' and ')}`;
    // Every teacher on the focus spine (a straight vertical line), and the place on it in the
    // student's row already taken: by the spine itself or by another student of the same
    // teachers.
    const onSpineLine =
      to - from <= 1 &&
      group.teachers.every((id) => byId.get(id)!.onSpine) &&
      scene.nodes.some(
        (other) =>
          other.id !== group.student &&
          other.rank === student.rank &&
          Math.abs(other.center.x - from) <= 1 &&
          (other.onSpine || converging.some((g) => g.student === other.id && teacherSet(g) === teacherSet(group))),
      );
    (onSpineLine ? besideTheSpine : outside).push(text);
    if (onSpineLine) besideTheSpineIds.push(group.student);
  }
  return { converging: converging.length, outside, besideTheSpine, besideTheSpineIds };
}

/**
 * Sideways travel of an edge into such a student beyond the distance between its ends:
 * how far its route goes out of its way (review of M05, round 2).
 *
 * The edges of a teacher leave its card by one trunk at the middle of its bottom side (b5 of
 * the M06 design review), so the first horizontal run of a route starts under the middle of
 * the card; the part of that run under the teacher's own card is the trunk shared by all its
 * students, not a detour of this edge. The route is measured from where that run leaves the
 * card's width, which is where its own port stood when every edge had one along that side.
 */
function detours(scene: Scene): { edge: string; detour: number }[] {
  const students = new Set(convergingStudents(scene).map((g) => g.student));
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const out: { edge: string; detour: number }[] = [];
  for (const e of scene.edges) {
    if (!students.has(e.studentId) || e.path.type !== 'orthogonal') continue;
    const points = e.path.points;
    const teacher = byId.get(e.teacherId)!;
    // The end of the first horizontal run (after the drop out of the teacher's card).
    let i = 1;
    while (i < points.length && points[i]!.x === points[0]!.x) i++;
    if (i === points.length) {
      out.push({ edge: e.id, detour: 0 });
      continue;
    }
    while (i + 1 < points.length && points[i + 1]!.y === points[i]!.y) i++;
    const start = Math.min(teacher.x + teacher.width, Math.max(teacher.x, points[i]!.x));
    let travel = Math.abs(points[i]!.x - start);
    for (let j = i + 1; j < points.length; j++) travel += Math.abs(points[j]!.x - points[j - 1]!.x);
    out.push({ edge: e.id, detour: travel - Math.abs(points[points.length - 1]!.x - start) });
  }
  return out;
}

/** At most one card and the spacing on both sides of it: a waypoint that steps round one card. */
const MAX_DETOUR = NODE_SIZES.full.width + 2 * Number(explorerLayout['elk.spacing.nodeNode']);

/**
 * Lays out a view and checks plan §4.6 on it: every such student between its teachers, the
 * one exception reported in the stats, the spine straight and no route far out of its way.
 */
async function checkView(name: string, graph: LineageGraph) {
  const { scene, stats } = await layoutLineageWithStats(graph, { focusId: graph.focusId });
  const { outside, besideTheSpine, besideTheSpineIds } = outsideTheirTeachers(scene);
  expect(outside, name).toEqual([]);
  // The exception below never costs more than one student per view, and the layout says so.
  expect(besideTheSpine.length, name).toBeLessThanOrEqual(1);
  expect([...stats.unplacedStudents].sort(), name).toEqual([...besideTheSpineIds].sort());
  // The focus spine stays straight (plan §4.5, M03).
  expect(spineBends(scene), name).toBe(0);
  expect(
    detours(scene).filter((d) => d.detour > MAX_DETOUR),
    name,
  ).toEqual([]);
}

describe('students with several teachers in one lineage (plan §4.6)', () => {
  it('covers views with such students', () => {
    expect(VIEWS.length).toBeGreaterThan(40);
    expect(VIEWS.filter((v) => hasConverging(v.graph)).length).toBeGreaterThan(30);
  });

  it.each(VIEWS.map((v) => [v.name, v.graph] as const))(
    'places every one between its teachers: %s',
    async (name, graph) => {
      await checkView(name, graph);
    },
    60_000,
  );

  // The ego view of every person, as the explorer reads it (and with its fan-out cap): the
  // place of a student must not depend on which person is in focus (review of M05, round 2).
  it.each(
    (['fixture', 'synthetic'] as const).flatMap((dataset) => EGO_READS.map(({ up, down }) => [dataset, up, down] as const)),
  )(
    'places every one between its teachers in the ego view of every person: %s, up %i, down %i',
    async (dataset, up, down) => {
      const data = dataset === 'fixture' ? fixture : synthetic;
      let checked = 0;
      for (const node of data.graph.nodes) {
        const view = extractView(data, { focus: node.id, up, down, maxStudentsPerTeacher: 50 });
        for (const graph of [view, capped(view)]) {
          if (!graph || !hasConverging(graph)) continue;
          await checkView(`ego view of ${node.id}${graph === view ? '' : ', fan-out capped'}`, graph);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(50);
    },
    300_000,
  );

  it('places a student between its teachers when the first pass bent the spine past it (review of M05, round 2)', async () => {
    // The first pass puts `d-side` right of `c-mid`, and the spine `root` → `b-hub` → `c-mid`
    // → `focus` bends; straightened, `d-side` has to stand left of `c-mid`, between `a-other`
    // and `b-hub`, and `focus` stays between `c-mid` and `d-side`.
    const graph = demoGraph(
      ['root', 'a-other', 'b-hub', 'c-mid', 'd-side', 'focus'],
      [
        ['root', 'b-hub'],
        ['root', 'a-other'],
        ['b-hub', 'c-mid'],
        ['b-hub', 'd-side'],
        ['a-other', 'd-side', 'converging'],
        ['c-mid', 'focus'],
        ['d-side', 'focus', 'converging'],
      ],
      { focusId: 'focus' },
    );
    const { scene, stats } = await layoutLineageWithStats(graph);
    const x = new Map(scene.nodes.map((n) => [n.id, n.center.x]));
    expect(x.get('d-side')!).toBeGreaterThanOrEqual(Math.min(x.get('a-other')!, x.get('b-hub')!));
    expect(x.get('d-side')!).toBeLessThanOrEqual(Math.max(x.get('a-other')!, x.get('b-hub')!));
    expect(x.get('d-side')!).toBeLessThan(x.get('c-mid')!);
    expect(spineBends(scene)).toBe(0);
    expect(stats.unplacedStudents).toEqual([]);
    expect(outsideTheirTeachers(scene).outside).toEqual([]);
  });

  it('routes the edge from a second teacher straight down past the cards in between (review of M05, round 2)', async () => {
    // The person view of demo-root-a in the demo data: a student of `demo-root-a` and of one of
    // its students. Its edge from `demo-root-a` crosses the row in between near the straight
    // line, not past a card on the far side and back.
    const graph = extractView(fixture, { focus: anchorId(fixture, 'demo-root-a'), up: 2, down: 2, maxStudentsPerTeacher: 50 });
    for (const view of [graph, capped(graph)!]) {
      const scene = await layoutLineage(view, { focusId: view.focusId });
      const all = detours(scene);
      expect(all.length).toBeGreaterThan(2);
      expect(all.filter((d) => d.detour > MAX_DETOUR)).toEqual([]);
    }
  });

  it('puts a student of a hub between the hub and its other teacher, not at the far end of the fan', async () => {
    // `aux` sorts before `hub`, so it stands left of it; `s10` is the last of hub's ten students
    // in model order, so the hub's fan puts it at the right end.
    const students = Array.from({ length: 10 }, (_, i) => `s${String(i + 1).padStart(2, '0')}`);
    const graph = demoGraph(
      ['root', 'aux', 'hub', ...students],
      [['root', 'aux'], ['root', 'hub'], ...students.map((s) => ['hub', s] as [string, string]), ['aux', 's10', 'converging']],
      { focusId: 'root' },
    );
    const scene = await layoutLineage(graph);
    const x = new Map(scene.nodes.map((n) => [n.id, n.center.x]));
    expect(x.get('aux')!).toBeLessThan(x.get('hub')!);
    expect(x.get('s10')!).toBeGreaterThanOrEqual(x.get('aux')!);
    expect(x.get('s10')!).toBeLessThanOrEqual(x.get('hub')!);
  });

  it('stands a second student of a teacher and that teacher’s teacher on the spine beside it (owner question M05, 2026-10-25)', async () => {
    // `root` → `focus` is the focus spine, a straight vertical line through the centres of
    // both cards, so the span of the two teachers is a single x. Only one card fits there:
    // the other student stands one card further (DEFAULT, see docs/plan/questions/M05.md).
    const graph = demoGraph(
      ['root', 'focus', 'first', 'second'],
      [
        ['root', 'focus'],
        ['focus', 'first'],
        ['focus', 'second'],
        ['root', 'first', 'converging'],
        ['root', 'second', 'converging'],
      ],
      { focusId: 'focus' },
    );
    const scene = await layoutLineage(graph);
    const x = new Map(scene.nodes.map((n) => [n.id, n.center.x]));
    expect(spineBends(scene)).toBe(0);
    expect(x.get('root')).toBe(x.get('focus'));
    expect(x.get('first')).toBe(x.get('focus'));
    const step = NODE_SIZES.full.width + Number(explorerLayout['elk.spacing.nodeNode']);
    expect(Math.abs(x.get('second')! - x.get('focus')!)).toBe(step);
    const { outside, besideTheSpine } = outsideTheirTeachers(scene);
    expect(outside).toEqual([]);
    expect(besideTheSpine).toHaveLength(1);
    // The layout reports the student it could not place between its teachers.
    expect((await layoutLineageWithStats(graph)).stats.unplacedStudents).toEqual(['second']);
  });

  it.each([
    ['sib', 'kid'],
    ['a-sib', 'z-kid'],
    ['z-sib', 'a-kid'],
  ])(
    'places a student of the student beside the spine and of a spine teacher between them (review of M05, round 3: %s, %s)',
    async (sib, kid) => {
      // Spine `root` → `mid` → `low` → `focus`. `sib` is a student of `mid` and `root` in the row of
      // `low`, which holds the spine card: it stands one step beside the line (the case of the
      // owner question). `kid` is a student of `sib` and `mid` in the row of `focus`: its span runs
      // from the line to `sib`, and the place beside `focus` on that side is free.
      const graph = demoGraph(
        ['root', 'mid', 'low', 'focus', sib, kid],
        [
          ['root', 'mid'],
          ['mid', 'low'],
          ['low', 'focus'],
          ['mid', sib],
          ['root', sib, 'converging'],
          [sib, kid],
          ['mid', kid, 'converging'],
        ],
        { focusId: 'focus' },
      );
      const { scene, stats } = await layoutLineageWithStats(graph);
      const x = new Map(scene.nodes.map((n) => [n.id, n.center.x]));
      expect(spineBends(scene)).toBe(0);
      expect(x.get(kid)!).toBeGreaterThanOrEqual(Math.min(x.get('mid')!, x.get(sib)!));
      expect(x.get(kid)!).toBeLessThanOrEqual(Math.max(x.get('mid')!, x.get(sib)!));
      const { outside, besideTheSpineIds } = outsideTheirTeachers(scene);
      expect(outside).toEqual([]);
      expect(besideTheSpineIds).toEqual([sib]);
      // Only the student that is not between its teachers is reported.
      expect(stats.unplacedStudents).toEqual([sib]);
    },
  );

  // A fuzz graph of the review of M05 (round 3, seed 106): the focus `p4` (lineage y) stands
  // under `p2` and `p0`; `p7` is a student of `p4` and `p2` (both on the spine), `p5` of `p4`
  // and `p1`. Showing one more student (`p6` of the focus, or `p3` of the root) put `p7`, shown
  // before, onto the spine line and moved it past `p5`.
  it.each([[['p6']], [['p3']], [['p3', 'p6']]])(
    'with the expand preset, keeps the order of the people shown before when a student joins (hidden before: %j)',
    async (hidden) => {
      const graph = demoGraph(
        ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
        [
          ['p0', 'p1'],
          ['p0', 'p2'],
          ['p0', 'p3'],
          ['p2', 'p4', 'primary', 'demo-lineage-y'],
          ['p4', 'p5'],
          ['p1', 'p5', 'converging'],
          ['p4', 'p6'],
          ['p4', 'p7'],
          ['p0', 'p4', 'converging', 'demo-lineage-y'],
          ['p2', 'p7', 'converging'],
        ],
        { focusId: 'p4' },
      );
      const names: Record<string, string> = { p0: 'Z0', p1: 'E1', p2: 'S2', p3: 'D3', p4: 'F4', p5: 'G5', p6: 'G6', p7: 'X7' };
      const years = ['1982', '2008', '1970', '1982', '1975', '1984', '1950', '1972', '1950', '2001'];
      graph.nodes = graph.nodes.map((n) => ({ ...n, displayName: `Demo ${names[n.id]}`, lineageIds: [n.id === 'p4' ? 'demo-lineage-y' : 'demo-lineage-x'] }));
      graph.edges = graph.edges.map((e, i) => ({ ...e, periods: [{ ...e.periods[0]!, from: years[i]! }] }));
      const before = await layoutLineage(
        {
          ...graph,
          nodes: graph.nodes.filter((n) => !hidden.includes(n.id)),
          edges: graph.edges.filter((e) => !hidden.includes(e.teacherId) && !hidden.includes(e.studentId)),
        },
        { focusId: 'p4' },
      );
      const after = await layoutLineage(graph, { focusId: 'p4', preset: 'expand', previousPositions: positionsOf(before) });
      expect(rowOrderFlips(before, after).flips).toBe(0);
    },
  );

  it('leaves out of the first ELK pass every incoming edge of such a student but the preferred one', () => {
    const graph = demoGraph(
      ['a', 'b', 'c', 'student', 'single'],
      [
        ['a', 'student'],
        ['b', 'student', 'converging'],
        ['c', 'student', 'converging'],
        ['a', 'single'],
        ['c', 'single', 'crossLineage'],
      ],
    );
    const index = indexGraph(graph);
    const build = buildElkGraph(index, computeRanksIndexed(index));
    expect([...deferredEdges(index, build)].sort()).toEqual(['demo-edge-002', 'demo-edge-003']);
  });

  it('joins the segments of an edge without repeated points or points inside a straight run', () => {
    expect(
      joinRoute([
        { x: 10, y: 0 },
        { x: 10, y: 50 },
        { x: 10, y: 50 },
        { x: 10, y: 80 },
        { x: 40, y: 80 },
        { x: 40, y: 120 },
        { x: 40, y: 184 },
      ]),
    ).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 80 },
      { x: 40, y: 80 },
      { x: 40, y: 184 },
    ]);
  });
});

function hasConverging(graph: LineageGraph): boolean {
  const count = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.kind === 'crossLineage') continue;
    count.set(e.studentId, (count.get(e.studentId) ?? 0) + 1);
  }
  return [...count.values()].some((n) => n >= 2);
}
