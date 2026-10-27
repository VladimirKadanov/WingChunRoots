// What the live region says (plan §4.9; milestone M06): the active node after a key move, "{name}.
// {Status}. {T} teachers, {S} students. {generation label}." (package A, DEFAULT D22 for the
// label), and the notices ("Added 12 students of {name}.", package C) and the reasons a move has
// no target, each once in its place. Key moves are spoken after a short quiet, so holding an
// arrow key does not queue a stream of speech (DEFAULT, no D number: 250 ms).
//
// Package F wires the live region in canvas.tsx and the announcer below; package A writes the words.

import type { FlowNode } from './graph-api';

/** The quiet after a key move before its words are spoken (DEFAULT, no D number). */
export const ANNOUNCE_DELAY = 250;

/** The words for the node a key move landed on. Package F's stub: the name (a summary node: its label). */
export function announce(node: FlowNode): string {
  return node.type === 'more' ? (node.ariaLabel ?? '') : node.data.name;
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
