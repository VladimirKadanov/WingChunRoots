// What the live region says (plan §4.9; milestone M06): the active node after a key move, "{name}.
// {Status}. {T} teachers, {S} students. {generation label}." (package A, DEFAULT D22 for the
// label), and the notices ("Added 12 students of {name}.", package C) and the reasons a move has
// no target, each once in its place. Key moves are spoken after a short quiet, so holding an
// arrow key does not queue a stream of speech (DEFAULT, no D number: 250 ms); so are a selection,
// its clearing and a list of students opened (after their change is painted).
//
// Package F wires the live region in canvas.tsx and the announcer below; package A writes the words.

import { generationText } from '../generation';
import type { PersonNode } from './canvas';
import type { FlowNode } from './graph-api';
import { isSummaryId } from './state';

/** The quiet after a key move before its words are spoken (DEFAULT, no D number). */
export const ANNOUNCE_DELAY = 250;

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The words for the node a key move landed on: "{name}. {Status}. {T} teachers, {S} students.
 * {generation label}." The status is the card's (the line into the person drawn, display-primary
 * first); a person with no line drawn into them reads as the card does, "Root of this lineage." or
 * "Top of this view.". The counts are the record's (public): the teachers in the answer and those
 * it left out, and every student (explorer.tsx flowBase `totals`), not only those drawn.
 * DEFAULT D22: the generation label is the card's (generationText), "Generation N from {root}"
 * only on a verified chain to the lineage's recorded root, else "N generations below {name} in
 * this view"; none for the top of the view. A summary node says its name, "and N more students
 * of {name}".
 */
export function announce(node: FlowNode): string {
  if (isSummaryId(node.id)) return `${node.ariaLabel ?? ''}.`;
  const { data } = node as PersonNode;
  const status = data.status ? data.status.label : data.root ? 'Root of this lineage' : 'Top of this view';
  const parts = [data.name, status, `${counted(data.totals.teachers, 'teacher', 'teachers')}, ${counted(data.totals.students, 'student', 'students')}`];
  if (data.generation) parts.push(generationText(data.generation));
  return parts.map((part) => `${part}.`).join(' ');
}

/**
 * The words for a selection (Space, a click or a tap): the person, and where the details are (the
 * panel over the canvas, or on a phone the bottom sheet).
 */
export function selectedWords(name: string, sheet: boolean): string {
  return sheet ? `${name} selected. Routes of descent and details are in the sheet below.` : `${name} selected. Routes of descent and details are open.`;
}

/** The words for a selection cleared (Esc, a click on the empty canvas). */
export const SELECTION_CLEARED = 'Selection cleared.';

/** The words for the list of a teacher's students opened (the summary node "and N more"). */
export function studentsOpenWords(name: string): string {
  return `Students of ${name}: list open.`;
}

export interface Announcer {
  /** A key move landed on a node: its words, once nothing else came for `delay` ms. */
  move(text: string): void;
  /** A notice, or why a move has no target: at once, in place of the words of a move still waiting. */
  notice(text: string): void;
  /** Drops the words of a move still waiting. */
  dispose(): void;
}

/** The live region's scheduler: `write` puts the words in the region. */
export function createAnnouncer(write: (text: string) => void, delay = ANNOUNCE_DELAY): Announcer {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    move(text) {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        write(text);
      }, delay);
    },
    notice(text) {
      cancel();
      write(text);
    },
    dispose: cancel,
  };
}
