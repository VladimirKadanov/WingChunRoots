'use client';

// The controls inside a person's full card (plan §4.8; milestone M06, package C): "+N students"
// and "+N teachers" as real buttons, in the Tab order only on the active node (one tab stop for
// the graph: the node, then its buttons), interactive only with a fine pointer (on touch the same
// actions are 44 px buttons in the sheet: ExpandActions; DEFAULT, no D number). Beyond the cap
// (FANOUT_SHOWN students drawn) "+N students" opens the paginated list instead of expanding.
//
// The students' button is M05's chip [data-more-chip] "+N students", which it replaces; it stays
// one element while its count and its action change, so the focus stays on it.

import { type MouseEvent, type ReactNode, type RefObject, useContext, useLayoutEffect, useRef } from 'react';

import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import type { LineageGraphDto } from '@/server/dto/public';

import { isHistoricalRelation } from '../status';
import type { PersonNodeData } from './canvas';
import { type ExpandDirection, type NodeActions, NodeActionsContext } from './graph-api';

/** What a person's expand buttons count and do. */
export interface ExpandCounts {
  /** Students not drawn: those the cap left out and those the read did not return. */
  students: number;
  /** Teachers not drawn. */
  teachers: number;
  /** The cap cut the students: "+N students" opens their paginated list. */
  list: boolean;
}

/**
 * The counts of a person's node: below the cap the students in the record (childCount) minus those
 * drawn, at the cap the students the cap left out (capFanout's `more`, which counts those the read
 * did not return as well); the teachers in the record minus those drawn.
 */
export function expandCounts(data: Pick<PersonNodeData, 'more' | 'totals' | 'drawn'>): ExpandCounts {
  const list = data.more > 0;
  return {
    students: list ? data.more : Math.max(0, data.totals.students - data.drawn.students),
    teachers: Math.max(0, data.totals.teachers - data.drawn.teachers),
    list,
  };
}

/**
 * The same counts from the view as drawn (the panel's graph, its fan-outs capped), as flowBase
 * counts them for the node: a person's teachers and students in the answer and those it left out,
 * and those drawn before anyone is selected (ended training only with show=historical).
 */
export function countsInView(graph: LineageGraphDto, id: string, more: number, showHistorical: boolean): ExpandCounts {
  const person = graph.nodes.find((n) => n.id === id);
  const teachers = new Set<string>();
  const students = new Set<string>();
  const drawnTeachers = new Set<string>();
  const drawnStudents = new Set<string>();
  for (const e of graph.edges) {
    const drawn = showHistorical || !isHistoricalRelation(e.periods);
    if (e.studentId === id) {
      teachers.add(e.teacherId);
      if (drawn) drawnTeachers.add(e.teacherId);
    }
    if (e.teacherId === id) {
      students.add(e.studentId);
      if (drawn) drawnStudents.add(e.studentId);
    }
  }
  return expandCounts({
    more,
    totals: { teachers: teachers.size + (graph.hiddenCounts[id]?.teachers ?? 0), students: Math.max(person?.childCount ?? 0, students.size) },
    drawn: { teachers: drawnTeachers.size, students: drawnStudents.size },
  });
}

const counted = (n: number, one: string) => `+${n} ${n === 1 ? one : `${one}s`}`;

/**
 * Keeps the keyboard focus in the node when the focused button leaves it (all the students are
 * drawn, so "+N students" goes): the node takes it back. When the whole node leaves, its own
 * focus-loss guard (canvas.tsx) moves the focus on.
 */
function useFocusBack(): RefObject<HTMLButtonElement | null> {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const button = ref.current;
    return () => {
      if (button && document.activeElement === button) button.closest<HTMLElement>('.react-flow__node')?.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}

/** A button inside a node: small, as the card's chips; not a stop of its own in the Tab order unless its node is the active one. */
function NodeButton({
  active,
  busy,
  label,
  name,
  className,
  onPress,
  ...rest
}: {
  active: boolean;
  busy: boolean;
  label: string;
  /** The person's name, after the label in the button's accessible name. */
  name: string;
  className?: string;
  onPress: () => void;
  'data-more-chip'?: string;
}) {
  const ref = useFocusBack();
  const press = (event: MouseEvent<HTMLButtonElement>) => {
    // The press is the button's, not the node's: no selection, no panel.
    event.stopPropagation();
    if (!busy) onPress();
  };
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      // One tab stop for the graph: only the active node's buttons follow it (no tabindex="0").
      tabIndex={active ? undefined : -1}
      aria-label={busy ? `Loading, ${label} of ${name}` : `${label} of ${name}`}
      aria-busy={busy || undefined}
      onClick={press}
      className={cx(
        'nodrag nopan pointer-events-none shrink-0 rounded-xs border border-border-strong bg-surface-1 px-1 leading-3.5 font-semibold text-fg pointer-fine:pointer-events-auto pointer-fine:cursor-pointer pointer-fine:hover:bg-surface-3 focus-visible:outline-offset-1',
        className,
      )}
    >
      {busy ? 'Loading…' : label}
    </button>
  );
}

export interface NodeControlsProps {
  id: string;
  data: PersonNodeData;
  /** The node is the graph's tab stop: its buttons follow it in the Tab order. */
  active: boolean;
}

/** "+N teachers" on the card's top edge (the teachers are above) and "+N students" in its status line (M05's chip). */
export function NodeControls({ id, data, active }: NodeControlsProps) {
  const actions = useContext(NodeActionsContext);
  const counts = expandCounts(data);
  const busy = actions.pending.has(id);
  return (
    <>
      {counts.teachers > 0 ? (
        <NodeButton
          active={active}
          busy={busy}
          label={counted(counts.teachers, 'teacher')}
          name={data.name}
          // Over the card's top edge, at the left: the arbitration banner has the right.
          className="absolute -top-2 left-2 z-10 text-caption tracking-normal"
          onPress={() => actions.expand(id, 'teachers')}
        />
      ) : null}
      {counts.students > 0 ? (
        <NodeButton
          active={active}
          busy={busy}
          data-more-chip=""
          label={counted(counts.students, 'student')}
          name={data.name}
          className={cx(data.teachers < 2 && 'ml-auto')}
          onPress={() => (counts.list ? actions.openStudents(id) : actions.expand(id, 'students'))}
        />
      ) : null}
    </>
  );
}

export interface ExpandActionsProps {
  /** The person whose students or teachers are not all drawn. */
  id: string;
  /** The person's name, in the buttons' accessible names. */
  name: string;
  /** What is not drawn (countsInView, or expandCounts of the node's data). */
  counts: ExpandCounts;
  actions: NodeActions;
}

const ACTION_WORDS: Record<ExpandDirection, string> = { students: 'student', teachers: 'teacher' };

/**
 * The expand actions in the panel or sheet (package B renders them): the node's buttons as 44 px
 * buttons, for touch and for every zoom (the node's own are on full cards only). Nothing when
 * every teacher and student is drawn.
 */
export function ExpandActions({ id, name, counts, actions }: ExpandActionsProps): ReactNode {
  const busy = actions.pending.has(id);
  const button = (direction: ExpandDirection, n: number) => {
    const list = direction === 'students' && counts.list;
    const label = list ? `List all students (${n} not drawn)` : `Show ${n} more ${n === 1 ? ACTION_WORDS[direction] : `${ACTION_WORDS[direction]}s`}`;
    return (
      <button
        key={direction}
        type="button"
        aria-busy={busy || undefined}
        aria-label={busy ? `Loading, ${label} of ${name}` : `${label} of ${name}`}
        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        onClick={() => {
          if (busy) return;
          if (list) actions.openStudents(id);
          else actions.expand(id, direction);
        }}
      >
        {busy ? 'Loading…' : label}
      </button>
    );
  };
  if (counts.students === 0 && counts.teachers === 0) return null;
  return (
    <div role="group" aria-label="Expand" className="flex flex-wrap gap-2">
      {counts.teachers > 0 ? button('teachers', counts.teachers) : null}
      {counts.students > 0 ? button('students', counts.students) : null}
    </div>
  );
}
