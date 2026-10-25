// The generation label of a person in the explorer (plan §4.4, D22): a generation number is never
// stored, it is read from the view.
//
// "Generation N from {root}" is shown only when the person's chain of teachers in the view (the
// display-primary teacher first, DEFAULT D05) reaches the lineage's recorded root
// (lineage.root_person_id) and every edge on that chain is verified; the root is generation 1,
// as the routes of descent count it. Otherwise the label is "N generations below {name} in this
// view", counted to the top of the chain in this view, or nothing for the top itself. So the
// number never changes with the depth of the view, and it never looks like a generation in the
// lineage when it is not one. DEFAULT D22: a root may be unknown (no lineage label then).
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
function chainEdge(incoming: readonly Edge[]): Edge | undefined {
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

  const labels = new Map<string, GenerationLabel>();
  for (const node of graph.nodes) {
    if (roots.has(node.id)) continue;
    const seen = new Set([node.id]);
    let current = node.id;
    let steps = 0;
    let allVerified = true;
    let lineageLabel: GenerationLabel | null = null;
    for (;;) {
      const edge = chainEdge(incoming.get(current) ?? []);
      if (!edge || seen.has(edge.teacherId)) break;
      allVerified &&= edge.status === 'verified';
      steps += 1;
      current = edge.teacherId;
      seen.add(current);
      const lineage = lineages.get(edge.lineageId);
      if (lineage?.rootPersonId === current) {
        if (allVerified) {
          lineageLabel = { kind: 'lineage', generation: steps + 1, rootId: current, rootName: names.get(current) ?? '', lineageName: lineage.name };
        }
        break;
      }
    }
    if (lineageLabel) labels.set(node.id, lineageLabel);
    else if (steps > 0) labels.set(node.id, { kind: 'view', below: steps, anchorId: current, anchorName: names.get(current) ?? '' });
  }
  return labels;
}
