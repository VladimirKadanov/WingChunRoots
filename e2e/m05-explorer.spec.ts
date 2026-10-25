/**
 * Milestone M05: the interactive explorer, views and edges (Done when 2). The explorer runs
 * against `next start` with the seeded fictional demo data (D20); nothing here changes data.
 */

import { expect, test, type Worker } from '@playwright/test';

import { closeHelpers, loadTestEnv } from './helpers/auth';
import { EXPLORER_VIEWS, edgesInto, lineageIdOf, nodeOf, openExplorer, personIdOf, personNodes } from './helpers/explorer';
import {
  elkScripts,
  emulateSafeAreaInsets,
  expectGenerationLabel,
  installInpProbes,
  loadedScripts,
  nodeNames,
  personNameOf,
  recordScripts,
  selectionInp,
  uncoveredNode,
  workerScripts,
} from './helpers/explorer-checks';
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
  // Drawn as the cross-lineage stroke (plan §4.6), not as one of the states.
  await expect(cross).toHaveAttribute('data-stroke', 'cross_lineage');
  // Long dashes: the longest dash is at least twice the longest gap, which a dotted line (a dot of
  // 0.1 and gaps of 4) and the dashes of "Under review" (7 and 4) are not. As drawn, from the
  // computed style; an odd-length list repeats (SVG), so dashes and gaps alternate from the start.
  const listed = (await cross.evaluate((p) => getComputedStyle(p).strokeDasharray)).split(/[\s,]+/).map((v) => Number.parseFloat(v));
  expect(listed.every(Number.isFinite) && listed.length > 0, `stroke-dasharray ${listed.join(' ')}`).toBe(true);
  const pattern = listed.length % 2 === 0 ? listed : [...listed, ...listed];
  const dashes = pattern.filter((_, i) => i % 2 === 0);
  const gaps = pattern.filter((_, i) => i % 2 === 1);
  expect(Math.max(...dashes), `stroke-dasharray ${listed.join(' ')}`).toBeGreaterThanOrEqual(2 * Math.max(...gaps));
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
  // (On the card and in the node's accessible name: expectGenerationLabel.)
  await openExplorer(page, { focus: id });
  await expectGenerationLabel(page, id, /Generation \d+ from \S/);
  // One generation up: the view's root is a teacher, not the lineage root.
  await openExplorer(page, { focus: id, up: 1, down: 0 });
  await expectGenerationLabel(page, id, /1 generation below \S.* in this view/);
  await expect(personNodes(page).filter({ hasText: /Generation \d+ from/ })).toHaveCount(0);
  expect((await nodeNames(page)).filter((name) => /, Generation \d+ from /.test(name))).toEqual([]);
  // A path with an edge that is not verified: demo-arbitration's only teacher link is in
  // arbitration, so its card counts in this view only, while its teacher, verified up to the
  // root of Demo Lineage B, counts from that root.
  const disputed = await personIdOf('demo-arbitration');
  const root = await personNameOf('demo-root-b');
  await openExplorer(page, { focus: disputed });
  const link = edgesInto(page, disputed);
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('data-stroke', 'arbitration');
  await expectGenerationLabel(page, (await link.getAttribute('data-teacher'))!, `Generation 2 from ${root}`);
  await expectGenerationLabel(page, disputed, `2 generations below ${root} in this view`);
  await expect(nodeOf(page, disputed)).not.toContainText(/Generation \d+ from/);
  await expect(nodeOf(page, disputed)).not.toHaveAttribute('aria-label', /, Generation \d+ from /);
});

test('@M05 reload keeps focus, depth and view from the URL', async ({ page }) => {
  const id = await personIdOf('demo-two-lineages');
  await openExplorer(page, { focus: id, up: 1, down: 1 });
  const check = async (down: number) => {
    await expect(page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Generations' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('group', { name: 'Teachers' })).toContainText('Teachers: 1');
    await expect(page.getByRole('group', { name: 'Students' })).toContainText(`Students: ${down}`);
    await expect(nodeOf(page, id)).toBeVisible();
  };
  await check(1);
  await page.getByRole('button', { name: 'More generations of students' }).click();
  await expect(page).toHaveURL(/down=2/);
  await page.reload();
  await expect(personNodes(page).first()).toBeVisible({ timeout: 30_000 });
  // After the reload the explorer has only the URL: the same view, focus and both depths.
  await check(2);
  const url = new URL(page.url());
  expect(url.searchParams.get('focus')).toBe(id);
  expect(url.searchParams.get('up')).toBe('1');
  expect(url.searchParams.get('down')).toBe('2');
});

test('@M05 profile page does not request the ELK worker; the explorer page does', async ({ page }) => {
  // Plan §4.11: ELK is not loaded outside the explorer, checked on the network requests. Every
  // script fetched is read for ELK's code, so ELK is found however it would load: in a worker, or
  // on the page itself (a client component that imports it).
  const workers: Worker[] = [];
  page.on('worker', (worker) => workers.push(worker));
  const fetched = recordScripts(page);
  for (const path of ['/people/demo-two-lineages', '/people/demo-two-lineages/lineage']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(500);
    expect(await elkScripts(page, [...fetched, ...(await loadedScripts(page))]), `ELK fetched on ${path}`).toEqual([]);
  }
  expect(workers.map((w) => w.url())).toEqual([]);

  fetched.clear();
  await openExplorer(page, { focus: await personIdOf('demo-two-lineages') });
  // The explorer starts the layout worker, the one that loads ELK; the page itself does not load it.
  const inWorkers: string[] = [];
  for (const worker of workers) inWorkers.push(...(await elkScripts(page, await workerScripts(worker))));
  expect(inWorkers.length, 'a worker of /explore loads ELK').toBeGreaterThan(0);
  expect(await elkScripts(page, await loadedScripts(page)), 'ELK on the page itself').toEqual([]);
  // Every fetch of ELK the browser reported came from that worker.
  for (const url of await elkScripts(page, fetched)) expect(inWorkers, url).toContain(url);
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
  await expect(page.getByRole('heading', { level: 1, name: /Lineage of/ })).toContainText(await personNameOf('demo-two-lineages'));
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

  test('@M05 at 390x844 the explorer fills the dynamic viewport height and keeps its controls inside the safe areas', async ({ page, browserName }) => {
    // Safe-area insets are emulated in Chromium only (WebKit outside a device cannot); there the
    // test checks the layout without insets. A notch and a home indicator, then side insets as well.
    const cases = browserName === 'chromium' ? [{ top: 47, right: 0, bottom: 34, left: 0 }, { top: 47, right: 32, bottom: 34, left: 32 }] : [{ top: 0, right: 0, bottom: 0, left: 0 }];
    for (const wanted of cases) {
      const insets = await emulateSafeAreaInsets(page, browserName, wanted);
      const where = `insets ${JSON.stringify(insets)}`;
      await openExplorer(page, { focus: await personIdOf('demo-two-lineages') });
      const frame = await page.locator('main > div').first().boundingBox();
      const header = await page.locator('header').first().boundingBox();
      const bar = await page.locator('[data-tab-bar]').boundingBox();
      expect(frame && header && bar).toBeTruthy();
      // The top bar keeps clear of the notch, the tab bar of the home indicator.
      expect(header!.y + header!.height, where).toBeGreaterThan(insets.top);
      expect(bar!.y + bar!.height, where).toBeLessThanOrEqual(844 + 0.5);
      // From the bottom of the top bar to the top of the tab bar, give or take a border.
      expect(Math.abs(frame!.y - (header!.y + header!.height)), where).toBeLessThanOrEqual(2);
      expect(Math.abs(frame!.y + frame!.height - bar!.y), where).toBeLessThanOrEqual(2);
      // Every control of the explorer, and the legend, is inside the safe areas, above the tab bar;
      // every control is at least 44 px tall.
      const controls = [
        page.getByRole('button', { name: 'Zoom in' }),
        page.getByRole('button', { name: 'Fit the whole view' }),
        page.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'List' }),
        page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Lineage' }),
        page.locator('label').filter({ hasText: 'Show ended training' }),
      ];
      for (const item of [...controls, page.getByTestId('explorer-legend')]) {
        const box = (await item.boundingBox())!;
        const what = `${where}: ${item.toString()}`;
        expect(box.y, what).toBeGreaterThanOrEqual(insets.top);
        expect(box.x, what).toBeGreaterThanOrEqual(insets.left);
        expect(box.x + box.width, what).toBeLessThanOrEqual(390 - insets.right);
        expect(box.y + box.height, what).toBeLessThanOrEqual(bar!.y);
        if (controls.includes(item)) expect(box.height, what).toBeGreaterThanOrEqual(44);
      }
      // No horizontal scroll of the page.
      expect(await page.evaluate(() => document.documentElement.scrollWidth), where).toBeLessThanOrEqual(390);
    }
  });
});

test('@M05 selecting a node responds with INP under 200 ms at 4x CPU throttling', async ({ page, browserName }) => {
  // Plan §5.8 (c): INP with the web-vitals library where it is installed (onINP, see
  // installInpProbes), otherwise from the Event Timing API it reads; the frame measure in a
  // browser without Event Timing (WebKit). Each selection opens the panel.
  await installInpProbes(page);
  const report = (view: string, result: { inp: number; method: string; eventTiming: number | null; frame: number }) =>
    test.info().annotations.push({
      type: `INP (ms, worst of 3 selections, 4x CPU, ${view}, ${result.method})`,
      description: `${result.inp} (Event Timing ${result.eventTiming ?? 'none'}, frame measure ${Math.round(result.frame)})`,
    });

  // A small view: the person and the two teachers of demo-two-lineages.
  const id = await personIdOf('demo-two-lineages');
  await openExplorer(page, { focus: id });
  const teachers = await edgesInto(page, id).evaluateAll((paths) => paths.map((p) => p.getAttribute('data-teacher')!));
  const targets = [id, ...teachers];
  const small = await selectionInp(page, browserName, 3, async (selected) => targets[selected.length] ?? null);
  report('person view of demo-two-lineages', small);
  expect(small.inp).toBeLessThan(200);

  // A large view (plan §4.8: the cost of a selection must not grow with the people laid out): the
  // Lineage view of Demo Lineage A, over a hundred people. Its root, a person on screen that the
  // panel does not cover, and the root again.
  const root = await personIdOf('demo-root-a');
  await openExplorer(page, { focus: root, lineage: await lineageIdOf('demo-lineage-a') });
  expect(await personNodes(page).count(), 'drawn on screen').toBeGreaterThan(3);
  const large = await selectionInp(page, browserName, 3, (selected) => (selected.length === 1 ? uncoveredNode(page, selected) : Promise.resolve(root)));
  report('Lineage view of Demo Lineage A', large);
  expect(large.inp).toBeLessThan(200);
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
  // The other two views, the list inside the explorer's frame and the starting page too.
  await openExplorer(page, { focus: id, lineage: await lineageIdOf('demo-lineage-a') });
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `/explore (lineage view), ${theme} theme`);
  }
  await openExplorer(page, await EXPLORER_VIEWS.find((v) => v.name === 'generations')!.params());
  await expect(page.getByRole('group', { name: 'Students' })).toBeVisible();
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `/explore (generations view), ${theme} theme`);
  }
  await page.goto(`/explore?focus=${id}&view=list`);
  await expect(page.getByRole('heading', { level: 1, name: /Lineage of/ })).toBeVisible();
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `/explore?view=list (the list in the explorer), ${theme} theme`);
  }
  await page.goto('/explore');
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `/explore (start), ${theme} theme`);
  }
});

test.describe('M05 fixes a1', () => {
  type Page = Parameters<typeof openExplorer>[0];
  type Locator = ReturnType<typeof nodeOf>;
  /** The view's pan and zoom, from React Flow's viewport transform. */
  const viewOf = (page: Page) =>
    page.locator('.react-flow__viewport').evaluate((el) => {
      const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec((el as HTMLElement).style.transform);
      return m ? { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) } : null;
    });
  /** The view once it has stopped moving: the same in two reads 150 ms apart (a zoom button moves it for 200 ms). */
  async function settledView(page: Page) {
    let last = await viewOf(page);
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(150);
      const now = await viewOf(page);
      if (now && JSON.stringify(now) === JSON.stringify(last)) return now;
      last = now;
    }
    throw new Error('The view never stopped moving.');
  }
  /** Whether a node lies wholly inside the canvas pane (a node off screen is not rendered at all). */
  async function onCanvas(page: Page, node: Locator) {
    if ((await node.count()) === 0) return false;
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    const box = await node.boundingBox();
    return !!box && box.x >= pane.x && box.y >= pane.y && box.x + box.width <= pane.x + pane.width && box.y + box.height <= pane.y + pane.height;
  }
  const generations = async () => ({ focus: await personIdOf('demo-converging'), up: 1, down: 1 });

  test('@M05 List and back to Graph keeps the zoom and pan of the graph', async ({ page }) => {
    await openExplorer(page, await generations());
    await settledView(page);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    const before = await settledView(page);
    const toggle = page.getByRole('group', { name: 'Show as' });
    await toggle.getByRole('button', { name: 'List' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Routes of descent' })).toBeVisible();
    await toggle.getByRole('button', { name: 'Graph' }).click();
    await expect(personNodes(page).first()).toBeVisible();
    // A fit of the view would move it again over 250 ms.
    await page.waitForTimeout(600);
    expect(await settledView(page)).toEqual(before);
  });

  test('@M05 "Fit the whole view" never zooms past the cards\' own size, like the first view', async ({ page }) => {
    await openExplorer(page, await generations());
    expect((await settledView(page)).zoom).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await settledView(page);
    await page.getByRole('button', { name: 'Fit the whole view' }).click();
    expect((await settledView(page)).zoom).toBeLessThanOrEqual(1);
  });

  test('@M05 a large view opens at once, in full cards, with the focus and its nearest student when one fits beside it', async ({ page }) => {
    // Every value the viewport's transform takes from the moment the canvas exists.
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { __views: string[] }).__views = seen;
      const watch = () => {
        const el = document.querySelector<HTMLElement>('.react-flow__viewport');
        if (!el) {
          requestAnimationFrame(watch);
          return;
        }
        seen.push(el.style.transform);
        new MutationObserver(() => seen.push(el.style.transform)).observe(el, { attributes: true, attributeFilter: ['style'] });
      };
      requestAnimationFrame(watch);
    });
    const root = await personIdOf('demo-root-b');
    await openExplorer(page, { focus: root, lineage: await lineageIdOf('demo-lineage-b') });
    await page.waitForTimeout(600);
    // Placed at once: React Flow's first (0, 0) and the view, not a 250 ms move across the drawing.
    const views = await page.evaluate(() => [...new Set((window as unknown as { __views: string[] }).__views)]);
    expect(views.length, views.join(' | ')).toBeLessThanOrEqual(2);
    // Full cards (zoom 0.75 or more), with the lineage's root on screen.
    await expect(nodeOf(page, root).locator('[data-person-node]')).toHaveAttribute('data-lod', 'full');
    expect(await onCanvas(page, nodeOf(page, root))).toBe(true);
    // From 640 px of canvas there is room for one of the root's own students beside it (demo-lineage-b's nearest is
    // 776 px away); a phone has room for the root alone.
    if ((await page.locator('.react-flow__pane').boundingBox())!.width >= 640) {
      const students = await page.locator(`[data-edge][data-teacher="${root}"]`).evaluateAll((paths) => paths.map((p) => p.getAttribute('data-student')!));
      const shown = [];
      for (const id of students) if (await onCanvas(page, nodeOf(page, id))) shown.push(id);
      expect(shown.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('@M05 edges are hidden while the people slide to a new scene\'s places, and not under reduced motion', async ({ page }) => {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      await page.emulateMedia({ reducedMotion });
      await openExplorer(page, await generations());
      const canvas = page.locator('.explorer-canvas');
      await canvas.evaluate((el) => {
        const marks: boolean[] = [];
        (window as unknown as { __moving: boolean[] }).__moving = marks;
        new MutationObserver(() => marks.push(el.hasAttribute('data-moving'))).observe(el, { attributes: true, attributeFilter: ['data-moving'] });
      });
      const nodes = await personNodes(page).count();
      // demo-converging has no students: one more generation of teachers brings new people.
      await page.getByRole('button', { name: 'More generations of teachers' }).click();
      await expect.poll(() => personNodes(page).count()).toBeGreaterThan(nodes);
      await expect(canvas).not.toHaveAttribute('data-moving');
      const marks = await page.evaluate(() => (window as unknown as { __moving: boolean[] }).__moving);
      expect(marks).toEqual(reducedMotion === 'reduce' ? [] : [true, false]);
      expect(await page.locator('.react-flow__edges').evaluate((el) => getComputedStyle(el).visibility)).toBe('visible');
    }
  });

  test('@M05 a disputed link to a second teacher puts the arbitration banner on the student\'s card', async ({ page }) => {
    const params = await generations();
    const student = params.focus;
    // The demo data has no such person: the next read gives one of demo-converging's two teachers a link in arbitration.
    let disputed: string | null = null;
    await page.route('**/api/rpc/lineage/ego**', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { json: { edges: { id: string; studentId: string; isDisplayPrimary: boolean; status: string }[] } };
      const second = body.json.edges.find((e) => e.studentId === student && !e.isDisplayPrimary);
      if (second) {
        second.status = 'in_arbitration';
        disputed = second.id;
      }
      await route.fulfill({ response, json: body });
    });
    await openExplorer(page, params);
    await expect(nodeOf(page, student).locator('[data-arbitration-banner]')).toHaveCount(0);
    // Fewer generations of students (demo-converging has none): the same people, read in the browser.
    const read = page.waitForResponse('**/api/rpc/lineage/ego**');
    await page.getByRole('button', { name: 'Fewer generations of students' }).click();
    await read;
    expect(disputed, 'the read has a second teacher of demo-converging').not.toBeNull();
    await expect(page.locator(`[data-edge="${disputed}"]`)).toHaveAttribute('data-stroke', 'arbitration');
    const card = nodeOf(page, student);
    await expect(card.locator('[data-person-node]')).toHaveAttribute('data-lod', 'full');
    // The status line still speaks of the display-primary teacher; the banner tells of the dispute.
    await expect(card).toContainText('Verified');
    await expect(card.locator('[data-arbitration-banner]')).toHaveText('In arbitration');
    await expect(card.locator('[data-arbitration-banner] [data-seal="scales"]')).toHaveCount(1);
    await expect(personNodes(page).locator('[data-arbitration-banner]')).toHaveCount(1);
  });
});

test.describe('M05 fixes a2', () => {
  const words: Record<string, string> = { verified: 'Verified', cross_lineage: 'Cross-lineage', historical: 'Historical', under_review: 'Under review', unconfirmed: 'Unconfirmed', arbitration: 'In arbitration' };

  /** Opens the Lineage view of lineage B and fits the whole of it: about a hundred people, as dots. */
  async function wholeLineageB(page: Parameters<typeof openExplorer>[0]) {
    await openExplorer(page, { focus: await personIdOf('demo-root-b'), lineage: await lineageIdOf('demo-lineage-b') });
    await page.getByRole('button', { name: 'Fit the whole view' }).click();
    await expect(personNodes(page).first()).toHaveAttribute('data-lod', 'dot');
  }

  test('@M05 every legend sample is drawn with the stroke of the edges it explains: the same width, dash and lines', async ({ page }) => {
    const checked = new Set<string>();
    // The person views with a teacher from another lineage and with a relationship in arbitration.
    for (const slug of ['demo-two-lineages', 'demo-arbitration']) {
      await openExplorer(page, { focus: await personIdOf(slug) });
      const drawn = await page.locator('[data-edge]').evaluateAll((paths) =>
        paths.map((p) => {
          // A stroke without its colour and its shape: width, dash, caps, and the ground between two lines.
          const stroke = (el: Element | null) =>
            el ? ['stroke-width', 'stroke-dasharray', 'stroke-linecap', 'vector-effect'].map((a) => `${a}=${el.getAttribute(a)}`).join(' ') : 'none';
          const core = document.querySelector(`[data-edge-core="${CSS.escape(p.getAttribute('data-edge')!)}"]`);
          return { kind: p.getAttribute('data-stroke')!, stroke: `${stroke(p)} | ${stroke(core)}` };
        }),
      );
      const legend = page.getByTestId('explorer-legend').getByRole('list', { name: 'Legend: link states' });
      for (const { kind, stroke } of new Map(drawn.map((d) => [d.kind, d])).values()) {
        const sample = legend.getByRole('listitem').filter({ hasText: words[kind]! }).locator('svg[data-stroke]');
        const inLegend = await sample.evaluate((svg) => {
          const stroke = (el: Element | null) =>
            el ? ['stroke-width', 'stroke-dasharray', 'stroke-linecap', 'vector-effect'].map((a) => `${a}=${el.getAttribute(a)}`).join(' ') : 'none';
          const [outer = null, core = null] = svg.querySelectorAll('path');
          return `${stroke(outer)} | ${stroke(core)}`;
        });
        expect(inLegend, `${slug}: the legend's sample for ${kind}`).toBe(stroke);
        checked.add(kind);
      }
    }
    // Among them the two states whose samples once differed from the canvas.
    expect([...checked]).toEqual(expect.arrayContaining(['cross_lineage', 'arbitration', 'verified']));
  });

  test('@M05 zoomed out to dots, every edge keeps its width and its pattern at least a pixel wide on screen', async ({ page }) => {
    await wholeLineageB(page);
    const strokes = await page.locator('[data-edge]').evaluateAll((paths) =>
      paths.map((p) => {
        const onScreen = (el: Element) => {
          const path = el as SVGPathElement;
          const scale = getComputedStyle(path).vectorEffect === 'non-scaling-stroke' ? 1 : (path.getScreenCTM()?.a ?? 1);
          return {
            width: Number(path.getAttribute('stroke-width')) * scale,
            // The dot of a dotted line is a round cap (0.1); every other dash and gap has a length.
            dash: (path.getAttribute('stroke-dasharray') ?? '').split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => n >= 1).map((n) => n * scale),
          };
        };
        const core = document.querySelector(`[data-edge-core="${CSS.escape(p.getAttribute('data-edge')!)}"]`);
        return { id: p.getAttribute('data-edge'), outer: onScreen(p), core: core ? onScreen(core) : null, zoom: (p as SVGPathElement).getScreenCTM()?.a ?? 1 };
      }),
    );
    expect(strokes.length).toBeGreaterThan(20);
    for (const s of strokes) {
      expect(s.zoom, 'the view is at the dot level').toBeLessThan(0.4);
      // One line, or each of two lines and the ground between them.
      const line = s.core ? (s.outer.width - s.core.width) / 2 : s.outer.width;
      expect(line, `${s.id}: line width on screen`).toBeGreaterThanOrEqual(1);
      if (s.core) expect(s.core.width, `${s.id}: gap between the two lines`).toBeGreaterThanOrEqual(1.5);
      for (const d of s.outer.dash) expect(d, `${s.id}: dash or gap on screen`).toBeGreaterThanOrEqual(1);
    }
  });

  test('@M05 in the Lineage view a long cross-lineage curve runs between the rows, not behind the cards, and is labelled beside its student', async ({ page }) => {
    // A phone stops at the least zoom with a part of lineage B on screen, and only what is on screen
    // is drawn; the curves are the same on every screen, so they are checked on a wide one.
    await page.setViewportSize({ width: 1440, height: 900 });
    await wholeLineageB(page);
    // The cards drawn, and the curves drawn whose student is drawn, as the label goes beside the student.
    const drawn = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll<HTMLElement>('.react-flow__node')].map((el) => {
        const [, x, y] = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform) ?? [];
        return { id: el.dataset.id!, x: Number(x), y: Number(y), width: parseFloat(el.style.width), height: parseFloat(el.style.height) };
      });
      const curves = [...document.querySelectorAll('[data-edge][data-kind="crossLineage"]')].map((p) => {
        const id = p.getAttribute('data-edge')!;
        const label = document.querySelector<HTMLElement>(`[data-edge-label="${CSS.escape(id)}"]`);
        const [, lx, ly] = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*$/.exec(label?.style.transform ?? '') ?? [];
        return { id, student: p.getAttribute('data-student')!, d: p.getAttribute('d') ?? '', label: label ? { x: Number(lx), y: Number(ly), text: label.textContent } : null };
      });
      return { nodes, curves };
    });
    const byId = new Map(drawn.nodes.map((n) => [n.id, n]));
    let long = 0;
    for (const curve of drawn.curves) {
      const student = byId.get(curve.student);
      if (!student) continue;
      const points = pathPoints(curve.d);
      const c = points.findIndex((p) => p.command === 'C');
      expect(c, curve.d).toBeGreaterThan(0);
      const [p0, p1, p2, p3] = [points[c - 1]!, points[c]!, points[c + 1]!, points[c + 2]!];
      if (Math.abs(p3.x - p0.x) <= 448) continue;
      long++;
      // The cards of the teacher's row and of the student's row (the rows of the curve's two ends), other than the two people's.
      const inRow = (n: (typeof drawn.nodes)[number], y: number) => n.y < y && y < n.y + n.height;
      const cards = drawn.nodes.filter((n) => (inRow(n, p0.y) || inRow(n, p3.y)) && n.id !== student.id && !(p0.x >= n.x && p0.x <= n.x + n.width));
      for (let i = 1; i < 400; i++) {
        const t = i / 400;
        const u = 1 - t;
        const x = u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x;
        const y = u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y;
        const behind = cards.find((n) => x > n.x && x < n.x + n.width && y > n.y && y < n.y + n.height);
        expect(behind?.id, `${curve.id} at t=${t.toFixed(3)} runs behind a card`).toBeUndefined();
      }
      // Labelled "Teacher in {lineage}" above the student's row, below the row above it, near the student.
      expect(curve.label?.text).toMatch(/^Teacher in Demo Lineage [A-C]$/);
      const studentRowTop = Math.min(...drawn.nodes.filter((n) => inRow(n, p3.y)).map((n) => n.y));
      const rowAbove = Math.max(...drawn.nodes.filter((n) => n.y + n.height <= studentRowTop).map((n) => n.y + n.height));
      expect(curve.label!.y).toBeLessThan(studentRowTop);
      expect(curve.label!.y).toBeGreaterThan(rowAbove);
      expect(Math.abs(curve.label!.x - p3.x), `${curve.id}: label beside the student`).toBeLessThan(1000);
    }
    expect(long, 'the view shows long cross-lineage curves').toBeGreaterThan(0);
  });
});

test.describe('M05 fixes C', () => {
  /** M04's test fault (src/server/faults.ts): the first lineage read, or the first profile read, of this cookie fails once. */
  const faultCookie = (kind: 'lineage-once' | 'person-once', baseURL: string | undefined) => ({
    name: 'wcr-test-fault',
    value: `${kind}:${crypto.randomUUID()}`,
    url: baseURL!,
  });
  /** An address's path and query, without the hash. */
  const addressOf = (href: string | null) => {
    const url = new URL(href!, 'http://localhost');
    return { path: url.pathname, query: Object.fromEntries(url.searchParams) };
  };

  test('@M05 a failed read of the starting points says so with Retry, never "no lineage on the record"', async ({ page, context, baseURL }) => {
    await context.addCookies([faultCookie('lineage-once', baseURL)]);
    await page.goto('/explore');
    const error = page.getByRole('alert').filter({ hasText: 'The lineages could not be loaded.' });
    await expect(error).toBeVisible();
    await expect(page.getByText('No lineage with a public root is on the record yet.')).toHaveCount(0);
    await expectNoAxeViolations(page, '/explore (the starting points failed)');
    const retry = error.getByRole('link', { name: 'Retry' });
    await expect(retry).toHaveAttribute('href', '/explore');
    await retry.click();
    await expect(page.getByRole('link', { name: /^Explore Demo Lineage [A-C]$/ })).toHaveCount(3);
    await expect(error).toHaveCount(0);
  });

  test('@M05 lineage names on the start page are names: page translation leaves them alone', async ({ page }) => {
    await page.goto('/explore');
    const items = page.getByRole('main').getByRole('listitem');
    await expect(items).toHaveCount(3);
    for (const item of await items.all()) {
      // The heading and the button of each lineage.
      await expect(item.locator('[translate="no"]').filter({ hasText: /^Demo Lineage [A-C]$/ })).toHaveCount(2);
    }
  });

  test('@M05 the list view inside the explorer has one view switch, and its pages stay in the explorer view', async ({ page }) => {
    const hub = await personIdOf('demo-hub-a');
    await page.goto(`/explore?focus=${hub}&up=1&down=2&view=list`);
    await expect(page.getByRole('heading', { level: 1, name: /^Lineage of / })).toBeVisible();
    // The explorer's own Graph / List, not a second Profile / List / Graph that leaves the view.
    await expect(page.getByRole('group', { name: 'Show as' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Views of this person' })).toHaveCount(0);
    const pages = page.getByRole('navigation', { name: 'Pages of students' });
    const next = pages.getByRole('link', { name: 'Next page' });
    expect(addressOf(await next.getAttribute('href'))).toEqual({ path: '/explore', query: { focus: hub, up: '1', down: '2', view: 'list', page: '2' } });
    await next.click();
    await expect(page).toHaveURL(/[?&]page=2(&|#|$)/);
    await expect(pages.getByText(/^Page 2 of \d+$/)).toBeVisible();
    const previous = pages.getByRole('link', { name: 'Previous page' });
    expect(addressOf(await previous.getAttribute('href'))).toEqual({ path: '/explore', query: { focus: hub, up: '1', down: '2', view: 'list' } });
    // Graph is the same view again: the generations view with its steps.
    await page.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'Graph' }).click();
    await expect(page.getByRole('group', { name: 'Teachers', exact: true })).toContainText('Teachers: 1');
    await expect(page.getByRole('group', { name: 'Students', exact: true })).toContainText('Students: 2');
  });

  test('@M05 when the profile read fails in the explorer\'s list view, Retry opens the same explorer view', async ({ page, context, baseURL }) => {
    const id = await personIdOf('demo-two-lineages');
    await context.addCookies([faultCookie('person-once', baseURL)]);
    await page.goto(`/explore?focus=${id}&up=1&down=1&view=list`);
    await expect(page.getByRole('heading', { level: 1, name: 'This profile could not be loaded' })).toBeVisible();
    await expect(page.getByText('There is no public profile with this address in the record.')).toHaveCount(0);
    const retry = page.getByRole('alert').getByRole('link', { name: 'Retry' });
    expect(addressOf(await retry.getAttribute('href'))).toEqual({ path: '/explore', query: { focus: id, up: '1', down: '1', view: 'list' } });
    await retry.click();
    await expect(page.getByRole('heading', { level: 1, name: /^Lineage of / })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Routes of descent' })).toBeVisible();
  });

  test('@M05 a wide teacher\'s "+N students" counts every public student not drawn, also those the read left out', async ({ page }) => {
    const hub = await personIdOf('demo-hub-a');
    const profile = (await (await page.request.get('/api/v1/people/demo-hub-a')).json()) as { counts: { students: number } };
    // The person view's read (plan §4.3; under 640 px the smaller one), with its default fan-out limit of 50.
    const narrow = (page.viewportSize()?.width ?? 1440) < 640;
    const view = narrow ? { up: 2, down: 1 } : { up: 16, down: 2 };
    const ego = (await (await page.request.get(`/api/v1/lineage/ego?focusId=${hub}&up=${view.up}&down=${view.down}`)).json()) as {
      edges: { teacherId: string; studentId: string }[];
    };
    const read = new Set(ego.edges.filter((e) => e.teacherId === hub).map((e) => e.studentId)).size;
    // The read returned only some of them (its fan-out limit).
    expect(read).toBeGreaterThan(12);
    expect(read).toBeLessThan(profile.counts.students);
    await openExplorer(page, { focus: hub });
    // The selection panel gives the count at every zoom; the card's chip only with full cards, and a
    // phone opens this view with compact ones (below zoom 0.75), which leave the chip out.
    await nodeOf(page, hub).click();
    const all = page.getByTestId('explorer-panel').getByRole('link', { name: /^All students in the list view \(\+\d+ not drawn\)$/ });
    await expect(all).toBeVisible();
    const more = Number((await all.textContent())!.match(/\+(\d+)/)![1]);
    // Drawn are at least the 12 of the large fan-out rule (FANOUT_SHOWN, state.ts) and at most what
    // the read returned (a student kept by a second teacher in the view is drawn too), so every
    // public student not drawn is between these; counting only the answer gives read - 12 at most.
    expect(more).toBeGreaterThanOrEqual(profile.counts.students - read);
    expect(more).toBeLessThanOrEqual(profile.counts.students - 12);
    if (!narrow) await expect(nodeOf(page, hub).locator('[data-more-chip]')).toHaveText(`+${more} students`);
  });
});

test.describe('M05 fixes B', () => {
  /** Records every layout request the page posts to the layout worker, and every answer. */
  const recordLayouts = (page: import('@playwright/test').Page) =>
    page.addInitScript(() => {
      const log: { sent: { requestId: number; warmup: boolean; nodes: number }[]; answers: { requestId: number; type: string }[]; firstResultAt?: number } = {
        sent: [],
        answers: [],
      };
      (window as unknown as { __layouts: typeof log }).__layouts = log;
      const Native = window.Worker;
      const post = Native.prototype.postMessage as (this: Worker, ...args: unknown[]) => void;
      Native.prototype.postMessage = function (this: Worker, ...args: unknown[]) {
        const m = args[0] as { type?: string; requestId: number; graph?: { dataVersion: string; nodes: unknown[] } };
        if (m.type === 'layout') log.sent.push({ requestId: m.requestId, warmup: m.graph?.dataVersion === 'warmup', nodes: m.graph?.nodes.length ?? 0 });
        post.apply(this, args);
      };
      window.Worker = class extends Native {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.addEventListener('message', (event: MessageEvent<{ requestId: number; type: string }>) => {
            log.answers.push({ requestId: event.data.requestId, type: event.data.type });
            const warmup = log.sent.find((s) => s.requestId === event.data.requestId)?.warmup ?? true;
            if (event.data.type === 'result' && !warmup) log.firstResultAt ??= Date.now();
          });
        }
      };
    });
  const layouts = (page: import('@playwright/test').Page) =>
    page.evaluate(() => (window as unknown as { __layouts: { sent: { requestId: number; warmup: boolean; nodes: number }[]; answers: { requestId: number; type: string }[] } }).__layouts);

  test('@M05 React Flow loads while the first layout runs, and the canvas is never empty in between', async ({ page }) => {
    const id = await personIdOf('demo-two-lineages');
    await recordLayouts(page);
    // Everything the page loads later than its HTML (React Flow's chunk, the worker) comes 1 s late.
    const html = await (await page.request.get(`/explore?focus=${id}`)).text();
    const late: { url: string; at: number }[] = [];
    await page.route('**/_next/static/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!html.includes(path)) {
        late.push({ url: path, at: Date.now() });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      await route.continue();
    });
    // Records whether the canvas area ever holds neither the skeleton nor the drawing once the skeleton is up.
    await page.addInitScript(() => {
      const w = window as unknown as { __emptyCanvas?: boolean; __area?: Element | null };
      new MutationObserver(() => {
        w.__area ??= document.querySelector('[data-testid="explorer-skeleton"]')?.parentElement ?? null;
        if (w.__area && !w.__area.querySelector('[data-testid="explorer-skeleton"], .react-flow')) w.__emptyCanvas = true;
      }).observe(document, { childList: true, subtree: true });
    });
    await openExplorer(page, { focus: id });
    expect(await page.evaluate(() => (window as unknown as { __emptyCanvas?: boolean }).__emptyCanvas ?? false)).toBe(false);
    const firstResult = await page.evaluate(() => (window as unknown as { __layouts: { firstResultAt?: number } }).__layouts.firstResultAt);
    expect(firstResult).toBeDefined();
    // Every chunk the canvas needed was asked for before the worker's first real layout came back.
    expect(late.length).toBeGreaterThan(0);
    for (const chunk of late.filter((c) => c.url.endsWith('.js') || c.url.endsWith('.css'))) expect(chunk.at, chunk.url).toBeLessThan(firstResult!);
  });

  test('@M05 after the focus changes in the graph, List never shows the list of the person before', async ({ page }) => {
    const id = await personIdOf('demo-two-lineages');
    await page.goto(`/explore?focus=${id}&view=list`);
    const heading = page.getByRole('heading', { level: 1, name: /Lineage of/ });
    await expect(heading).toBeVisible();
    const before = (await heading.textContent())!.trim();
    const toggle = page.getByRole('group', { name: 'Show as' });
    await toggle.getByRole('button', { name: 'Graph' }).click();
    await expect(personNodes(page).first()).toBeVisible({ timeout: 30_000 });
    // Centre on a teacher (a change of focus in the browser, no server render).
    const teacher = (await edgesInto(page, id).first().getAttribute('data-teacher'))!;
    await nodeOf(page, teacher).click();
    await page.getByTestId('explorer-panel').getByRole('button', { name: 'Center on this person' }).click();
    await expect(page).toHaveURL(new RegExp(`focus=${teacher}`));
    await expect(page.getByTestId('explorer-relayout')).toHaveCount(0);
    // The server's list of the new person comes 1.5 s late; meanwhile the old one must never show.
    await page.route(
      (url) => url.pathname === '/explore',
      async (route) => {
        if (route.request().headers()['rsc']) await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      },
    );
    await page.evaluate((old) => {
      const w = window as unknown as { __oldList?: boolean };
      const check = () => {
        for (const h of document.querySelectorAll('h1')) if (h.textContent?.trim() === old && h.checkVisibility()) w.__oldList = true;
      };
      new MutationObserver(check).observe(document, { childList: true, subtree: true, attributes: true });
      const frame = () => {
        check();
        requestAnimationFrame(frame);
      };
      frame();
    }, before);
    await toggle.getByRole('button', { name: 'List' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Loading the list…' })).toBeVisible();
    await expect(heading).toBeVisible({ timeout: 15_000 });
    expect((await heading.textContent())!.trim()).not.toBe(before);
    expect(await page.evaluate(() => (window as unknown as { __oldList?: boolean }).__oldList ?? false)).toBe(false);
  });

  test('@M05 the legend names the dotted state as the cards do: "Pending" for the participant of a request', async ({ page }) => {
    // Imported here, so this block leaves the file's header to the other M05 tests.
    const { clientAddress, signInAs } = await import('./helpers/auth');
    await signInAs(page, 'demo-pending', { address: clientAddress() });
    const id = await personIdOf('demo-pending');
    await openExplorer(page, { focus: id });
    await expect(edgesInto(page, id).and(page.locator('[data-stroke="unconfirmed"]'))).toHaveCount(1);
    await expect(nodeOf(page, id)).toContainText('Pending');
    const legend = page.getByTestId('explorer-legend').getByRole('list', { name: 'Legend: link states' });
    await expect(legend.getByRole('listitem').filter({ hasText: 'Pending' })).toHaveCount(1);
    await expect(legend).not.toContainText('Unconfirmed');
  });

  test('@M05 the steppers read "Teachers: 1", tabular figures on the number only', async ({ page }) => {
    await openExplorer(page, { focus: await personIdOf('demo-two-lineages'), up: 1, down: 1 });
    for (const name of ['Teachers', 'Students']) {
      const label = page.getByRole('group', { name }).locator('span', { hasText: `${name}:` });
      await expect(label).toHaveText(`${name}: 1`);
      expect(await label.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toBe('normal');
      expect(await label.locator('span').evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toBe('tabular-nums');
    }
  });

  test.describe('on a phone in landscape', () => {
    test.use({ viewport: { width: 852, height: 393 }, isMobile: true, hasTouch: true });

    test('@M05 at 852x393 (the rail layout) the bars, the legend and the zoom buttons stay inside the side and bottom safe areas', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'the safe-area insets are emulated through the Chrome DevTools protocol');
      // An iPhone in landscape: the sensor housing on one side (59 px each side) and the home indicator (21 px).
      const insets = { top: 0, left: 59, bottom: 21, right: 59 };
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
      const id = await personIdOf('demo-two-lineages');
      await openExplorer(page, { focus: id });
      await nodeOf(page, id).click();
      await expect(page.getByTestId('explorer-panel')).toBeVisible();
      const right = 852 - insets.right;
      const bottom = 393 - insets.bottom;
      for (const control of [
        page.getByRole('group', { name: 'Show as' }),
        page.getByRole('group', { name: 'View' }),
        page.locator('label').filter({ hasText: 'Show ended training' }),
        page.getByTestId('explorer-legend'),
        page.getByRole('button', { name: 'Zoom in' }),
        page.getByRole('button', { name: 'Fit the whole view' }),
        page.getByTestId('explorer-panel'),
      ]) {
        const box = (await control.boundingBox())!;
        const name = await control.evaluate((el) => el.getAttribute('aria-label') ?? el.getAttribute('data-testid') ?? el.textContent?.trim().slice(0, 30));
        expect(box.x + box.width, `${name}: right edge`).toBeLessThanOrEqual(right);
        expect(box.y + box.height, `${name}: bottom edge`).toBeLessThanOrEqual(bottom);
      }
    });
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('@M05 a phone lays out only its own smaller person view, with the worker warmed meanwhile, and keeps it when turned', async ({ page }) => {
      await recordLayouts(page);
      // A slow network: the phone's own read (up=2, down=1) arrives well after the page.
      const reads: string[] = [];
      await page.route('**/api/rpc/lineage/**', async (route) => {
        reads.push(route.request().url());
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      });
      await openExplorer(page, { focus: await personIdOf('demo-two-lineages') });
      const log = await layouts(page);
      // The desktop read that came with the page (up=16, down=2) was never laid out or drawn.
      expect(log.sent.filter((s) => !s.warmup), JSON.stringify(log.sent)).toHaveLength(1);
      expect(reads).toHaveLength(1);
      // The worker had time to warm up while the phone's view loaded: the warm-up was laid out.
      const warmup = log.sent.find((s) => s.warmup)!;
      expect(log.answers.find((a) => a.requestId === warmup.requestId)?.type).toBe('result');
      // Turned to landscape: the view keeps the read it started with (plan §4.3: it *starts* small).
      const drawn = await personNodes(page).count();
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForTimeout(800);
      expect(reads).toHaveLength(1);
      expect((await layouts(page)).sent.filter((s) => !s.warmup)).toHaveLength(1);
      expect(await personNodes(page).count()).toBe(drawn);
    });

    test('@M05 with a person selected on a phone, the legend and the zoom buttons stay in view and uncovered', async ({ page }) => {
      const id = await personIdOf('demo-two-lineages');
      await openExplorer(page, { focus: id });
      await nodeOf(page, id).click();
      const panel = page.getByTestId('explorer-panel');
      await expect(panel).toBeVisible();
      /** The element itself (or something inside it) is what a tap at its centre reaches. */
      const uncovered = (locator: import('@playwright/test').Locator) =>
        locator.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return hit !== null && el.contains(hit);
        });
      const legend = page.getByTestId('explorer-legend').getByRole('list', { name: 'Legend: link states' });
      for (const control of [
        legend,
        ...(await legend.getByRole('listitem').all()),
        page.getByRole('button', { name: 'Zoom in' }),
        page.getByRole('button', { name: 'Zoom out' }),
        page.getByRole('button', { name: 'Fit the whole view' }),
      ]) {
        await expect(control).toBeVisible();
        expect(await uncovered(control), await control.evaluate((el) => el.outerHTML.slice(0, 80))).toBe(true);
      }
      // The panel lies below the graph, above the tab bar: it covers nothing of the canvas.
      const canvas = (await page.locator('.react-flow').boundingBox())!;
      const sheet = (await panel.boundingBox())!;
      const bar = (await page.locator('[data-tab-bar]').boundingBox())!;
      expect(sheet.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1);
      expect(sheet.y + sheet.height).toBeLessThanOrEqual(bar.y + 1);
      // Its standalone link and buttons are full touch targets.
      for (const target of await panel.locator('a, button').all()) expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    });

    test('@M05 the panel link to the students not drawn is a full touch target', async ({ page }) => {
      const hub = await personIdOf('demo-hub-a');
      await openExplorer(page, { focus: hub, up: 0, down: 1 });
      await nodeOf(page, hub).click();
      const link = page.getByTestId('explorer-panel').getByRole('link', { name: /All students in the list view \(\+\d+ not drawn\)/ });
      await expect(link).toBeVisible();
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    });
  });
});
