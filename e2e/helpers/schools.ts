// Schools and the map (milestone M11): the steps that e2e/m11-schools.spec.ts, the screen states of
// e2e/screenshots.spec.ts and the visual regression share. Accounts and schools are fictional
// (`demo-e2e-…@example.test`, `Demo …` names, D20); the schools of the tests are in Leipzig, far
// from the searches the read-only tests make (Sofia, Plovdiv).

import { randomUUID } from 'node:crypto';

import { expect, type APIRequestContext, type Browser, type Locator, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../../src/server/db';
import { BASE_URL, giveOwnAddress, signInAs, signInWithPassword, userIdOf, type SignInTarget } from './auth';
import { letters } from './evidence';
import { apiPost } from './plans';

/** A visible element (Next.js keeps earlier routes in the document, hidden). */
export const visible = (locator: Locator) => locator.filter({ visible: true });
const capital = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/** Where the schools of the tests are: Leipzig (DE), a listed city far from the other searches. */
export const LEIPZIG = { lat: 51.3401, lng: 12.375 };

export interface PointRow {
  lat: number;
  lng: number;
}

/** The map has loaded its style (the one given, if any) and its view has stopped moving. */
export async function mapSettled(page: Page, style?: 'light' | 'dark'): Promise<Locator> {
  const map = page.getByTestId('school-map');
  await expect(map).toHaveAttribute('data-map-style', style ?? /^(light|dark)$/, { timeout: 20_000 });
  await expect(map).toHaveAttribute('data-moving', 'false');
  return map;
}

/** The slugs of the map's markers, sorted. */
export async function markerSlugs(page: Page): Promise<string[]> {
  return (await page.getByTestId('school-marker').evaluateAll((items) => items.map((item) => item.getAttribute('data-slug') ?? ''))).sort();
}

/** A city of the GeoNames extract by name: its id and centroid (GET /api/v1/places/search). */
export async function placeOf(request: APIRequestContext, name: string, countryCode: string): Promise<{ id: string; point: PointRow }> {
  const response = await request.get(`${BASE_URL}/api/v1/places/search?q=${encodeURIComponent(name)}&countryCode=${countryCode}`);
  expect(response.status(), await response.text()).toBe(200);
  const { places } = (await response.json()) as { places: { id: string; name: string; point: PointRow }[] };
  const place = places.find((p) => p.name === name);
  expect(place, `${name}, ${countryCode} in the GeoNames extract`).toBeDefined();
  return place!;
}

export async function schoolRow(id: string) {
  const rows = await getDb().execute<{ slug: string; status: string; deleted_at: string | null }>(sql`
    SELECT slug, status, deleted_at FROM school WHERE id = ${id}::uuid`);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0]!;
}

/** The open review case of a school's listing. */
export async function listingCaseOf(schoolId: string): Promise<string> {
  const rows = await getDb().execute<{ id: string }>(sql`
    SELECT id::text AS id FROM review_case
     WHERE school_id = ${schoolId}::uuid AND kind = 'school_listing' AND status IN ('open', 'in_review', 'needs_info')`);
  expect(rows.rows, 'one open listing case').toHaveLength(1);
  return rows.rows[0]!.id;
}

export interface Sifu {
  email: string;
  password: string;
  userId: string;
  name: string;
}

/** A new confirmed Sifu account with a public profile, signed in on `page`. */
export async function sifuAccount(page: Page, label: string): Promise<Sifu> {
  const account = await signInAs(page, 'new');
  const name = `Demo ${label} ${capital(letters())}`;
  const onboard = await apiPost(page, '/account/onboard', { primaryName: name, showPublicly: true });
  expect(onboard.status(), await onboard.text()).toBe(200);
  const type = await apiPost(page, '/account/type', { accountType: 'sifu' });
  expect(type.status(), await type.text()).toBe(200);
  return { email: account.email, password: account.password, userId: (await userIdOf(account.email))!, name };
}

/** Another browser context with a client address of its own, signed in as nobody. */
export async function freshContext(browser: Browser) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(context);
  return { context, page: await context.newPage() };
}

/** Another browser context signed in as a seeded account or role. */
export async function signedIn(browser: Browser, target: SignInTarget) {
  const fresh = await freshContext(browser);
  await signInAs(fresh.page, target);
  return fresh;
}

/** A Professional Sifu test plan for `email`, given by the seeded administrator through the API. */
export async function grantProSifu(admin: Page, email: string): Promise<string> {
  const given = await apiPost(admin, '/admin/grants/create', { email, planCode: 'pro_sifu', source: 'test_grant', reason: 'Demo pilot test of a school listing' });
  expect(given.status(), await given.text()).toBe(200);
  return ((await given.json()) as { id: string }).id;
}

/** A new exact-location school in Leipzig through the API, as the Sifu signed in on `page`. */
export async function createSchool(page: Page, name = `Demo Kwoon Leipzig ${capital(letters())}`): Promise<{ id: string; slug: string; name: string }> {
  const leipzig = await placeOf(page.request, 'Leipzig', 'DE');
  const created = await apiPost(page, '/schools/create', {
    name,
    placeId: leipzig.id,
    locationPrivacy: 'exact',
    point: LEIPZIG,
    websiteUrl: 'https://example.test/demo-school',
    contactEmail: 'demo-e2e-school@example.test',
    contactPhone: null,
    description: 'A fictional school of the tests.',
    formsTaught: ['siu_nim_tao', 'chum_kiu'],
    instructorIds: [],
    idempotencyKey: randomUUID(),
  });
  expect(created.status(), await created.text()).toBe(200);
  const { id } = (await created.json()) as { id: string };
  return { id, slug: (await schoolRow(id)).slug, name };
}

/** review.decide verify (approve the listing) by the seeded administrator, through the API. */
export async function approveListing(admin: Page, schoolId: string) {
  const caseId = await listingCaseOf(schoolId);
  // A decision carries the version of the listing the reviewer saw (review.get), as the case card does.
  const opened = await admin.request.get(`/api/v1/review/${caseId}`, { headers: { origin: BASE_URL } });
  expect(opened.status(), await opened.text()).toBe(200);
  const schoolVersion = ((await opened.json()) as { school: { version: string } }).school.version;
  const decided = await apiPost(admin, '/review/decide', { caseId, decision: 'verify', reason: null, idempotencyKey: randomUUID(), schoolVersion });
  expect(decided.status(), await decided.text()).toBe(200);
}

/**
 * A new Sifu on `page` with a school sent for the listing review: the administrator gives the
 * Professional Sifu test plan first, on `admin` when given (a page already signed in as the seeded
 * administrator), else in another context of the same browser. Nothing becomes public.
 */
export async function pendingListing(page: Page, admin?: Page): Promise<{ sifu: Sifu; school: { id: string; slug: string; name: string }; caseId: string }> {
  const sifu = await sifuAccount(page, 'Listing Sifu');
  if (admin) {
    await grantProSifu(admin, sifu.email);
  } else {
    // Each staff sign-in takes one TOTP code, which the parallel workers share (e2e/helpers/auth.ts).
    const other = await signedIn(page.context().browser()!, 'admin');
    try {
      await grantProSifu(other.page, sifu.email);
    } finally {
      await other.context.close();
    }
  }
  const school = await createSchool(page);
  const sent = await apiPost(page, '/schools/submit', { id: school.id });
  expect(sent.status(), await sent.text()).toBe(200);
  return { sifu, school, caseId: await listingCaseOf(school.id) };
}

/** Signs `page` back in as `sifu` (after it signed in as someone else). */
export function signInAgain(page: Page, sifu: Sifu) {
  return signInWithPassword(page, sifu.email, sifu.password);
}

/** A screen of the finder reached by steps (the map needs to settle first). */
export interface SchoolScreen {
  name: string;
  reach: (page: Page) => Promise<void>;
}

/**
 * The finder's map view as screens: all public schools, and one selected near Sofia (on a phone,
 * with the sheet open at its lowest snap point). The visual regression masks the map's canvas
 * (WebGL drawing); the markers, the list and the sheet are compared.
 */
export const SCHOOL_MAP_SCREENS: readonly SchoolScreen[] = [
  {
    name: 'schools-map',
    async reach(page) {
      await page.goto('/schools');
      await mapSettled(page);
    },
  },
  {
    name: 'schools-map-selected',
    async reach(page) {
      await page.goto('/schools?near=Sofia&radius=50');
      await mapSettled(page);
      await page.locator('[data-testid="school-marker"][data-slug="demo-school-sofia"]').click();
      await expect(page.locator('[data-testid="school-marker"][data-slug="demo-school-sofia"]')).toHaveAttribute('aria-pressed', 'true');
      if (await page.evaluate(() => !matchMedia('(min-width: 64rem)').matches)) await expect(page.getByTestId('school-sheet')).toBeVisible();
      await mapSettled(page);
    },
  },
];
