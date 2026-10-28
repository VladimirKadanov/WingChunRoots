// The graph's keys, one table (plan §4.9; milestone M06, package A): the shortcut help lists it
// (shortcut-help.tsx), the user guide copies it, and every key in it has a handler (keys.tsx
// keyHandlers, typed by GraphAction, so a row without one does not compile). Pure: no React.
//
// The keys work only while the focus is in the graph (the wrapper's one handler, WCAG 2.1.4). They
// are matched by the character they type (KeyboardEvent.key), so "/" and "?" work on any layout
// that can type them; a key pressed with Ctrl, Alt or Meta is never the graph's (Ctrl/⌘+K stays
// the search palette's everywhere).

/** What a key does in the graph. */
export type GraphAction = 'tab' | 'up' | 'down' | 'left' | 'right' | 'open' | 'select' | 'zoomIn' | 'zoomOut' | 'fit' | 'search' | 'help' | 'escape';

/** One row of the shortcut help: the keys and what they do. */
export interface Shortcut {
  action: GraphAction;
  /** The keys that do it, as KeyboardEvent.key names them ("Space" for the space bar: keyName). */
  keys: readonly string[];
  /** The key as the help and the user guide show it. */
  key: string;
  /** What it does. */
  label: string;
}

/** Tab, ↑, ↓, ←, →, Enter, Space, +, −, 0, /, ?, Esc, in the order the help lists them. */
export const SHORTCUTS: readonly Shortcut[] = [
  { action: 'tab', keys: ['Tab'], key: 'Tab', label: 'Into the graph, to the person chosen last; again, on to the controls after it' },
  { action: 'up', keys: ['ArrowUp'], key: '↑', label: 'To a teacher (a list to choose from when two or more are drawn)' },
  { action: 'down', keys: ['ArrowDown'], key: '↓', label: 'To the student drawn nearest below' },
  { action: 'left', keys: ['ArrowLeft'], key: '←', label: 'To the person before in the same row' },
  { action: 'right', keys: ['ArrowRight'], key: '→', label: 'To the person after in the same row' },
  { action: 'open', keys: ['Enter'], key: 'Enter', label: 'Open the profile (on “and N more”: the list of the students)' },
  { action: 'select', keys: ['Space'], key: 'Space', label: 'Select: highlight the routes of descent and show the details' },
  { action: 'zoomIn', keys: ['+', '='], key: '+', label: 'Zoom in' },
  { action: 'zoomOut', keys: ['-'], key: '−', label: 'Zoom out' },
  { action: 'fit', keys: ['0'], key: '0', label: 'Fit the whole view' },
  { action: 'search', keys: ['/'], key: '/', label: 'Search people, schools and lineages' },
  { action: 'help', keys: ['?'], key: '?', label: 'Show these keys' },
  { action: 'escape', keys: ['Escape'], key: 'Esc', label: 'Close a list or lower the details, then clear the selection' },
];

/** A key's name as the table has it: "Space" for the space bar, "Escape" for an old browser's "Esc". */
export function keyName(key: string): string {
  if (key === ' ' || key === 'Spacebar') return 'Space';
  if (key === 'Esc') return 'Escape';
  return key;
}

const BY_KEY: ReadonlyMap<string, GraphAction> = new Map(SHORTCUTS.flatMap((s) => s.keys.map((k) => [k, s.action] as const)));

/** The graph's action for a key press, or null: not one of the graph's keys, or pressed with Ctrl, Alt or Meta. */
export function actionOf(event: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): GraphAction | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  return BY_KEY.get(keyName(event.key)) ?? null;
}

/** The graph's description (the aria-describedby of React Flow's application element), read once on entering the graph. */
export const KEY_HELP = 'Arrow keys move between people. Enter opens the profile. Space highlights the routes. Question mark lists all keys.';
