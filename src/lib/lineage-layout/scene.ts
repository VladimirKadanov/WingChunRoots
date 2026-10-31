import type { ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { ElkGraphBuild } from './elk-graph.ts';
import { ElkLayoutError } from './errors.ts';
import { NODE_SIZES, layoutPresets } from './presets.ts';
import type {
  BezierPath,
  Box,
  DetailLevel,
  LineageEdge,
  LineageGraph,
  OrthogonalPath,
  Point,
  RankResult,
  Scene,
  SceneEdge,
  SceneNode,
} from './types.ts';

const DETAIL_LEVELS: readonly DetailLevel[] = ['full', 'compact', 'dot'];

/** Minimum horizontal reach of a Bézier control point, in px. */
const BEZIER_MIN_REACH = 48;

/** The least gap between two cards of a row (`elk.spacing.nodeNode`), in px. */
const CARD_GAP = 24;

/**
 * Horizontal reach of the control points of a curve that drops into the gap between two rows:
 * half the gap between two cards, so the curve turns into the gap beside each of the two people
 * instead of running along their rows.
 */
const RUN_REACH = CARD_GAP / 2;

/** Room kept between a curve's run along the gap between two rows and the cards above and below it, in px. */
const RUN_CLEARANCE = 8;

/**
 * The least reach of the control points of a curve between people who overlap horizontally: it
 * swings 12 px out of their sides, which still reads as a curve in a card gap.
 */
const SIDE_MIN_REACH = 16;

/** Points a curve beside two people is checked at for cards it would run behind (bezierBetween). */
const SIDE_SAMPLES = 128;

/** The steepest extra drop at the two ends that the searches in runHeights try, in px. */
const RUN_MAX_EXTRA = 1000;

/** A curve whose run is longer than this has its label near the student: two cards and their gaps. */
export const LABEL_NEAR_STUDENT_RUN = 2 * (NODE_SIZES.full.width + 24);

/** How far before the student's side the label of a long curve sits: half a card and half a gap. */
const LABEL_LEAD = NODE_SIZES.full.width / 2 + 12;

/** How far above the student's centre line a label's centre stays: half a card, half a label and some room. */
const LABEL_CLEAR_OF_STUDENT = NODE_SIZES.full.height / 2 + 17;

/**
 * Rounds to 1/100 px and turns -0 into 0, so that the serialized scene is byte for byte
 * the same on every run and every engine.
 */
export function roundCoord(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

function point(x: number, y: number): Point {
  return { x: roundCoord(x), y: roundCoord(y) };
}

function centredBox(center: Point, level: DetailLevel): Box {
  const { width, height } = NODE_SIZES[level];
  return { x: roundCoord(center.x - width / 2), y: roundCoord(center.y - height / 2), width, height };
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * How far a curve whose run should stay at height `level` swings past it: towards the student in
 * the first half (it drops too far) and back towards the teacher in the second (it climbs back).
 */
function runSwing(y0: number, y1: number, y2: number, y3: number, level: number): number {
  let swing = 0;
  for (let i = 1; i < 64; i++) {
    const t = i / 64;
    swing = Math.max(swing, (cubicAt(y0, y1, y2, y3, t) - level) * (t <= 0.5 ? 1 : -1));
  }
  return swing;
}

/**
 * The room a curve between people side by side has (bezierBetween): the gap above the student's
 * row, and the facing sides of the nearest cards between the two people in the teacher's row and
 * in the student's row (null when no card stands between them there).
 */
export interface RunSpace {
  /** The bottom of the row above the student's, or the teacher's own bottom. */
  top: number;
  /** The top of the student's row. */
  bottom: number;
  /** The x of the side facing the teacher of the nearest card between them in the teacher's row. */
  teacherRow: number | null;
  /** The x of the side facing the student of the nearest card between them in the student's row. */
  studentRow: number | null;
  /**
   * For people who overlap horizontally (the curve leaves and enters on one side): the cards of
   * the rows from the teacher's to the student's that a curve beside the two of them could reach.
   */
  beside?: readonly Box[];
}

/** A curve between people side by side: its four x coordinates and what it must keep clear of. */
interface RunEnds {
  x: readonly [number, number, number, number];
  /** +1 when the student is right of the teacher, -1 when left. */
  side: number;
  teacher: SceneNode;
  student: SceneNode;
  space: RunSpace;
}

/**
 * Whether the curve is below the teacher's row wherever it passes a card of that row, and above
 * the student's row wherever it passes a card of that row (RunSpace). Each row is checked on
 * the half of the curve near it: the far half keeps to the gap (runHeights) or, on an S, to the
 * far side of the middle between the two people's centre lines.
 */
function clearOfNeighbours(ends: RunEnds, y: readonly [number, number, number, number]): boolean {
  const [x0, x1, x2, x3] = ends.x;
  const { side, space } = ends;
  const below = ends.teacher.y + ends.teacher.height + RUN_CLEARANCE;
  const above = ends.student.y - RUN_CLEARANCE;
  for (let i = 1; i < 256; i++) {
    const t = i / 256;
    const x = cubicAt(x0, x1, x2, x3, t);
    const h = cubicAt(y[0], y[1], y[2], y[3], t);
    if (t <= 0.5 && space.teacherRow !== null && (x - space.teacherRow) * side >= 0 && h < below) return false;
    if (t >= 0.5 && space.studentRow !== null && (space.studentRow - x) * side >= 0 && h > above) return false;
  }
  return true;
}

/**
 * The control heights of a curve from the teacher's centre line down to the student's whose run
 * keeps to the gap between `top` and `bottom`: it is at the gap's middle at t = 0.5, and it drops
 * out of the teacher's row before it passes a card of that row and into the student's side after
 * it passes the cards of the student's row. It drops only as steeply as that needs: a steeper
 * drop swings the run across the gap and, between near people, into a loop. When the gap is too
 * low for a long run to drop that steeply, it drops as steeply as the gap allows.
 */
function runHeights(ends: RunEnds): { y1: number; y2: number } {
  const { top, bottom } = ends.space;
  const y0 = ends.teacher.center.y;
  const y3 = ends.student.center.y;
  const level = (top + bottom) / 2;
  const room = (bottom - top) / 2 - RUN_CLEARANCE;
  const d0 = level - y0;
  const d3 = y3 - level;
  // With extra = 0 the curve falls without a swing and is level at t = 0.5; extra steepens both ends.
  const heights = (extra: number) => ({ y1: level + (2 * d0 + d3) / 3 + extra, y2: level - (d0 + 2 * d3) / 3 - extra });
  const fits = (extra: number) => {
    const { y1, y2 } = heights(extra);
    return runSwing(y0, y1, y2, y3, level) <= room;
  };
  const clear = (extra: number) => {
    const { y1, y2 } = heights(extra);
    return clearOfNeighbours(ends, [y0, y1, y2, y3]);
  };
  if (!fits(0) || clear(0)) return heights(0);
  // The steepest drop that keeps to the gap…
  let lo = 0;
  let hi = RUN_MAX_EXTRA;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  if (!clear(lo)) return heights(lo);
  // …and the gentlest one, no steeper than that, that clears the cards of the two rows.
  let gentle = 0;
  let steep = lo;
  for (let i = 0; i < 24; i++) {
    const mid = (gentle + steep) / 2;
    if (clear(mid)) steep = mid;
    else gentle = mid;
  }
  return heights(steep);
}

/**
 * The four points of a curve between people who overlap horizontally, on `side` (+1 right, -1
 * left). With `lead` 0 it bulges out of their sides: both control points `reach` past the outer
 * of the two sides, level with the two people. With a lead it drops: each control point `reach`
 * out of its own person's side and `lead` towards the other person's row, so the curve leaves
 * the teacher's row and enters the student's close beside them and moves across in between.
 */
function besideCurve(teacher: SceneNode, student: SceneNode, side: number, reach: number, lead: number): [Point, Point, Point, Point] {
  const sx = side > 0 ? teacher.x + teacher.width : teacher.x;
  const ex = side > 0 ? student.x + student.width : student.x;
  const outer = side > 0 ? Math.max(sx, ex) : Math.min(sx, ex);
  const y0 = teacher.center.y;
  const y3 = student.center.y;
  const towards = Math.sign(y3 - y0) * lead;
  return [
    point(sx, y0),
    point((lead === 0 ? outer : sx) + side * reach, y0 + towards),
    point((lead === 0 ? outer : ex) + side * reach, y3 - towards),
    point(ex, y3),
  ];
}

/**
 * Whether a curve beside two people keeps RUN_CLEARANCE to the sides of the cards beside them
 * (RunSpace.beside) and stays out of the two people's own boxes.
 */
function clearBeside(curve: readonly [Point, Point, Point, Point], cards: readonly Box[], own: readonly Box[]): boolean {
  const [p0, p1, p2, p3] = curve;
  for (let i = 1; i < SIDE_SAMPLES; i++) {
    const t = i / SIDE_SAMPLES;
    const x = cubicAt(p0.x, p1.x, p2.x, p3.x, t);
    const y = cubicAt(p0.y, p1.y, p2.y, p3.y, t);
    for (const c of cards) {
      if (x > c.x - RUN_CLEARANCE && x < c.x + c.width + RUN_CLEARANCE && y > c.y && y < c.y + c.height) return false;
    }
    for (const c of own) if (x > c.x && x < c.x + c.width && y > c.y && y < c.y + c.height) return false;
  }
  return true;
}

/** Without the room of a scene: a card a card gap away on both sides of each of the two people, in their rows. */
function cardsBeside(teacher: SceneNode, student: SceneNode): Box[] {
  return [teacher, student].flatMap((n) => [
    { x: n.x - CARD_GAP - n.width, y: n.y, width: n.width, height: n.height },
    { x: n.x + n.width + CARD_GAP, y: n.y, width: n.width, height: n.height },
  ]);
}

/**
 * A cubic Bézier curve between the side attachment points of teacher and student
 * (plan §4.6). When the two boxes overlap horizontally the curve leaves and enters on the
 * same side and bulges outwards: on the side the student leans to, a quarter of the drop between
 * them (at least BEZIER_MIN_REACH) out. Where that would run behind a card beside them (in the
 * explorer's rows the next card stands a card gap away), it swings out only as far as keeps
 * RUN_CLEARANCE to those cards, on the side that leaves the wider swing (at least
 * SIDE_MIN_REACH); where no bulge clears them (people further apart than the card gap), it drops
 * out of the teacher's row and into the student's beside them (besideCurve). Otherwise it leaves
 * the teacher on the side facing the student
 * and enters the student on the side facing the teacher: as an S with level ends when that
 * passes no card of the two rows, else dropping into the gap above the student's row (`space`),
 * keeping to it and dropping into the student's side. So a long curve never runs behind the
 * cards of the two rows: along the rows' centre lines it did, and showed only as short stubs
 * between the cards that read as links between people of one generation. Without `space`, the
 * gap is the one between the two people's boxes and cards stand a card gap away from each of them.
 */
export function bezierBetween(teacher: SceneNode, student: SceneNode, space?: RunSpace): BezierPath {
  const dx = student.center.x - teacher.center.x;
  const dy = student.center.y - teacher.center.y;
  const overlap = Math.abs(dx) < (teacher.width + student.width) / 2;
  let start: Point;
  let end: Point;
  let control1: Point;
  let control2: Point;
  if (overlap) {
    const lean = dx >= 0 ? 1 : -1;
    const widest = Math.max(BEZIER_MIN_REACH, Math.abs(dy) / 4);
    const cards = space?.beside ?? cardsBeside(teacher, student);
    const own = [teacher, student];
    const clear = (side: number, reach: number, lead: number) =>
      clearBeside(besideCurve(teacher, student, side, reach, lead), cards, own);
    let chosen = { side: lean, reach: widest, lead: 0 };
    if (!clear(lean, widest, 0)) {
      // The widest swing that clears the cards beside them, on either side (the student's side on
      // a tie): a bulge if one clears them, else the drop with the least lead that does.
      let best: { side: number; reach: number; lead: number } | null = null;
      for (const lead of [0, 0.25, 0.5, 0.75, 1].map((f) => f * Math.abs(dy))) {
        for (const side of [lean, -lean]) {
          if (!clear(side, SIDE_MIN_REACH, lead)) continue;
          let lo = SIDE_MIN_REACH;
          let hi = widest;
          if (clear(side, hi, lead)) lo = hi;
          for (let i = 0; i < 16 && lo < hi; i++) {
            const mid = (lo + hi) / 2;
            if (clear(side, mid, lead)) lo = mid;
            else hi = mid;
          }
          if (!best || lo > best.reach) best = { side, reach: lo, lead };
        }
        if (best) break;
      }
      // Nothing clears them: the curve keeps its widest bulge on the student's side.
      if (best) chosen = best;
    }
    [start, control1, control2, end] = besideCurve(teacher, student, chosen.side, chosen.reach, chosen.lead);
  } else {
    const side = dx > 0 ? 1 : -1;
    const sx = side > 0 ? teacher.x + teacher.width : teacher.x;
    const ex = side > 0 ? student.x : student.x + student.width;
    const run = space ?? {
      top: teacher.y + teacher.height,
      bottom: student.y,
      teacherRow: Math.abs(ex - sx) > 2 * CARD_GAP ? sx + side * CARD_GAP : null,
      studentRow: Math.abs(ex - sx) > 2 * CARD_GAP ? ex - side * CARD_GAP : null,
    };
    start = point(sx, teacher.center.y);
    end = point(ex, student.center.y);
    // The S with level ends, when it passes no card of the two rows.
    const sReach = Math.max(BEZIER_MIN_REACH, Math.abs(ex - sx) / 2);
    const s: RunEnds = { x: [sx, sx + side * sReach, ex - side * sReach, ex], side, teacher, student, space: run };
    if (clearOfNeighbours(s, [teacher.center.y, teacher.center.y, student.center.y, student.center.y])) {
      control1 = point(sx + side * sReach, teacher.center.y);
      control2 = point(ex - side * sReach, student.center.y);
    } else {
      const reach = Math.min(RUN_REACH, Math.abs(ex - sx) / 2);
      const { y1, y2 } = runHeights({ x: [sx, sx + side * reach, ex - side * reach, ex], side, teacher, student, space: run });
      control1 = point(sx + side * reach, y1);
      control2 = point(ex - side * reach, y2);
    }
  }
  const midpoint = point(
    cubicAt(start.x, control1.x, control2.x, end.x, 0.5),
    cubicAt(start.y, control1.y, control2.y, end.y, 0.5),
  );
  return { type: 'bezier', start, control1, control2, end, midpoint };
}

/**
 * The room of a curve from `teacher` to `student` in a scene (RunSpace): the gap above the
 * student's row, which is always lower than the teacher's (ranks), and the nearest cards between
 * the two people in their rows, or, when they overlap horizontally, the cards beside them.
 */
function runSpace(teacher: SceneNode, student: SceneNode, nodes: readonly SceneNode[], rowBottom: readonly number[]): RunSpace {
  const side = student.center.x > teacher.center.x ? 1 : -1;
  const sx = side > 0 ? teacher.x + teacher.width : teacher.x;
  const ex = side > 0 ? student.x : student.x + student.width;
  const lo = Math.min(sx, ex);
  const hi = Math.max(sx, ex);
  let teacherRow: number | null = null;
  let studentRow: number | null = null;
  for (const node of nodes) {
    if (node === teacher || node === student || node.x + node.width <= lo || node.x >= hi) continue;
    // The side of the card that faces the teacher, and the side that faces the student.
    const facingTeacher = side > 0 ? node.x : node.x + node.width;
    const facingStudent = side > 0 ? node.x + node.width : node.x;
    if (node.rank === teacher.rank && (teacherRow === null || (facingTeacher - teacherRow) * side < 0)) teacherRow = facingTeacher;
    if (node.rank === student.rank && (studentRow === null || (facingStudent - studentRow) * side > 0)) studentRow = facingStudent;
  }
  const above = rowBottom[student.rank - 1];
  const space: RunSpace = {
    top: above !== undefined && above <= student.y ? above : teacher.y + teacher.height,
    bottom: student.y,
    teacherRow,
    studentRow,
  };
  if (Math.abs(student.center.x - teacher.center.x) < (teacher.width + student.width) / 2) {
    // The cards of the rows from the teacher's to the student's within the widest swing of a curve beside them.
    const reach = Math.max(BEZIER_MIN_REACH, Math.abs(student.center.y - teacher.center.y) / 4) + RUN_CLEARANCE;
    const from = Math.min(teacher.x, student.x) - reach;
    const to = Math.max(teacher.x + teacher.width, student.x + student.width) + reach;
    space.beside = nodes.filter(
      (n) => n !== teacher && n !== student && n.rank >= teacher.rank && n.rank <= student.rank && n.x < to && n.x + n.width > from,
    );
  }
  return space;
}

/**
 * Where the "Teacher in {lineage}" label of a curve goes (plan §4.6): its midpoint, or, on a
 * curve whose run is longer than LABEL_NEAR_STUDENT_RUN, on the run half a card before the
 * student, so the label is on screen whenever the student is; the midpoint of such a curve lies
 * far from both people (graph-7). Never past the point where the curve leaves the height of its
 * run to drop into the student's side.
 */
export function bezierLabelPoint(path: BezierPath): Point {
  const run = path.end.x - path.start.x;
  if (Math.abs(run) <= LABEL_NEAR_STUDENT_RUN) return path.midpoint;
  const at = (t: number) => ({
    x: cubicAt(path.start.x, path.control1.x, path.control2.x, path.end.x, t),
    y: cubicAt(path.start.y, path.control1.y, path.control2.y, path.end.y, t),
  });
  // x runs one way along the curve: the first t from the middle that is LABEL_LEAD from the end.
  const target = path.end.x - Math.sign(run) * LABEL_LEAD;
  let lo = 0.5;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if ((at(mid).x - target) * Math.sign(run) < 0) lo = mid;
    else hi = mid;
  }
  // Back along the curve while the label there would reach down into the student's row.
  const drop = Math.sign(path.end.y - path.midpoint.y);
  let t = lo;
  while (t > 0.5 && (path.end.y - at(t).y) * drop < LABEL_CLEAR_OF_STUDENT) t = Math.max(0.5, t - 1 / 256);
  const p = at(t);
  return point(p.x, p.y);
}

/**
 * The gap between two lineage columns, besides ELK's padding of each (12 px), in px: twice the
 * gap between two cards of a row. Two columns of one card each then fit side by side in full cards
 * on a 390 px phone, as two cards of one row do (React Flow's fit there leaves (390 - 50) / 0.75 =
 * 453 px for the cards; 2 x 200 + 24 + 2 x 12 = 448).
 */
export const COLUMN_GAP = 24;

/**
 * Room above the top row for the headers of the lineage columns when a view has two or more,
 * in px: the scene's bounds include it, so a fitted view shows the headers.
 */
export const COLUMN_HEADER_SPACE = 40;

/**
 * How much higher than ELK's least gap between two rows (`nodeNodeBetweenLayers`) a gap is when
 * a Bézier curve runs along it to a student of the lower row, in px. The shared trunks (b5)
 * leave ELK's least gap between most rows, which is too low for a curve to turn into it and out
 * again beside its two people.
 */
export const CURVE_RUN_EXTRA = 40;

/** How many rounds the gaps of curves that still run behind a card grow (by half each time). */
const CURVE_ROOM_ROUNDS = 6;

/** Points a curve is checked at for cards it runs behind (curveClear): 1/2 px steps on a 1000 px curve. */
const CURVE_CHECK_SAMPLES = 2048;

/** The highest a gap grows for a curve, in px. */
const CURVE_RUN_MAX_GAP = 600;

/**
 * Whether a curve passes behind no card of its teacher's row and its student's row (other than
 * theirs), sampled at CURVE_CHECK_SAMPLES points: the property bezierBetween aims for, which a long curve in a
 * low gap cannot always keep (runHeights).
 */
function curveClear(path: BezierPath, teacher: SceneNode, student: SceneNode, nodes: readonly SceneNode[]): boolean {
  // Only cards within the hull of the control points can be behind the curve.
  const xs = [path.start.x, path.control1.x, path.control2.x, path.end.x];
  const ys = [path.start.y, path.control1.y, path.control2.y, path.end.y];
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const cards = nodes.filter(
    (n) =>
      (n.rank === teacher.rank || n.rank === student.rank) &&
      n !== teacher &&
      n !== student &&
      n.x < maxX &&
      n.x + n.width > minX &&
      n.y < maxY &&
      n.y + n.height > minY,
  );
  if (cards.length === 0) return true;
  for (let i = 1; i < CURVE_CHECK_SAMPLES; i++) {
    const t = i / CURVE_CHECK_SAMPLES;
    const x = cubicAt(path.start.x, path.control1.x, path.control2.x, path.end.x, t);
    const y = cubicAt(path.start.y, path.control1.y, path.control2.y, path.end.y, t);
    for (const card of cards) if (x > card.x && x < card.x + card.width && y > card.y && y < card.y + card.height) return false;
  }
  return true;
}

/** One lineage column of a view, laid out by ELK on its own (layout.ts). */
export interface LaidOutColumn {
  /** The lineage of the column (`lineageBands`). */
  key: string;
  build: ElkGraphBuild;
  laidOut: ElkNode;
}

/**
 * Where each column's rows go: ELK lays out every column on its own, so a row of generations
 * has its own height in each. The rows of the scene take the largest gap between two rows over
 * the columns (the gap holds the horizontal runs of the routes), a column without people in
 * some rows keeps at least the gap it had between the rows it has, and a gap that a curve runs
 * along (`runGaps`, by the rank above it) is at least as high as given. Returns the top of every row.
 */
function sceneRows(
  columns: { tops: Map<number, number> }[],
  rankCount: number,
  cardHeight: number,
  defaultGap: number,
  runGaps: ReadonlyMap<number, number>,
): number[] {
  const gap: number[] = Array.from({ length: rankCount }, () => Number.NEGATIVE_INFINITY);
  const reach: { from: number; to: number; channel: number }[] = [];
  let first = Number.POSITIVE_INFINITY;
  for (const { tops } of columns) {
    const present = [...tops.keys()].sort((a, b) => a - b);
    if (present.length > 0) first = Math.min(first, tops.get(present[0]!)!);
    for (let i = 1; i < present.length; i++) {
      const from = present[i - 1]!;
      const to = present[i]!;
      const channel = tops.get(to)! - (tops.get(from)! + cardHeight);
      if (to === from + 1) gap[from] = Math.max(gap[from]!, channel);
      else reach.push({ from, to, channel });
    }
  }
  const top: number[] = [];
  for (let r = 0; r < rankCount; r++) {
    if (r === 0) {
      top.push(Number.isFinite(first) ? first : 0);
      continue;
    }
    const before = gap[r - 1]!;
    let y = top[r - 1]! + cardHeight + Math.max(Number.isFinite(before) ? before : defaultGap, runGaps.get(r - 1) ?? 0);
    for (const span of reach) if (span.to === r) y = Math.max(y, top[span.from]! + cardHeight + span.channel);
    top.push(y);
  }
  return top;
}

/**
 * Maps a y of a column's own layout to the scene: inside a row it keeps its distance from the
 * top of the row, and in the gap below a row it keeps its distance from the bottom of the row,
 * so the horizontal runs of the routes stay right under their teachers and a route stays
 * orthogonal (the map only moves rows and gaps apart).
 */
function columnY(tops: Map<number, number>, rows: readonly number[], cardHeight: number): (y: number) => number {
  const present = [...tops.keys()].sort((a, b) => a - b);
  return (y) => {
    for (let i = 0; i < present.length; i++) {
      const rank = present[i]!;
      const top = tops.get(rank)!;
      if (y < top) {
        if (i === 0) return rows[rank]! - (top - y);
        const above = present[i - 1]!;
        return rows[above]! + cardHeight + (y - (tops.get(above)! + cardHeight));
      }
      if (y <= top + cardHeight) return rows[rank]! + (y - top);
    }
    const last = present[present.length - 1];
    if (last === undefined) return y;
    return rows[last]! + cardHeight + (y - (tops.get(last)! + cardHeight));
  };
}

/**
 * Turns the ELK results into a scene: node slots with boxes for the three levels of detail,
 * orthogonal paths for the edges ELK routed and Bézier curves for the other edges (to a teacher
 * from another lineage, or between two lineage columns) (plan §4.1, §4.6).
 *
 * `view` is the ELK graph of the whole view (model order, spine, focus, preset); `columns` are
 * the lineage columns, each laid out on its own, left to right (one column: the whole view).
 * The columns stand side by side, COLUMN_GAP apart, with every row of generations at one height
 * across them; `curves` are the edges that no column routed.
 */
export function buildScene(
  graph: LineageGraph,
  ranks: RankResult,
  view: ElkGraphBuild,
  columns: readonly LaidOutColumn[],
  curves: readonly LineageEdge[],
): Scene {
  const cardHeight = NODE_SIZES[view.nodeSize].height;
  const spineEdgeIds = new Set(view.spine.map((e) => e.id));
  const spineNodeIds = new Set<string>();
  for (const edge of view.spine) {
    spineNodeIds.add(edge.studentId);
    spineNodeIds.add(edge.teacherId);
  }
  const focusId = view.focusId;

  // The columns: their rows, their place from the left and the map of their y.
  const measured = columns.map((column) => {
    const tops = new Map<number, number>();
    for (const child of column.laidOut.children ?? []) {
      const rank = ranks.ranks.get(child.id);
      if (rank === undefined) continue;
      const y = child.y ?? 0;
      tops.set(rank, Math.min(tops.get(rank) ?? y, y));
    }
    return { column, tops };
  });
  const defaultGap = Number(layoutPresets[view.preset]['elk.layered.spacing.nodeNodeBetweenLayers'] ?? 60);
  // The gap above the student's row of every curve: at least CURVE_RUN_EXTRA more than ELK's
  // least gap, and more where a curve still runs behind a card of its two rows.
  const runGaps = new Map<number, number>();
  for (const edge of curves) {
    const rank = ranks.ranks.get(edge.studentId);
    if (rank !== undefined && rank > 0) runGaps.set(rank - 1, defaultGap + CURVE_RUN_EXTRA);
  }
  const place = () => {
    const rows = sceneRows(measured, ranks.rankCount, cardHeight, defaultGap, runGaps);
    let left = 0;
    const placed = measured.map(({ column, tops }) => {
      const width = column.laidOut.width ?? 0;
      const at = { column, dx: left, width, mapY: columnY(tops, rows, cardHeight) };
      left += width + COLUMN_GAP;
      return at;
    });
    const sceneWidth = placed.length === 0 ? 0 : left - COLUMN_GAP;
    let sceneHeight = 0;
    for (const { column, mapY } of placed) sceneHeight = Math.max(sceneHeight, mapY(column.laidOut.height ?? 0));

    const childOf = new Map<string, { child: ElkNode; at: (typeof placed)[number] }>();
    for (const at of placed) for (const child of at.column.laidOut.children ?? []) childOf.set(child.id, { child, at });

    const nodes: SceneNode[] = view.order.map((id) => {
      const found = childOf.get(id);
      if (!found) throw new ElkLayoutError(`no position for node ${id}`);
      const { child, at } = found;
      const width = child.width ?? NODE_SIZES[view.nodeSize].width;
      const height = child.height ?? cardHeight;
      const x = roundCoord((child.x ?? 0) + at.dx);
      const y = roundCoord(at.mapY(child.y ?? 0));
      const center = point(x + width / 2, y + height / 2);
      const boxes = Object.fromEntries(DETAIL_LEVELS.map((level) => [level, centredBox(center, level)])) as Record<
        DetailLevel,
        Box
      >;
      return {
        id,
        rank: ranks.ranks.get(id)!,
        cutOff: ranks.cutOff.has(id),
        onSpine: spineNodeIds.has(id) || id === focusId,
        x,
        y,
        width,
        height,
        center,
        boxes,
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));

    const edges: SceneEdge[] = [];
    for (const { column, dx, mapY } of placed) {
      const elkEdgeResults = new Map((column.laidOut.edges ?? []).map((e) => [e.id, e]));
      for (const edge of column.build.elkEdges) {
        const routed = elkEdgeResults.get(edge.id);
        const sections = routed && 'sections' in routed ? (routed.sections ?? []) : [];
        if (sections.length === 0) throw new ElkLayoutError(`no route for edge ${edge.id}`);
        const points: Point[] = [];
        for (const section of sections) {
          for (const p of [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]) {
            const next = point(p.x + dx, mapY(p.y));
            const last = points[points.length - 1];
            if (!last || last.x !== next.x || last.y !== next.y) points.push(next);
          }
        }
        const path: OrthogonalPath = { type: 'orthogonal', points };
        edges.push({
          id: edge.id,
          teacherId: edge.teacherId,
          studentId: edge.studentId,
          lineageId: edge.lineageId,
          kind: edge.kind,
          routedBy: 'elk',
          onSpine: spineEdgeIds.has(edge.id),
          bends: Math.max(0, points.length - 2),
          path,
        });
      }
    }
    const rowY: number[] = [];
    const rowBottom: number[] = [];
    for (const node of nodes) {
      const current = rowY[node.rank];
      rowY[node.rank] = current === undefined ? node.y : Math.min(current, node.y);
      rowBottom[node.rank] = Math.max(rowBottom[node.rank] ?? Number.NEGATIVE_INFINITY, node.y + node.height);
    }

    for (const edge of curves) {
      const teacher = byId.get(edge.teacherId)!;
      const student = byId.get(edge.studentId)!;
      edges.push({
        id: edge.id,
        teacherId: edge.teacherId,
        studentId: edge.studentId,
        lineageId: edge.lineageId,
        kind: edge.kind,
        routedBy: 'scene',
        onSpine: spineEdgeIds.has(edge.id),
        bends: 0,
        path: bezierBetween(teacher, student, runSpace(teacher, student, nodes, rowBottom)),
      });
    }
    return { rows, placed, sceneWidth, sceneHeight, childOf, nodes, edges, rowY };
  };
  // A gap with a curve that still runs behind a card grows, by half each round, and keeps the
  // height with the fewest such curves (the lowest of equals): a curve beside its two people
  // is not shaped by the gap, and a growth that does not help it is undone.
  // The curves still behind a card, by the gap above their student's row.
  const crampedIn = (placed: ReturnType<typeof place>) => {
    const byId = new Map(placed.nodes.map((n) => [n.id, n]));
    const cramped = new Map<number, number>();
    for (const edge of placed.edges) {
      if (edge.path.type !== 'bezier') continue;
      const student = byId.get(edge.studentId)!;
      if (!runGaps.has(student.rank - 1)) continue;
      if (!curveClear(edge.path, byId.get(edge.teacherId)!, student, placed.nodes)) {
        cramped.set(student.rank - 1, (cramped.get(student.rank - 1) ?? 0) + 1);
      }
    }
    return cramped;
  };
  const sum = (counts: ReadonlyMap<number, number>) => [...counts.values()].reduce((a, b) => a + b, 0);
  let attempt = place();
  const best = new Map<number, { gap: number; cramped: number }>();
  // The round with the fewest such curves in all, for a curve whose ends are more than a row
  // apart, which the heights of more than one gap shape.
  let bestRound = { gaps: new Map(runGaps), cramped: Number.POSITIVE_INFINITY };
  for (let round = 0; round <= CURVE_ROOM_ROUNDS; round++) {
    const cramped = crampedIn(attempt);
    if (sum(cramped) < bestRound.cramped) bestRound = { gaps: new Map(runGaps), cramped: sum(cramped) };
    let grown = false;
    for (const [rank, gap] of runGaps) {
      const count = cramped.get(rank) ?? 0;
      const kept = best.get(rank);
      if (!kept || count < kept.cramped) best.set(rank, { gap, cramped: count });
      if (count > 0 && round < CURVE_ROOM_ROUNDS && gap < CURVE_RUN_MAX_GAP) {
        runGaps.set(rank, Math.min(CURVE_RUN_MAX_GAP, gap * 1.5));
        grown = true;
      }
    }
    if (!grown) break;
    attempt = place();
  }
  let undone = false;
  for (const [rank, { gap }] of best) {
    if (runGaps.get(rank) !== gap) {
      runGaps.set(rank, gap);
      undone = true;
    }
  }
  if (undone) {
    attempt = place();
    // The heights kept gap by gap were each measured with the other gaps of their round: where
    // together they leave more curves behind a card than one round did, that round's heights stand.
    if (sum(crampedIn(attempt)) > bestRound.cramped) {
      for (const [rank, gap] of bestRound.gaps) runGaps.set(rank, gap);
      attempt = place();
    }
  }
  const { rows, placed, sceneWidth, sceneHeight, childOf, nodes, edges, rowY } = attempt;
  const position = new Map(view.order.map((id, i) => [id, i]));
  edges.sort(
    (a, b) =>
      position.get(a.teacherId)! - position.get(b.teacherId)! ||
      position.get(a.studentId)! - position.get(b.studentId)! ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  // Bounds of everything drawn: the canvas, grown to include the Bézier curves (a cubic curve
  // stays inside the convex hull of its control points, which may bulge left of 0) and the
  // headers of the lineage columns.
  let minX = 0;
  let minY = 0;
  let maxX = sceneWidth;
  let maxY = sceneHeight;
  for (const edge of edges) {
    if (edge.path.type !== 'bezier') continue;
    for (const p of [edge.path.start, edge.path.control1, edge.path.control2, edge.path.end]) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (placed.length >= 2 && rows.length > 0) minY = Math.min(minY, rows[0]! - COLUMN_HEADER_SPACE);
  const columnPeople = new Map<LaidOutColumn, number>();
  for (const { at } of childOf.values()) columnPeople.set(at.column, (columnPeople.get(at.column) ?? 0) + 1);

  return {
    version: 1,
    dataVersion: graph.dataVersion,
    focusId,
    preset: view.preset,
    nodePlacement: view.nodePlacement,
    nodeSize: view.nodeSize,
    width: roundCoord(sceneWidth),
    height: roundCoord(sceneHeight),
    bounds: { x: roundCoord(minX), y: roundCoord(minY), width: roundCoord(maxX - minX), height: roundCoord(maxY - minY) },
    rowY: Array.from(rowY, (y) => y ?? 0),
    nodes,
    edges,
    spine: view.spine.map((e) => e.id),
    bands: placed.map(({ column, dx, width }) => ({
      lineageId: column.key,
      x: roundCoord(dx),
      width: roundCoord(width),
      nodes: columnPeople.get(column) ?? 0,
    })),
  };
}
