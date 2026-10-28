// The routes of descent of the selected person in the view (plan §4.7; milestone M06, package B):
// a reverse search from the person up the drawn edges gives the people and edges to light
// (`litOf`), and `litFlow` lays the lit flags over M05's selectFlow, giving new objects only to the
// nodes and edges whose flag changes. The canvas draws `data-lit` and the frame `data-highlighting`.
// The routes themselves (root → person, display-primary first, at most 5: DEFAULT D05) are ordered
// and listed by the panel from the lines found here (route-list.ts, in the panel's chunk).
//
// In the explorer's first JavaScript (explorer.tsx imports it): small, and no other imports.

import type { LineageGraphDto } from '@/server/dto/public';

import type { LineageEdge, PersonNode } from './canvas';

/** The drawn lines up from each person (in the view's order), and the selected person: the panel lists the routes from them (route-list.ts). */
export interface RouteSource {
  person: string;
  up: ReadonlyMap<string, readonly Line[]>;
}

/** What a selection lights: node and edge ids, and where its routes are read from (null: nobody selected). */
export interface Lit {
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
  routes: RouteSource | null;
}

/** Nothing lit. */
export const NO_LIGHT: Lit = { nodes: new Set(), edges: new Set(), routes: null };

/** React Flow's nodes and edges of the view, as selectFlow gives them. */
export interface FlowView {
  nodes: PersonNode[];
  edges: LineageEdge[];
}

/** A drawn line into a person: its edge and the teacher. */
export interface Line {
  id: string;
  teacher: string;
}

/** The drawn lines into each person (hidden ended training left out; the selected person's own is drawn by selectFlow). */
function linesUp(view: FlowView): Map<string, Line[]> {
  const up = new Map<string, Line[]>();
  for (const e of view.edges) if (!e.hidden) up.set(e.target, [...(up.get(e.target) ?? []), { id: e.id, teacher: e.source }]);
  return up;
}

/**
 * What the selection lights in the view: the selected person and everyone above them along drawn
 * edges, the drawn edges into those people, and the routes. Nothing when nobody drawn is selected.
 */
export function litOf(view: FlowView, _graph: LineageGraphDto, selectedId: string | null): Lit {
  if (selectedId === null || !view.nodes.some((n) => n.id === selectedId && !n.hidden)) return NO_LIGHT;
  const up = linesUp(view);
  const nodes = new Set([selectedId]);
  const edges = new Set<string>();
  const queue = [selectedId];
  for (let i = 0; i < queue.length; i += 1) {
    for (const line of up.get(queue[i]!) ?? []) {
      edges.add(line.id);
      if (nodes.has(line.teacher)) continue;
      nodes.add(line.teacher);
      queue.push(line.teacher);
    }
  }
  return { nodes, edges, routes: { person: selectedId, up } };
}

// The lit copy of each node or edge object: a person lit by two selections in turn keeps one copy,
// so React Flow does not draw them again (an object of a new scene is a new key).
const litCopies = new WeakMap<object, object>();

function flagged<T extends { data?: Record<string, unknown> }>(item: T, lit: boolean): T {
  if (Boolean(item.data?.lit) === lit) return item;
  const kept = lit ? (litCopies.get(item) as T | undefined) : undefined;
  if (kept) return kept;
  const copy: T = { ...item, data: { ...item.data, lit } };
  if (lit) litCopies.set(item, copy);
  return copy;
}

function flagAll<T extends { id: string; data?: Record<string, unknown> }>(items: T[], lit: ReadonlySet<string>): T[] {
  let changed = false;
  const next = items.map((item) => {
    const flag = flagged(item, lit.has(item.id));
    changed ||= flag !== item;
    return flag;
  });
  return changed ? next : items;
}

/** The flow with the lit flags: new objects only where a flag changes, the same arrays (and flow) when none does. */
export function litFlow<F extends FlowView>(flow: F, lit: Lit): F {
  const nodes = flagAll(flow.nodes, lit.nodes);
  const edges = flagAll(flow.edges, lit.edges);
  return nodes === flow.nodes && edges === flow.edges ? flow : { ...flow, nodes, edges };
}
