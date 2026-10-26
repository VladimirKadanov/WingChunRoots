/**
 * Types of the lineage layout module (plan §4.1, §4.4–§4.6, §6.3).
 *
 * The input is the shape every explorer query returns (plan §6.3: `lineage.ego`,
 * `lineage.ancestors`, `lineage.subtree`, `lineage.paths`). The module reads only what the
 * layout needs (ids, names, lineages, edge kinds, training periods, hidden counts) and passes
 * the rest through untouched. The output is a scene: node boxes, orthogonal edge paths and
 * Bézier curves, ready for any renderer (React Flow in the explorer, SVG for print).
 *
 * Pure TypeScript: no React, DOM, Next.js or src/server (plan §6.1, enforced by ESLint).
 */

// ---------------------------------------------------------------------------------------
// Input: the graph shape of plan §6.3
// ---------------------------------------------------------------------------------------

/** Kind of a teaching relationship as seen by the view (plan §4.6). */
export type EdgeKind = 'primary' | 'converging' | 'crossLineage';

/** Relationship states of plan §6.7. */
export type RelationshipStatus =
  | 'awaiting_claim'
  | 'pending_teacher'
  | 'under_review'
  | 'verified'
  | 'rejected'
  | 'withdrawn'
  | 'in_arbitration'
  | 'revoked';

/** Visibility of a person or relationship (plan §6.2, D03). */
export type Visibility = 'involved_only' | 'public';

/** Precision of a training period date (plan §6.2). */
export type DatePrecision = 'year' | 'month' | 'day' | 'unknown';

/** One training period of a relationship. Dates are ISO 8601 prefixes: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
export interface TrainingPeriod {
  from: string | null;
  to: string | null;
  ongoing: boolean;
  precision: DatePrecision;
}

/** An additional spelling of a person's name (plan §5.3, §6.2). */
export interface AltName {
  value: string;
  /** ISO 15924 script code, for example `Latn`, `Hant`, `Hans`, `Cyrl`. */
  script?: string;
  /** BCP 47 language tag. */
  lang?: string;
  /** Romanization system, for example `jyutping` or `pinyin`. */
  romanization?: string;
}

/** A person in the view. One person is always exactly one node (D05). */
export interface LineageNode {
  id: string;
  /** Primary display name, always Latin script. */
  displayName: string;
  altNames: AltName[];
  lifeStatus: string;
  claimState: string;
  lineageIds: string[];
  childCount: number;
  hasMoreChildren: boolean;
}

/** A teaching relationship in the view (teacher → student). */
export interface LineageEdge {
  id: string;
  teacherId: string;
  studentId: string;
  lineageId: string;
  kind: EdgeKind;
  status: RelationshipStatus;
  isDisplayPrimary: boolean;
  visibility: Visibility;
  periods: TrainingPeriod[];
}

/** Teachers and students of a node that exist but are not part of the view. */
export interface HiddenCount {
  teachers: number;
  students: number;
}

/** The graph returned by every explorer query (plan §6.3). */
export interface LineageGraph {
  focusId: string | null;
  dataVersion: string;
  nodes: LineageNode[];
  edges: LineageEdge[];
  hiddenCounts: Record<string, HiddenCount>;
}

// ---------------------------------------------------------------------------------------
// Ranks (plan §4.4)
// ---------------------------------------------------------------------------------------

export interface RankResult {
  /** Rank (generation row in this view) of every node; 0 is the top row. */
  ranks: Map<string, number>;
  /**
   * Cut-off teachers: nodes without visible teachers whose own teachers exist outside the
   * view (`hiddenCounts[id].teachers > 0`) and who teach someone in the view. Each one sits
   * exactly one row above its highest student (plan §4.4, step 2).
   */
  cutOff: Set<string>;
  /** Number of rows (max rank + 1); 0 for an empty graph. */
  rankCount: number;
}

// ---------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------

/** Named sets of ELK settings (presets.ts). */
export type PresetName = 'explorer' | 'expand' | 'print';

/** Node placement strategies compared in M03 (plan §4.5). */
export type NodePlacement = 'NETWORK_SIMPLEX' | 'BRANDES_KOEPF';

/** Levels of detail of a node (plan §4.5, §4.8). */
export type DetailLevel = 'full' | 'compact' | 'dot';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Box extends Point, Size {}

export interface LayoutOptions {
  /** ELK settings to use; default `explorer`. */
  preset?: PresetName;
  /** Size of the slot every node gets in the layout; default `full` (200×64). */
  nodeSize?: DetailLevel;
  /** Focused person; default `graph.focusId`. Its spine gets straight edges (plan §4.5). */
  focusId?: string | null;
  /**
   * Previous top-left positions of nodes, keyed by node id. With the `expand` preset they
   * become ELK positions so that semi-interactive crossing minimization keeps the order of
   * the existing nodes in each row (plan §4.5, §4.8).
   */
  previousPositions?: Record<string, Point>;
  /** Overrides the preset's node placement strategy (used by the M03 comparison). */
  nodePlacement?: NodePlacement;
}

// ---------------------------------------------------------------------------------------
// Output: the scene
// ---------------------------------------------------------------------------------------

export interface SceneNode {
  id: string;
  rank: number;
  /** True for a cut-off teacher (plan §4.4). */
  cutOff: boolean;
  /** True when the node lies on the focus spine (including the focus itself). */
  onSpine: boolean;
  /** The layout slot (top-left corner and size). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Centre of the slot; every level-of-detail box is centred on it. */
  center: Point;
  /** Boxes for the three levels of detail, all centred on the slot (plan §4.5, §4.8). */
  boxes: Record<DetailLevel, Box>;
}

/** An edge routed by ELK: orthogonal polyline from the teacher to the student. */
export interface OrthogonalPath {
  type: 'orthogonal';
  /** Start point, bend points, end point. */
  points: Point[];
}

/**
 * A cubic Bézier curve between the side attachment points of the teacher and the student,
 * used for teachers from another lineage, which ELK does not route (plan §4.6).
 */
export interface BezierPath {
  type: 'bezier';
  start: Point;
  control1: Point;
  control2: Point;
  end: Point;
  /** Point on the curve at t = 0.5 (the label of a short curve; see bezierLabelPoint). */
  midpoint: Point;
}

export interface SceneEdge {
  id: string;
  teacherId: string;
  studentId: string;
  lineageId: string;
  kind: EdgeKind;
  /** `elk` for orthogonal routes, `scene` for Bézier curves computed by this module. */
  routedBy: 'elk' | 'scene';
  /** True when the edge is part of the focus spine (plan §4.5). */
  onSpine: boolean;
  /** Number of bend points of an orthogonal route; 0 for a Bézier curve. */
  bends: number;
  path: OrthogonalPath | BezierPath;
}

export interface Scene {
  /** Format version of the scene object. */
  version: 1;
  dataVersion: string;
  focusId: string | null;
  preset: PresetName;
  nodePlacement: NodePlacement;
  nodeSize: DetailLevel;
  /** Size of ELK's canvas; nodes and orthogonal routes lie inside it. */
  width: number;
  height: number;
  /** Bounding box of everything drawn, including Bézier curves that bulge outside the canvas. */
  bounds: Box;
  /** Top y of every row, indexed by rank. */
  rowY: number[];
  /** Nodes in model order (plan §4.5: by lineage, start year, name). */
  nodes: SceneNode[];
  /** Edges in model order of their endpoints. */
  edges: SceneEdge[];
  /** Ids of the focus spine edges, from the focus upwards. */
  spine: string[];
}

export interface LayoutStats {
  /** Wall-clock milliseconds of the whole call (ranks, ELK, scene). */
  totalMs: number;
  /** Milliseconds spent inside ELK. */
  elkMs: number;
  nodes: number;
  elkEdges: number;
  crossLineageEdges: number;
  /**
   * Students with several teachers in one lineage that the layout could not place between
   * them (plan §4.6, converging.ts), in model order. Empty unless a second such student
   * shares a row and both teachers with another on the focus spine, or the expand preset
   * keeps a student shown before where it was.
   */
  unplacedStudents: string[];
}

// ---------------------------------------------------------------------------------------
// Web Worker protocol (layout.worker.ts)
// ---------------------------------------------------------------------------------------

export interface LayoutWorkerRequest {
  type: 'layout';
  /** Monotonically increasing request id; a request older than the newest one is stale. */
  requestId: number;
  graph: LineageGraph;
  options?: LayoutOptions;
}

export interface LayoutWorkerCancel {
  type: 'cancel';
  /** Every request with this id or older is dropped. */
  requestId: number;
}

export type LayoutWorkerInbound = LayoutWorkerRequest | LayoutWorkerCancel;

export type LayoutWorkerOutbound =
  | { type: 'result'; requestId: number; scene: Scene; stats: LayoutStats }
  | { type: 'stale'; requestId: number }
  | { type: 'error'; requestId: number; error: SerializedLayoutError };

export type LayoutErrorCode = 'CYCLE' | 'INVALID_INPUT' | 'ELK_FAILED';

export interface SerializedLayoutError {
  code: LayoutErrorCode;
  message: string;
  /** For `CYCLE`: the node ids of one cycle, in edge order, first id repeated at the end. */
  cycle?: string[];
}
