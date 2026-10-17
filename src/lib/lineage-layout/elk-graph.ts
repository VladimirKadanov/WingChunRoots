import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk.bundled.js';
import { LineageInputError } from './errors.ts';
import { focusSpine, isObject, modelOrder, type GraphIndex } from './graph.ts';
import {
  CHOSEN_NODE_PLACEMENT,
  NODE_PLACEMENTS,
  NODE_SIZES,
  RANK_PSEUDO_Y,
  SPINE_STRAIGHTNESS,
  layoutPresets,
} from './presets.ts';
import type { DetailLevel, LayoutOptions, LineageEdge, NodePlacement, Point, PresetName, RankResult } from './types.ts';

/** Id of the ELK root node. Node ids of the view never collide with it: they are children. */
export const ELK_ROOT_ID = '__lineage_root__';

export interface ElkGraphBuild {
  elkGraph: ElkNode;
  /** Node ids in model order (the order of `elkGraph.children`). */
  order: string[];
  /** Edges handed to ELK, in the order of `elkGraph.edges`. */
  elkEdges: LineageEdge[];
  /** Edges to a teacher from another lineage: ranked, but not routed by ELK (plan §4.6). */
  crossLineageEdges: LineageEdge[];
  /** Focus spine edges, from the focus upwards. */
  spine: LineageEdge[];
  /** The focused person used for the spine (option or `graph.focusId`). */
  focusId: string | null;
  preset: PresetName;
  nodePlacement: NodePlacement;
  nodeSize: DetailLevel;
}

/**
 * Turns ranks into an ELK graph with the settings of plan §4.5.
 *
 * - Layering is always INTERACTIVE with the pseudo y-coordinate `rank × 200`, also with a
 *   single root, so ELK's layers are exactly our ranks (plan §4.4).
 * - Edges to a teacher from another lineage are not given to ELK; they took part in the
 *   ranks and the scene draws them as Bézier curves (plan §4.6).
 * - Focus spine edges get a higher `elk.layered.priority.straightness`;
 *   `elk.layered.priority.direction` is not used (plan §4.5).
 * - Children and edges follow the model order, which `considerModelOrder` keeps stable.
 */
export function buildElkGraph(index: GraphIndex, ranks: RankResult, options: LayoutOptions = {}): ElkGraphBuild {
  if (!isObject(options as unknown)) {
    throw new LineageInputError('The layout options must be an object.');
  }
  const preset = options.preset ?? 'explorer';
  const nodeSize = options.nodeSize ?? 'full';
  // Own keys only: `constructor` or `toString` must not pass as a preset or a size.
  if (!Object.hasOwn(layoutPresets, preset)) {
    throw new LineageInputError(`Unknown layout preset: ${String(preset)}`);
  }
  if (!Object.hasOwn(NODE_SIZES, nodeSize)) {
    throw new LineageInputError(`Unknown node size: ${String(nodeSize)}`);
  }
  const presetOptions = layoutPresets[preset];
  const nodePlacement =
    options.nodePlacement ??
    ((presetOptions['elk.layered.nodePlacement.strategy'] as NodePlacement | undefined) ?? CHOSEN_NODE_PLACEMENT);
  if (!NODE_PLACEMENTS.includes(nodePlacement)) {
    throw new LineageInputError(`Unknown node placement: ${String(nodePlacement)}`);
  }
  const size = NODE_SIZES[nodeSize];

  const order = modelOrder(index);
  const position = new Map(order.map((id, i) => [id, i]));
  const focusId = (options.focusId === undefined ? index.graph.focusId : options.focusId) ?? null;
  const spine = focusSpine(index, focusId);
  const spineIds = new Set(spine.map((e) => e.id));
  const previous = preset === 'expand' ? previousPositionsOf(options.previousPositions) : undefined;

  const children: ElkNode[] = order.map((id) => {
    const rank = ranks.ranks.get(id)!;
    const prev = previous?.get(id);
    const node: ElkNode = {
      id,
      width: size.width,
      height: size.height,
      x: prev?.x ?? 0,
      y: rank * RANK_PSEUDO_Y,
    };
    if (prev) {
      // Semi-interactive crossing minimization reads the desired order from elk.position.
      node.layoutOptions = { 'elk.position': `(${prev.x}, ${rank * RANK_PSEUDO_Y})` };
    }
    return node;
  });

  const sortedEdges = [...index.graph.edges].sort(
    (a, b) =>
      position.get(a.teacherId)! - position.get(b.teacherId)! ||
      position.get(a.studentId)! - position.get(b.studentId)! ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const elkEdges: LineageEdge[] = [];
  const crossLineageEdges: LineageEdge[] = [];
  for (const edge of sortedEdges) {
    (edge.kind === 'crossLineage' ? crossLineageEdges : elkEdges).push(edge);
  }

  const edges: ElkExtendedEdge[] = elkEdges.map((edge) => {
    const elkEdge: ElkExtendedEdge = { id: edge.id, sources: [edge.teacherId], targets: [edge.studentId] };
    if (spineIds.has(edge.id)) {
      elkEdge.layoutOptions = { 'elk.layered.priority.straightness': String(SPINE_STRAIGHTNESS) };
    }
    return elkEdge;
  });

  const elkGraph: ElkNode = {
    id: ELK_ROOT_ID,
    layoutOptions: { ...presetOptions, 'elk.layered.nodePlacement.strategy': nodePlacement },
    children,
    edges,
  };
  return { elkGraph, order, elkEdges, crossLineageEdges, spine, focusId, preset, nodePlacement, nodeSize };
}

/**
 * The previous x-positions of the `expand` preset as a map (own keys only), or `undefined`
 * when there are none. Throws `LineageInputError` when they are not an object of points
 * with finite coordinates.
 */
function previousPositionsOf(previous: unknown): Map<string, Point> | undefined {
  if (previous === undefined) return undefined;
  if (!isObject(previous)) {
    throw new LineageInputError('`previousPositions` must be an object keyed by node id.');
  }
  const positions = new Map<string, Point>();
  for (const [id, point] of Object.entries(previous)) {
    if (!isObject(point) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new LineageInputError(`\`previousPositions\` of ${id} must have finite numbers x and y.`);
    }
    positions.set(id, { x: point.x as number, y: point.y as number });
  }
  return positions;
}
