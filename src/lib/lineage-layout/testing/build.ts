/**
 * Small hand-made graphs for unit tests. Ids double as names ("Demo <id>"), all fictional.
 */
import type { EdgeKind, HiddenCount, LineageEdge, LineageGraph, LineageNode } from '../types.ts';

export type EdgeSpec = [teacher: string, student: string, kind?: EdgeKind, lineage?: string];

export function demoNode(id: string, lineage = 'demo-lineage-x'): LineageNode {
  return {
    id,
    displayName: `Demo ${id}`,
    altNames: [],
    lifeStatus: 'living',
    claimState: 'claimed',
    lineageIds: [lineage],
    childCount: 0,
    hasMoreChildren: false,
  };
}

/** Builds a §6.3 graph from node ids and `[teacher, student, kind?, lineage?]` edges. */
export function demoGraph(
  nodeIds: string[],
  edgeSpecs: EdgeSpec[],
  options: { focusId?: string | null; hidden?: Record<string, HiddenCount> } = {},
): LineageGraph {
  const seenStudent = new Set<string>();
  const edges: LineageEdge[] = edgeSpecs.map(([teacherId, studentId, kind = 'primary', lineage], i) => {
    const primary = kind !== 'crossLineage' && !seenStudent.has(studentId);
    if (primary) seenStudent.add(studentId);
    return {
      id: `demo-edge-${String(i + 1).padStart(3, '0')}`,
      teacherId,
      studentId,
      lineageId: lineage ?? (kind === 'crossLineage' ? 'demo-lineage-y' : 'demo-lineage-x'),
      kind,
      status: 'verified',
      isDisplayPrimary: primary,
      visibility: 'public',
      periods: [{ from: '2001', to: null, ongoing: true, precision: 'year' }],
    };
  });
  return {
    focusId: options.focusId ?? null,
    dataVersion: 'demo-test',
    nodes: nodeIds.map((id) => demoNode(id)),
    edges,
    hiddenCounts: options.hidden ?? {},
  };
}
