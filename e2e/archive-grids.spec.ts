// The archive editor's working views (control panel 2026-11, docs/adr/0037-archive-editor-grids.md),
// read-only over the demo data: the lineages table and its order, the people grid's search by every
// spelling and its filters, the links grid's filters and side panel, and the tree that loads only the
// open branches with the person's panel. Fictional demo data only (D20).

import { expect, test, type Locator } from '@playwright/test';

import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv, signInAs } from './helpers/auth';
import { expectNoAxeViolations } from './helpers/ui';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

const visible = (locator: Locator) => locator.filter({ visible: true });

test('@admin an archivist works through the lineages table, the people grid, the links grid and the tree', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(context);
  const page = await context.newPage();
  await signInAs(page, 'demo-archivist');

  // Lineages: figures, a row per lineage, sorted by people.
  await page.goto('/admin/archive?sort=people');
  await expect(visible(page.getByTestId('archive-figures'))).toContainText('People on record');
  const lineages = visible(page.getByTestId('archive-lineages'));
  await expect(lineages.locator('[data-lineage="demo-lineage-c"]')).toContainText('% sourced');
  await expect(visible(page.getByTestId('lineages-count'))).toContainText('most people first');
  await expect(visible(page.locator('nav').getByRole('link', { name: 'People & records' })).first()).toBeVisible();

  // People: the Chinese spelling and the Jyutping both find the demo root.
  for (const q of ['鄭河溪', 'zeng6 ho4', 'cheng ho kai']) {
    await page.goto(`/admin/archive/people?q=${encodeURIComponent(q)}`);
    await expect(visible(page.getByTestId('people-table')).locator('[data-record="demo-root-c"]')).toBeVisible();
  }
  await page.goto('/admin/archive/people?lineage=demo-lineage-c&show=no_teacher');
  await expect(visible(page.getByTestId('people-table')).locator('[data-record="demo-root-c"]')).toBeVisible();
  await expectNoAxeViolations(page, 'the people grid');

  // New record: the name is checked against similar records first.
  await page.goto('/admin/archive/people?new=record&name=Cheng%20Ho%20Kai#new-record');
  await expect(visible(page.getByTestId('similar-records'))).toContainText('Cheng Ho Kai');
  await expect(visible(page.getByTestId('record-create-form')).getByLabel(/^Name in Latin letters/)).toHaveValue('Cheng Ho Kai');

  // Links: 50 a page, a filter by person, and the side panel of one link.
  await page.goto('/admin/archive/lineages/demo-lineage-c/links');
  await expect(visible(page.getByTestId('links-count'))).toContainText('Links 1 to 50 of');
  await page.goto('/admin/archive/lineages/demo-lineage-c/links?q=demo-c-002');
  const links = visible(page.getByTestId('lineage-links'));
  await expect(links).toContainText('Nikolay Demov');
  await links.getByRole('link', { name: /^Open the link from Cheng Ho Kai to Nikolay Demov/ }).click();
  await expect(visible(page.getByTestId('link-panel'))).toContainText('Established');
  await expectNoAxeViolations(page, 'the links grid with a link open');

  // Tree: closed at first; opening the root lists its students; a name opens the panel.
  await page.goto('/admin/archive/lineages/demo-lineage-c');
  const tree = visible(page.getByTestId('lineage-tree'));
  await expect(tree.locator('[data-node="demo-c-001"]')).toHaveCount(0);
  await tree.getByRole('link', { name: 'Open the students of Cheng Ho Kai' }).click();
  await page.waitForURL(/open=demo-root-c/);
  await expect(visible(page.getByTestId('lineage-tree')).locator('[data-node="demo-c-001"]')).toBeVisible();
  await visible(page.getByTestId('lineage-tree')).locator('[data-node="demo-c-002"]').getByRole('link', { name: 'Nikolay Demov', exact: true }).click();
  await page.waitForURL(/person=demo-c-002/);
  const panel = visible(page.getByTestId('person-panel'));
  await expect(panel).toContainText('Teachers · ');
  await expect(panel).toContainText('Cheng Ho Kai');
  await expectNoAxeViolations(page, 'the tree with a person open');

  await context.close();
});
