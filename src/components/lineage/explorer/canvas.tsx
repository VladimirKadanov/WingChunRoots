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
  type ReactFlowState,
  useOnViewportChange,
  useReactFlow,
  useStore,
  useStoreApi,
  type Viewport,
} from '@xyflow/react';
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';

import { MinusIcon, PlusIcon, FitIcon } from '@/components/icons';
import { type LinkKind, StrokePaths } from '@/components/ink/link-stroke';
import { Seal } from '@/components/ink/seal';
import { linkStyles, motion } from '@/design/tokens';
import { cx } from '@/lib/cx';
import { bezierLabelPoint } from '@/lib/lineage-layout/scene';
import type { Box, DetailLevel, Point, Scene, SceneEdge } from '@/lib/lineage-layout/types';

import { type GenerationLabel } from '../generation';
import { GenerationText } from '../generation-text';
import { joinToBox } from './state';

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
}

export type PersonNode = Node<PersonNodeData, 'person'>;
export type LineageEdge = Edge<LineageEdgeData, 'lineage'>;

const lodOf = (s: ReactFlowState): DetailLevel => (s.transform[2] >= 0.75 ? 'full' : s.transform[2] >= 0.4 ? 'compact' : 'dot');

/** The monogram of a full card (plan §4.8): the first letters of the first and the last word of the Latin name. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1]![0]! : '';
  return (first + last).toUpperCase();
}

function PersonNodeView({ data, selected }: NodeProps<PersonNode>) {
  const lod = useStore(lodOf);
  const box = data.boxes[lod];
  // The box of this level of detail, centred in the slot.
  const offset = { left: box.x - data.slot.x, top: box.y - data.slot.y };
  const ring = selected ? 'outline-2 outline-offset-2 outline-focus' : '';
  // The focus gets a heavier frame drawn inside its 1 px border, so its three lines keep their room.
  const frame = data.focus ? 'border border-fg shadow-[inset_0_0_0_1px_var(--fg)]' : 'border border-border-strong';
  return (
    <div data-person-node="" data-rank={data.rank} data-lod={lod} className="relative size-full">
      <Handle type="target" position={Position.Top} isConnectable={false} className="!invisible" />
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
                {data.more > 0 ? (
                  <span data-more-chip="" className={cx('shrink-0 text-fg-muted', data.teachers < 2 && 'ml-auto')}>
                    +{data.more} students
                  </span>
                ) : null}
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
            {data.label}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const nodeTypes = { person: PersonNodeView };
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

function ZoomControls() {
  const flow = useReactFlow();
  // The ring is drawn inside the button (-outline-offset-2): the group clips what lies outside it.
  const button =
    'inline-grid size-11 place-items-center border-border-subtle bg-surface-1 text-fg hover:bg-surface-3 focus-visible:-outline-offset-2 active:bg-surface-pressed [&:not(:first-child)]:border-t';
  return (
    <div role="group" aria-label="Zoom" className="flex flex-col overflow-hidden rounded-sm border border-border-strong shadow-pop">
      <button type="button" className={button} aria-label="Zoom in" onClick={() => void flow.zoomIn(moveFor(VIEW_MOTION.buttons))}>
        <PlusIcon size={18} />
      </button>
      <button type="button" className={button} aria-label="Zoom out" onClick={() => void flow.zoomOut(moveFor(VIEW_MOTION.buttons))}>
        <MinusIcon size={18} />
      </button>
      <button type="button" className={button} aria-label="Fit the whole view" onClick={() => void flow.fitView({ ...FIT_OPTIONS, ...moveFor(VIEW_MOTION.buttons) })}>
        <FitIcon size={18} />
      </button>
    </div>
  );
}

/** Up to this many people the first view shows them all; a larger view starts at the focus. */
const FIT_ALL_UP_TO = 40;
/** The zoom a large view starts at: cards at their own size, on a phone the smallest zoom with full cards (plan §4.8). */
const LARGE_VIEW_ZOOM = { wide: 1, narrow: 0.75 } as const;
/** The smallest zoom with full cards (plan §4.8, lodOf). */
const FULL_CARDS = 0.75;
const NARROW_PANE = 640;
/** Every fit of the whole view, the first and the button's: cards never larger than their own size. */
export const FIT_OPTIONS = { padding: 0.15, maxZoom: 1 } as const;

/** Where a view starts: the point at the centre of the pane, and the zoom. */
export interface ViewStart {
  x: number;
  y: number;
  zoom: number;
}

const boxOf = (n: { x: number; y: number; width: number; height: number }): Box => ({ x: n.x, y: n.y, width: n.width, height: n.height });
function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/**
 * Where the first view of a large scene starts (DEFAULT, docs/plan/questions/M05.md: full cards, not the
 * whole view as dots): the focus, or the first person of the top row when the focus is not drawn,
 * with as many of their drawn teachers and students as fit at a zoom with full cards, nearest first
 * (the Lineage view opens on its root with a student of the root, not with the root alone above
 * the grand-students). When none fits beside them, the person alone at the pane's zoom, a quarter
 * down the pane when nobody is drawn above them. Null for a small scene, which is fitted whole.
 * Only what is drawn counts: `hidden` holds the people and links hidden by default (ended training).
 */
export function largeViewStart(scene: Scene, hidden: ReadonlySet<string>, pane: { width: number; height: number }): ViewStart | null {
  const people = scene.nodes.filter((n) => !hidden.has(n.id));
  if (people.length <= FIT_ALL_UP_TO) return null;
  const start = people.find((n) => n.id === scene.focusId) ?? people.find((n) => n.rank === 0) ?? people[0]!;
  const zoom = pane.width < NARROW_PANE ? LARGE_VIEW_ZOOM.narrow : LARGE_VIEW_ZOOM.wide;
  const drawn = new Map(people.map((n) => [n.id, n]));
  const near = scene.edges
    .filter((e) => !hidden.has(e.id) && (e.teacherId === start.id || e.studentId === start.id))
    .map((e) => drawn.get(e.teacherId === start.id ? e.studentId : e.teacherId))
    .filter((n) => n !== undefined)
    .sort((a, b) => Math.hypot(a.center.x - start.center.x, a.center.y - start.center.y) - Math.hypot(b.center.x - start.center.x, b.center.y - start.center.y));
  // The room the pane leaves inside the padding of a whole-view fit (React Flow's: pane / (1 + padding)).
  const room = { width: pane.width / (1 + FIT_OPTIONS.padding), height: pane.height / (1 + FIT_OPTIONS.padding) };
  let box = boxOf(start);
  for (const n of near) {
    const next = union(box, boxOf(n));
    if (next.width * FULL_CARDS <= room.width && next.height * FULL_CARDS <= room.height) box = next;
  }
  if (box.width === start.width && box.height === start.height) {
    // With nobody above, the person sits a quarter down the pane and the rows below fill the rest.
    const below = start.rank === 0 ? pane.height / 4 / zoom : 0;
    return { x: start.center.x, y: start.center.y + below, zoom };
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, zoom: Math.max(FULL_CARDS, Math.min(zoom, room.width / box.width, room.height / box.height)) };
}

/** The scene's identity: strings and numbers, so the view moves once per new scene, not on every render of the same one. */
const sceneKey = (scene: Scene) => `${scene.dataVersion}:${scene.focusId}:${scene.nodes.map((n) => n.id).join(',')}`;

/**
 * Fits or centres the view whenever a new scene arrives (a new focus, depth or view), and keeps
 * the view the user left while the list is shown (plan §4.10).
 */
function FitOnScene({ scene, nodes, edges }: { scene: Scene; nodes: PersonNode[]; edges: LineageEdge[] }) {
  const flow = useReactFlow();
  const store = useStoreApi();
  // Centring needs the size of the pane, known after its first measurement.
  const sized = useStore((s) => s.width > 0 && s.height > 0);
  const key = sceneKey(scene);
  // Refs outlive <Activity>: the scene last fitted, and the view the user left.
  const fitted = useRef<string | null>(null);
  const left = useRef<Viewport | null>(null);
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
    // The first view of the canvas is there at once; a later scene moves with its people.
    const move = fitted.current === null ? { duration: 0 } : moveFor(VIEW_MOTION.scene);
    fitted.current = key;
    const hidden = new Set([...nodes, ...edges].filter((element) => element.hidden).map((element) => element.id));
    const { width, height } = store.getState();
    const start = largeViewStart(scene, hidden, { width, height });
    if (start === null) void flow.fitView({ ...FIT_OPTIONS, ...move });
    else void flow.setCenter(start.x, start.y, { zoom: start.zoom, ...move });
  }, [flow, store, key, sized, scene, nodes, edges]);
  return null;
}

export interface CanvasProps {
  scene: Scene;
  nodes: PersonNode[];
  edges: LineageEdge[];
  onSelect: (id: string | null) => void;
  /** Overlays inside the canvas frame: the legend, the selection panel. */
  children?: ReactNode;
}

export default function ExplorerCanvas({ scene, nodes, edges, onSelect, children }: CanvasProps) {
  const frame = useRef<HTMLDivElement>(null);
  const key = sceneKey(scene);
  const shown = useRef<string | null>(null);
  // In a new scene the people slide to their places (globals.css) while the edges are drawn at
  // theirs at once: hidden for that time (before the paint), they never point at an empty place.
  useLayoutEffect(() => {
    const previous = shown.current;
    shown.current = key;
    const element = frame.current;
    const { duration } = moveFor(VIEW_MOTION.scene);
    if (previous === null || previous === key || duration === 0 || !element) return;
    element.toggleAttribute('data-moving', true);
    const timer = window.setTimeout(() => element.toggleAttribute('data-moving', false), duration);
    return () => {
      window.clearTimeout(timer);
      element.toggleAttribute('data-moving', false);
    };
  }, [key]);
  return (
    <ReactFlow<PersonNode, LineageEdge>
      ref={frame}
      className="explorer-canvas"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onlyRenderVisibleElements
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      elementsSelectable
      selectNodesOnDrag={false}
      minZoom={0.1}
      maxZoom={2}
      // FitOnScene places every view, the first included. Not React Flow's fitView: it fits again
      // each time <Activity> shows the graph, over the view the user left.
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(null)}
      deleteKeyCode={null}
      aria-label="Lineage graph"
    >
      <FitOnScene scene={scene} nodes={nodes} edges={edges} />
      <div className="pointer-events-none absolute inset-0 z-10">
        <div className="pointer-events-auto absolute right-[max(0.75rem,env(safe-area-inset-right,0px))] bottom-7">
          <ZoomControls />
        </div>
        {children}
      </div>
    </ReactFlow>
  );
}
