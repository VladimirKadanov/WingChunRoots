'use client';

// The controls inside a person's full card (plan §4.8; milestone M06, package C): "+N students"
// and "+N teachers" as real buttons, in the Tab order only on the active node (one tab stop for
// the graph), interactive only with a fine pointer (on touch the same actions are in the sheet:
// ExpandActions). At the cap "+N students" opens the paginated list instead.
//
// Package F's stub: M05's chip "+N students", moved here as it was.

import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

import type { PersonNodeData } from './canvas';
import type { NodeActions } from './graph-api';

export interface NodeControlsProps {
  id: string;
  data: PersonNodeData;
  /** The node is the graph's tab stop: its buttons follow it in the Tab order. */
  active: boolean;
}

export function NodeControls({ data }: NodeControlsProps) {
  return data.more > 0 ? (
    <span data-more-chip="" className={cx('shrink-0 text-fg-muted', data.teachers < 2 && 'ml-auto')}>
      +{data.more} students
    </span>
  ) : null;
}

export interface ExpandActionsProps {
  /** The person whose students or teachers are not all drawn. */
  id: string;
  actions: NodeActions;
}

/** The expand actions in the panel or sheet (44 px buttons; package C). */
export const ExpandActions: (props: ExpandActionsProps) => ReactNode = () => null;
