// Explorer steps for the M05 tests and the screen states (milestone M05): demo person ids, and
// opening /explore with a view and waiting until the layout worker's scene is drawn.

import { expect, type Locator, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../../src/server/db';
import { loadTestEnv } from './auth';

/** The id of a demo person. */
export async function personIdOf(slug: string): Promise<string> {
  loadTestEnv();
  const rows = await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM person WHERE slug = ${slug}`);
  expect(rows.rows, slug).toHaveLength(1);
  return rows.rows[0]!.id;
}

/** The id of a demo lineage by slug. */
export async function lineageIdOf(slug: string): Promise<string> {
  loadTestEnv();
  const rows = await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM lineage WHERE slug = ${slug}`);
  expect(rows.rows, slug).toHaveLength(1);
  return rows.rows[0]!.id;
}

export const personNodes = (page: Page) => page.locator('.react-flow__node [data-person-node]');
/** The node of a person by id. */
export const nodeOf = (page: Page, id: string): Locator => page.locator(`.react-flow__node[data-id="${id}"]`);
/** The edges drawn into a student. */
export const edgesInto = (page: Page, studentId: string) => page.locator(`[data-edge][data-student="${studentId}"]`);

/** Opens /explore with these params and waits until the scene is drawn (no skeleton, nodes on the canvas). */
export async function openExplorer(page: Page, params: Record<string, string | number>): Promise<void> {
  const search = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  await page.goto(`/explore?${search.toString()}`);
  await expect(personNodes(page).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('explorer-skeleton')).toHaveCount(0);
}

/** The explorer's three views (plan §4.3) of the demo data, for the screenshots and the visual regression. */
export const EXPLORER_VIEWS: readonly { name: 'person' | 'generations' | 'lineage'; params: () => Promise<Record<string, string | number>> }[] = [
  { name: 'person', params: async () => ({ focus: await personIdOf('demo-two-lineages') }) },
  { name: 'generations', params: async () => ({ focus: await personIdOf('demo-converging'), up: 1, down: 1 }) },
  { name: 'lineage', params: async () => ({ focus: await personIdOf('demo-root-b'), lineage: await lineageIdOf('demo-lineage-b') }) },
];

/**
 * The list view inside the explorer (M04's list view in the explorer's frame, plan §4.10), for the
 * screenshots and the visual regression: a teacher with students, one generation up and two down.
 */
export const EXPLORER_LIST: { name: 'list'; params: () => Promise<Record<string, string | number>> } = {
  name: 'list',
  params: async () => ({ focus: await personIdOf('demo-hub-a'), up: 1, down: 2, view: 'list' }),
};

/** Opens /explore with these params (view=list) and waits until the list view is rendered. */
export async function openExplorerList(page: Page, params: Record<string, string | number>): Promise<void> {
  const search = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  await page.goto(`/explore?${search.toString()}`);
  await expect(page.getByRole('heading', { level: 1, name: /Lineage of/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 2, name: 'Routes of descent' })).toBeVisible();
  // The shell marks the explorer's tab once its navigation has hydrated (as e2e/visual.spec.ts waits for).
  await expect(page.getByRole('navigation', { name: 'Main' }).locator('a[aria-current="page"]').filter({ visible: true })).toHaveAttribute('href', '/explore');
}
