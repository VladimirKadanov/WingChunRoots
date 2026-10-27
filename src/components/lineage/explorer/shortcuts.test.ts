// The graph's keys (shortcuts.ts, keys.tsx; milestone M06, package A): the help lists every key in
// the order of the milestone (Tab, ↑, ↓, ←, →, Enter, Space, +, −, 0, /, ?, Esc), every key in the
// table has a handler and does what its help row says, keys are matched by the character typed,
// and a key with Ctrl, Alt or Meta is never the graph's.

import { describe, expect, it, vi } from 'vitest';

import type { Box } from '@/lib/lineage-layout/types';

import type { LineageEdge, PersonNode, SummaryNode } from './canvas';
import type { FlowApi, FlowNode, GraphContext } from './graph-api';
import { type KeyDeps, keyHandlers } from './keys';
import { actionOf, KEY_HELP, keyName, SHORTCUTS } from './shortcuts';

const press = (key: string, modifiers: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
  key,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...modifiers,
});

describe('SHORTCUTS', () => {
  it('lists the keys of the milestone, in its order, each once', () => {
    expect(SHORTCUTS.map((s) => s.key)).toEqual(['Tab', '↑', '↓', '←', '→', 'Enter', 'Space', '+', '−', '0', '/', '?', 'Esc']);
    expect(new Set(SHORTCUTS.map((s) => s.action)).size).toBe(SHORTCUTS.length);
    const keys = SHORTCUTS.flatMap((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has a help row with words for every key', () => {
    for (const s of SHORTCUTS) {
      expect(s.label.length, s.key).toBeGreaterThan(3);
      expect(s.keys.length, s.key).toBeGreaterThan(0);
    }
  });

  it('matches every key of the table to its row', () => {
    for (const s of SHORTCUTS) for (const key of s.keys) expect(actionOf(press(key)), key).toBe(s.action);
    expect(actionOf(press(' '))).toBe('select');
    expect(actionOf(press('Esc'))).toBe('escape');
    expect(actionOf(press('='))).toBe('zoomIn');
    expect(keyName(' ')).toBe('Space');
  });

  it('is never a key pressed with Ctrl, Alt or Meta, and nothing else', () => {
    expect(actionOf(press('k', { ctrlKey: true }))).toBeNull();
    expect(actionOf(press('/', { ctrlKey: true }))).toBeNull();
    expect(actionOf(press('ArrowUp', { altKey: true }))).toBeNull();
    expect(actionOf(press('0', { metaKey: true }))).toBeNull();
    for (const key of ['a', 'k', 'Shift', 'PageDown', 'Home', 'F1', '*']) expect(actionOf(press(key)), key).toBeNull();
  });

  it('names the keys in the graph\'s description', () => {
    expect(KEY_HELP).toContain('Arrow keys');
    expect(KEY_HELP).toContain('Question mark');
  });
});

// --- The handlers ----------------------------------------------------------------------------------

const slot: Box = { x: 0, y: 0, width: 200, height: 64 };
const boxes = { full: slot, compact: slot, dot: slot };

function person(id: string, rank: number, x: number): PersonNode {
  return {
    id,
    type: 'person',
    position: { x, y: rank * 120 },
    width: 200,
    height: 64,
    data: {
      name: `Demo ${id}`,
      original: null,
      generation: null,
      status: null,
      disputed: false,
      teachers: 0,
      more: 0,
      rank,
      focus: false,
      root: false,
      slot,
      boxes,
      slug: `demo-${id}`,
      totals: { teachers: 0, students: 0 },
      drawn: { teachers: 0, students: 0 },
      teacherNames: [],
    },
  };
}

const summary: SummaryNode = {
  id: 'more:t',
  type: 'more',
  position: { x: 600, y: 120 },
  width: 200,
  height: 64,
  data: { teacherId: 't', name: 'Demo t', slug: 'demo-t', more: 3, rank: 1, slot, boxes },
};

const line = (teacher: string, student: string): LineageEdge => ({
  id: `${teacher}->${student}`,
  type: 'lineage',
  source: teacher,
  target: student,
  data: { stroke: 'verified', kind: 'primary', lineageId: 'l', routedBy: 'elk', path: { type: 'orthogonal', points: [] }, label: null, historical: false, ends: { teacher: boxes, student: boxes } },
});

function setup(options: { selectedId?: string | null; collapses?: boolean } = {}) {
  // t teaches s; u and v both teach w; r has no teacher.
  const nodes: FlowNode[] = [person('t', 0, 0), person('s', 1, 0), summary, person('u', 0, 1000), person('v', 0, 1300), person('w', 1, 1100), person('r', 0, 2000)];
  const flow: FlowApi = {
    view: () => ({ x: 0, y: 0, zoom: 1 }),
    pane: () => ({ width: 1000, height: 800 }),
    element: () => null,
    drawn: () => nodes.map((n) => n.id),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    fit: vi.fn(),
    center: vi.fn(),
  };
  const context: GraphContext = {
    nodes,
    edges: [line('t', 's'), line('u', 'w'), line('v', 'w')],
    focusId: 's',
    activeId: 's',
    setActive: vi.fn(),
    selectedId: options.selectedId ?? null,
    select: vi.fn(),
    openStudents: vi.fn(),
    say: vi.fn(),
    collapseSheet: vi.fn(() => options.collapses ?? false),
  };
  const deps: KeyDeps = { flow, context, go: vi.fn(), search: vi.fn(), help: vi.fn(), choose: vi.fn() };
  return { flow, context, deps, handlers: keyHandlers(deps) };
}

describe('keyHandlers', () => {
  it('has a handler for every key in the table', () => {
    const { handlers } = setup();
    for (const s of SHORTCUTS) expect(typeof handlers[s.action], s.key).toBe('function');
    expect(Object.keys(handlers).sort()).toEqual(SHORTCUTS.map((s) => s.action).sort());
  });

  it('leaves Tab to the browser', () => {
    expect(setup().handlers.tab('s')).toBe(false);
  });

  it('moves with the arrows, focusing and announcing the person reached', () => {
    const { handlers, context } = setup();
    expect(handlers.up('s')).toBe(true);
    expect(context.setActive).toHaveBeenCalledWith('t', { focus: true, announce: true });
    handlers.down('t');
    expect(context.setActive).toHaveBeenLastCalledWith('s', { focus: true, announce: true });
    handlers.right('s');
    expect(context.setActive).toHaveBeenLastCalledWith('more:t', { focus: true, announce: true });
  });

  it('opens the chooser with two teachers drawn, and says why when there is no move', () => {
    const { handlers, deps, context } = setup();
    handlers.up('w');
    expect(deps.choose).toHaveBeenCalledWith('w', ['u', 'v']);
    handlers.up('r');
    expect(context.say).toHaveBeenCalledWith('No teachers drawn in this view.');
    handlers.left('s');
    expect(context.say).toHaveBeenLastCalledWith('First in this row.');
  });

  it('opens the profile with Enter, and the list of the students on the summary node', () => {
    const { handlers, deps, context } = setup();
    expect(handlers.open('s')).toBe(true);
    expect(deps.go).toHaveBeenCalledWith('/people/demo-s');
    handlers.open('more:t');
    expect(context.openStudents).toHaveBeenCalledWith('t');
  });

  it('selects with Space, and opens the list of the students on the summary node', () => {
    const { handlers, context } = setup();
    expect(handlers.select('s')).toBe(true);
    expect(context.select).toHaveBeenCalledWith('s');
    expect(context.setActive).toHaveBeenCalledWith('s');
    handlers.select('more:t');
    expect(context.openStudents).toHaveBeenCalledWith('t');
    expect(context.select).toHaveBeenCalledTimes(1);
  });

  it('zooms, fits, searches and shows the help', () => {
    const { handlers, flow, deps } = setup();
    expect([handlers.zoomIn('s'), handlers.zoomOut('s'), handlers.fit('s'), handlers.search('s'), handlers.help('s')]).toEqual([true, true, true, true, true]);
    expect(flow.zoomIn).toHaveBeenCalledOnce();
    expect(flow.zoomOut).toHaveBeenCalledOnce();
    expect(flow.fit).toHaveBeenCalledOnce();
    expect(deps.search).toHaveBeenCalledOnce();
    expect(deps.help).toHaveBeenCalledOnce();
  });

  it('lowers a raised sheet with Esc before it clears the selection, and leaves Esc alone with nothing to do', () => {
    const raised = setup({ selectedId: 's', collapses: true });
    expect(raised.handlers.escape('s')).toBe(true);
    expect(raised.context.select).not.toHaveBeenCalled();
    const selected = setup({ selectedId: 's' });
    expect(selected.handlers.escape('s')).toBe(true);
    expect(selected.context.select).toHaveBeenCalledWith(null);
    const idle = setup();
    expect(idle.handlers.escape('s')).toBe(false);
    expect(idle.context.select).not.toHaveBeenCalled();
  });
});
