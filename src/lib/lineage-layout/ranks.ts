import { indexGraph, type GraphIndex } from './graph.ts';
import type { LineageGraph, RankResult } from './types.ts';

/**
 * Ranks (generation rows) of a view, computed in the order of plan §4.4.
 *
 * DEFAULT D22: no global generation number is stored; ranks are computed per view.
 *
 * 1. Ranks without the cut-off teachers: `rank = 0` for the roots of the view, otherwise
 *    `rank = max(rank of the visible teachers) + 1`. Edges to a teacher from another lineage
 *    count as well.
 * 2. Every cut-off teacher gets `rank = min(rank of its students) − 1`, so it sits exactly
 *    one row above its highest student instead of on row 0.
 * 3. If a rank became negative, all ranks shift so that the smallest one is 0.
 *
 * A cut-off teacher is a node without visible teachers whose own teachers exist outside the
 * view (`hiddenCounts[id].teachers > 0`, typically a teacher from another lineage shown
 * without their ancestors) and who teaches someone in the view. A node without visible
 * teachers and without hidden ones is a root of the view.
 *
 * The result satisfies `rank(student) > rank(teacher)` for every edge, including edges to a
 * teacher from another lineage. A cycle throws `LineageCycleError`.
 */
export function computeRanks(graph: LineageGraph): RankResult {
  return computeRanksIndexed(indexGraph(graph));
}

export function computeRanksIndexed(index: GraphIndex): RankResult {
  const { graph, teacherEdges, studentEdges } = index;
  const cutOff = new Set<string>();
  for (const node of graph.nodes) {
    const hiddenTeachers = graph.hiddenCounts?.[node.id]?.teachers ?? 0;
    if (teacherEdges.get(node.id)!.length === 0 && hiddenTeachers > 0 && studentEdges.get(node.id)!.length > 0) {
      cutOff.add(node.id);
    }
  }

  const { order } = index;
  const ranks = new Map<string, number>();

  // Step 1: longest path from the roots of the view, ignoring the cut-off teachers.
  for (const id of order) {
    if (cutOff.has(id)) continue;
    let rank = 0;
    for (const edge of teacherEdges.get(id)!) {
      if (cutOff.has(edge.teacherId)) continue;
      rank = Math.max(rank, ranks.get(edge.teacherId)! + 1);
    }
    ranks.set(id, rank);
  }

  // Step 2: each cut-off teacher sits one row above its highest student. Students of a
  // cut-off teacher are never cut-off themselves (they have a visible teacher), so their
  // ranks are final after step 1.
  for (const id of order) {
    if (!cutOff.has(id)) continue;
    let highest = Number.POSITIVE_INFINITY;
    for (const edge of studentEdges.get(id)!) {
      highest = Math.min(highest, ranks.get(edge.studentId)!);
    }
    ranks.set(id, highest - 1);
  }

  // Step 3: shift so that the smallest rank is 0.
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const rank of ranks.values()) {
    min = Math.min(min, rank);
    max = Math.max(max, rank);
  }
  if (ranks.size > 0 && min !== 0) {
    for (const [id, rank] of ranks) ranks.set(id, rank - min);
    max -= min;
  }

  return { ranks, cutOff, rankCount: ranks.size === 0 ? 0 : max + 1 };
}
