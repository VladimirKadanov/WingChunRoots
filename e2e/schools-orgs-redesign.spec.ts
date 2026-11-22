/**
 * ADR 0052, part 2: the specs that write. demo-federation-owner adds a logo and a banner to
 * demo-federation-north on /dashboard/organization/<id>/photos; an anonymous visitor then sees them
 * on the organization's page and card, and no served rendition carries the upload's GPS position;
 * the owner removes both, and the page draws its banner and initials again. axe on the management
 * page in both themes. Every image is generated here: a flat colour.
 *
 * The organization's public page and card change while it runs, which other specs and the visual
 * regression compare, so the spec runs in the `exclusive` project (e2e/projects.ts,
 * PUBLIC_WRITE_SPECS).
 */

import { expect, test } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { jpegWithGps, plainImage } from '../src/server/storage/test-images';
import { closeHelpers, giveOwnAddress, loadTestEnv, signInAs } from './helpers/auth';
import { freshContext } from './helpers/schools';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

async function federationNorth(): Promise<string> {
  const rows = await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM organization WHERE slug = 'demo-federation-north'`);
  expect(rows.rows, 'the seeded demo-federation-north (pnpm db:seed)').toHaveLength(1);
  return rows.rows[0]!.id;
}

test('@redesign an organization owner adds a logo and a banner; the public page shows them without a GPS position, and removing them brings the drawing back', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const organizationId = await federationNorth();
  // A rerun on one database: start from no images.
  await getDb().execute(sql`UPDATE organization_photo SET status = 'removed', removed_at = now() WHERE organization_id = ${organizationId}::uuid AND status = 'active'`);
  await signInAs(page, 'demo-federation-owner');
  await page.goto(`/dashboard/organization/${organizationId}`);
  await page.getByTestId('organization-photos-link').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Logo and banner' })).toBeVisible();
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `organization images, empty (${theme})`);
  }

  await page.getByTestId('organization-logo-input').setInputFiles({ name: 'demo-logo.png', mimeType: 'image/png', buffer: Buffer.from(await plainImage('png', 300, 300)) });
  await expect(page.getByTestId('organization-photos-status')).toHaveText('Logo added.');
  await expect(page.getByTestId('organization-logo-preview')).toBeVisible();
  await page.getByTestId('organization-banner-input').setInputFiles({ name: 'demo-banner.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(await jpegWithGps(1200, 400)) });
  await expect(page.getByTestId('organization-photos-status')).toHaveText('Banner added.');
  await expect(page.getByTestId('organization-banner-preview')).toBeVisible();
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `organization images, with both (${theme})`);
  }

  const visitor = await freshContext(browser);
  try {
    await visitor.page.goto('/organizations/demo-federation-north');
    const banner = visitor.page.getByTestId('organization-banner');
    await expect(banner).not.toHaveAttribute('data-drawn', 'true');
    const sources = [(await banner.locator('img').getAttribute('src'))!, (await visitor.page.getByTestId('organization-page').locator('img[src*="/512.webp"]').first().getAttribute('src'))!];
    for (const src of sources) {
      expect(src).toMatch(/^\/api\/organization-photos\/[0-9a-f-]{36}\/[0-9a-f]{16}\/(96|512|full)\.webp$/);
      const served = await visitor.page.request.get(src);
      expect(served.status()).toBe(200);
      expect(served.headers()['content-type']).toBe('image/webp');
      const bytes = await served.body();
      expect(bytes.includes(Buffer.from('GPS'))).toBe(false);
      expect(bytes.includes(Buffer.from('Exif'))).toBe(false);
    }
    await visitor.page.goto('/organizations');
    await expect(visitor.page.locator('[data-testid="organization-row"][data-slug="demo-federation-north"]').getByTestId('organization-card-banner')).not.toHaveAttribute('data-drawn', 'true');

    // Removed again: the page draws its banner and initials.
    await page.getByTestId('organization-banner-remove').click();
    await expect(page.getByTestId('organization-photos-status')).toHaveText('Banner removed.');
    await page.getByTestId('organization-logo-remove').click();
    await expect(page.getByTestId('organization-photos-status')).toHaveText('Logo removed.');
    await expect(page.getByTestId('organization-logo-input')).toBeFocused();
    await visitor.page.goto('/organizations/demo-federation-north');
    await expect(visitor.page.getByTestId('organization-banner')).toHaveAttribute('data-drawn', 'true');
    await expect(visitor.page.getByTestId('organization-page').locator('img[src^="/api/organization-photos/"]')).toHaveCount(0);
  } finally {
    await visitor.context.close();
  }
});
