// The graph's keys, one table (plan §4.9; milestone M06, package A): the shortcut help lists it
// (shortcut-help.tsx), the user guide copies it, and every key in it has a handler (keys.tsx).
//
// Package F's stub: the table is empty; the graph's description is already the one it reads.

/** One row of the shortcut help: the keys and what they do. */
export interface Shortcut {
  keys: readonly string[];
  label: string;
}

/** Package A: Tab, ↑, ↓, ←, →, Enter, Space, +, −, 0, /, ?, Esc. */
export const SHORTCUTS: readonly Shortcut[] = [];

/** The graph's description (the aria-describedby of React Flow's application element), read once on entering the graph. */
export const KEY_HELP = 'Arrow keys move between people. Enter opens the profile. Space highlights the routes. Question mark lists all keys.';
