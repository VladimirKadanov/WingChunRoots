// Expanding the view (plan §4.8; milestone M06, package C): "+N students" and "+N teachers" read
// the difference with lineage.ego ({ up: 0, down: 1 } or { up: 1, down: 0 }), merge it into the
// view by id, pin the people drawn so capFanout never drops them, and lay the view out again with
// the expand preset and the last scene's positions, while the pressed node keeps its screen point
// (the canvas's anchor). The expansions belong to the read (`key`) and are dropped with it.
//
// In the explorer's first JavaScript (explorer.tsx imports it): small, and no other imports.
// Package F's stub: the view is the answer as it is.

import type { LayoutOptions, Scene } from '@/lib/lineage-layout/types';
import type { LineageGraphDto } from '@/server/dto/public';

import type { ExpandDirection, Notice } from './graph-api';

export interface Expansions {
  /** The view: the answer with its expansions merged in (null while there is no answer). */
  graph: LineageGraphDto | null;
  /** The people an expansion drew: capFanout keeps them. */
  pinned: ReadonlySet<string>;
  /** The layout's options: the explorer preset for a read, the expand preset with the last positions for an expansion. */
  layoutOptions: LayoutOptions;
  /** The node whose screen point the next scene keeps (the pressed one), or null. */
  anchorId: string | null;
  onExpand: (id: string, direction: ExpandDirection) => void;
  /** The people whose expansion is loading or being laid out. */
  pending: ReadonlySet<string>;
  /** Said in the live region when an expansion is drawn. */
  notice: Notice | null;
}

const NOBODY: ReadonlySet<string> = new Set();
const EXPLORER_LAYOUT: LayoutOptions = { preset: 'explorer' };
const NO_EXPANSION = () => undefined;

export const useExpansions: (answer: LineageGraphDto | null, key: string, scene: Scene | null) => Expansions = (answer) => ({
  graph: answer,
  pinned: NOBODY,
  layoutOptions: EXPLORER_LAYOUT,
  anchorId: null,
  onExpand: NO_EXPANSION,
  pending: NOBODY,
  notice: null,
});
