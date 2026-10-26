import { describe, expect, it } from 'vitest';
import { layoutLineage } from './layout.ts';
import { NODE_SIZES } from './presets.ts';
import { LABEL_NEAR_STUDENT_RUN, bezierBetween, bezierLabelPoint } from './scene.ts';
import { loadLineageFixture } from './testing/fixture.ts';
import { anchorId, type AnchorSlug } from './testing/synthetic.ts';
import { egoView, extractView, lineageIdOf } from './testing/views.ts';
import type { BezierPath, Point, Scene, SceneNode } from './types.ts';

/** fixtures/lineage-600.json from M01: the demo data the explorer shows. */
const fixture = loadLineageFixture();

/** Half the height of a curve's label (11 px text on one line). */
const LABEL_HALF = 8;

function pointAt(path: BezierPath, t: number): Point {
  const u = 1 - t;
  const c = (a: number, b: number, d: number, e: number) => u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * d + t * t * t * e;
  return { x: c(path.start.x, path.control1.x, path.control2.x, path.end.x), y: c(path.start.y, path.control1.y, path.control2.y, path.end.y) };
}

function inside(p: Point, n: SceneNode): boolean {
  return p.x > n.x && p.x < n.x + n.width && p.y > n.y && p.y < n.y + n.height;
}

/** The cards (other than the two people's) that the curve runs behind anywhere between its two ends. */
function cardsBehind(path: BezierPath, cards: readonly SceneNode[]): string[] {
  const hit = new Set<string>();
  for (let i = 1; i < 2000; i++) {
    const p = pointAt(path, i / 2000);
    for (const card of cards) if (inside(p, card)) hit.add(card.id);
  }
  return [...hit];
}

function slot(id: string, rank: number, x: number, y: number): SceneNode {
  const { width, height } = NODE_SIZES.full;
  const center = { x: x + width / 2, y: y + height / 2 };
  const box = { x, y, width, height };
  return { id, rank, cutOff: false, onSpine: false, x, y, width, height, center, boxes: { full: box, compact: box, dot: box } };
}

/**
 * Two rows of cards 224 px apart (a card and the 24 px gap between two cards), with a gap of
 * `gap` px between the rows: 60 px is the least ELK leaves (`nodeNodeBetweenLayers`), and edges
 * routed between the rows widen it.
 */
function twoRows(count: number, gap = 60): SceneNode[][] {
  return [0, 1].map((rank) => Array.from({ length: count }, (_, i) => slot(`demo-${rank}-${i}`, rank, i * 224, rank * (64 + gap))));
}

/**
 * The lineage views of the explorer (plan §4.3: a lineage root, rows down, teachers from other
 * lineages) of every root, with the explorer's 12 students per teacher and with 50.
 */
const LINEAGE_VIEWS = (
  [
    ['demo-root-a', 'demo-lineage-a'],
    ['demo-root-b', 'demo-lineage-b'],
    ['demo-root-c', 'demo-lineage-c'],
  ] as const
).flatMap(([root, lineage]) => [12, 50].map((maxStudentsPerTeacher) => [root, lineage, maxStudentsPerTeacher] as const));

/**
 * The lineage views of one root, down 1 to 6 rows (the explorer starts at 3 and expands), each
 * once: a view deeper than the lineage is the one before it.
 */
async function lineageViews(root: AnchorSlug, lineage: string, maxStudentsPerTeacher: number): Promise<{ name: string; scene: Scene }[]> {
  const out: { name: string; scene: Scene }[] = [];
  const seen = new Set<string>();
  for (let down = 1; down <= 6; down++) {
    const graph = extractView(fixture, {
      focus: anchorId(fixture, root),
      up: 0,
      down,
      lineageId: lineageIdOf(fixture, lineage),
      includeForeignTeachers: true,
      maxStudentsPerTeacher,
    });
    const people = graph.nodes.map((n) => n.id).join(',');
    if (seen.has(people)) continue;
    seen.add(people);
    out.push({ name: `${root} down ${down}`, scene: await layoutLineage(graph) });
  }
  return out;
}

describe('bezierBetween: a curve to a teacher from another lineage (plan §4.6, screens-1)', () => {
  // The longest runs that a curve can drop out of the rows for: 12 cards in the lowest gap, 100 in a 200 px one.
  it.each([
    [2, 60],
    [3, 60],
    [12, 60],
    [18, 100],
    [100, 200],
  ])('runs along the gap above the student, not behind the cards of either row (%i cards apart, %i px gap)', (apart, gap) => {
    const [above, below] = twoRows(apart + 2, gap);
    const teacher = above![0]!;
    const student = below![apart]!;
    // Without the room of a scene: the gap between the two people's rows, cards a card gap away.
    const path = bezierBetween(teacher, student);
    // Side attachment points, vertically centred on the boxes.
    expect(path.start).toEqual({ x: teacher.x + teacher.width, y: teacher.center.y });
    expect(path.end).toEqual({ x: student.x, y: student.center.y });
    const others = [...above!, ...below!].filter((n) => n !== teacher && n !== student);
    expect(cardsBehind(path, others)).toEqual([]);
    // The middle of the run keeps to the gap, clear of both rows.
    for (let i = 0; i <= 50; i++) {
      const p = pointAt(path, 0.25 + i / 100);
      expect(p.y).toBeGreaterThanOrEqual(64);
      expect(p.y).toBeLessThanOrEqual(64 + gap);
    }
    expect(path.midpoint.y).toBeCloseTo(64 + gap / 2, 0);
  });

  it.each([
    [1, 60],
    [2, 60],
    [3, 200],
  ])('between people close by, falls straight into the gap and out of it, without a loop (%i cards apart, %i px gap)', (apart, gap) => {
    const [above, below] = twoRows(apart + 2, gap);
    const path = bezierBetween(above![0]!, below![apart]!);
    // Downwards all the way (to a pixel): a steeper drop than needed swung back up towards the teacher's row.
    let lowest = path.start.y;
    for (let i = 1; i <= 200; i++) {
      const y = pointAt(path, i / 200).y;
      expect(y).toBeGreaterThan(lowest - 1);
      lowest = Math.max(lowest, y);
    }
  });

  it('between people with no card of their rows between them, is an S with level ends (the Person view of demo-two-lineages)', async () => {
    const scene = await layoutLineage(egoView(fixture, anchorId(fixture, 'demo-two-lineages')));
    const curves = scene.edges.flatMap((e) => (e.path.type === 'bezier' ? [e.path] : []));
    expect(curves.length).toBeGreaterThan(0);
    for (const path of curves) {
      expect(path.control1.y).toBe(path.start.y);
      expect(path.control2.y).toBe(path.end.y);
    }
  });

  // A teacher and a student who overlap horizontally, `offset` px apart, with the next card a card
  // gap (24 px) away on both sides in both rows, except `roomRight` px right of the student; the
  // first two are the curve of the Lineage view of Demo Lineage A (down 3, and down 2 with 50
  // students per teacher) that ran behind the cards beside both people.
  it.each([
    [0, 414, 24],
    [-48.46, 594, 63.46],
    [0, 124, 24],
    [0, 234, 24],
    [100, 124, 24],
    [-150, 414, 24],
  ])('between people who overlap horizontally, swings out beside them without running behind the cards next to them (offset %d px, drop %i px)', (offset, drop, roomRight) => {
    const { width, height } = NODE_SIZES.full;
    const teacher = slot('demo-teacher', 0, 0, 0);
    const student = slot('demo-student', 1, offset, drop);
    const cards = [
      slot('demo-teacher-left', 0, -24 - width, 0),
      slot('demo-teacher-right', 0, width + 24, 0),
      slot('demo-student-left', 1, offset - 24 - width, drop),
      slot('demo-student-right', 1, offset + width + roomRight, drop),
    ];
    const space = { top: height, bottom: drop, teacherRow: null, studentRow: null, beside: cards };
    for (const path of [bezierBetween(teacher, student, space), bezierBetween(teacher, student)]) {
      expect(cardsBehind(path, cards)).toEqual([]);
      expect(cardsBehind(path, [teacher, student])).toEqual([]);
      // Out of one side of both people and into it, far enough out to read as a curve.
      const right = path.start.x === teacher.x + width;
      expect(path.start.x).toBe(right ? teacher.x + width : teacher.x);
      expect(path.end.x).toBe(right ? student.x + width : student.x);
      expect((path.control1.x - path.start.x) * (right ? 1 : -1)).toBeGreaterThanOrEqual(16);
      expect((path.control2.x - path.end.x) * (right ? 1 : -1)).toBeGreaterThanOrEqual(16);
    }
  });

  it('between people who overlap horizontally, takes the side with room and swings out a quarter of the drop there', () => {
    const { width, height } = NODE_SIZES.full;
    const teacher = slot('demo-teacher', 0, 0, 0);
    const student = slot('demo-student', 1, 0, 414);
    const cards = [slot('demo-teacher-right', 0, width + 24, 0), slot('demo-student-right', 1, width + 24, 414)];
    const path = bezierBetween(teacher, student, { top: height, bottom: 414, teacherRow: null, studentRow: null, beside: cards });
    expect(path.start).toEqual({ x: 0, y: teacher.center.y });
    expect(path.control1).toEqual({ x: -414 / 4, y: teacher.center.y });
    expect(cardsBehind(path, cards)).toEqual([]);
  });

  it('a curve along the two rows centre lines (the old shape) runs behind them, which this test would catch', () => {
    const [above, below] = twoRows(20);
    const teacher = above![0]!;
    const student = below![18]!;
    const sx = teacher.x + teacher.width;
    const ex = student.x;
    const reach = (ex - sx) / 2;
    const old: BezierPath = {
      type: 'bezier',
      start: { x: sx, y: teacher.center.y },
      control1: { x: sx + reach, y: teacher.center.y },
      control2: { x: ex - reach, y: student.center.y },
      end: { x: ex, y: student.center.y },
      midpoint: { x: (sx + ex) / 2, y: (teacher.center.y + student.center.y) / 2 },
    };
    expect(cardsBehind(old, [...above!, ...below!].filter((n) => n !== teacher && n !== student)).length).toBeGreaterThan(5);
  });

  it.each(LINEAGE_VIEWS)(
    'in the lineage views of the demo data, no curve runs behind a card of its teacher’s or its student’s row (%s, %s, %i students per teacher)',
    async (root, lineage, maxStudentsPerTeacher) => {
      let curves = 0;
      for (const { name, scene } of await lineageViews(root, lineage, maxStudentsPerTeacher)) {
        const byId = new Map(scene.nodes.map((n) => [n.id, n]));
        for (const edge of scene.edges) {
          if (edge.path.type !== 'bezier') continue;
          curves++;
          const teacher = byId.get(edge.teacherId)!;
          const student = byId.get(edge.studentId)!;
          const rows = scene.nodes.filter((n) => (n.rank === teacher.rank || n.rank === student.rank) && n !== teacher && n !== student);
          expect(cardsBehind(edge.path, rows), `${name} ${edge.id}`).toEqual([]);
        }
      }
      expect(curves).toBeGreaterThan(10);
    },
  );
});

describe('bezierLabelPoint: where "Teacher in {lineage}" goes (plan §4.6, graph-7)', () => {
  it('keeps the label of a short curve at its midpoint', async () => {
    const scene = await layoutLineage(egoView(fixture, anchorId(fixture, 'demo-two-lineages')));
    const curves = scene.edges.flatMap((e) => (e.path.type === 'bezier' ? [e.path] : []));
    expect(curves.length).toBeGreaterThan(0);
    for (const path of curves) {
      expect(Math.abs(path.end.x - path.start.x)).toBeLessThanOrEqual(LABEL_NEAR_STUDENT_RUN);
      expect(bezierLabelPoint(path)).toEqual(path.midpoint);
    }
  });

  it.each([3, 12, 160])('puts the label of a long curve on its run beside the student, clear of both rows (%i cards apart)', (apart) => {
    const [above, below] = twoRows(apart + 2);
    const teacher = above![0]!;
    const student = below![apart]!;
    const path = bezierBetween(teacher, student);
    const label = bezierLabelPoint(path);
    // Past the middle, towards the student, and at least half a card before the student's side.
    expect(label.x).toBeGreaterThan(path.midpoint.x);
    expect(label.x).toBeLessThanOrEqual(path.end.x - NODE_SIZES.full.width / 2);
    // Close enough to be on screen with the student, however long the run.
    expect(path.end.x - label.x).toBeLessThan(1000);
    // In the gap between the rows.
    expect(label.y - LABEL_HALF).toBeGreaterThanOrEqual(64 - 1);
    expect(label.y + LABEL_HALF).toBeLessThanOrEqual(124 + 1);
  });

  it.each(LINEAGE_VIEWS)(
    'in the lineage views of the demo data, every label is in the gap above its student’s row and near the student (%s, %s, %i students per teacher)',
    async (root, lineage, maxStudentsPerTeacher) => {
      for (const { name, scene } of await lineageViews(root, lineage, maxStudentsPerTeacher)) {
        const byId = new Map(scene.nodes.map((n) => [n.id, n]));
        for (const edge of scene.edges) {
          if (edge.path.type !== 'bezier') continue;
          const student = byId.get(edge.studentId)!;
          const label = bezierLabelPoint(edge.path);
          const rowAbove = Math.max(...scene.nodes.filter((n) => n.rank === student.rank - 1).map((n) => n.y + n.height));
          expect(label.y + LABEL_HALF, `${name} ${edge.id}`).toBeLessThanOrEqual(student.y + 1);
          expect(label.y - LABEL_HALF, `${name} ${edge.id}`).toBeGreaterThanOrEqual(rowAbove - 1);
          expect(Math.abs(label.x - edge.path.end.x), `${name} ${edge.id}`).toBeLessThan(1000);
        }
      }
    },
  );
});
