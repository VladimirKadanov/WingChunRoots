// Measurements for the M05 explorer tests (e2e/m05-explorer.spec.ts): which scripts a page and its
// workers fetched and whether ELK is among them (plan §4.11), the scene the layout worker answered
// with (plan §4.6), emulated safe-area insets (plan §5.8 (b)) and INP (plan §5.8 (c)).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { expect, type Page, type Worker } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../../src/server/db';
import { loadTestEnv } from './auth';
import { nodeOf } from './explorer';

/** The display name of a demo person, as the public pages show it. */
export async function personNameOf(slug: string): Promise<string> {
  loadTestEnv();
  const rows = await getDb().execute<{ name: string }>(
    sql`SELECT vp.display_name AS name FROM v_public_person vp JOIN person p ON p.id = vp.id WHERE p.slug = ${slug}`,
  );
  expect(rows.rows, slug).toHaveLength(1);
  return rows.rows[0]!.name;
}

// --- The view's moves ----------------------------------------------------------------------------------

/**
 * The view's pan and zoom (React Flow's viewport transform) once it has stopped moving: the same
 * in every painted frame for 300 ms, and in at least 10 frames (a zoom button moves it for 200 ms,
 * a new scene for 250 ms). Counted in the page's animation frames, not in time alone: the view
 * moves only when the browser paints, and WebKit can paint no frame for a few hundred
 * milliseconds on a busy machine, which two reads 150 ms apart took for a view at rest in the
 * middle of a zoom.
 */
export async function settledView(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  await page.locator('.react-flow__viewport').waitFor();
  return page.evaluate(
    () =>
      new Promise<{ x: number; y: number; zoom: number }>((resolve, reject) => {
        const read = () => {
          const el = document.querySelector<HTMLElement>('.react-flow__viewport');
          const m = el ? /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(el.style.transform) : null;
          return m ? { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) } : null;
        };
        let last = JSON.stringify(read());
        let since = performance.now();
        let frames = 0;
        let done = false;
        const deadline = window.setTimeout(() => {
          done = true;
          reject(new Error('The view never stopped moving.'));
        }, 6000);
        const frame = (now: number) => {
          if (done) return;
          const view = read();
          const key = JSON.stringify(view);
          if (!view || key !== last) {
            last = key;
            since = now;
            frames = 0;
          } else frames += 1;
          if (view && frames >= 10 && now - since >= 300) {
            window.clearTimeout(deadline);
            resolve(view);
          } else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
  );
}

// --- The generation label ---------------------------------------------------------------------------

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Brings a node to a full card with the explorer's own Zoom in button, as a person does, when the
 * view opened at a lower level of detail. Only a full card, from zoom 0.75, shows the generation
 * line and the chips (plan §4.8); a phone whose fitted zoom is lower starts with compact chips
 * (owner question 3 of docs/plan/questions/M05.md, the shipped default: 0.70 at the 393×659 of
 * the iPhone 15 profile, and lower where the view is fitted clear of the legend, ADR 0009 item 5).
 * Does nothing where the card is full already.
 */
export async function zoomToFullCard(page: Page, id: string): Promise<void> {
  const node = nodeOf(page, id);
  const lod = () => node.locator('[data-person-node]').getAttribute('data-lod');
  for (let step = 1; (await lod()) !== 'full'; step++) {
    expect(step, 'Zoom in steps to a full card').toBeLessThanOrEqual(3);
    const transform = () => page.locator('.react-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform);
    const before = await transform();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    // The zoom animates (the motion tokens): wait until the view has moved and come to rest.
    await expect.poll(transform, { message: 'the view has moved' }).not.toBe(before);
    await settledView(page);
    await expect(node, 'the card stays on screen while zooming in').toBeInViewport();
  }
}

/**
 * Expects a node's generation label (plan §4.4) to read `label`, as every reader gets it: in the
 * node's accessible name, at any level of detail, and on its card, which shows it as a full card
 * (zoomToFullCard).
 */
export async function expectGenerationLabel(page: Page, id: string, label: string | RegExp): Promise<void> {
  const node = nodeOf(page, id);
  const words = typeof label === 'string' ? escape(label) : label.source;
  await expect(node).toHaveAttribute('aria-label', new RegExp(`, ${words}`));
  await zoomToFullCard(page, id);
  await expect(node.locator('[data-person-node][data-lod="full"]')).toContainText(label);
}

/** The accessible names of the nodes drawn. */
export function nodeNames(page: Page): Promise<string[]> {
  return page.locator('.react-flow__node').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
}

// --- Scripts and ELK -------------------------------------------------------------------------------

/** A string only ELK's code carries (elkjs is compiled from the Eclipse Layout Kernel, org.eclipse.elk). */
export const ELK_SIGNATURE = 'org.eclipse.elk';

const isScript = (url: string) => /\.m?js$/.test(new URL(url).pathname);
/** The address without its query and hash: the bundler's worker entry carries its chunk list in the hash. */
const bare = (url: string) => {
  const u = new URL(url);
  return `${u.origin}${u.pathname}`;
};

/** Every script the browser fetched for this page from now on, its workers' included where the browser reports them. */
export function recordScripts(page: Page): Set<string> {
  const urls = new Set<string>();
  page.on('response', (response) => {
    if (isScript(response.url())) urls.add(bare(response.url()));
  });
  return urls;
}

/** The scripts the page's own thread or a worker loaded, from its Resource Timing entries. */
export async function loadedScripts(target: Page | Worker): Promise<string[]> {
  const entries = () => performance.getEntriesByType('resource').map((entry) => entry.name);
  const names: string[] = 'goto' in target ? await target.evaluate(entries) : await target.evaluate(entries);
  return [...new Set(names.filter(isScript).map(bare))];
}

/**
 * The scripts a worker loads: its Resource Timing entries and the chunks its address names (a
 * Turbopack worker entry gets its chunk list in the hash of its URL, for a browser that keeps no
 * timing entries in workers).
 */
export async function workerScripts(worker: Worker): Promise<string[]> {
  const named = [...decodeURIComponent(worker.url()).matchAll(/\/_next\/static\/[\w.~/-]+?\.js(?![\w.~/-])/g)].map((m) => new URL(m[0], worker.url()).href);
  return [...new Set([...(await loadedScripts(worker)), ...named])];
}

const carriesElk = new Map<string, Promise<boolean>>();

/** The scripts among `urls` whose code carries ELK (each is read once per test run). */
export async function elkScripts(page: Page, urls: Iterable<string>): Promise<string[]> {
  const found: string[] = [];
  for (const url of new Set(urls)) {
    if (!carriesElk.has(url)) carriesElk.set(url, page.request.get(url).then(async (r) => r.ok() && (await r.text()).includes(ELK_SIGNATURE)));
    if (await carriesElk.get(url)) found.push(url);
  }
  return found.sort();
}

// --- The layout worker's scenes ----------------------------------------------------------------------

export interface CapturedScene {
  focusId: string | null;
  nodes: { id: string; rank: number; center: { x: number; y: number } }[];
  edges: { id: string; teacherId: string; studentId: string; lineageId: string; kind: string }[];
}

/** Records every scene the layout worker answers with (call before the page loads). */
export async function captureScenes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __scenes: unknown[] };
    w.__scenes = [];
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (event: MessageEvent<{ type?: string; scene?: unknown }>) => {
          if (event.data?.type === 'result') w.__scenes.push(event.data.scene);
        });
      }
    };
  });
}

/** The last scene laid out for `focusId` (the warm-up's is never one of them). */
export async function sceneOf(page: Page, focusId: string): Promise<CapturedScene> {
  const scenes = await page.evaluate(() => (window as unknown as { __scenes: unknown[] }).__scenes as CapturedScene[]);
  const scene = scenes.filter((s) => s.focusId === focusId).at(-1);
  expect(scene, `a scene laid out for ${focusId}`).toBeTruthy();
  return scene!;
}

// --- Safe areas ----------------------------------------------------------------------------------

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Emulates a notch and a home indicator (Chromium only, through the DevTools protocol); the insets now in force. */
export async function emulateSafeAreaInsets(page: Page, browserName: string, insets: Insets): Promise<Insets> {
  if (browserName !== 'chromium') return { top: 0, right: 0, bottom: 0, left: 0 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
  return insets;
}

// --- INP ---------------------------------------------------------------------------------------------

/**
 * The browser build of web-vitals (plan §5.8 (c): INP is measured with the web-vitals library),
 * or null while the package is not installed. The UMD build defines `webVitals` on the page.
 */
export function webVitalsScript(): string | null {
  try {
    return createRequire(path.join(process.cwd(), 'package.json')).resolve('web-vitals');
  } catch {
    return null;
  }
}

interface InpProbe {
  /** The browser has the Event Timing API (Chromium; WebKit has not), which INP is measured with. */
  eventTiming: boolean;
  /** web-vitals' INP (onINP with reportAllChanges), once it has one. */
  vitals: number | null;
  /** Durations of Event Timing entries of interactions (what INP is made of), 16 ms or more. */
  events: number[];
  /** From the pointer going down to the first frame after the click, in every browser. */
  frames: number[];
}

/**
 * Installs the INP measurements in every document the page loads (call before it loads): web-vitals'
 * onINP when the package is installed, the Event Timing entries of interactions, and a frame
 * measure for a browser without Event Timing (WebKit).
 */
export async function installInpProbes(page: Page): Promise<void> {
  const vitals = webVitalsScript();
  if (vitals) await page.addInitScript({ content: readFileSync(vitals, 'utf8') });
  await page.addInitScript(() => {
    const probe: InpProbe = { eventTiming: PerformanceObserver.supportedEntryTypes.includes('event'), vitals: null, events: [], frames: [] };
    (window as unknown as { __inp: InpProbe }).__inp = probe;
    type OnInp = (report: (metric: { value: number }) => void, options: { reportAllChanges: boolean; durationThreshold: number }) => void;
    const webVitals = (window as unknown as { webVitals?: { onINP: OnInp } }).webVitals;
    webVitals?.onINP((metric) => (probe.vitals = metric.value), { reportAllChanges: true, durationThreshold: 16 });
    if (probe.eventTiming) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEventTiming & { interactionId?: number })[]) {
          if (entry.interactionId) probe.events.push(entry.duration);
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
    }
    let down = 0;
    addEventListener('pointerdown', (e) => (down = e.timeStamp), { capture: true });
    addEventListener('click', () => {
      requestAnimationFrame(() => setTimeout(() => probe.frames.push(performance.now() - down)));
    });
  });
}

export interface InpResult {
  /** The worst latency of the selections, in ms. */
  inp: number;
  method: 'web-vitals onINP' | 'Event Timing' | 'pointerdown to next frame';
  /** The other measures, for the record: the worst Event Timing interaction and the worst frame measure (null without one). */
  eventTiming: number | null;
  frame: number;
}

/**
 * Selects nodes one after another at 4x CPU slowdown (Chromium, through the DevTools protocol) and
 * returns the INP of those selections: web-vitals' where it is installed and the browser reports
 * INP; else the worst Event Timing interaction; with neither (WebKit, or every interaction under
 * 16 ms), the frame measure, which also counts its own timer and so errs on the slow side.
 * `next` names the node to select next, or null when there is none.
 */
export async function selectionInp(page: Page, browserName: string, count: number, next: (selected: string[]) => Promise<string | null>): Promise<InpResult> {
  const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
  await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const selected: string[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const id = await next(selected);
      expect(id, `a node to select (${i + 1} of ${count})`).toBeTruthy();
      await page.locator(`.react-flow__node[data-id="${id}"]`).click();
      await expect(page.getByTestId('explorer-panel')).toBeVisible();
      selected.push(id!);
    }
    await page.waitForTimeout(500);
  } finally {
    await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  const read = () => page.evaluate(() => (window as unknown as { __inp: InpProbe }).__inp);
  let probe = await read();
  expect(probe.frames.length, 'every selection was measured').toBeGreaterThanOrEqual(count);
  // web-vitals reports from its own observer once it has processed the entries (with no interaction
  // of 16 ms or more, the first input's delay): wait for it wherever it can report.
  if (webVitalsScript() && probe.eventTiming) {
    await expect.poll(async () => (probe = await read()).vitals, 'web-vitals reported INP').not.toBeNull();
  }
  const others = { eventTiming: probe.events.length > 0 ? Math.max(...probe.events) : null, frame: Math.max(...probe.frames) };
  if (probe.vitals !== null) return { inp: probe.vitals, method: 'web-vitals onINP', ...others };
  if (others.eventTiming !== null) return { inp: others.eventTiming, method: 'Event Timing', ...others };
  return { inp: others.frame, method: 'pointerdown to next frame', ...others };
}

/** A node whose centre is on screen and not covered (by the panel, the legend or the controls), other than `skip`. */
export function uncoveredNode(page: Page, skip: readonly string[]): Promise<string | null> {
  return page.evaluate((skipped) => {
    for (const el of document.querySelectorAll<HTMLElement>('.react-flow__node')) {
      const id = el.dataset.id;
      // A person's node only (M06): the summary node "and N more" is not a person to select.
      if (!id || skipped.includes(id) || !el.querySelector('[data-person-node]')) continue;
      const box = el.getBoundingClientRect();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      if (box.width === 0 || x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && el.contains(hit)) return id;
    }
    return null;
  }, skip);
}
