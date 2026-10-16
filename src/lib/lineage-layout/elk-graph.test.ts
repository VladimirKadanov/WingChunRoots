import { describe, expect, it } from 'vitest';
import { buildElkGraph } from './elk-graph.ts';
import { indexGraph } from './graph.ts';
import { createElkEngine } from './layout.ts';
import { CHOSEN_NODE_PLACEMENT, NODE_SIZES, RANK_PSEUDO_Y, SPINE_STRAIGHTNESS, layoutPresets } from './presets.ts';
import { computeRanksIndexed } from './ranks.ts';
import { demoGraph } from './testing/build.ts';
import { anchorId, generateSyntheticLineage } from './testing/synthetic.ts';
import { egoView, sharedAncestorView } from './testing/views.ts';

const dataset = generateSyntheticLineage();

function build(graph: Parameters<typeof indexGraph>[0], options: Parameters<typeof buildElkGraph>[2] = {}) {
  const index = indexGraph(graph);
  const ranks = computeRanksIndexed(index);
  return { ranks, ...buildElkGraph(index, ranks, options) };
}

describe('buildElkGraph (plan §4.5)', () => {
  it('always uses INTERACTIVE layering with y = rank × 200, also with a single root', () => {
    const graph = demoGraph(['r', 'a', 'b'], [['r', 'a'], ['a', 'b']]);
    const { elkGraph, ranks } = build(graph);
    expect(elkGraph.layoutOptions?.['elk.layered.layering.strategy']).toBe('INTERACTIVE');
    for (const child of elkGraph.children ?? []) {
      expect(child.y).toBe(ranks.ranks.get(child.id)! * RANK_PSEUDO_Y);
    }
    expect(RANK_PSEUDO_Y).toBeGreaterThan(Math.max(...Object.values(NODE_SIZES).map((s) => s.height)));
  });

  it('every preset keeps INTERACTIVE layering and never uses priority.direction', () => {
    for (const [name, preset] of Object.entries(layoutPresets)) {
      expect(preset['elk.layered.layering.strategy'], name).toBe('INTERACTIVE');
      expect(preset['elk.direction'], name).toBe('DOWN');
      expect(preset['elk.edgeRouting'], name).toBe('ORTHOGONAL');
      expect(Object.keys(preset).some((k) => k.includes('priority.direction')), name).toBe(false);
    }
    expect(layoutPresets.expand['elk.layered.crossingMinimization.semiInteractive']).toBe('true');
    expect(layoutPresets.explorer['elk.layered.nodePlacement.strategy']).toBe(CHOSEN_NODE_PLACEMENT);
  });

  it('uses only option ids that ELK 0.12 knows', async () => {
    const known = new Set((await createElkEngine().knownLayoutOptions()).map((o) => o.id));
    const ids = new Set<string>(['elk.layered.priority.straightness', 'elk.position']);
    for (const preset of Object.values(layoutPresets)) for (const key of Object.keys(preset)) ids.add(key);
    for (const id of ids) {
      expect(known.has(`org.eclipse.${id}`), id).toBe(true);
    }
  });

  it('gives every person exactly one node, with the fixed size of the level of detail', () => {
    const graph = egoView(dataset, anchorId(dataset, 'demo-hub-a'));
    for (const nodeSize of ['full', 'compact', 'dot'] as const) {
      const { elkGraph } = build(graph, { nodeSize });
      const ids = (elkGraph.children ?? []).map((c) => c.id);
      expect(ids.length).toBe(graph.nodes.length);
      expect(new Set(ids).size).toBe(ids.length);
      for (const child of elkGraph.children ?? []) {
        expect([child.width, child.height]).toEqual([NODE_SIZES[nodeSize].width, NODE_SIZES[nodeSize].height]);
      }
    }
  });

  it('leaves edges to a teacher from another lineage out of ELK, while they count for the ranks', () => {
    const graph = sharedAncestorView(dataset);
    const { elkGraph, crossLineageEdges, elkEdges } = build(graph);
    const cross = graph.edges.filter((e) => e.kind === 'crossLineage');
    expect(cross.length).toBeGreaterThan(0);
    expect(crossLineageEdges.map((e) => e.id).sort()).toEqual(cross.map((e) => e.id).sort());
    const elkIds = new Set((elkGraph.edges ?? []).map((e) => e.id));
    for (const edge of cross) expect(elkIds.has(edge.id)).toBe(false);
    expect(elkIds.size).toBe(graph.edges.length - cross.length);
    expect(elkEdges.length).toBe(elkIds.size);
  });

  it('gives the focus spine a higher straightness priority and nothing else', () => {
    const focus = anchorId(dataset, 'demo-two-lineages');
    const graph = egoView(dataset, focus);
    const { elkGraph, spine } = build(graph);
    // demo-two-lineages → its teacher in lineage A → demo-root-a → demo-shared-ancestor.
    expect(spine.length).toBe(3);
    expect(spine[0]!.studentId).toBe(focus);
    expect(spine[spine.length - 1]!.teacherId).toBe(anchorId(dataset, 'demo-shared-ancestor'));
    const spineIds = new Set(spine.map((e) => e.id));
    for (const edge of elkGraph.edges ?? []) {
      const priority = edge.layoutOptions?.['elk.layered.priority.straightness'];
      expect(priority).toBe(spineIds.has(edge.id) ? String(SPINE_STRAIGHTNESS) : undefined);
      expect(Object.keys(edge.layoutOptions ?? {}).some((k) => k.includes('priority.direction'))).toBe(false);
    }
  });

  it('orders nodes by lineage, start year and name, whatever the order of the input', () => {
    const graph = egoView(dataset, anchorId(dataset, 'demo-root-a'));
    const shuffled = { ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() };
    const a = build(graph);
    const b = build(shuffled);
    expect(JSON.stringify(b.elkGraph)).toBe(JSON.stringify(a.elkGraph));
  });

  it('passes previous positions as elk.position only with the expand preset', () => {
    const graph = demoGraph(['r', 'a', 'b'], [['r', 'a'], ['r', 'b']]);
    const previousPositions = { a: { x: 300, y: 260 }, b: { x: 40, y: 260 } };
    const expand = build(graph, { preset: 'expand', previousPositions });
    const a = expand.elkGraph.children!.find((c) => c.id === 'a')!;
    expect(a.layoutOptions?.['elk.position']).toBe(`(300, ${RANK_PSEUDO_Y})`);
    expect(a.x).toBe(300);
    const explorer = build(graph, { preset: 'explorer', previousPositions });
    expect(explorer.elkGraph.children!.every((c) => c.layoutOptions === undefined)).toBe(true);
  });
});
