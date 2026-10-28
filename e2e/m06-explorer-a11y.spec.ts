/**
 * Milestone M06: the explorer's keyboard, screen readers, selection, expansion and touch (Done
 * when 2). Against `next start` with the seeded fictional demo data (D20); nothing here changes
 * data. One describe block per work package (foundation F, keyboard A, selection B, expansion C,
 * touch and motion D), each with its own viewport: every project runs every block, WebKit included.
 */

import { expect, test } from '@playwright/test';

import { SHORTCUTS } from '../src/components/lineage/explorer/shortcuts';
import { FANOUT_SHOWN, summaryIdOf } from '../src/components/lineage/explorer/state';
import { closeHelpers, loadTestEnv } from './helpers/auth';
import { edgesInto, EXPLORER_VIEWS, lineageIdOf, nodeOf, openExplorer, personIdOf } from './helpers/explorer';
import { activeNodeId, announcement, dragNodeOffScreen, focusedNodeId, focusGraph, focusInGraph, isInVisibleArea, tabStops } from './helpers/explorer-a11y';
import { captureScenes, installInpProbes, personNameOf, settledView } from './helpers/explorer-checks';
import { drawnStudents, listedStudents, publicStudentCount, scenesFor, screenBox, studentNamesOfPage, summaryNodeOf } from './helpers/m06-expand';
import { drawnNodeIds, installKeyProbe, keyInp, personNameById, soleTeacherStudent, statusInPersonView, viewTransform } from './helpers/m06-keys';

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
    await page.keyboard.press('Enter');
    await expect(chooser).toHaveCount(0);
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
});

test.describe('selection (B)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // Package B: tests 4 and 7 (and the phone selection INP extra, the Back and history checks).
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
    // Its words at every level of detail but the dot.
    if ((await node.locator('[data-summary-node]').getAttribute('data-lod')) !== 'dot') await expect(node).toContainText(`and ${n} more`);

    // Activating it (a click here; Enter and Space come with the graph's keys, package A) opens the
    // teacher's students in the panel, 20 to a page, by name, as people.students lists them.
    await node.click();
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
  });
});

test.describe('touch and motion (D)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // Package D: tests 8, 10 and 12.
});
