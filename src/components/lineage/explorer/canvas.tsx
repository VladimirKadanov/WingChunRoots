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
  useReactFlow,
  useStore,
} from '@xyflow/react';
import { type ReactNode, useEffect } from 'react';

import { MinusIcon, PlusIcon, FitIcon } from '@/components/icons';
import { type LinkKind } from '@/components/ink/link-stroke';
import { Seal } from '@/components/ink/seal';
import { linkStyles } from '@/design/tokens';
import { cx } from '@/lib/cx';
import type { Box, DetailLevel, Point, Scene, SceneEdge } from '@/lib/lineage-layout/types';

export interface PersonNodeData extends Record<string, unknown> {
  name: string;
  /** The name in its original script, with its language. */
  original: { value: string; lang: string } | null;
  /** The generation label (plan §4.4), or null. */
  generation: string | null;
  status: { kind: LinkKind; label: string } | null;
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
  routedBy: SceneEdge['routedBy'];
  path: SceneEdge['path'];
  /** "Teacher in {lineage}" on a cross-lineage curve, the years on a historical line. */
  label: string | null;
  historical: boolean;
}

export type PersonNode = Node<PersonNodeData, 'person'>;
export type LineageEdge = Edge<LineageEdgeData, 'lineage'>;

const lodOf = (s: ReactFlowState): DetailLevel => (s.transform[2] >= 0.75 ? 'full' : s.transform[2] >= 0.4 ? 'compact' : 'dot');

function PersonNodeView({ data, selected }: NodeProps<PersonNode>) {
  const lod = useStore(lodOf);
  const box = data.boxes[lod];
  // The box of this level of detail, centred in the slot.
  const offset = { left: box.x - data.slot.x, top: box.y - data.slot.y };
  const ring = selected ? 'outline-2 outline-offset-2 outline-focus' : '';
  const frame = data.focus ? 'border-2 border-fg' : 'border border-border-strong';
  return (
    <div data-person-node="" data-rank={data.rank} data-lod={lod} className="relative size-full">
      <Handle type="target" position={Position.Top} isConnectable={false} className="!invisible" />
      <div className="absolute" style={{ ...offset, width: box.width, height: box.height }}>
        {lod === 'full' ? (
          <div className={cx('flex size-full flex-col justify-center gap-0.5 overflow-hidden rounded-sm bg-surface-1 px-2.5 py-1.5 text-left', frame, ring)}>
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span lang="und-Latn" translate="no" className="truncate font-display text-[15px] leading-tight text-fg">
                {data.name}
              </span>
              {data.original ? (
                <span lang={data.original.lang} translate="no" className="cjk shrink-0 text-xs text-fg-muted">
                  {data.original.value}
                </span>
              ) : null}
            </span>
            {data.generation ? <span className="truncate text-[11px] leading-tight text-fg-muted">{data.generation}</span> : null}
            <span className="flex min-w-0 items-center gap-1 text-[11px] leading-tight">
              {data.status ? (
                <>
                  <Seal kind={linkStyles[data.status.kind].seal} size={12} className="shrink-0" />
                  <span className="truncate font-semibold" style={{ color: `var(--${linkStyles[data.status.kind].labelColor})` }}>
                    {data.status.label}
                  </span>
                </>
              ) : data.root ? (
                <span className="truncate text-fg-muted">Root of this lineage</span>
              ) : null}
              {data.teachers >= 2 ? (
                <span data-teachers-chip="" className="ml-auto shrink-0 rounded-xs border border-border-strong px-1 text-[11px] text-fg">
                  {data.teachers} teachers
                </span>
              ) : null}
              {data.more > 0 ? (
                <span data-more-chip="" className={cx('shrink-0 text-[11px] text-fg-muted', data.teachers < 2 && 'ml-auto')}>
                  +{data.more} students
                </span>
              ) : null}
            </span>
          </div>
        ) : lod === 'compact' ? (
          <div className={cx('flex size-full items-center gap-1 overflow-hidden rounded-sm bg-surface-1 px-1.5', frame, ring)}>
            {data.status ? <Seal kind={linkStyles[data.status.kind].seal} size={11} className="shrink-0" /> : null}
            <span lang="und-Latn" translate="no" className="truncate text-[11px] font-semibold text-fg">
              {data.name}
            </span>
          </div>
        ) : (
          <div className="relative size-full">
            <div className={cx('size-full rounded-full bg-surface-1', data.focus || data.root ? 'border-2 border-fg bg-fg' : frame, ring)} />
            {data.focus || data.root || selected ? (
              <span lang="und-Latn" translate="no" className="absolute top-full left-1/2 mt-1 -translate-x-1/2 text-[11px] font-semibold whitespace-nowrap text-fg">
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

function pathD(path: SceneEdge['path']): string {
  if (path.type === 'bezier') {
    const p = (q: Point) => `${q.x},${q.y}`;
    return `M ${p(path.start)} C ${p(path.control1)} ${p(path.control2)} ${p(path.end)}`;
  }
  return path.points.map((q, i) => `${i === 0 ? 'M' : 'L'} ${q.x},${q.y}`).join(' ');
}

/** Where an edge's label goes: the curve's midpoint, or the middle of an orthogonal route's longest segment. */
function labelPoint(path: SceneEdge['path']): Point {
  if (path.type === 'bezier') return path.midpoint;
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
  if (!data) return null;
  const style = linkStyles[data.stroke];
  const d = pathD(data.path);
  const color = `var(--${style.strokeColor})`;
  const at = labelPoint(data.path);
  const common = { 'data-edge': id, 'data-teacher': source, 'data-student': target, 'data-kind': data.kind, 'data-stroke': data.stroke, 'data-routed': data.routedBy, fill: 'none' } as const;
  return (
    <>
      {style.stroke === 'double' ? (
        // Two strokes with the ground between them (plan §4.6: "double stroke").
        <g {...common}>
          <path d={d} stroke={color} strokeWidth={style.width * 3.5} fill="none" />
          <path d={d} stroke="var(--bg)" strokeWidth={style.width * 1.4} fill="none" />
        </g>
      ) : (
        <path {...common} d={d} stroke={color} strokeWidth={style.width} strokeDasharray={style.dash ?? undefined} strokeLinecap={style.stroke === 'dotted' ? 'round' : 'butt'} />
      )}
      {data.label ? (
        <EdgeLabelRenderer>
          <span
            data-edge-label={id}
            className="nodrag nopan pointer-events-none absolute rounded-xs bg-bg px-1 text-[11px] font-semibold whitespace-nowrap"
            style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)`, color: `var(--${style.labelColor})` }}
          >
            {data.label}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const nodeTypes = { person: PersonNodeView };
const edgeTypes = { lineage: LineageEdgeView };

function ZoomControls() {
  const flow = useReactFlow();
  const button =
    'inline-grid size-11 place-items-center border-border-subtle bg-surface-1 text-fg hover:bg-surface-3 active:bg-surface-pressed [&:not(:first-child)]:border-t';
  const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <div role="group" aria-label="Zoom" className="flex flex-col overflow-hidden rounded-sm border border-border-strong shadow-pop">
      <button type="button" className={button} aria-label="Zoom in" onClick={() => void flow.zoomIn({ duration: reduced() ? 0 : 200 })}>
        <PlusIcon size={18} />
      </button>
      <button type="button" className={button} aria-label="Zoom out" onClick={() => void flow.zoomOut({ duration: reduced() ? 0 : 200 })}>
        <MinusIcon size={18} />
      </button>
      <button type="button" className={button} aria-label="Fit the whole view" onClick={() => void flow.fitView({ padding: 0.15, duration: reduced() ? 0 : 200 })}>
        <FitIcon size={18} />
      </button>
    </div>
  );
}

/** Up to this many people the first view shows them all; a larger view starts at its top rows and the focus. */
const FIT_ALL_UP_TO = 40;

/** Which nodes the first view fits: all of a small view; the top two rows and the focus of a large one (readable cards, not dots). */
function fitTargets(scene: Scene): { id: string }[] | undefined {
  if (scene.nodes.length <= FIT_ALL_UP_TO) return undefined;
  return scene.nodes.filter((n) => n.rank <= 1 || n.id === scene.focusId).map((n) => ({ id: n.id }));
}

/** Fits the view whenever a new scene arrives (a new focus, depth or view). */
function FitOnScene({ scene }: { scene: Scene }) {
  const flow = useReactFlow();
  // Strings, so the view is fitted once per new scene, not on every render of the same one.
  const key = `${scene.dataVersion}:${scene.focusId}:${scene.nodes.length}`;
  const targets = fitTargets(scene)?.map((n) => n.id).join(' ') ?? '';
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nodes = targets ? targets.split(' ').map((id) => ({ id })) : undefined;
    void flow.fitView({ padding: 0.15, maxZoom: 1, nodes, duration: reduced ? 0 : 250 });
  }, [flow, key, targets]);
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
  return (
    <ReactFlow<PersonNode, LineageEdge>
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
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(null)}
      deleteKeyCode={null}
      aria-label="Lineage graph"
    >
      <FitOnScene scene={scene} />
      <div className="pointer-events-none absolute inset-0 z-10">
        <div className="pointer-events-auto absolute right-[max(0.75rem,env(safe-area-inset-right,0px))] bottom-3">
          <ZoomControls />
        </div>
        {children}
      </div>
    </ReactFlow>
  );
}
