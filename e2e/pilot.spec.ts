/**
 * Milestone M13: the pilot path of plan §2.2 from end to end (Done when 2), on the desktop and on a
 * phone: desktop-chromium and mobile-chromium everywhere, mobile-webkit in CI. The flows run through
 * the real pages against `next start` and the worker; the database is read only to check what the
 * pages cannot show (a relationship's state, the private point of a city-only school, the key of a
 * stored file).
 *
 * The tests make links public and change seeded demo accounts (demo-two-lineages becomes a
 * Professional Sifu with more students), which would change the public pages the other specs and
 * the visual regression compare: they run in the `pilot` run, a Playwright run of their own after
 * the ordinary and the exclusive ones (PW_PILOT=1, e2e/projects.ts PILOT_SPEC; scripts/verify.sh
 * runs all three). Every test makes its own people (`demo-e2e-…@example.test` accounts with
 * fictional `Demo …` names, D20), so the three projects can run them side by side.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { demoAccountEmail, DEMO_PERSON_ACCOUNT_SLUGS } from '../src/fixtures/generate';
import { getDb } from '../src/server/db';
import { BASE_URL, closeHelpers, emailLinkFromOutbox, giveOwnAddress, loadTestEnv, NEW_ACCOUNT_PASSWORD, signInAs, uniqueEmail, userIdOf, type SignInTarget } from './helpers/auth';
import { claimThroughApi } from './helpers/evidence';
import { captureScenes, personNameOf, sceneOf } from './helpers/explorer-checks';
import { edgesInto, lineageIdOf, nodeOf, openExplorer, personIdOf } from './helpers/explorer';
import { apiPost } from './helpers/plans';
import { openPalette, option, search, searchInput } from './helpers/search';
import { runPaths } from './projects';
import { ROUTES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  // Rate limits are per client address: each test is its own client.
  await giveOwnAddress(context);
});

const LINEAGE_A = 'Demo Lineage A';
const LINEAGE_B = 'Demo Lineage B';
const SIGN_UP_CONSENTS = ['I am 18 or older.', 'I accept the terms of use.', /I will record only what I believe to be true/, /I have read the privacy notice\./] as const;

/** Letters only, so a name stays a Latin-script name; unique enough to find one person. */
function token(length = 7): string {
  return Array.from(randomBytes(length), (byte) => String.fromCharCode(97 + (byte % 26))).join('');
}
const capital = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/** A visible element (Next.js keeps earlier routes in the document, hidden). */
const visible = (locator: Locator) => locator.filter({ visible: true });
const field = (scope: Page | Locator, label: string | RegExp, exact = typeof label === 'string') => visible(scope.getByLabel(label, { exact }));

/** The context's own viewport and device (desktop or phone), for another account in the same test. */
async function sameDevice(browser: Browser, page: Page): Promise<BrowserContext> {
  const viewport = page.viewportSize();
  const mobile = (viewport?.width ?? 1440) < 768;
  const context = await browser.newContext({ baseURL: BASE_URL, ...(viewport ? { viewport } : {}), ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  await giveOwnAddress(context);
  return context;
}

interface Member {
  context: BrowserContext;
  page: Page;
  email: string;
  userId: string;
  name: string;
  /** The part of the name only this person has: what the palette is searched for. */
  find: string;
  personId: string;
  slug: string;
}

/**
 * A new confirmed account in a browser context of its own (the test's device), with a profile made
 * as onboarding makes it (public unless `hidden`), and a Sifu account when `sifu` is set.
 */
async function member(browser: Browser, device: Page, label: string, options: { sifu?: boolean; hidden?: boolean } = {}): Promise<Member> {
  const context = await sameDevice(browser, device);
  const page = await context.newPage();
  const account = await signInAs(page, 'new');
  const find = token();
  const name = `Demo ${label} ${capital(find)}`;
  const onboard = await apiPost(page, '/account/onboard', { primaryName: name, showPublicly: !options.hidden });
  expect(onboard.status(), await onboard.text()).toBe(200);
  if (options.sifu) {
    const type = await apiPost(page, '/account/type', { accountType: 'sifu' });
    expect(type.status(), await type.text()).toBe(200);
  }
  const userId = (await userIdOf(account.email))!;
  return { context, page, email: account.email, userId, name, find, ...(await ownPerson(userId)) };
}

async function ownPerson(userId: string): Promise<{ personId: string; slug: string }> {
  const rows = await getDb().execute<{ id: string; slug: string }>(sql`
    SELECT id::text AS id, slug FROM person WHERE claimed_by_user_id = ${userId}::uuid AND deleted_at IS NULL`);
  expect(rows.rows).toHaveLength(1);
  return { personId: rows.rows[0]!.id, slug: rows.rows[0]!.slug };
}

/** Another context on the test's device, signed in as a seeded account or role. */
async function signedIn(browser: Browser, device: Page, target: SignInTarget): Promise<{ context: BrowserContext; page: Page }> {
  const context = await sameDevice(browser, device);
  const page = await context.newPage();
  await signInAs(page, target);
  return { context, page };
}

/** Chooses `teacher` in the request form with the palette in select mode. */
async function chooseTeacher(page: Page, teacher: { name: string; find: string }) {
  // The button needs the form's island: press it until the palette opens.
  const input = page.getByRole('combobox', { name: 'Choose your teacher' });
  await expect(async () => {
    await visible(page.getByRole('button', { name: /^(Find your teacher|Choose another teacher)$/ })).click();
    await expect(input).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/rpc/search/query');
  await input.fill(teacher.find);
  expect((await answered).status()).toBe(200);
  await page.getByTestId('search-palette').getByRole('option').filter({ hasText: teacher.name }).first().click();
  await expect(input).toBeHidden();
  await expect(visible(page.getByTestId('chosen-teacher'))).toContainText(teacher.name);
}

/** Sends a request to `teacher` through /dashboard/teachers/new; returns the relationship's id. */
async function requestTeacher(page: Page, teacher: { name: string; find: string }, lineage: string): Promise<string> {
  await page.goto('/dashboard/teachers/new');
  await chooseTeacher(page, teacher);
  await field(page, /^Lineage of this training/, false).selectOption({ label: lineage });
  await field(page, 'Started (year)').fill('2019');
  await visible(page.getByRole('checkbox', { name: 'I still train with this teacher' })).check();
  await visible(page.getByRole('button', { name: 'Send the request' })).click();
  await page.waitForURL(/\/dashboard\/teachers\?sent=/);
  await expect(visible(page.getByTestId('request-sent'))).toContainText(teacher.name);
  return new URL(page.url()).searchParams.get('sent')!;
}

/** The row of a waiting request on the teacher's /dashboard/students/requests. */
const requestRow = (page: Page, relationshipId: string) => visible(page.locator(`tr[data-relationship="${relationshipId}"]`));

/** Approves a request on /dashboard/students/requests, as the teacher signed in on `page`. */
async function approve(page: Page, relationshipId: string) {
  await page.goto('/dashboard/students/requests');
  await requestRow(page, relationshipId).getByRole('button', { name: /^Approve/ }).click();
  await page.waitForURL(/[?&]approved=/);
  await expect(visible(page.getByTestId('request-approved'))).toBeVisible();
}

async function relationshipRow(id: string) {
  const rows = await getDb().execute<{ status: string; visibility: string }>(sql`SELECT status, visibility FROM teaching_relationship WHERE id = ${id}::uuid`);
  return rows.rows[0];
}

/** The id of a lineage root (the value of the finder's Lineage filter). */
async function rootOf(lineageName: string): Promise<string> {
  const rows = await getDb().execute<{ id: string }>(sql`SELECT root_person_id::text AS id FROM lineage WHERE name = ${lineageName}`);
  expect(rows.rows, lineageName).toHaveLength(1);
  return rows.rows[0]!.id;
}

/** The finder's list view with a search by place, distance and lineage root; the slugs it lists. */
async function schoolsFound(page: Page, options: { near?: string; radius?: string; rootId: string }): Promise<string[]> {
  await page.goto('/schools?view=list');
  const form = page.getByRole('search', { name: 'Find a school' });
  if (options.near) await visible(form.getByLabel('Near')).fill(options.near);
  if (options.radius) await visible(form.getByLabel('Distance')).selectOption(options.radius);
  await visible(form.getByLabel('Lineage')).selectOption(options.rootId);
  await visible(form.getByRole('button', { name: 'Search' })).click();
  await page.waitForURL((url) => url.pathname === '/schools' && url.searchParams.get('lineage') === options.rootId);
  const rows = visible(page.getByTestId('school-row'));
  await expect(rows.first()).toBeVisible();
  return rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-slug') ?? ''));
}

/** The public edges into a person, as an anonymous web client reads them (lineage.ego). */
async function publicTeachersOf(request: APIRequestContext, personId: string): Promise<{ teacherId: string; lineageId: string; status: string }[]> {
  const response = await request.post(`${BASE_URL}/api/rpc/lineage/ego`, { data: { json: { focusId: personId, up: 1, down: 0 } }, headers: { origin: BASE_URL } });
  expect(response.status()).toBe(200);
  const edges = ((await response.json()) as { json: { edges: { teacherId: string; studentId: string; lineageId: string; status: string }[] } }).json.edges;
  return edges.filter((edge) => edge.studentId === personId);
}

test('@pilot register → onboarding → find a teacher with the palette → request → the teacher approves → the relationship shows in the profile, list view and explorer (opened focused from the palette) → find a school within 50 km in the teacher\'s lineage', async ({ page, browser, request }) => {
  test.setTimeout(240_000);
  const teacherSlug = 'demo-pro-sifu-8';
  const teacher = { name: await personNameOf(teacherSlug), find: await personNameOf(teacherSlug), id: await personIdOf(teacherSlug) };

  // The home page: the ways in.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(visible(page.locator('[data-home-search]'))).toBeVisible();
  await expect(visible(page.getByRole('link', { name: 'Explore the lineages' }))).toHaveAttribute('href', '/explore');
  await expect(visible(page.getByRole('link', { name: 'Find a school' }))).toHaveAttribute('href', '/schools');
  await visible(page.getByRole('link', { name: 'Create an account' })).click();
  await page.waitForURL((url) => url.pathname === '/sign-up');

  // Sign up, confirm the address from the e-mail, sign in.
  const email = uniqueEmail('pilot');
  await field(page, 'E-mail address').fill(email);
  await field(page, 'Password', true).fill(NEW_ACCOUNT_PASSWORD);
  for (const consent of SIGN_UP_CONSENTS) await field(page, consent).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check your inbox' })).toBeVisible();
  const link = new URL(await emailLinkFromOutbox('verify-email', email));
  await page.goto(link.pathname + link.search);
  await page.getByRole('button', { name: 'Confirm my address' }).click();
  await expect(page).toHaveURL(/\/sign-in\?verified=1$/);
  await expect(field(page, 'E-mail address')).toHaveValue(email);
  await field(page, 'Password', true).fill(NEW_ACCOUNT_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Onboarding: a Latin-script name, shown publicly.
  await expect(page).toHaveURL(/\/onboarding$/);
  const find = token();
  const name = `Demo Pilot ${capital(find)}`;
  await field(page, 'Name in Latin letters').fill(name);
  await field(page, 'Show my profile publicly').check();
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  const student = await ownPerson((await userIdOf(email))!);

  // The request: the teacher is found with the palette in the request form.
  const relationshipId = await requestTeacher(page, teacher, LINEAGE_B);
  expect(await relationshipRow(relationshipId)).toEqual({ status: 'pending_teacher', visibility: 'involved_only' });
  expect(await publicTeachersOf(request, student.personId)).toEqual([]);

  // The teacher approves it from their queue.
  const sifu = await signedIn(browser, page, teacherSlug);
  await approve(sifu.page, relationshipId);
  await sifu.context.close();
  expect(await relationshipRow(relationshipId)).toEqual({ status: 'verified', visibility: 'public' });
  expect((await publicTeachersOf(request, student.personId)).map((e) => [e.teacherId, e.lineageId, e.status])).toEqual([[teacher.id, await lineageIdOf('demo-lineage-b'), 'verified']]);

  // The student's own dashboard, the public profile and the list view show it.
  await page.goto('/dashboard/teachers');
  await expect(visible(page.locator(`li[data-relationship="${relationshipId}"]`))).toContainText('Verified');
  await page.goto(`/people/${student.slug}`);
  await expect(page.getByRole('list', { name: /^Teachers of / }).locator(`li[data-person="${teacherSlug}"]`)).toContainText('Verified');
  await page.goto(`/people/${student.slug}/lineage`);
  await expect(page.getByRole('main').getByRole('link', { name: teacher.name }).first()).toBeVisible();

  // The palette finds the student, and Ctrl/⌘+Enter opens the explorer focused on them, with the edge.
  await page.goto('/');
  await openPalette(page);
  await search(page, find);
  await expect(option(page, name).first()).toHaveAttribute('data-highlighted', '');
  await searchInput(page).press('ControlOrMeta+Enter');
  await page.waitForURL((url) => url.pathname === '/explore' && url.searchParams.get('focus') === student.personId);
  await expect(nodeOf(page, student.personId)).toBeVisible({ timeout: 30_000 });
  await expect(edgesInto(page, student.personId).and(page.locator(`[data-teacher="${teacher.id}"]`))).toHaveCount(1);

  // A school within 50 km of London in the teacher's lineage: the teacher's own city-only school.
  const found = await schoolsFound(page, { near: 'London', radius: '50', rootId: await rootOf(LINEAGE_B) });
  expect(found).toContain('demo-school-london');
});

test('@pilot an unrelated user cannot approve a claim or open evidence', async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  const [teacher, student, stranger] = await Promise.all([
    member(browser, page, 'Sifu', { sifu: true }),
    member(browser, page, 'Student'),
    member(browser, page, 'Stranger', { sifu: true }),
  ]);
  const relationshipId = await requestTeacher(student.page, teacher, LINEAGE_A);
  // A historical claim with a fictional certificate: a review case and a private file.
  const claim = await claimThroughApi(student.page, `Demo Historical ${capital(token())}`);

  // Approving the teacher request: the same answer as for no such request, and not in the queue.
  const refused = await apiPost(stranger.page, '/relationships/approve', { relationshipId, idempotencyKey: randomUUID() });
  expect(refused.status()).toBe(404);
  await stranger.page.goto('/dashboard/students/requests');
  await expect(visible(stranger.page.getByTestId('empty-student-requests'))).toBeVisible();
  await expect(stranger.page.locator(`tr[data-relationship="${relationshipId}"]`)).toHaveCount(0);
  // Deciding the historical claim is for reviewers only.
  const decided = await apiPost(stranger.page, '/review/decide', { caseId: claim.caseId, decision: 'verify', idempotencyKey: randomUUID() });
  expect(decided.status()).toBe(403);
  expect((await stranger.page.request.get(`/api/v1/review/${claim.caseId}`, { headers: { origin: BASE_URL } })).status()).toBe(403);
  // The claim's case is not the stranger's own.
  expect((await stranger.page.request.get(`/api/v1/cases/${claim.caseId}`, { headers: { origin: BASE_URL } })).status()).toBe(404);

  // The file: the uploader opens it; the stranger and an anonymous visitor get a 404.
  expect((await student.page.request.get(`/api/evidence/${claim.fileId}`)).status()).toBe(200);
  expect((await stranger.page.request.get(`/api/evidence/${claim.fileId}`)).status()).toBe(404);
  expect((await request.get(`${BASE_URL}/api/evidence/${claim.fileId}`)).status()).toBe(404);

  // Nothing changed.
  expect(await relationshipRow(relationshipId)).toEqual({ status: 'pending_teacher', visibility: 'involved_only' });
  expect(await relationshipRow(claim.relationshipId)).toMatchObject({ visibility: 'involved_only' });
  const cases = await getDb().execute<{ status: string }>(sql`SELECT status FROM review_case WHERE id = ${claim.caseId}::uuid`);
  expect(cases.rows[0]?.status).toBe('open');
  await Promise.all([teacher.context.close(), student.context.close(), stranger.context.close()]);
});

test('@pilot a teacher with students in two active lineages sees and manages both', async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  const [teacher, inA, inB] = await Promise.all([
    member(browser, page, 'Sifu', { sifu: true }),
    member(browser, page, 'Student'),
    member(browser, page, 'Student'),
  ]);
  const toA = await requestTeacher(inA.page, teacher, LINEAGE_A);
  const toB = await requestTeacher(inB.page, teacher, LINEAGE_B);

  // Both requests in the teacher's queue, each with its student and its lineage.
  await teacher.page.goto('/dashboard/students/requests');
  for (const [id, who, lineage] of [
    [toA, inA, LINEAGE_A],
    [toB, inB, LINEAGE_B],
  ] as const) {
    await expect(requestRow(teacher.page, id)).toContainText(who.name);
    await expect(requestRow(teacher.page, id)).toContainText(lineage);
  }

  // Approving each one: both students listed with their lineage, and the training can be ended.
  await approve(teacher.page, toA);
  await approve(teacher.page, toB);
  const students = visible(teacher.page.getByTestId('student'));
  for (const [id, who, lineage] of [
    [toA, inA, LINEAGE_A],
    [toB, inB, LINEAGE_B],
  ] as const) {
    const row = students.and(teacher.page.locator(`[data-relationship="${id}"]`));
    await expect(row).toContainText(who.name);
    await expect(row).toContainText(lineage);
    await expect(row.getByText('Mark training as ended…')).toBeVisible();
    expect(await relationshipRow(id)).toEqual({ status: 'verified', visibility: 'public' });
  }

  // On the public profile: both students.
  const anonymous = await sameDevice(browser, page);
  const profile = await anonymous.newPage();
  await profile.goto(`/people/${teacher.slug}`);
  const list = profile.getByRole('list', { name: /^Students of / });
  for (const who of [inA, inB]) await expect(list.locator(`li[data-person="${who.slug}"]`)).toContainText('Verified');
  const lineages = new Map([
    [inA.personId, await lineageIdOf('demo-lineage-a')],
    [inB.personId, await lineageIdOf('demo-lineage-b')],
  ]);
  for (const who of [inA, inB]) expect((await publicTeachersOf(request, who.personId)).map((e) => [e.teacherId, e.lineageId])).toEqual([[teacher.personId, lineages.get(who.personId)]]);
  await Promise.all([anonymous.close(), teacher.context.close(), inA.context.close(), inB.context.close()]);
});

test('@pilot a teacher with two active verified teachers in different lineages appears in both lineage views, approves one student in each lineage, and their school is returned by the lineage filter of both roots', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const slug = 'demo-two-lineages';
  const teacher = { name: await personNameOf(slug), find: await personNameOf(slug), id: await personIdOf(slug) };

  // In the Lineage view of both lineages, from each root.
  await captureScenes(page);
  for (const lineage of ['demo-lineage-a', 'demo-lineage-b']) {
    const root = (await getDb().execute<{ id: string }>(sql`SELECT root_person_id::text AS id FROM lineage WHERE slug = ${lineage}`)).rows[0]!.id;
    await openExplorer(page, { focus: root, lineage: await lineageIdOf(lineage) });
    const scene = await sceneOf(page, root);
    expect(scene.nodes.map((n) => n.id), `${slug} in the Lineage view of ${lineage}`).toContain(teacher.id);
  }

  // As a Sifu with a Professional Sifu plan (the Free Sifu limit would stop the third and later
  // approvals of the three projects): the account type is the account's own choice, the plan the
  // administrator's. Another project may have done both already.
  const own = await signedIn(browser, page, slug);
  const type = await apiPost(own.page, '/account/type', { accountType: 'sifu' });
  expect(type.status(), await type.text()).toBe(200);
  const admin = await signedIn(browser, page, 'admin');
  const granted = await apiPost(admin.page, '/admin/grants/create', { email: demoAccountEmail(slug), planCode: 'pro_sifu', source: 'test_grant', reason: 'Demo pilot: a teacher in two lineages' });
  expect([200, 409], await granted.text()).toContain(granted.status());
  await admin.context.close();

  // One new student in each lineage; the teacher approves both.
  const [inA, inB] = await Promise.all([member(browser, page, 'Student'), member(browser, page, 'Student')]);
  const toA = await requestTeacher(inA.page, teacher, LINEAGE_A);
  const toB = await requestTeacher(inB.page, teacher, LINEAGE_B);
  await approve(own.page, toA);
  await approve(own.page, toB);
  for (const id of [toA, toB]) expect(await relationshipRow(id)).toEqual({ status: 'verified', visibility: 'public' });
  await own.page.goto(`/people/${slug}`);
  const list = own.page.getByRole('list', { name: /^Students of / });
  for (const who of [inA, inB]) await expect(list.locator(`li[data-person="${who.slug}"]`)).toContainText('Verified');

  // Their school, by the lineage filter of either root.
  for (const lineage of [LINEAGE_A, LINEAGE_B]) {
    expect(await schoolsFound(page, { rootId: await rootOf(lineage) }), lineage).toContain('demo-school-two-lineages');
  }
  await Promise.all([own.context.close(), inA.context.close(), inB.context.close()]);
});

// --- The leak scan ------------------------------------------------------------------------------

/** Paths an anonymous visitor may open, and the crawl follows (not the account and staff pages). */
const CRAWLED = /^\/(?:$|people\/|schools(?:\/|\?|$)|explore(?:\?|$)|plans$|legal\/)/;
const CRAWL_LIMIT = 400;

/**
 * Every way a coordinate could be written with 4 or 5 decimals (about 10 m to 1 m). Only forms that
 * keep at least 4 decimals: a shorter one ("42.7") also turns up in unrelated numbers of a page.
 */
const coordinateForms = (value: number) => [String(value), value.toFixed(5), value.toFixed(4), String(Number(value.toFixed(5)))].filter((form) => /\.\d{4,}$/.test(form));

test('@pilot leak scan: an anonymous crawl of all public routes, the sitemap, Open Graph and JSON-LD finds no private fields, pending edges, involved-only persons, city-only coordinates or evidence keys', async ({ page, browser, request }) => {
  test.setTimeout(300_000);
  // What must never be public: a pending edge between two public people, a hidden person with a
  // historical claim and its certificate, and the accounts behind them.
  const [teacher, pendingStudent, hidden] = await Promise.all([
    member(browser, page, 'Sifu', { sifu: true }),
    member(browser, page, 'Student'),
    member(browser, page, 'Hidden', { hidden: true }),
  ]);
  const pendingId = await requestTeacher(pendingStudent.page, teacher, LINEAGE_A);
  const historicalName = `Demo Historical ${capital(token())}`;
  const claim = await claimThroughApi(hidden.page, historicalName);
  const db = getDb();
  const historical = (await db.execute<{ id: string; slug: string }>(sql`
    SELECT p.id::text AS id, p.slug FROM teaching_relationship r JOIN person p ON p.id = r.teacher_person_id WHERE r.id = ${claim.relationshipId}::uuid`)).rows[0]!;
  const file = (await db.execute<{ storage_key: string; sha256: string }>(sql`SELECT storage_key, sha256 FROM evidence_file WHERE id = ${claim.fileId}::uuid`)).rows[0]!;

  const secrets: [string, string][] = [
    ['pending edge', pendingId],
    ['hidden person name', hidden.name],
    ['hidden person slug', hidden.slug],
    ['hidden person id', hidden.personId],
    ['historical person name', historicalName],
    ['historical person slug', historical.slug],
    ['historical person id', historical.id],
    ['claim', claim.relationshipId],
    ['review case', claim.caseId],
    ['evidence id', claim.fileId],
    ['evidence key', file.storage_key],
    ['evidence hash', file.sha256],
    ['user id', teacher.userId],
    ['user id', hidden.userId],
    ...[teacher, pendingStudent, hidden].map((m): [string, string] => ['e-mail address', m.email]),
    ...DEMO_PERSON_ACCOUNT_SLUGS.map((s): [string, string] => ['e-mail address', demoAccountEmail(s)]),
  ];
  // The private point and address of every city-only school, in every form but the city centre's.
  const cityOnly = await db.execute<{ slug: string; lat: number; lng: number; address: string | null; city_lat: number; city_lng: number }>(sql`
    SELECT s.slug, ST_Y(l.exact_point::geometry) AS lat, ST_X(l.exact_point::geometry) AS lng, l.address_line AS address,
           ST_Y(p.centroid::geometry) AS city_lat, ST_X(p.centroid::geometry) AS city_lng
      FROM school s JOIN school_private_location l ON l.school_id = s.id JOIN place p ON p.id = s.place_id
     WHERE s.location_privacy = 'city_only' AND s.status = 'active' AND s.deleted_at IS NULL`);
  expect(cityOnly.rows.map((s) => s.slug)).toEqual(expect.arrayContaining(['demo-school-city-only', 'demo-school-london']));
  for (const school of cityOnly.rows) {
    const publicForms = [...coordinateForms(school.city_lat), ...coordinateForms(school.city_lng)];
    for (const form of new Set([...coordinateForms(school.lat), ...coordinateForms(school.lng)])) {
      if (!publicForms.some((p) => p.includes(form))) secrets.push([`exact point of ${school.slug}`, form]);
    }
    if (school.address) secrets.push([`address of ${school.slug}`, school.address]);
  }

  // The crawl: every anonymous route, the sitemap and robots.txt, the pages of the people in the
  // test, and every public page linked from them, as an anonymous client reads them.
  const queue: string[] = [];
  const seen = new Set<string>();
  const add = (path: string) => {
    if (seen.has(path) || seen.size >= CRAWL_LIMIT) return;
    seen.add(path);
    queue.push(path);
  };
  const expectedStatus = new Map<string, number>();
  for (const route of ROUTES) {
    if (route.signInAs) continue;
    expectedStatus.set(route.path, route.status);
    add(route.path);
  }
  for (const m of [teacher, pendingStudent]) for (const path of [`/people/${m.slug}`, `/people/${m.slug}/lineage`]) add(path);
  const sitemap = await request.get(`${BASE_URL}/sitemap.xml`);
  expect(sitemap.status()).toBe(200);
  const sitemapText = await sitemap.text();
  const sitemapPaths = [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
  expect(sitemapPaths.length).toBeGreaterThan(2);
  for (const path of sitemapPaths) add(path);
  const robots = await request.get(`${BASE_URL}/robots.txt`);
  const documents: [string, string][] = [
    ['/sitemap.xml', sitemapText],
    ['/robots.txt', robots.status() === 200 ? await robots.text() : ''],
  ];

  let openGraph = 0;
  let jsonLd = 0;
  const failures: string[] = [];
  const worker = async () => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      const response = await request.get(`${BASE_URL}${path}`, { maxRedirects: 0 });
      const status = response.status();
      const want = expectedStatus.get(path);
      if (want !== undefined ? status !== want : ![200, 404].includes(status)) failures.push(`${path}: status ${status}`);
      if (!(response.headers()['content-type'] ?? '').includes('text/html')) continue;
      const html = await response.text();
      documents.push([path, html]);
      openGraph += (html.match(/<meta property="og:/g) ?? []).length;
      for (const block of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
        jsonLd += 1;
        try {
          JSON.parse(block[1]!);
        } catch {
          failures.push(`${path}: JSON-LD that does not parse`);
        }
      }
      for (const match of html.matchAll(/href="(\/[^"#]*)"/g)) {
        const href = match[1]!.replaceAll('&amp;', '&');
        if (CRAWLED.test(href) && !href.endsWith('/report')) add(href);
      }
    }
  };
  // A few readers at once; the queue grows as pages are read, so the readers start again until it stays empty.
  while (queue.length > 0) await Promise.all(Array.from({ length: 4 }, worker));
  expect(failures).toEqual([]);
  expect(documents.length, 'pages read').toBeGreaterThan(50);
  expect(openGraph, 'Open Graph tags read').toBeGreaterThan(0);
  expect(jsonLd, 'JSON-LD blocks read').toBeGreaterThan(0);

  const leaks: string[] = [];
  for (const [path, text] of documents) for (const [what, secret] of secrets) if (text.includes(secret)) leaks.push(`${path}: ${what}`);
  expect(leaks).toEqual([]);

  // The pending edge between two public people: in neither profile nor list view.
  for (const [path, other] of [
    [`/people/${teacher.slug}`, pendingStudent],
    [`/people/${teacher.slug}/lineage`, pendingStudent],
    [`/people/${pendingStudent.slug}`, teacher],
    [`/people/${pendingStudent.slug}/lineage`, teacher],
  ] as const) {
    const html = documents.find(([p]) => p === path)?.[1];
    expect(html, path).toBeDefined();
    expect(html!.includes(other.slug) || html!.includes(other.name), `${path} names the other side of a pending request`).toBe(false);
  }
  // Nor in the server log of this run (CLAUDE.md §6: no personal data, coordinates or keys in logs).
  const log = runPaths('pilot').serverLog;
  if (existsSync(log)) {
    const text = readFileSync(log, 'utf8');
    expect(secrets.filter(([, secret]) => text.includes(secret)).map(([what]) => `${log}: ${what}`)).toEqual([]);
  }
  // The hidden and the historical person: no page of their own.
  for (const path of [`/people/${hidden.slug}`, `/people/${historical.slug}`]) expect((await request.get(`${BASE_URL}${path}`)).status(), path).toBe(404);
  await Promise.all([teacher.context.close(), pendingStudent.context.close(), hidden.context.close()]);
});
