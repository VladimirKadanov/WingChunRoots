'use client';

// The back chip beside the explorer's heading (explorer focus review 2026-11, ADR 0054, P5): one
// step back to the view before the focus last changed in the explorer. A chunk of its own, asked
// for with the canvas's (explorer.tsx): the explorer's first JavaScript is at its budget, and the
// chip is needed only once the focus has changed, which takes the canvas.

import { useState } from 'react';

import { ArrowLeftIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';

import { type ExplorerParams, viewKind } from './state';

type TrailParams = Pick<ExplorerParams, 'focus' | 'up' | 'down' | 'lineage'>;

/** The view the focus last changed from: its params and its heading. */
export interface FocusTrailStep {
  params: TrailParams;
  label: string;
  /** Whether the label is a lineage's name (a person's otherwise). */
  lineage: boolean;
}

/**
 * The view before the focus last changed: whoever changed it (a card's "Show their tree", a view
 * button with someone selected, "Focus this lineage", the browser's Back). Going back through the
 * chip is a change as well, so the chip then leads to the view just left: one step, back and
 * forth. Null until the focus has changed, and after a change from a view whose heading was not
 * known yet.
 */
export function useFocusTrail(params: ExplorerParams, label: string | null): FocusTrailStep | null {
  const current = { params: { focus: params.focus, up: params.up, down: params.down, lineage: params.lineage }, label, lineage: viewKind(params) === 'lineage' };
  const [seen, setSeen] = useState(current);
  const [trail, setTrail] = useState<FocusTrailStep | null>(null);
  if (seen.params.focus !== current.params.focus) {
    setTrail(seen.params.focus && seen.label ? { params: seen.params, label: seen.label, lineage: seen.lineage } : null);
    setSeen(current);
  } else if (label !== null && (seen.label !== label || seen.params.up !== params.up || seen.params.down !== params.down || seen.params.lineage !== params.lineage)) {
    // The same focus in another view, or its heading now known: the step back returns to this one.
    setSeen(current);
  }
  return trail;
}

export interface FocusTrailProps {
  params: ExplorerParams;
  /** The heading of the view shown now (a lineage's name or the person in focus), or null while unknown. */
  label: string | null;
  setUrl: (patch: Partial<TrailParams & { page: string | null; routes: string | null }>) => unknown;
}

export default function FocusTrail({ params, label, setUrl }: FocusTrailProps) {
  const back = useFocusTrail(params, label);
  if (!back) return null;
  return (
    <button
      type="button"
      data-testid="explorer-back"
      aria-label={`Back to ${back.label}`}
      // A new focus drops the list's page and routes, which were the person before's (panel.tsx centerOn).
      onClick={() => void setUrl({ ...back.params, page: null, routes: null })}
      className={cx(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-3 shrink-0 md:max-w-[16rem]')}
    >
      <ArrowLeftIcon />
      {/* On a phone the arrow alone (its name says where it goes): the heading keeps the room. */}
      <span lang={back.lineage ? undefined : 'und-Latn'} translate="no" className="truncate max-md:sr-only">
        {back.label}
      </span>
    </button>
  );
}
