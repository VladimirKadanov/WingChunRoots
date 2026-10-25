/**
 * Milestone M05: the interactive explorer, views and edges (Done when 2). The explorer runs
 * against `next start` with the seeded fictional demo data (D20); nothing here changes data.
 */

import { expect, test } from '@playwright/test';

import { closeHelpers, loadTestEnv } from './helpers/auth';
import { edgesInto, lineageIdOf, nodeOf, openExplorer, personIdOf, personNodes } from './helpers/explorer';
import { expectNoAxeViolations, openInTheme, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

/** Every point of an SVG path's d attribute (M/L/C commands with absolute coordinates). */
function pathPoints(d: string): { command: string; x: number; y: number }[] {
  const out: { command: string; x: number; y: number }[] = [];
  let command = 'M';
  for (const token of d.match(/[MLC]|-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g) ?? []) {
    if (/^[MLC]$/.test(token)) command = token;
    else {
      const [x, y] = token.split(',').map(Number) as [number, number];
      out.push({ command, x, y });
    }
  }
  return out;
}

test('@M05 ego view of demo-two-lineages shows two incoming teacher edges', async ({ page }) => {
  const id = await personIdOf('demo-two-lineages');
  await openExplorer(page, { focus: id });
  await expect(edgesInto(page, id)).toHaveCount(2);
  const teachers = await edgesInto(page, id).evaluateAll((paths) => paths.map((p) => p.getAttribute('data-teacher')));
  expect(new Set(teachers).size).toBe(2);
  for (const teacher of teachers) await expect(nodeOf(page, teacher!)).toBeVisible();
});

test('@M05 cross-lineage teacher edge is curved, long-dashed and labelled with the lineage', async ({ page }) => {
  const id = await personIdOf('demo-two-lineages');
  await openExplorer(page, { focus: id });
  const cross = page.locator(`[data-edge][data-student="${id}"][data-kind="crossLineage"]`);
  await expect(cross).toHaveCount(1);
  // A cubic Bézier curve, not an orthogonal route (plan §4.6).
  await expect(cross).toHaveAttribute('data-routed', 'scene');
  expect(await cross.getAttribute('d')).toMatch(/ C /);
  // Long dashes: the cross-lineage pattern of the design tokens, with a dash longer than its gaps.
  const dash = (await cross.getAttribute('stroke-dasharray'))!.split(/[\s,]+/).map(Number);
  expect(dash.length).toBeGreaterThanOrEqual(2);
  expect(Math.max(...dash)).toBeGreaterThanOrEqual(2 * Math.min(...dash));
  const edgeId = await cross.getAttribute('data-edge');
  await expect(page.locator(`[data-edge-label="${edgeId}"]`)).toHaveText(/^Teacher in Demo Lineage [A-C]$/);
});

test('@M05 demo-converging shows two same-lineage incoming edges, routed orthogonally, with the student placed horizontally between both teachers and a "2 teachers" chip', async ({
  page,
}) => {
  const id = await personIdOf('demo-converging');
  await openExplorer(page, { focus: id });
  const incoming = edgesInto(page, id);
  await expect(incoming).toHaveCount(2);
  const edges = await incoming.evaluateAll((paths) =>
    paths.map((p) => ({
      kind: p.getAttribute('data-kind'),
      lineage: p.getAttribute('data-lineage'),
      routed: p.getAttribute('data-routed'),
      d: p.getAttribute('d') ?? '',
      teacher: p.getAttribute('data-teacher')!,
    })),
  );
  // Same lineage: both edges name one lineage.
  expect(edges[0]!.lineage).toBeTruthy();
  expect(edges[1]!.lineage).toBe(edges[0]!.lineage);
  for (const e of edges) {
    expect(e.kind).not.toBe('crossLineage');
    expect(e.routed).toBe('elk');
    // Orthogonal: every segment is horizontal or vertical.
    const points = pathPoints(e.d);
    expect(points.every((p) => p.command !== 'C')).toBe(true);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      expect(Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5, `${e.d}`).toBe(true);
    }
  }
  const centre = async (nodeId: string) => {
    const box = (await nodeOf(page, nodeId).boundingBox())!;
    return box.x + box.width / 2;
  };
  const [a, b] = [await centre(edges[0]!.teacher), await centre(edges[1]!.teacher)];
  const student = await centre(id);
  expect(student).toBeGreaterThanOrEqual(Math.min(a, b) - 1);
  expect(student).toBeLessThanOrEqual(Math.max(a, b) + 1);
  await expect(nodeOf(page, id).locator('[data-teachers-chip]')).toHaveText('2 teachers');
});

test('@M05 historical relationships are hidden by default and shown with show=historical', async ({ page }) => {
  const id = await personIdOf('demo-historical-only');
  await openExplorer(page, { focus: id });
  await expect(nodeOf(page, id)).toBeVisible();
  await expect(edgesInto(page, id)).toHaveCount(0);
  await openExplorer(page, { focus: id, show: 'historical' });
  const historical = edgesInto(page, id);
  await expect(historical).toHaveCount(1);
  await expect(historical).toHaveAttribute('data-stroke', 'historical');
  const edgeId = await historical.getAttribute('data-edge');
  // Labelled with its period (plan §4.6), not faded with transparency.
  await expect(page.locator(`[data-edge-label="${edgeId}"]`)).toHaveText(/\d{4}/);
  expect(await historical.evaluate((p) => getComputedStyle(p).opacity)).toBe('1');
});

test('@M05 all nodes of one generation share the same y position', async ({ page }) => {
  await openExplorer(page, { focus: await personIdOf('demo-two-lineages') });
  const nodes = await personNodes(page).evaluateAll((els) => els.map((el) => ({ rank: el.getAttribute('data-rank'), y: el.getBoundingClientRect().top })));
  expect(nodes.length).toBeGreaterThan(3);
  const byRank = new Map<string, number[]>();
  for (const n of nodes) byRank.set(n.rank!, [...(byRank.get(n.rank!) ?? []), n.y]);
  expect(byRank.size).toBeGreaterThan(2);
  for (const [rank, ys] of byRank) expect(Math.max(...ys) - Math.min(...ys), `rank ${rank}`).toBeLessThan(1);
  // Lower ranks are higher on the screen.
  const rows = [...byRank].map(([rank, ys]) => [Number(rank), ys[0]!] as const).sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < rows.length; i++) expect(rows[i]![1]).toBeGreaterThan(rows[i - 1]![1]);
});

test('@M05 the label reads "Generation N from {root}" only when the view root is the lineage root and every edge on the path is verified, and "N generations below {name} in this view" otherwise', async ({
  page,
}) => {
  const id = await personIdOf('demo-two-lineages');
  // The person view reaches the lineage root over verified links: "Generation N from {root}".
  await openExplorer(page, { focus: id });
  await expect(nodeOf(page, id)).toContainText(/Generation \d+ from \S/);
  // One generation up: the view's root is a teacher, not the lineage root.
  await openExplorer(page, { focus: id, up: 1, down: 0 });
  await expect(nodeOf(page, id)).toContainText(/1 generation below \S.* in this view/);
  await expect(personNodes(page).filter({ hasText: /Generation \d+ from/ })).toHaveCount(0);
});

test('@M05 reload keeps focus, depth and view from the URL', async ({ page }) => {
  const id = await personIdOf('demo-two-lineages');
  await openExplorer(page, { focus: id, up: 1, down: 1 });
  const check = async () => {
    await expect(page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Generations' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('group', { name: 'Teachers' })).toContainText('Teachers: 1');
    await expect(page.getByRole('group', { name: 'Students' })).toContainText('Students: 1');
    await expect(nodeOf(page, id)).toBeVisible();
  };
  await check();
  await page.getByRole('button', { name: 'More generations of students' }).click();
  await expect(page).toHaveURL(/down=2/);
  await page.reload();
  await expect(personNodes(page).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('group', { name: 'Students' })).toContainText('Students: 2');
  const url = new URL(page.url());
  expect(url.searchParams.get('focus')).toBe(id);
  expect(url.searchParams.get('up')).toBe('1');
  expect(url.searchParams.get('down')).toBe('2');
});

test('@M05 profile page does not request the ELK worker; the explorer page does', async ({ page }) => {
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.goto('/people/demo-two-lineages');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/people/demo-two-lineages/lineage');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(500);
  expect(workers).toEqual([]);
  await openExplorer(page, { focus: await personIdOf('demo-two-lineages') });
  expect(workers.length).toBeGreaterThan(0);
});

test('@M05 the explorer shows a shape-matched loading skeleton while the layout runs', async ({ page }) => {
  // Records the skeleton the moment it appears, and its rows (one per generation).
  await page.addInitScript(() => {
    const record = () => {
      const skeleton = document.querySelector('[data-testid="explorer-skeleton"]');
      if (skeleton) (window as unknown as { __skeleton?: number }).__skeleton = skeleton.querySelectorAll('[data-skeleton-row]').length;
    };
    new MutationObserver(record).observe(document, { childList: true, subtree: true });
  });
  await openExplorer(page, { focus: await personIdOf('demo-two-lineages') });
  const rows = await page.evaluate(() => (window as unknown as { __skeleton?: number }).__skeleton);
  expect(rows, 'the skeleton appeared before the drawing').toBeGreaterThan(0);
  const ranks = new Set(await personNodes(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-rank'))));
  // The same shape: as many rows as the drawing has generations (the skeleton shows at most 8).
  expect(rows).toBe(Math.min(ranks.size, 8));
});

test('@M05 legend shows an icon, a stroke sample and text for every status in view', async ({ page }) => {
  await openExplorer(page, { focus: await personIdOf('demo-two-lineages') });
  const legend = page.getByTestId('explorer-legend').getByRole('list', { name: 'Legend: link states' });
  await expect(legend).toBeVisible();
  const items = legend.getByRole('listitem');
  const strokes = new Set(await page.locator('[data-edge]').evaluateAll((paths) => paths.map((p) => p.getAttribute('data-stroke'))));
  const words: Record<string, string> = { verified: 'Verified', cross_lineage: 'Cross-lineage', historical: 'Historical', under_review: 'Under review', unconfirmed: 'Unconfirmed', arbitration: 'In arbitration' };
  expect(strokes.size).toBeGreaterThan(0);
  for (const stroke of strokes) {
    const item = items.filter({ hasText: words[stroke!]! });
    await expect(item, stroke!).toHaveCount(1);
    // The stroke sample and the seal icon: two drawings beside the words.
    expect(await item.locator('svg').count()).toBeGreaterThanOrEqual(2);
  }
});

test('@M05 Graph/List toggle switches views and back without losing the focus person', async ({ page }) => {
  const id = await personIdOf('demo-two-lineages');
  await openExplorer(page, { focus: id });
  await nodeOf(page, id).click();
  await expect(page.getByTestId('explorer-panel')).toBeVisible();
  const toggle = page.getByRole('group', { name: 'Show as' });
  await toggle.getByRole('button', { name: 'List' }).click();
  await expect(page).toHaveURL(/view=list/);
  // The list is the M04 list view of the same person.
  await expect(page.getByRole('heading', { level: 1, name: /Lineage of/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Routes of descent' })).toBeVisible();
  await toggle.getByRole('button', { name: 'Graph' }).click();
  await expect(page).not.toHaveURL(/view=list/);
  expect(new URL(page.url()).searchParams.get('focus')).toBe(id);
  await expect(nodeOf(page, id)).toBeVisible();
  // <Activity> kept the graph's state: the selection is still open.
  await expect(page.getByTestId('explorer-panel')).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('@M05 at 390x844 the explorer fills the dynamic viewport height and keeps its controls inside the safe areas', async ({ page }) => {
    await openExplorer(page, { focus: await personIdOf('demo-two-lineages') });
    const frame = await page.locator('main > div').first().boundingBox();
    const header = await page.locator('header').first().boundingBox();
    const bar = await page.locator('[data-tab-bar]').boundingBox();
    expect(frame && header && bar).toBeTruthy();
    // From the bottom of the top bar to the top of the tab bar, give or take a border.
    expect(Math.abs(frame!.y - (header!.y + header!.height))).toBeLessThanOrEqual(2);
    expect(Math.abs(frame!.y + frame!.height - bar!.y)).toBeLessThanOrEqual(2);
    // Every control of the explorer is on screen, above the tab bar, at least 44 px tall.
    for (const control of [
      page.getByRole('button', { name: 'Zoom in' }),
      page.getByRole('button', { name: 'Fit the whole view' }),
      page.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'List' }),
      page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Lineage' }),
      page.locator('label').filter({ hasText: 'Show ended training' }),
    ]) {
      const box = (await control.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(box.y + box.height).toBeLessThanOrEqual(bar!.y);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // No horizontal scroll of the page.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test('@M05 selecting a node responds with INP under 200 ms at 4x CPU throttling', async ({ page, browserName }) => {
  const id = await personIdOf('demo-two-lineages');
  await openExplorer(page, { focus: id });
  // Interaction latency from the Event Timing API (what INP is made of), which reports only
  // interactions of 16 ms or more; and in every browser (WebKit has no Event Timing) the time from
  // the pointer going down to the first frame after the click.
  await page.evaluate(() => {
    const w = window as unknown as { __inp: number[]; __frames: number[] };
    w.__inp = [];
    w.__frames = [];
    if (PerformanceObserver.supportedEntryTypes.includes('event')) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEventTiming & { interactionId?: number })[]) {
          if (entry.interactionId) w.__inp.push(entry.duration);
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
    }
    let down = 0;
    document.addEventListener('pointerdown', (e) => (down = e.timeStamp), { capture: true });
    document.addEventListener('click', () => {
      requestAnimationFrame(() => setTimeout(() => w.__frames.push(performance.now() - down)));
    });
  });
  // 4x CPU slowdown where the browser offers it (Chromium, through the DevTools protocol).
  const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
  await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const teachers = await edgesInto(page, id).evaluateAll((paths) => paths.map((p) => p.getAttribute('data-teacher')!));
  for (const target of [id, ...teachers]) {
    await nodeOf(page, target).click();
    await expect(page.getByTestId('explorer-panel')).toBeVisible();
  }
  await page.waitForTimeout(500);
  await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const measured = await page.evaluate(() => {
    const w = window as unknown as { __inp: number[]; __frames: number[] };
    return { inp: w.__inp, frames: w.__frames };
  });
  expect(measured.frames.length, 'every selection was measured').toBeGreaterThanOrEqual(3);
  // INP itself where the browser reports it; with no entry (WebKit, or every interaction under
  // 16 ms) the frame measure, which also counts its own timer and so errs on the slow side.
  const worst = Math.max(...(measured.inp.length > 0 ? measured.inp : measured.frames));
  test.info().annotations.push({ type: 'INP (ms, worst of 3 selections, 4x CPU)', description: String(worst) });
  expect(worst).toBeLessThan(200);
});

test('@M05 no axe violations on /explore in dark and light themes', async ({ page }) => {
  const id = await personIdOf('demo-two-lineages');
  await openInTheme(page, `/explore?focus=${id}`, THEMES[0]!);
  await expect(personNodes(page).first()).toBeVisible({ timeout: 30_000 });
  await nodeOf(page, id).click();
  await expect(page.getByTestId('explorer-panel')).toBeVisible();
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `/explore (person view, a node selected), ${theme} theme`);
  }
  // The lineage view and the starting page too.
  await openExplorer(page, { focus: id, lineage: await lineageIdOf('demo-lineage-a') });
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `/explore (lineage view), ${theme} theme`);
  }
  await page.goto('/explore');
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `/explore (start), ${theme} theme`);
  }
});
