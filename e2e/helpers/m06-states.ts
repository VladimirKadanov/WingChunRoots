// The M06 screen states of the explorer (milestone M06, In scope 8): the selection with its routes
// in the panel or the phone's bottom sheet, an expansion with the summary node "and N more", the
// summary node's list of students, the shortcut help and the keyboard's focus ring. Shared by the
// screenshots (e2e/screenshots.spec.ts, all five) and the visual regression (e2e/visual.spec.ts,
// the selection and the expansion). Fictional demo data only (D20); every state ends with the
// view at rest (settledView) and its words drawn.

import { expect, type Page } from '@playwright/test';

import { lineageIdOf, nodeOf, openExplorer, personIdOf } from './explorer';
import { focusGraph } from './explorer-a11y';
import { settledView } from './explorer-checks';
import { summaryNodeOf, walkToSummary } from './m06-expand';
import { dragSheetToHalf } from './m06-touch';

export interface ExplorerState {
  name: string;
  /** Brings the page to the state; returns when it is on screen and at rest. */
  reach: (page: Page) => Promise<void>;
}

/** Whether the page is a phone's (a touch screen and no fine pointer): the panel is a bottom sheet there. */
const onPhone = (page: Page) => page.evaluate(() => matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches);

/** A tap on a phone, a click elsewhere. */
async function press(page: Page, target: ReturnType<typeof nodeOf>): Promise<void> {
  if (await onPhone(page)) await target.tap();
  else await target.click();
}

/** The hub's "+N students" pressed from the keyboard, then key moves to the summary node, which is in view at a readable zoom. */
async function expandHub(page: Page, hub: string): Promise<void> {
  await openExplorer(page, { focus: hub, up: 1, down: 0 });
  await settledView(page);
  expect(await focusGraph(page)).toBe(hub);
  await nodeOf(page, hub).locator('[data-more-chip]').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('explorer-announcement')).toContainText('Added', { timeout: 15_000 });
  await walkToSummary(page, hub);
  await expect(summaryNodeOf(page, hub)).toBeInViewport();
}

export const EXPLORER_STATES: readonly ExplorerState[] = [
  {
    // A selection: demo-two-lineages' routes of descent lit, the rest dimmed, and the panel with
    // the routes (on a phone the bottom sheet, raised to its middle snap point).
    name: 'explore-selection',
    async reach(page) {
      const id = await personIdOf('demo-two-lineages');
      await openExplorer(page, { focus: id });
      await settledView(page);
      await press(page, nodeOf(page, id));
      const panel = page.getByTestId('explorer-panel');
      await expect(panel).toBeVisible();
      if (await onPhone(page)) await dragSheetToHalf(page, panel.locator('xpath=ancestor-or-self::*[@role="dialog"][1]'));
      await expect(panel.getByRole('list', { name: /^Route 1 of \d+: / })).toBeVisible();
      await settledView(page);
    },
  },
  {
    // An expansion: demo-hub-a's students drawn in place, and the keyboard along their row to the
    // summary node "and N more" (with its focus ring).
    name: 'explore-expanded',
    async reach(page) {
      await expandHub(page, await personIdOf('demo-hub-a'));
    },
  },
  {
    // The summary node's list of the teacher's students, 20 to a page (on a phone the sheet, raised
    // to its middle snap point above the summary node).
    name: 'explore-more-list',
    async reach(page) {
      const hub = await personIdOf('demo-hub-a');
      await openExplorer(page, { focus: hub });
      await settledView(page);
      expect(await focusGraph(page)).toBe(hub);
      await walkToSummary(page, hub);
      await page.keyboard.press('Enter');
      const panel = page.getByTestId('explorer-panel');
      await expect(panel.getByRole('navigation', { name: 'Pages of students' })).toBeAttached();
      if (await onPhone(page)) await dragSheetToHalf(page, panel.locator('xpath=ancestor-or-self::*[@role="dialog"][1]'));
      await expect(panel.getByRole('list', { name: /^Students of .+, page 1$/ })).toBeVisible();
      await settledView(page);
    },
  },
  {
    // The shortcut help ("?" in the graph).
    name: 'explore-shortcuts',
    async reach(page) {
      await openExplorer(page, { focus: await personIdOf('demo-two-lineages') });
      await settledView(page);
      await focusGraph(page);
      await page.keyboard.press('?');
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    },
  },
  {
    // The keyboard's focus ring on a node after key moves (the Lineage view of Demo Lineage A, down and along a row).
    name: 'explore-keyboard',
    async reach(page) {
      await openExplorer(page, { focus: await personIdOf('demo-root-a'), lineage: await lineageIdOf('demo-lineage-a') });
      await settledView(page);
      await focusGraph(page);
      await page.keyboard.press('ArrowDown');
      await settledView(page);
      await page.keyboard.press('ArrowRight');
      await settledView(page);
      await expect(page.locator('.react-flow__node:focus-visible')).toHaveCount(1);
    },
  },
];
