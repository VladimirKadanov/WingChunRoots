/**
 * Milestone M09: teacher requests and independent approvals (Done when 2). The flows run through
 * the real pages against `next start` and the worker; the database is read to check what the pages
 * cannot show (events, audit rows, queued e-mails). Every test makes its own people
 * (`demo-e2e-…@example.test` accounts with fictional `Demo …` names, D20) and links them in the
 * demo lineages, so the seeded demo accounts change nothing: demo-free-sifu-5's approval is refused.
 *
 * These tests make links public, which changes the explorer's counts and the public pages other
 * specs compare: they run in the `exclusive` project, in a Playwright run of their own after the
 * others (e2e/projects.ts, PUBLIC_WRITE_SPECS).
 */

import { randomBytes, randomUUID } from 'node:crypto';

import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv, signInAs, userIdOf, type SignInTarget } from './helpers/auth';
import { openMailbox } from './helpers/mailbox';
import { apiPost } from './helpers/plans';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  // Rate limits are per client address: each test is its own client.
  await giveOwnAddress(context);
});

const LINEAGE_A = 'Demo Lineage A';
const LINEAGE_B = 'Demo Lineage B';
const LINEAGE_C = 'Demo Lineage C';

/** Letters only, so the name stays a Latin-script name; unique enough to find one person. */
function token(length = 6): string {
  return Array.from(randomBytes(length), (byte) => String.fromCharCode(97 + (byte % 26))).join('');
}

/** A visible element (Next.js keeps earlier routes in the document, hidden). */
const visible = (locator: Locator) => locator.filter({ visible: true });
const field = (scope: Page | Locator, label: string | RegExp) => visible(scope.getByLabel(label, { exact: typeof label === 'string' }));

interface Member {
  context: BrowserContext;
  page: Page;
  email: string;
  userId: string;
  name: string;
  /** The part of the name that only this person has: what the palette is searched for. */
  find: string;
  personId: string;
  slug: string;
}

/**
 * A new confirmed account in a browser context of its own, with a public profile (through the API,
 * as onboarding does with "Show my profile publicly"), and a Sifu account when `sifu` is set.
 */
async function member(browser: Browser, label: string, options: { sifu?: boolean; viewport?: { width: number; height: number } } = {}): Promise<Member> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    ...(options.viewport ? { viewport: options.viewport, isMobile: true, hasTouch: true } : {}),
  });
  await giveOwnAddress(context);
  const page = await context.newPage();
  const account = await signInAs(page, 'new');
  const find = token();
  const name = `Demo ${label} ${find.charAt(0).toUpperCase()}${find.slice(1)}`;
  const onboard = await apiPost(page, '/account/onboard', { primaryName: name, showPublicly: true });
  expect(onboard.status(), await onboard.text()).toBe(200);
  if (options.sifu) {
    const type = await apiPost(page, '/account/type', { accountType: 'sifu' });
    expect(type.status(), await type.text()).toBe(200);
  }
  const userId = (await userIdOf(account.email))!;
  const rows = await getDb().execute<{ id: string; slug: string }>(sql`
    SELECT id::text AS id, slug FROM person WHERE claimed_by_user_id = ${userId} AND deleted_at IS NULL`);
  expect(rows.rows).toHaveLength(1);
  return { context, page, email: account.email, userId, name, find, personId: rows.rows[0]!.id, slug: rows.rows[0]!.slug };
}

/** Another browser context signed in as a seeded account or role. */
async function signedIn(browser: Browser, target: SignInTarget) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(context);
  const page = await context.newPage();
  await signInAs(page, target);
  return { context, page };
}

interface RequestOptions {
  lineage: string;
  fromYear?: string;
  fromMonth?: string;
  ongoing?: boolean;
  toYear?: string;
}

/** Chooses `teacher` in the request form with the palette in select mode. */
async function chooseTeacher(page: Page, teacher: Pick<Member, 'name' | 'find'>) {
  // The button needs the form's island: press it until the palette opens.
  const input = page.getByRole('combobox', { name: 'Choose your teacher' });
  await expect(async () => {
    await visible(page.getByRole('button', { name: /^(Find your teacher|Choose another teacher)$/ })).click();
    await expect(input).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/rpc/search/query');
  await input.fill(teacher.find);
  expect((await answered).status()).toBe(200);
  await page.getByTestId('search-palette').getByRole('option').filter({ hasText: teacher.name }).click();
  await expect(input).toBeHidden();
  await expect(visible(page.getByTestId('chosen-teacher'))).toContainText(teacher.name);
}

/** Fills the lineage and the first period of the request form. */
async function fillRequest(page: Page, options: RequestOptions) {
  await field(page, /^Lineage of this training/).selectOption({ label: options.lineage });
  await field(page, 'Started (year)').fill(options.fromYear ?? '2019');
  if (options.fromMonth) await visible(page.getByRole('combobox', { name: 'Month' })).first().selectOption(options.fromMonth);
  if (options.ongoing ?? true) await visible(page.getByRole('checkbox', { name: 'I still train with this teacher' })).check();
  if (options.toYear) await field(page, 'Ended (year) (optional)').fill(options.toYear);
}

/** Sends a request to `teacher` through /dashboard/teachers/new; returns the relationship's id. */
async function requestTeacher(student: Member, teacher: Member, options: RequestOptions): Promise<string> {
  const { page } = student;
  await page.goto('/dashboard/teachers/new');
  await chooseTeacher(page, teacher);
  await fillRequest(page, options);
  await visible(page.getByRole('button', { name: 'Send the request' })).click();
  await page.waitForURL(/\/dashboard\/teachers\?sent=/);
  await expect(visible(page.getByTestId('request-sent'))).toContainText(teacher.name);
  return new URL(page.url()).searchParams.get('sent')!;
}

/** The row of a waiting request on the teacher's /dashboard/students/requests. */
const requestRow = (page: Page, relationshipId: string) => visible(page.locator(`tr[data-relationship="${relationshipId}"]`));

/** Approves a request on /dashboard/students/requests. */
async function approve(teacher: Member, relationshipId: string) {
  const { page } = teacher;
  await page.goto('/dashboard/students/requests');
  await requestRow(page, relationshipId).getByRole('button', { name: /^Approve/ }).click();
  await page.waitForURL(/[?&]approved=/);
  await expect(visible(page.getByTestId('request-approved'))).toBeVisible();
}

async function relationshipRow(id: string) {
  const rows = await getDb().execute<{ status: string; visibility: string }>(sql`SELECT status, visibility FROM teaching_relationship WHERE id = ${id}::uuid`);
  return rows.rows[0];
}

async function eventCount(id: string, to: string): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM relationship_event WHERE relationship_id = ${id}::uuid AND to_status = ${to}`);
  return rows.rows[0]!.n;
}

async function auditCount(action: string, id: string): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_log WHERE action = ${action} AND subject_id = ${id}`);
  return rows.rows[0]!.n;
}

async function emailCount(userId: string, template: string): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM email_delivery WHERE user_id = ${userId}::uuid AND template = ${template}`);
  return rows.rows[0]!.n;
}

interface ProfileDto {
  id: string;
  counts: { students: number; descendants: number };
}

/** A public profile as an anonymous client reads it (GET /api/v1/people/{slug}). */
async function publicProfile(request: APIRequestContext, slug: string): Promise<ProfileDto> {
  const response = await request.get(`${BASE_URL}/api/v1/people/${slug}`);
  expect(response.status(), slug).toBe(200);
  return (await response.json()) as ProfileDto;
}

interface EgoEdge {
  teacherId: string;
  studentId: string;
  status: string;
  lineageId: string;
}

/** lineage.ego as an anonymous web client calls it (same origin, /api/rpc). */
async function egoEdges(request: APIRequestContext, input: Record<string, unknown>): Promise<EgoEdge[]> {
  const response = await request.post(`${BASE_URL}/api/rpc/lineage/ego`, { data: { json: input }, headers: { origin: BASE_URL } });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { json: { edges: EgoEdge[] } }).json.edges;
}

/** The public edges into a person, as an anonymous client reads them. */
async function publicTeachersOf(request: APIRequestContext, personId: string): Promise<EgoEdge[]> {
  return (await egoEdges(request, { focusId: personId, up: 1, down: 0 })).filter((edge) => edge.studentId === personId);
}

async function lineageIdOf(name: string): Promise<string> {
  const rows = await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM lineage WHERE name = ${name}`);
  return rows.rows[0]!.id;
}

/** GET /api/v1 with the page's session. */
const apiGet = (page: Page, path: string) => page.request.get(`/api/v1${path}`, { headers: { origin: BASE_URL } });

test('@M09 a student requests two teachers in different lineages; each approves separately; both edges become public', async ({ browser, request }) => {
  const [first, second, student] = await Promise.all([member(browser, 'Sifu', { sifu: true }), member(browser, 'Sifu', { sifu: true }), member(browser, 'Student')]);
  const toFirst = await requestTeacher(student, first, { lineage: LINEAGE_A, fromYear: '2015' });
  const toSecond = await requestTeacher(student, second, { lineage: LINEAGE_B, fromYear: '2018' });

  // Two requests, each pending and private.
  const requests = visible(student.page.getByTestId('requests'));
  await expect(requests.locator('li[data-status="pending_teacher"]')).toHaveCount(2);
  for (const id of [toFirst, toSecond]) expect(await relationshipRow(id)).toEqual({ status: 'pending_teacher', visibility: 'involved_only' });
  expect(await publicTeachersOf(request, student.personId)).toEqual([]);

  // The first teacher answers their own request only.
  await approve(first, toFirst);
  expect(await relationshipRow(toFirst)).toEqual({ status: 'verified', visibility: 'public' });
  expect(await relationshipRow(toSecond)).toEqual({ status: 'pending_teacher', visibility: 'involved_only' });
  let edges = await publicTeachersOf(request, student.personId);
  expect(edges.map((e) => e.teacherId)).toEqual([first.personId]);
  // The second teacher's queue still shows theirs, untouched.
  await second.page.goto('/dashboard/students/requests');
  await expect(requestRow(second.page, toSecond)).toBeVisible();

  await student.page.goto('/dashboard/teachers');
  await expect(visible(student.page.locator(`li[data-relationship="${toFirst}"]`))).toContainText('Verified');
  await expect(visible(student.page.locator(`li[data-relationship="${toSecond}"]`))).toContainText('Waiting for the teacher');

  // Then the second one: both links public, each in its own lineage.
  await approve(second, toSecond);
  edges = await publicTeachersOf(request, student.personId);
  expect(new Map(edges.map((e) => [e.teacherId, e.lineageId]))).toEqual(
    new Map([
      [first.personId, await lineageIdOf(LINEAGE_A)],
      [second.personId, await lineageIdOf(LINEAGE_B)],
    ]),
  );
  expect(edges.every((e) => e.status === 'verified')).toBe(true);
  // On the student's public profile, both teachers with their seal.
  const anonymous = await browser.newContext({ baseURL: BASE_URL });
  const profile = await anonymous.newPage();
  await profile.goto(`/people/${student.slug}`);
  const teachers = profile.getByRole('list', { name: /^Teachers of / });
  for (const teacher of [first, second]) await expect(teachers.locator(`li[data-person="${teacher.slug}"]`)).toContainText('Verified');
  await Promise.all([anonymous.close(), first.context.close(), second.context.close(), student.context.close()]);
});

test('@M09 a pending request is visible only to the student, the teacher and reviewers (profile, list view and API)', async ({ browser, request }) => {
  const [teacher, student, stranger] = await Promise.all([member(browser, 'Sifu', { sifu: true }), member(browser, 'Student'), member(browser, 'Stranger')]);
  const id = await requestTeacher(student, teacher, { lineage: LINEAGE_C });
  const reviewer = await signedIn(browser, 'moderator');

  // The two of them and a reviewer: on the teacher's profile, in the teacher's list view, and
  // through the API, marked "Pending".
  for (const [who, page] of [
    ['student', student.page],
    ['teacher', teacher.page],
    ['reviewer', reviewer.page],
  ] as const) {
    await page.goto(`/people/${teacher.slug}`);
    const own = page.getByRole('list', { name: /^Students of / }).locator(`li[data-person="${student.slug}"]`);
    await expect(own, who).toBeVisible();
    await expect(own.getByText('Pending', { exact: true }), who).toBeVisible();
    // The list view names it among the teacher's students, apart from the public ones.
    await page.goto(`/people/${teacher.slug}/lineage`);
    const listed = page.getByRole('main').getByRole('listitem').filter({ has: page.getByRole('link', { name: student.name }) });
    await expect(listed, who).toHaveCount(1);
    await expect(listed, who).toContainText('Pending');
    const api = await apiGet(page, `/relationships/${id}`);
    expect(api.status(), who).toBe(200);
    expect(((await api.json()) as { status: string }).status, who).toBe('pending_teacher');
  }

  // Anyone else: an unrelated account and an anonymous visitor see nothing of it, and the API
  // answers as for no such request.
  for (const [who, page] of [['stranger', stranger.page] as const]) {
    await page.goto(`/people/${teacher.slug}`);
    await expect(page.getByRole('heading', { level: 1 }), who).toContainText(teacher.name);
    await expect(page.locator(`li[data-person="${student.slug}"]`), who).toHaveCount(0);
    await page.goto(`/people/${teacher.slug}/lineage`);
    await expect(page.getByRole('heading', { level: 1 }), who).toContainText(teacher.name);
    await expect(page.getByRole('main').getByRole('link', { name: student.name }), who).toHaveCount(0);
    expect((await apiGet(page, `/relationships/${id}`)).status(), who).toBe(404);
  }
  const html = await (await request.get(`${BASE_URL}/people/${teacher.slug}`)).text();
  expect(html).not.toContain(student.slug);
  expect((await request.get(`${BASE_URL}/api/v1/relationships/${id}`)).status()).toBe(401);
  const below = await egoEdges(request, { focusId: teacher.personId, up: 0, down: 1 });
  expect(below.filter((e) => e.studentId === student.personId)).toEqual([]);
  await Promise.all([teacher.context.close(), student.context.close(), stranger.context.close(), reviewer.context.close()]);
});

test('@M09 a new request creates a teacher dashboard notification and an email with the student, the training start and a queue link', async ({ browser }) => {
  const [teacher, student] = await Promise.all([member(browser, 'Sifu', { sifu: true }), member(browser, 'Student')]);
  await requestTeacher(student, teacher, { lineage: LINEAGE_A, fromYear: '2019', fromMonth: 'April' });

  await teacher.page.goto('/dashboard');
  const notice = visible(teacher.page.getByTestId('notification')).filter({ hasText: 'New teacher request' });
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText(student.name);
  await expect(notice.getByRole('link', { name: 'Answer the request' })).toHaveAttribute('href', '/dashboard/students/requests');

  const mail = await openMailbox().waitFor(teacher.email, { subject: 'A new teacher request on WingChunRoots', timeoutMs: 30_000 });
  expect(mail.text).toContain(student.name);
  expect(mail.text).toContain('April 2019');
  expect(mail.text).toContain(`${BASE_URL}/dashboard/students/requests`);
  // The queue link opens the request.
  await teacher.page.goto('/dashboard/students/requests');
  await expect(visible(teacher.page.getByTestId('student-request'))).toContainText(student.name);
  await Promise.all([teacher.context.close(), student.context.close()]);
});

test("@M09 an unrelated user's approve action is refused with no state change", async ({ browser }) => {
  const [teacher, student, stranger] = await Promise.all([member(browser, 'Sifu', { sifu: true }), member(browser, 'Student'), member(browser, 'Sifu', { sifu: true })]);
  const id = await requestTeacher(student, teacher, { lineage: LINEAGE_B });

  // Through the API: the same answer as for no such request.
  const refused = await apiPost(stranger.page, '/relationships/approve', { relationshipId: id, idempotencyKey: randomUUID() });
  expect(refused.status()).toBe(404);
  // The student cannot answer their own request either.
  const own = await apiPost(student.page, '/relationships/approve', { relationshipId: id, idempotencyKey: randomUUID() });
  expect(own.status()).toBe(403);
  // The stranger's own queue does not list it.
  await stranger.page.goto('/dashboard/students/requests');
  await expect(visible(stranger.page.getByTestId('empty-student-requests'))).toBeVisible();
  await expect(stranger.page.locator(`tr[data-relationship="${id}"]`)).toHaveCount(0);

  expect(await relationshipRow(id)).toEqual({ status: 'pending_teacher', visibility: 'involved_only' });
  expect(await eventCount(id, 'verified')).toBe(0);
  expect(await auditCount('relationship.approve', id)).toBe(0);
  expect(await emailCount(student.userId, 'relationship-approved')).toBe(0);
  await Promise.all([teacher.context.close(), student.context.close(), stranger.context.close()]);
});

test("@M09 demo-free-sifu-5's sixth approval is blocked, the upgrade prompt appears and the request stays pending", async ({ page }) => {
  await signInAs(page, 'demo-free-sifu-5');
  await page.goto('/dashboard/students/requests');
  await expect(visible(page.getByTestId('student-allowance'))).toHaveText('Students: 5 of 5 approved on Free Sifu');
  await expect(visible(page.getByTestId('upgrade-prompt'))).toBeVisible();
  const rows = visible(page.getByTestId('student-request'));
  await expect(rows).toHaveCount(1);
  const id = (await rows.getAttribute('data-relationship'))!;

  await rows.getByRole('button', { name: /^Approve/ }).click();
  const message = rows.getByRole('alert');
  await expect(message).toContainText('You have approved 5 of 5 students on Free Sifu. The request stays pending.');
  await expect(rows.getByRole('link', { name: 'See what a higher plan adds' })).toHaveAttribute('href', '#upgrade');

  // Nothing changed: still pending and private, no approval recorded; the API says the same.
  expect(await relationshipRow(id)).toEqual({ status: 'pending_teacher', visibility: 'involved_only' });
  expect(await eventCount(id, 'verified')).toBe(0);
  const api = await apiPost(page, '/relationships/approve', { relationshipId: id, idempotencyKey: randomUUID() });
  expect(api.status()).toBe(403);
  expect(((await api.json()) as { code: string }).code).toBe('ENTITLEMENT_REQUIRED');
  await page.reload();
  await expect(visible(page.getByTestId('student-request'))).toHaveCount(1);
  await expect(visible(page.getByTestId('upgrade-prompt'))).toBeVisible();
});

test('@M09 a rejection notifies the student with the neutral reason and a resubmit link; the student corrects and resubmits', async ({ browser }) => {
  const [teacher, student] = await Promise.all([member(browser, 'Sifu', { sifu: true }), member(browser, 'Student')]);
  const id = await requestTeacher(student, teacher, { lineage: LINEAGE_A, fromYear: '2016' });

  // The teacher declines with a reason from the list.
  await teacher.page.goto('/dashboard/students/requests');
  const row = requestRow(teacher.page, id);
  await row.getByText('Decline…').click();
  await row.getByLabel('Reason').selectOption({ label: 'The training dates need correcting.' });
  await row.getByRole('button', { name: /^Decline the request/ }).click();
  await teacher.page.waitForURL(/[?&]declined=/);
  await expect(visible(teacher.page.getByTestId('request-declined'))).toBeVisible();
  expect(await relationshipRow(id)).toEqual({ status: 'rejected', visibility: 'involved_only' });

  // The student is told why, on the dashboard and by e-mail, with the way to correct it.
  const resubmitPath = `/dashboard/teachers/new?resubmit=${id}`;
  await student.page.goto('/dashboard');
  const notice = visible(student.page.getByTestId('notification')).filter({ hasText: 'Teacher request not confirmed' });
  await expect(notice).toContainText('The training dates need correcting.');
  await expect(notice.getByRole('link', { name: 'Correct and send again' })).toHaveAttribute('href', resubmitPath);
  const mail = await openMailbox().waitFor(student.email, { subject: 'Your teacher request needs a correction', timeoutMs: 30_000 });
  expect(mail.text).toContain('The training dates need correcting.');
  expect(mail.text).toContain(`${BASE_URL}${resubmitPath}`);

  // The student corrects the start and sends it again.
  await notice.getByRole('link', { name: 'Correct and send again' }).click();
  await student.page.waitForURL((url) => url.pathname === '/dashboard/teachers/new');
  await expect(visible(student.page.getByTestId('rejection-reason'))).toContainText('The training dates need correcting.');
  await expect(visible(student.page.getByTestId('chosen-teacher'))).toContainText(teacher.name);
  const year = field(student.page, 'Started (year)');
  await expect(year).toHaveValue('2016');
  await year.fill('2014');
  await visible(student.page.getByRole('button', { name: 'Send the request again' })).click();
  await student.page.waitForURL(/\/dashboard\/teachers\?sent=/);
  await expect(visible(student.page.getByTestId('request-sent'))).toContainText(teacher.name);
  expect(await relationshipRow(id)).toEqual({ status: 'pending_teacher', visibility: 'involved_only' });
  const start = await getDb().execute<{ starts_on: string }>(sql`SELECT starts_on::text FROM training_period WHERE relationship_id = ${id}::uuid`);
  expect(start.rows.map((r) => r.starts_on)).toEqual(['2014-01-01']);
  await openMailbox().waitFor(teacher.email, { subject: 'A corrected teacher request on WingChunRoots', timeoutMs: 30_000 });
  await Promise.all([teacher.context.close(), student.context.close()]);
});

test('@M09 a claim that would create a cycle is refused with a clear message', async ({ browser }) => {
  const [teacher, student] = await Promise.all([member(browser, 'Sifu', { sifu: true }), member(browser, 'Student', { sifu: true })]);
  const id = await requestTeacher(student, teacher, { lineage: LINEAGE_C });
  await approve(teacher, id);

  // Now the teacher names their own student as their teacher.
  const { page } = teacher;
  await page.goto('/dashboard/teachers/new');
  await chooseTeacher(page, student);
  await fillRequest(page, { lineage: LINEAGE_C });
  await visible(page.getByRole('button', { name: 'Send the request' })).click();
  const summary = visible(page.getByRole('alert')).first();
  await expect(summary).toContainText('This would create a cycle');
  await expect(visible(page.getByTestId('teacher-request-form'))).toContainText('A person can’t be their own teacher’s teacher.');
  expect(new URL(page.url()).pathname).toBe('/dashboard/teachers/new');
  const rows = await getDb().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM teaching_relationship WHERE teacher_person_id = ${student.personId}::uuid AND student_person_id = ${teacher.personId}::uuid`);
  expect(rows.rows[0]!.n).toBe(0);
  await Promise.all([teacher.context.close(), student.context.close()]);
});

test('@M09 double-clicking Approve records one approval and sends one email', async ({ browser }) => {
  const [teacher, student] = await Promise.all([member(browser, 'Sifu', { sifu: true }), member(browser, 'Student')]);
  const id = await requestTeacher(student, teacher, { lineage: LINEAGE_B });
  await teacher.page.goto('/dashboard/students/requests');
  await requestRow(teacher.page, id).getByRole('button', { name: /^Approve/ }).dblclick();
  await teacher.page.waitForURL(/[?&]approved=/);
  await expect(visible(teacher.page.getByTestId('request-approved'))).toBeVisible();

  await openMailbox().waitFor(student.email, { subject: 'Your teacher confirmed you on WingChunRoots', timeoutMs: 30_000 });
  expect(await eventCount(id, 'verified')).toBe(1);
  expect(await auditCount('relationship.approve', id)).toBe(1);
  expect(await emailCount(student.userId, 'relationship-approved')).toBe(1);
  expect(await emailCount(teacher.userId, 'relationship-approved')).toBe(1);
  // Give a second delivery time to arrive, if there were one.
  await teacher.page.waitForTimeout(2_000);
  const delivered = (await openMailbox().list(student.email)).filter((m) => m.subject === 'Your teacher confirmed you on WingChunRoots');
  expect(delivered).toHaveLength(1);
  await Promise.all([teacher.context.close(), student.context.close()]);
});

test('@M09 a teacher marks training as ended and the relationship stays visible as historical', async ({ browser }) => {
  const [teacher, student] = await Promise.all([member(browser, 'Sifu', { sifu: true }), member(browser, 'Student')]);
  const id = await requestTeacher(student, teacher, { lineage: LINEAGE_A, fromYear: '2017' });
  await approve(teacher, id);

  const { page } = teacher;
  const row = visible(page.locator(`li[data-testid="student"][data-relationship="${id}"]`));
  await row.getByText('Mark training as ended…').click();
  await row.getByLabel('Year ended').fill('2024');
  await row.getByRole('button', { name: /^Mark as ended/ }).click();
  await page.waitForURL(/[?&]ended=/);
  await expect(visible(page.getByTestId('training-ended'))).toContainText(student.name);
  await expect(visible(page.locator(`li[data-testid="student"][data-relationship="${id}"]`))).toContainText('Verified · training ended');

  // Never deleted: still verified and public, now historical, on the public profile too.
  expect(await relationshipRow(id)).toEqual({ status: 'verified', visibility: 'public' });
  const anonymous = await browser.newContext({ baseURL: BASE_URL });
  const profile = await anonymous.newPage();
  await profile.goto(`/people/${student.slug}`);
  const link = profile.getByRole('list', { name: /^Teachers of / }).locator(`li[data-person="${teacher.slug}"]`);
  await expect(link).toContainText('Historical');
  await expect(link).toContainText('2017–2024');
  // The student sees it among their teachers, historical.
  await student.page.goto('/dashboard/teachers');
  await expect(visible(student.page.locator(`li[data-relationship="${id}"]`))).toContainText('Verified · training ended');
  await Promise.all([anonymous.close(), teacher.context.close(), student.context.close()]);
});

test('@M09 request and approve a teacher at 390x844', async ({ browser }) => {
  const phone = { width: 390, height: 844 };
  const [teacher, student] = await Promise.all([member(browser, 'Sifu', { sifu: true, viewport: phone }), member(browser, 'Student', { viewport: phone })]);
  const id = await requestTeacher(student, teacher, { lineage: LINEAGE_C, fromYear: '2020', fromMonth: 'March' });

  const { page } = teacher;
  await page.goto('/dashboard/students/requests');
  const row = requestRow(page, id);
  const button = row.getByRole('button', { name: /^Approve/ });
  await expect(button).toBeVisible();
  // A phone: no sideways scroll, and the answer buttons are at least 44 px tall.
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await row.getByText('Decline…').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await button.tap();
  await page.waitForURL(/[?&]approved=/);
  await expect(visible(page.getByTestId('request-approved'))).toBeVisible();
  expect(await relationshipRow(id)).toEqual({ status: 'verified', visibility: 'public' });

  await student.page.goto('/dashboard/teachers');
  await expect(visible(student.page.locator(`li[data-relationship="${id}"]`))).toContainText('Verified');
  const studentWidths = await student.page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(studentWidths.scroll).toBeLessThanOrEqual(studentWidths.client);
  await Promise.all([teacher.context.close(), student.context.close()]);
});

test("@M09 after an approval the teacher's public descendant count updates without waiting for cacheLife", async ({ browser, request }) => {
  const [grand, teacher, student] = await Promise.all([member(browser, 'Sifu', { sifu: true }), member(browser, 'Sifu', { sifu: true }), member(browser, 'Student')]);
  await approve(grand, await requestTeacher(teacher, grand, { lineage: LINEAGE_B, fromYear: '2005' }));

  // Read both public profiles first, so their cache entries exist.
  expect((await publicProfile(request, grand.slug)).counts.descendants).toBe(1);
  expect((await publicProfile(request, teacher.slug)).counts.descendants).toBe(0);
  const anonymous = await browser.newContext({ baseURL: BASE_URL });
  const profile = await anonymous.newPage();
  await profile.goto(`/people/${grand.slug}`);

  // One more generation below the teacher: both counts move at once, the teacher above too.
  await approve(teacher, await requestTeacher(student, teacher, { lineage: LINEAGE_B, fromYear: '2015' }));
  expect((await publicProfile(request, teacher.slug)).counts.descendants).toBe(1);
  expect((await publicProfile(request, grand.slug)).counts.descendants).toBe(2);
  await profile.goto(`/people/${teacher.slug}`);
  await expect(profile.getByRole('list', { name: /^Students of / }).locator(`li[data-person="${student.slug}"]`)).toBeVisible();
  await Promise.all([anonymous.close(), grand.context.close(), teacher.context.close(), student.context.close()]);
});
