'use client';

// The summary node "and N more →" (plan §4.8; milestone M06, package C): in the students' row of a
// teacher whose drawn students reached the cap, a button (aria-label "and N more students of
// {name}") that opens the paginated list of the teacher's students in the panel. Never selected
// or lit.
//
// Package F's stub: the words on a plain card.

import type { DetailLevel } from '@/lib/lineage-layout/types';

import type { SummaryNodeData } from './canvas';

export interface SummaryCardProps {
  data: SummaryNodeData;
  lod: DetailLevel;
}

export function SummaryCard({ data }: SummaryCardProps) {
  return (
    <div className="flex size-full items-center justify-center overflow-hidden rounded-sm border border-border-strong bg-surface-1 px-2 text-caption font-semibold tracking-normal text-fg">
      and {data.more} more →
    </div>
  );
}
