/**
 * Milestone M04: the lineage API, the public profile and the list view (Done when 2). Runs
 * against `next start` and the seeded fixture (seed 20261016, docs/data-model.md): every person
 * is fictional, with a `demo-` slug. The E2E build runs with WCR_TEST_FAULTS=lineage-once,person-once
 * on a loopback APP_URL (playwright.config.ts), so a request with the test fault cookie fails its
 * first lineage read, or its first profile read, once (src/server/faults.ts).
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

/** The HTML of a page and its status, without the scripts (they carry the requested address for the client router). */
async function pageOf(request: APIRequestContext, path: string) {
  const response = await request.get(`${BASE_URL}${path}`);
  return { status: response.status(), html: (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '') };
}

/** The page with the tags of its <head> in sorted order (their content and the body unchanged). */
function withSortedHead(page: { status: number; html: string }) {
  return { ...page, html: page.html.replace(/<head>([\s\S]*?)<\/head>/, (_, head: string) => `<head>${head.split(/(?=<)/).sort().join('')}</head>`) };
}

/** A test fault for this request only: the first lineage read, or the first profile read, fails once. */
function faultCookie(kind: 'lineage-once' | 'person-once') {
  return { name: 'wcr-test-fault', value: `${kind}:${randomUUID()}`, url: BASE_URL };
}

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
  // The display-primary teacher comes first and is named as such (DEFAULT D05).
  await expect(rows.first()).toHaveAttribute('data-person', 'demo-a-001');
  await expect(rows.first().getByText('Primary teacher', { exact: true })).toBeVisible();
  await expect(rows.nth(1).getByText('Primary teacher', { exact: true })).toHaveCount(0);
  // The teacher from the other lineage is marked as such, in words.
  await expect(rows.filter({ hasText: 'Demo Lineage B' }).getByText('Cross-lineage', { exact: true })).toBeVisible();
  // The list view, and the explorer's place: it opens with M05, so until then it says "soon" and
  // is a link that is switched off, never one to a page that does not exist yet.
  const views = page.getByRole('navigation', { name: 'Views of this person' });
  const graph = views.getByRole('link', { name: 'Graph soon' });
  await expect(graph).toHaveAttribute('aria-disabled', 'true');
  await expect(graph).not.toHaveAttribute('href');
  await expect(views.getByRole('link', { name: 'List' })).toHaveAttribute('href', '/people/demo-two-lineages/lineage');
});

test('@M04 with JavaScript disabled the profile shows its teachers and students', async ({ browser }) => {
  await withoutJavaScript(browser, async (page) => {
    await page.goto('/people/demo-two-lineages');
    const focus = (await page.getByRole('heading', { level: 1 }).locator('[lang="und-Latn"]').first().textContent())!.trim();
    await expect(page.getByRole('list', { name: `Teachers of ${focus}` }).getByRole('listitem')).toHaveCount(2);
    await expect(page.getByRole('heading', { level: 2, name: /^Students/ })).toBeVisible();
    await expect(page.getByRole('list', { name: `Students of ${focus}` }).getByRole('listitem').first()).toBeVisible();
    // Nothing waits for a script: no busy region, no skeleton.
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByText(/^Loading/)).toHaveCount(0);
  });
});

test('@M04 a founder is named only as recorded (DEFAULT D22), on the profile and on a route', async ({ page }) => {
  await page.goto('/people/demo-root-c');
  await expect(page.locator('header').getByText('Founder of Demo Lineage C (as recorded)')).toBeVisible();
  const teachers = page.getByRole('region', { name: /^Teachers/ });
  await expect(teachers).toContainText('Founder of Demo Lineage C as recorded. No earlier teacher is on the record.');
  await expect(teachers.getByRole('list')).toHaveCount(0);

  // On a route, the earliest teacher is called a founder only when the record says so.
  await page.goto('/people/demo-two-lineages/lineage');
  const routes = page.getByRole('list', { name: /^Routes of descent to / });
  await expect(routes.getByText('Founder of Demo Lineage A, as recorded')).toBeVisible();
  await expect(routes.getByText('Founder of Demo Lineage B, as recorded')).toBeVisible();
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

test('@M04 anonymous viewer never receives pending or under-review edges (HTML and API)', async ({ browser, page, request }) => {
  const hub = await profileOf(request, 'demo-hub-a');
  // API: the ego network of the hub two generations each way, up to 100 students per person
  // (the fixture's pending request to the hub sorts well inside the first 100).
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
  // So do the graph reads that start from a hidden person: the person with the fixture's only
  // under-review link and its teacher answer like an id that was never used.
  const db = getDb();
  const hiddenIds = await db.execute<{ slug: string; id: string }>(
    sql`SELECT slug, id::text AS id FROM person WHERE slug IN ('demo-under-review', 'demo-claim-only-teacher') ORDER BY slug`,
  );
  expect(hiddenIds.rows).toHaveLength(2);
  const unused = randomUUID();
  for (const path of ['/lineage/ego', '/lineage/ancestors', '/lineage/paths']) {
    const nobody = await request.get(`${BASE_URL}/api/v1${path}?focusId=${unused}`);
    expect(nobody.status(), `${path} of an unused id`).toBe(404);
    const expected = await nobody.text();
    for (const { slug, id } of hiddenIds.rows) {
      const answer = await request.get(`${BASE_URL}/api/v1${path}?focusId=${id}`);
      expect(answer.status(), `${path} of ${slug}`).toBe(404);
      expect(await answer.text(), `${path} of ${slug}`).toBe(expected);
    }
  }
  // The pages too: the same status and the same HTML, scripts aside, for a hidden person, an
  // address that was never used and one no person could have. Never indexed. The status is 200:
  // only a request-time check in a proxy.ts could answer 404, and Phase 1 has none (CLAUDE.md §13,
  // docs/adr/0008-person-pages-404.md, docs/plan/questions/M04.md).
  for (const suffix of ['', '/lineage']) {
    const [hiddenPage, missingPage, malformedPage] = [
      await pageOf(request, `/people/demo-claim-only-teacher${suffix}`),
      await pageOf(request, `/people/demo-no-such-person${suffix}`),
      await pageOf(request, `/people/BAD_slug${suffix}`),
    ];
    expect(hiddenPage.status, `/people/demo-claim-only-teacher${suffix}`).toBe(200);
    expect(hiddenPage.html).toContain('No public profile at this address');
    expect(hiddenPage.html).toMatch(/<meta name="robots" content="noindex, nofollow"\s*\/?>/);
    // A hidden person and an unused address: byte for byte the same (plan §6.4).
    expect(hiddenPage, `/people/demo-claim-only-teacher${suffix}`).toEqual(missingPage);
    // An address no person could have is refused before any database read, so the page's
    // metadata is ready sooner and two <head> tags of the layout come in another order. The same
    // tags, status and body; it says nothing about a record either way.
    expect(withSortedHead(malformedPage), `/people/BAD_slug${suffix}`).toEqual(withSortedHead(missingPage));
  }
  const underReview = await pageOf(request, '/people/demo-under-review/lineage');
  expect(underReview).toEqual(await pageOf(request, '/people/demo-no-such-person/lineage'));
  // The words are in the HTML itself, not drawn by a script.
  await withoutJavaScript(browser, async (noScript) => {
    await noScript.goto('/people/demo-claim-only-teacher');
    await expect(noScript.getByRole('heading', { level: 1, name: 'No public profile at this address' })).toBeVisible();
  });

  // An under-review and a pending link between two public people (only possible as involved_only,
  // a database constraint) reach no anonymous answer: not the API, not the pages. Read with
  // inputs no other test uses, so the answer is computed now, not served from the cache.
  const temporary = await db.execute<{ id: string }>(sql`
    INSERT INTO teaching_relationship (teacher_person_id, student_person_id, lineage_id, status, visibility)
    SELECT t.id, s.id, l.id, v.status, 'involved_only'
      FROM (VALUES ('demo-b-020', 'under_review'), ('demo-a-151', 'pending_teacher')) AS v(student, status)
      JOIN person s ON s.slug = v.student
      JOIN person t ON t.slug = 'demo-a-150'
      JOIN lineage l ON l.slug = 'demo-lineage-a'
    RETURNING id::text AS id`);
  expect(temporary.rows).toHaveLength(2);
  try {
    const [teacher, underReview, pendingStudent] = await Promise.all([
      profileOf(request, 'demo-a-150'),
      profileOf(request, 'demo-b-020'),
      profileOf(request, 'demo-a-151'),
    ]);
    for (const person of [teacher, underReview, pendingStudent]) {
      const response = await request.get(`${BASE_URL}/api/v1/lineage/ego?focusId=${person.id}&up=1&down=1&fanoutLimit=97`);
      expect(response.status()).toBe(200);
      const ego = (await response.json()) as Graph;
      for (const edge of ego.edges) expect(edge.visibility, `ego of ${person.slug}`).toBe('public');
      const between = ego.edges.filter((e) => e.teacherId === teacher.id && [underReview.id, pendingStudent.id].includes(e.studentId));
      expect(between, `ego of ${person.slug}`).toEqual([]);
    }
    expect(teacher.counts.students).toBe(0);
    const teacherPage = await pageOf(request, '/people/demo-a-150');
    expect(teacherPage.status).toBe(200);
    for (const slug of ['demo-b-020', 'demo-a-151']) expect(teacherPage.html).not.toContain(`/people/${slug}"`);
    for (const slug of ['demo-b-020', 'demo-a-151']) {
      const studentPage = await pageOf(request, `/people/${slug}`);
      expect(studentPage.html, slug).not.toContain('/people/demo-a-150"');
      expect(studentPage.html, slug).not.toMatch(/>(Pending|Under review)</);
    }
  } finally {
    await db.execute(sql`DELETE FROM teaching_relationship WHERE id IN (${sql.join(
      temporary.rows.map((r) => sql`${r.id}::uuid`),
      sql`, `,
    )})`);
  }

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
  const response = await page.goto('/people/demo-pending');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('note').filter({ hasText: 'Private record.' })).toBeVisible();
  const teacher = page.getByRole('list', { name: /^Teachers of / }).locator('li[data-person="demo-hub-a"]');
  await expect(teacher.getByText('Pending', { exact: true })).toBeVisible();

  // In the outline of the lineage: under the hub, marked "Pending" in words, with who can see it;
  // the hub's disclosure counts the public students and names the request apart.
  await page.goto('/people/demo-root-a/lineage');
  const outline = page.getByRole('list', { name: 'Descendants' });
  const hubItem = outline.locator(':scope > li[data-person="demo-hub-a"]');
  const mine = hubItem.locator('li[data-person="demo-pending"]');
  await expect(mine).toBeVisible();
  await expect(mine.getByText('Pending', { exact: true })).toBeVisible();
  await expect(mine).toContainText('Visible only to the two people in this request until it is confirmed.');
  await expect(hubItem.locator(':scope > details > summary')).toContainText(/^\d[\d,]* students and your request of /);
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

  // Descendants along public relationships, and along every active one (the pending request too).
  const descendants = await db.execute<{ visible: number; total: number }>(sql`
    WITH RECURSIVE pub(id) AS (
      SELECT ${hub.id}::uuid
      UNION
      SELECT pe.student_person_id FROM v_public_edge pe JOIN pub ON pe.teacher_person_id = pub.id
    ), every(id) AS (
      SELECT ${hub.id}::uuid
      UNION
      SELECT r.student_person_id FROM teaching_relationship r JOIN every ON r.teacher_person_id = every.id
       WHERE r.status IN ('pending_teacher', 'awaiting_claim', 'under_review', 'verified', 'in_arbitration')
    )
    SELECT (SELECT count(*) - 1 FROM pub)::int AS visible, (SELECT count(*) - 1 FROM every)::int AS total`);
  const { visible, total } = descendants.rows[0]!;
  expect(total, 'the pending request would add a descendant if it were counted').toBeGreaterThan(visible);

  // ... and counts nowhere for an anonymous viewer: counts come from public relationships only.
  expect(hub.counts.students).toBe(publicStudents.rows[0]!.n);
  expect(hub.counts.descendants).toBe(visible);
  expect(hub.counts.descendantsCapped).toBe(false);
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
  const mentions = outline.locator('li').filter({ has: page.locator(':scope > div > a[href="/people/demo-converging"]') });
  await expect(mentions).toHaveCount(2);
  await expect(mentions.locator('[data-also]').filter({ hasText: `(also a student of ${second.displayName})` })).toHaveCount(1);
  await expect(mentions.locator('[data-also]').filter({ hasText: `(also a student of ${primary.displayName})` })).toHaveCount(1);
  // Both mentions lead to the one profile.
  for (const mention of await mentions.all()) {
    await expect(mention.locator(':scope > div > a').first()).toHaveAttribute('href', '/people/demo-converging');
  }
  // For an anonymous viewer the hub's disclosure counts public students only.
  const hubSummary = outline.locator(':scope > li[data-person="demo-hub-a"] > details > summary');
  await expect(hubSummary).toContainText(/^\d[\d,]* students of /);
  await expect(hubSummary).not.toContainText('request');
});

test('@M04 a student row reads the same on the profile and in the list view, without a cross-lineage mark', async ({ page, request }) => {
  const hub = await profileOf(request, 'demo-hub-a');
  const texts: string[] = [];
  for (const path of ['/people/demo-a-002', '/people/demo-a-002/lineage']) {
    await page.goto(path);
    // The profile's list is "Students of …"; the list view's groups are "Active: students of …".
    const students = page.getByRole('list', { name: /(^|: )[Ss]tudents of / });
    const row = students.locator('li[data-person="demo-converging"]');
    await expect(row).toBeVisible();
    const also = row.locator('[data-also]');
    await expect(also).toContainText(`also a student of ${hub.displayName}`);
    texts.push((await also.textContent())!.replace(/\s+/g, ' ').trim());
    // Cross-lineage belongs to a teacher's row; no student row says it.
    await expect(students.getByText('Cross-lineage', { exact: true })).toHaveCount(0);
  }
  expect(texts[0]).toBe(texts[1]);
});

test('@M04 when the lineage service fails once, the profile shows the catchError state with Retry, and Retry recovers', async ({ page, context }) => {
  await context.addCookies([faultCookie('lineage-once')]);
  await page.goto('/people/demo-two-lineages');
  // The header stands; the sections keep their headings and the error sits under the first.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const error = page.getByRole('alert').filter({ hasText: "Couldn't load the teachers and students." });
  await expect(error).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Teachers' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Students' })).toBeVisible();
  await expect(page.getByRole('list', { name: /^Teachers of / })).toHaveCount(0);
  await expectNoAxeViolations(page, '/people/demo-two-lineages (lineage read failed)');
  await error.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('list', { name: /^Teachers of / }).getByRole('listitem')).toHaveCount(2);
  await expect(error).toHaveCount(0);
  // Focus lands on the first section, and the change is announced.
  await expect(page.locator('#teachers-heading')).toBeFocused();
  await expect(page.locator('#relations-status')).toHaveText('Teachers and students loaded.');
});

test('@M04 with JavaScript disabled a failed lineage read shows the error with a Retry link that reloads', async ({ browser }) => {
  await withoutJavaScript(browser, async (page) => {
    await page.context().addCookies([faultCookie('lineage-once')]);
    await page.goto('/people/demo-two-lineages');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const error = page.getByRole('alert').filter({ hasText: "Couldn't load the teachers and students." });
    await expect(error).toBeVisible();
    const retry = error.getByRole('link', { name: 'Retry' });
    await expect(retry).toHaveAttribute('href', '/people/demo-two-lineages');
    await retry.click();
    await expect(page.getByRole('list', { name: /^Teachers of / }).getByRole('listitem')).toHaveCount(2);
  });
});

test('@M04 when the profile read fails once, the page shows its own error state, and Retry recovers', async ({ page, context, browser }) => {
  await context.addCookies([faultCookie('person-once')]);
  await page.goto('/people/demo-two-lineages');
  await expect(page.getByRole('heading', { level: 1, name: 'This profile could not be loaded' })).toBeVisible();
  const error = page.getByRole('alert').filter({ hasText: 'The archive did not answer this time.' });
  await expect(error).toBeVisible();
  // The app shell stands: the main navigation is still there.
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expectNoAxeViolations(page, '/people/demo-two-lineages (profile read failed)');
  await error.getByRole('link', { name: 'Retry' }).click();
  await expect(page.getByRole('list', { name: /^Teachers of / }).getByRole('listitem')).toHaveCount(2);

  await withoutJavaScript(browser, async (noScript) => {
    await noScript.context().addCookies([faultCookie('person-once')]);
    // Retry opens the same view again, with its query (here: every route of descent).
    await noScript.goto('/people/demo-two-lineages/lineage?routes=all');
    await expect(noScript.getByRole('heading', { level: 1, name: 'This profile could not be loaded' })).toBeVisible();
    const retry = noScript.getByRole('alert').getByRole('link', { name: 'Retry' });
    await expect(retry).toHaveAttribute('href', '/people/demo-two-lineages/lineage?routes=all');
    await retry.click();
    await expect(noScript.getByRole('heading', { level: 2, name: /^Routes of descent/ })).toBeVisible();
    expect(new URL(noScript.url()).search).toBe('?routes=all');
  });
});

test.describe('at 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  const overflow = (page: Page) =>
    page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));

  test('@M04 profile and list view at 390x844 have no horizontal scroll, also with text at 200%', async ({ page }) => {
    for (const path of ['/people/demo-two-lineages', '/people/demo-two-lineages/lineage', '/people/demo-root-a/lineage', '/people/demo-hub-a']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const normal = await overflow(page);
      expect(normal.scrollWidth, path).toBeLessThanOrEqual(normal.clientWidth);
      // Text enlarged as a webview's text zoom does it (rem-based sizes grow with the root).
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      const large = await overflow(page);
      expect(large.scrollWidth, `${path} at 200% text`).toBeLessThanOrEqual(large.clientWidth);
    }
  });

  test('@M04 at 390x844 the hub list view keeps to its height, with 44 px targets', async ({ page }) => {
    // Review round 2 (recheck-3): the hub's list view was 12,190 px tall on a phone (52 px between
    // outline rows, a chevron gutter on every row, register rows of 80 px or more); about 10,300 px
    // since. The budget leaves room for another browser's text metrics, not for that layout.
    await page.goto('/people/demo-hub-a/lineage');
    await expect(page.getByRole('list', { name: 'Descendants' })).toBeVisible();
    const m = await page.evaluate(() => {
      const box = (el: Element) => el.getBoundingClientRect();
      const outline = document.querySelector('ul[aria-label="Descendants"]')!;
      const leaves = [...outline.querySelectorAll(':scope ul > li')].filter((li) => !li.querySelector('details'));
      // From each row to the next row of the same list, when the first is a single line.
      const pitches = leaves
        .map((li) => [li, li.nextElementSibling] as const)
        .filter(([, next]) => next !== null && leaves.includes(next))
        .map(([li, next]) => [box(li).height, box(next!).top - box(li).top]);
      const rows = [...document.querySelectorAll('ul[aria-label^="Active: students of"] > li')];
      // A point on each row's relationship line: the row's own link answers there (the name's
      // link covers the row). elementFromPoint sees only the viewport, so each row is scrolled in.
      const rowTargets = rows.slice(0, 10).map((li) => {
        li.scrollIntoView({ block: 'center' });
        const line = box(li.querySelector('[data-relationship]')!);
        const hit = document.elementFromPoint(line.left + 4, line.top + line.height / 2)?.closest('a');
        return hit === li.querySelector('a.name-link');
      });
      return {
        doc: document.documentElement.scrollHeight,
        leafLinks: leaves.map((li) => box(li.querySelector('a.name-link')!).height),
        leafX: Math.min(...leaves.map((li) => box(li.querySelector('a.name-link')!).left)),
        singleRowPitches: pitches.filter(([height]) => height! <= 44.5).map(([, pitch]) => Math.round(pitch!)),
        rowHeights: rows.map((li) => box(li).height).sort((a, b) => a - b),
        rowTargets,
      };
    });
    expect(m.doc).toBeLessThan(11_000);
    expect(m.leafLinks.length).toBeGreaterThan(100);
    expect(Math.min(...m.leafLinks)).toBeGreaterThanOrEqual(44);
    // Single-line rows touch: 44 px apart, no gap between targets.
    expect(new Set(m.singleRowPitches)).toEqual(new Set([44]));
    // A list without a disclosure control keeps no chevron gutter.
    expect(m.leafX).toBeLessThanOrEqual(110);
    // Register rows: each row is its person's target (at least 44 px), a name and one line.
    expect(m.rowHeights.length).toBe(50);
    expect(m.rowHeights[0]).toBeGreaterThanOrEqual(44);
    expect(m.rowHeights[Math.floor(m.rowHeights.length / 2)]).toBeLessThanOrEqual(66);
    expect(m.rowTargets).toEqual(Array(10).fill(true));
  });

  test('@M04 at 390x844 the first teacher is on the first screen of the profile', async ({ page }) => {
    for (const slug of ['demo-two-lineages', 'demo-hub-a']) {
      await page.goto(`/people/${slug}`);
      const first = page.getByRole('list', { name: /^Teachers of / }).getByRole('listitem').first();
      await expect(first).toBeVisible();
      const box = (await first.boundingBox())!;
      expect(box.y + box.height, slug).toBeLessThan(844);
      expect(box.y, slug).toBeLessThan(600);
    }
  });

  test('@M04 no axe violations on the profile and list view at 390x844', async ({ page }) => {
    for (const path of ['/people/demo-two-lineages', '/people/demo-hub-a/lineage']) {
      for (const theme of THEMES) {
        const response = await openInTheme(page, path, theme);
        expect(response?.status()).toBe(200);
        await expectNoAxeViolations(page, `${path} at 390x844 (${theme})`);
      }
    }
  });
});

test('@M04 no axe violations on the profile and list view in dark and light themes', async ({ page }) => {
  // Eight pages and eight axe passes in one test, the root's list view among them (its outline is
  // the longest page here): the default 30 s is for one page.
  test.setTimeout(60_000);
  for (const path of ['/people/demo-two-lineages', '/people/demo-two-lineages/lineage', '/people/demo-root-a/lineage', '/people/demo-claim-only-teacher']) {
    for (const theme of THEMES) {
      const response = await openInTheme(page, path, theme);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoAxeViolations(page, `${path} (${theme})`);
    }
  }
});

test('@M04 no axe violations on the private record and the own request, signed in', async ({ page }) => {
  // A sign-in, then six pages and six axe passes (as above).
  test.setTimeout(60_000);
  await signInAs(page, 'demo-pending');
  for (const path of ['/people/demo-pending', '/people/demo-hub-a', '/people/demo-root-a/lineage']) {
    for (const theme of THEMES) {
      const response = await openInTheme(page, path, theme);
      expect(response?.status()).toBe(200);
      await expect(page.getByText('Pending', { exact: true }).first()).toBeVisible();
      await expectNoAxeViolations(page, `${path} signed in (${theme})`);
    }
  }
});
