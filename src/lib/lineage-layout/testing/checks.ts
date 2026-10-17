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
