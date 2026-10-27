'use client';

// The selection's panel (plan §4.7, §5.6; milestone M06): from 768 px an overlay over the canvas,
// top right; below it a non-modal bottom sheet (package B: the Drawer, snap points 0.15, 0.5 and
// 0.92, the routes of descent, the teachers, "Focus this lineage", "Show ended training", the
// expand actions and, for a summary node, the teacher's students). It loads in a chunk of its own,
// asked for with the canvas's (explorer.tsx), and works the URL itself (the explorer's state):
// what it links to and what its buttons change stay out of the explorer's first JavaScript.
//
// Package F's version: M05's panel, moved here as it was; the "Open profile" link comes from the
// explorer. The overlay is a cover of the canvas (data-canvas-cover): a key move never brings a
// person under it.

import Link from 'next/link';
import { type ReactNode, type Ref, type RefObject, useImperativeHandle } from 'react';

import { CloseIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import type { LineageGraphDto, LineageNodeDto } from '@/server/dto/public';

import type { GenerationLabel } from '../generation';
import { GenerationText } from '../generation-text';
import type { CanvasHandle, NodeActions, PanelHandle } from './graph-api';
import { explorerHref, type ExplorerParams, viewKind } from './state';
import { StudentsList } from './students-list';

/** What the panel shows: the selected person, or the students of a teacher (the summary node "and N more"). */
export type PanelMode = { kind: 'person'; id: string } | { kind: 'students'; teacherId: string };

/** The explorer's URL state (nuqs): the view, and the list view's own keys. */
export interface PanelUrl extends ExplorerParams {
  page: string | null;
  routes: string | null;
}

export interface PanelProps {
  /** Shown: a selection or a students list, while the graph is shown (explorer.tsx). */
  open: boolean;
  mode: PanelMode | null;
  /** The view as drawn (the answer and its expansions, the fan-outs capped). */
  graph: LineageGraphDto;
  /** The selected person (mode person). */
  person: LineageNodeDto | null;
  /** The selected person's generation label in the view. */
  generation: GenerationLabel | null;
  /** The selected person's students not drawn. */
  more: number;
  /** "Open profile", the selected person's profile link (built by the explorer). */
  openProfile: ReactNode;
  /** The routes of descent of the selection, root first (routes.ts litOf, package B). */
  routes: readonly (readonly string[])[];
  /** The explorer's URL state, and its setter: centring, "Focus this lineage", "Show ended training", the list view's links. */
  url: PanelUrl;
  setUrl: (patch: Partial<PanelUrl>) => unknown;
  /** Close: clears the selection (and the students list). */
  onClose: () => void;
  /** The expand actions and the students list (package C). */
  actions: NodeActions;
  /** For Esc on a raised sheet (canvas.tsx collapseSheet). */
  handle: Ref<PanelHandle>;
  /** The canvas: focus back to the graph, the active node kept in view by a sheet's snap. */
  canvas: RefObject<CanvasHandle | null>;
}

// M06 seam: students (C). The panel's place and frame for a teacher's students, as the person's below.
const STUDENTS_PANEL =
  'grid max-h-[50%] shrink-0 content-start gap-3 overflow-y-auto overscroll-contain border-t border-border-strong bg-surface-1 py-4 pr-[max(1rem,env(safe-area-inset-right,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))] md:absolute md:top-3 md:right-[calc(max(0.75rem,env(safe-area-inset-right,0px))+3.5rem)] md:z-20 md:max-h-[calc(100%-1.5rem)] md:w-[min(22rem,calc(100%-5rem))] md:rounded-sm md:border md:p-4 md:shadow-pop';

export default function ExplorerPanel({ open, mode, graph, person, generation, more, openProfile, url, setUrl, onClose, handle }: PanelProps) {
  // No sheet here yet: Esc never collapses it (package B).
  useImperativeHandle(handle, () => ({ collapse: () => false }), []);
  // M06 seam: students (C). The students of a teacher: the summary node "and N more", or "+N
  // students" beyond the cap (package C; package B gives it the phone's sheet).
  const teacher = open && mode?.kind === 'students' ? graph.nodes.find((n) => n.id === mode.teacherId) : undefined;
  if (teacher) {
    return (
      <section aria-labelledby="explorer-students-heading" data-testid="explorer-panel" data-canvas-cover="" className={STUDENTS_PANEL}>
        <div className="flex items-start justify-between gap-2">
          <h2 id="explorer-students-heading" className="font-display text-xl leading-tight [overflow-wrap:anywhere]">
            Students of{' '}
            <span lang="und-Latn" translate="no">
              {teacher.displayName}
            </span>
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mt-2 -mr-2 inline-grid size-11 shrink-0 place-items-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg"
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <StudentsList key={teacher.id} teacherId={teacher.id} slug={teacher.slug} name={teacher.displayName} />
      </section>
    );
  }
  if (!open || mode?.kind !== 'person' || !person) return null;
  const kind = viewKind(url);
  // The lineage view reads the lineage from its root, whoever is in focus: centring there opens the person view.
  const centerOn = (id: string) => setUrl(kind === 'lineage' ? { focus: id, lineage: null, page: null, routes: null } : { focus: id, page: null, routes: null });
  return (
    <section
      aria-label={`Selected: ${person.displayName}`}
      data-testid="explorer-panel"
      data-canvas-cover=""
      // On a phone a panel below the graph, which leaves the legend, the zoom buttons and the
      // people in view (plan §4.6); over the graph on the right from md (plan §4.7), left of
      // the zoom buttons' column (44 px and its border), so a short pane (a phone turned to
      // landscape) does not cover them either.
      className="grid max-h-[50%] shrink-0 gap-3 overflow-y-auto border-t border-border-strong bg-surface-1 py-4 pr-[max(1rem,env(safe-area-inset-right,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))] [--seal-ground:var(--surface-1)] md:absolute md:top-3 md:right-[calc(max(0.75rem,env(safe-area-inset-right,0px))+3.5rem)] md:z-20 md:max-h-[calc(100%-1.5rem)] md:w-[min(20rem,calc(100%-5rem))] md:rounded-sm md:border md:p-4 md:shadow-pop"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display text-xl leading-tight [overflow-wrap:anywhere]">
          <span lang="und-Latn" translate="no">
            {person.displayName}
          </span>
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="-mt-2 -mr-2 inline-grid size-11 shrink-0 place-items-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg"
        >
          <CloseIcon size={18} />
        </button>
      </div>
      {generation ? (
        <p className="text-sm text-fg-muted">
          <GenerationText label={generation} />
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {openProfile}
        {person.id !== url.focus ? (
          <button type="button" className={buttonVariants({ variant: 'secondary' })} onClick={() => centerOn(person.id)}>
            Center on this person
          </button>
        ) : null}
      </div>
      {more > 0 ? (
        // Plan §4.8: the students a large fan-out does not draw are a paginated list away.
        // The list view inside the explorer, with this person in focus (the lineage view centres
        // on a person as the person view, as centerOn does).
        <Link
          href={`${explorerHref({ ...url, focus: person.id, view: 'list', ...(kind === 'lineage' ? { lineage: null } : {}) })}#students-heading`}
          className="link inline-flex min-h-11 items-center text-sm"
        >
          All students in the list view (+{more} not drawn)
        </Link>
      ) : null}
    </section>
  );
}
