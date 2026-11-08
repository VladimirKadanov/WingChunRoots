/**
 * Milestone M20: the activity check of a listed school (Done when 3; DEFAULT D17, D18). A new
 * Professional Sifu lists a school in Leipzig and the administrator approves it; then the school is
 * put in the stage the daily job gives it on day 105 (hidden from the map), the way the job does it:
 * one UPDATE of its stage, then the `schools` cache tag through the internal route
 * (src/server/services/school-activity.ts). The job itself is not run here, because it would move
 * every listed school of the shared database; the integration test runs it
 * (src/server/services/school-activity.int.test.ts). The owner sees "Hidden from the map" with its
 * date and the one primary action, confirms with "This listing is current", and the pin comes back
 * on the public map, list, API and sitemap.
 *
 * Hiding and showing a school changes the finder's lists and the sitemap that other specs read: the
 * spec runs in the `exclusive` project (e2e/projects.ts, PUBLIC_WRITE_SPECS). The school is in
 * Leipzig, far from the searches of the other tests; the Sifu is a new `demo-e2e-…@example.test`
 * account with a fictional `Demo …` name (D20).
 */

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { REVALIDATE_PATH, revalidateSecret } from '../src/server/revalidate';
import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { apiPost } from './helpers/plans';
import { approveListing, createSchool, grantProSifu, LEIPZIG, mapSettled, sifuAccount, signedIn, visible } from './helpers/schools';
import { expectNoAxeViolations, openInTheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  // Rate limits are per client address: each test is its own client.
  await giveOwnAddress(context);
});

const marker = (page: Page, slug: string) => page.locator(`[data-testid="school-marker"][data-slug="${slug}"]`);

async function searchSlugs(request: APIRequestContext): Promise<string[]> {
  const response = await request.post(`${BASE_URL}/api/v1/schools/search`, { data: { center: LEIPZIG, radiusKm: 10 } });
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { schools: { slug: string }[] }).schools.map((s) => s.slug);
}

async function listSlugs(page: Page): Promise<string[]> {
  await page.goto('/schools?near=Leipzig&radius=10&view=list');
  return visible(page.getByTestId('school-row')).evaluateAll((items) => items.map((item) => item.getAttribute('data-slug') ?? ''));
}

/**
 * Day 105, as the daily job writes it: asked 15 days ago, hidden now, last activity 106 days ago;
 * then the public cache of schools is dropped through the internal route, as the worker does.
 */
async function hideAsTheJobDoes(request: APIRequestContext, schoolId: string) {
  await getDb().execute(sql`
    UPDATE school
       SET last_activity_at = now() - interval '106 days',
           activity_stage = 'hidden',
           activity_awaiting_since = now() - interval '15 days',
           activity_hidden_at = now()
     WHERE id = ${schoolId}::uuid AND status = 'active'`);
  const response = await request.post(`${BASE_URL}${REVALIDATE_PATH}`, {
    headers: { authorization: `Bearer ${revalidateSecret()}` },
    data: { tags: ['schools'] },
  });
  expect(response.status(), await response.text()).toBe(200);
}

test('@M20 the owner sees "Hidden from the map", confirms with "This listing is current" and the pin comes back', async ({ page, browser, request }) => {
  const sifu = await sifuAccount(page, 'Activity Sifu');
  const admin = await signedIn(browser, 'admin');
  let school: { id: string; slug: string; name: string };
  try {
    await grantProSifu(admin.page, sifu.email);
    school = await createSchool(page);
    const submitted = await apiPost(page, '/schools/submit', { id: school.id });
    expect(submitted.status(), await submitted.text()).toBe(200);
    await approveListing(admin.page, school.id);
  } finally {
    await admin.context.close();
  }
  const { id, slug } = school;
  expect((await request.get(`${BASE_URL}/api/v1/schools/${slug}`)).status(), 'public once approved').toBe(200);

  // Day 105 without an edit or a confirmation.
  await hideAsTheJobDoes(request, id);

  // Off every public answer, on the server: the API, the search, the list, the map, the sitemap and the page.
  expect((await request.get(`${BASE_URL}/api/v1/schools/${slug}`)).status()).toBe(404);
  expect(await searchSlugs(request)).not.toContain(slug);
  expect(await listSlugs(page)).not.toContain(slug);
  await page.goto('/schools?near=Leipzig&radius=10');
  await mapSettled(page);
  await expect(marker(page, slug)).toHaveCount(0);
  expect(await (await request.get(`${BASE_URL}/sitemap.xml`)).text()).not.toContain(`/schools/${slug}<`);
  await page.goto(`/schools/${slug}`);
  await expect(visible(page.getByTestId('school-not-listed'))).toBeVisible();
  // Kept, never deleted.
  const kept = await getDb().execute<{ status: string; deleted_at: string | null }>(sql`SELECT status, deleted_at FROM school WHERE id = ${id}::uuid`);
  expect(kept.rows[0]).toMatchObject({ status: 'active', deleted_at: null });

  // The owner's list and page: the stage in words with its mark and its date, one primary action.
  await page.goto('/dashboard/schools');
  const own = visible(page.locator(`[data-testid="own-school"][data-activity="hidden"]`)).filter({ hasText: school.name });
  await expect(own).toHaveCount(1);
  await expect(own.getByTestId('own-school-activity')).toContainText('Hidden from the map');
  await own.getByRole('link', { name: school.name }).click();
  await page.waitForURL(new RegExp(`/dashboard/schools/${id}$`));
  const activity = visible(page.getByTestId('school-activity'));
  await expect(activity).toHaveAttribute('data-activity', 'hidden');
  await expect(activity).toContainText(/^Hidden from the map since \d{1,2} [A-Z][a-z]+ \d{4}/);
  await expect(activity.locator('svg[aria-hidden="true"]')).toHaveCount(1);
  await expect(visible(page.getByTestId('school-listing'))).toHaveAttribute('data-pin', 'activity_hidden');
  await expect(visible(page.getByTestId('school-pin'))).toHaveText('Not on the map: hidden until you confirm the listing is current');
  await expect(visible(page.getByTestId('school-activity-note'))).toContainText('Nothing is deleted');
  for (const theme of THEMES) {
    await openInTheme(page, `/dashboard/schools/${id}`, theme);
    await expectNoAxeViolations(page, `/dashboard/schools/[id] (hidden, ${theme})`);
  }

  // "This listing is current".
  const confirm = visible(page.getByTestId('school-confirm')).getByRole('button', { name: 'This listing is current' });
  await expect(confirm).toHaveCount(1);
  await confirm.click();
  await page.waitForURL(/[?&]confirmed=1/);
  await expect(visible(page.getByTestId('school-confirmed'))).toBeVisible();
  await expect(visible(page.getByTestId('school-activity'))).toHaveAttribute('data-activity', 'current');
  await expect(visible(page.getByTestId('school-listing'))).toHaveAttribute('data-pin', 'shown');
  await expect(visible(page.getByTestId('school-activity-note'))).toHaveCount(0);

  // The pin is back, with no new review: the API, the search, the list, the map, the sitemap.
  const api = await request.get(`${BASE_URL}/api/v1/schools/${slug}`);
  expect(api.status()).toBe(200);
  expect(await api.json()).toMatchObject({ precision: 'exact', point: LEIPZIG, city: 'Leipzig' });
  expect(await searchSlugs(request)).toContain(slug);
  expect(await listSlugs(page)).toContain(slug);
  await page.goto('/schools?near=Leipzig&radius=10');
  await mapSettled(page);
  await expect(marker(page, slug)).toHaveCount(1);
  expect(await (await request.get(`${BASE_URL}/sitemap.xml`)).text()).toContain(`/schools/${slug}</loc>`);
});
