// Steps of the M06 touch and motion tests (milestone M06, package D): the explorer's controls on a
// phone (44x44 CSS px, inside the canvas frame or the shell, uncovered), the phone's bottom sheet
// at its snap points, and the motion of the people and the view frame by frame.

import { expect, type Locator, type Page } from '@playwright/test';

/** The phones of the touch tests: a Pixel 7's and an iPhone 15's pages (the mobile projects) and the 390x844 of the plan's screenshots. */
export const PHONES = [
  { width: 390, height: 844 },
  { width: 393, height: 659 },
  { width: 412, height: 839 },
] as const;

/** The least size of a touch target on a phone, in CSS px (plan §5.8). */
export const TOUCH_TARGET = 44;

/**
 * What is wrong with the explorer's controls as they are on screen, one line each (empty: nothing).
 * A control is every `button, a[href], input, select, summary, [role=button]` that is shown and
 * at least partly on screen, outside the graph's nodes (people and the summary node scale with
 * the zoom: graph content, DEFAULT, milestone M06 (e) 7) and outside inert content (a sheet's body
 * at its peek, which the keyboard and the pointer never reach). Each one is:
 * - at least TOUCH_TARGET x TOUCH_TARGET px; a checkbox or a radio button is measured by its label,
 *   which takes its taps (the toolbar's "Show ended training");
 * - whole: not cut by the edge of the window or of what clips it (the canvas frame, a sheet clipped
 *   at the tab bar), unless it lies in a list that scrolls, which brings it in;
 * - uncovered: a tap at the centre of its part on screen reaches it.
 * The skip link waits above the top edge and is no control on screen.
 */
export function controlProblems(page: Page): Promise<string[]> {
  return page.evaluate((least) => {
    const problems: string[] = [];
    const scrolls = (el: Element) => /(auto|scroll)/.test(`${getComputedStyle(el).overflowX} ${getComputedStyle(el).overflowY}`);
    for (const el of document.querySelectorAll<HTMLElement>('button, a[href], input, select, summary, [role="button"]')) {
      if (el.closest('.react-flow__node') || el.closest('[inert]')) continue;
      if (!el.checkVisibility({ checkVisibilityCSS: true })) continue;
      const label = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? el.closest('label') : null;
      const target: HTMLElement = label ?? el;
      const box = target.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // The part on screen: the box cut by every ancestor that clips its overflow, and by the window.
      let left = Math.max(box.left, 0);
      let top = Math.max(box.top, 0);
      let right = Math.min(box.right, innerWidth);
      let bottom = Math.min(box.bottom, innerHeight);
      let inScroller = false;
      for (let a = target.parentElement; a; a = a.parentElement) {
        const style = getComputedStyle(a);
        if (!/(hidden|clip|auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
        if (scrolls(a)) inScroller = true;
        const clip = a.getBoundingClientRect();
        left = Math.max(left, clip.left);
        top = Math.max(top, clip.top);
        right = Math.min(right, clip.right);
        bottom = Math.min(bottom, clip.bottom);
      }
      // Wholly off screen or clipped away: not on screen (the skip link above the top edge).
      if (right - left < 1 || bottom - top < 1) continue;
      const name = `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? target.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 48)}"`;
      const at = `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`;
      if (box.width < least - 0.5 || box.height < least - 0.5) problems.push(`${name} is ${at}, under ${least}x${least}`);
      const cut = left > box.left + 0.5 || top > box.top + 0.5 || right < box.right - 0.5 || bottom < box.bottom - 0.5;
      if (cut && !inScroller) problems.push(`${name} at ${at} is cut off: ${Math.round(left)},${Math.round(top)} to ${Math.round(right)},${Math.round(bottom)} shows`);
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      if (!hit || !(target.contains(hit) || el.contains(hit))) {
        const over = hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}.${[...hit.classList].slice(0, 3).join('.')}` : 'nothing';
        problems.push(`${name} at ${at} is covered by ${over}`);
      }
    }
    return problems;
  }, TOUCH_TARGET);
}

/** Whether the selection's panel is a bottom sheet (a Base UI Drawer: a dialog), not a panel in the page. */
export function isSheet(panel: Locator): Promise<boolean> {
  return panel.evaluate((el) => !!el.closest('[role="dialog"]'));
}

/** The top edge of a sheet once its snap transition has ended (as e2e/ui.spec.ts reads it). */
export async function settledTop(sheet: Locator): Promise<number> {
  let previous = Number.NaN;
  for (let i = 0; i < 40; i++) {
    const top = (await sheet.boundingBox())?.y ?? Number.NaN;
    if (Math.abs(top - previous) < 0.5) return top;
    previous = top;
    await sheet.page().waitForTimeout(60);
  }
  return previous;
}

/**
 * Drags a sheet at its peek by its handle up to half height (half of the room above the tab bar),
 * slowly and still for a moment before letting go, as e2e/ui.spec.ts does: a flick would carry it
 * on to full height. Returns the sheet's top edge at rest.
 */
export async function dragSheetToHalf(page: Page, sheet: Locator): Promise<number> {
  const barTop = (await page.locator('[data-tab-bar]').boundingBox())!.y;
  const peekTop = await settledTop(sheet);
  const half = barTop / 2;
  const box = (await sheet.boundingBox())!;
  const x = box.x + box.width / 2;
  // The handle, above the title and the buttons.
  const from = peekTop + 8;
  await page.mouse.move(x, from);
  await page.mouse.down();
  for (let step = 1; step <= 20; step++) {
    await page.mouse.move(x, from - ((peekTop - half) * step) / 20);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(250);
  await page.mouse.up();
  const top = await settledTop(sheet);
  expect(top, 'the sheet rests at half height').toBeGreaterThan(half - 24);
  expect(top, 'the sheet rests at half height').toBeLessThan(half + 24);
  return top;
}

/** What the motion probe saw: frames sampled, the view's transforms in turn, and every person's places in turn. */
export interface Motion {
  frames: number;
  /** The view's transforms, each different from the one before. */
  views: string[];
  /** By node: its places on screen as drawn (the computed transform's translation), each different from the one before. */
  places: Record<string, string[]>;
  /** Frames in which a node was drawn somewhere other than its place (the computed transform is not the one React Flow set: a transition between them). */
  between: string[];
}

/**
 * Starts sampling, in every painted frame, the view's transform and every node's transform as the
 * browser draws it (computed, so a CSS transition shows its steps) against the one React Flow set
 * (inline), until stopMotion.
 */
export async function startMotion(page: Page): Promise<void> {
  await page.evaluate(() => {
    const motion = { frames: 0, views: [] as string[], places: {} as Record<string, string[]>, between: [] as string[], running: true };
    (window as unknown as { __motion: typeof motion }).__motion = motion;
    const translation = (transform: string): [number, number] | null => {
      const m = /^matrix\(([^)]+)\)$/.exec(transform);
      if (m) {
        const v = m[1]!.split(',').map(Number);
        return [v[4]!, v[5]!];
      }
      const t = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(transform);
      return t ? [Number(t[1]), Number(t[2])] : transform === 'none' ? [0, 0] : null;
    };
    const push = (list: string[], value: string) => {
      if (list[list.length - 1] !== value) list.push(value);
    };
    const frame = () => {
      if (!motion.running) return;
      motion.frames += 1;
      const view = document.querySelector<HTMLElement>('.react-flow__viewport');
      if (view) push(motion.views, view.style.transform);
      for (const node of document.querySelectorAll<HTMLElement>('.react-flow__node')) {
        const id = node.dataset.id ?? '';
        const drawn = translation(getComputedStyle(node).transform);
        const set = translation(node.style.transform);
        if (!drawn || !set) continue;
        push((motion.places[id] ??= []), `${Math.round(drawn[0])},${Math.round(drawn[1])}`);
        if (Math.abs(drawn[0] - set[0]) > 0.5 || Math.abs(drawn[1] - set[1]) > 0.5) motion.between.push(`${id} drawn at ${drawn.join(',')}, placed at ${set.join(',')}`);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/** Stops the motion probe and returns what it saw. */
export function stopMotion(page: Page): Promise<Motion> {
  return page.evaluate(() => {
    const motion = (window as unknown as { __motion: Motion & { running: boolean } }).__motion;
    motion.running = false;
    return { frames: motion.frames, views: motion.views, places: motion.places, between: motion.between };
  });
}
