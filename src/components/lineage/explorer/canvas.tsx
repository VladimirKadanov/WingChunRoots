'use client';

// The explorer's canvas (plan §4.1, §4.5–§4.8; milestone M05): React Flow draws the scene the
// layout worker computed. It is a client island of its own, loaded with next/dynamic only on
// /explore, so neither React Flow nor ELK is in any other page's JavaScript.
//
// - Nodes are fixed slots (200×64, plan §4.5), so nothing waits for the DOM to be measured. Their
//   level of detail follows the zoom (plan §4.8): a full card from 0.75, a compact chip from 0.4,
//   a dot below (with a name only for the focus, the selection and the lineage root).
//   onlyRenderVisibleElements keeps the DOM to what is on screen.
// - Edges are drawn from the scene, exactly as plan §4.6 says: ELK's orthogonal routes, and the
//   Bézier curve of a teacher from another lineage, long-dashed and labelled "Teacher in
//   {lineage}". The state is in the stroke and in words, never colour alone. Historical
//   (ended) training is laid out with the rest and hidden unless show=historical or one of its
//   people is selected, so showing it needs no new layout.
// - Selecting a node opens a simple panel with "Open profile" (the full panel and the keyboard
//   model come with M06). The React Flow attribution stays (DEFAULT, plan §10.2 row 9).
// - The legend and the zoom buttons lie over the canvas frame, outside React Flow, and follow the
//   frame at once; React Flow's own size follows it after the next paint (a phone's panel below
//   the graph opens, closes or changes its height), so a selection does not redraw the graph.
//   When the pane gets shorter, the view moves the selected person into it first.
//
// M06 (milestone M06, package F wires the seams marked `// M06 seam: <name>`): React Flow's own
// keyboard is off and the graph has one tab stop, the active node (roving tabindex), moved by the
// keys of keys.tsx on the wrapper around React Flow (data-graph-keys), by a click or a tap, and
// kept on a drawn node (on the graph itself while none is drawn); focus never falls out of the
// graph when its node leaves the screen. A polite live region speaks the key moves and the
// notices. The summary node "and N more" is a
// node type of its own; an expansion keeps the pressed node at its screen point (the anchor); a
// selection lights its routes (data-lit, data-highlighting); "Center on selection" and "Keyboard
// shortcuts" are buttons over the canvas next to the zoom buttons.

import '@xyflow/react/dist/base.css';

import {
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type ReactFlowState,
  useOnViewportChange,
  useReactFlow,
  useStore,
  useStoreApi,
  type Viewport,
} from '@xyflow/react';
import {
  createContext,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { FitIcon, MinusIcon, PlusIcon } from '@/components/icons';
import { type LinkKind, StrokePaths } from '@/components/ink/link-stroke';
import { Seal } from '@/components/ink/seal';
import { linkStyles, motion } from '@/design/tokens';
import { cx } from '@/lib/cx';
import { bezierLabelPoint } from '@/lib/lineage-layout/scene';
import type { Box, DetailLevel, Point, Scene, SceneEdge, SceneNode } from '@/lib/lineage-layout/types';

import { type GenerationLabel } from '../generation';
import { GenerationText } from '../generation-text';
import { announce, createAnnouncer, SELECTION_CLEARED, selectedWords, studentsOpenWords } from './announce';
import {
  type ActiveOptions,
  type CanvasHandle,
  type FlowApi,
  type FlowNode,
  type GraphContext,
  KEYS_HELP_ID,
  NO_NODE_ACTIONS,
  type NodeActions,
  NodeActionsContext,
  type Notice,
  type PanelHandle,
} from './graph-api';
import { useGraphKeys } from './keys';
import { NodeControls } from './node-controls';
import { CONTROLS_START, type ControlsPlace, placeControls, type Strip } from './controls-layout';
import { KEY_HELP } from './shortcuts';
import { relationsText, summaryText } from './relations';
import { isSummaryId, joinToBox, relationsId, summaryTeacherOf } from './state';
import { SummaryCard } from './summary-node';
import { CenterIcon, KeyboardIcon } from './tool-icons';
import { anchorDelta, ensureVisible, isDrawn, nearest, type PaneArea, type View, VIEW_GAP, visibleArea } from './viewport';

export interface PersonNodeData extends Record<string, unknown> {
  name: string;
  /** The name in its original script, with its language. */
  original: { value: string; lang: string } | null;
  /** The generation label (plan §4.4), or null. */
  generation: GenerationLabel | null;
  status: { kind: LinkKind; label: string } | null;
  /**
   * A drawn link to one of their other teachers, not the one `status` speaks of, is in arbitration:
   * plan §4.6 puts a banner on the node, so the card does not read only "Verified".
   */
  disputed: boolean;
  /** Teachers in this view (a chip from two). */
  teachers: number;
  /** Students not drawn (plan §4.8: large fan-outs are counted; M06 expands them). */
  more: number;
  rank: number;
  focus: boolean;
  root: boolean;
  slot: Box;
  boxes: Record<DetailLevel, Box>;
  // M06 seam: node-data (built by explorer.tsx flowBase)
  /** The profile's address: Enter opens /people/<slug>. */
  slug: string;
  /** Teachers and students in the record (public): those in this answer and those it left out (hiddenCounts, childCount). */
  totals: { teachers: number; students: number };
  /** Teachers and students drawn in this view before anyone is selected. */
  drawn: { teachers: number; students: number };
  /** The teachers drawn, by name: the node's description names them (relations.ts). */
  teacherNames: readonly string[];
  // M06 seam: lit-attrs (routes.ts litFlow sets it)
  /** On a route of descent of the selected person (plan §4.7). */
  lit?: boolean;
  // M06 seam: roving (the canvas sets it)
  /** The graph's one tab stop: the buttons inside it follow it in the Tab order. */
  active?: boolean;
}

/** The summary node "and N more" of a teacher whose students the cap cut (milestone M06 In scope 4). */
export interface SummaryNodeData extends Record<string, unknown> {
  teacherId: string;
  /** The teacher's name. */
  name: string;
  slug: string;
  /** The teacher's students not drawn. */
  more: number;
  rank: number;
  slot: Box;
  boxes: Record<DetailLevel, Box>;
  /** The graph's one tab stop. */
  active?: boolean;
}

export interface LineageEdgeData extends Record<string, unknown> {
  stroke: LinkKind;
  kind: SceneEdge['kind'];
  lineageId: string;
  routedBy: SceneEdge['routedBy'];
  path: SceneEdge['path'];
  /** "Teacher in {lineage}" on a cross-lineage curve, the years on a historical line. */
  label: string | null;
  historical: boolean;
  /** The boxes of the teacher and the student at each level of detail, to join the route to the box drawn. */
  ends: { teacher: Record<DetailLevel, Box>; student: Record<DetailLevel, Box> };
  // M06 seam: lit-attrs (routes.ts litFlow sets it)
  /** On a route of descent of the selected person (plan §4.7). */
  lit?: boolean;
}

export type PersonNode = Node<PersonNodeData, 'person'>;
export type SummaryNode = Node<SummaryNodeData, 'more'>;
export type LineageEdge = Edge<LineageEdgeData, 'lineage'>;

/** The levels of detail by zoom (plan §4.8): a full card from `full`, a compact chip from `compact`, a dot below. */
export const DETAIL_ZOOM = { full: 0.75, compact: 0.4 } as const;

const lodOf = (s: ReactFlowState): DetailLevel => (s.transform[2] >= DETAIL_ZOOM.full ? 'full' : s.transform[2] >= DETAIL_ZOOM.compact ? 'compact' : 'dot');
/** The level of detail lodOf gives at this zoom, for a view not yet on the pane. */
const detailAt = (zoom: number): DetailLevel => (zoom >= DETAIL_ZOOM.full ? 'full' : zoom >= DETAIL_ZOOM.compact ? 'compact' : 'dot');

/** The monogram of a full card (plan §4.8): the first letters of the first and the last word of the Latin name. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1]![0]! : '';
  return (first + last).toUpperCase();
}

// M06 seam: roving (the focus-loss guard)
/** Told when a node that has the keyboard focus is about to leave the DOM (CanvasFrame's lost). */
const FocusGuard = createContext<(id: string) => void>(() => undefined);

/**
 * The focus-loss guard of a node: when the node leaves the DOM with the keyboard focus inside it
 * (a pan or a zoom by pointer takes it off screen under onlyRenderVisibleElements, or a new layout
 * drops it), the canvas moves the focus to the new tab stop on the next frame, so the focus never
 * falls to <body> from inside the graph. React runs the cleanup before it removes the element.
 */
function useFocusGuard(id: string): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const lost = useContext(FocusGuard);
  useLayoutEffect(() => {
    const element = ref.current;
    return () => {
      const node = element?.closest('.react-flow__node');
      if (node && document.activeElement && node.contains(document.activeElement)) lost(id);
    };
  }, [id, lost]);
  return ref;
}

function PersonNodeView({ id, data, selected }: NodeProps<PersonNode>) {
  const lod = useStore(lodOf);
  const root = useFocusGuard(id);
  const box = data.boxes[lod];
  // The box of this level of detail, centred in the slot.
  const offset = { left: box.x - data.slot.x, top: box.y - data.slot.y };
  const ring = selected ? 'outline-2 outline-offset-2 outline-focus' : '';
  // The focus gets a heavier frame drawn inside its 1 px border, so its three lines keep their room.
  const frame = data.focus ? 'border border-fg shadow-[inset_0_0_0_1px_var(--fg)]' : 'border border-border-strong';
  return (
    // M06 seam: lit-attrs (data-lit)
    <div ref={root} data-person-node="" data-rank={data.rank} data-lod={lod} data-lit={data.lit ? '' : undefined} className="relative size-full">
      <Handle type="target" position={Position.Top} isConnectable={false} className="!invisible" />
      {/* M06 seam: node-data. The relationships in words: the node's aria-describedby (plan §4.9). */}
      <span id={relationsId(id)} hidden>
        {relationsText(data.teacherNames, data.totals, data.drawn)}
      </span>
      <div className="absolute" style={{ ...offset, width: box.width, height: box.height }}>
        {lod === 'full' && data.disputed ? (
          // On the card's top edge, at the right: the name starts at the left and its line keeps its room.
          <span
            data-arbitration-banner=""
            className="absolute -top-2 right-2 z-10 inline-flex items-center gap-1 rounded-xs border border-current bg-surface-1 px-1 text-caption leading-3.5 font-semibold tracking-normal [--seal-ground:var(--surface-1)]"
            style={{ color: `var(--${linkStyles.arbitration.labelColor})` }}
          >
            <Seal kind={linkStyles.arbitration.seal} size={11} className="shrink-0" />
            {linkStyles.arbitration.label}
          </span>
        ) : null}
        {lod === 'full' ? (
          <div className={cx('flex size-full items-center gap-2 overflow-hidden rounded-sm bg-surface-1 px-2 py-1 text-left', frame, ring)}>
            <span aria-hidden="true" className="inline-grid size-6 shrink-0 place-items-center rounded-xs border border-border-strong text-caption leading-none font-semibold tracking-normal text-fg-muted">
              {monogram(data.name)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span lang="und-Latn" translate="no" className="truncate font-display text-base leading-4.5 text-fg">
                  {data.name}
                </span>
                {data.original ? (
                  <span lang={data.original.lang} translate="no" className="cjk shrink-0 text-xs text-fg-muted">
                    {data.original.value}
                  </span>
                ) : null}
              </span>
              {data.generation ? (
                <span className="truncate text-caption leading-3.5 font-normal tracking-normal text-fg-muted">
                  <GenerationText label={data.generation} />
                </span>
              ) : null}
              <span className="flex min-w-0 items-center gap-1 text-caption leading-3.5 font-normal tracking-normal">
                {data.status ? (
                  <>
                    <Seal kind={linkStyles[data.status.kind].seal} size={12} className="shrink-0" />
                    <span className="truncate font-semibold" style={{ color: `var(--${linkStyles[data.status.kind].labelColor})` }}>
                      {data.status.label}
                    </span>
                  </>
                ) : data.root ? (
                  <span className="truncate text-fg-muted">Root of this lineage</span>
                ) : (
                  <span className="truncate text-fg-muted">Top of this view</span>
                )}
                {data.teachers >= 2 ? (
                  <span data-teachers-chip="" className="ml-auto shrink-0 rounded-xs border border-border-strong px-1 leading-3 text-fg">
                    {data.teachers} teachers
                  </span>
                ) : null}
                {/* M06 seam: node-slot ("+N students", "+N teachers": node-controls.tsx) */}
                <NodeControls id={id} data={data} active={data.active === true} />
              </span>
            </span>
          </div>
        ) : lod === 'compact' ? (
          <div className={cx('flex size-full items-center gap-1 overflow-hidden rounded-sm bg-surface-1 px-1.5', frame, ring)}>
            {data.status ? <Seal kind={linkStyles[data.status.kind].seal} size={11} className="shrink-0" /> : null}
            {data.disputed ? <Seal kind={linkStyles.arbitration.seal} size={11} className="shrink-0" /> : null}
            <span lang="und-Latn" translate="no" className="truncate text-caption font-semibold tracking-normal text-fg">
              {data.name}
            </span>
          </div>
        ) : (
          <div className="relative size-full">
            <div className={cx('size-full rounded-full bg-surface-1', data.focus || data.root ? 'border-2 border-fg bg-fg' : frame, ring)} />
            {data.focus || data.root || selected ? (
              <span lang="und-Latn" translate="no" className="absolute top-full left-1/2 mt-1 -translate-x-1/2 text-caption font-semibold tracking-normal whitespace-nowrap text-fg">
                {data.name}
              </span>
            ) : null}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="!invisible" />
    </div>
  );
}

// M06 seam: more-node
/**
 * The summary nodes of a scene: a `more:<teacherId>` scene node (package C: withSummaryNodes) is a
 * node of its own, "and N more →", named after its teacher, whose node has the count. A plain
 * button (Enter, Space or a click opens the teacher's students), never selected or lit; its
 * pseudo-edge is laid out, never drawn (explorer.tsx leaves it out).
 */
export function summaryNodes(scene: Scene, people: readonly PersonNode[]): SummaryNode[] {
  const out: SummaryNode[] = [];
  for (const sn of scene.nodes) {
    if (!isSummaryId(sn.id)) continue;
    const teacherId = summaryTeacherOf(sn.id);
    const teacher = people.find((p) => p.id === teacherId)?.data;
    const more = teacher?.more ?? 0;
    out.push({
      id: sn.id,
      type: 'more',
      position: { x: sn.x, y: sn.y },
      width: sn.width,
      height: sn.height,
      measured: { width: sn.width, height: sn.height },
      draggable: false,
      selectable: false,
      ariaRole: 'button',
      ariaLabel: `and ${more} more ${more === 1 ? 'student' : 'students'} of ${teacher?.name ?? ''}`,
      // One of the graph's many stops (roving tabindex), and a plain button: no "node" role
      // description. What it opens describes it, as the relationships describe a person.
      domAttributes: { tabIndex: -1, 'aria-roledescription': undefined, 'aria-describedby': relationsId(sn.id) },
      data: { teacherId, name: teacher?.name ?? '', slug: teacher?.slug ?? '', more, rank: sn.rank, slot: { x: sn.x, y: sn.y, width: sn.width, height: sn.height }, boxes: sn.boxes },
    });
  }
  return out;
}

/** The summary node "and N more →" (summary-node.tsx), in the students' row; its pseudo-edge is laid out, never drawn. */
function SummaryNodeView({ id, data }: NodeProps<SummaryNode>) {
  const lod = useStore(lodOf);
  const root = useFocusGuard(id);
  const box = data.boxes[lod];
  const offset = { left: box.x - data.slot.x, top: box.y - data.slot.y };
  return (
    <div ref={root} data-summary-node="" data-rank={data.rank} data-lod={lod} className="relative size-full">
      <Handle type="target" position={Position.Top} isConnectable={false} className="!invisible" />
      {/* What it opens: the node's aria-describedby. */}
      <span id={relationsId(id)} hidden>
        {summaryText(data.name)}
      </span>
      <div className="absolute" style={{ ...offset, width: box.width, height: box.height }}>
        <SummaryCard data={data} lod={lod} />
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="!invisible" />
    </div>
  );
}

function pathD(path: SceneEdge['path'], from: Point[], to: Point[]): string {
  const p = (q: Point) => `${q.x},${q.y}`;
  // `from` runs from the teacher's box to the route's start; `to`, reversed, from its end to the student's box.
  const head = from.map((q, i) => `${i === 0 ? 'M' : 'L'} ${p(q)} `).join('');
  const tail = [...to].reverse().map((q) => ` L ${p(q)}`).join('');
  const lead = head ? 'L' : 'M';
  if (path.type === 'bezier') {
    return `${head}${lead} ${p(path.start)} C ${p(path.control1)} ${p(path.control2)} ${p(path.end)}${tail}`;
  }
  return `${head}${path.points.map((q, i) => `${i === 0 ? lead : 'L'} ${p(q)}`).join(' ')}${tail}`;
}

function routeEnds(path: SceneEdge['path']): { start: Point; end: Point } {
  if (path.type === 'bezier') return { start: path.start, end: path.end };
  return { start: path.points[0]!, end: path.points[path.points.length - 1]! };
}

/**
 * Where an edge's label goes: on a curve, its midpoint or, on a long one, its run beside the
 * student (bezierLabelPoint); on an orthogonal route, the middle of its longest segment.
 */
function labelPoint(path: SceneEdge['path']): Point {
  if (path.type === 'bezier') return bezierLabelPoint(path);
  let best = { length: -1, at: path.points[0] ?? { x: 0, y: 0 } };
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1]!;
    const b = path.points[i]!;
    const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (length > best.length) best = { length, at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
  return best.at;
}

function LineageEdgeView({ id, source, target, data }: EdgeProps<LineageEdge>) {
  const lod = useStore(lodOf);
  if (!data) return null;
  const style = linkStyles[data.stroke];
  // A compact or dot box is smaller than the slot the route was laid out for (plan §4.8): the
  // route is joined to the box drawn, so no edge stops short of its person.
  const ends = routeEnds(data.path);
  const d = lod === 'full' ? pathD(data.path, [], []) : pathD(data.path, joinToBox(ends.start, data.ends.teacher[lod]), joinToBox(ends.end, data.ends.student[lod]));
  const at = labelPoint(data.path);
  return (
    <>
      {/* The stroke of the explorer legend's sample (Legend strokes="canvas"), so the key decodes
          the drawing without colour; a double stroke adds its knocked-out ground ([data-edge-core]).
          Width and dashes stay in screen pixels at every zoom: scaled with the view, zoomed out
          to the dots, they fell below a pixel and every state looked like a solid line. */}
      <StrokePaths
        d={d}
        kind={data.stroke}
        ground="var(--bg)"
        attributes={{
          'data-edge': id,
          'data-teacher': source,
          'data-student': target,
          'data-kind': data.kind,
          'data-lineage': data.lineageId,
          'data-stroke': data.stroke,
          'data-routed': data.routedBy,
          // M06 seam: lit-attrs
          ...(data.lit ? { 'data-lit': '' } : {}),
        }}
        coreAttributes={{ 'data-edge-core': id }}
      />
      {data.label ? (
        <EdgeLabelRenderer>
          <span
            data-edge-label={id}
            className="nodrag nopan pointer-events-none absolute flex items-center gap-1 rounded-xs bg-bg px-1 text-caption font-semibold tracking-normal whitespace-nowrap [--seal-ground:var(--bg)]"
            style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)`, color: `var(--${style.labelColor})` }}
          >
            {/* The small mark on a cross-lineage curve (plan §4.6), before "Teacher in {lineage}". */}
            {data.kind === 'crossLineage' ? <Seal kind={linkStyles.cross_lineage.seal} size={12} /> : null}
            {/* "Teacher in {lineage}": the lineage's name is not translated, like every name. */}
            <span translate="no">{data.label}</span>
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const nodeTypes = { person: PersonNodeView, more: SummaryNodeView };
const edgeTypes = { lineage: LineageEdgeView };

/** A CSS cubic-bezier() timing function as an easing function of progress (0 to 1), for the moves of the view. */
export function cubicBezier(css: string): (t: number) => number {
  const match = /^cubic-bezier\(\s*([\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*([\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/.exec(css);
  if (!match) throw new Error(`Not a cubic-bezier() timing function: ${css}`);
  const [x1, y1, x2, y2] = match.slice(1).map(Number) as [number, number, number, number];
  // The curve from (0, 0) to (1, 1) as a polynomial of its parameter s.
  const at = (p1: number, p2: number, s: number) => ((3 * p1 - 3 * p2 + 1) * s * s + (3 * p2 - 6 * p1) * s + 3 * p1) * s;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // x rises from 0 to 1 (x1 and x2 lie in [0, 1]): halving finds the s at which it reaches t.
    let low = 0;
    let high = 1;
    for (let i = 0; i < 30; i++) {
      const s = (low + high) / 2;
      if (at(x1, x2, s) < t) low = s;
      else high = s;
    }
    return at(y1, y2, (low + high) / 2);
  };
}

/** A motion token in milliseconds ('250ms' is 250). */
export const ms = (token: string): number => Number.parseFloat(token);

/**
 * The moves of the view, with the motion tokens (plan §5.8 (e)): the zoom buttons take `base`, a new scene `slow`
 * with the curve the people slide along (globals.css), so the view and the people move together.
 */
export const VIEW_MOTION = { buttons: ms(motion.duration.base), scene: ms(motion.duration.slow), ease: cubicBezier(motion.easing.out) };

/** How the view moves for this long: at once under prefers-reduced-motion. */
function moveFor(duration: number): { duration: number; ease: (t: number) => number } {
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return { duration: reduced ? 0 : duration, ease: VIEW_MOTION.ease };
}

/** How many animated moves of the view (a zoom button, a new scene's fit) are running. */
type Moves = RefObject<number>;

/**
 * Counts an animated move of the view as running until its promise settles, which React Flow does
 * when d3 ends the move: a shift of the view meanwhile (keepSelectionInView) would stop it where
 * it is, so useFollowFrame waits. Not a time: WebKit can paint no frame for a few hundred
 * milliseconds, and d3 moves the view only in frames. A move that something else stopped (a drag,
 * another move) never ends, so it counts for at most half a second past its duration.
 */
function trackMove(moves: Moves, duration: number, move: Promise<unknown>): void {
  if (duration === 0) return;
  moves.current += 1;
  let running = true;
  const end = () => {
    if (running) moves.current -= 1;
    running = false;
  };
  void move.then(end, end);
  window.setTimeout(end, duration + 500);
}

// M06 seam: zoom-controls (F wires; package D lays the buttons out and owns the Fit handler)
/**
 * The view's moves of the buttons over the canvas, with the motion tokens (at once under
 * prefers-reduced-motion); the keys (+, −, 0) make the same moves. "Fit the whole view" shows the
 * whole view (fitViewStart: React Flow's fit, or, where that would draw a person under the legend
 * or the buttons, the fit clear of them, at any zoom; milestone M06 b4), never larger than React
 * Flow's fit (FIT_OPTIONS).
 */
function useViewButtons(moves: Moves, scene: Scene) {
  const flow = useReactFlow<FlowNode, LineageEdge>();
  const store = useStoreApi<FlowNode, LineageEdge>();
  const go = (to: (move: ReturnType<typeof moveFor>) => Promise<unknown>) => {
    const move = moveFor(VIEW_MOTION.buttons);
    trackMove(moves, move.duration, to(move));
  };
  const fit = (move: ReturnType<typeof moveFor>) => {
    const { nodes, edges, width, height, domNode } = store.getState();
    // What is drawn now: ended training only with show=historical or the selection's own.
    const hidden = new Set([...nodes, ...edges].filter((element) => element.hidden).map((element) => element.id));
    const start = width > 0 && height > 0 ? fitViewStart(scene, hidden, { width, height, overlays: overlaysOn(domNode) }) : null;
    return start ? flow.setCenter(start.x, start.y, { zoom: start.zoom, ...move }) : flow.fitView({ ...FIT_OPTIONS, ...move });
  };
  return {
    zoomIn: () => go((move) => flow.zoomIn(move)),
    zoomOut: () => go((move) => flow.zoomOut(move)),
    fit: () => go(fit),
    /** Centres the view on a node, at the zoom it has. */
    center: (id: string) => {
      const node = flow.getInternalNode(id);
      if (!node) return;
      const { x, y } = node.internals.positionAbsolute;
      const width = node.measured.width ?? node.width ?? 0;
      const height = node.measured.height ?? node.height ?? 0;
      go((move) => flow.setCenter(x + width / 2, y + height / 2, { zoom: flow.getZoom(), ...move }));
    },
  };
}
type ViewButtons = ReturnType<typeof useViewButtons>;

/** From this width the selection's panel lies over the canvas, beside the column of buttons (panel.tsx, md). */
const PANEL_OVER_CANVAS = '(width >= 48rem)';

/**
 * Where the buttons over the canvas lie (controls-layout.ts placeControls), measured on the canvas
 * frame and kept up to date as it changes (a phone's sheet comes up or goes down, the phone turns):
 * the groups' sizes, the buttons' inset from the frame's right edge, and what lies along its
 * bottom edge, each from the bottom of the box it is placed in. That is the frame for the legend;
 * React Flow's attribution is placed in React Flow's own box, which follows the frame one paint
 * later (useFollowFrame), so its distance from the frame's bottom edge is read from its own box's.
 * In a corner (a phone) the attribution is moved beside the buttons (--attribution-right on the
 * frame, globals.css); its own place, in the frame's bottom right corner, is what placeControls is
 * given, wherever it was last drawn.
 */
function useControlsPlace(root: RefObject<HTMLDivElement | null>): ControlsPlace {
  const [place, setPlace] = useState<ControlsPlace>(CONTROLS_START);
  // The groups' sizes, kept from the last time they were drawn (not drawn: kind none).
  const strips = useRef<Strip[] | null>(null);
  useLayoutEffect(() => {
    const el = root.current;
    const frame = el?.closest<HTMLElement>('[data-canvas-frame]');
    if (!el || !frame) return;
    const beneath = () => [...frame.querySelectorAll<HTMLElement>('[data-canvas-overlay]')].filter((other) => other !== el);
    const attribution = () => frame.querySelector<HTMLElement>('.react-flow__attribution');
    const measure = () => {
      const groups = [...el.querySelectorAll<HTMLElement>('[role="group"]')];
      if (groups.length > 0) {
        strips.current = groups.map((g) => ({ long: Math.max(g.offsetWidth, g.offsetHeight), short: Math.min(g.offsetWidth, g.offsetHeight) }));
      }
      if (!strips.current) return;
      const origin = frame.getBoundingClientRect();
      const inFrame = (other: HTMLElement) => {
        const box = other.getBoundingClientRect();
        const within = (other.offsetParent ?? frame).getBoundingClientRect();
        return { x: box.x - origin.x, y: origin.height - (within.bottom - box.y), width: box.width, height: box.height };
      };
      const mark = attribution();
      // Its own place: at the frame's right edge, however far a corner moved it.
      const home = mark ? { ...inFrame(mark), x: origin.width - mark.offsetWidth } : undefined;
      const next = placeControls(
        { width: origin.width, height: origin.height },
        origin.right - el.getBoundingClientRect().right,
        strips.current,
        beneath().map(inFrame),
        { row: !window.matchMedia(PANEL_OVER_CANVAS).matches, attribution: home },
      );
      setPlace((now) => (now.kind === next.kind && now.bottom === next.bottom && now.attribution === next.attribution ? now : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    // The legend's height follows the states in view.
    for (const other of [...beneath(), attribution()]) if (other) observer.observe(other);
    return () => observer.disconnect();
  }, [root]);
  // The attribution beside the buttons in a corner, else in its own place.
  useLayoutEffect(() => {
    const frame = root.current?.closest<HTMLElement>('[data-canvas-frame]');
    if (!frame) return;
    if (place.attribution === undefined) frame.style.removeProperty('--attribution-right');
    else frame.style.setProperty('--attribution-right', `${place.attribution}px`);
  }, [root, place.attribution]);
  return place;
}

/**
 * The buttons over the canvas: the "Zoom" group of M05 (its three buttons, its name: tests find it
 * by both) and "Center on selection" and "Keyboard shortcuts" in a group of their own, above it or,
 * in one row, before it; "Keyboard shortcuts" only with a fine pointer (a touch-only phone has no
 * keys; "?" works anywhere). At the frame's bottom right, clear of the legend and of React Flow's
 * attribution, in a corner beside the attribution (a phone, where the legend leaves room), a
 * column, a stack of rows or one row as the frame has room (useControlsPlace, controls-layout.ts);
 * in a sliver of canvas above a raised sheet, none.
 */
function ZoomControls({
  buttons,
  onCenter,
  onHelp,
  onFocusLost,
}: {
  buttons: ViewButtons;
  onCenter: () => void;
  onHelp: () => void;
  /** The buttons left the DOM with the keyboard focus in one of them (kind none): the canvas gives the focus to the graph. */
  onFocusLost: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const place = useControlsPlace(root);
  // React runs this cleanup before it removes the buttons: the focus is still in one of them then.
  const groups = useRef<HTMLDivElement>(null);
  const shown = place.kind !== 'none';
  useLayoutEffect(() => {
    if (!shown) return;
    const element = groups.current;
    return () => {
      if (element && document.activeElement && element.contains(document.activeElement)) onFocusLost();
    };
  }, [shown, onFocusLost]);
  // Each group's buttons lie in a row in a stack and in a row, and the groups side by side in a corner and in a row.
  const lying = place.kind === 'stack' || place.kind === 'row';
  const sideBySide = place.kind === 'corner' || place.kind === 'row';
  // The ring is drawn inside the button (-outline-offset-2): the group clips what lies outside it.
  const button = cx(
    'size-11 place-items-center border-border-subtle bg-surface-1 text-fg hover:bg-surface-3 focus-visible:-outline-offset-2 active:bg-surface-pressed',
    lying ? '[&:not(:first-child)]:border-l' : '[&:not(:first-child)]:border-t',
  );
  // Only the groups take taps: the room beside the narrower group (a stack, a corner) passes them to the graph under it.
  const group = cx('pointer-events-auto flex overflow-hidden rounded-sm border border-border-strong shadow-pop', lying ? 'flex-row' : 'flex-col');
  return (
    <div
      ref={root}
      // The first view and the moves of the view keep people clear of it (largeViewStart, wholeViewStart, ensureVisible).
      data-canvas-overlay
      data-controls={place.kind}
      className="pointer-events-none absolute right-[max(0.75rem,env(safe-area-inset-right,0px))]"
      style={{ bottom: place.bottom }}
    >
      {place.kind === 'none' ? null : (
        <div ref={groups} className={cx('flex items-end gap-2', sideBySide ? 'flex-row' : 'flex-col')}>
          <div role="group" aria-label="Canvas tools" className={group}>
            <button type="button" className={cx(button, 'inline-grid')} aria-label="Center on selection" onClick={onCenter}>
              <CenterIcon size={18} />
            </button>
            <button type="button" className={cx(button, 'hidden any-pointer-fine:inline-grid')} aria-label="Keyboard shortcuts" onClick={onHelp}>
              <KeyboardIcon size={18} />
            </button>
          </div>
          <div role="group" aria-label="Zoom" className={group}>
            <button type="button" className={cx(button, 'inline-grid')} aria-label="Zoom in" onClick={buttons.zoomIn}>
              <PlusIcon size={18} />
            </button>
            <button type="button" className={cx(button, 'inline-grid')} aria-label="Zoom out" onClick={buttons.zoomOut}>
              <MinusIcon size={18} />
            </button>
            <button type="button" className={cx(button, 'inline-grid')} aria-label="Fit the whole view" onClick={buttons.fit}>
              <FitIcon size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The smallest zoom at which the people of a view are still cards with their names (compact chips,
 * lodOf); below it every person is a dot. The first view fits the whole view only from this zoom:
 * a view that fits only smaller, of however few people (a teacher's twelve students in one row on a
 * phone), opens like a large one, at the focus in full cards (DEFAULT, no D number: a first view of
 * dots shows no one's name; ADR 0009 item 5). "Fit the whole view" still shows all of it.
 */
export const READABLE_ZOOM = DETAIL_ZOOM.compact;
/** The zoom a large view starts at: cards at their own size, on a phone the smallest zoom with full cards (plan §4.8). */
const LARGE_VIEW_ZOOM = { wide: 1, narrow: DETAIL_ZOOM.full } as const;
/** The smallest zoom with full cards (plan §4.8, lodOf). */
const FULL_CARDS = DETAIL_ZOOM.full;
const NARROW_PANE = 640;
/**
 * The overlays' inset from the pane's edges (the legend's and the zoom buttons', 0.75rem): what the
 * first view frames keeps this far from an overlay, and on a phone from the pane's edges.
 */
const OVERLAY_GAP = 12;
/** Every fit of the whole view, the first and the button's: cards never larger than their own size. */
export const FIT_OPTIONS = { padding: 0.15, maxZoom: 1 } as const;

/** Where a view starts: the point at the centre of the pane, and the zoom. */
export interface ViewStart {
  x: number;
  y: number;
  zoom: number;
}

/** The canvas pane: its size, and what lies over it (the legend, the zoom buttons), in the pane's own pixels. */
export interface Pane {
  width: number;
  height: number;
  overlays?: readonly Box[];
}

const boxOf = (n: { x: number; y: number; width: number; height: number }): Box => ({ x: n.x, y: n.y, width: n.width, height: n.height });
function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * React Flow's fit of the whole view (fitView with FIT_OPTIONS: the bounds inside the padding,
 * centred, never past the cards' own size): its zoom, and where the flow's origin lands on the pane.
 */
function reactFlowFit(bounds: Box, pane: { width: number; height: number }): { zoom: number; x: number; y: number } {
  // React Flow's padding on each side: floor((size - size / (1 + padding)) / 2).
  const padding = (size: number) => 2 * Math.floor((size - size / (1 + FIT_OPTIONS.padding)) / 2);
  const zoom = Math.min(FIT_OPTIONS.maxZoom, (pane.width - padding(pane.width)) / bounds.width, (pane.height - padding(pane.height)) / bounds.height);
  return { zoom, x: pane.width / 2 - (bounds.x + bounds.width / 2) * zoom, y: pane.height / 2 - (bounds.y + bounds.height / 2) * zoom };
}

/**
 * The zoom at which React Flow's fit of the whole view (fitView with FIT_OPTIONS: the drawn
 * people's bounds inside the padding, never past the cards' own size) shows these people.
 */
export function wholeFitZoom(people: readonly Box[], pane: { width: number; height: number }): number {
  if (people.length === 0) return FIT_OPTIONS.maxZoom;
  return reactFlowFit(people.reduce(union), pane).zoom;
}

/** The margin a first view keeps from the pane's edges: a whole-view fit's padding; on a phone the overlays' inset, so that two full cards fit side by side at 390 px. */
function marginOf(pane: Pane): { x: number; y: number } {
  if (pane.width < NARROW_PANE) return { x: OVERLAY_GAP, y: OVERLAY_GAP };
  // React Flow's: the pane / (1 + padding) inside it.
  const padding = (size: number) => (size - size / (1 + FIT_OPTIONS.padding)) / 2;
  return { x: padding(pane.width), y: padding(pane.height) };
}

/**
 * How far down the pane a frame this many pixels wide, centred across it, reaches: the bottom
 * margin, or OVERLAY_GAP above the highest overlay it spans.
 */
function floorOf(pane: Pane, margin: number, width: number): number {
  const left = (pane.width - width) / 2;
  let bottom = pane.height - margin;
  for (const o of pane.overlays ?? []) {
    if (o.width > 0 && o.height > 0 && o.x < left + width && o.x + o.width > left) bottom = Math.min(bottom, o.y - OVERLAY_GAP);
  }
  return bottom;
}

/**
 * The first view of a scene shown whole, and its zoom. `start` is null where React Flow's fit of the
 * whole view (FIT_OPTIONS) draws every person clear of the overlays. Where it would draw one under
 * an overlay (on a short phone the legend wraps to two lines over the bottom row, and a person under
 * it can be neither seen nor tapped), the people are fitted whole into the part of the pane clear
 * of them, as the first view of a large scene frames its people (largeViewStart): inside the same
 * margin, OVERLAY_GAP above every overlay the frame spans, centred across the pane and in the room
 * above the overlays, never larger than React Flow's fit. A frame narrow enough to pass beside an
 * overlay off the pane's centre (the zoom buttons above the legend's right end) reaches lower than
 * a wide one: the larger zoom wins.
 */
function wholeView(people: readonly SceneNode[], pane: Pane): { start: ViewStart | null; zoom: number } {
  const bounds = people.map(boxOf).reduce(union);
  const fit = reactFlowFit(bounds, pane);
  const overlays = (pane.overlays ?? []).filter((o) => o.width > 0 && o.height > 0);
  // The boxes drawn at the fit's level of detail, where they land on the pane.
  const level = detailAt(fit.zoom);
  const drawn = (n: SceneNode): Box => {
    const box = n.boxes[level];
    return { x: fit.x + box.x * fit.zoom, y: fit.y + box.y * fit.zoom, width: box.width * fit.zoom, height: box.height * fit.zoom };
  };
  if (!people.some((n) => overlays.some((o) => overlap(drawn(n), o)))) return { start: null, zoom: fit.zoom };
  const margin = marginOf(pane);
  const centre = pane.width / 2;
  // The widths to try: as wide as the pane and React Flow's fit allow, and the widest that passes
  // beside each overlay off the centre (a hair narrower, so rounding never puts it under).
  const widest = bounds.width * Math.min(fit.zoom, (pane.width - 2 * margin.x) / bounds.width, (pane.height - 2 * margin.y) / bounds.height);
  const widths = [widest];
  for (const o of overlays) {
    const beside = o.x >= centre ? 2 * (o.x - centre) : o.x + o.width <= centre ? 2 * (centre - o.x - o.width) : 0;
    if (beside > 0 && beside < widest) widths.push(beside - 1e-6);
  }
  const zoom = Math.max(...widths.map((width) => Math.min(width / bounds.width, (floorOf(pane, margin.y, width) - margin.y) / bounds.height)));
  if (!(zoom > 0)) return { start: null, zoom: fit.zoom };
  // A frame narrower than the width tried reaches at least as low: it is centred in the room it has.
  const height = bounds.height * zoom;
  const top = margin.y + (floorOf(pane, margin.y, bounds.width * zoom) - margin.y - height) / 2;
  return { start: { x: bounds.x + bounds.width / 2, y: bounds.y + (pane.height / 2 - top) / zoom, zoom }, zoom };
}

/**
 * Where the first view of a small scene starts: null for React Flow's fit of the whole view, or
 * the fit clear of the overlays where that one would draw a person under one (wholeView; DEFAULT,
 * no D number, ADR 0009 item 5). Null for a large scene too, which largeViewStart places.
 */
export function wholeViewStart(scene: Scene, hidden: ReadonlySet<string>, pane: Pane): ViewStart | null {
  const people = scene.nodes.filter((n) => !hidden.has(n.id));
  if (people.length === 0) return null;
  const whole = wholeView(people, pane);
  return whole.zoom >= READABLE_ZOOM ? whole.start : null;
}

/**
 * Where "Fit the whole view" (the button, the key 0) puts the view: null for React Flow's fit of
 * the whole view, or the fit clear of the overlays where that one would draw a person under one
 * (wholeView), however small. Unlike the first view (wholeViewStart), which opens a scene whose
 * whole view is all dots like a large one, the button always shows the whole view, in dots where it
 * must (plan §4.8), and never a person under the legend or the buttons (milestone M06 b4,
 * screens-6: at the peek of a 393x659 phone's sheet React Flow's fit drew two students under the
 * legend, where the fit clear of it is in dots).
 */
export function fitViewStart(scene: Scene, hidden: ReadonlySet<string>, pane: Pane): ViewStart | null {
  const people = scene.nodes.filter((n) => !hidden.has(n.id));
  if (people.length === 0) return null;
  return wholeView(people, pane).start;
}

/**
 * Where the first view of a large scene starts (DEFAULT, docs/plan/questions/M05.md: full cards, not the
 * whole view as dots). A scene is large when its whole view (wholeView: React Flow's fit, or the fit
 * clear of the overlays where that one covers a person) falls below READABLE_ZOOM on this pane.
 * The view starts at the focus, or the first person of the top row when the focus is not drawn,
 * with as many of their drawn teachers and students as fit at a zoom with full cards, nearest first
 * (the Lineage view opens on its root with a student of the root, not with the root alone above
 * the grand-students). When none fits beside them, the person alone at the pane's zoom. With
 * nobody drawn above the start's row, the view starts at the top of the pane, so the rows below
 * fill the rest; any other is centred. Null for a small scene, which is shown whole
 * (wholeViewStart): one whose drawn people the pane shows whole at READABLE_ZOOM or more.
 *
 * The people it frames lie inside the pane's margin (a whole-view fit's padding; on a phone the
 * overlays' inset, so that two full cards fit side by side at 390 px) and clear of the overlays
 * (`pane.overlays`, the legend and the zoom buttons): on a phone the legend spans the pane and the
 * zoom buttons stand above it, so a frame that reached the pane's bottom edge would be hidden there.
 * Only what is drawn counts: `hidden` holds the people and links hidden by default (ended training).
 */
export function largeViewStart(scene: Scene, hidden: ReadonlySet<string>, pane: Pane): ViewStart | null {
  const people = scene.nodes.filter((n) => !hidden.has(n.id));
  if (people.length === 0 || wholeView(people, pane).zoom >= READABLE_ZOOM) return null;
  const start = people.find((n) => n.id === scene.focusId) ?? people.find((n) => n.rank === 0) ?? people[0]!;
  const narrow = pane.width < NARROW_PANE;
  const zoom = narrow ? LARGE_VIEW_ZOOM.narrow : LARGE_VIEW_ZOOM.wide;
  const margin = marginOf(pane);
  const room = { width: pane.width - 2 * margin.x, height: pane.height - 2 * margin.y };
  // How far down the pane a frame this many pixels wide, centred across it, reaches clear of the overlays.
  const floor = (width: number) => floorOf(pane, margin.y, width);
  const fits = (box: Box, z: number) => box.width * z <= room.width && box.height * z <= floor(box.width * z) - margin.y;
  const drawn = new Map(people.map((n) => [n.id, n]));
  const near = scene.edges
    .filter((e) => !hidden.has(e.id) && (e.teacherId === start.id || e.studentId === start.id))
    .map((e) => drawn.get(e.teacherId === start.id ? e.studentId : e.teacherId))
    .filter((n) => n !== undefined)
    .sort((a, b) => Math.hypot(a.center.x - start.center.x, a.center.y - start.center.y) - Math.hypot(b.center.x - start.center.x, b.center.y - start.center.y));
  let box = boxOf(start);
  for (const n of near) {
    const next = union(box, boxOf(n));
    if (fits(next, FULL_CARDS)) box = next;
  }
  let scale: number = zoom;
  if (box.width !== start.width || box.height !== start.height) {
    // The largest zoom up to the pane's at which the frame fits; at least full cards, where it fits.
    scale = Math.max(FULL_CARDS, Math.min(zoom, room.width / box.width, room.height / box.height));
    if (!fits(box, scale)) scale = Math.max(FULL_CARDS, (floor(box.width * scale) - margin.y) / box.height);
  }
  const height = box.height * scale;
  // The frame's top on the pane: with nobody drawn above the start's row, the frame starts at the top.
  const topRow = !people.some((n) => n.rank < start.rank);
  const top = Math.min(topRow ? margin.y : (pane.height - height) / 2, floor(box.width * scale) - height);
  return { x: box.x + box.width / 2, y: box.y + (pane.height / 2 - top) / scale, zoom: scale };
}

/**
 * The boxes of the overlays on the pane (marked data-canvas-overlay: the legend, the zoom buttons),
 * in the pane's own pixels. They lie over the canvas frame (data-canvas-frame), outside React Flow.
 */
function overlaysOn(pane: HTMLElement | null): Box[] {
  if (!pane) return [];
  const origin = pane.getBoundingClientRect();
  const frame = pane.closest('[data-canvas-frame]') ?? pane;
  return [...frame.querySelectorAll<HTMLElement>('[data-canvas-overlay]')].map((el) => {
    const box = el.getBoundingClientRect();
    return { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height };
  });
}

/**
 * What lies over the pane, in its own pixels: the overlays (overlaysOn) and the covers, marked
 * data-canvas-cover anywhere in the page (the desktop panel over the canvas, a phone's sheet):
 * a person under one can be neither seen nor tapped (viewport.ts ensureVisible).
 */
function coversOn(pane: HTMLElement | null): Box[] {
  if (!pane) return [];
  const origin = pane.getBoundingClientRect();
  const covers = [...document.querySelectorAll<HTMLElement>('[data-canvas-cover]')].map((el) => {
    const box = el.getBoundingClientRect();
    return { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height };
  });
  return [...overlaysOn(pane), ...covers];
}

/** The scene's identity: strings and numbers, so the view moves once per new scene, not on every render of the same one. */
const sceneKey = (scene: Scene) => `${scene.dataVersion}:${scene.focusId}:${scene.nodes.map((n) => n.id).join(',')}`;

/**
 * Fits or centres the view whenever a new scene arrives (a new focus, depth or view), and keeps
 * the view the user left while the list is shown (plan §4.10).
 */
function FitOnScene({
  scene,
  nodes,
  edges,
  moves,
  anchorId,
}: {
  scene: Scene;
  nodes: readonly FlowNode[];
  edges: LineageEdge[];
  moves: Moves;
  anchorId: string | null;
}) {
  const flow = useReactFlow();
  const store = useStoreApi();
  // Centring needs the size of the pane, known after its first measurement.
  const sized = useStore((s) => s.width > 0 && s.height > 0);
  const key = sceneKey(scene);
  // Refs outlive <Activity>: the scene last fitted, and the view the user left.
  const fitted = useRef<string | null>(null);
  const left = useRef<Viewport | null>(null);
  // M06 seam: anchor. The last scene's places (top left corners), by node.
  const places = useRef<Map<string, Point>>(new Map());
  useOnViewportChange({
    onEnd: (viewport) => {
      left.current = viewport;
    },
  });
  // While the list is shown, <Activity> runs the effects' cleanups: React Flow empties its store,
  // and when the graph is shown again it builds its pan and zoom anew at (0, 0) and zoom 1. Back to
  // the view the user left (this runs before the fit below, which moves only for a new scene).
  useEffect(() => {
    if (left.current) void flow.setViewport(left.current);
  }, [flow]);
  useEffect(() => {
    if (!sized || fitted.current === key) return;
    const first = fitted.current === null;
    // The first view of the canvas is there at once; a later scene moves with its people.
    const move = first ? { duration: 0 } : moveFor(VIEW_MOTION.scene);
    fitted.current = key;
    // M06 seam: anchor. A scene an expansion made (anchorId, package C) is not a new view: the view
    // moves with the pressed person, as their card slides to its new place (the same duration and
    // curve), so they keep their screen point; no fit, which would undo it (milestone M06 In scope 4).
    const before = places.current;
    places.current = new Map(scene.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    const from = anchorId ? before.get(anchorId) : undefined;
    const to = anchorId ? places.current.get(anchorId) : undefined;
    if (!first && from && to) {
      const { panZoom, transform } = store.getState();
      const [x, y, zoom] = transform;
      const delta = anchorDelta(from, to, zoom);
      if (panZoom && (delta.x !== 0 || delta.y !== 0)) trackMove(moves, move.duration, panZoom.setViewport({ x: x + delta.x, y: y + delta.y, zoom }, move));
      return;
    }
    const hidden = new Set([...nodes, ...edges].filter((element) => element.hidden).map((element) => element.id));
    const { width, height, domNode } = store.getState();
    const pane = { width, height, overlays: overlaysOn(domNode) };
    const start = largeViewStart(scene, hidden, pane) ?? wholeViewStart(scene, hidden, pane);
    const moved = start === null ? flow.fitView({ ...FIT_OPTIONS, ...move }) : flow.setCenter(start.x, start.y, { zoom: start.zoom, ...move });
    trackMove(moves, move.duration, moved);
  }, [flow, store, key, sized, scene, nodes, edges, moves, anchorId]);
  return null;
}

export interface CanvasProps {
  scene: Scene;
  nodes: PersonNode[];
  edges: LineageEdge[];
  onSelect: (id: string | null) => void;
  /** Called once the canvas has mounted, before its first paint: the explorer's skeleton can go. */
  onMount?: () => void;
  /** Overlays over the canvas frame: the legend, the relayout notice. */
  children?: ReactNode;
  // M06 seams (package F wires them all; the packages named fill them in elsewhere).
  /** node-slot: what the buttons inside a node and the summary node do (package C). */
  actions?: NodeActions;
  /** live-region: a notice spoken once ("Added 12 students of {name}.", package C). */
  notice?: Notice | null;
  /** anchor: the node whose screen point this scene keeps (an expansion, package C); null for a new read. */
  anchorId?: string | null;
  /** lit-attrs: a selection lights its routes; the frame dims the rest (package B). */
  highlighting?: boolean;
  /** graph-keys: the panel's handle, for Esc on a raised sheet (package B). */
  panel?: RefObject<PanelHandle | null>;
  /** roving: the canvas's handle, for the panel (package B). */
  handle?: Ref<CanvasHandle>;
}

/**
 * How far the view moves down (negative: up) so that a person stays wholly in view once the pane
 * is `pane.height` tall: on a phone the panel below the graph (plan §4.7) opens or grows with a
 * selection, and the pane shrinks from its bottom edge. `node` is the
 * person's box on the pane, in the pane's pixels. The person ends clear of the overlays across its
 * width (the legend, the zoom buttons) when it fits above them, else inside the pane, and never
 * higher than the overlays' inset from the top. 0 when it is in view already.
 */
export function shiftIntoView(node: Box, pane: Pane): number {
  // How far down the person may reach: OVERLAY_GAP above these overlays across its width, or the pane's bottom.
  const reach = (overlays: readonly Box[]) => {
    let floor = pane.height - OVERLAY_GAP;
    for (const o of overlays) {
      if (o.width > 0 && o.height > 0 && o.x < node.x + node.width && o.x + o.width > node.x) floor = Math.min(floor, o.y - OVERLAY_GAP);
    }
    return floor;
  };
  let floor = reach(pane.overlays ?? []);
  if (floor - OVERLAY_GAP < node.height) floor = reach([]);
  const bottom = node.y + node.height;
  if (bottom <= floor) return 0;
  return Math.min(0, Math.max(floor - bottom, OVERLAY_GAP - node.y));
}

/**
 * Keeps the selected person in view when the pane becomes `height` tall (DEFAULT, no D number,
 * ADR 0009 item 6, until the phone's bottom sheet in M06). React Flow keeps the
 * view's top left corner, so on a short phone (393x659) a person in the lower part of the pane
 * went out of view when the panel opened below the graph: not drawn there
 * (onlyRenderVisibleElements), it left the page, with the keyboard focus it had.
 */
function keepSelectionInView(store: ReturnType<typeof useStoreApi<FlowNode, LineageEdge>>, height: number) {
  const { panZoom, transform, width, nodes, domNode } = store.getState();
  // M06 seam: roving. The node that has the keyboard focus when the focus is in the graph, else
  // the selected one (milestone M06 b11): the focus never leaves the view with its node.
  const focused = focusedNode(domNode);
  const selected = nodes.find((n) => (focused ? n.id === focused : n.selected) && !n.hidden);
  if (!panZoom || width === 0 || !selected) return;
  const [x, y, zoom] = transform;
  const box = { x: x + selected.position.x * zoom, y: y + selected.position.y * zoom, width: (selected.width ?? 0) * zoom, height: (selected.height ?? 0) * zoom };
  const dy = shiftIntoView(box, { width, height, overlays: overlaysOn(domNode) });
  // At once, before React Flow measures the smaller pane: the person never leaves the view, so
  // it is never unmounted.
  if (dy !== 0) void panZoom.setViewport({ x, y: y + dy, zoom }, { duration: 0 });
}

/**
 * The box React Flow fills, kept as tall as the canvas frame (the box's parent), one paint after
 * the frame changes. On a phone the panel lies below the graph: a selection opens it or changes
 * its height, and the frame shrinks or grows. React Flow measured that in the same frame, drew the
 * graph again for its new size and mounted or unmounted the people coming into or going out of
 * view (onlyRenderVisibleElements), all inside the selection's response (INP, plan §5.8 (c)).
 * Until the box follows, a smaller frame clips React Flow, which then shows exactly what the
 * smaller pane shows (the view keeps its top left corner), and a larger one shows the page
 * background below it for that one frame. When the box gets shorter, the view first moves the
 * selected person into the smaller pane (keepSelectionInView), once the view's running moves, if
 * any, have ended (`moves`): a shift during a zoom button's move or a new scene's fit would stop
 * it short.
 */
function useFollowFrame(moves: Moves): RefObject<HTMLDivElement | null> {
  const box = useRef<HTMLDivElement>(null);
  const store = useStoreApi<FlowNode, LineageEdge>();
  useLayoutEffect(() => {
    const el = box.current;
    const frame = el?.parentElement;
    if (!el || !frame) return;
    let timer: number | undefined;
    // Set at once here, also when <Activity> shows the graph again: its view is not restored yet
    // (FitOnScene), so nothing moves then.
    let height = frame.clientHeight;
    el.style.height = `${height}px`;
    const follow = () => {
      const next = frame.clientHeight;
      // Until the moves end (looked at again a frame later), the frame clips the taller box and
      // nothing is unmounted.
      if (next > 0 && next < height && moves.current > 0) {
        timer = window.setTimeout(follow, 16);
        return;
      }
      timer = undefined;
      if (next > 0 && next < height) keepSelectionInView(store, next);
      height = next;
      el.style.height = `${next}px`;
    };
    // A task queued from a ResizeObserver callback runs after this frame is painted.
    const observer = new ResizeObserver(() => {
      timer ??= window.setTimeout(follow);
    });
    observer.observe(frame);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [store, moves]);
  return box;
}

// M06 seam: roving (the graph's one tab stop; package F)

type FlowState = ReactFlowState<FlowNode, LineageEdge>;

const viewOf = (s: FlowState): View => ({ x: s.transform[0], y: s.transform[1], zoom: s.transform[2] });
/** The pane, with its overlays and covers. */
const paneOf = (s: FlowState): PaneArea => ({ width: s.width, height: s.height, overlays: coversOn(s.domNode) });

/**
 * How far down the window (px from its top) the canvas frame must reach so that what lies along
 * its bottom edge (the legend; not the buttons, which make way: controls-layout.ts) and the
 * active node's card fit whole in it, one above the other with the view's gaps (viewport.ts
 * VIEW_GAP), and a pixel for rounding; null without a canvas. The card at the zoom now
 * (CanvasHandle keepInView), or, `least`, at the smallest zoom ensureVisible zooms out to
 * (READABLE_ZOOM, or the zoom now where smaller: CanvasHandle coverAbove).
 */
function reachOf(s: FlowState, active: string | null, least: boolean): number | null {
  const frame = s.domNode?.closest('[data-canvas-frame]');
  if (!frame) return null;
  const box = frame.getBoundingClientRect();
  // From the frame's bottom edge up to the highest top of what lies along it.
  let along = 0;
  for (const el of frame.querySelectorAll<HTMLElement>('[data-canvas-overlay]:not([data-controls])')) {
    const r = el.getBoundingClientRect();
    if (r.height > 0) along = Math.max(along, box.bottom - r.top);
  }
  const node = active === null ? undefined : s.nodeLookup.get(active);
  const zoom = least ? Math.min(s.transform[2], READABLE_ZOOM) : s.transform[2];
  const card = (node?.measured.height ?? node?.height ?? 0) * zoom;
  return Math.ceil(box.top + VIEW_GAP + card + VIEW_GAP + along + 1);
}

/** The id of the node the keyboard focus is in, when it is in this graph. */
function focusedNode(root: Element | null): string | null {
  const now = document.activeElement;
  if (!root || !now || !root.contains(now)) return null;
  return now.closest<HTMLElement>('.react-flow__node')?.dataset.id ?? null;
}

/** A node's element, when React Flow draws it. */
function elementOf(root: Element | null, id: string): HTMLElement | null {
  return root?.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`) ?? null;
}

/** The nodes React Flow draws at this view (onlyRenderVisibleElements), with their flow boxes. */
function drawnNodes(s: FlowState): { id: string; box: Box }[] {
  const view = viewOf(s);
  const out: { id: string; box: Box }[] = [];
  for (const node of s.nodeLookup.values()) {
    if (node.hidden) continue;
    const { x, y } = node.internals.positionAbsolute;
    const box = { x, y, width: node.measured.width ?? node.width ?? 0, height: node.measured.height ?? node.height ?? 0 };
    if (isDrawn(box, view, s)) out.push({ id: node.id, box });
  }
  return out;
}

/**
 * The drawn node nearest the centre of the visible area (DEFAULT, no D number): the tab stop when
 * the active node is no longer drawn (milestone M06 In scope 1).
 */
function nearestDrawn(s: FlowState, except?: string): string | null {
  const view = viewOf(s);
  const area = visibleArea(paneOf(s));
  const centre = { x: (area.x + area.width / 2 - view.x) / view.zoom, y: (area.y + area.height / 2 - view.y) / view.zoom };
  return nearest(
    centre,
    drawnNodes(s).filter((n) => n.id !== except),
  );
}

/**
 * Holds the keyboard focus on the graph itself, React Flow's element ("Lineage graph", its
 * application role and the key help as its description), while no node can hold it: a drag took
 * every node off screen, or a key move's target is not drawn yet. Focusable while it has the focus:
 * the tab stop (tabindex 0) while no node is one, else -1 until the focus leaves it (syncGraphStop).
 * The next arrow key, Enter or Space brings the active node back (keys.tsx). Nothing is announced:
 * the element's own name is.
 */
function holdFocus(root: HTMLElement): void {
  if (document.activeElement === root) return;
  if (!root.hasAttribute('tabindex')) root.tabIndex = -1;
  root.addEventListener('blur', () => syncGraphStop(root, false), { once: true });
  root.focus({ preventScroll: true });
}

/**
 * Makes the graph itself, React Flow's element, its one tab stop (tabindex 0) exactly while no
 * node inside it is (requirements-4): React Flow draws only the nodes on screen, so a pointer pan
 * that takes every node off screen leaves the active node, the stop, undrawn, and Tab would pass
 * the graph by. Once a node is the stop again, the element is none: it keeps tabindex -1 while it
 * still has the focus (holdFocus), and none at all once the focus leaves it, so a click on the bare
 * pane focuses nothing. `focused`: whether the element has the focus (false from its blur).
 */
function syncGraphStop(root: HTMLElement, focused = document.activeElement === root): void {
  const stop = root.querySelector('.react-flow__node[tabindex="0"]') === null;
  const want = stop ? '0' : focused ? '-1' : null;
  if (root.getAttribute('tabindex') === want) return;
  if (want === null) root.removeAttribute('tabindex');
  else root.setAttribute('tabindex', want);
}

/**
 * Keeps the graph's one tab stop (plan §4.9) when no node can be it (syncGraphStop): looked at
 * again whenever a node enters or leaves the DOM or a tabindex inside the graph changes (a pan, a
 * zoom, a new scene, the roving stop moving), and when the graph itself lets the focus go. The
 * check is one query, so the pans and the selections that change the DOM cost next to nothing.
 */
function useGraphStop(): void {
  const root = useStore((s) => s.domNode);
  useEffect(() => {
    if (!root) return;
    const sync = () => syncGraphStop(root);
    const blur = () => syncGraphStop(root, false);
    sync();
    // Our own change of the element's tabindex comes back here once and changes nothing more.
    const observer = new MutationObserver(sync);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['tabindex'] });
    root.addEventListener('blur', blur);
    return () => {
      observer.disconnect();
      root.removeEventListener('blur', blur);
    };
  }, [root]);
}

/**
 * The graph's one tab stop (plan §4.9, roving tabindex): every node is tabIndex -1 (explorer.tsx)
 * but the active one, 0. The active node is the one chosen last (a key move, a click or a tap)
 * while it is in the view, else the person in focus, else the first one drawn; only the two nodes
 * whose tab stop changes are new objects. It always stays on a drawn node: a view move that takes
 * it off screen while the focus is outside the graph moves the tab stop to the drawn node nearest
 * the centre (`retarget`, at the end of every move), and one that takes the focused node away
 * moves the focus there (`lost`, the focus-loss guard), or, with no node drawn at all, to the
 * graph itself (holdFocus): never to <body>. With no node drawn to be the stop, the graph itself is
 * the one stop (useGraphStop). A key move's target wins over both: while its focus waits for the
 * target to be drawn, the guard holds the focus on the graph and lets it come.
 */
function useRoving({
  nodes,
  focusId,
  moves,
  speak,
}: {
  nodes: readonly FlowNode[];
  focusId: string | null;
  moves: Moves;
  speak: (node: FlowNode) => void;
}) {
  const store = useStoreApi<FlowNode, LineageEdge>();
  const [chosen, setChosen] = useState<string | null>(null);
  const shown = (id: string | null) => id !== null && nodes.some((n) => n.id === id && !n.hidden);
  const active = shown(chosen) ? chosen : shown(focusId) ? focusId : (nodes.find((n) => !n.hidden)?.id ?? null);
  // Every node comes with tabIndex -1 (explorer.tsx flowBase): only the active one is a new object.
  const rfNodes = nodes.map((n): FlowNode => {
    const tabIndex = n.id === active ? 0 : -1;
    if (n.domAttributes?.tabIndex === tabIndex) return n;
    return { ...n, domAttributes: { ...n.domAttributes, tabIndex }, data: { ...n.data, active: tabIndex === 0 } } as FlowNode;
  });
  // For the callbacks, which run after a render: the active node and the nodes then.
  const latest = useRef({ active, nodes });
  useLayoutEffect(() => {
    latest.current = { active, nodes };
  });

  // A focus move waiting for its node to be drawn, and that node; a newer move replaces it.
  const waiting = useRef<{ id: string; stop: () => void } | null>(null);
  /**
   * Calls `then` with the node's element once React Flow draws it: at once, or when it enters the
   * DOM (a view move brings it in), for at most 1500 ms. Not a number of frames: WebKit can paint
   * no frame for a few hundred milliseconds (trackMove). A focus the graph held for it meanwhile
   * (`lost`) goes to the nearest drawn node when the time is up.
   */
  const whenDrawn = (id: string, then: (element: HTMLElement) => void) => {
    waiting.current?.stop();
    waiting.current = null;
    const root = store.getState().domNode;
    const now = elementOf(root, id);
    if (now || !root) {
      if (now) then(now);
      return;
    }
    const observer = new MutationObserver(() => {
      const element = elementOf(root, id);
      if (!element) return;
      stop();
      then(element);
    });
    const timer = window.setTimeout(() => {
      stop();
      if (document.activeElement === root) refocus();
    }, 1500);
    const stop = () => {
      observer.disconnect();
      window.clearTimeout(timer);
      if (waiting.current?.stop === stop) waiting.current = null;
    };
    observer.observe(root, { childList: true, subtree: true });
    waiting.current = { id, stop };
  };
  useEffect(() => () => waiting.current?.stop(), []);

  /** Moves the view, if it must, so that the node is wholly in the visible area (viewport.ts ensureVisible). */
  const reveal = (id: string) => {
    const s = store.getState();
    const node = s.nodeLookup.get(id);
    if (!node || !s.panZoom) return;
    const { x, y } = node.internals.positionAbsolute;
    const box = { x, y, width: node.measured.width ?? node.width ?? 0, height: node.measured.height ?? node.height ?? 0 };
    const next = ensureVisible(box, viewOf(s), paneOf(s), { minZoom: READABLE_ZOOM });
    if (!next) return;
    const move = moveFor(VIEW_MOTION.buttons);
    trackMove(moves, move.duration, s.panZoom.setViewport(next, move));
  };

  const setActive = (id: string, options: ActiveOptions = {}) => {
    setChosen(id);
    // A newer choice (a click, another key) replaces a focus move still on its way.
    waiting.current?.stop();
    if (!options.focus) return;
    reveal(id);
    // The node that has the focus keeps it until the new one can take it.
    whenDrawn(id, (element) => {
      element.focus({ preventScroll: true });
      const node = latest.current.nodes.find((n) => n.id === id);
      if (options.announce && node) speak(node);
    });
  };

  /**
   * At the end of every view move: a tab stop that is no longer drawn moves to the drawn node
   * nearest the centre, unless the focus is in the graph or a key move's focus is on its way to it.
   */
  const retarget = () => {
    const s = store.getState();
    if (waiting.current) return;
    if (s.domNode && document.activeElement && s.domNode.contains(document.activeElement)) return;
    const current = latest.current.active;
    if (current !== null && drawnNodes(s).some((n) => n.id === current)) return;
    const next = nearestDrawn(s);
    if (next !== null && next !== current) setChosen(next);
  };

  /**
   * Gives the focus, which nothing holds, to the graph: the active node while it is drawn (no view
   * move), else the drawn node nearest the centre of the visible area, which becomes the tab stop,
   * else, with no node drawn at all, the graph itself (holdFocus). `except`: a node leaving the DOM.
   */
  const refocus = (except?: string) => {
    const s = store.getState();
    const root = s.domNode;
    if (!root) return;
    const current = latest.current.active;
    const next = current !== null && current !== except && drawnNodes(s).some((n) => n.id === current) ? current : nearestDrawn(s, except);
    if (next === null) {
      holdFocus(root);
      return;
    }
    if (next !== current) setChosen(next);
    whenDrawn(next, (element) => element.focus({ preventScroll: true }));
  };

  /**
   * Runs `then` a frame after a control of the graph that had the focus left the DOM (React runs
   * a cleanup before it removes the element), when the focus fell to the page with it; not while
   * the graph is hidden (the list view), nor when the focus went somewhere on purpose.
   */
  const afterFocusFell = (then: (root: HTMLElement) => void) => {
    window.requestAnimationFrame(() => {
      const root = store.getState().domNode;
      const now = document.activeElement;
      if (!root || !root.isConnected || root.getClientRects().length === 0) return;
      if (now && now !== document.body) return;
      then(root);
    });
  };

  /**
   * The focus-loss guard: the focused node `id` is leaving the DOM (or its guard was renewed, while
   * the node stays: then the focus is still in it, and nothing happens). A key move's view move
   * can take the node it starts from off screen before its target is drawn: the graph holds the
   * focus until then, and the key's target takes it (whenDrawn).
   */
  const lost = (id: string) => {
    afterFocusFell((root) => {
      const pending = waiting.current;
      if (pending && pending.id !== id) holdFocus(root);
      else refocus(id);
    });
  };

  /** The guard of the buttons over the canvas: they leave the DOM with the focus (a sliver of canvas above a raised sheet). */
  const controlsLost = () => afterFocusFell(() => refocus());

  /**
   * A press on the pane or an edge with the focus in the graph (a pointer pan) leaves the focus
   * where it is: the browser would drop it to the page, out of the graph. When the pan takes the
   * focused node off screen, `lost` moves the focus to the nearest drawn node.
   */
  const keepFocus = (event: ReactMouseEvent<HTMLDivElement>) => {
    const root = store.getState().domNode;
    const target = event.target instanceof Element ? event.target : null;
    if (!root || !target || !root.contains(target) || !root.contains(document.activeElement)) return;
    const own = target.closest('.react-flow__node, a, button, input, select, textarea, [tabindex]');
    if (own && root.contains(own)) return;
    event.preventDefault();
  };

  return { active, rfNodes, setActive, retarget, lost, controlsLost, keepFocus, reveal, whenDrawn, latest };
}

export default function ExplorerCanvas(props: CanvasProps) {
  // The zoom buttons sit outside <ReactFlow>, over the frame: the provider gives them its store,
  // as it does to the frame (useFollowFrame).
  return (
    <ReactFlowProvider>
      <CanvasFrame {...props} />
    </ReactFlowProvider>
  );
}

function CanvasFrame({
  scene,
  nodes,
  edges,
  onSelect,
  onMount,
  children,
  actions = NO_NODE_ACTIONS,
  notice = null,
  anchorId = null,
  highlighting = false,
  panel,
  handle,
}: CanvasProps) {
  const canvas = useRef<HTMLDivElement>(null);
  const moves = useRef(0);
  const box = useFollowFrame(moves);
  const key = sceneKey(scene);
  const store = useStoreApi<FlowNode, LineageEdge>();
  useLayoutEffect(() => {
    onMount?.();
  }, [onMount]);
  const shown = useRef<string | null>(null);
  // In a new scene the people slide to their places (globals.css) while the edges are drawn at
  // theirs at once: hidden for that time (before the paint), they never point at an empty place.
  useLayoutEffect(() => {
    const previous = shown.current;
    shown.current = key;
    const element = canvas.current;
    const { duration } = moveFor(VIEW_MOTION.scene);
    if (previous === null || previous === key || duration === 0 || !element) return;
    element.toggleAttribute('data-moving', true);
    const timer = window.setTimeout(() => element.toggleAttribute('data-moving', false), duration);
    return () => {
      window.clearTimeout(timer);
      element.toggleAttribute('data-moving', false);
    };
  }, [key]);

  // M06 seam: live-region. Rendered empty with the canvas (a live region added with its words is
  // not announced); a key move's words come after a short quiet, a notice at once (announce.ts).
  const [spoken, setSpoken] = useState('');
  // The same words twice change nothing in the DOM, and would not be spoken again: a no-break space tells them apart.
  const [announcer] = useState(() => createAnnouncer((text) => setSpoken((before) => (before === text ? `${text} ` : text))));
  useEffect(() => () => announcer.dispose(), [announcer]);
  // Each notice is spoken once: the graph shown again after List (<Activity> re-runs the effects)
  // keeps the last notice, which is old news by then.
  const said = useRef<Notice | null>(null);
  useEffect(() => {
    if (!notice || said.current === notice) return;
    said.current = notice;
    announcer.notice(notice.text);
  }, [notice, announcer]);
  const speak = (node: FlowNode) => announcer.move(announce(node));

  // M06 seam: roving
  // M06 seam: more-node. Built once per scene: a selection changes no summary node.
  const [summariesOf, setSummariesOf] = useState<{ scene: Scene; nodes: SummaryNode[] } | null>(null);
  const summaries = summariesOf?.scene === scene ? summariesOf.nodes : summaryNodes(scene, nodes);
  if (summariesOf?.scene !== scene) setSummariesOf({ scene, nodes: summaries });
  const all: readonly FlowNode[] = summaries.length === 0 ? nodes : [...nodes, ...summaries];
  const roving = useRoving({ nodes: all, focusId: scene.focusId, moves, speak });
  useGraphStop();
  const { active, setActive } = roving;
  useImperativeHandle(
    handle,
    (): CanvasHandle => ({
      activeElement: () => {
        const id = roving.latest.current.active;
        return id === null ? null : elementOf(store.getState().domNode, id);
      },
      ensureVisible: (id) => {
        const target = id ?? roving.latest.current.active;
        if (target === null) return;
        // Once the view's running moves (a zoom button's, a new scene's fit) have ended: a move
        // now would stop them short (trackMove). At most a second later.
        const start = performance.now();
        const reveal = () => {
          if (moves.current > 0 && performance.now() - start < 1000) window.setTimeout(reveal, 16);
          else roving.reveal(target);
        };
        reveal();
      },
      focusActive: () => {
        const target = roving.latest.current.active;
        if (target !== null) setActive(target, { focus: true });
      },
      keepInView: () => reachOf(store.getState(), roving.latest.current.active, false),
      coverAbove: () => reachOf(store.getState(), roving.latest.current.active, true),
      showsAbove: (y) => {
        const s = store.getState();
        const frame = s.domNode?.closest('[data-canvas-frame]');
        const id = roving.latest.current.active;
        const node = id === null ? undefined : s.nodeLookup.get(id);
        if (!frame || !node) return true;
        const box = frame.getBoundingClientRect();
        // The card at the smallest zoom ensureVisible zooms out to (READABLE_ZOOM, or the zoom now where smaller).
        const card = (node.measured.height ?? node.height ?? 0) * Math.min(s.transform[2], READABLE_ZOOM);
        return Math.min(y, box.bottom) - box.top >= VIEW_GAP + card + VIEW_GAP;
      },
    }),
  );

  // M06 seam: zoom-controls
  const buttons = useViewButtons(moves, scene);
  const selectedId = all.find((n) => n.selected && !n.hidden)?.id ?? null;
  const centerOnSelection = () => {
    const target = selectedId ?? active;
    if (target !== null) buttons.center(target);
  };

  // M06 seam: graph-keys. The keys get the view and the graph through these (keys.tsx, package A).
  const flowApi: FlowApi = {
    view: () => viewOf(store.getState()),
    pane: () => paneOf(store.getState()),
    element: (id) => elementOf(store.getState().domNode, id),
    drawn: () => drawnNodes(store.getState()).map((n) => n.id),
    zoomIn: buttons.zoomIn,
    zoomOut: buttons.zoomOut,
    fit: buttons.fit,
    center: buttons.center,
  };
  // A selection, its clearing and a list of students opened are spoken too (plan §4.9), from a key,
  // a click or a tap, after the short quiet of a key move: the change paints first (INP).
  const nameOf = (id: string) => all.find((n) => n.id === id)?.data.name ?? '';
  const select = (id: string | null) => {
    onSelect(id);
    if (id !== null) announcer.move(selectedWords(nameOf(id), !window.matchMedia(PANEL_OVER_CANVAS).matches));
    else if (selectedId !== null) announcer.move(SELECTION_CLEARED);
  };
  const openStudents = (teacherId: string) => {
    actions.openStudents(teacherId);
    announcer.move(studentsOpenWords(nameOf(teacherId)));
  };
  const context: GraphContext = {
    nodes: all,
    edges,
    focusId: scene.focusId,
    activeId: active,
    setActive,
    selectedId,
    select,
    openStudents,
    closeList: actions.closeStudents,
    say: (text) => announcer.notice(text),
    collapseSheet: () => panel?.current?.collapse() ?? false,
  };
  const keys = useGraphKeys(flowApi, context);

  return (
    // M06 seam: lit-attrs (data-highlighting: a selection lights its routes, the rest is dimmed)
    <div data-canvas-frame="" data-highlighting={highlighting ? '' : undefined} className="absolute inset-0 overflow-hidden">
      {/* M06 seam: graph-keys. One key handler for the graph, on the wrapper around React Flow:
          single-key shortcuts work only while the focus is in it (WCAG 2.1.4). */}
      <div ref={box} data-graph-keys="" onKeyDown={keys.onKeyDown} onMouseDownCapture={roving.keepFocus} className="absolute inset-x-0 top-0 h-full">
        <FocusGuard.Provider value={roving.lost}>
          <NodeActionsContext.Provider value={actions}>
            <ReactFlow<FlowNode, LineageEdge>
              ref={canvas}
              className="explorer-canvas"
              nodes={roving.rfNodes as FlowNode[]}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onlyRenderVisibleElements
              // M06 seam: rf-keyboard-props. React Flow's own keyboard is off: the graph's keys are
              // ours (keys.tsx), and none of its single keys works anywhere on the page.
              disableKeyboardA11y
              nodesDraggable={false}
              nodesConnectable={false}
              edgesFocusable={false}
              panActivationKeyCode={null}
              selectionKeyCode={null}
              multiSelectionKeyCode={null}
              elementsSelectable
              selectNodesOnDrag={false}
              minZoom={0.1}
              maxZoom={2}
              // FitOnScene places every view, the first included. Not React Flow's fitView: it fits again
              // each time <Activity> shows the graph, over the view the user left.
              onNodeClick={(_, node) => {
                // The active node follows a click or a tap too (the click focuses it).
                setActive(node.id);
                if (isSummaryId(node.id)) openStudents(summaryTeacherOf(node.id));
                else select(node.id);
              }}
              onPaneClick={() => select(null)}
              onMoveEnd={roving.retarget}
              deleteKeyCode={null}
              aria-label="Lineage graph"
              aria-describedby={KEYS_HELP_ID}
            >
              <FitOnScene scene={scene} nodes={all} edges={edges} moves={moves} anchorId={anchorId} />
            </ReactFlow>
          </NodeActionsContext.Provider>
        </FocusGuard.Provider>
      </div>
      <div className="pointer-events-none absolute inset-0 z-10">
        {/* M06 seam: zoom-controls (its own place over the frame: ZoomControls) */}
        <ZoomControls buttons={buttons} onCenter={centerOnSelection} onHelp={keys.showHelp} onFocusLost={roving.controlsLost} />
        {children}
      </div>
      {/* M06 seam: live-region */}
      <p aria-live="polite" aria-atomic="true" data-testid="explorer-announcement" className="sr-only">
        {spoken}
      </p>
      {/* M06 seam: graph-keys. The graph's description, in the DOM before the first focus. */}
      <p id={KEYS_HELP_ID} hidden>
        {KEY_HELP}
      </p>
      {keys.overlay}
    </div>
  );
}
