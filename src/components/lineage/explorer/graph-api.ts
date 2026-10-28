// The seams between the explorer's canvas and the M06 modules that act on it (milestone M06,
// package F). Only canvas.tsx imports @xyflow/react: the keyboard (keys.tsx), the panel and the
// expansion get the view through these interfaces, which the canvas fills in, so none of them
// names React Flow and none of them needs a line of canvas.tsx or explorer.tsx changed.

import { createContext } from 'react';

import type { LineageEdge, PersonNode, SummaryNode } from './canvas';
import type { PaneArea, View } from './viewport';

/** A node React Flow draws: a person, or the summary node "and N more" of a teacher (package C). */
export type FlowNode = PersonNode | SummaryNode;

/** How the active node (the graph's one tab stop) moves. */
export interface ActiveOptions {
  /** Move the keyboard focus to it: the view first moves it wholly into view (ensureVisible), then it is focused once drawn. */
  focus?: boolean;
  /** Speak it in the live region once focused (a key move; never a pointer's). */
  announce?: boolean;
}

/**
 * The view, as the keyboard sees it (injected by the canvas; no React Flow type here). Every move
 * uses the motion tokens and is counted while it runs (canvas.tsx trackMove), as the buttons' are.
 */
export interface FlowApi {
  /** React Flow's view now. */
  view(): View;
  /** The pane and its overlays and covers, in the pane's pixels. */
  pane(): PaneArea;
  /** A node's element (`.react-flow__node`) when it is drawn, else null. */
  element(id: string): HTMLElement | null;
  /** The ids of the nodes React Flow draws at this view (onlyRenderVisibleElements). */
  drawn(): string[];
  zoomIn(): void;
  zoomOut(): void;
  /** "Fit the whole view" (the button's own handler). */
  fit(): void;
  /** Centres the view on a node at the current zoom. */
  center(id: string): void;
}

/** A notice for the live region, spoken once in place of the active node's announcement ("Added 12 students of {name}."). */
export interface Notice {
  /** A new key for every notice, so the same words are spoken again. */
  key: number;
  text: string;
}

/** What the keyboard (keys.tsx, package A) acts on, filled in by the canvas from the explorer's props. */
export interface GraphContext {
  /** Every node passed to React Flow: people and summary nodes, hidden ones included (`hidden`). */
  nodes: readonly FlowNode[];
  edges: readonly LineageEdge[];
  /** The person in focus of the view. */
  focusId: string | null;
  /** The graph's one tab stop (roving tabindex). */
  activeId: string | null;
  setActive(id: string, options?: ActiveOptions): void;
  /** The selected person, or null. */
  selectedId: string | null;
  /** Selects a person (the panel or sheet opens) or clears the selection. */
  select(id: string | null): void;
  /** Opens the panel's list of a teacher's students (the summary node). */
  openStudents(teacherId: string): void;
  /** Closes the panel's list of students, keeping the selection; true when a list was open (Esc). */
  closeList(): boolean;
  /** Speaks these words in the live region now (no wait): a move that has no target says why. */
  say(text: string): void;
  /** Collapses a phone's sheet that is above its peek; true when it did (Esc, package A and B). */
  collapseSheet(): boolean;
}

/** The panel's handle (package B): Esc collapses a raised sheet to its peek before it clears the selection. */
export interface PanelHandle {
  /** Collapses the sheet to its peek; false when it was not above it (or there is no sheet). */
  collapse(): boolean;
}

/** The canvas's handle, for the panel (package B): focus goes back to the graph, and a sheet's snap keeps the active node in view. */
export interface CanvasHandle {
  /** The active node's element when it is drawn. */
  activeElement(): HTMLElement | null;
  /**
   * Moves the view so that this node (default: the active one) is wholly in the visible area,
   * once the view's running moves (a zoom button's, a new scene's fit) have ended.
   */
  ensureVisible(id?: string): void;
  /** Moves the keyboard focus to the active node (after ensureVisible). */
  focusActive(): void;
  /**
   * How far down the window (px from its top) the canvas frame must reach so that the legend (and
   * whatever else lies along the frame's bottom edge) and the active node's card, at the zoom now,
   * fit whole in it, one above the other with the view's gaps (plan §4.6: the legend is always in
   * view; viewport.ts ensureVisible); null without a canvas. A phone's sheet rests no higher at
   * its middle snap point.
   */
  keepInView(): number | null;
  /**
   * The same with the active node's card at the smallest zoom the view zooms out to for it
   * (READABLE_ZOOM, or the zoom now where smaller): a phone's sheet that would leave the canvas
   * frame less covers it instead of shrinking it (the Drawer's coverAbove; milestone M06, a11y-6).
   * Never more than keepInView.
   */
  coverAbove(): number | null;
  /**
   * Whether the canvas above this window y (the top of a sheet that covers it) can show the active
   * node whole, at the smallest zoom the view zooms out to for it, with the view's gaps; true
   * without a canvas or an active node.
   */
  showsAbove(y: number): boolean;
}

/** Where an expand button opens the view: the person's students, or their teachers (package C). */
export type ExpandDirection = 'students' | 'teachers';

/** What the buttons inside a node and the summary node do (package C), given to them by the canvas. */
export interface NodeActions {
  /** Draws the students or teachers of a person that are not drawn (the "+N students" / "+N teachers" buttons). */
  expand(id: string, direction: ExpandDirection): void;
  /** The people whose expansion is loading or being laid out ("Loading…", aria-busy). */
  pending: ReadonlySet<string>;
  /** Opens the panel's list of a teacher's students (a summary node, or "+N students" at the cap). */
  openStudents(teacherId: string): void;
  /** Closes the panel's list of students and keeps the selection; false when no list was open (Esc). */
  closeStudents(): boolean;
}

const NOBODY: ReadonlySet<string> = new Set();
/** No actions: before package C fills them in, and outside the canvas. */
export const NO_NODE_ACTIONS: NodeActions = { expand: () => undefined, pending: NOBODY, openStudents: () => undefined, closeStudents: () => false };

/** The node actions for the nodes React Flow draws (a context: React Flow renders the nodes, not the canvas). */
export const NodeActionsContext = createContext<NodeActions>(NO_NODE_ACTIONS);

/** The id of the graph's description, the key help (the aria-describedby of React Flow's application element). */
export const KEYS_HELP_ID = 'explorer-keys-help';
