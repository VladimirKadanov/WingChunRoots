// Keyboard and screen-reader steps for the M06 tests (milestone M06): the graph's one tab stop
// (roving tabindex), Tab into the graph, the live region, the visible area of the canvas pane
// (src/components/lineage/explorer/viewport.ts), and the part of an element its clipping
// ancestors leave visible (a phone's bottom sheet, clipped at the tab bar).

import { expect, type Locator, type Page } from '@playwright/test';

import { inVisibleArea } from '../../src/components/lineage/explorer/viewport';

export interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The id of the graph's one tab stop (the active node, tabindex="0"), or null. */
export function activeNodeId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector<HTMLElement>('.react-flow .react-flow__node[tabindex="0"]')?.dataset.id ?? null);
}

/** The id of the node the keyboard focus is in, or null. */
export function focusedNodeId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.closest<HTMLElement>('.react-flow__node')?.dataset.id ?? null);
}

/** Whether the keyboard focus is inside the graph (React Flow's element). */
export function focusInGraph(page: Page): Promise<boolean> {
  return page.evaluate(() => !!document.activeElement?.closest('.react-flow'));
}

/** How many elements inside .react-flow have tabindex="0" (the roving tab stop: always exactly one). */
export function tabStops(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('.react-flow [tabindex="0"]').length);
}

/**
 * Tabs from the "Graph" button of "Show as" until the focus is in the graph, in a bounded loop:
 * WebKit's Tab may skip links and buttons (Safari's default) but always reaches a tabindex element,
 * so no test counts the presses. Returns the id of the node that has the focus.
 */
export async function focusGraph(page: Page, limit = 40): Promise<string> {
  await page.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'Graph' }).focus();
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const id = await focusedNodeId(page);
    if (id !== null) return id;
  }
  throw new Error(`Tab did not reach the graph in ${limit} presses.`);
}

/** The words of the explorer's live region (aria-live="polite"), trimmed. */
export async function announcement(page: Page): Promise<string> {
  return ((await page.getByTestId('explorer-announcement').textContent()) ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Whether a node lies wholly in the canvas pane's visible area: inside the pane's 12 px gap from
 * every edge and under none of the overlays (legend, buttons) and covers (panel, sheet), as the
 * explorer's ensureVisible places it (viewport.ts inVisibleArea).
 */
export async function isInVisibleArea(page: Page, id: string): Promise<boolean> {
  const measured = await page.evaluate((nodeId) => {
    const pane = document.querySelector('.react-flow');
    const node = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
    if (!pane || !node) return null;
    const origin = pane.getBoundingClientRect();
    const local = (r: DOMRect) => ({ x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height });
    const frame = pane.closest('[data-canvas-frame]') ?? pane;
    const overlays = [...frame.querySelectorAll('[data-canvas-overlay]'), ...document.querySelectorAll('[data-canvas-cover]')].map((el) => local(el.getBoundingClientRect()));
    return { box: local(node.getBoundingClientRect()), pane: { width: origin.width, height: origin.height, overlays } };
  }, id);
  return measured !== null && inVisibleArea(measured.box, measured.pane);
}

/**
 * The part of an element on screen: its box cut by every ancestor that clips its overflow (the
 * Drawer's viewport clips a non-modal sheet at the tab bar) and by the window; null when none of it is.
 */
export function visibleBox(locator: Locator): Promise<ScreenBox | null> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    let left = r.left;
    let top = r.top;
    let right = r.right;
    let bottom = r.bottom;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const style = getComputedStyle(a);
      if (!/(hidden|clip|auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
      const c = a.getBoundingClientRect();
      left = Math.max(left, c.left);
      top = Math.max(top, c.top);
      right = Math.min(right, c.right);
      bottom = Math.min(bottom, c.bottom);
    }
    left = Math.max(left, 0);
    top = Math.max(top, 0);
    right = Math.min(right, window.innerWidth);
    bottom = Math.min(bottom, window.innerHeight);
    return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
  });
}

/**
 * Drags the pane with the mouse, a stroke at a time, until the node `id` is no longer drawn
 * (onlyRenderVisibleElements unmounts it): each stroke starts on the bare pane (not on a node or
 * a control over the canvas) and moves the view in the direction that takes the node off soonest.
 */
export async function dragNodeOffScreen(page: Page, id: string, strokes = 8): Promise<void> {
  const node = page.locator(`.react-flow__node[data-id="${id}"]`);
  for (let i = 0; i < strokes && (await node.count()) > 0; i++) {
    const plan = await page.evaluate((nodeId) => {
      const flow = document.querySelector('.react-flow')!;
      const pane = flow.getBoundingClientRect();
      const box = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`)?.getBoundingClientRect();
      if (!box) return null;
      // How far the view must move to take the node off each side of the pane.
      const ways = [
        { dx: -(box.right - pane.left), dy: 0 },
        { dx: pane.right - box.left, dy: 0 },
        { dx: 0, dy: -(box.bottom - pane.top) },
        { dx: 0, dy: pane.bottom - box.top },
      ].sort((a, b) => Math.abs(a.dx + a.dy) - Math.abs(b.dx + b.dy));
      const bare = (x: number, y: number) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && flow.contains(hit) && !hit.closest('.react-flow__node, .react-flow__attribution, [data-canvas-overlay], a, button');
      };
      for (const way of ways) {
        // The bare point that lets this stroke travel furthest, its end 8 px inside the pane.
        let best: { x: number; y: number; reach: number } | null = null;
        for (let gx = 0.05; gx <= 0.95; gx += 0.05) {
          for (let gy = 0.05; gy <= 0.95; gy += 0.05) {
            const x = pane.left + gx * pane.width;
            const y = pane.top + gy * pane.height;
            if (!bare(x, y)) continue;
            const reach =
              way.dx < 0 ? x - pane.left - 8 : way.dx > 0 ? pane.right - 8 - x : way.dy < 0 ? y - pane.top - 8 : pane.bottom - 8 - y;
            if (!best || reach > best.reach) best = { x, y, reach };
          }
        }
        if (best && best.reach > 40) {
          const step = Math.min(best.reach, Math.abs(way.dx + way.dy) + 24);
          return { from: { x: best.x, y: best.y }, to: { x: best.x + Math.sign(way.dx) * step, y: best.y + Math.sign(way.dy) * step } };
        }
      }
      return null;
    }, id);
    if (!plan) break;
    await page.mouse.move(plan.from.x, plan.from.y);
    await page.mouse.down();
    await page.mouse.move(plan.to.x, plan.to.y, { steps: 12 });
    await page.mouse.up();
  }
  await expect(node, 'the drag took the node off screen').toHaveCount(0);
}
