// Search and profile steps for the M07 tests (and the screen states of e2e/screenshots.spec.ts).
//
// The demo data's search keys are written by the worker (search.keys.rebuild, queued by
// `pnpm db:seed`; src/server/search/store.ts), which Playwright starts next to the web server.
// waitForSearchKeys() waits until it has written them, so a search test never runs before.

import { expect, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../../src/server/db';
import { loadTestEnv } from './auth';

const KEYS_TIMEOUT_MS = 90_000;

/** Waits until the worker has written the search keys of the demo person `slug`. */
export async function waitForSearchKeys(slug = 'demo-cjk-name'): Promise<void> {
  loadTestEnv();
  const deadline = Date.now() + KEYS_TIMEOUT_MS;
  for (;;) {
    const rows = await getDb().execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM person_name_key k JOIN person p ON p.id = k.person_id WHERE p.slug = ${slug}`);
    if ((rows.rows[0]?.n ?? 0) > 0) return;
    if (Date.now() > deadline) throw new Error(`no search keys for ${slug} after ${KEYS_TIMEOUT_MS / 1000} s: is the worker running (pnpm worker)?`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** The id of a demo person. */
export async function personIdOf(slug: string): Promise<string> {
  loadTestEnv();
  const rows = await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM person WHERE slug = ${slug}`);
  expect(rows.rows, slug).toHaveLength(1);
  return rows.rows[0]!.id;
}

export const palette = (page: Page) => page.getByTestId('search-palette');
export const searchInput = (page: Page) => palette(page).getByRole('combobox', { name: 'Search people, schools and lineages' });
/** A result of the palette whose text contains `text`. */
export const option = (page: Page, text: string | RegExp) => palette(page).getByRole('option').filter({ hasText: text });

/** Opens the palette with Ctrl/⌘+K once the page's shell has hydrated. */
export async function openPalette(page: Page): Promise<void> {
  // The field is drawn by the server; Ctrl/⌘+K works once its island has hydrated.
  await expect(page.locator('[data-search-field]').filter({ visible: true })).toBeVisible();
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(searchInput(page)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/** Types a query into the open palette and waits for the search to answer. */
export async function search(page: Page, query: string): Promise<void> {
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/search' && new URL(r.url()).searchParams.get('q') === query.trim());
  await searchInput(page).fill(query);
  expect((await answered).status()).toBe(200);
}
