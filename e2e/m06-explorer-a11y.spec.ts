/**
 * Milestone M06: the explorer's keyboard, screen readers, selection, expansion and touch (Done
 * when 2). Against `next start` with the seeded fictional demo data (D20); nothing here changes
 * data. One describe block per work package (foundation F, keyboard A, selection B, expansion C,
 * touch and motion D), each with its own viewport: every project runs every block, WebKit included.
 */

import { expect, test } from '@playwright/test';

import { closeHelpers, loadTestEnv } from './helpers/auth';
import { EXPLORER_VIEWS, nodeOf, openExplorer } from './helpers/explorer';
import { activeNodeId, dragNodeOffScreen, focusedNodeId, focusGraph, focusInGraph, tabStops } from './helpers/explorer-a11y';
import { settledView } from './helpers/explorer-checks';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.describe('foundation', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test('@M06 exactly one element inside .react-flow has tabindex="0"', async ({ page }) => {
    test.setTimeout(240_000);
    // Desktop, a phone, and a short phone (the iPhone's page in CI's mobile-webkit).
    for (const size of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 393, height: 659 },
    ]) {
      for (const view of EXPLORER_VIEWS) {
        const where = `${view.name} at ${size.width}x${size.height}`;
        await page.setViewportSize(size);
        await openExplorer(page, await view.params());
        await settledView(page);
        await expect.poll(() => tabStops(page), `${where}: after load`).toBe(1);

        // A move of the view: the tab stop stays on a drawn node.
        await page.getByRole('button', { name: 'Fit the whole view' }).click();
        await settledView(page);
        await expect.poll(() => tabStops(page), `${where}: after Fit`).toBe(1);

        await focusGraph(page);
        for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
        await settledView(page);
        await expect.poll(() => tabStops(page), `${where}: after ArrowRight x3`).toBe(1);
        // The buttons inside nodes are in the Tab order only on the active node.
        const active = await activeNodeId(page);
        expect(active, where).not.toBeNull();
        const strayButtons = await page.evaluate(
          () => [...document.querySelectorAll<HTMLElement>('.react-flow__node:not([tabindex="0"]) :is(button, a[href], [tabindex])')].filter((el) => el.tabIndex !== -1).length,
        );
        expect(strayButtons, `${where}: in-node controls outside the active node`).toBe(0);

        // The focus-loss guard: a drag takes the focused node off screen (React Flow unmounts it),
        // and the focus moves to a drawn node instead of falling to the page.
        const focused = await focusedNodeId(page);
        expect(focused, `${where}: the focus is on a node`).not.toBeNull();
        await dragNodeOffScreen(page, focused!);
        await expect(nodeOf(page, focused!)).toHaveCount(0);
        await expect.poll(() => focusInGraph(page), `${where}: the focus stays in the graph`).toBe(true);
        await expect.poll(() => focusedNodeId(page), `${where}: on a drawn node`).not.toBeNull();
        await settledView(page);
        await expect.poll(() => tabStops(page), `${where}: after the drag`).toBe(1);
        expect(await activeNodeId(page), `${where}: the tab stop is the focused node`).toBe(await focusedNodeId(page));
      }
    }
  });
});

test.describe('keyboard (A)', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
  // Package A: tests 1, 3, 9 and 11 (and the ArrowDown INP extra).
});

test.describe('selection (B)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // Package B: tests 4 and 7 (and the phone selection INP extra, the Back and history checks).
});

test.describe('expansion (C)', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
  // Package C: tests 5 and 6.
});

test.describe('touch and motion (D)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // Package D: tests 8, 10 and 12.
});
