'use client';

// The graph's keyboard (plan §4.9; milestone M06, package A): one key handler on the wrapper
// around React Flow (canvas.tsx, data-graph-keys), so single-key shortcuts work only while the
// focus is in the graph (WCAG 2.1.4). Package A fills it in: the arrow keys between people
// (nav.ts), Enter and Space, + − 0, "/" (the search palette), "?" (the shortcut help), Esc, the
// teacher chooser, and the announcements (announce.ts).
//
// Package F's stub: no key does anything yet; the canvas already calls it in its place.

import type { KeyboardEvent, ReactNode } from 'react';

import type { FlowApi, GraphContext } from './graph-api';

export interface GraphKeys {
  /** The wrapper's one key handler, or undefined. */
  onKeyDown: ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined;
  /** What the keys open over the graph: the teacher chooser and the shortcut help. */
  overlay: ReactNode;
  /** Opens the shortcut help (the "Keyboard shortcuts" button over the canvas). */
  showHelp: () => void;
}

const NO_KEYS: GraphKeys = { onKeyDown: undefined, overlay: null, showHelp: () => undefined };

/** The graph's keys, given the view (`flow`) and what they act on (`context`). */
export const useGraphKeys: (flow: FlowApi, context: GraphContext) => GraphKeys = () => NO_KEYS;
