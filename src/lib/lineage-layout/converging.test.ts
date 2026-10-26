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
import { layoutLineage } from './layout.ts';
import { NODE_SIZES, explorerLayout } from './presets.ts';
import { computeRanksIndexed } from './ranks.ts';
import { demoGraph } from './testing/build.ts';
import { spineBends } from './testing/checks.ts';
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
  for (const group of converging) {
    const student = byId.get(group.student)!;
    const xs = group.teachers.map((id) => byId.get(id)!.center.x);
    const [from, to] = [Math.min(...xs), Math.max(...xs)];
    if (student.center.x >= from - 1 && student.center.x <= to + 1) continue;
    const text = `${group.student} at ${student.center.x}, teachers at ${xs.join(' and ')}`;
    // Every teacher on the focus spine (a straight vertical line), and the place on it in the
    // student's row already taken by another student of the same teachers.
    const onSpineLine =
      to - from <= 1 &&
      group.teachers.every((id) => byId.get(id)!.onSpine) &&
      converging.some(
        (other) =>
          other.student !== group.student &&
          teacherSet(other) === teacherSet(group) &&
          byId.get(other.student)!.rank === student.rank &&
          Math.abs(byId.get(other.student)!.center.x - from) <= 1,
      );
    (onSpineLine ? besideTheSpine : outside).push(text);
  }
  return { converging: converging.length, outside, besideTheSpine };
}

describe('students with several teachers in one lineage (plan §4.6)', () => {
  it('covers views with such students', () => {
    expect(VIEWS.length).toBeGreaterThan(40);
    expect(VIEWS.filter((v) => hasConverging(v.graph)).length).toBeGreaterThan(30);
  });

  it.each(VIEWS.map((v) => [v.name, v.graph] as const))(
    'places every one between its teachers: %s',
    async (name, graph) => {
      const scene = await layoutLineage(graph, { focusId: graph.focusId });
      const { outside, besideTheSpine } = outsideTheirTeachers(scene);
      expect(outside, name).toEqual([]);
      // The exception below never costs more than one student per row.
      expect(besideTheSpine.length, name).toBeLessThanOrEqual(1);
      // The focus spine stays straight (plan §4.5, M03).
      expect(spineBends(scene), name).toBe(0);
    },
    60_000,
  );

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
  });

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
