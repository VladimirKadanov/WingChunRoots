/**
 * Milestone M11: schools, the map and the lineage filter (Done when 2). The flows run through the
 * real pages against `next start` and the worker, with the local map styles of the E2E build
 * (src/server/geo/map-styles.ts: no request leaves the machine); the database is read to check
 * what the pages cannot show (the private point of a city-only school, descent along public edges,
 * that a school is kept).
 *
 * Approving a listing makes a school public and revoking a grant hides one, which changes the
 * finder's lists and the sitemap that other specs read: the spec runs in the `exclusive` project,
 * in a Playwright run of its own after the others (e2e/projects.ts, PUBLIC_WRITE_SPECS). The
 * schools it lists are in Leipzig, far from the searches of the other tests (Sofia, Plovdiv), and
 * their Sifus are new `demo-e2e-…@example.test` accounts with fictional `Demo …` names (D20).
 */

import { existsSync, readFileSync } from 'node:fs';

import { expect, test, type APIRequestContext, type APIResponse, type Page, type Response } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { letters } from './helpers/evidence';
import { apiPost } from './helpers/plans';
import {
  approveListing,
  createSchool,
  grantProSifu,
  LEIPZIG,
  listingCaseOf,
  mapSettled,
  markerSlugs,
  placeOf,
  type PointRow,
  schoolRow,
  sifuAccount,
  signedIn,
  visible,
} from './helpers/schools';
import { personIdOf } from './helpers/search';
import { expectNoAxeViolations, openInTheme, resolvedTheme, switchColorScheme } from './helpers/ui';
import { runPaths } from './projects';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  // Rate limits are per client address: each test is its own client.
  await giveOwnAddress(context);
});

const capital = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/** A text in the bundles of the map code (MapLibre's own class name), as in scripts/check-bundle-budget.mjs. */
const MAP_CODE_SIGNATURE = 'maplibregl-canvas-container';

// --- Pages -------------------------------------------------------------------------------------

/** The finder's search form. */
const finderSearch = (page: Page) => page.getByRole('search', { name: 'Find a school' });

/** Runs a search with the finder's form (the GET form works the same with or without JavaScript). */
async function searchSchools(page: Page, options: { near?: string; radius?: string; lineage?: string }) {
  const form = finderSearch(page);
  if (options.near !== undefined) await form.getByLabel('Near').fill(options.near);
  if (options.radius !== undefined) await form.getByLabel('Distance').selectOption(options.radius);
  if (options.lineage !== undefined) await form.getByLabel('Lineage').selectOption({ label: options.lineage });
  await visible(form.getByRole('button', { name: 'Search' })).click();
  await page.waitForURL(/\/schools\?/);
}

/** The slugs of the school rows the page shows, sorted. */
async function rowSlugs(page: Page): Promise<string[]> {
  const rows = visible(page.getByTestId('school-row'));
  return (await rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-slug') ?? ''))).sort();
}

// --- The API and the database -------------------------------------------------------------------

interface SchoolPin {
  slug: string;
  precision: 'exact' | 'city';
  point: PointRow;
  distanceKm: number | null;
}

/** POST /api/v1/schools/search as an anonymous client. */
async function apiSearch(request: APIRequestContext, body: Record<string, unknown>): Promise<{ schools: SchoolPin[]; total: number }> {
  const response = await request.post(`${BASE_URL}/api/v1/schools/search`, { data: body });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as { schools: SchoolPin[]; total: number };
}

/**
 * The people who descend from `rootId` along public edges of the lineages it heads (the root
 * itself included): the definition of the lineage filter, computed here from v_public_edge.
 */
async function descendantsOf(rootId: string): Promise<Set<string>> {
  const rows = await getDb().execute<{ id: string }>(sql`
    WITH RECURSIVE edges AS (
      SELECT e.teacher_person_id, e.student_person_id FROM v_public_edge e
       WHERE e.lineage_id IN (SELECT l.id FROM lineage l WHERE l.root_person_id = ${rootId}::uuid AND l.deleted_at IS NULL)
    ), down(id) AS (
      SELECT ${rootId}::uuid
      UNION SELECT e.student_person_id FROM down d JOIN edges e ON e.teacher_person_id = d.id
    )
    SELECT id::text AS id FROM down`);
  return new Set(rows.rows.map((r) => r.id));
}

/** Every public school with its public instructors (v_public_school). */
async function publicSchools(): Promise<{ slug: string; instructors: string[] }[]> {
  const rows = await getDb().execute<{ slug: string; instructors: string[] }>(sql`
    SELECT slug, instructor_person_ids::text[] AS instructors FROM v_public_school ORDER BY slug`);
  return rows.rows;
}

// --- Map code ----------------------------------------------------------------------------------

/**
 * Opens `path` and returns whether any script or stylesheet it loaded holds the map code, and
 * which map styles it requested (the local ones, or OpenFreeMap's in a deployable build).
 */
async function mapLoadsOn(page: Page, path: string): Promise<{ mapCode: boolean; styles: string[] }> {
  const bodies: Promise<string>[] = [];
  const styles: string[] = [];
  const onResponse = (response: Response) => {
    const url = response.url();
    if (url.includes('/map-styles/') || url.includes('openfreemap')) styles.push(url);
    const type = response.request().resourceType();
    if (type === 'script' || type === 'stylesheet') bodies.push(response.text().catch(() => ''));
  };
  page.on('response', onResponse);
  try {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await page.waitForLoadState('networkidle');
  } finally {
    page.off('response', onResponse);
  }
  return { mapCode: (await Promise.all(bodies)).some((body) => body.includes(MAP_CODE_SIGNATURE)), styles };
}

// --- The tests -----------------------------------------------------------------------------------

test('@M11 the radius filter returns schools within 50 km and excludes one outside', async ({ page, request }) => {
  await page.goto('/schools?view=list');
  await searchSchools(page, { near: 'Sofia', radius: '50' });
  await expect(page.getByTestId('school-summary')).toContainText('within 50 km of Sofia');
  const listed = await rowSlugs(page);
  expect(listed).toContain('demo-school-sofia');
  // Plovdiv's city-only school is about 130 km from Sofia.
  expect(listed).not.toContain('demo-school-city-only');
  for (const text of await visible(page.getByTestId('school-distance')).allTextContents()) {
    expect(text.trim()).toMatch(/^\d+ km$/);
    expect(Number.parseInt(text, 10)).toBeLessThanOrEqual(50);
  }

  // The API answers the same from the same centre, in whole kilometres; 250 km reaches Plovdiv.
  const sofia = await placeOf(request, 'Sofia', 'BG');
  const near = await apiSearch(request, { center: sofia.point, radiusKm: 50 });
  expect(near.schools.map((s) => s.slug).sort()).toEqual(listed);
  for (const school of near.schools) {
    expect(Number.isInteger(school.distanceKm)).toBe(true);
    expect(school.distanceKm!).toBeLessThanOrEqual(50);
  }
  const wider = await apiSearch(request, { center: sofia.point, radiusKm: 250 });
  const plovdiv = wider.schools.find((s) => s.slug === 'demo-school-city-only');
  expect(plovdiv, 'the Plovdiv school within 250 km').toBeDefined();
  expect(Number.isInteger(plovdiv!.distanceKm)).toBe(true);
  expect(plovdiv!.distanceKm!).toBeGreaterThan(50);

  // The map view of the same search shows the same schools as markers.
  await visible(page.getByTestId('view-map')).click();
  await page.waitForURL((url) => url.searchParams.get('view') !== 'list');
  await mapSettled(page);
  expect(await markerSlugs(page)).toEqual(listed);
  expect(await rowSlugs(page)).toEqual(listed);
});

test('@M11 the lineage filter returns only schools whose instructors descend from the chosen fictional root', async ({ page, request }) => {
  await page.goto('/schools?view=list');
  await searchSchools(page, { lineage: 'Demo Lineage A' });
  const rootId = new URL(page.url()).searchParams.get('lineage');
  expect(rootId).toBe(await personIdOf('demo-root-a'));
  await expect(page.getByTestId('school-summary')).toContainText('Demo Lineage A');
  const listed = await rowSlugs(page);
  expect(listed).toEqual(expect.arrayContaining(['demo-school-new-york', 'demo-school-sofia', 'demo-school-two-lineages']));
  // Athens, London and Kowloon are schools of Demo Lineage B only.
  for (const slug of ['demo-school-athens', 'demo-school-london', 'demo-school-kowloon']) expect(listed).not.toContain(slug);

  // Exactly the public schools with an instructor who descends from the root along public edges.
  const descendants = await descendantsOf(rootId!);
  const expected = (await publicSchools()).filter((s) => s.instructors.some((id) => descendants.has(id))).map((s) => s.slug);
  expect(listed).toEqual(expected.sort());

  // The API answers the same.
  const api = await apiSearch(request, { lineageRootId: rootId });
  expect(api.schools.map((s) => s.slug).sort()).toEqual(listed);

  // With a radius as well: the lineage A school near Sofia, and no lineage B school there.
  await searchSchools(page, { near: 'Sofia', radius: '50' });
  expect(await rowSlugs(page)).toEqual(['demo-school-sofia']);
  await searchSchools(page, { lineage: 'Demo Lineage B' });
  await expect(page.getByTestId('school-empty')).toBeVisible();
});

test('@M11 a school whose instructor is demo-two-lineages is returned for both lineage roots', async ({ page, request }) => {
  const twoLineages = await personIdOf('demo-two-lineages');
  for (const [label, root] of [
    ['Demo Lineage A', 'demo-root-a'],
    ['Demo Lineage B', 'demo-root-b'],
  ] as const) {
    await page.goto('/schools?view=list');
    await searchSchools(page, { lineage: label });
    expect(new URL(page.url()).searchParams.get('lineage')).toBe(await personIdOf(root));
    const row = visible(page.locator('[data-testid="school-row"][data-slug="demo-school-two-lineages"]'));
    await expect(row, label).toHaveCount(1);
    expect((await descendantsOf(await personIdOf(root))).has(twoLineages), `demo-two-lineages descends from ${root}`).toBe(true);
    const api = await apiSearch(request, { lineageRootId: await personIdOf(root) });
    expect(api.schools.map((s) => s.slug), label).toContain('demo-school-two-lineages');
  }
  // The school's instructor is that person.
  await page.goto('/schools/demo-school-two-lineages');
  await expect(visible(page.locator('[data-testid="school-instructor"][data-slug="demo-two-lineages"]'))).toHaveCount(1);
});

test('@M11 demo-school-city-only: the exact coordinates appear in no API response, page, sitemap, Open Graph image, JSON-LD or test-results/server.log', async ({ page, request }) => {
  const db = getDb();
  const rows = await db.execute<{ id: string; lat: number; lng: number; address: string | null; city_lat: number; city_lng: number }>(sql`
    SELECT s.id::text AS id, ST_Y(l.exact_point::geometry) AS lat, ST_X(l.exact_point::geometry) AS lng, l.address_line AS address,
           ST_Y(p.centroid::geometry) AS city_lat, ST_X(p.centroid::geometry) AS city_lng
      FROM school s JOIN school_private_location l ON l.school_id = s.id JOIN place p ON p.id = s.place_id
     WHERE s.slug = 'demo-school-city-only'`);
  expect(rows.rows).toHaveLength(1);
  const school = rows.rows[0]!;
  expect(school.lat === school.city_lat && school.lng === school.city_lng, 'the private point is not the city centre').toBe(false);

  // Every way the exact point could be written with 3 to 5 decimals (about 100 m to 1 m), except
  // a form the city's centre also has (the public point of a city-only school).
  const forms = (value: number) => [String(value), value.toFixed(5), value.toFixed(4), value.toFixed(3), String(Number(value.toFixed(4))), String(Number(value.toFixed(3)))];
  const publicForms = [...forms(school.city_lat), ...forms(school.city_lng), ...[2, 1].flatMap((d) => [school.city_lat.toFixed(d), school.city_lng.toFixed(d)])];
  const secret = [...new Set([...forms(school.lat), ...forms(school.lng)])].filter((form) => !publicForms.some((p) => p.includes(form)));
  expect(secret.length, 'forms of the private point to look for').toBeGreaterThan(2);
  if (school.address) secret.push(school.address);
  const expectClean = (text: string, where: string) => {
    for (const form of secret) expect(text.includes(form), `${where} contains ${form}`).toBe(false);
  };

  // The API: the searches, the viewport, the school, the sitemap.
  const plovdiv = await placeOf(request, 'Plovdiv', 'BG');
  const answers: [string, Promise<APIResponse>][] = [
    ['schools.search', request.post(`${BASE_URL}/api/v1/schools/search`, { data: {} })],
    ['schools.search near Plovdiv', request.post(`${BASE_URL}/api/v1/schools/search`, { data: { center: plovdiv.point, radiusKm: 10 } })],
    ['schools.inViewport', request.post(`${BASE_URL}/api/v1/schools/in-viewport`, { data: { west: 24, south: 41.5, east: 25.5, north: 42.6 } })],
    ['schools.get', request.get(`${BASE_URL}/api/v1/schools/demo-school-city-only`)],
    ['schools.sitemap', request.get(`${BASE_URL}/api/v1/sitemap/schools`)],
    ['places.search', request.get(`${BASE_URL}/api/v1/places/search?q=Plovdiv`)],
  ];
  for (const [name, answer] of answers) {
    const response = await answer;
    expect(response.status(), name).toBe(200);
    // The school's own point, where it appears, is the city centre.
    expectClean(await response.text(), name);
  }
  // A search centred on the private point itself: the answer repeats that centre (the client's own
  // input), and its schools carry the city centre and a whole-kilometre distance, nothing finer.
  const near = await apiSearch(request, { center: { lat: school.lat, lng: school.lng }, radiusKm: 10 });
  expectClean(JSON.stringify(near.schools), 'schools.search near the private point');
  const pin = near.schools.find((s) => s.slug === 'demo-school-city-only');
  expect(pin).toMatchObject({ precision: 'city', point: { lat: Number(school.city_lat.toFixed(5)), lng: Number(school.city_lng.toFixed(5)) } });

  // The pages: the finder (map and list, near the school), the school's page with its JSON-LD.
  for (const path of ['/schools', '/schools?view=list', '/schools?near=Plovdiv&radius=10', '/schools?near=Plovdiv&radius=10&view=list', '/schools/demo-school-city-only']) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    if (!path.includes('view=list') && path !== '/schools/demo-school-city-only') await mapSettled(page);
    expectClean(await page.content(), path);
    expectClean(await response!.text(), `${path} (HTML as sent)`);
  }
  const jsonLd = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!) as Record<string, unknown>;
  expect(jsonLd).toMatchObject({ '@type': 'SportsActivityLocation', name: 'Demo Training Room Plovdiv', address: { addressLocality: 'Plovdiv', addressCountry: 'BG' } });
  expect(jsonLd).not.toHaveProperty('geo');
  expectClean(JSON.stringify(jsonLd), 'JSON-LD');

  // The sitemap and the Open Graph image (its address from the page, and its bytes).
  const sitemap = await request.get(`${BASE_URL}/sitemap.xml`);
  expect(sitemap.status()).toBe(200);
  const sitemapText = await sitemap.text();
  expect(sitemapText).toContain('/schools/demo-school-city-only</loc>');
  expectClean(sitemapText, 'sitemap.xml');
  const ogUrl = await page.locator('meta[property="og:image"]').first().getAttribute('content');
  expect(ogUrl).toContain('/schools/demo-school-city-only/opengraph-image');
  expectClean(ogUrl!, 'og:image');
  const image = await request.get(new URL(new URL(ogUrl!).pathname + new URL(ogUrl!).search, BASE_URL).toString());
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/png');
  expectClean((await image.body()).toString('latin1'), 'the Open Graph image');

  // The server logs of this run (and of the ordinary run before it, when there was one).
  for (const log of new Set([runPaths(process.env.PW_EXCLUSIVE === '1').serverLog, 'test-results/server.log'])) {
    if (existsSync(log)) expectClean(readFileSync(log, 'utf8'), log);
  }
});

test('@M11 a Free Sifu sees an upgrade prompt instead of publishing a pin; a Pro Sifu test plan publishes after listing review', async ({ page, browser, request }) => {
  const sifu = await sifuAccount(page, 'Listing Sifu');
  const name = `Demo Hall Leipzig ${capital(letters())}`;

  // The Sifu lists the school through the form: a draft only they see.
  await page.goto('/dashboard/schools');
  await visible(page.getByTestId('new-school')).click();
  await page.waitForURL(/\/dashboard\/schools\/new/);
  const form = visible(page.getByTestId('school-form'));
  await form.getByLabel('Name of the school').fill(name);
  await form.getByLabel('City or town').selectOption({ label: 'Leipzig, DE' });
  await form.getByRole('radio', { name: /^Exact pin/ }).check();
  await form.getByLabel('Latitude').fill(String(LEIPZIG.lat));
  await form.getByLabel('Longitude').fill(String(LEIPZIG.lng));
  await form.getByRole('checkbox', { name: 'Siu Nim Tao' }).check();
  await form.getByRole('button', { name: 'Save the draft' }).click();
  await page.waitForURL(/\/dashboard\/schools\/[0-9a-f-]{36}\?saved=1/);
  const schoolId = /\/dashboard\/schools\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  const { slug } = await schoolRow(schoolId);
  await expect(visible(page.getByTestId('school-saved'))).toBeVisible();
  await expect(visible(page.getByTestId('school-status'))).toHaveText('Draft');

  // Free Sifu: the upgrade prompt instead of "Send for review"; the API refuses the same step.
  await expect(visible(page.getByTestId('upgrade-prompt'))).toBeVisible();
  await expect(visible(page.getByTestId('school-submit'))).toHaveCount(0);
  const refused = await apiPost(page, '/schools/submit', { id: schoolId });
  expect(refused.status()).toBe(403);
  expect(((await refused.json()) as { code: string }).code).toBe('ENTITLEMENT_REQUIRED');
  expect((await schoolRow(schoolId)).status).toBe('draft');
  expect((await request.get(`${BASE_URL}/api/v1/schools/${slug}`)).status()).toBe(404);

  // With a Professional Sifu test plan the Sifu sends it for review.
  const admin = await signedIn(browser, 'admin');
  try {
    await grantProSifu(admin.page, sifu.email);
    await page.reload();
    await expect(visible(page.getByTestId('upgrade-prompt'))).toHaveCount(0);
    await visible(page.getByTestId('school-submit')).getByRole('button', { name: 'Send for review' }).click();
    await page.waitForURL(/[?&]sent=1/);
    await expect(visible(page.getByTestId('school-sent'))).toBeVisible();
    await expect(visible(page.getByTestId('school-status'))).toHaveText('Waiting for review');
    expect((await request.get(`${BASE_URL}/api/v1/schools/${slug}`)).status(), 'not public before the review').toBe(404);

    // The administrator approves the listing on its case card.
    const caseId = await listingCaseOf(schoolId);
    await admin.page.goto(`/admin/review/${caseId}`);
    const listing = visible(admin.page.getByTestId('case-listing'));
    await expect(listing).toContainText(name);
    await expect(listing.getByTestId('listing-plan')).toContainText('holds Professional Sifu');
    const approve = visible(admin.page.getByTestId('decide-verify'));
    await approve.locator('summary').click();
    await approve.getByRole('button', { name: 'Approve the listing' }).click();
    await admin.page.waitForURL(/[?&]done=verified/);
    await expect(visible(admin.page.getByTestId('case-outcome'))).toContainText('The listing is approved');
  } finally {
    await admin.context.close();
  }

  // Listed and on the public map, with its exact pin; the Sifu sees it so.
  expect((await schoolRow(schoolId)).status).toBe('active');
  const api = await request.get(`${BASE_URL}/api/v1/schools/${slug}`);
  expect(api.status()).toBe(200);
  expect(await api.json()).toMatchObject({ name, precision: 'exact', point: LEIPZIG, city: 'Leipzig' });
  await page.goto('/schools?near=Leipzig&radius=10');
  await mapSettled(page);
  await expect(page.locator(`[data-testid="school-marker"][data-slug="${slug}"]`)).toHaveAttribute('data-precision', 'exact');
  await page.goto(`/dashboard/schools/${schoolId}`);
  await expect(visible(page.getByTestId('school-status'))).toHaveText('Listed');
  await expect(visible(page.getByTestId('school-listing'))).toHaveAttribute('data-pin', 'shown');
  await expect(visible(page.getByTestId('public-school-link'))).toHaveAttribute('href', `/schools/${slug}`);
});

test('@M11 revoking the Pro Sifu test grant hides the pin and keeps the school', async ({ page, browser, request }) => {
  const sifu = await sifuAccount(page, 'Revoked Sifu');
  const admin = await signedIn(browser, 'admin');
  try {
    const email = sifu.email;
    const grantId = await grantProSifu(admin.page, email);
    const { id, slug, name } = await createSchool(page);
    const submitted = await apiPost(page, '/schools/submit', { id });
    expect(submitted.status(), await submitted.text()).toBe(200);
    await approveListing(admin.page, id);

    // On the map and in the API while the plan holds.
    await page.goto('/schools?near=Leipzig&radius=10');
    await mapSettled(page);
    await expect(page.locator(`[data-testid="school-marker"][data-slug="${slug}"]`)).toHaveCount(1);
    expect((await request.get(`${BASE_URL}/api/v1/schools/${slug}`)).status()).toBe(200);

    // The administrator revokes the test plan.
    const revoked = await apiPost(admin.page, '/admin/grants/revoke', { grantId, reason: 'Demo pilot test finished' });
    expect(revoked.status(), await revoked.text()).toBe(200);

    // The pin is gone: from the map, the list, the API, the sitemap and the school's address.
    await page.goto('/schools?near=Leipzig&radius=10');
    await mapSettled(page);
    await expect(page.locator(`[data-testid="school-marker"][data-slug="${slug}"]`)).toHaveCount(0);
    expect(await rowSlugs(page)).not.toContain(slug);
    expect((await apiSearch(request, { center: LEIPZIG, radiusKm: 10 })).schools.map((s) => s.slug)).not.toContain(slug);
    expect((await request.get(`${BASE_URL}/api/v1/schools/${slug}`)).status()).toBe(404);
    expect(await (await request.get(`${BASE_URL}/sitemap.xml`)).text()).not.toContain(`/schools/${slug}<`);
    await page.goto(`/schools/${slug}`);
    await expect(visible(page.getByTestId('school-not-listed'))).toBeVisible();

    // The school is kept: still listed for its Sifu, who sees why the pin is gone.
    expect(await schoolRow(id)).toMatchObject({ status: 'active', deleted_at: null });
    await page.goto(`/dashboard/schools/${id}`);
    await expect(visible(page.getByTestId('school-status'))).toHaveText('Listed');
    await expect(visible(page.getByTestId('school-listing'))).toHaveAttribute('data-pin', 'needs_plan');
    await expect(visible(page.getByTestId('school-pin'))).toHaveText('Not on the map: a public pin needs Professional Sifu');
    await page.goto('/dashboard/schools');
    await expect(visible(page.locator('[data-testid="own-school"]')).filter({ hasText: name })).toHaveAttribute('data-pin', 'needs_plan');

    // A new plan brings the pin back without a new review.
    await grantProSifu(admin.page, email);
    expect((await request.get(`${BASE_URL}/api/v1/schools/${slug}`)).status()).toBe(200);
  } finally {
    await admin.context.close();
  }
});

test('@M11 pages other than /schools load no map code or map style', async ({ page, browser }) => {
  for (const path of ['/', '/explore', '/schools?view=list', '/schools/demo-school-sofia', '/schools/demo-school-city-only', '/people/demo-two-lineages', '/plans']) {
    const loaded = await mapLoadsOn(page, path);
    expect(loaded.mapCode, `${path} loads the map code`).toBe(false);
    expect(loaded.styles, `${path} requests a map style`).toEqual([]);
  }

  // The school editor loads it only when the Sifu asks to drop the pin on a map.
  const sifu = await browser.newContext({ baseURL: BASE_URL });
  try {
    await giveOwnAddress(sifu);
    const editor = await sifu.newPage();
    await sifuAccount(editor, 'Pin Sifu');
    const before = await mapLoadsOn(editor, '/dashboard/schools/new');
    expect(before.mapCode, 'the school editor before "Drop the pin"').toBe(false);
    expect(before.styles).toEqual([]);
    await visible(editor.getByTestId('school-form')).getByLabel('City or town').selectOption({ label: 'Leipzig, DE' });
    await visible(editor.getByTestId('drop-pin')).click();
    await expect(visible(editor.getByTestId('pin-picker'))).toBeVisible();
  } finally {
    await sifu.close();
  }

  // The control: the finder's map view loads both.
  const finder = await mapLoadsOn(page, '/schools');
  expect(finder.mapCode, '/schools loads the map code').toBe(true);
  expect(finder.styles.some((url) => url.includes('/map-styles/'))).toBe(true);
});

test('@M11 with WebGL unavailable the list view shows the same schools', async ({ page, browser }) => {
  const withoutWebGl = async (target: Page) =>
    target.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
          return /webgl/i.test(type) ? null : (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
        },
      });
    });
  for (const query of ['', '?lineage=' + (await personIdOf('demo-root-b'))]) {
    await page.goto(`/schools${query ? `${query}&` : '?'}view=list`);
    const expected = await rowSlugs(page);
    expect(expected.length, `schools of /schools${query}`).toBeGreaterThan(0);

    const context = await browser.newContext({ baseURL: BASE_URL });
    try {
      await giveOwnAddress(context);
      const desk = await context.newPage();
      await withoutWebGl(desk);
      await desk.goto(`/schools${query}`);
      await expect(desk.getByTestId('school-finder')).toHaveAttribute('data-map', 'fallback');
      await expect(desk.getByTestId('map-fallback')).toContainText('This browser cannot draw the map (it needs WebGL 2)');
      await expect(desk.getByTestId('school-map')).toHaveCount(0);
      expect(await rowSlugs(desk)).toEqual(expected);
      await visible(desk.getByRole('link', { name: 'Open the list view' })).click();
      await desk.waitForURL(/view=list/);
      expect(await rowSlugs(desk)).toEqual(expected);
    } finally {
      await context.close();
    }

    // On a phone the fallback lists them in the map's place.
    const phone = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      await giveOwnAddress(phone);
      const mobile = await phone.newPage();
      await withoutWebGl(mobile);
      await mobile.goto(`/schools${query}`);
      await expect(mobile.getByTestId('school-finder')).toHaveAttribute('data-map', 'fallback');
      const inFallback = await mobile.getByTestId('map-fallback').getByTestId('school-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-slug') ?? ''));
      expect(inFallback.sort()).toEqual(expected);
      await expect(mobile.getByTestId('show-list')).toHaveCount(0);
    } finally {
      await phone.close();
    }
  }
});

test('@M11 at 390x844 selecting a pin opens the sheet and the pin stays visible above it', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    await giveOwnAddress(context);
    const page = await context.newPage();
    await page.goto('/schools?near=Sofia&radius=50');
    const map = await mapSettled(page);
    const marker = page.locator('[data-testid="school-marker"][data-slug="demo-school-sofia"]');
    const box = (await marker.boundingBox())!;
    expect(box.width, 'a 44 px touch target').toBeGreaterThanOrEqual(44);
    expect(box.height, 'a 44 px touch target').toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId('show-list')).toContainText('1 school within 50 km of Sofia');

    await marker.tap();
    const sheet = page.getByTestId('school-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Demo Wing Chun Hall Sofia · Exact location');
    await expect(sheet.getByTestId('sheet-school-link')).toHaveAttribute('href', '/schools/demo-school-sofia');
    await expect(marker).toHaveAttribute('aria-pressed', 'true');

    /** The pin is inside the map's frame and above the sheet; the map's bottom padding is the sheet's height over it. */
    const pinAboveSheet = async (label: string) => {
      await mapSettled(page);
      await expect
        .poll(async () => {
          const frame = (await page.getByTestId('school-map-frame').boundingBox())!;
          const top = (await sheet.boundingBox())!.y;
          const pin = (await marker.boundingBox())!;
          const padding = Number(await map.getAttribute('data-padding-bottom'));
          const over = Math.round(frame.y + frame.height - top);
          return { above: pin.y + pin.height <= top, inFrame: pin.y >= frame.y, padding: Math.abs(padding - over) <= 2 };
        }, { message: label })
        .toEqual({ above: true, inFrame: true, padding: true });
    };
    await pinAboveSheet('the sheet at its lowest snap point');
    await visible(sheet.getByRole('button', { name: /expand/i })).click();
    await pinAboveSheet('the sheet at its middle snap point');
    await expect(page.getByTestId('school-map-frame').locator('[inert]')).toHaveCount(0);

    // Closing the sheet clears the selection; the summary opens the list again.
    await visible(sheet.getByRole('button', { name: /close/i })).click();
    await expect(sheet).toBeHidden();
    await expect(marker).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('show-list')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('@M11 moving the map writes lat, lng and z into the address with replace', async ({ page }) => {
  await page.goto('/schools?near=Sofia&radius=50');
  const map = await mapSettled(page);
  const params = () => new URL(page.url()).searchParams;
  // The first fit to the search is no view of the reader's: the address keeps none.
  expect(params().has('lat')).toBe(false);
  const entries = await page.evaluate(() => history.length);

  const box = (await map.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 160, y - 90, { steps: 12 });
  await page.mouse.up();
  await mapSettled(page);
  await expect.poll(() => params().get('lat'), { timeout: 5_000 }).not.toBeNull();
  const written = params();
  expect(written.get('lat')).toMatch(/^-?\d+(\.\d{1,4})?$/);
  expect(written.get('lng')).toMatch(/^-?\d+(\.\d{1,4})?$/);
  expect(written.get('z')).toMatch(/^\d+(\.\d+)?$/);
  expect(written.get('near')).toBe('Sofia');
  expect(written.get('radius')).toBe('50');
  expect(await page.evaluate(() => history.length), 'replace, not a new history entry').toBe(entries);

  // The address reopens the same view.
  const view = { lat: Number(written.get('lat')), lng: Number(written.get('lng')) };
  await page.reload();
  await mapSettled(page);
  await expect.poll(() => Number(params().get('lat'))).toBeCloseTo(view.lat, 3);
  expect(Number(params().get('lng'))).toBeCloseTo(view.lng, 3);
});

test("@M11 the school page links to the instructor's profile, list view and explorer", async ({ page }) => {
  const personId = await personIdOf('demo-two-lineages');
  await page.goto('/schools/demo-school-two-lineages');
  await expect(page.getByRole('heading', { level: 1, name: 'Demo Two Lineages Kwoon Berlin' })).toBeVisible();
  const page_ = visible(page.getByTestId('school-page'));
  await expect(page_).toHaveAttribute('data-precision', 'exact');
  await expect(page_).toContainText('Berlin, DE');
  await expect(page_.getByTestId('school-email')).toHaveAttribute('href', 'mailto:demo-school-two-lineages@example.test');
  const instructor = visible(page.locator('[data-testid="school-instructor"][data-slug="demo-two-lineages"]'));
  await expect(instructor.getByTestId('instructor-profile')).toHaveAttribute('href', '/people/demo-two-lineages');
  await expect(instructor.getByTestId('instructor-list')).toHaveAttribute('href', '/people/demo-two-lineages/lineage');
  await expect(instructor.getByTestId('instructor-explorer')).toHaveAttribute('href', `/explore?focus=${personId}`);
  const jsonLd = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!) as { geo?: { latitude: number } };
  expect(jsonLd.geo?.latitude, 'an exact school has its point in JSON-LD').toEqual(expect.any(Number));

  // Each link opens its page.
  await instructor.getByTestId('instructor-profile').click();
  await page.waitForURL('**/people/demo-two-lineages');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goBack();
  await visible(page.locator('[data-testid="school-instructor"][data-slug="demo-two-lineages"]')).getByTestId('instructor-list').click();
  await page.waitForURL('**/people/demo-two-lineages/lineage');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goBack();
  await visible(page.locator('[data-testid="school-instructor"][data-slug="demo-two-lineages"]')).getByTestId('instructor-explorer').click();
  await page.waitForURL((url) => url.pathname === '/explore' && url.searchParams.get('focus') === personId);

  // The page's map link opens the finder on the school.
  await page.goto('/schools/demo-school-two-lineages');
  await visible(page.getByTestId('school-map-link')).click();
  await page.waitForURL(/\/schools\?/);
  await mapSettled(page);
  await expect(page.locator('[data-testid="school-marker"][data-slug="demo-school-two-lineages"]')).toBeVisible();
});

test('@M11 the map switches between the dark and light styles together with the theme', async ({ page }) => {
  const styleRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/map-styles/')) styleRequests.push(new URL(request.url()).pathname);
  });
  await openInTheme(page, '/schools', 'light');
  const map = await mapSettled(page, 'light');
  await expect(map).toHaveAttribute('data-theme-wanted', 'light');
  expect(styleRequests).toContain('/map-styles/light.json');

  // The shell's theme menu: Dark, then back to the system (light).
  const theme = visible(page.getByRole('combobox', { name: 'Theme' })).first();
  await theme.selectOption('dark');
  await expect.poll(() => resolvedTheme(page)).toBe('dark');
  await mapSettled(page, 'dark');
  expect(styleRequests).toContain('/map-styles/dark.json');
  await theme.selectOption('system');
  await mapSettled(page, 'light');

  // The system's colour scheme, followed while the menu says System.
  await switchColorScheme(page, 'dark');
  await mapSettled(page, 'dark');
  await switchColorScheme(page, 'light');
  await mapSettled(page, 'light');
  // The markers stay through each change.
  expect((await markerSlugs(page)).length).toBeGreaterThan(0);
});

test('@M11 no axe violations on the /schools list view and a school page in dark and light themes', async ({ page }) => {
  for (const theme of THEMES) {
    for (const path of ['/schools?view=list', '/schools?view=list&near=Sofia&radius=50', '/schools/demo-school-sofia', '/schools/demo-school-city-only']) {
      const response = await openInTheme(page, path, theme);
      expect(response?.status(), path).toBe(200);
      expect(await resolvedTheme(page)).toBe(theme);
      await expectNoAxeViolations(page, `${path} (${theme})`);
    }
    // The map view too, once the map has settled.
    await openInTheme(page, '/schools', theme);
    await mapSettled(page, theme);
    await expectNoAxeViolations(page, `/schools (${theme})`);
  }
});
