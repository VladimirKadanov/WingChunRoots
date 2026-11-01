/**
 * Milestone M06: the explorer's keyboard, screen readers, selection, expansion and touch (Done
 * when 2). Against `next start` with the seeded fictional demo data (D20); nothing here changes
 * data. One describe block per work package (foundation F, keyboard A, selection B, expansion C,
 * touch and motion D), each with its own viewport: every project runs every block, WebKit included.
 */

import { expect, test } from '@playwright/test';

import { SHORTCUTS } from '../src/components/lineage/explorer/shortcuts';
import { MAX_ROUTES } from '../src/components/lineage/explorer/route-list';
import { FANOUT_SHOWN, summaryIdOf } from '../src/components/lineage/explorer/state';
import { closeHelpers, loadTestEnv } from './helpers/auth';
import { edgesInto, EXPLORER_VIEWS, lineageIdOf, nodeOf, openExplorer, personIdOf } from './helpers/explorer';
import {
  activeNodeId,
  announcement,
  dragEveryNodeOffScreen,
  dragNodeOffScreen,
  focusedNodeId,
  focusGraph,
  focusInGraph,
  focusTrail,
  graphIsTabStop,
  isInVisibleArea,
  tabStops,
  visibleBox,
  watchFocus,
} from './helpers/explorer-a11y';
import { captureScenes, installInpProbes, personNameOf, selectionInp, settledView, uncoveredNode } from './helpers/explorer-checks';
import { drawnStudents, listedStudents, publicStudentCount, scenesFor, screenBox, studentNamesOfPage, summaryNodeOf, walkToSummary } from './helpers/m06-expand';
import { drawnNodeIds, installKeyProbe, keyInp, personNameById, soleTeacherStudent, statusInPersonView, viewTransform } from './helpers/m06-keys';
import { drawnEdges, litIds, recordPaths, routesUp, searchOf, tappableAtCentre } from './helpers/m06-panel';
import { cardsUnderOverlays, controlProblems, dragSheetToHalf, isSheet, PHONES, settledTop, startMotion, stopMotion, wholeAndUncovered } from './helpers/m06-touch';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

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

  test('@M06 a drag that takes every node off screen keeps the focus on the graph, and an arrow key brings the active node back', async ({ page }) => {
    test.setTimeout(180_000);
    for (const size of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const where = `${size.width}x${size.height}`;
      await page.setViewportSize(size);
      await openExplorer(page, { focus: await personIdOf('demo-two-lineages') });
      await settledView(page);
      await focusGraph(page);

      // The focus-loss guard with no node left to take the focus: the graph itself holds it, never the page.
      await dragEveryNodeOffScreen(page);
      await expect.poll(() => focusInGraph(page), `${where}: the focus stays in the graph`).toBe(true);
      expect(await page.evaluate(() => document.activeElement?.classList.contains('react-flow') ?? false), `${where}: on the graph itself`).toBe(true);
      expect(await focusedNodeId(page), `${where}: on no node`).toBeNull();
      // No node is drawn to be the tab stop: the graph itself is the one stop (plan §4.9).
      expect(await tabStops(page), `${where}: no node drawn, still one tab stop`).toBe(1);
      expect(await graphIsTabStop(page), `${where}: the stop is the graph itself`).toBe(true);

      // The next arrow key brings the active node back into view and gives it the focus.
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => focusedNodeId(page), `${where}: a node has the focus again`).not.toBeNull();
      await settledView(page);
      const back = (await focusedNodeId(page))!;
      expect(await activeNodeId(page), `${where}: it is the tab stop`).toBe(back);
      expect(await isInVisibleArea(page, back), `${where}: it lies wholly in the visible area`).toBe(true);
      await expect.poll(() => tabStops(page), `${where}: one tab stop`).toBe(1);
      expect(await page.evaluate(() => document.querySelector('.react-flow')?.hasAttribute('tabindex') ?? true), `${where}: the graph is no stop of its own`).toBe(false);

      // A pointer user drags every node off screen with the focus outside the graph (requirements-4):
      // the graph itself is its one stop, Tab from the toolbar reaches it, and an arrow key brings
      // the active node back.
      const graphButton = page.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'Graph' });
      await graphButton.focus();
      await dragEveryNodeOffScreen(page);
      expect(await focusInGraph(page), `${where}: the focus is outside the graph`).toBe(false);
      await expect.poll(() => tabStops(page), `${where}: one tab stop after the pointer drag`).toBe(1);
      expect(await graphIsTabStop(page), `${where}: the stop is the graph itself`).toBe(true);
      // The graph's element is a named application (React Flow's role): no axe violation as a tab stop.
      if (size.width === 1440) await expectNoAxeViolations(page, `/explore with the graph itself as its tab stop, ${where}`);
      await graphButton.focus();
      let reached = false;
      for (let i = 0; i < 40 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await focusInGraph(page);
      }
      expect(reached, `${where}: Tab reaches the graph`).toBe(true);
      expect(await page.evaluate(() => document.activeElement?.classList.contains('react-flow') ?? false), `${where}: Tab reaches the graph itself`).toBe(true);
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => focusedNodeId(page), `${where}: the arrow gives a node the focus`).not.toBeNull();
      await settledView(page);
      const again = (await focusedNodeId(page))!;
      expect(await activeNodeId(page), `${where}: it is the tab stop`).toBe(again);
      expect(await isInVisibleArea(page, again), `${where}: it lies wholly in the visible area`).toBe(true);
      await expect.poll(() => tabStops(page), `${where}: one tab stop, on the node`).toBe(1);
      expect(await graphIsTabStop(page), `${where}: the graph is no stop of its own`).toBe(false);
    }
  });
});

test.describe('keyboard (A)', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
  // Package A: tests 1, 3, 9 and 11 (and the ArrowDown INP extra).

  test('@M06 keyboard only: Tab into the graph, ArrowUp moves to a teacher, the announcement includes name and status, Enter opens the profile', async ({ page }) => {
    // The person view of a student of demo-hub-a whose one teacher is demo-hub-a (from the public API).
    const hub = await personIdOf('demo-hub-a');
    const student = await soleTeacherStudent(page, hub);
    await openExplorer(page, { focus: student });
    await settledView(page);

    // Tab from the toolbar: the graph's one tab stop is the person in focus.
    expect(await focusGraph(page), 'Tab reaches the person in focus').toBe(student);

    await page.keyboard.press('ArrowUp');
    await expect.poll(() => focusedNodeId(page), 'ArrowUp moves the focus to the teacher').toBe(hub);
    expect(await activeNodeId(page), 'the tab stop moved with it').toBe(hub);

    // The live region names the teacher and their status in this view (a line drawn into them, not a root).
    const name = await personNameOf('demo-hub-a');
    const status = await statusInPersonView(page, student, hub);
    expect(status, 'demo-hub-a has a status edge in this view').not.toBeNull();
    await expect.poll(() => announcement(page), 'the announcement names the teacher').toContain(`${name}. ${status}.`);

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/people\/demo-hub-a$/);
  });

  test('@M06 ArrowDown reaches a student node that started off-screen', async ({ page }) => {
    // The Lineage view of Demo Lineage A: over a hundred people, most of them off screen at first.
    await openExplorer(page, { focus: await personIdOf('demo-root-a'), lineage: await lineageIdOf('demo-lineage-a') });
    await settledView(page);
    const initial = new Set(await drawnNodeIds(page));
    let active: string | null = await focusGraph(page);
    let reached: string | null = null;
    for (let press = 0; press < 30 && reached === null; press++) {
      const before: string | null = active;
      await page.keyboard.press('ArrowDown');
      await settledView(page);
      active = await activeNodeId(page);
      // A person with no student drawn: on along the row, then down again.
      if (active === before) {
        await page.keyboard.press('ArrowRight');
        await settledView(page);
        active = await activeNodeId(page);
      }
      if (active !== null && !initial.has(active)) reached = active;
    }
    expect(reached, 'the keys reached a person who was not drawn at first').not.toBeNull();
    await expect.poll(() => focusedNodeId(page), 'it has the focus').toBe(reached);
    await expect(nodeOf(page, reached!), 'it is drawn').toHaveCount(1);
    expect(await isInVisibleArea(page, reached!), 'it lies wholly in the visible area').toBe(true);
    await expect.poll(() => tabStops(page)).toBe(1);
  });

  test('@M06 single-key shortcuts do nothing when focus is outside the graph', async ({ page }) => {
    await openExplorer(page, { focus: await personIdOf('demo-two-lineages') });
    await settledView(page);
    const view = await viewTransform(page);
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    const palette = page.getByTestId('search-palette');
    const nothingHappened = async (where: string) => {
      // A zoom key would move the view for 200 ms: give it the time, then look.
      await page.waitForTimeout(500);
      await expect(page.getByRole('dialog'), `${where}: no dialog`).toHaveCount(0);
      await expect(palette, `${where}: no palette`).toHaveCount(0);
      await expect(page.locator('.react-flow__node.selected'), `${where}: nothing selected`).toHaveCount(0);
      expect(await viewTransform(page), `${where}: the view did not move`).toBe(view);
    };

    // The pressed "Graph" segment of "Show as" (Space and Enter would press it, as any button's).
    await page.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'Graph' }).focus();
    for (const key of ['/', '?', '+', '-', '0']) await page.keyboard.press(key);
    await nothingHappened('on the Graph button');

    // The page itself.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(await page.evaluate(() => document.activeElement === document.body), 'the focus is on <body>').toBe(true);
    for (const key of ['/', '?', '+', '-', '0', 'Space', 'ArrowUp']) await page.keyboard.press(key);
    await nothingHappened('on the page');

    // In the graph the same keys work, and the focus comes back to the node.
    const node = await focusGraph(page);
    await page.keyboard.press('?');
    await expect(help, '"?" in the graph opens the help').toBeVisible();
    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
    await expect.poll(() => focusedNodeId(page), 'Esc returns the focus to the node').toBe(node);

    await page.keyboard.press('/');
    await expect(palette, '"/" in the graph opens the search palette').toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect.poll(() => focusedNodeId(page), 'Esc returns the focus to the node').toBe(node);
  });

  test('@M06 "?" opens the shortcut help dialog listing every key', async ({ page }) => {
    await openExplorer(page, { focus: await personIdOf('demo-two-lineages') });
    await settledView(page);
    const node = await focusGraph(page);
    await page.keyboard.press('?');
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(help).toBeVisible();
    const rows = help.getByRole('row').filter({ has: page.getByRole('rowheader') });
    const keys = (await rows.getByRole('rowheader').allInnerTexts()).map((k) => k.trim());
    expect(keys, 'the milestone\'s keys, in order').toEqual(['Tab', '↑', '↓', '←', '→', 'Enter', 'Space', '+', '−', '0', '/', '?', 'Esc']);
    expect(keys, 'the key table').toEqual(SHORTCUTS.map((s) => s.key));
    expect((await rows.getByRole('cell').allInnerTexts()).map((t) => t.trim()), 'what each key does').toEqual(SHORTCUTS.map((s) => s.label));
    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
    await expect.poll(() => focusedNodeId(page), 'Esc returns the focus to the node').toBe(node);

    // The "Keyboard shortcuts" button over the canvas opens the same help where there is a fine pointer.
    const button = page.getByRole('button', { name: 'Keyboard shortcuts' });
    const fine = await page.evaluate(() => matchMedia('(any-pointer: fine)').matches);
    await expect(button, 'the button is shown exactly with a fine pointer').toBeVisible({ visible: fine });
    if (fine) {
      await button.click();
      await expect(help).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(help).toHaveCount(0);
      await expect(button, 'Esc returns the focus to the button').toBeFocused();
    }
  });

  test('@M06 ArrowUp with two teachers drawn opens the teacher chooser: Esc returns to the person, Enter moves to the teacher', async ({ page }) => {
    const id = await personIdOf('demo-two-lineages');
    await openExplorer(page, { focus: id });
    await settledView(page);
    const lines = await edgesInto(page, id).evaluateAll((paths) => paths.map((p) => ({ teacher: p.getAttribute('data-teacher')!, kind: p.getAttribute('data-kind')! })));
    const teachers = [...new Set(lines.map((l) => l.teacher))];
    expect(teachers.length, 'two or more teachers drawn').toBeGreaterThanOrEqual(2);
    expect(await focusGraph(page)).toBe(id);

    await page.keyboard.press('ArrowUp');
    const chooser = page.getByRole('menu', { name: `Teachers of ${await personNameOf('demo-two-lineages')}` });
    await expect(chooser).toBeVisible();
    const items = chooser.getByRole('menuitem');
    // Every teacher drawn, each once (the order: the display-primary teacher first, checked below).
    await expect(items).toHaveCount(teachers.length);
    const names = await Promise.all(teachers.map((t) => personNameById(t)));
    const idByName = new Map(teachers.map((t, i) => [names[i]!, t]));
    expect((await items.allInnerTexts()).map((t) => t.trim()).sort()).toEqual(names.sort());
    const primary = lines.find((l) => l.kind === 'primary');
    expect(primary, 'a primary line into the person').toBeDefined();
    await expect(items.first(), 'the display-primary teacher first (DEFAULT D05)').toHaveText(await personNameById(primary!.teacher));
    await expect(items.first(), 'the first teacher has the focus').toBeFocused();

    await page.keyboard.press('Escape');
    await expect(chooser).toHaveCount(0);
    await expect.poll(() => focusedNodeId(page), 'Esc returns the focus to the person').toBe(id);

    await page.keyboard.press('ArrowUp');
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    const chosen = (await items.nth(1).innerText()).trim();
    const chosenId = idByName.get(chosen);
    expect(chosenId, 'the teacher chosen is one of those drawn').toBeDefined();
    await watchFocus(page);
    await page.keyboard.press('Enter');
    await expect(chooser).toHaveCount(0);
    // Straight from the menu to the teacher, never to the page in between: there a screen reader
    // loses its place, and a read of the focus finds no node (M10b CI: a poll took "no node" for
    // "not the person" and passed, and the next read found no teacher).
    await expect.poll(() => focusedNodeId(page), 'Enter moves the focus to the teacher chosen').toBe(chosenId);
    expect(await focusTrail(page), 'the focus never falls to the page between the menu and the teacher').not.toContain('body');
    await expect.poll(() => focusedNodeId(page), 'Enter moves the focus to the teacher chosen').not.toBe(id);
    const teacher = (await focusedNodeId(page))!;
    expect(teachers).toContain(teacher);
    expect(await personNameById(teacher)).toBe(chosen);
    expect(await activeNodeId(page), 'the tab stop moved with it').toBe(teacher);
    await expect.poll(() => announcement(page), 'the announcement names the teacher').toContain(`${chosen}.`);
  });

  test('@M06 ArrowDown responds with INP under 200 ms at 4x CPU throttling', async ({ page, browserName }) => {
    // Plan §5.8 (c), as the M05 selection INP: web-vitals' onINP where it is installed, else the Event
    // Timing entries, else (WebKit) the key-press frame measure. A large view (plan §4.8: a key move
    // must not cost more as the view grows): the Lineage view of Demo Lineage A, down from its root.
    await installInpProbes(page);
    await installKeyProbe(page);
    await openExplorer(page, { focus: await personIdOf('demo-root-a'), lineage: await lineageIdOf('demo-lineage-a') });
    await settledView(page);
    await focusGraph(page);
    const result = await keyInp(page, browserName, 'ArrowDown', 3, () => settledView(page));
    test.info().annotations.push({
      type: `INP (ms, worst of 3 ArrowDown presses, 4x CPU, Lineage view of Demo Lineage A, ${result.method})`,
      description: `${result.inp} (Event Timing ${result.eventTiming ?? 'none'}, frame measure ${Math.round(result.frame)})`,
    });
    expect(await focusInGraph(page), 'the focus stayed in the graph').toBe(true);
    expect(result.inp).toBeLessThan(200);
  });

  test('@M06 a selection and a key move renew the focus guard of no node that stays drawn', async ({ page }) => {
    // Plan §4.8: a selection must not cost more as the view grows. A node's focus guard (canvas.tsx
    // useFocusGuard) asks .react-flow__node for its slot only in its cleanup, which runs when the node
    // leaves the DOM, or on every drawn node when the guard function changes on a render (review
    // finding perf-3). Every node root that asked must be gone from the DOM by the end. The key
    // handlers ask from the focused node itself (keys.tsx, focusedId), which is not a guard.
    const hub = await personIdOf('demo-hub-a');
    await openExplorer(page, { focus: hub });
    await settledView(page);
    expect(await focusGraph(page), 'Tab reaches the person in focus').toBe(hub);
    await page.evaluate(() => {
      const w = window as unknown as { __guards: Element[] };
      w.__guards = [];
      const original = Element.prototype.closest;
      Element.prototype.closest = function (this: Element, selectors: string) {
        if (selectors === '.react-flow__node' && this.matches('[data-person-node], [data-summary-node]')) w.__guards.push(this);
        return original.call(this, selectors);
      } as typeof original;
    });

    await page.keyboard.press('Space');
    await expect(page.getByTestId('explorer-panel'), 'Space opens the panel').toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => focusedNodeId(page), 'ArrowDown moves to a student').not.toBe(hub);
    await settledView(page);

    const renewed = await page.evaluate(() => (window as unknown as { __guards: Element[] }).__guards.filter((element) => element.isConnected).length);
    expect(renewed, 'focus guards renewed on nodes that stayed drawn').toBe(0);
  });
});

test.describe('selection (B)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // Package B: tests 4 and 7 (and the phone selection INP extra, the Back and history checks).

  test('@M06 Space on demo-two-lineages highlights both routes of descent and the panel lists them', async ({ page }) => {
    const id = await personIdOf('demo-two-lineages');
    await openExplorer(page, { focus: id });
    await settledView(page);
    // The whole view on the pane: React Flow draws only the edges on it (onlyRenderVisibleElements).
    const fit = page.getByRole('button', { name: 'Fit the whole view' });
    await fit.click();
    await settledView(page);
    const drawn = await drawnEdges(page);

    // The routes of descent of the view, read from its drawing: up the drawn edges to the person.
    const routes = routesUp(drawn, id);
    const teachers = new Set(drawn.filter((e) => e.student === id).map((e) => e.teacher));
    expect(teachers.size, 'teachers drawn').toBeGreaterThanOrEqual(2);
    expect(routes.length, 'routes of descent in the view').toBeGreaterThanOrEqual(2);
    expect(new Set(routes.map((r) => r.people.at(-2))), 'a route through each teacher').toEqual(teachers);
    // Each is the lower part of a route of descent of the record (M04's lineage.paths answer).
    const record = await recordPaths(page, id);
    for (const route of routes) {
      const found = record.paths.some((p) => p.edgeIds.length >= route.edges.length && p.edgeIds.slice(p.edgeIds.length - route.edges.length).join() === route.edges.join());
      expect(found, `the route ${route.people.join(' > ')} is part of a route of the record`).toBe(true);
    }

    // Space on the person: their routes light up, and nothing else does.
    expect(await focusGraph(page), 'Tab reaches the person in focus').toBe(id);
    await page.keyboard.press('Space');
    const panel = page.getByTestId('explorer-panel');
    await expect(panel).toBeVisible();
    await expect(nodeOf(page, id)).toHaveClass(/\bselected\b/);
    // A screen reader hears the selection, and the node's name carries it (plan §4.9, WCAG 4.1.2).
    const name = await personNameOf('demo-two-lineages');
    await expect.poll(() => announcement(page), 'the selection is announced').toBe(`${name} selected. Routes of descent and details are in the sheet below.`);
    await expect(nodeOf(page, id)).toHaveAttribute('aria-label', new RegExp(`^${name}, .+, selected$`));
    await expect(page.locator('[data-canvas-frame][data-highlighting]')).toHaveCount(1);
    // The sheet takes its room from the canvas: fit the view again, so that every edge is drawn.
    await fit.click();
    await settledView(page);
    expect(await drawnEdges(page), 'the edges drawn').toEqual(drawn);
    await expect
      .poll(() => litIds(page), 'lit: the people and edges of the routes, no others')
      .toEqual({ nodes: [...new Set(routes.flatMap((r) => r.people))].sort(), edges: [...new Set(routes.flatMap((r) => r.edges))].sort() });

    // The panel lists them: one list per route, headed "Route k of N", the names root first.
    await panel.getByRole('button', { name: 'Expand' }).click();
    await expect(panel.getByRole('button', { name: 'Collapse' })).toBeVisible();
    const lists = panel.getByRole('list', { name: /^Route \d+ of \d+: / });
    const shown = Math.min(routes.length, MAX_ROUTES);
    await expect(lists).toHaveCount(shown);
    const names = new Map<string, string>();
    for (const person of new Set(routes.flatMap((r) => r.people))) names.set(person, await personNameById(person));
    const expected = routes.map((r) => r.people.map((p) => names.get(p)!).join(' > '));
    const listed: string[] = [];
    for (let k = 0; k < shown; k++) {
      await expect(lists.nth(k)).toHaveAccessibleName(new RegExp(`^Route ${k + 1} of ${routes.length}: `));
      listed.push((await lists.nth(k).getByRole('listitem').allTextContents()).map((t) => t.trim()).join(' > '));
    }
    expect(new Set(listed).size, 'no route listed twice').toBe(shown);
    for (const route of listed) expect(expected, 'a listed route is a route of the view').toContain(route);
    if (routes.length > MAX_ROUTES) await expect(panel.getByRole('link', { name: `${routes.length - MAX_ROUTES} more routes in the list view` })).toBeVisible();
  });

  test('@M06 at 390x844 a tap opens the bottom sheet with Open profile; zoom and fit buttons work', async ({ page }) => {
    const id = await personIdOf('demo-two-lineages');
    await openExplorer(page, { focus: id });
    await settledView(page);
    await nodeOf(page, id).tap();
    const panel = page.getByTestId('explorer-panel');
    await expect(panel).toBeVisible();
    await expect(nodeOf(page, id)).toHaveClass(/\bselected\b/);
    await settledView(page);

    // The sheet at its peek lies below the graph and above the tab bar: it covers nothing of the canvas.
    const canvas = (await page.locator('.react-flow').boundingBox())!;
    const bar = (await page.locator('[data-tab-bar]').boundingBox())!;
    const sheet = await visibleBox(panel);
    expect(sheet, 'the sheet is on screen').not.toBeNull();
    expect(sheet!.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1);
    expect(sheet!.y + sheet!.height).toBeLessThanOrEqual(bar.y + 1);

    // "Open profile" is in the peek: a full touch target that a tap reaches.
    const profile = panel.getByRole('link', { name: 'Open profile' });
    await expect(profile).toBeVisible();
    expect((await profile.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await tappableAtCentre(profile), 'a tap on Open profile reaches it').toBe(true);

    // With the sheet open, Zoom in zooms in and "Fit the whole view" brings the fitted view back.
    const fit = page.getByRole('button', { name: 'Fit the whole view' });
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    expect(await tappableAtCentre(fit), 'a tap on Fit reaches it').toBe(true);
    expect(await tappableAtCentre(zoomIn), 'a tap on Zoom in reaches it').toBe(true);
    await fit.tap();
    const fitted = await settledView(page);
    await zoomIn.tap();
    const zoomed = await settledView(page);
    expect(zoomed.zoom, 'Zoom in').toBeGreaterThan(fitted.zoom);
    await fit.tap();
    const again = await settledView(page);
    expect(again.zoom, 'Fit after Zoom in').toBeCloseTo(fitted.zoom, 3);
    expect(Math.abs(again.x - fitted.x), 'Fit after Zoom in: x').toBeLessThanOrEqual(1);
    expect(Math.abs(again.y - fitted.y), 'Fit after Zoom in: y').toBeLessThanOrEqual(1);
    await expect(nodeOf(page, id), 'the selection is kept').toHaveClass(/\bselected\b/);
    await expect(panel).toBeVisible();

    // A tap on "Open profile" opens the person's profile.
    await profile.tap();
    await expect(page).toHaveURL(/\/people\/demo-two-lineages$/);
  });

  test('@M06 on a short phone "Fit the whole view" with the sheet at its peek draws nobody under the legend or the zoom buttons', async ({ page }) => {
    // screens-6: at the peek of a 393x659 phone's sheet the canvas is about 215 px tall, the legend
    // wraps to two lines and the buttons stand in two rows; React Flow's own fit drew the selected
    // person's students under the legend. The button's fit keeps everyone clear, in dots if it must.
    await page.setViewportSize({ width: 393, height: 659 });
    const id = await personIdOf('demo-two-lineages');
    await openExplorer(page, { focus: id });
    await settledView(page);
    await nodeOf(page, id).tap();
    const panel = page.getByTestId('explorer-panel');
    await expect(panel).toBeVisible();
    expect(await isSheet(panel), 'the panel is the bottom sheet').toBe(true);
    await settledTop(panel.locator('xpath=ancestor-or-self::*[@role="dialog"][1]'));
    await settledView(page);
    await page.getByRole('button', { name: 'Fit the whole view' }).tap();
    await settledView(page);
    await expect(nodeOf(page, id), 'the selected person is drawn').toHaveCount(1);
    expect(await page.locator('.react-flow__node [data-person-node]').count(), 'the whole view is drawn').toBeGreaterThanOrEqual(7);
    expect(await cardsUnderOverlays(page), 'every person whole on the canvas, clear of the legend and the buttons').toEqual([]);
  });

  test('@M06 on a phone a selection that opens the bottom sheet responds with INP under 200 ms at 4x CPU throttling', async ({ page, browserName }) => {
    // Plan §5.8 (c), as the M05 selection INP (installInpProbes, selectionInp): the person of
    // demo-two-lineages, then their two teachers, above the person and the sheet. The first
    // selection opens the sheet (the Drawer's first opening on the page), the others change it.
    await installInpProbes(page);
    const id = await personIdOf('demo-two-lineages');
    await openExplorer(page, { focus: id });
    await settledView(page);
    const teachers = await edgesInto(page, id).evaluateAll((paths) => paths.map((p) => p.getAttribute('data-teacher')!));
    expect(teachers.length, 'teachers drawn').toBeGreaterThanOrEqual(2);
    const targets = [id, ...teachers];
    const result = await selectionInp(page, browserName, 3, async (selected) => targets[selected.length] ?? null);
    test.info().annotations.push({
      type: `INP (ms, worst of 3 selections, 4x CPU, phone person view of demo-two-lineages, ${result.method})`,
      description: `${result.inp} (Event Timing ${result.eventTiming ?? 'none'}, frame measure ${Math.round(result.frame)})`,
    });
    expect(result.inp).toBeLessThan(200);
  });

  test('@M06 on a phone Back with the bottom sheet open closes it and keeps the explorer URL', async ({ page }) => {
    const id = await personIdOf('demo-two-lineages');
    await openExplorer(page, { focus: id });
    await settledView(page);
    const url = page.url();
    await nodeOf(page, id).tap();
    const panel = page.getByTestId('explorer-panel');
    await expect(panel).toBeVisible();
    await page.goBack();
    await expect(panel, 'Back closes the sheet').toBeHidden();
    await expect(nodeOf(page, id), 'and clears the selection').not.toHaveClass(/\bselected\b/);
    expect(page.url(), 'the explorer URL is kept').toBe(url);
    await expect(nodeOf(page, id)).toBeVisible();
  });

  test('@M06 on a phone "Center on this person" with the sheet open, then Esc, keeps the new focus in the URL', async ({ page }) => {
    const id = await personIdOf('demo-two-lineages');
    await openExplorer(page, { focus: id });
    await settledView(page);
    const other = await uncoveredNode(page, [id]);
    expect(other, 'another person on screen').not.toBeNull();
    await nodeOf(page, other!).tap();
    const panel = page.getByTestId('explorer-panel');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Center on this person' }).tap();
    await expect.poll(() => searchOf(page).focus, 'the new focus is in the URL').toBe(other);
    await expect(nodeOf(page, other!)).toHaveClass(/\bselected\b/);
    await expect(panel).toBeVisible();
    const url = page.url();
    await page.keyboard.press('Escape');
    await expect(panel, 'Esc closes the sheet').toBeHidden();
    await expect(nodeOf(page, other!)).not.toHaveClass(/\bselected\b/);
    // The close does not step back over the change of focus: the URL stays (checked across a second,
    // the time a history step and the scene it brings back would take).
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(250);
      expect(page.url(), 'the URL after Esc').toBe(url);
    }
    await expect(nodeOf(page, other!)).toBeVisible();
  });

  test('@M06 on a phone Esc in the graph lowers a raised sheet to its peek, then clears the selection', async ({ page }) => {
    const id = await personIdOf('demo-two-lineages');
    await openExplorer(page, { focus: id });
    await settledView(page);
    expect(await focusGraph(page)).toBe(id);
    await page.keyboard.press('Space');
    const panel = page.getByTestId('explorer-panel');
    await expect(panel).toBeVisible();
    // The sheet raised to its top while the focus is in the graph (a drag on its handle moves no
    // focus; so does a click event without a pointer): it covers the graph, so the focus moves into it.
    await panel.getByRole('button', { name: 'Expand' }).dispatchEvent('click');
    await expect(panel.getByRole('button', { name: 'Collapse' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-explorer-sheet]')), 'the focus moved into the sheet').toBe(true);

    // Back in the graph, the focus stays there: the peek the sheet opened at, settling only after the
    // sheet was raised, takes nothing back (checked across a second, the longest a settle waits).
    await nodeOf(page, id).focus();
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(250);
      expect(await focusedNodeId(page), 'the focus stays on the person in the graph').toBe(id);
    }
    // Esc lowers the sheet to its peek and keeps the selection; Esc again clears it.
    await page.keyboard.press('Escape');
    await expect(panel.getByRole('button', { name: 'Expand' }), 'the sheet is at its peek').toBeVisible();
    await expect(panel).toBeVisible();
    await expect(nodeOf(page, id)).toHaveClass(/\bselected\b/);
    expect(await focusedNodeId(page)).toBe(id);
    await page.keyboard.press('Escape');
    await expect(panel, 'the second Esc closes the sheet').toBeHidden();
    await expect(nodeOf(page, id)).not.toHaveClass(/\bselected\b/);
    expect(await focusedNodeId(page), 'the focus stays on the person').toBe(id);
    await expect.poll(() => announcement(page), 'the clearing is announced').toBe('Selection cleared.');
    await expect(nodeOf(page, id)).not.toHaveAttribute('aria-label', /, selected$/);
  });

  test('@M06 on a phone the sheet gives the focus back to the person when it comes down or closes from inside', async ({ page }) => {
    const id = await personIdOf('demo-two-lineages');
    await openExplorer(page, { focus: id });
    await settledView(page);
    expect(await focusGraph(page)).toBe(id);
    await page.keyboard.press('Space');
    const panel = page.getByTestId('explorer-panel');
    await expect(panel).toBeVisible();
    const expand = panel.getByRole('button', { name: 'Expand' });
    const collapse = panel.getByRole('button', { name: 'Collapse' });
    // Raised to its top with the focus in the graph (a click event without a pointer moves no
    // focus), the sheet takes the focus; lowered again, it gives it back to the person.
    await expand.dispatchEvent('click');
    await expect(collapse).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.matches('[data-explorer-sheet]') ?? false), 'the sheet took the focus').toBe(true);
    await collapse.dispatchEvent('click');
    await expect(expand).toBeVisible();
    await expect.poll(() => focusedNodeId(page), 'lowered, the focus is back on the person').toBe(id);

    // Esc on a control in the raised sheet's body closes the sheet: the focus goes back to the person, not to <body>.
    await expand.dispatchEvent('click');
    const ended = panel.getByRole('button', { name: 'Show ended training' });
    await expect(ended).toBeVisible();
    await ended.focus();
    await page.keyboard.press('Escape');
    await expect(panel, 'Esc in the sheet closes it').toBeHidden();
    await expect.poll(() => focusedNodeId(page), 'closed from inside, the focus is back on the person').toBe(id);
    await expect.poll(() => announcement(page), 'the clearing is announced, as from the graph').toBe('Selection cleared.');
  });

  test('@M06 on a phone Esc in the raised students sheet gives the focus back to the summary node', async ({ page }) => {
    test.setTimeout(120_000);
    const hub = await personIdOf('demo-hub-a');
    await openExplorer(page, { focus: hub });
    await settledView(page);
    expect(await focusGraph(page)).toBe(hub);
    await walkToSummary(page, hub);
    await page.keyboard.press('Enter');
    const panel = page.getByTestId('explorer-panel');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Expand' }).dispatchEvent('click');
    const row = panel.getByRole('link', { name: /^Explore from here: / }).first();
    await expect(row).toBeVisible();
    await row.focus();
    await page.keyboard.press('Escape');
    await expect(panel, 'Esc in the sheet closes it').toBeHidden();
    await expect.poll(() => focusedNodeId(page), 'the focus is back on the summary node').toBe(summaryIdOf(hub));
  });

  test('@M06 on a phone a link in the sheet takes its history entry: one Back returns to the explorer, the next leaves it', async ({ page }) => {
    const id = await personIdOf('demo-two-lineages');
    // A page before the explorer, for the last Back to land on.
    await page.goto('/');
    await openExplorer(page, { focus: id });
    await settledView(page);
    const url = page.url();
    await nodeOf(page, id).tap();
    const panel = page.getByTestId('explorer-panel');
    const profile = panel.getByRole('link', { name: 'Open profile' });
    await expect(profile).toBeVisible();
    await profile.tap();
    await expect(page).toHaveURL(/\/people\/demo-two-lineages$/);
    await page.goBack();
    await expect(page).toHaveURL(url);
    await expect(nodeOf(page, id)).toBeVisible();
    await expect(panel, 'back in the explorer, the sheet is closed').toBeHidden();
    await page.goBack();
    await expect(page, 'the next Back leaves the explorer').toHaveURL(/\/$/);
  });
});

test.describe('selection in a short window (B)', () => {
  // 200 % browser zoom on a laptop (a11y-6): a 1440x900 screen is 720x450 CSS px, a 1366x768 one
  // 683x384. Below 768 px the panel is the bottom sheet, and its peek is about 130 px tall.
  test.use({ viewport: { width: 720, height: 450 }, isMobile: false, hasTouch: false });

  test('@M06 in a short window below 768 px the sheet never hides the person the keyboard selected', async ({ page }) => {
    test.setTimeout(120_000);
    const id = await personIdOf('demo-two-lineages');
    const panel = page.getByTestId('explorer-panel');
    const sheet = panel.locator('xpath=ancestor-or-self::*[@role="dialog"][1]');
    const frameHeight = () => page.locator('[data-canvas-frame]').evaluate((el) => el.getBoundingClientRect().height);

    // 720x450: room kept for the sheet would leave the canvas no room for the legend and a card (it
    // was 58 px), so the sheet covers the canvas instead, and the person is placed above it.
    await openExplorer(page, { focus: id });
    await settledView(page);
    const idle = await frameHeight();
    expect(await focusGraph(page)).toBe(id);
    await page.keyboard.press('Space');
    await expect(panel).toBeVisible();
    expect(await isSheet(panel), 'the panel is the bottom sheet').toBe(true);
    await settledTop(sheet);
    await settledView(page);
    expect(await frameHeight(), 'the canvas keeps its height behind the sheet').toBe(idle);
    expect(await focusedNodeId(page), 'the focus stays on the person').toBe(id);
    await expect.poll(() => isInVisibleArea(page, id), 'the person lies wholly in the canvas above the sheet').toBe(true);
    expect(await wholeAndUncovered(nodeOf(page, id)), 'whole and uncovered').toBe(true);
    // Tab from the person reaches no control under the sheet (WCAG 2.4.11): the buttons over the
    // canvas stand above it or are not shown, and React Flow's attribution is hidden under it.
    // Up to the first focus that leaves the canvas (the tab bar, the sheet itself).
    const sheetBox = (await sheet.boundingBox())!;
    for (let press = 0; press < 12; press++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const at = document.activeElement;
        if (!at?.closest('[data-canvas-frame]')) return null;
        const r = at.getBoundingClientRect();
        return { name: at.getAttribute('aria-label') ?? at.textContent?.trim() ?? at.tagName, x: r.x, y: r.y, width: r.width, height: r.height };
      });
      if (focused === null) break;
      const under = focused.x < sheetBox.x + sheetBox.width && sheetBox.x < focused.x + focused.width && focused.y < sheetBox.y + sheetBox.height && sheetBox.y < focused.y + focused.height;
      expect(under, `Tab reached "${focused.name}" under the sheet`).toBe(false);
    }
    await nodeOf(page, id).focus();
    expect(await focusedNodeId(page), 'back on the person').toBe(id);
    // A key move lands above the sheet too.
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => focusedNodeId(page), 'ArrowDown moves to a student').not.toBe(id);
    await settledView(page);
    const student = (await focusedNodeId(page))!;
    expect(student, 'a node has the focus').not.toBeNull();
    expect(await isInVisibleArea(page, student), 'the student lies wholly in the canvas above the sheet').toBe(true);
    expect(await wholeAndUncovered(nodeOf(page, student)), 'whole and uncovered').toBe(true);

    // 683x384: even the peek covers the whole canvas. The sheet covers the graph as at its top: it
    // takes the focus, so no hidden node keeps it, and gives it back when it closes from inside.
    await page.setViewportSize({ width: 683, height: 384 });
    await openExplorer(page, { focus: id });
    await settledView(page);
    expect(await focusGraph(page)).toBe(id);
    await page.keyboard.press('Space');
    await expect(panel).toBeVisible();
    await settledTop(sheet);
    await expect.poll(() => page.evaluate(() => document.activeElement?.matches('[data-explorer-sheet]') ?? false), 'the sheet took the focus').toBe(true);
    expect(await focusedNodeId(page), 'no node under the sheet keeps the focus').toBeNull();
    await expect(page.locator('[data-explorer-sheet]'), 'the sheet with the focus is on screen').toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(panel, 'Esc in the sheet closes it').toBeHidden();
    await expect.poll(() => focusedNodeId(page), 'the focus is back on the person').toBe(id);
    await expect(nodeOf(page, id), 'who is on screen again').toBeInViewport();
  });
});

test.describe('expansion (C)', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test('@M06 "+N students" on demo-hub-a adds nodes and keeps the focused node in view', async ({ page }) => {
    test.setTimeout(120_000);
    const hub = await personIdOf('demo-hub-a');
    const hubName = await personNameOf('demo-hub-a');
    await captureScenes(page);
    // The generations view: one generation of teachers, none of students.
    await openExplorer(page, { focus: hub, up: 1, down: 0 });
    await settledView(page);
    const before = (await scenesFor(page, hub)).at(-1)!;
    // N: the hub's public students (the API) minus those drawn.
    const n = (await publicStudentCount(page, 'demo-hub-a')) - drawnStudents(before, hub).size;
    expect(n).toBeGreaterThan(0);

    // The keyboard: Tab into the graph reaches the hub (the view's focus), and its "+N students"
    // button follows it in the Tab order. WebKit's Tab may skip a button, so the button is focused
    // as the next Tab would, and pressed with Enter.
    expect(await focusGraph(page)).toBe(hub);
    const button = nodeOf(page, hub).getByRole('button', { name: `+${n} students of ${hubName}`, exact: true });
    await expect(button).toHaveText(`+${n} students`);
    await button.focus();
    expect(await focusedNodeId(page)).toBe(hub);
    const at = (await screenBox(page, hub))!;
    const scenes = (await scenesFor(page, hub)).length;
    await page.keyboard.press('Enter');

    // The expansion is laid out again: the hub's students are drawn, at most FANOUT_SHOWN of them,
    // with the summary node "and N more" when the cap cut them.
    await expect.poll(async () => (await scenesFor(page, hub)).length, { timeout: 15_000 }).toBeGreaterThan(scenes);
    await settledView(page);
    const after = (await scenesFor(page, hub)).at(-1)!;
    const shown = drawnStudents(after, hub);
    expect(shown.size).toBeGreaterThan(0);
    expect(shown.size).toBeLessThanOrEqual(FANOUT_SHOWN);
    const summary = after.nodes.some((s) => s.id === summaryIdOf(hub));
    expect(summary, 'the summary node is drawn exactly when the cap cut the students').toBe(shown.size >= FANOUT_SHOWN && n > shown.size);
    await expect.poll(() => announcement(page)).toContain(`Added ${shown.size} students of ${hubName}.`);

    // The hub keeps the focus and its place on screen; the people drawn before keep their rows.
    expect(await focusedNodeId(page)).toBe(hub);
    const now = (await screenBox(page, hub))!;
    expect(Math.abs(now.x - at.x), 'the hub moved across').toBeLessThanOrEqual(2);
    expect(Math.abs(now.y - at.y), 'the hub moved up or down').toBeLessThanOrEqual(2);
    const yOf = (scene: typeof before, id: string) => scene.nodes.find((s) => s.id === id)!.center.y;
    for (const node of before.nodes) {
      expect(after.nodes.some((s) => s.id === node.id), `${node.id} is still drawn`).toBe(true);
      expect(yOf(after, node.id) - yOf(after, hub), `${node.id} keeps its row`).toBeCloseTo(yOf(before, node.id) - yOf(before, hub), 0);
    }
    // The button now counts the students not drawn; beyond the cap it opens their list.
    await expect(nodeOf(page, hub).locator('[data-more-chip]')).toHaveText(`+${n - shown.size} students`);
  });

  test('@M06 a teacher with more than 12 students shows an "and N more" node that opens a paginated list', async ({ page }) => {
    test.setTimeout(120_000);
    const hub = await personIdOf('demo-hub-a');
    const hubName = await personNameOf('demo-hub-a');
    await captureScenes(page);
    await openExplorer(page, { focus: hub });
    await settledView(page);
    // N: the students not drawn, from the API's count and the scene (never a number of the demo data).
    const total = await publicStudentCount(page, 'demo-hub-a');
    const scene = (await scenesFor(page, hub)).at(-1)!;
    // At least the cap: a student the cap left out is drawn anyway when another teacher in the view keeps it.
    const drawn = drawnStudents(scene, hub).size;
    expect(drawn).toBeGreaterThanOrEqual(FANOUT_SHOWN);
    const n = total - drawn;
    expect(n).toBeGreaterThan(0);
    expect(scene.nodes.some((s) => s.id === summaryIdOf(hub))).toBe(true);

    // The node is drawn once it is in view (React Flow draws only what is on screen): Fit shows it.
    const node = summaryNodeOf(page, hub);
    if ((await node.count()) === 0) {
      await page.getByRole('button', { name: 'Fit the whole view' }).click();
      await settledView(page);
    }
    await expect(node).toHaveAttribute('aria-label', `and ${n} more students of ${hubName}`);
    await expect(node).toHaveAttribute('role', 'button');
    await expect(node, 'described by what it opens').toHaveAccessibleDescription(`Opens the list of all students of ${hubName}, 20 to a page.`);
    // Its words at every level of detail but the dot.
    if ((await node.locator('[data-summary-node]').getAttribute('data-lod')) !== 'dot') await expect(node).toContainText(`and ${n} more`);

    // Enter on it (the graph's keys, package A) opens the teacher's students in the panel, 20 to a
    // page, by name, as people.students lists them.
    // Focused as a key move would (no scroll of the graph's box), not with the pointer.
    await node.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
    expect(await focusedNodeId(page)).toBe(summaryIdOf(hub));
    await page.keyboard.press('Enter');
    const panel = page.getByTestId('explorer-panel');
    await expect(panel.getByRole('heading', { name: `Students of ${hubName}` })).toBeVisible();
    const size = 20;
    const first = await listedStudents(page, hubName, 1);
    expect(first.map((s) => s.name)).toEqual(await studentNamesOfPage(page, 'demo-hub-a', 1, size));
    expect(first).toHaveLength(Math.min(size, total));

    const pages = panel.getByRole('navigation', { name: 'Pages of students' });
    await pages.getByRole('button', { name: 'Next' }).click();
    const second = await listedStudents(page, hubName, 2);
    expect(second.map((s) => s.name)).toEqual(await studentNamesOfPage(page, 'demo-hub-a', 2, size));
    expect(second).toHaveLength(Math.min(size, total - size));
    const once = new Set([...first, ...second].map((s) => s.href));
    expect(once.size, 'no student on both pages').toBe(first.length + second.length);
    await expect(pages.getByRole('status')).toHaveText(`Page 2 of ${Math.ceil(total / size)}`);

    await pages.getByRole('button', { name: 'Previous' }).click();
    expect(await listedStudents(page, hubName, 1)).toEqual(first);
    await expect(pages.getByRole('button', { name: 'Previous' })).toHaveAttribute('aria-disabled', 'true');

    // A click on the summary node opens the same list.
    await panel.getByRole('button', { name: 'Close' }).click();
    await expect(panel).toHaveCount(0);
    await node.click();
    await expect(panel.getByRole('heading', { name: `Students of ${hubName}` })).toBeVisible();
    expect(await listedStudents(page, hubName, 1)).toEqual(first);
  });

  test('@M06 the panel never covers the node the keyboard opened it from', async ({ page }) => {
    test.setTimeout(120_000);
    // The summary node ends demo-hub-a's row of students, at the canvas's right edge once the keys
    // reach it: where the desktop panel opens over the canvas (WCAG 2.4.11, focus not obscured).
    const hub = await personIdOf('demo-hub-a');
    await openExplorer(page, { focus: hub });
    await settledView(page);
    expect(await focusGraph(page)).toBe(hub);
    await walkToSummary(page, hub);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('explorer-panel').getByRole('heading', { name: /^Students of / })).toBeVisible();
    expect(await focusedNodeId(page), 'the focus stays on the summary node').toBe(summaryIdOf(hub));
    await expect.poll(() => wholeAndUncovered(summaryNodeOf(page, hub)), 'the summary node is whole and uncovered').toBe(true);
    await settledView(page);
    expect(await wholeAndUncovered(summaryNodeOf(page, hub)), 'and stays so').toBe(true);
  });

  test('@M06 the panel\'s Close and "List all students" are announced as a key\'s are', async ({ page }) => {
    const hub = await personIdOf('demo-hub-a');
    const hubName = await personNameOf('demo-hub-a');
    await openExplorer(page, { focus: hub });
    await settledView(page);
    expect(await focusGraph(page)).toBe(hub);
    const panel = page.getByTestId('explorer-panel');
    await page.keyboard.press('Space');
    await expect.poll(() => announcement(page), 'the selection is announced').toBe(`${hubName} selected. Routes of descent and details are open.`);

    // Close in the overlay clears the selection, says so, and gives the focus back to the person.
    await panel.getByRole('button', { name: 'Close' }).click();
    await expect(panel).toHaveCount(0);
    await expect.poll(() => announcement(page), 'the clearing is announced').toBe('Selection cleared.');
    await expect.poll(() => focusedNodeId(page), 'the focus is back on the person').toBe(hub);

    // "List all students" opens the list, and says so as the summary node does.
    await page.keyboard.press('Space');
    await panel.getByRole('button', { name: /^List all students \(\d+ not drawn\) of / }).click();
    await expect(panel.getByRole('heading', { name: `Students of ${hubName}` })).toBeVisible();
    await expect.poll(() => announcement(page), 'the list is announced').toBe(`Students of ${hubName}: list open.`);
  });

  test('@M06 Esc closes a list of students with nobody selected, from the graph and from the list', async ({ page }) => {
    test.setTimeout(120_000);
    const hub = await personIdOf('demo-hub-a');
    const hubName = await personNameOf('demo-hub-a');
    const summary = summaryIdOf(hub);
    await openExplorer(page, { focus: hub });
    await settledView(page);
    expect(await focusGraph(page)).toBe(hub);
    await walkToSummary(page, hub);
    const panel = page.getByTestId('explorer-panel');
    const heading = panel.getByRole('heading', { name: /^Students of / });

    // In the graph: Enter opens the list and Esc closes it; the focus stays on the summary node.
    await page.keyboard.press('Enter');
    await expect(heading).toBeVisible();
    await expect.poll(() => announcement(page), 'the list is announced').toBe(`Students of ${hubName}: list open.`);
    await page.keyboard.press('Escape');
    await expect(panel, 'Esc in the graph closes the list').toBeHidden();
    expect(await focusedNodeId(page), 'the focus stays on the summary node').toBe(summary);

    // In the list: Esc closes it and the focus goes back to the summary node.
    await page.keyboard.press('Enter');
    await expect(heading).toBeVisible();
    const row = panel.getByRole('link', { name: /^Explore from here: / }).first();
    await expect(row).toBeVisible();
    await row.focus();
    await page.keyboard.press('Escape');
    await expect(panel, 'Esc in the list closes it').toBeHidden();
    await expect.poll(() => focusedNodeId(page), 'the focus is back on the summary node').toBe(summary);

    // The list's Close, from the keyboard: the focus goes back to the summary node too, not to <body>.
    await page.keyboard.press('Enter');
    await expect(heading).toBeVisible();
    await panel.getByRole('button', { name: 'Close' }).focus();
    await page.keyboard.press('Enter');
    await expect(panel, 'Close closes the list').toBeHidden();
    await expect.poll(() => focusedNodeId(page), 'after Close the focus is on the summary node').toBe(summary);
  });

  test('@M06 a panel action that takes away its own button leaves the focus in the panel, never on <body>', async ({ page }) => {
    test.setTimeout(120_000);
    const panel = page.getByTestId('explorer-panel');
    const onBody = () => page.evaluate(() => document.activeElement === null || document.activeElement === document.body);
    const inPanel = () => page.evaluate(() => !!document.activeElement?.closest('[data-testid="explorer-panel"]'));
    const id = await personIdOf('demo-two-lineages');
    await captureScenes(page);
    await openExplorer(page, { focus: id });
    await settledView(page);

    // A person drawn whose students not drawn all fit under the cap (FANOUT_SHOWN), from their
    // "+N students" and the scene: "Show N more students" draws every one of them.
    const scene = (await scenesFor(page, id)).at(-1)!;
    const chips = await page.locator('.react-flow__node').evaluateAll((nodes) =>
      nodes.map((n) => ({ id: (n as HTMLElement).dataset.id!, chip: n.querySelector('[data-more-chip]')?.textContent?.trim() ?? '' })),
    );
    const teacher = chips.find((c) => {
      const n = /^\+(\d+) students?$/.exec(c.chip);
      return n !== null && drawnStudents(scene, c.id).size + Number(n[1]) <= FANOUT_SHOWN;
    })?.id;
    expect(teacher, 'a person whose students not drawn fit under the cap').toBeDefined();
    await nodeOf(page, teacher!).evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
    await page.keyboard.press('Space');
    const more = panel.getByRole('button', { name: /^Show \d+ more students of / });
    await expect(more).toHaveCount(1);

    // "Show N more students": once all of them are drawn the button goes, and the focus stays in the panel.
    await more.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => announcement(page), { timeout: 15_000 }).toMatch(/^Added \d+ students? of /);
    await expect(panel.getByRole('button', { name: /more students of |^List all students/ }), 'every student is drawn').toHaveCount(0);
    await settledView(page);
    expect(await onBody(), 'after "Show N more students" the focus is not on <body>').toBe(false);
    expect(await inPanel(), 'and is in the panel').toBe(true);

    // "Focus this lineage" goes once that lineage is open.
    const lineage = panel.getByRole('button', { name: /^Focus this lineage/ });
    await lineage.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => searchOf(page).lineage ?? null, 'the lineage is in the URL').not.toBeNull();
    await expect(lineage).toHaveCount(0);
    await settledView(page);
    await expect.poll(onBody, 'after "Focus this lineage" the focus is not on <body>').toBe(false);

    // "List all students": the person's panel gives way to the list, which takes the focus.
    const hub = await personIdOf('demo-hub-a');
    await openExplorer(page, { focus: hub });
    await settledView(page);
    expect(await focusGraph(page)).toBe(hub);
    await page.keyboard.press('Space');
    const listAll = panel.getByRole('button', { name: /^List all students \(\d+ not drawn\) of / });
    await listAll.focus();
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('heading', { name: /^Students of / })).toBeVisible();
    await expect.poll(onBody, 'after "List all students" the focus is not on <body>').toBe(false);
    expect(await inPanel(), 'the list has the focus').toBe(true);
  });
});

test.describe('touch and motion (D)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('@M06 on mobile every explorer control is at least 44x44 CSS px', async ({ page }) => {
    test.setTimeout(180_000);
    const id = await personIdOf('demo-two-lineages');
    const zoom = page.getByRole('group', { name: 'Zoom' });
    const panel = page.getByTestId('explorer-panel');
    // The phones of the mobile projects and of the plan's screenshots, the iPhone's short page among them.
    for (const size of PHONES) {
      const at = `${size.width}x${size.height}`;
      await page.setViewportSize(size);
      await openExplorer(page, { focus: id });
      await settledView(page);
      // Nothing selected: the buttons over the canvas in their column, the attribution, the bars.
      await expect(zoom, `${at}: the zoom buttons are shown`).toBeVisible();
      await expect.poll(() => controlProblems(page), `${at}, nothing selected`).toEqual([]);

      // A tap on a person opens the selection's panel: on a phone a bottom sheet (package B).
      await nodeOf(page, id).tap();
      await expect(panel).toBeVisible();
      await settledView(page);
      if (!(await isSheet(panel))) {
        // A panel in the page under the canvas (M05's), before the sheet.
        await expect.poll(() => controlProblems(page), `${at}, the panel open`).toEqual([]);
        continue;
      }
      // The sheet at its peek: a shorter canvas, the buttons in a column or a row above the legend.
      const sheet = panel.locator('xpath=ancestor-or-self::*[@role="dialog"][1]');
      await settledTop(sheet);
      await expect(zoom, `${at}: the zoom buttons are shown with the sheet at its peek`).toBeVisible();
      await expect.poll(() => controlProblems(page), `${at}, the sheet at its peek`).toEqual([]);
      // At half height (on a short phone lower, so that the legend and the selected card keep their
      // room above it): the sheet's buttons, and whatever of the canvas's still fits (on a short
      // phone the buttons may make way: their keys still work).
      await dragSheetToHalf(page, sheet);
      await expect.poll(() => controlProblems(page), `${at}, the sheet at half height`).toEqual([]);
      // The legend stays whole in view (plan §4.6), and so does the selected person (2.4.11).
      await expect.poll(() => wholeAndUncovered(page.getByTestId('explorer-legend')), `${at}: the legend is whole and uncovered with the sheet at half height`).toBe(true);
      await expect.poll(() => isInVisibleArea(page, id), `${at}: the selected person is in view above the sheet`).toBe(true);
    }

    // The list of a teacher's students (the summary node "and N more") in the sheet, raised to its
    // top and scrolled to its pages: Previous and Next as well (the sheet covers the rest there).
    await page.setViewportSize(PHONES[0]);
    const hub = await personIdOf('demo-hub-a');
    await openExplorer(page, { focus: hub });
    await settledView(page);
    expect(await focusGraph(page)).toBe(hub);
    await walkToSummary(page, hub);
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Expand' }).tap();
    await expect(panel.getByRole('button', { name: 'Collapse' })).toBeVisible();
    await settledTop(panel.locator('xpath=ancestor-or-self::*[@role="dialog"][1]'));
    const pages = panel.getByRole('navigation', { name: 'Pages of students' });
    await expect(pages.getByRole('button', { name: 'Next' })).toBeVisible();
    await pages.scrollIntoViewIfNeeded();
    await expect(pages).toBeInViewport();
    await expect.poll(() => controlProblems(page, '[data-explorer-sheet]'), 'the students sheet raised, at its pages').toEqual([]);
  });

  test.describe('with reduced motion', () => {
    test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, reducedMotion: 'reduce' });

    test('@M06 prefers-reduced-motion disables layout animation', async ({ page }) => {
      test.setTimeout(120_000);
      const hub = await personIdOf('demo-hub-a');
      await captureScenes(page);
      // The generations view of demo-hub-a: one generation of teachers, none of students.
      await openExplorer(page, { focus: hub, up: 1, down: 0 });
      await settledView(page);
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'the page prefers reduced motion').toBe(true);

      // An expansion ("+N students", package C) lays the view out again: every person is drawn at
      // their new place at once, never between two places, and the view jumps with the person pressed.
      // First the hub's own students (drawn below it: nobody moves), then those of its teacher
      // demo-root-a, which take the row beside the hub and push the hub and its students aside.
      const moved = new Set<string>();
      for (const slug of ['demo-hub-a', 'demo-root-a']) {
        const pressed = await personIdOf(slug);
        const scenes = (await scenesFor(page, hub)).length;
        await startMotion(page);
        await nodeOf(page, pressed).locator('[data-more-chip]').focus();
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await scenesFor(page, hub)).length, { timeout: 15_000 }).toBeGreaterThan(scenes);
        await settledView(page);
        // Longer than a slide (--duration-slow) would take.
        await page.waitForTimeout(400);
        const motion = await stopMotion(page);
        const added = (await scenesFor(page, hub)).length - scenes;
        expect(motion.frames, `${slug}: frames sampled`).toBeGreaterThan(20);
        expect(motion.between, `${slug}: no person drawn between two places`).toEqual([]);
        for (const [id, places] of Object.entries(motion.places)) {
          if (places.length > 1) moved.add(id);
          expect(places.length, `${slug}: ${id} went straight to each new place: ${places.join(' → ')}`).toBeLessThanOrEqual(1 + added);
        }
        expect(motion.views.length, `${slug}: the view went straight to its new place: ${motion.views.join(' → ')}`).toBeLessThanOrEqual(1 + added);
        await expect(page.locator('.explorer-canvas[data-moving]'), `${slug}: the edges were never hidden for a slide`).toHaveCount(0);
      }
      expect(moved.size, 'the expansions moved people').toBeGreaterThan(0);

      // The buttons: Fit after a zoom moves the view in one step.
      await page.getByRole('button', { name: 'Zoom in' }).click();
      const zoomed = await settledView(page);
      await startMotion(page);
      await page.getByRole('button', { name: 'Fit the whole view' }).click();
      const fitted = await settledView(page);
      const fit = await stopMotion(page);
      expect(fitted, 'Fit moved the view').not.toEqual(zoomed);
      expect(fit.views, `the view went straight from the zoom to the fit: ${fit.views.join(' → ')}`).toHaveLength(2);
      expect(fit.between).toEqual([]);
    });
  });

  test('@M06 no axe violations on /explore at desktop and mobile sizes in dark and light themes', async ({ browser, baseURL }) => {
    test.setTimeout(300_000);
    const id = await personIdOf('demo-two-lineages');
    const name = await personNameOf('demo-two-lineages');
    const hub = await personIdOf('demo-hub-a');
    const hubName = await personNameOf('demo-hub-a');
    for (const size of [
      { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
      { name: 'desktop', use: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false } },
    ]) {
      const context = await browser.newContext({ ...size.use, baseURL });
      try {
        const page = await context.newPage();
        const press = (target: ReturnType<typeof nodeOf>) => (size.use.hasTouch ? target.tap() : target.click());
        const check = async (state: string) => {
          for (const theme of THEMES) {
            await switchColorScheme(page, theme);
            await expectNoAxeViolations(page, `/explore at ${size.name} size, ${state}, ${theme} theme`);
          }
        };
        await captureScenes(page);
        await openExplorer(page, { focus: id });
        await settledView(page);
        await check('the person view');

        // The shortcut help.
        expect(await focusGraph(page)).toBe(id);
        const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
        await page.keyboard.press('?');
        await expect(help).toBeVisible();
        await check('the shortcut help open');
        await page.keyboard.press('Escape');
        await expect(help).toHaveCount(0);

        // A selection and its panel (a bottom sheet on a phone).
        await press(nodeOf(page, id));
        await expect(page.getByTestId('explorer-panel')).toBeVisible();
        await settledView(page);
        await check('a person selected');

        // An expansion: the hub's students and the summary node "and N more".
        await openExplorer(page, { focus: hub, up: 1, down: 0 });
        await settledView(page);
        expect(await focusGraph(page)).toBe(hub);
        const scenes = (await scenesFor(page, hub)).length;
        await nodeOf(page, hub).locator('[data-more-chip]').focus();
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await scenesFor(page, hub)).length, { timeout: 15_000 }).toBeGreaterThan(scenes);
        await settledView(page);
        const summary = summaryNodeOf(page, hub);
        if ((await summary.count()) === 0) {
          await press(page.getByRole('button', { name: 'Fit the whole view' }));
          await settledView(page);
        }
        await expect(summary).toHaveCount(1);
        await check('the hub expanded');

        if (!size.use.isMobile) {
          // The summary node's list of students (a desktop's panel).
          await summary.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
          await page.keyboard.press('Enter');
          await expect(page.getByTestId('explorer-panel').getByRole('heading', { name: `Students of ${hubName}` })).toBeVisible();
          expect((await listedStudents(page, hubName, 1)).length).toBeGreaterThan(0);
          await check('the list of students open');

          // The teacher chooser: ArrowUp on a person with two teachers drawn.
          await openExplorer(page, { focus: id });
          await settledView(page);
          expect(await focusGraph(page)).toBe(id);
          await page.keyboard.press('ArrowUp');
          const chooser = page.getByRole('menu', { name: `Teachers of ${name}` });
          await expect(chooser).toBeVisible();
          await check('the teacher chooser open');
          await page.keyboard.press('Escape');
          await expect(chooser).toHaveCount(0);
        }
      } finally {
        await context.close();
      }
    }
  });
});
