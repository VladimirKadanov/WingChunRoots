/**
 * Milestone M10a: evidence, historical teachers and the review queue (Done when 2). The flows run
 * through the real pages against `next start` and the worker; the database and the evidence store
 * are read to check what the pages cannot show (hashes, audit rows, events, storage keys). Every
 * test makes its own people (`demo-e2e-…@example.test` accounts with fictional `Demo …` names, D20)
 * and its own files, generated here: PDFs of filler text, a flat-colour photograph with a made-up
 * camera and position. Nothing is read from disk.
 *
 * Verifying a claim makes a link and a record public, and the archival edit touches demo-root-c:
 * the spec runs in the `exclusive` project, in a Playwright run of its own after the others
 * (e2e/projects.ts, PUBLIC_WRITE_SPECS).
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { getEvidenceStore } from '../src/server/storage';
import { jpegWithGps, plainImage } from '../src/server/storage/test-images';
import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv, signInAs, userIdOf, type SignInTarget } from './helpers/auth';
import { caseOf, CLAIM_LINEAGE, claimThroughApi, fictionalPdf, letters as token, uploadEvidence as uploadRequest } from './helpers/evidence';
import { apiPost } from './helpers/plans';
import { runPaths } from './projects';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  // Rate limits are per client address: each test is its own client.
  await giveOwnAddress(context);
});

const MB = 1024 * 1024;

const capital = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/** A visible element (Next.js keeps earlier routes in the document, hidden). */
const visible = (locator: Locator) => locator.filter({ visible: true });

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

interface Member {
  context: BrowserContext;
  page: Page;
  email: string;
  userId: string;
  name: string;
  personId: string;
  slug: string;
}

/** A new confirmed account in a browser context of its own, with a public profile. */
async function member(browser: Browser, label: string, options: { viewport?: { width: number; height: number } } = {}): Promise<Member> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    ...(options.viewport ? { viewport: options.viewport, isMobile: true, hasTouch: true } : {}),
  });
  await giveOwnAddress(context);
  const page = await context.newPage();
  const account = await signInAs(page, 'new');
  const name = `Demo ${label} ${capital(token())}`;
  const onboard = await apiPost(page, '/account/onboard', { primaryName: name, showPublicly: true });
  expect(onboard.status(), await onboard.text()).toBe(200);
  const userId = (await userIdOf(account.email))!;
  const rows = await getDb().execute<{ id: string; slug: string }>(sql`
    SELECT id::text AS id, slug FROM person WHERE claimed_by_user_id = ${userId} AND deleted_at IS NULL`);
  expect(rows.rows).toHaveLength(1);
  return { context, page, email: account.email, userId, name, personId: rows.rows[0]!.id, slug: rows.rows[0]!.slug };
}

/** Another browser context signed in as a seeded account or role. */
async function signedIn(browser: Browser, target: SignInTarget) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(context);
  const page = await context.newPage();
  await signInAs(page, target);
  return { context, page, userId: (await userIdOf(`demo-${target === 'user' ? 'root-a' : target}@example.test`))! };
}

/** A file for the evidence field: its name, type and bytes. */
interface FilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** Chooses files in the plain file field (no drag and drop) and waits for each answer. */
async function chooseFiles(page: Page, files: FilePayload[], expected: 'done' | 'refused' = 'done') {
  const uploader = visible(page.getByTestId('evidence-uploader')).first();
  const before = await uploader.getByTestId('evidence-item').count();
  await uploader.getByTestId('evidence-input').setInputFiles(files);
  const items = uploader.getByTestId('evidence-item');
  await expect(items).toHaveCount(before + files.length);
  for (let i = before; i < before + files.length; i += 1) await expect(items.nth(i)).toHaveAttribute('data-state', expected, { timeout: 60_000 });
  return items;
}

/** The ids of the files uploaded in the claim form (its hidden `evidenceIds` fields). */
async function uploadedIds(page: Page): Promise<string[]> {
  return visible(page.getByTestId('historical-claim-form')).locator('input[type="hidden"][name="evidenceIds"]').evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value));
}

/** Fills the claim form for a new historical record (the files are chosen separately). */
async function fillClaim(page: Page, teacherName: string) {
  const form = visible(page.getByTestId('historical-claim-form'));
  await form.getByLabel(/^Teacher.s name in Latin letters/).fill(teacherName);
  await form.getByLabel('Has the teacher died?').selectOption({ label: 'Yes, the teacher has died' });
  await form.getByLabel(/^Lineage of this training/).selectOption({ label: CLAIM_LINEAGE });
  await form.getByLabel('Started (year)').fill('1981');
  await form.getByLabel('Ended (year)').fill('1994');
  await form.getByLabel(/^Note for the reviewers/).fill('A fictional certificate of the demo data.');
}

/** Sends the filled claim form; returns the relationship's id from the address it lands on. */
async function sendClaim(page: Page): Promise<string> {
  await visible(page.getByRole('button', { name: 'Send the claim' })).click();
  await page.waitForURL(/\/dashboard\/teachers\?claimed=/);
  await expect(visible(page.getByTestId('claim-sent'))).toBeVisible();
  return new URL(page.url()).searchParams.get('claimed')!;
}

/** A claim through the page: a new historical teacher with one fictional PDF. */
async function claimThroughPage(student: Member, teacherName: string): Promise<string> {
  const { page } = student;
  await page.goto('/dashboard/teachers/historical');
  await fillClaim(page, teacherName);
  await chooseFiles(page, [{ name: 'demo-certificate.pdf', mimeType: 'application/pdf', buffer: fictionalPdf(40_000) }]);
  return sendClaim(page);
}

async function relationshipRow(id: string) {
  const rows = await getDb().execute<{ status: string; visibility: string; path: string; teacher: string; slug: string }>(sql`
    SELECT r.status, r.visibility, r.verification_path AS path, r.teacher_person_id::text AS teacher, t.slug
      FROM teaching_relationship r JOIN person t ON t.id = r.teacher_person_id
     WHERE r.id = ${id}::uuid`);
  return rows.rows[0]!;
}

async function fileRow(id: string) {
  const rows = await getDb().execute<{ sha256: string; original_sha256: string | null; size_bytes: number; storage_key: string; mime: string }>(sql`
    SELECT sha256, original_sha256, size_bytes, storage_key, mime FROM evidence_file WHERE id = ${id}::uuid`);
  return rows.rows[0]!;
}

async function auditCount(action: string, subjectId: string): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_log WHERE action = ${action} AND subject_id = ${subjectId}`);
  return rows.rows[0]!.n;
}

/** The stored object's bytes, read from the evidence store the app uses. */
async function storedBytes(storageKey: string): Promise<Buffer> {
  const object = await getEvidenceStore().get(storageKey);
  expect(object, 'the stored object').not.toBeNull();
  return Buffer.from(await new Response(object!.body).arrayBuffer());
}

/** review.decide verify by the seeded administrator, through the API (any case, assigned or not). */
async function verifyAsAdmin(browser: Browser, relationshipId: string) {
  const admin = await signedIn(browser, 'admin');
  const { id } = await caseOf(relationshipId);
  const decided = await apiPost(admin.page, '/review/decide', { caseId: id, decision: 'verify', reason: null, idempotencyKey: randomUUID() });
  expect(decided.status(), await decided.text()).toBe(200);
  await admin.context.close();
}

/** POST /api/v1/search as an anonymous client: the JSON text of the answer. */
async function searchText(request: APIRequestContext, q: string): Promise<string> {
  const response = await request.post(`${BASE_URL}/api/v1/search`, { data: { q } });
  expect(response.status()).toBe(200);
  return response.text();
}

/** The people an anonymous search finds, as JSON text (the answer also repeats the query). */
async function searchPeople(request: APIRequestContext, q: string): Promise<string> {
  return JSON.stringify((JSON.parse(await searchText(request, q)) as { people: unknown[] }).people);
}

test('@M10a a student claims a fictional historical teacher with a PDF; an archivist verifies it in /admin/review; the edge becomes public', async ({ browser, request }) => {
  const student = await member(browser, 'Claimant');
  const teacherName = `Demo Ancestor ${capital(token())}`;
  const relationshipId = await claimThroughPage(student, teacherName);
  const before = await relationshipRow(relationshipId);
  expect(before).toMatchObject({ status: 'under_review', visibility: 'involved_only', path: 'committee_review' });
  const reviewCase = await caseOf(relationshipId);
  expect(reviewCase.status).toBe('open');
  // The student sees the claim waiting, with its file.
  const waiting = visible(student.page.getByTestId('claim-review'));
  await expect(waiting).toHaveAttribute('data-case-status', 'open');
  await expect(waiting.getByTestId('claim-files')).toContainText('demo-certificate.pdf');

  // The archivist finds it in the queue, takes it, opens the file and verifies the claim.
  const archivist = await signedIn(browser, 'archivist');
  const { page } = archivist;
  await page.goto('/admin/review?assigned=none&sort=newest');
  const row = visible(page.locator(`tr[data-case="${reviewCase.id}"]`));
  await expect(row).toContainText('Historical teacher');
  await expect(row).toContainText(teacherName);
  await row.getByTestId('case-link').click();
  await page.waitForURL(new RegExp(`/admin/review/${reviewCase.id}`));
  await expect(visible(page.getByTestId('case-status'))).toHaveAttribute('data-status', 'open');
  // Not assigned yet: the file is listed but does not open.
  await expect(visible(page.getByTestId('case-file')).getByRole('link')).toHaveCount(0);
  await visible(page.getByRole('button', { name: 'Assign to me' })).click();
  await page.waitForURL(/[?&]done=assigned/);
  await expect(visible(page.getByTestId('case-outcome'))).toContainText('assigned');
  const fileLink = visible(page.getByTestId('case-file')).getByRole('link', { name: 'demo-certificate.pdf' });
  const href = (await fileLink.getAttribute('href'))!;
  expect(href).toMatch(/^\/api\/evidence\/[0-9a-f-]{36}$/);
  const download = await page.request.get(href);
  expect(download.status()).toBe(200);
  expect(download.headers()['content-disposition']).toMatch(/^attachment; /);

  await visible(page.getByText('Verify the claim…')).click();
  await visible(page.getByRole('button', { name: 'Verify the claim', exact: true })).click();
  await page.waitForURL(/[?&]done=verified/);
  await expect(visible(page.getByTestId('case-outcome'))).toContainText('The claim is verified');
  await expect(visible(page.getByTestId('case-status'))).toHaveAttribute('data-status', 'resolved');

  // The link and the teacher's record are public now: event and audit by the archivist.
  expect(await relationshipRow(relationshipId)).toMatchObject({ status: 'verified', visibility: 'public' });
  const events = await getDb().execute<{ actor: string; role: string }>(sql`
    SELECT actor_user_id::text AS actor, actor_role AS role FROM relationship_event WHERE relationship_id = ${relationshipId}::uuid AND to_status = 'verified'`);
  expect(events.rows).toEqual([{ actor: archivist.userId, role: 'archivist' }]);
  expect(await auditCount('relationship.verify', relationshipId)).toBe(1);
  const profile = await request.get(`${BASE_URL}/api/v1/people/${before.slug}`);
  expect(profile.status()).toBe(200);
  const ego = await request.post(`${BASE_URL}/api/rpc/lineage/ego`, { data: { json: { focusId: student.personId, up: 1, down: 0 } }, headers: { origin: BASE_URL } });
  const edges = ((await ego.json()) as { json: { edges: { teacherId: string; studentId: string; status: string }[] } }).json.edges;
  expect(edges.filter((e) => e.studentId === student.personId)).toEqual([expect.objectContaining({ teacherId: before.teacher, status: 'verified' })]);
  // On the student's page, the decision.
  await student.page.goto('/dashboard/teachers');
  await expect(visible(student.page.locator(`li[data-relationship="${relationshipId}"]`))).toContainText('Verified');
  await Promise.all([student.context.close(), archivist.context.close()]);
});

test('@M10a a historical teacher record created by a student is absent from anonymous HTML, API, search and sitemap until verified', async ({ browser, request }) => {
  const student = await member(browser, 'Claimant');
  const stranger = await member(browser, 'Stranger');
  const find = capital(token(7));
  const teacherName = `Demo Forebear ${find}`;
  const { relationshipId } = await claimThroughApi(student.page, teacherName);
  const { slug, teacher } = await relationshipRow(relationshipId);
  const visibility = await getDb().execute<{ visibility: string }>(sql`SELECT visibility FROM person WHERE id = ${teacher}::uuid`);
  expect(visibility.rows[0]!.visibility).toBe('involved_only');

  // Anonymous: the profile page, its list view and the API answer 404; search and the sitemap do not name it.
  for (const path of [`/people/${slug}`, `/people/${slug}/lineage`]) {
    const page = await request.get(`${BASE_URL}${path}`);
    expect(page.status(), path).toBe(404);
    expect(await page.text(), path).not.toContain(find);
  }
  expect((await request.get(`${BASE_URL}/api/v1/people/${slug}`)).status()).toBe(404);
  expect((await request.get(`${BASE_URL}/api/v1/people/${slug}/students`)).status()).toBe(404);
  const searched = await searchPeople(request, teacherName);
  expect(searched).not.toContain(slug);
  expect(searched).not.toContain(find);
  // No sitemap exists in Phase 1 yet; whatever /sitemap.xml answers never names the record.
  const sitemap = await request.get(`${BASE_URL}/sitemap.xml`);
  expect(await sitemap.text()).not.toContain(slug);
  // An unrelated signed-in member sees no more than an anonymous visitor.
  expect((await stranger.page.request.get(`/people/${slug}`)).status()).toBe(404);
  expect((await stranger.page.request.get(`/api/v1/people/${slug}`)).status()).toBe(404);

  // Verified: the same addresses show it, so the answers above were about this very record.
  await verifyAsAdmin(browser, relationshipId);
  expect((await request.get(`${BASE_URL}/api/v1/people/${slug}`)).status()).toBe(200);
  const page = await request.get(`${BASE_URL}/people/${slug}`);
  expect(page.status()).toBe(200);
  expect(await page.text()).toContain(find);
  await expect.poll(() => searchPeople(request, teacherName), { timeout: 15_000 }).toContain(slug);
  await Promise.all([student.context.close(), stranger.context.close()]);
});

test('@M10a evidence download: the uploader is allowed; an unrelated user and an anonymous visitor get 404; every download writes evidence.view', async ({ browser, request }) => {
  const [student, stranger] = await Promise.all([member(browser, 'Uploader'), member(browser, 'Stranger')]);
  const pdf = fictionalPdf(64_000);
  const uploaded = await uploadRequest(student.page, pdf, 'demo-letter.pdf');
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  const { id, href } = ((await uploaded.json()) as { evidence: { id: string; href: string } }).evidence;

  const first = await student.page.request.get(href);
  expect(first.status()).toBe(200);
  expect(first.headers()['content-disposition']).toBe(`attachment; filename="evidence-${id}.pdf"`);
  expect(first.headers()['cache-control']).toBe('no-store');
  expect(first.headers()['x-content-type-options']).toBe('nosniff');
  expect(sha256(await first.body())).toBe(sha256(pdf));
  expect(await auditCount('evidence.view', id)).toBe(1);

  const missing = await student.page.request.get(`/api/evidence/${randomUUID()}`);
  expect(missing.status()).toBe(404);
  for (const [who, response] of [
    ['an unrelated user', await stranger.page.request.get(href)],
    ['an anonymous visitor', await request.get(`${BASE_URL}${href}`)],
  ] as const) {
    expect(response.status(), who).toBe(404);
    expect(await response.text(), who).toBe(await missing.text());
    expect(response.headers()['content-disposition'], who).toBeUndefined();
  }
  // Refusals write nothing; each download by the uploader writes one more row.
  expect(await auditCount('evidence.view', id)).toBe(1);
  expect((await student.page.request.get(href)).status()).toBe(200);
  expect(await auditCount('evidence.view', id)).toBe(2);
  const rows = await getDb().execute<{ actor: string }>(sql`SELECT actor_user_id::text AS actor FROM audit_log WHERE action = 'evidence.view' AND subject_id = ${id}`);
  expect(rows.rows.every((r) => r.actor === student.userId)).toBe(true);
  await Promise.all([student.context.close(), stranger.context.close()]);
});

test("@M10a a 15 MB PDF is stored intact: the stored object's SHA-256 equals the client-side SHA-256", async ({ browser }) => {
  test.setTimeout(120_000);
  const student = await member(browser, 'Archive');
  const { page } = student;
  await page.goto('/dashboard/teachers/historical');
  const pdf = fictionalPdf(15 * MB, 'fifteen-megabytes');
  const input = visible(page.getByTestId('evidence-input'));
  await input.setInputFiles({ name: 'demo-register.pdf', mimeType: 'application/pdf', buffer: pdf });
  // The client's own SHA-256 of the file it was given, computed in the browser.
  const clientHash = await input.evaluate(async (element) => {
    const file = (element as HTMLInputElement).files![0]!;
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  });
  const item = visible(page.getByTestId('evidence-item')).first();
  await expect(item).toHaveAttribute('data-state', 'done', { timeout: 90_000 });
  await expect(item).toContainText('15.0 MB');
  const [id] = await uploadedIds(page);
  const row = await fileRow(id!);
  expect({ mime: row.mime, size: Number(row.size_bytes), original: row.original_sha256 }).toEqual({ mime: 'application/pdf', size: 15 * MB, original: null });
  const stored = await storedBytes(row.storage_key);
  expect(stored.length).toBe(15 * MB);
  expect(sha256(stored)).toBe(clientHash);
  expect(row.sha256).toBe(clientHash);
  expect(clientHash).toBe(sha256(pdf));
  await student.context.close();
});

test('@M10a upload refuses a renamed executable and a file over 20 MB', async ({ browser }) => {
  test.setTimeout(120_000);
  const student = await member(browser, 'Refused');
  const { page } = student;
  await page.goto('/dashboard/teachers/historical');
  // An ELF executable named as a PDF: the server reads its first bytes and refuses it (415).
  const executable = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), Buffer.alloc(4096, 0x90)]);
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/evidence/upload');
  const items = await chooseFiles(page, [{ name: 'demo-certificate.pdf', mimeType: 'application/pdf', buffer: executable }], 'refused');
  expect((await answered).status()).toBe(415);
  await expect(items.last()).toContainText('The contents of this file are not a JPEG, PNG or WebP image or a PDF');
  // A file over 20 MB is stopped by the field before it is sent ...
  await chooseFiles(page, [{ name: 'demo-scan.pdf', mimeType: 'application/pdf', buffer: fictionalPdf(20 * MB + 1) }], 'refused');
  await expect(items.last()).toContainText('Larger than 20 MB');
  // ... and refused by the server all the same when a client sends it (413).
  const large = await uploadRequest(page, fictionalPdf(21 * MB), 'demo-scan.pdf');
  expect(large.status()).toBe(413);
  expect(((await large.json()) as { code: string }).code).toBe('PAYLOAD_TOO_LARGE');
  const renamed = await uploadRequest(page, executable, 'demo-photo.jpg');
  expect(renamed.status()).toBe(415);
  // Nothing was stored for this account.
  const rows = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM evidence_file WHERE uploaded_by_user_id = ${student.userId}::uuid`);
  expect(rows.rows[0]!.n).toBe(0);
  await expect(visible(page.getByTestId('historical-claim-form')).locator('input[name="evidenceIds"]')).toHaveCount(0);
  await student.context.close();
});

test('@M10a at 390x844 evidence is attached through the plain file input without drag and drop', async ({ browser }) => {
  const student = await member(browser, 'Phone', { viewport: { width: 390, height: 844 } });
  const { page } = student;
  await page.goto('/dashboard/teachers/historical');
  const input = visible(page.getByTestId('evidence-input'));
  // A plain file field: the system picker of a phone or a webview, with the allowed types.
  await expect(input).toHaveAttribute('type', 'file');
  await expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,application/pdf');
  await expect(input).toBeVisible();
  await expect(input).toBeEnabled();
  const box = (await input.boundingBox())!;
  expect(box.height, 'the file field is a 44 px touch target').toBeGreaterThanOrEqual(44);
  await expect(page.getByLabel('Add files')).toHaveCount(1);
  await fillClaim(page, `Demo Phone Teacher ${capital(token())}`);
  // A photograph with a camera name and a GPS position, chosen in the field: no drag, no drop.
  const photo = Buffer.from(await jpegWithGps());
  await chooseFiles(page, [{ name: 'demo-photo.jpg', mimeType: 'image/jpeg', buffer: photo }]);
  const [id] = await uploadedIds(page);
  const row = await fileRow(id!);
  expect(row.original_sha256).toBe(sha256(photo));
  const stored = await storedBytes(row.storage_key);
  expect(stored.includes(Buffer.from('DemoCam'))).toBe(false);
  expect(stored.includes(Buffer.from('Exif'))).toBe(false);
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(widths.scroll, 'no horizontal scroll').toBeLessThanOrEqual(widths.client);
  const relationshipId = await sendClaim(page);
  expect((await relationshipRow(relationshipId)).status).toBe('under_review');
  const links = await getDb().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM evidence_link l JOIN review_case c ON c.id = l.review_case_id WHERE c.relationship_id = ${relationshipId}::uuid AND l.evidence_file_id = ${id}::uuid`);
  expect(links.rows[0]!.n).toBe(1);
  await student.context.close();
});

test('@M10a a signed-in non-staff user on /admin/review sees the explicit denied state', async ({ page, request }) => {
  await signInAs(page, 'user');
  const response = await page.goto('/admin/review');
  expect(response?.status()).toBe(200);
  const denied = visible(page.getByTestId('review-denied'));
  await expect(denied).toContainText("You don't have access to the review queue. It is available to archivists, moderators and administrators.");
  await expect(page.getByRole('heading', { level: 1, name: 'Not available' })).toBeVisible();
  await expect(page.getByTestId('review-table')).toHaveCount(0);
  // The case card and the archival record say the same; the API refuses (403).
  const seeded = await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM review_case WHERE kind = 'historical_claim' ORDER BY created_at LIMIT 1`);
  await page.goto(`/admin/review/${seeded.rows[0]!.id}`);
  await expect(visible(page.getByTestId('review-denied'))).toBeVisible();
  await page.goto('/admin/review/records/demo-root-c');
  await expect(visible(page.getByTestId('review-denied'))).toBeVisible();
  expect((await page.request.get('/api/v1/review', { headers: { origin: BASE_URL } })).status()).toBe(403);
  // Anonymous: sent to sign in first.
  const anonymous = await request.get(`${BASE_URL}/admin/review`, { maxRedirects: 0 });
  expect([200, 307, 303]).toContain(anonymous.status());
  if (anonymous.status() === 200) expect(await anonymous.text()).not.toContain('review-table');
});

test('@M10a an archival edit of demo-root-c requires a reason and records actor, role and linked evidence in audit_log; a moderator without the archivist role cannot edit', async ({ browser }) => {
  const person = await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM person WHERE slug = 'demo-root-c'`);
  const personId = person.rows[0]!.id;
  const archivist = await signedIn(browser, 'archivist');
  const { page } = archivist;
  await page.goto('/admin/review/records/demo-root-c');
  const form = visible(page.getByTestId('archive-form'));
  await expect(form).toBeVisible();
  const bio = form.getByLabel(/^Biography \(English\)/);
  const originalBio = await bio.inputValue();
  const auditsBefore = await auditCount('person.update', personId);

  // A changed biography and a linked file, but no reason: refused, nothing written.
  await bio.fill(`A fictional founding teacher of Demo Lineage C, as the fictional register ${token(4)} records.`);
  await chooseFiles(page, [{ name: 'demo-register.pdf', mimeType: 'application/pdf', buffer: fictionalPdf(30_000) }]);
  const fileId = await form.locator('input[type="hidden"][name="evidenceIds"]').inputValue();
  await form.getByRole('button', { name: 'Save the record' }).click();
  await expect(form.getByText('Write the reason for this edit.').first()).toBeVisible();
  expect(await auditCount('person.update', personId)).toBe(auditsBefore);

  // With a reason: saved, and the audit row names the archivist, the role, the reason and the file.
  const reason = `The fictional register of Demo Lineage C, page ${token(3)}.`;
  await form.getByLabel(/^Reason/).fill(reason);
  await form.getByRole('button', { name: 'Save the record' }).click();
  await page.waitForURL(/[?&]done=saved/);
  await expect(visible(page.getByTestId('record-outcome'))).toContainText('The record is saved');
  const audits = await getDb().execute<{ actor: string; role: string; reason: string; evidence_ids: string[] | null; after: { evidence_ids: string[]; archival: boolean } }>(sql`
    SELECT actor_user_id::text AS actor, actor_role AS role, reason, evidence_ids::text[] AS evidence_ids, after FROM audit_log
     WHERE action = 'person.update' AND subject_id = ${personId} ORDER BY created_at DESC, id DESC LIMIT 1`);
  // reason and evidence_ids in their own columns (plan §6.6), and the ids in `after` as well.
  expect(audits.rows[0]).toMatchObject({ actor: archivist.userId, role: 'archivist', reason, evidence_ids: [fileId], after: { archival: true, evidence_ids: [fileId] } });
  await expect(visible(page.getByTestId('record-files'))).toContainText('demo-register.pdf');

  // The demo record is put back as it was (the file stays linked), so other screens are unchanged.
  // From the page's own address, so the next ?done= is this save's answer, not the last one's.
  await page.goto('/admin/review/records/demo-root-c');
  const restore = visible(page.getByTestId('archive-form'));
  await restore.getByLabel(/^Biography \(English\)/).fill(originalBio);
  await restore.getByLabel(/^Reason/).fill('Restore the demo record after the end-to-end test.');
  await restore.getByRole('button', { name: 'Save the record' }).click();
  await page.waitForURL(/[?&]done=saved/);
  expect(await auditCount('person.update', personId)).toBe(auditsBefore + 2);

  // A moderator reads the record but cannot edit it: no form, and the API answers 403.
  const moderator = await signedIn(browser, 'moderator');
  await moderator.page.goto('/admin/review/records/demo-root-c');
  await expect(visible(moderator.page.getByTestId('archive-refusal'))).toContainText('Only an archivist edits archival records.');
  await expect(moderator.page.getByTestId('archive-form')).toHaveCount(0);
  const refused = await apiPost(moderator.page, '/archive/update', { personId, primaryName: 'Demo Changed Name', lifeStatus: 'deceased', reason: 'A moderator tries.', evidenceIds: [] });
  expect(refused.status()).toBe(403);
  expect(await auditCount('person.update', personId)).toBe(auditsBefore + 2);
  const latest = await getDb().execute<{ actor: string }>(sql`SELECT actor_user_id::text AS actor FROM audit_log WHERE action = 'person.update' AND subject_id = ${personId} ORDER BY created_at DESC, id DESC LIMIT 1`);
  expect(latest.rows[0]!.actor).toBe(archivist.userId);
  await Promise.all([archivist.context.close(), moderator.context.close()]);
});

test('@M10a storage keys and evidence URLs never appear in public HTML or API responses', async ({ browser, request }) => {
  const student = await member(browser, 'Keys');
  const teacherName = `Demo Keeper ${capital(token())}`;
  const { relationshipId, fileId } = await claimThroughApi(student.page, teacherName);
  const { slug, teacher } = await relationshipRow(relationshipId);
  const { storage_key: storageKey } = await fileRow(fileId);
  const secret = storageKey.split('/').pop()!;
  await verifyAsAdmin(browser, relationshipId);

  const forbidden = [storageKey, secret, '/api/evidence/', fileId];
  const expectClean = (label: string, text: string) => {
    for (const needle of forbidden) expect(text.includes(needle), `${label} contains ${needle === secret ? 'the storage key' : needle}`).toBe(false);
  };
  // Public pages and API answers about the newly public teacher and the student.
  for (const path of [`/people/${slug}`, `/people/${slug}/lineage`, `/people/${student.slug}`, `/people/${student.slug}/lineage`, '/explore', '/sitemap.xml']) {
    expectClean(path, await (await request.get(`${BASE_URL}${path}`)).text());
  }
  for (const path of [`/api/v1/people/${slug}`, `/api/v1/people/${student.slug}`, `/api/v1/people/${slug}/students`]) {
    const response = await request.get(`${BASE_URL}${path}`);
    expect(response.status(), path).toBe(200);
    expectClean(path, await response.text());
  }
  const ego = await request.post(`${BASE_URL}/api/rpc/lineage/ego`, { data: { json: { focusId: teacher, up: 1, down: 1 } }, headers: { origin: BASE_URL } });
  expectClean('lineage.ego', await ego.text());
  expectClean('search', await searchText(request, teacherName));

  // Not even the private pages carry the storage key: the student's own page and the case card.
  await student.page.goto('/dashboard/teachers');
  expect((await student.page.content()).includes(secret), 'Your teachers').toBe(false);
  const admin = await signedIn(browser, 'admin');
  const { id: caseId } = await caseOf(relationshipId);
  await admin.page.goto(`/admin/review/${caseId}`);
  expect((await admin.page.content()).includes(secret), 'the case card').toBe(false);
  const caseApi = await admin.page.request.get(`/api/v1/review/${caseId}`, { headers: { origin: BASE_URL } });
  expect(caseApi.status()).toBe(200);
  expect((await caseApi.text()).includes(secret), 'review.get').toBe(false);
  // Nor the web server's log (CLAUDE.md §6).
  const log = runPaths(true).serverLog;
  if (existsSync(log)) expect(readFileSync(log, 'utf8').includes(secret), 'the server log').toBe(false);
  await Promise.all([student.context.close(), admin.context.close()]);
});

// --- M10a review (screens-1 to screens-11): focus, announcements, names and layout -------------

/** An ELF executable: the server reads its first bytes and refuses it, whatever its name. */
const EXECUTABLE = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), Buffer.alloc(4096, 0x90)]);

/** The document's widths with the root text at 200 % (a webview's text zoom). */
async function widthsAt200(page: Page) {
  return page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
    return { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth };
  });
}

test('@M10a the evidence field keeps the focus while files upload and after each Remove; its log reads every file and a summary; a refused file says "Not uploaded"', async ({ browser }) => {
  test.setTimeout(120_000);
  const student = await member(browser, 'Focus', { viewport: { width: 390, height: 844 } });
  const { page } = student;
  // Each answer comes a little later, so the field is seen while its files upload.
  await page.route('**/api/evidence/upload', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });
  await page.goto('/dashboard/teachers/historical');
  const uploader = visible(page.getByTestId('evidence-uploader')).first();
  const input = uploader.getByTestId('evidence-input');
  await input.focus();
  await input.setInputFiles([
    { name: 'demo-certificate.pdf', mimeType: 'application/pdf', buffer: fictionalPdf(40_000) },
    { name: 'demo-scan.jpg', mimeType: 'image/jpeg', buffer: EXECUTABLE },
    { name: 'demo-training-photo.png', mimeType: 'image/png', buffer: Buffer.from(await plainImage('png')) },
    { name: 'demo-register.pdf', mimeType: 'application/pdf', buffer: fictionalPdf(20 * MB + 1) },
  ]);
  // Screens-2: while they upload the field says it is unavailable, yet keeps the focus.
  await expect(input).toHaveAttribute('aria-disabled', 'true');
  await expect(input).toBeFocused();
  const items = uploader.getByTestId('evidence-item');
  await expect(items).toHaveCount(4);
  for (const [i, state] of (['done', 'refused', 'done', 'refused'] as const).entries()) {
    await expect(items.nth(i)).toHaveAttribute('data-state', state, { timeout: 60_000 });
  }
  await expect(input).not.toHaveAttribute('aria-disabled', /.*/);
  await expect(input).toBeFocused();

  // Screens-4: every file's outcome is a line of its own in a polite log, then a summary.
  const log = uploader.getByTestId('evidence-log');
  await expect(log).toHaveAttribute('role', 'log');
  await expect(log).toContainText('2 of 4 files uploaded. Not uploaded: demo-scan.jpg, demo-register.pdf.');
  expect(await log.locator('p').allTextContents()).toEqual([
    'Uploading 4 files…',
    'demo-certificate.pdf: uploaded.',
    expect.stringMatching(/^demo-scan\.jpg: not uploaded\. The contents of this file are not a JPEG, PNG or WebP image or a PDF/),
    'demo-training-photo.png: uploaded.',
    'demo-register.pdf: not uploaded. Larger than 20 MB. Upload a smaller copy, or split the document.',
    '2 of 4 files uploaded. Not uploaded: demo-scan.jpg, demo-register.pdf.',
  ]);

  // Screens-9: a refused file says "Not uploaded" with the alert icon and a thick edge (a shape,
  // not colour alone); an uploaded one says "Uploaded".
  for (const i of [1, 3]) {
    const refusal = items.nth(i).getByTestId('evidence-refusal');
    await expect(refusal).toContainText(/^Not uploaded: /);
    await expect(refusal.locator('svg')).toHaveCount(1);
  }
  await expect(items.nth(0).getByTestId('evidence-refusal')).toHaveCount(0);
  await expect(items.nth(0)).toContainText('Uploaded · PDF');
  const edge = (i: number) => items.nth(i).evaluate((row) => Number.parseFloat(getComputedStyle(row).borderLeftWidth));
  expect(await edge(1)).toBeGreaterThanOrEqual(4);
  expect(await edge(0)).toBeLessThan(2);
  for (const theme of ['dark', 'light'] as const) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `the evidence field with uploaded and refused files (${theme})`);
  }

  // Screens-2: after Remove the focus goes to the next file's Remove, else the previous one's,
  // else the file field, and the removal is said, for a refused file too.
  const removeButton = (name: string) => uploader.getByRole('button', { name: `Remove ${name}`, exact: true });
  const removeWithKeyboard = async (name: string) => {
    await removeButton(name).focus();
    await page.keyboard.press('Enter');
    await expect(log).toHaveText(`${name}: removed.`);
  };
  await removeWithKeyboard('demo-scan.jpg');
  await expect(items).toHaveCount(3);
  await expect(removeButton('demo-training-photo.png')).toBeFocused();
  await removeWithKeyboard('demo-register.pdf');
  await expect(items).toHaveCount(2);
  await expect(removeButton('demo-training-photo.png')).toBeFocused();
  await removeWithKeyboard('demo-training-photo.png');
  await expect(items).toHaveCount(1);
  await expect(removeButton('demo-certificate.pdf')).toBeFocused();
  await removeWithKeyboard('demo-certificate.pdf');
  await expect(items).toHaveCount(0);
  await expect(input).toBeFocused();
  await student.context.close();
});

test('@M10a at 390x844 the claim page keeps to the screen with text at 200%, and the error summary links to the evidence field', async ({ browser }) => {
  const student = await member(browser, 'Reflow', { viewport: { width: 390, height: 844 } });
  const { page } = student;
  await page.goto('/dashboard/teachers/historical');
  // Screens-7: the search box's heading breaks "WingChunRoots?" instead of widening the page.
  const fresh = await widthsAt200(page);
  expect(fresh.scroll, 'the claim page at 200% text').toBeLessThanOrEqual(fresh.client);

  await page.goto('/dashboard/teachers/historical');
  const form = visible(page.getByTestId('historical-claim-form'));
  await form.getByLabel(/^Teacher.s name in Latin letters/).fill(`Demo Reflow Teacher ${capital(token())}`);
  await form.getByRole('button', { name: 'Send the claim' }).click();
  const summary = visible(page.locator('[data-form-message]'));
  await expect(summary).toBeFocused();
  // Screens-3: the summary's Evidence link moves the focus to the file field.
  const link = summary.getByRole('link', { name: 'Evidence: Attach at least one file of evidence.' });
  const input = form.getByTestId('evidence-input');
  expect(await link.getAttribute('href')).toBe(`#${await input.getAttribute('id')}`);
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  const errorId = (await input.getAttribute('aria-errormessage'))!;
  await expect(page.locator(`[id="${errorId}"]`)).toHaveText('Attach at least one file of evidence.');
  const refused = await widthsAt200(page);
  expect(refused.scroll, 'the refused claim form at 200% text').toBeLessThanOrEqual(refused.client);
  await student.context.close();
});

test('@M10a an administrator\'s "Assign" with no reviewer chosen is refused and keeps the assignment; each outcome on the case card takes the focus', async ({ browser }) => {
  test.setTimeout(90_000);
  const student = await member(browser, 'Assigned');
  const { caseId } = await claimThroughApi(student.page, `Demo Assigned ${capital(token())}`);
  const admin = await signedIn(browser, 'admin');
  const { page } = admin;
  const assignment = async () =>
    (await getDb().execute<{ assignee: string | null; status: string }>(sql`
      SELECT assigned_to_user_id::text AS assignee, status FROM review_case WHERE id = ${caseId}::uuid`)).rows[0]!;
  await page.goto(`/admin/review/${caseId}`);
  const outcome = visible(page.getByTestId('case-outcome'));
  await visible(page.getByRole('button', { name: 'Assign to me' })).click();
  await page.waitForURL(/[?&]done=assigned/);
  // Screens-5: the outcome takes the focus.
  await expect(outcome).toBeFocused();
  await expect(outcome).toContainText('The case is assigned.');
  expect(await assignment()).toEqual({ assignee: admin.userId, status: 'in_review' });

  // Screens-1: "Assign" with "Choose a reviewer" left as it is is refused with the field's message;
  // the case stays assigned.
  const choose = visible(page.getByTestId('assign-choose'));
  const select = choose.getByLabel('Give the case to');
  await expect(select).toHaveValue('');
  await choose.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(choose.getByText('Choose a reviewer from the list.')).toBeVisible();
  await expect(select).toHaveAttribute('aria-invalid', 'true');
  await expect(select).toBeFocused();
  expect(page.url()).toMatch(/[?&]done=assigned/);
  await expect(visible(page.getByTestId('case-status'))).toHaveAttribute('data-status', 'in_review');
  expect(await assignment()).toEqual({ assignee: admin.userId, status: 'in_review' });
  // Unassigning is its own action.
  await visible(page.getByRole('button', { name: 'Unassign' })).click();
  await page.waitForURL(/[?&]done=unassigned/);
  await expect(outcome).toBeFocused();
  expect(await assignment()).toEqual({ assignee: null, status: 'open' });
  await visible(page.getByRole('button', { name: 'Assign to me' })).click();
  await page.waitForURL(/[?&]done=assigned/);
  await expect(outcome).toBeFocused();

  // Screens-10: each decision is a disclosure with a chevron that turns when it opens.
  const ask = visible(page.getByTestId('decide-needs_info'));
  const chevron = ask.locator('summary svg');
  await expect(chevron).toHaveCount(1);
  const turn = () => chevron.evaluate((icon) => getComputedStyle(icon).rotate);
  expect(await turn()).toBe('none');
  await ask.locator('summary').click();
  await expect.poll(turn).toBe('180deg');
  await ask.getByLabel(/^Question for the claimant/).fill('Which fictional school register is the certificate from?');
  await ask.getByRole('button', { name: 'Ask for more information', exact: true }).click();
  await page.waitForURL(/[?&]done=asked/);
  await expect(outcome).toBeFocused();
  await expect(outcome).toContainText('Your question was sent to the student.');

  // Screens-5: a note's confirmation is under the notes, where the reviewer is, and takes the focus.
  const notes = visible(page.locator('#notes'));
  await notes.getByLabel(/^Internal note/).fill('A fictional internal note of the demo data.');
  await notes.getByRole('button', { name: 'Add the note' }).click();
  await page.waitForURL(/[?&]done=noted/);
  const noted = notes.getByTestId('case-outcome');
  await expect(noted).toHaveText('The note is added.');
  await expect(noted).toBeFocused();
  await expect(noted).toBeInViewport();
  await expect(outcome).toHaveCount(1);
  // A second note in a row: a new confirmation, which takes the focus again.
  const first = page.url();
  await notes.getByLabel(/^Internal note/).fill('A second fictional internal note of the demo data.');
  await notes.getByRole('button', { name: 'Add the note' }).click();
  await page.waitForURL((url) => url.href !== first && /[?&]done=noted/.test(url.search));
  await expect(notes.getByTestId('case-note')).toHaveCount(4);
  await expect(noted).toBeFocused();

  // Screens-10: on a phone every assign and decision button is as wide as its form.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/review/${caseId}`);
  for (const summary of await visible(page.locator('#actions details > summary')).all()) await summary.click();
  const widths = await visible(page.locator('#actions')).evaluate((section) =>
    [...section.querySelectorAll('form')]
      .filter((form) => form.getClientRects().length > 0)
      .map((form) => {
        const style = getComputedStyle(form);
        const button = form.querySelector('button[type="submit"]')!;
        return { label: button.textContent, button: button.getBoundingClientRect().width, form: form.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight) };
      }),
  );
  expect(widths.map((w) => w.label)).toEqual(['Unassign', 'Assign', 'Verify the claim', 'Refuse the claim', 'Ask for more information']);
  for (const width of widths) expect(Math.abs(width.button - width.form), `${width.label}: ${width.button} of ${width.form} px`).toBeLessThanOrEqual(1);
  for (const theme of ['dark', 'light'] as const) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `the case card with its decisions open (${theme})`);
  }
  await Promise.all([student.context.close(), admin.context.close()]);
});

test('@M10a the outcome of an archival save takes the focus', async ({ browser }) => {
  const person = await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM person WHERE slug = 'demo-root-c'`);
  const before = await auditCount('person.update', person.rows[0]!.id);
  const archivist = await signedIn(browser, 'archivist');
  const { page } = archivist;
  await page.goto('/admin/review/records/demo-root-c');
  const form = visible(page.getByTestId('archive-form'));
  // Nothing changed: nothing is written, and the page says so.
  await form.getByLabel(/^Reason/).fill('A look at the demo record; nothing changes.');
  await form.getByRole('button', { name: 'Save the record' }).click();
  await page.waitForURL(/[?&]done=unchanged/);
  const outcome = visible(page.getByTestId('record-outcome'));
  await expect(outcome).toHaveText('Nothing changed, so nothing was saved.');
  await expect(outcome).toBeFocused();
  // The same save again: a new outcome, which takes the focus again.
  const first = page.url();
  await form.getByLabel(/^Reason/).fill('Another look at the demo record; nothing changes.');
  await form.getByRole('button', { name: 'Save the record' }).click();
  await page.waitForURL((url) => url.href !== first && /[?&]done=unchanged/.test(url.search));
  await expect(outcome).toBeFocused();
  expect(await auditCount('person.update', person.rows[0]!.id)).toBe(before);
  await archivist.context.close();
});

test('@M10a each row of the review queue opens its case under a name of its own, on the row\'s first line; the filters use the app\'s select', async ({ browser }) => {
  const [first, second] = await Promise.all([member(browser, 'Queued'), member(browser, 'Queued')]);
  const teachers = [`Demo Queued ${capital(token())}`, `Demo Queued ${capital(token())}`];
  const claims = [await claimThroughApi(first.page, teachers[0]!), await claimThroughApi(second.page, teachers[1]!)];
  const admin = await signedIn(browser, 'admin');
  const { page } = admin;
  await page.goto('/admin/review?assigned=none&sort=newest');
  // Screens-6: every link names its case: the people and the day it was opened.
  for (const [i, claim] of claims.entries()) {
    const link = visible(page.locator(`tr[data-case="${claim.caseId}"]`)).getByTestId('case-link');
    await expect(link).toHaveAccessibleName(`Historical teacher case: teacher ${teachers[i]}, student ${[first, second][i]!.name}, opened ${formatDayUtc(new Date())}`);
  }
  const names = await visible(page.getByTestId('case-link')).evaluateAll((links) => links.map((link) => (link.textContent ?? '').replace(/\s+/g, ' ').trim()));
  expect(names.length).toBeGreaterThanOrEqual(2);
  expect(new Set(names).size, names.join('\n')).toBe(names.length);

  // Screens-11: in the table the link's text is on the first line of its row, with the other cells.
  const offset = await visible(page.locator(`tr[data-case="${claims[0]!.caseId}"]`)).evaluate((row) => {
    const link = row.querySelector('[data-testid="case-link"]')!;
    const text = document.createRange();
    text.selectNodeContents(link.firstChild!);
    const status = row.querySelectorAll('td')[2]!.lastElementChild!;
    return text.getBoundingClientRect().top - status.getBoundingClientRect().top;
  });
  expect(Math.abs(offset), `the case link is ${offset} px off the row's first line`).toBeLessThanOrEqual(2);
  // The filter selects have no native arrow but the app's chevron.
  for (const id of ['filter-kind', 'filter-status', 'filter-assigned']) {
    const select = visible(page.locator(`#${id}`));
    expect(await select.evaluate((el) => getComputedStyle(el).appearance), id).toBe('none');
    await expect(select.locator('xpath=following-sibling::*[local-name()="svg"]'), id).toHaveCount(1);
  }
  await Promise.all([first.context.close(), second.context.close(), admin.context.close()]);
});

test('@M10a a file added to an open claim on Your teachers is listed once, with the claim\'s files', async ({ browser }) => {
  const student = await member(browser, 'Adder', { viewport: { width: 390, height: 844 } });
  const { page } = student;
  const { relationshipId } = await claimThroughApi(page, `Demo Added ${capital(token())}`);
  await page.goto('/dashboard/teachers');
  const claim = visible(page.locator(`li[data-relationship="${relationshipId}"]`)).getByTestId('claim-review');
  const input = claim.getByTestId('evidence-input');
  await input.setInputFiles({ name: 'demo-letter.pdf', mimeType: 'application/pdf', buffer: fictionalPdf(29_000) });
  await expect(claim.getByTestId('claim-files')).toContainText('demo-letter.pdf');
  // Screens-8: the field does not list it a second time; the log says it joined the claim.
  await expect(claim.getByTestId('evidence-item')).toHaveCount(0);
  await expect(claim.getByText('demo-letter.pdf', { exact: true })).toHaveCount(1);
  await expect(claim.getByTestId('evidence-log')).toContainText('demo-letter.pdf: added to the claim.');
  // A refused file stays listed, in a box of its own on the raised card.
  await input.setInputFiles({ name: 'demo-scan.pdf', mimeType: 'application/pdf', buffer: EXECUTABLE });
  const refused = claim.getByTestId('evidence-item');
  await expect(refused).toHaveAttribute('data-state', 'refused', { timeout: 30_000 });
  const borders = await refused.evaluate((row) => ({ top: Number.parseFloat(getComputedStyle(row).borderTopWidth), left: Number.parseFloat(getComputedStyle(row).borderLeftWidth) }));
  expect(borders.top).toBeGreaterThanOrEqual(1);
  expect(borders.left).toBeGreaterThanOrEqual(4);
  await expect(claim.getByTestId('claim-files')).not.toContainText('demo-scan.pdf');
  await student.context.close();
});

/** "1 November 2026": the day as the pages write it (src/lib/dates.ts, UTC). */
function formatDayUtc(day: Date): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(day);
}
