'use client';

// The summary node "and N more →" (plan §4.8; milestone M06, package C): in the students' row of a
// teacher whose drawn students reached the cap, a button (aria-label "and N more students of
// {name}", canvas.tsx summaryNodes) that opens the paginated list of the teacher's students in the
// panel: Enter, Space or a click. Never selected or lit.
//
// A card of the same size as a person's, with a dashed frame: it stands for people, it is not one.
// It follows the zoom's levels of detail as the people's cards do; its words are for the eye (the
// node's aria-label names it).

import type { DetailLevel } from '@/lib/lineage-layout/types';
import { cx } from '@/lib/cx';

import type { SummaryNodeData } from './canvas';

export interface SummaryCardProps {
  data: SummaryNodeData;
  lod: DetailLevel;
}

/** "and N more →", the card's words at every level of detail but the dot. */
export const summaryWords = (more: number): string => `and ${more.toLocaleString('en')} more →`;
/**
 * The full card's second line before the teacher's name: "student of" for one, as the node's
 * aria-label says (canvas.tsx summaryNodes), so the visible words are part of its accessible name
 * (WCAG 2.5.3).
 */
export const summaryOf = (more: number): string => (more === 1 ? 'student of' : 'students of');

const frame = 'border border-dashed border-border-strong bg-surface-1 text-fg pointer-fine:cursor-pointer pointer-fine:hover:bg-surface-3';

export function SummaryCard({ data, lod }: SummaryCardProps) {
  if (lod === 'dot') return <div className={cx('size-full rounded-full', frame)} />;
  if (lod === 'compact') {
    return (
      <div className={cx('flex size-full items-center overflow-hidden rounded-sm px-1.5', frame)}>
        <span className="truncate text-caption font-semibold tracking-normal">{summaryWords(data.more)}</span>
      </div>
    );
  }
  return (
    <div className={cx('flex size-full flex-col justify-center gap-0.5 overflow-hidden rounded-sm px-2 py-1 text-left', frame)}>
      <span className="truncate font-display text-base leading-4.5">{summaryWords(data.more)}</span>
      <span className="truncate text-caption leading-3.5 font-normal tracking-normal text-fg-muted">
        {summaryOf(data.more)}{' '}
        <span lang="und-Latn" translate="no">
          {data.name}
        </span>
      </span>
    </div>
  );
}
