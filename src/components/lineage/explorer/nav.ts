// Moving between people with the arrow keys (plan §4.9; milestone M06, package A), pure: ↑ to a
// teacher (a chooser with two or more drawn), ↓ to the drawn student nearest in x, ← and → to the
// nearest person in the same rank without wrapping; the summary node is in the students' row.
// A move with no target says why ("No teachers drawn in this view.", "First in this row.").
//
// Package F's stub: no move yet.

import type { LineageEdge } from './canvas';
import type { FlowNode } from './graph-api';

export type Direction = 'up' | 'down' | 'left' | 'right';

/** Where a key moves: to a node, to a choice between teachers, or nowhere (with the reason, for the live region). */
export type NavTarget = { kind: 'move'; id: string } | { kind: 'choose'; ids: string[] } | { kind: 'none'; reason: string };

/** The drawn graph the keys move in. */
export interface NavGraph {
  nodes: readonly FlowNode[];
  edges: readonly LineageEdge[];
}

const NOWHERE: NavTarget = { kind: 'none', reason: '' };

export const navigate: (graph: NavGraph, from: string, direction: Direction) => NavTarget = () => NOWHERE;
