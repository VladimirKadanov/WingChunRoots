import type { DetailLevel, NodePlacement, PresetName, Size } from './types.ts';

/** ELK layout options as string key/value pairs (the elkjs JSON format). */
export type ElkOptions = Record<string, string>;

/**
 * Pseudo y-coordinate per rank. ELK's INTERACTIVE layering assigns layers from the node
 * positions along the layout direction, so `y = rank × 200` hands it our ranks (plan §4.4).
 * 200 is larger than every node height, so two ranks never overlap.
 */
export const RANK_PSEUDO_Y = 200;

/** Fixed node sizes for the three levels of detail (plan §4.5); no DOM measuring. */
export const NODE_SIZES: Readonly<Record<DetailLevel, Size>> = {
  full: { width: 200, height: 64 },
  compact: { width: 120, height: 36 },
  dot: { width: 24, height: 24 },
};

/** `elk.layered.priority.straightness` of the focus spine edges; other edges keep 0. */
export const SPINE_STRAIGHTNESS = 10;

/**
 * Node placement chosen in M03 with the measurable test of plan §4.5: "the focus spine has
 * no bend points in the ego views of the anchor records". See docs/adr/0005-graph-layout.md.
 */
export const CHOSEN_NODE_PLACEMENT: NodePlacement = 'NETWORK_SIMPLEX';

/**
 * Explorer settings (plan §4.5). `elk.layered.priority.direction` is deliberately absent:
 * ELK reads it only when breaking cycles and the input is acyclic.
 */
export const explorerLayout: Readonly<ElkOptions> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN', // vertical: works on a phone and reads as a descending lineage
  'elk.layered.layering.strategy': 'INTERACTIVE', // always; node.y = rank * 200 as pseudo position
  'elk.layered.cycleBreaking.strategy': 'INTERACTIVE',
  'elk.edgeRouting': 'ORTHOGONAL', // most compact; looks like a family tree
  'elk.layered.nodePlacement.strategy': CHOSEN_NODE_PLACEMENT,
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES', // stable order between visits
  'elk.separateConnectedComponents': 'false',
  'elk.spacing.nodeNode': '24',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
  // ELK's default seed, made explicit: the layout must not depend on a time-based seed.
  'elk.randomSeed': '1',
};

/**
 * Expanding a node (plan §4.5, §4.8, M06): the previous x of the existing nodes is passed as
 * their position and semi-interactive crossing minimization keeps their order in each row.
 * Whether it really does is tested in M03 and recorded in docs/adr/0005-graph-layout.md.
 */
export const expandLayout: Readonly<ElkOptions> = {
  ...explorerLayout,
  'elk.layered.crossingMinimization.semiInteractive': 'true',
};

/**
 * Print and posters (plan §4.5, §4.12): larger spacing and a strictly deterministic order.
 * The node order inside each row is the model order (lineage, start year, name), so no
 * random tie-breaking of crossing minimization can change it.
 */
export const printLayout: Readonly<ElkOptions> = {
  ...explorerLayout,
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.nodeNodeBetweenLayers': '96',
  'elk.spacing.edgeNode': '24',
  'elk.layered.spacing.edgeNodeBetweenLayers': '24',
  'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
};

export const layoutPresets: Readonly<Record<PresetName, Readonly<ElkOptions>>> = {
  explorer: explorerLayout,
  expand: expandLayout,
  print: printLayout,
};
