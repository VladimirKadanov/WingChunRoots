// The routes of descent of the selected person in the view (plan §4.7; milestone M06, package B):
// a reverse search from the person up the drawn edges gives the people and edges to light
// (`litOf`, with the routes root → person, display-primary first, at most 5: DEFAULT D05), and
// `litFlow` lays the lit flags over M05's selectFlow, giving new objects only to the nodes and
// edges whose flag changes. The canvas draws `data-lit` and the frame `data-highlighting`.
//
// In the explorer's first JavaScript (explorer.tsx imports it): small, and no other imports.
// Package F's stub: nothing is lit.

import type { LineageGraphDto } from '@/server/dto/public';

import type { LineageEdge, PersonNode } from './canvas';

/** What a selection lights: node and edge ids, and the routes (person ids, root first). */
export interface Lit {
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
  routes: readonly (readonly string[])[];
}

/** Nothing lit. */
export const NO_LIGHT: Lit = { nodes: new Set(), edges: new Set(), routes: [] };

/** React Flow's nodes and edges of the view, as selectFlow gives them. */
export interface FlowView {
  nodes: PersonNode[];
  edges: LineageEdge[];
}

export const litOf: (view: FlowView, graph: LineageGraphDto, selectedId: string | null) => Lit = () => NO_LIGHT;

export const litFlow: <F extends FlowView>(flow: F, lit: Lit) => F = (flow) => flow;
