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
