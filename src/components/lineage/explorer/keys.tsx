'use client';

// The graph's keyboard (plan §4.9; milestone M06, package A): one key handler on the wrapper
// around React Flow (canvas.tsx, data-graph-keys), so single-key shortcuts work only while the
// focus is in the graph (WCAG 2.1.4): never at page level, never from the toolbar.
//
// - The handler acts only on a key pressed on a node (`.react-flow__node`) or on a button inside
//   one; Enter and Space on such a button are the button's (no profile, no selection), the arrows
//   act from its node. A key with Ctrl, Alt or Meta is never the graph's, so Ctrl/⌘+K still
//   reaches the search palette. It never stops the event's propagation, and it prevents the
//   default only of the keys it handles (the arrows and Space never scroll the page). Tab is the
//   browser's: never trapped.
// - ↑ ↓ ← → move the active node (nav.ts) and the focus with it (canvas.tsx setActive: the view
//   first moves the node wholly into view, then it is focused once drawn), and the live region
//   says where (announce.ts); a move with no target says why. ↑ with two or more teachers drawn
//   opens the teacher chooser.
// - Enter opens the profile (router.push); Space selects (the panel opens, the routes light up).
//   On the summary node "and N more", both open the list of the teacher's students.
// - + (or =), − and 0 zoom in, zoom out and fit, as the buttons over the canvas do (motion tokens).
// - "/" opens the search palette (M07, src/components/shell/search-trigger.tsx); "?" opens the
//   shortcut help. Both return the focus to the node when they close (Base UI's dialogs return it
//   to the element focused before they opened).
// - Esc: the chooser and the help close themselves (they have the focus); on a node, Esc lowers a
//   phone's sheet that is above its peek, else clears the selection.

import { useRouter } from 'next/navigation';
import { type KeyboardEvent, lazy, type ReactNode, Suspense, useState } from 'react';

import { openSearch } from '@/components/shell/search-trigger';

import type { PersonNode } from './canvas';
import type { FlowApi, GraphContext } from './graph-api';
import { type Direction, navigate } from './nav';
import { actionOf, type GraphAction } from './shortcuts';
import { isSummaryId, summaryTeacherOf } from './state';
import { TeacherChooser } from './teacher-chooser';

// In a chunk of its own, asked for when the canvas mounts (the lazy component renders, closed,
// with the canvas), so "?" never waits for it.
const ShortcutHelp = lazy(() => import('./shortcut-help').then((m) => ({ default: m.ShortcutHelp })));

export interface GraphKeys {
  /** The wrapper's one key handler, or undefined. */
  onKeyDown: ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined;
  /** What the keys open over the graph: the teacher chooser and the shortcut help. */
  overlay: ReactNode;
  /** Opens the shortcut help (the "Keyboard shortcuts" button over the canvas). */
  showHelp: () => void;
}

/** What the keys act on, besides the view and the graph: the page and the dialogs. */
export interface KeyDeps {
  flow: FlowApi;
  context: GraphContext;
  /** Goes to a page (router.push). */
  go(href: string): void;
  /** Opens the search palette. */
  search(): void;
  /** Opens the shortcut help. */
  help(): void;
  /** Opens the teacher chooser on the node `from`, with these teachers in order. */
  choose(from: string, teachers: readonly string[]): void;
}

/** What a key does on the node `id`: true when the graph handled it (its default is then prevented). */
export type KeyHandler = (id: string) => boolean;

/**
 * The handler of every action in the key table (shortcuts.ts). A Record over GraphAction: a key
 * in the table without a handler does not compile, and shortcuts.test.ts checks each one.
 */
export function keyHandlers(deps: KeyDeps): Record<GraphAction, KeyHandler> {
  const { flow, context } = deps;
  const move = (direction: Direction): KeyHandler => (id) => {
    const target = navigate({ nodes: context.nodes, edges: context.edges }, id, direction);
    if (target.kind === 'move') context.setActive(target.id, { focus: true, announce: true });
    else if (target.kind === 'choose') deps.choose(id, target.ids);
    else if (target.reason) context.say(target.reason);
    return true;
  };
  const person = (id: string) => context.nodes.find((n): n is PersonNode => n.id === id && !isSummaryId(n.id)) ?? null;
  return {
    // The browser's: the focus moves on to the controls after the graph.
    tab: () => false,
    up: move('up'),
    down: move('down'),
    left: move('left'),
    right: move('right'),
    open: (id) => {
      if (isSummaryId(id)) {
        context.openStudents(summaryTeacherOf(id));
        return true;
      }
      const slug = person(id)?.data.slug;
      if (slug) deps.go(`/people/${encodeURIComponent(slug)}`);
      return true;
    },
    select: (id) => {
      if (isSummaryId(id)) context.openStudents(summaryTeacherOf(id));
      else {
        context.setActive(id);
        context.select(id);
      }
      return true;
    },
    zoomIn: () => {
      flow.zoomIn();
      return true;
    },
    zoomOut: () => {
      flow.zoomOut();
      return true;
    },
    fit: () => {
      flow.fit();
      return true;
    },
    search: () => {
      deps.search();
      return true;
    },
    help: () => {
      deps.help();
      return true;
    },
    escape: () => {
      if (context.collapseSheet()) return true;
      if (context.selectedId === null) return false;
      context.select(null);
      return true;
    },
  };
}

/** The node a key was pressed on, and whether on a control inside it; null when not on a node of this graph. */
function nodeOf(event: KeyboardEvent<HTMLDivElement>): { id: string; inside: boolean } | null {
  const target = event.target instanceof Element ? event.target : null;
  const node = target?.closest<HTMLElement>('.react-flow__node');
  const id = node?.dataset.id;
  if (!target || !node || !id || !event.currentTarget.contains(node)) return null;
  return { id, inside: target !== node };
}

/** The graph's keys, given the view (`flow`) and what they act on (`context`). */
export function useGraphKeys(flow: FlowApi, context: GraphContext): GraphKeys {
  const router = useRouter();
  const [chooser, setChooser] = useState<{ from: string; anchor: HTMLElement | null; ids: readonly string[] } | null>(null);
  const [help, setHelp] = useState(false);
  const handlers = keyHandlers({
    flow,
    context,
    go: (href) => router.push(href),
    search: openSearch,
    help: () => setHelp(true),
    choose: (from, ids) => setChooser({ from, anchor: flow.element(from), ids }),
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const action = actionOf(event);
    if (action === null) return;
    const on = nodeOf(event);
    if (!on) return;
    // Enter and Space on a button inside a node are that button's.
    if (on.inside && (action === 'open' || action === 'select')) return;
    if (handlers[action](on.id)) event.preventDefault();
  };

  const nameOf = (id: string) => context.nodes.find((n) => n.id === id)?.data.name ?? '';
  const overlay = (
    <>
      {chooser ? (
        <TeacherChooser
          anchor={chooser.anchor}
          label={`Teachers of ${nameOf(chooser.from)}`}
          teachers={chooser.ids.map((id) => ({ id, name: nameOf(id) }))}
          onChoose={(id) => {
            setChooser(null);
            // Once the menu has closed and let the focus go (a task later): focused while the
            // menu is still open, the node would lose the focus to it again.
            const { setActive } = context;
            window.setTimeout(() => setActive(id, { focus: true, announce: true }));
          }}
          onClose={() => setChooser(null)}
        />
      ) : null}
      <Suspense fallback={null}>
        <ShortcutHelp open={help} onOpenChange={setHelp} />
      </Suspense>
    </>
  );

  return { onKeyDown, overlay, showHelp: () => setHelp(true) };
}
