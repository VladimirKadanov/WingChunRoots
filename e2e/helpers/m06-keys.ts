// Keyboard steps for the M06 keyboard tests (milestone M06, package A): the demo people they use,
// read from the public API (never numbers or names written into the test), the view's transform,
// and INP of key presses (plan §5.8 (c)), measured as the M05 selection INP is (installInpProbes:
// web-vitals' onINP, else the Event Timing entries) with a key-press frame measure for a browser
// without Event Timing (WebKit).

import { expect, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { chainEdge } from '../../src/components/lineage/generation';
import { isHistoricalRelation, relationStatus } from '../../src/components/lineage/status';
import { PERSON_DEFAULTS } from '../../src/components/lineage/explorer/state';
import { getDb } from '../../src/server/db';
import type { LineageGraphDto } from '../../src/server/dto/public';
import { loadTestEnv } from './auth';
import { webVitalsScript } from './explorer-checks';

/** The display name of a demo person by id, as the public pages show it. */
export async function personNameById(id: string): Promise<string> {
  loadTestEnv();
  const rows = await getDb().execute<{ name: string }>(sql`SELECT display_name AS name FROM v_public_person WHERE id = ${id}::uuid`);
  expect(rows.rows, id).toHaveLength(1);
  return rows.rows[0]!.name;
}

/** The public ego read of the explorer (GET /api/v1/lineage/ego). */
export async function egoOf(page: Page, focusId: string, up: number, down: number, fanoutLimit = 100): Promise<LineageGraphDto> {
  const response = await page.request.get(`/api/v1/lineage/ego?focusId=${focusId}&up=${up}&down=${down}&fanoutLimit=${fanoutLimit}`);
  expect(response.status(), `GET /api/v1/lineage/ego for ${focusId}`).toBe(200);
  return (await response.json()) as LineageGraphDto;
}

/**
 * A student of `teacherId` whose one teacher in the public record is that teacher, along a line
 * drawn by default (not ended training): in the person view of that student, ↑ has exactly one
 * teacher to go to.
 */
export async function soleTeacherStudent(page: Page, teacherId: string): Promise<string> {
  const students = await egoOf(page, teacherId, 0, 1);
  const candidates = students.edges.filter((e) => e.teacherId === teacherId && !isHistoricalRelation(e.periods)).map((e) => e.studentId);
  for (const id of candidates.slice(0, 40)) {
    const up = await egoOf(page, id, 1, 0);
    const teachers = new Set(up.edges.filter((e) => e.studentId === id).map((e) => e.teacherId));
    if (teachers.size === 1 && teachers.has(teacherId) && (up.hiddenCounts[id]?.teachers ?? 0) === 0) return id;
  }
  throw new Error('No student with exactly one teacher among the demo data.');
}

/**
 * The status a person's card shows in the desktop person view of `focusId` (plan §4.6: the line
 * drawn into them, display-primary first, as explorer.tsx flowBase reads it), or null for a
 * person with no line drawn into them.
 */
export async function statusInPersonView(page: Page, focusId: string, personId: string): Promise<string | null> {
  const view = await egoOf(page, focusId, PERSON_DEFAULTS.up, PERSON_DEFAULTS.down, 50);
  const edge = chainEdge(view.edges.filter((e) => e.studentId === personId && !isHistoricalRelation(e.periods)));
  return edge ? relationStatus(edge.status).label : null;
}

/** The ids of the nodes React Flow draws now (onlyRenderVisibleElements: those on the pane). */
export function drawnNodeIds(page: Page): Promise<string[]> {
  return page.locator('.react-flow__node').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.id ?? ''));
}

/** React Flow's viewport transform (the view's pan and zoom), as a string to compare. */
export function viewTransform(page: Page): Promise<string> {
  return page.locator('.react-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform);
}

/**
 * Installs the key-press frame measure in every document the page loads (call before it loads):
 * from a key going down to the first frame after it, in every browser (WebKit has no Event Timing).
 */
export async function installKeyProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const frames: number[] = [];
    (window as unknown as { __keyFrames: number[] }).__keyFrames = frames;
    addEventListener(
      'keydown',
      (event) => {
        const start = event.timeStamp;
        requestAnimationFrame(() => setTimeout(() => frames.push(performance.now() - start)));
      },
      { capture: true },
    );
  });
}

interface InpProbe {
  eventTiming: boolean;
  vitals: number | null;
  events: number[];
}

export interface KeyInpResult {
  /** The worst latency of the key presses, in ms. */
  inp: number;
  method: 'web-vitals onINP' | 'Event Timing' | 'keydown to next frame';
  /** The other measures, for the record: the worst Event Timing interaction and the worst frame measure (null without one). */
  eventTiming: number | null;
  frame: number;
}

/**
 * Presses `key` `count` times in the graph at 4x CPU slowdown (Chromium, through the DevTools
 * protocol), each once the view has come to rest (`settle`), and returns the INP of those presses:
 * web-vitals' where it is installed and the browser reports INP, else the worst Event Timing
 * interaction, else (WebKit) the key-press frame measure, which also counts its own timer and so
 * errs on the slow side. Needs installInpProbes and installKeyProbe before the page loads.
 */
export async function keyInp(page: Page, browserName: string, key: string, count: number, settle: () => Promise<unknown>): Promise<KeyInpResult> {
  const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
  const pressedBefore = await page.evaluate(() => (window as unknown as { __keyFrames: number[] }).__keyFrames.length);
  await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  try {
    for (let i = 0; i < count; i++) {
      await page.keyboard.press(key);
      await settle();
    }
    await page.waitForTimeout(500);
  } finally {
    await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  const read = () =>
    page.evaluate(() => ({
      probe: (window as unknown as { __inp: InpProbe }).__inp,
      frames: (window as unknown as { __keyFrames: number[] }).__keyFrames,
    }));
  const first = await read();
  let probe = first.probe;
  // The presses of this measure only (not the Tab presses into the graph before it).
  const measured = first.frames.slice(pressedBefore);
  expect(measured.length, 'every key press was measured').toBeGreaterThanOrEqual(count);
  if (webVitalsScript() && probe.eventTiming) {
    await expect.poll(async () => (probe = (await read()).probe).vitals, 'web-vitals reported INP').not.toBeNull();
  }
  const others = { eventTiming: probe.events.length > 0 ? Math.max(...probe.events) : null, frame: Math.max(...measured) };
  if (probe.vitals !== null) return { inp: probe.vitals, method: 'web-vitals onINP', ...others };
  if (others.eventTiming !== null) return { inp: others.eventTiming, method: 'Event Timing', ...others };
  return { inp: others.frame, method: 'keydown to next frame', ...others };
}
