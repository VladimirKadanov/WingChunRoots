/**
 * Properties of a laid-out scene, shared by the unit tests and the benchmark (M03).
 */
import type { LineageGraph, RankResult, Scene } from '../types.ts';

/** Edges (including those to a teacher from another lineage) that break `rank(student) > rank(teacher)`. */
export function rankRuleViolations(graph: LineageGraph, ranks: RankResult): string[] {
  return graph.edges
    .filter((e) => !(ranks.ranks.get(e.studentId)! > ranks.ranks.get(e.teacherId)!))
    .map((e) => e.id);
}

/** Edges whose student is not drawn below its teacher (`y` must follow the rank). */
export function yOrderViolations(scene: Scene): string[] {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  return scene.edges.filter((e) => !(byId.get(e.studentId)!.y > byId.get(e.teacherId)!.y)).map((e) => e.id);
}

/** Ranks whose nodes do not all share one y-coordinate. */
export function ranksWithSeveralY(scene: Scene): number[] {
  const ys = new Map<number, Set<number>>();
  for (const node of scene.nodes) {
    if (!ys.has(node.rank)) ys.set(node.rank, new Set());
    ys.get(node.rank)!.add(node.y);
  }
  return [...ys].filter(([, set]) => set.size > 1).map(([rank]) => rank);
}

/** True when the row y-coordinates strictly increase with the rank. */
export function rowsIncrease(scene: Scene): boolean {
  return scene.rowY.every((y, i) => i === 0 || y > scene.rowY[i - 1]!);
}

/** Bend points on the focus spine (plan §4.5: the spine must be straight). */
export function spineBends(scene: Scene): number {
  let bends = 0;
  for (const edge of scene.edges) {
    if (!edge.onSpine) continue;
    if (edge.path.type !== 'orthogonal') return Number.POSITIVE_INFINITY;
    const [first, ...rest] = edge.path.points;
    const last = rest[rest.length - 1];
    bends += edge.bends;
    // A straight orthogonal edge in a DOWN layout is vertical.
    if (first && last && first.x !== last.x) bends += 1;
  }
  return bends;
}

/**
 * For the nodes present in both scenes and on the same rank in both, the pairs whose
 * left-to-right order in the row changed.
 */
export function rowOrderFlips(before: Scene, after: Scene): { pairs: number; flips: number; rankMoves: number } {
  const later = new Map(after.nodes.map((n) => [n.id, n]));
  const rows = new Map<number, Scene['nodes']>();
  let rankMoves = 0;
  for (const node of before.nodes) {
    const next = later.get(node.id);
    if (!next) continue;
    if (next.rank !== node.rank) {
      rankMoves++;
      continue;
    }
    if (!rows.has(node.rank)) rows.set(node.rank, []);
    rows.get(node.rank)!.push(node);
  }
  let pairs = 0;
  let flips = 0;
  for (const row of rows.values()) {
    for (let i = 0; i < row.length; i++) {
      for (let j = i + 1; j < row.length; j++) {
        const a = row[i]!;
        const b = row[j]!;
        pairs++;
        if (Math.sign(a.x - b.x) !== Math.sign(later.get(a.id)!.x - later.get(b.id)!.x)) flips++;
      }
    }
  }
  return { pairs, flips, rankMoves };
}

/** Top-left positions of a scene, as `previousPositions` for the expand preset. */
export function positionsOf(scene: Scene): Record<string, { x: number; y: number }> {
  return Object.fromEntries(scene.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
}

/**
 * Rows as bands (stacked students, ADR 0017): every person stands inside the band of its rank,
 * from the row's line (`rowY`) to above the next row's line, and the first person of every rank
 * stands on the line. Returns the ids of the people outside their band.
 */
export function outsideBands(scene: Scene): string[] {
  const out: string[] = [];
  const top = new Map<number, number>();
  for (const n of scene.nodes) top.set(n.rank, Math.min(top.get(n.rank) ?? Number.POSITIVE_INFINITY, n.y));
  for (const n of scene.nodes) {
    const next = scene.rowY[n.rank + 1];
    if (n.y < scene.rowY[n.rank]! || (next !== undefined && n.y + n.height >= next)) out.push(n.id);
  }
  for (const [rank, y] of top) if (y !== scene.rowY[rank]) out.push(`row ${rank}`);
  return out;
}

/** Pairs of cards whose slots overlap. */
export function overlappingCards(scene: Scene): string[] {
  const out: string[] = [];
  const nodes = [...scene.nodes].sort((a, b) => a.x - b.x);
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    for (let j = i + 1; j < nodes.length && nodes[j]!.x < a.x + a.width; j++) {
      const b = nodes[j]!;
      if (a.y < b.y + b.height && b.y < a.y + a.height) out.push(`${a.id}/${b.id}`);
    }
  }
  return out;
}

/**
 * Orthogonal routes that run through a card (its inside, not its border) or that do not end on the
 * student's top side: in its middle, or (a student with several teachers, ADR 0005 b6) anywhere on it.
 */
export function routeFaults(scene: Scene): string[] {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  for (const e of scene.edges) {
    if (e.path.type !== 'orthogonal') continue;
    const p = e.path.points;
    const s = byId.get(e.studentId)!;
    const last = p[p.length - 1]!;
    const several = scene.edges.filter((o) => o.studentId === e.studentId && o.path.type === 'orthogonal').length > 1;
    const offMiddle = several ? last.x < s.x || last.x > s.x + s.width : Math.abs(last.x - s.center.x) > 0.5;
    if (offMiddle || Math.abs(last.y - s.y) > 0.5) out.push(`${e.id}: end`);
    for (let i = 1; i < p.length; i++) {
      const [a, b] = [p[i - 1]!, p[i]!];
      for (const n of scene.nodes) {
        const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
        const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
        if (hi.x > n.x + 0.5 && lo.x < n.x + n.width - 0.5 && hi.y > n.y + 0.5 && lo.y < n.y + n.height - 0.5) {
          out.push(`${e.id}: through ${n.id}`);
        }
      }
    }
  }
  return out;
}

/**
 * Horizontal runs of two teachers' routes on one level that overlap: they would read as one line.
 * Runs of one teacher may share a level (its trunk).
 */
export function sharedRuns(scene: Scene): string[] {
  const runs = new Map<number, { teacher: string; lo: number; hi: number; id: string }[]>();
  for (const e of scene.edges) {
    if (e.path.type !== 'orthogonal') continue;
    const p = e.path.points;
    for (let i = 1; i < p.length; i++) {
      const [a, b] = [p[i - 1]!, p[i]!];
      if (a.y !== b.y || a.x === b.x) continue;
      const list = runs.get(a.y) ?? [];
      list.push({ teacher: e.teacherId, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), id: e.id });
      runs.set(a.y, list);
    }
  }
  const out: string[] = [];
  for (const [y, list] of runs) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [r, q] = [list[i]!, list[j]!];
        if (r.teacher !== q.teacher && r.lo < q.hi && q.lo < r.hi) out.push(`${r.id}/${q.id} at ${y}`);
      }
    }
  }
  return out;
}
