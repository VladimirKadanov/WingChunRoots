/**
 * Milestone M04: the lineage API, the public profile and the list view (Done when 2). Runs
 * against `next start` and the seeded fixture (seed 20261016, docs/data-model.md): every person
 * is fictional, with a `demo-` slug. The server runs with WCR_TEST_FAULTS=lineage-once on a
 * loopback APP_URL (playwright.config.ts), so a request with the test fault cookie fails its
 * first lineage read once (src/server/faults.ts).
 */

import { randomUUID } from 'node:crypto';

import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv, signInAs } from './helpers/auth';
import { expectNoAxeViolations, openInTheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  // Rate limits are per client address: each test is its own client.
  await giveOwnAddress(context);
});

interface Profile {
  id: string;
  slug: string;
  displayName: string;
  counts: { teachers: number; students: number; descendants: number; descendantsCapped: boolean };
}
interface Edge {
  id: string;
  teacherId: string;
  studentId: string;
  status: string;
  visibility: string;
}
interface Graph {
  nodes: { id: string; slug: string; childCount: number; visibility: string }[];
  edges: Edge[];
  hiddenCounts: Record<string, { teachers: number; students: number }>;
}

/** A person's public profile through the OpenAPI handler (anonymous unless `request` is signed in). */
async function profileOf(request: APIRequestContext, slug: string): Promise<Profile> {
  const response = await request.get(`${BASE_URL}/api/v1/people/${slug}`);
  expect(response.status(), `GET /api/v1/people/${slug}`).toBe(200);
  return (await response.json()) as Profile;
}

/** lineage.ego through /api/rpc, as the web client calls it (same origin: CSRF, docs/adr/0004-auth.md). */
async function egoOf(request: APIRequestContext, input: Record<string, unknown>): Promise<Graph> {
  const response = await request.post(`${BASE_URL}/api/rpc/lineage/ego`, { data: { json: input }, headers: { origin: BASE_URL } });
  expect(response.status(), 'POST /api/rpc/lineage/ego').toBe(200);
  return ((await response.json()) as { json: Graph }).json;
}

/** A browser context with JavaScript off, for the pages that must work without it (plan §4.10). */
async function withoutJavaScript(browser: Browser, run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: BASE_URL });
  try {
    await giveOwnAddress(context);
    await run(await context.newPage());
  } finally {
    await context.close();
  }
}

/** The statuses only the participants of a relationship ever see (DEFAULT D03). */
const NOT_PUBLIC = ['pending_teacher', 'awaiting_claim', 'under_review', 'rejected', 'withdrawn', 'revoked'];

test('@M04 profile of demo-two-lineages lists two teachers from different lineages with status text', async ({ page }) => {
  await page.goto('/people/demo-two-lineages');
  const name = page.getByRole('heading', { level: 1 });
  await expect(name).toBeVisible();
  // Names are never translated and carry their language (plan §5.3).
  await expect(name.locator('[translate="no"][lang]').first()).toBeVisible();

  const teachers = page.getByRole('list', { name: /^Teachers of / });
  const rows = teachers.getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'Demo Lineage A' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Demo Lineage B' })).toHaveCount(1);
  for (const row of await rows.all()) {
    // The state is a word next to its seal, never colour alone.
    await expect(row.getByText('Verified', { exact: true })).toBeVisible();
    await expect(row.getByRole('link').first()).toHaveAttribute('href', /^\/people\/demo-/);
  }
  // The teacher from the other lineage is marked as such, in words.
  await expect(rows.filter({ hasText: 'Demo Lineage B' }).getByText('Cross-lineage', { exact: true })).toBeVisible();
  // Links to the explorer and to the list view.
  const views = page.getByRole('navigation', { name: 'Views of this person' });
  await expect(views.getByRole('link', { name: 'Graph' })).toHaveAttribute('href', /^\/explore\?focus=[0-9a-f-]{36}$/);
  await expect(views.getByRole('link', { name: 'List' })).toHaveAttribute('href', '/people/demo-two-lineages/lineage');
});

test('@M04 list view shows the routes of descent with JavaScript disabled', async ({ browser }) => {
  await withoutJavaScript(browser, async (page) => {
    await page.goto('/people/demo-two-lineages/lineage');
    const focus = (await page.getByRole('heading', { level: 1 }).locator('[lang="und-Latn"]').first().textContent())!.trim();
    await expect(page.getByRole('heading', { level: 2, name: 'Routes of descent' })).toBeVisible();
    const routes = page.getByRole('list', { name: `Routes of descent to ${focus}` });
    const each = routes.locator(':scope > li');
    // One route through each of the two lineages, the display-primary one first (DEFAULT D05).
    await expect(each).toHaveCount(2);
    await expect(each.first().getByRole('heading', { level: 3 })).toContainText('primary line');
    for (const route of await each.all()) {
      const steps = route.getByRole('list').getByRole('listitem');
      expect(await steps.count()).toBeGreaterThanOrEqual(2);
      await expect(steps.last()).toContainText(focus);
      await expect(steps.nth(1)).toContainText('Student of');
    }
    // Teachers, students and descendants are there too, server-rendered.
    await expect(page.getByRole('list', { name: `Teachers of ${focus}` }).getByRole('listitem')).toHaveCount(2);
    await expect(page.getByRole('heading', { level: 2, name: 'Students' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Descendants' })).toBeVisible();
  });
});

test('@M04 with JavaScript disabled the descendants outline uses details and summary and contains no role=tree', async ({ browser }) => {
  await withoutJavaScript(browser, async (page) => {
    await page.goto('/people/demo-root-a/lineage');
    const outline = page.getByRole('list', { name: 'Descendants' });
    await expect(outline).toBeVisible();
    await expect(page.locator('[role="tree"], [role="treeitem"], [role="group"][aria-expanded]')).toHaveCount(0);
    // Nested lists with <details>/<summary>, open on the server for two generations.
    const details = outline.locator('details');
    expect(await details.count()).toBeGreaterThan(1);
    const first = outline.locator(':scope > li > details').first();
    await expect(first).toHaveAttribute('open', '');
    await expect(first.locator(':scope > summary')).toBeVisible();
    await expect(first.locator(':scope > ul > li').first().getByRole('link').first()).toBeVisible();
    // The third generation waits behind a closed <details>, which opens without JavaScript.
    const index = await details.evaluateAll((all) => all.findIndex((d) => !(d as HTMLDetailsElement).open));
    expect(index).toBeGreaterThan(0);
    const closed = details.nth(index);
    await expect(closed.locator(':scope > ul')).toBeHidden();
    await closed.locator(':scope > summary').click();
    await expect(closed).toHaveAttribute('open', '');
    await expect(closed.locator(':scope > ul').getByRole('link').first()).toBeVisible();
  });
});

test('@M04 anonymous viewer never receives pending or under-review edges (HTML and API)', async ({ page, request }) => {
  const hub = await profileOf(request, 'demo-hub-a');
  // API: the ego network of the hub with every student, and of a person with an under-review link.
  const graph = await egoOf(request, { focusId: hub.id, up: 2, down: 2, fanoutLimit: 100 });
  expect(graph.edges.length).toBeGreaterThan(0);
  for (const edge of graph.edges) {
    expect(edge.visibility).toBe('public');
    expect(NOT_PUBLIC).not.toContain(edge.status);
  }
  const slugs = graph.nodes.map((n) => n.slug);
  for (const hidden of ['demo-pending', 'demo-claim-only-teacher', 'demo-under-review']) expect(slugs).not.toContain(hidden);
  expect(graph.nodes.every((n) => n.visibility === 'public')).toBe(true);

  // A hidden person answers exactly like an address that was never used (plan §6.4).
  const hidden = await request.get(`${BASE_URL}/api/v1/people/demo-claim-only-teacher`);
  const missing = await request.get(`${BASE_URL}/api/v1/people/demo-no-such-person`);
  expect(hidden.status()).toBe(404);
  expect(missing.status()).toBe(404);
  expect(await hidden.text()).toBe(await missing.text());

  // HTML: the hub's profile and list view name no hidden person and no unconfirmed state.
  for (const path of ['/people/demo-hub-a', '/people/demo-hub-a/lineage']) {
    const html = await (await request.get(`${BASE_URL}${path}`)).text();
    for (const hiddenSlug of ['demo-pending', 'demo-claim-only-teacher', 'demo-under-review']) expect(html, path).not.toContain(hiddenSlug);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/^(Pending|Under review)$/)).toHaveCount(0);
  }
  for (const path of ['/people/demo-claim-only-teacher', '/people/demo-under-review/lineage']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'No public profile at this address' })).toBeVisible();
  }
});

test('@M04 the involved student sees their own pending request marked "Pending"', async ({ page }) => {
  await signInAs(page, 'demo-pending');
  // On the teacher's public profile: the student's own request, first among the students.
  await page.goto('/people/demo-hub-a');
  const students = page.getByRole('list', { name: /^Students of / });
  const own = students.locator('li[data-person="demo-pending"]');
  await expect(own).toBeVisible();
  await expect(own.getByText('Pending', { exact: true })).toBeVisible();
  await expect(own).toContainText('Visible only to the two people in this request until it is confirmed.');
  await expect(students.getByRole('listitem').first()).toHaveAttribute('data-person', 'demo-pending');

  // On the student's own record, which only they (and the teacher) can open.
  await page.goto('/people/demo-pending');
  await expect(page.getByRole('note').filter({ hasText: 'Private record.' })).toBeVisible();
  const teacher = page.getByRole('list', { name: /^Teachers of / }).locator('li[data-person="demo-hub-a"]');
  await expect(teacher.getByText('Pending', { exact: true })).toBeVisible();
});

test('@M04 lineage.ego on demo-hub-a caps students and reports hiddenCounts', async ({ page, request }) => {
  const hub = await profileOf(request, 'demo-hub-a');
  expect(hub.counts.students).toBeGreaterThan(100);
  const graph = await egoOf(request, { focusId: hub.id, up: 0, down: 1, fanoutLimit: 10 });
  const shown = graph.edges.filter((e) => e.teacherId === hub.id);
  expect(shown).toHaveLength(10);
  expect(graph.hiddenCounts[hub.id]?.students).toBe(hub.counts.students - 10);
  const node = graph.nodes.find((n) => n.id === hub.id)!;
  expect(node.childCount).toBe(hub.counts.students);

  // The fan-out limit is bounded: a request over the ceiling is refused, not served.
  const tooMany = await request.post(`${BASE_URL}/api/rpc/lineage/ego`, {
    data: { json: { focusId: hub.id, fanoutLimit: 100_000 } },
    headers: { origin: BASE_URL },
  });
  expect(tooMany.status()).toBe(400);

  // The profile lists a few and links the rest to the list view.
  await page.goto('/people/demo-hub-a');
  await expect(page.getByRole('link', { name: `All ${hub.counts.students.toLocaleString('en')} students in the list view` })).toHaveAttribute(
    'href',
    '/people/demo-hub-a/lineage',
  );
});

test('@M04 a pending request to demo-hub-a does not change its hiddenCounts or descendant count for an anonymous viewer', async ({ page, request }) => {
  loadTestEnv();
  const hub = await profileOf(request, 'demo-hub-a');
  const db = getDb();
  // The fixture's pending request (demo-pending → demo-hub-a) is in the database ...
  const pending = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM teaching_relationship r JOIN person s ON s.id = r.student_person_id
    WHERE r.teacher_person_id = ${hub.id} AND r.status = 'pending_teacher' AND s.slug = 'demo-pending'`);
  expect(pending.rows[0]!.n).toBe(1);
  const publicStudents = await db.execute<{ n: number }>(sql`SELECT count(DISTINCT student_person_id)::int AS n FROM v_public_edge WHERE teacher_person_id = ${hub.id}`);

  // ... and counts nowhere for an anonymous viewer: counts come from public relationships only.
  expect(hub.counts.students).toBe(publicStudents.rows[0]!.n);
  const graph = await egoOf(request, { focusId: hub.id, up: 0, down: 1, fanoutLimit: 10 });
  expect(graph.hiddenCounts[hub.id]?.students).toBe(publicStudents.rows[0]!.n - 10);

  // The student who made the request sees it, but the counts stay the public ones.
  await signInAs(page, 'demo-pending');
  const own = await profileOf(page.request, 'demo-hub-a');
  expect(own.counts).toEqual(hub.counts);
  const ownGraph = await egoOf(page.request, { focusId: hub.id, up: 0, down: 1, fanoutLimit: 10 });
  expect(ownGraph.edges.some((e) => e.visibility === 'involved_only' && e.status === 'pending_teacher')).toBe(true);
  // Hidden = public students − public students shown: the own request takes a place in the list
  // but is never counted, shown or hidden.
  const publicShown = ownGraph.edges.filter((e) => e.teacherId === hub.id && e.visibility === 'public').length;
  expect(ownGraph.hiddenCounts[hub.id]?.students).toBe(publicStudents.rows[0]!.n - publicShown);
  expect(ownGraph.hiddenCounts[hub.id]?.teachers).toBe(graph.hiddenCounts[hub.id]?.teachers);
  expect(ownGraph.nodes.find((n) => n.id === hub.id)!.childCount).toBe(hub.counts.students);
});

test('@M04 a person with two teachers appears under both in the outline, marked "also a student of"', async ({ page, request }) => {
  const [primary, second] = await Promise.all([profileOf(request, 'demo-hub-a'), profileOf(request, 'demo-a-002')]);
  await page.goto('/people/demo-root-a/lineage');
  const outline = page.getByRole('list', { name: 'Descendants' });
  const mentions = outline.locator('li').filter({ has: page.locator(':scope > span > a[href="/people/demo-converging"]') });
  await expect(mentions).toHaveCount(2);
  await expect(mentions.locator('[data-also]').filter({ hasText: `(also a student of ${second.displayName})` })).toHaveCount(1);
  await expect(mentions.locator('[data-also]').filter({ hasText: `(also a student of ${primary.displayName})` })).toHaveCount(1);
  // Both mentions lead to the one profile.
  for (const mention of await mentions.all()) {
    await expect(mention.locator(':scope > span > a').first()).toHaveAttribute('href', '/people/demo-converging');
  }
});

test('@M04 when the lineage service fails once, the profile shows the catchError state with Retry, and Retry recovers', async ({ page, context }) => {
  await context.addCookies([{ name: 'wcr-test-fault', value: `lineage-once:${randomUUID()}`, url: BASE_URL }]);
  await page.goto('/people/demo-two-lineages');
  // The header stands; the lineage section shows the error state.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const error = page.getByRole('alert').filter({ hasText: 'The teachers and students could not be loaded.' });
  await expect(error).toBeVisible();
  await expect(page.getByRole('list', { name: /^Teachers of / })).toHaveCount(0);
  await error.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('list', { name: /^Teachers of / }).getByRole('listitem')).toHaveCount(2);
  await expect(error).toHaveCount(0);
});

test.describe('at 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('@M04 profile and list view at 390x844 have no horizontal scroll', async ({ page }) => {
    for (const path of ['/people/demo-two-lineages', '/people/demo-two-lineages/lineage', '/people/demo-root-a/lineage', '/people/demo-hub-a']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, path).toBeLessThanOrEqual(clientWidth);
    }
  });
});

test('@M04 no axe violations on the profile and list view in dark and light themes', async ({ page }) => {
  for (const path of ['/people/demo-two-lineages', '/people/demo-two-lineages/lineage', '/people/demo-root-a/lineage']) {
    for (const theme of THEMES) {
      const response = await openInTheme(page, path, theme);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 2, name: 'Teachers' })).toBeVisible();
      await expectNoAxeViolations(page, `${path} (${theme})`);
    }
  }
});
