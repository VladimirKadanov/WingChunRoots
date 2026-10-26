// The generation label of a person in the explorer (plan §4.4, D22): a generation number is never
// stored, it is read from the view.
//
// "Generation N from {root}" is shown only when the person's chain of teachers in the view (the
// display-primary teacher first, DEFAULT D05) reaches the lineage's recorded root
// (lineage.root_person_id), every edge on that chain is verified and in that lineage; the root is generation 1,
// as the routes of descent count it. The chain stays in the lineage of the person's own link to
// their teacher: where a teacher's display-primary teacher is in another lineage, it follows that
// teacher's teacher in this one, so a student of a lineage is counted in it. Otherwise the label
// is "N generations below {name} in this view", counted along the display-primary chain to the
// top of the view, or nothing for the top itself. So the number never changes with the depth of
// the view, and it never looks like a generation in the lineage when it is not one. DEFAULT D22:
// a root may be unknown (no lineage label then).
//
// Pure: no React, so the unit tests and the canvas share it.

import type { LineageGraphDto } from '@/server/dto/public';

type Graph = Pick<LineageGraphDto, 'nodes' | 'edges' | 'lineages'>;
type Edge = Graph['edges'][number];

export type GenerationLabel =
  | { kind: 'lineage'; generation: number; rootId: string; rootName: string; lineageName: string }
  | { kind: 'view'; below: number; anchorId: string; anchorName: string };

/** The words of a label. */
export function generationText(label: GenerationLabel): string {
  if (label.kind === 'lineage') return `Generation ${label.generation} from ${label.rootName}`;
  return `${label.below} ${label.below === 1 ? 'generation' : 'generations'} below ${label.anchorName} in this view`;
}

/** The teacher edge a chain follows from a student: display-primary first, then a primary kind, then by teacher id. */
export function chainEdge<E extends Pick<Edge, 'isDisplayPrimary' | 'kind' | 'teacherId'>>(incoming: readonly E[]): E | undefined {
  return [...incoming].sort(
    (a, b) =>
      Number(b.isDisplayPrimary) - Number(a.isDisplayPrimary) ||
      Number(b.kind === 'primary') - Number(a.kind === 'primary') ||
      a.teacherId.localeCompare(b.teacherId),
  )[0];
}

/** The label of every person in the view (people at the top of the view, and lineage roots, get none). */
export function generationLabels(graph: Graph): Map<string, GenerationLabel> {
  const names = new Map(graph.nodes.map((n) => [n.id, n.displayName]));
  const lineages = new Map(graph.lineages.map((l) => [l.id, l]));
  const roots = new Set(graph.lineages.map((l) => l.rootPersonId).filter((id): id is string => id !== null));
  const incoming = new Map<string, Edge[]>();
  for (const e of graph.edges) incoming.set(e.studentId, [...(incoming.get(e.studentId) ?? []), e]);

  /** The generation of `start` in `lineageId`: its chain within that lineage, verified all the way to the lineage's root. */
  const lineageGeneration = (start: string, lineageId: string): GenerationLabel | null => {
    const lineage = lineages.get(lineageId);
    if (!lineage?.rootPersonId) return null;
    const seen = new Set([start]);
    let current = start;
    let steps = 0;
    for (;;) {
      const edge = chainEdge((incoming.get(current) ?? []).filter((e) => e.lineageId === lineageId));
      if (!edge || edge.status !== 'verified' || seen.has(edge.teacherId)) return null;
      steps += 1;
      current = edge.teacherId;
      seen.add(current);
      if (current === lineage.rootPersonId) {
        return { kind: 'lineage', generation: steps + 1, rootId: current, rootName: names.get(current) ?? '', lineageName: lineage.name };
      }
    }
  };

  /** How far below the top of its display-primary chain `start` is (stopping at a lineage root). */
  const viewGeneration = (start: string): GenerationLabel | null => {
    const seen = new Set([start]);
    let current = start;
    let steps = 0;
    for (;;) {
      const edge = chainEdge(incoming.get(current) ?? []);
      if (!edge || seen.has(edge.teacherId)) break;
      steps += 1;
      current = edge.teacherId;
      seen.add(current);
      if (lineages.get(edge.lineageId)?.rootPersonId === current) break;
    }
    return steps > 0 ? { kind: 'view', below: steps, anchorId: current, anchorName: names.get(current) ?? '' } : null;
  };

  const labels = new Map<string, GenerationLabel>();
  for (const node of graph.nodes) {
    if (roots.has(node.id)) continue;
    const own = chainEdge(incoming.get(node.id) ?? []);
    if (!own) continue;
    const label = lineageGeneration(node.id, own.lineageId) ?? viewGeneration(node.id);
    if (label) labels.set(node.id, label);
  }
  return labels;
}
