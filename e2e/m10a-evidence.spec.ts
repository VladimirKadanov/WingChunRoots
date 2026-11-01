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
import { jpegWithGps } from '../src/server/storage/test-images';
import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv, signInAs, userIdOf, type SignInTarget } from './helpers/auth';
import { caseOf, CLAIM_LINEAGE, claimThroughApi, fictionalPdf, letters as token, uploadEvidence as uploadRequest } from './helpers/evidence';
import { apiPost } from './helpers/plans';
import { runPaths } from './projects';

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
  await expect(items.last()).toContainText('Only JPEG, PNG and WebP images and PDF documents can be uploaded');
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
  const audits = await getDb().execute<{ actor: string; role: string; reason: string; after: { evidence_ids: string[]; archival: boolean } }>(sql`
    SELECT actor_user_id::text AS actor, actor_role AS role, reason, after FROM audit_log
     WHERE action = 'person.update' AND subject_id = ${personId} ORDER BY created_at DESC, id DESC LIMIT 1`);
  expect(audits.rows[0]).toMatchObject({ actor: archivist.userId, role: 'archivist', reason, after: { archival: true, evidence_ids: [fileId] } });
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
