/**
 * Milestone M10b: invitations, profile claims, instructor verification, profile reports and
 * arbitration (Done when 2). The flows run through the real pages against `next start`; the
 * database and the outbox are read to check what the pages cannot show (statuses, events, audit
 * rows, the sealed links of the e-mails). Every test makes its own people (`demo-e2e-…@example.test`
 * accounts with fictional `Demo …` names, D20) and its own files, generated here.
 *
 * Approving a claimed request and settling an arbitration make links and records public, so the
 * spec runs in the `exclusive` project, in a Playwright run of its own after the others
 * (e2e/projects.ts, PUBLIC_WRITE_SPECS).
 */

import { randomUUID } from 'node:crypto';

import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { BASE_URL, closeHelpers, emailDataFromOutbox, emailLinkFromOutbox, giveOwnAddress, loadTestEnv, signInAs, uniqueEmail, userIdOf, type SignInTarget } from './helpers/auth';
import { CLAIM_LINEAGE, fictionalPdf, letters, lineageIdOf } from './helpers/evidence';
import { apiPost } from './helpers/plans';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  // Rate limits are per client address: each test is its own client.
  await giveOwnAddress(context);
});

const capital = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/** A visible element (Next.js keeps earlier routes in the document, hidden). */
const visible = (locator: Locator) => locator.filter({ visible: true });

interface Member {
  context: BrowserContext;
  page: Page;
  email: string;
  userId: string;
  name: string;
  personId: string;
  slug: string;
}

/** A new browser context with its own client address. */
async function newClient(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(context);
  return { context, page: await context.newPage() };
}

/** A new confirmed account in a browser context of its own, with a public profile; a Sifu when `sifu`. */
async function member(browser: Browser, label: string, options: { sifu?: boolean } = {}): Promise<Member> {
  const { context, page } = await newClient(browser);
  const account = await signInAs(page, 'new');
  const name = `Demo ${label} ${capital(letters())}`;
  const onboard = await apiPost(page, '/account/onboard', { primaryName: name, showPublicly: true });
  expect(onboard.status(), await onboard.text()).toBe(200);
  if (options.sifu) await becomeSifu(page);
  const userId = (await userIdOf(account.email))!;
  const rows = await getDb().execute<{ id: string; slug: string }>(sql`
    SELECT id::text AS id, slug FROM person WHERE claimed_by_user_id = ${userId} AND deleted_at IS NULL`);
  expect(rows.rows).toHaveLength(1);
  return { context, page, email: account.email, userId, name, personId: rows.rows[0]!.id, slug: rows.rows[0]!.slug };
}

/** The Sifu account type (M08): approving students needs it. */
async function becomeSifu(page: Page) {
  const type = await apiPost(page, '/account/type', { accountType: 'sifu' });
  expect(type.status(), await type.text()).toBe(200);
}

/** Another browser context signed in as a seeded staff role. */
async function signedIn(browser: Browser, target: SignInTarget) {
  const { context, page } = await newClient(browser);
  await signInAs(page, target);
  return { context, page, userId: (await userIdOf(`demo-${target}@example.test`))! };
}

async function relationshipRow(id: string) {
  const rows = await getDb().execute<{ status: string; visibility: string; teacher: string; slug: string; stewardship: string; claimed_by: string | null; person_visibility: string }>(sql`
    SELECT r.status, r.visibility, r.teacher_person_id::text AS teacher, t.slug, t.stewardship, t.claimed_by_user_id::text AS claimed_by, t.visibility AS person_visibility
      FROM teaching_relationship r JOIN person t ON t.id = r.teacher_person_id
     WHERE r.id = ${id}::uuid`);
  return rows.rows[0]!;
}

async function isPublicEdge(id: string): Promise<boolean> {
  const rows = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM v_public_edge WHERE id = ${id}::uuid`);
  return rows.rows[0]!.n === 1;
}

async function auditCount(action: string, subjectId: string): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_log WHERE action = ${action} AND subject_id = ${subjectId}`);
  return rows.rows[0]!.n;
}

/** The transitions of a relationship, oldest first: from → to and the actor's role. */
async function transitions(id: string): Promise<string[]> {
  const rows = await getDb().execute<{ step: string }>(sql`
    SELECT coalesce(from_status, '-') || '>' || to_status || ':' || actor_role AS step
      FROM relationship_event WHERE relationship_id = ${id}::uuid ORDER BY created_at, id`);
  return rows.rows.map((r) => r.step);
}

/** The newest review case of a kind about a person or a relationship. */
async function caseAbout(kind: string, column: 'person_id' | 'relationship_id', id: string): Promise<{ id: string; status: string }> {
  const rows = await getDb().execute<{ id: string; status: string }>(sql`
    SELECT id::text AS id, status FROM review_case WHERE kind = ${kind} AND ${sql.raw(column)} = ${id}::uuid ORDER BY created_at DESC LIMIT 1`);
  expect(rows.rows, `a ${kind} case`).toHaveLength(1);
  return rows.rows[0]!;
}

/** The path of an invitation link (the e-mail's origin is APP_URL; the test server is BASE_URL). */
async function invitationPath(email: string): Promise<string> {
  const link = new URL(await emailLinkFromOutbox('invitation', email));
  expect(link.pathname).toMatch(/^\/invite\/[A-Za-z0-9_-]{43}$/);
  return link.pathname;
}

/** A student's invitation of a new teacher record through the API (relationships.invite). */
async function inviteThroughApi(student: Member, teacherName: string, email: string): Promise<string> {
  const invited = await apiPost(student.page, '/relationships/invite', {
    teacherName,
    lineageId: await lineageIdOf(CLAIM_LINEAGE),
    periods: [{ from: '2015', to: null, ongoing: true }],
    email,
    idempotencyKey: randomUUID(),
  });
  expect(invited.status(), await invited.text()).toBe(200);
  return ((await invited.json()) as { relationship: { id: string } }).relationship.id;
}

/** review.decide by the seeded administrator, through the API (any case, assigned or not). */
async function decideAsAdmin(browser: Browser, caseId: string, decision: 'verify' | 'reject', reason: string | null = null) {
  const admin = await signedIn(browser, 'admin');
  const decided = await apiPost(admin.page, '/review/decide', { caseId, decision, reason, idempotencyKey: randomUUID() });
  expect(decided.status(), await decided.text()).toBe(200);
  await admin.context.close();
}

/** A verified link: the student asks (M09), the Sifu approves, both through the API. */
async function verifiedLink(student: Member, teacher: Member): Promise<string> {
  const asked = await apiPost(student.page, '/relationships/request', {
    teacherId: teacher.personId,
    lineageId: await lineageIdOf(CLAIM_LINEAGE),
    periods: [{ from: '2016', to: null, ongoing: true }],
    idempotencyKey: randomUUID(),
  });
  expect(asked.status(), await asked.text()).toBe(200);
  const relationshipId = ((await asked.json()) as { relationship: { id: string } }).relationship.id;
  const approved = await apiPost(teacher.page, '/relationships/approve', { relationshipId, idempotencyKey: randomUUID() });
  expect(approved.status(), await approved.text()).toBe(200);
  return relationshipId;
}

/** The text of a public page as an anonymous visitor sees it (status 200). */
async function publicText(request: APIRequestContext, path: string): Promise<string> {
  const response = await request.get(`${BASE_URL}${path}`);
  return response.status() === 200 ? response.text() : `status ${response.status()}`;
}

/** The people an anonymous search finds, as JSON text. */
async function searchPeople(request: APIRequestContext, q: string): Promise<string> {
  const response = await request.post(`${BASE_URL}/api/v1/search`, { data: { q } });
  expect(response.status()).toBe(200);
  return JSON.stringify(((await response.json()) as { people: unknown[] }).people);
}

/** Chooses files in the evidence field of the page's form and waits for each upload. */
async function chooseFiles(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  const uploader = visible(page.getByTestId('evidence-uploader')).first();
  await uploader.getByTestId('evidence-input').setInputFiles(files);
  const items = uploader.getByTestId('evidence-item');
  await expect(items).toHaveCount(files.length);
  for (let i = 0; i < files.length; i += 1) await expect(items.nth(i)).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
}

test('@M10b a missing teacher gets an invitation, claims the profile after review, then approves the pending request; before approval the edge stays involved_only', async ({ browser }) => {
  test.setTimeout(120_000);
  const student = await member(browser, 'Student');
  const teacherName = `Demo Mentor ${capital(letters())}`;
  const teacherEmail = uniqueEmail('invited-teacher');

  // The student invites the teacher, with a fictional letter as evidence.
  const { page } = student;
  await page.goto('/dashboard/teachers/invite');
  const form = visible(page.getByTestId('invite-form'));
  await form.getByLabel(/^Teacher.s name in Latin letters/).fill(teacherName);
  await form.getByLabel(/^Lineage of this training/).selectOption({ label: CLAIM_LINEAGE });
  await form.getByLabel('Started (year)').fill('2014');
  await form.getByLabel('I still train with this teacher').check();
  await form.getByLabel(/^Teacher.s e-mail address/).fill(teacherEmail);
  await chooseFiles(page, [{ name: 'demo-letter.pdf', mimeType: 'application/pdf', buffer: fictionalPdf(30_000) }]);
  await visible(page.getByRole('button', { name: 'Invite your teacher' })).click();
  await page.waitForURL(/\/dashboard\/teachers\?invited=/);
  await expect(visible(page.getByTestId('teacher-invited'))).toBeVisible();
  const relationshipId = new URL(page.url()).searchParams.get('invited')!;
  const row = visible(page.locator(`li[data-relationship="${relationshipId}"]`));
  await expect(row.getByTestId('unclaimed-label')).toHaveText('Unclaimed record');
  await expect(row.getByTestId('invitation-state')).toHaveAttribute('data-state', 'sent');

  const before = await relationshipRow(relationshipId);
  expect(before).toMatchObject({ status: 'awaiting_claim', visibility: 'involved_only', stewardship: 'unclaimed', claimed_by: null, person_visibility: 'involved_only' });
  const files = await getDb().execute<{ id: string }>(sql`SELECT evidence_file_id::text AS id FROM evidence_link WHERE relationship_id = ${relationshipId}::uuid`);
  expect(files.rows).toHaveLength(1);
  const fileId = files.rows[0]!.id;
  // Only the token's hash is stored.
  const invitePath = await invitationPath(teacherEmail);
  const hashes = await getDb().execute<{ token_hash: string }>(sql`SELECT token_hash FROM invitation WHERE relationship_id = ${relationshipId}::uuid`);
  expect(hashes.rows).toHaveLength(1);
  expect(hashes.rows[0]!.token_hash).not.toContain(invitePath.split('/').pop()!);

  // The invitee opens the link before signing in: the record, "Unclaimed record", no evidence.
  const invitee = await newClient(browser);
  await invitee.page.goto(invitePath);
  const summary = visible(invitee.page.getByTestId('invitation-summary'));
  await expect(summary).toContainText(teacherName);
  await expect(summary).toContainText(student.name);
  await expect(summary.getByTestId('unclaimed-label')).toHaveText('Unclaimed record');
  await expect(visible(invitee.page.getByRole('link', { name: 'Sign in to claim' }))).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await switchColorScheme(invitee.page, theme);
    await expectNoAxeViolations(invitee.page, `the invitation page (${theme})`);
  }
  const anonymousHtml = await invitee.page.content();
  expect(anonymousHtml).not.toContain('demo-letter.pdf');
  expect(anonymousHtml).not.toContain(fileId);

  // A new account, a Sifu (to approve students), claims the profile.
  const account = await signInAs(invitee.page, 'new');
  await becomeSifu(invitee.page);
  const inviteeId = (await userIdOf(account.email))!;
  await invitee.page.goto(invitePath);
  const accept = visible(invitee.page.getByTestId('accept-invitation-form'));
  await accept.getByLabel(/^Note for the reviewers/).fill('I am the fictional teacher of this demo student.');
  await visible(invitee.page.getByRole('button', { name: 'Claim this profile' })).click();
  await invitee.page.waitForURL(/\/dashboard\/cases\/[0-9a-f-]{36}\?claimed=1/);
  await expect(visible(invitee.page.getByTestId('claim-sent'))).toBeVisible();
  const caseId = new URL(invitee.page.url()).pathname.split('/').pop()!;
  await expect(visible(invitee.page.getByTestId('party-case-status'))).toHaveAttribute('data-status', 'open');
  // The link works once.
  await invitee.page.goto(invitePath);
  await expect(visible(invitee.page.getByTestId('invitation-yours'))).toBeVisible();

  // Before the claim is approved: still awaiting_claim and involved_only; the evidence stays closed.
  expect(await relationshipRow(relationshipId)).toMatchObject({ status: 'awaiting_claim', visibility: 'involved_only', stewardship: 'unclaimed', claimed_by: null });
  expect((await invitee.page.request.get(`/api/evidence/${fileId}`)).status()).toBe(404);
  expect(await invitee.page.content()).not.toContain('demo-letter.pdf');

  // The archivist approves the claim in /admin/review.
  const archivist = await signedIn(browser, 'archivist');
  await archivist.page.goto(`/admin/review/${caseId}`);
  await expect(visible(archivist.page.getByTestId('case-status'))).toHaveAttribute('data-status', 'open');
  await visible(archivist.page.getByRole('button', { name: 'Assign to me' })).click();
  await archivist.page.waitForURL(/[?&]done=assigned/);
  await visible(archivist.page.getByText('Approve the claim…')).click();
  await visible(archivist.page.getByRole('button', { name: 'Approve the claim', exact: true })).click();
  await archivist.page.waitForURL(/[?&]done=verified/);
  await expect(visible(archivist.page.getByTestId('case-status'))).toHaveAttribute('data-status', 'resolved');

  // The record is the invitee's; the request waits for them; the edge is still involved_only.
  const claimed = await relationshipRow(relationshipId);
  expect(claimed).toMatchObject({ status: 'pending_teacher', visibility: 'involved_only', stewardship: 'self', claimed_by: inviteeId, person_visibility: 'involved_only' });
  expect(await isPublicEdge(relationshipId)).toBe(false);

  // The teacher sees the request with the student's evidence (it opens now) and approves it.
  await invitee.page.goto('/dashboard/students/requests');
  const request = visible(invitee.page.locator(`tr[data-relationship="${relationshipId}"]`));
  const evidence = request.getByTestId('request-evidence').getByRole('link', { name: 'demo-letter.pdf' });
  expect(await evidence.getAttribute('href')).toBe(`/api/evidence/${fileId}`);
  expect((await invitee.page.request.get(`/api/evidence/${fileId}`)).status()).toBe(200);
  await request.getByRole('button', { name: /^Approve/ }).click();
  await invitee.page.waitForURL(/[?&]approved=/);

  expect(await relationshipRow(relationshipId)).toMatchObject({ status: 'verified', visibility: 'public', person_visibility: 'public' });
  expect(await isPublicEdge(relationshipId)).toBe(true);
  expect(await transitions(relationshipId)).toEqual(['->awaiting_claim:student', 'awaiting_claim>pending_teacher:archivist', 'pending_teacher>verified:teacher']);
  for (const action of ['relationship.request', 'relationship.claimed', 'relationship.approve']) expect(await auditCount(action, relationshipId), action).toBe(1);
  expect(await auditCount('person.claim', before.teacher)).toBe(2);
  await Promise.all([student.context.close(), invitee.context.close(), archivist.context.close()]);
});

test('@M10b an unclaimed teacher record created by a student is absent from anonymous HTML, API, search and sitemap until verified', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const student = await member(browser, 'Student');
  const stranger = await member(browser, 'Stranger');
  const find = capital(letters(7));
  const teacherName = `Demo Invited ${find}`;
  const teacherEmail = uniqueEmail('unclaimed');
  const relationshipId = await inviteThroughApi(student, teacherName, teacherEmail);
  const { slug } = await relationshipRow(relationshipId);

  const expectAbsent = async (stage: string) => {
    for (const path of [`/people/${slug}`, `/people/${slug}/lineage`]) {
      const page = await request.get(`${BASE_URL}${path}`);
      expect(page.status(), `${stage}: ${path}`).toBe(404);
      expect(await page.text(), `${stage}: ${path}`).not.toContain(find);
    }
    expect((await request.get(`${BASE_URL}/api/v1/people/${slug}`)).status(), stage).toBe(404);
    expect((await request.get(`${BASE_URL}/api/v1/people/${slug}/students`)).status(), stage).toBe(404);
    const searched = await searchPeople(request, teacherName);
    expect(searched, stage).not.toContain(slug);
    expect(searched, stage).not.toContain(find);
    // No sitemap exists in Phase 1 yet; whatever /sitemap.xml answers never names the record.
    expect(await (await request.get(`${BASE_URL}/sitemap.xml`)).text(), stage).not.toContain(slug);
    // An unrelated signed-in member sees no more than an anonymous visitor.
    expect((await stranger.page.request.get(`/people/${slug}`)).status(), stage).toBe(404);
    expect((await stranger.page.request.get(`/api/v1/people/${slug}`)).status(), stage).toBe(404);
  };

  await expectAbsent('invited');
  // The student sees it, labelled as an unclaimed record.
  await student.page.goto('/dashboard/teachers');
  await expect(visible(student.page.locator(`li[data-relationship="${relationshipId}"]`)).getByTestId('unclaimed-label')).toHaveText('Unclaimed record');

  // Claimed and approved by an archivist: the record is the teacher's own, still involved_only.
  const invitee = await newClient(browser);
  await signInAs(invitee.page, 'new');
  await becomeSifu(invitee.page);
  const token = (await invitationPath(teacherEmail)).split('/').pop()!;
  const accepted = await apiPost(invitee.page, '/invitations/accept', { token, idempotencyKey: randomUUID() });
  expect(accepted.status(), await accepted.text()).toBe(200);
  const { caseId } = (await accepted.json()) as { caseId: string };
  await expectAbsent('claimed, not yet approved');
  await decideAsAdmin(browser, caseId, 'verify');
  expect((await relationshipRow(relationshipId)).status).toBe('pending_teacher');
  await expectAbsent('claim approved, request pending');

  // Verified by the teacher: the same addresses show it, so the answers above were about this very record.
  const approved = await apiPost(invitee.page, '/relationships/approve', { relationshipId, idempotencyKey: randomUUID() });
  expect(approved.status(), await approved.text()).toBe(200);
  expect((await request.get(`${BASE_URL}/api/v1/people/${slug}`)).status()).toBe(200);
  await expect.poll(() => publicText(request, `/people/${slug}`), { timeout: 15_000 }).toContain(find);
  await expect.poll(() => searchPeople(request, teacherName), { timeout: 15_000 }).toContain(slug);
  await Promise.all([student.context.close(), stranger.context.close(), invitee.context.close()]);
});

test('@M10b a self-declared Sifu is shown as unverified until an archivist approves instructor evidence', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const sifu = await member(browser, 'Sifu', { sifu: true });
  const student = await member(browser, 'Student');
  const relationshipId = await verifiedLink(student, sifu);

  // Public pages: "Instructor (unverified)" on the Sifu's profile, and the note on the link they approved.
  const fact = async () => {
    const html = await publicText(request, `/people/${sifu.slug}`);
    return /data-instructor="(\w+)"/.exec(html)?.[1] ?? html.slice(0, 80);
  };
  await expect.poll(fact, { timeout: 15_000 }).toBe('unverified');
  const anonymous = await newClient(browser);
  await anonymous.page.goto(`/people/${sifu.slug}`);
  await expect(visible(anonymous.page.getByTestId('instructor-fact'))).toHaveText('Instructor (unverified)');
  await expect.poll(() => publicText(request, `/people/${student.slug}`), { timeout: 15_000 }).toContain('Approved by an unverified instructor');
  const profile = await request.get(`${BASE_URL}/api/v1/people/${sifu.slug}`);
  expect(((await profile.json()) as { instructor: string | null }).instructor).toBe('unverified');

  // The Sifu sends instructor evidence from /dashboard/instructor.
  await sifu.page.goto('/dashboard/instructor');
  await expect(visible(sifu.page.getByTestId('instructor-status'))).toHaveAttribute('data-status', 'unverified');
  await chooseFiles(sifu.page, [{ name: 'demo-instructor-certificate.pdf', mimeType: 'application/pdf', buffer: fictionalPdf(25_000) }]);
  await visible(sifu.page.getByTestId('instructor-form')).getByLabel(/^Note for the reviewers/).fill('A fictional instructor certificate of the demo data.');
  await visible(sifu.page.getByRole('button', { name: 'Send for verification' })).click();
  await sifu.page.waitForURL(/\/dashboard\/instructor\?sent=1/);
  await expect(visible(sifu.page.getByTestId('instructor-sent'))).toBeVisible();
  await expect(visible(sifu.page.getByTestId('instructor-case'))).toHaveAttribute('data-case-status', 'open');
  const instructorCase = await caseAbout('instructor_verification', 'person_id', sifu.personId);
  // Still unverified while the case waits.
  expect(await fact()).toBe('unverified');

  // The archivist takes the case and verifies the instructor.
  const archivist = await signedIn(browser, 'archivist');
  await archivist.page.goto(`/admin/review/${instructorCase.id}`);
  await visible(archivist.page.getByRole('button', { name: 'Assign to me' })).click();
  await archivist.page.waitForURL(/[?&]done=assigned/);
  await expect(visible(archivist.page.getByTestId('case-file')).getByRole('link', { name: 'demo-instructor-certificate.pdf' })).toBeVisible();
  await visible(archivist.page.getByText('Verify the instructor…')).click();
  await visible(archivist.page.getByRole('button', { name: 'Verify the instructor', exact: true })).click();
  await archivist.page.waitForURL(/[?&]done=verified/);
  expect(await auditCount('instructor.verify', sifu.personId)).toBe(1);

  // "Instructor" now, and no note on the link.
  await expect.poll(fact, { timeout: 15_000 }).toBe('verified');
  await anonymous.page.goto(`/people/${sifu.slug}`);
  await expect(visible(anonymous.page.getByTestId('instructor-fact'))).toHaveText('Instructor');
  await expect.poll(() => publicText(request, `/people/${student.slug}`), { timeout: 15_000 }).not.toContain('Approved by an unverified instructor');
  expect(await isPublicEdge(relationshipId)).toBe(true);
  await sifu.page.goto('/dashboard/instructor');
  await expect(visible(sifu.page.getByTestId('instructor-status'))).toHaveAttribute('data-status', 'verified');
  await Promise.all([sifu.context.close(), student.context.close(), anonymous.context.close(), archivist.context.close()]);
});

test('@M10b a moderator sets a relationship to in arbitration with a reason; public pages show "Disputed" and both parties receive a notification with the reason and an evidence-submission link', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const teacher = await member(browser, 'Teacher', { sifu: true });
  const student = await member(browser, 'Student');
  const relationshipId = await verifiedLink(student, teacher);
  const reason = `Fictional: another student reports different training years (${letters()}).`;

  // The moderator sets the link in arbitration with the reason.
  const moderator = await signedIn(browser, 'moderator');
  await moderator.page.goto(`/admin/review/arbitrate/${relationshipId}`);
  const form = visible(moderator.page.getByTestId('arbitrate-form'));
  // The reason is required: the field says so, and nothing changes.
  await visible(moderator.page.getByRole('button', { name: 'Set in arbitration' })).click();
  await expect(form.getByLabel(/^Reason/)).toHaveAttribute('aria-invalid', 'true');
  expect((await relationshipRow(relationshipId)).status).toBe('verified');
  await form.getByLabel(/^Reason/).fill(reason);
  await visible(moderator.page.getByRole('button', { name: 'Set in arbitration' })).click();
  await moderator.page.waitForURL(/\/admin\/review\/[0-9a-f-]{36}\?done=arbitrated/);
  const caseId = new URL(moderator.page.url()).pathname.split('/').pop()!;
  await expect(visible(moderator.page.getByTestId('case-outcome'))).toContainText('Disputed');
  expect((await relationshipRow(relationshipId)).status).toBe('in_arbitration');
  expect(await transitions(relationshipId)).toEqual(['->pending_teacher:student', 'pending_teacher>verified:teacher', 'verified>in_arbitration:moderator']);
  expect(await auditCount('relationship.arbitration', relationshipId)).toBe(1);

  // Public pages say "Disputed" in words, on both profiles; the link stays public.
  expect(await isPublicEdge(relationshipId)).toBe(true);
  for (const m of [student, teacher]) await expect.poll(() => publicText(request, `/people/${m.slug}`), { timeout: 15_000 }).toContain('Disputed');
  const anonymous = await newClient(browser);
  await anonymous.page.goto(`/people/${student.slug}`);
  await expect(visible(anonymous.page.getByText('Disputed', { exact: true })).first()).toBeVisible();

  // Both parties: a notification with the reason and the link, and an e-mail with both.
  for (const m of [student, teacher]) {
    await m.page.goto('/dashboard');
    const note = visible(m.page.getByTestId('notification')).filter({ hasText: 'Relationship in arbitration' });
    await expect(note).toContainText(reason);
    const link = note.getByRole('link', { name: 'Send evidence' });
    expect(await link.getAttribute('href')).toBe(`/dashboard/cases/${caseId}`);
    const mail = await emailDataFromOutbox('relationship-arbitration', m.email);
    expect(mail).toMatchObject({ stage: 'opened', reason });
    expect(new URL(String(mail.url)).pathname).toBe(`/dashboard/cases/${caseId}`);
  }

  // The link opens the case page: the reason and the evidence field; the student sends a file and an answer.
  await student.page.goto(`/dashboard/cases/${caseId}`);
  await expect(visible(student.page.getByTestId('party-case-status'))).toHaveAttribute('data-status', 'needs_info');
  await expect(visible(student.page.getByTestId('party-case-messages'))).toContainText(reason);
  await chooseFiles(student.page, [{ name: 'demo-training-card.pdf', mimeType: 'application/pdf', buffer: fictionalPdf(20_000) }]);
  await visible(student.page.getByTestId('case-reply-form')).getByLabel('Your answer').fill('Fictional: my training card is attached.');
  await visible(student.page.getByRole('button', { name: /^Send/ })).click();
  await student.page.waitForURL(/[?&]replied=1/);
  await expect(visible(student.page.getByTestId('party-case-files'))).toContainText('demo-training-card.pdf');
  // The other party reads the reason, never the student's answer or file.
  await teacher.page.goto(`/dashboard/cases/${caseId}`);
  await expect(visible(teacher.page.getByTestId('party-case-messages'))).toContainText(reason);
  await expect(visible(teacher.page.getByTestId('party-case-messages'))).not.toContainText('training card');
  expect(await teacher.page.content()).not.toContain('demo-training-card.pdf');
  await Promise.all([teacher.context.close(), student.context.close(), moderator.context.close(), anonymous.context.close()]);
});

test('@M10b "Report profile" opens a review case and the same user cannot report the same profile twice', async ({ browser, request }) => {
  const target = await member(browser, 'Reported');
  const reporter = await member(browser, 'Reporter');
  const { page } = reporter;

  await page.goto(`/people/${target.slug}`);
  await visible(page.getByTestId('report-profile')).click();
  await page.waitForURL(new RegExp(`/people/${target.slug}/report`));
  const form = visible(page.getByTestId('report-form'));
  await form.getByLabel(/^Reason/).selectOption({ label: 'Spam or advertising' });
  await form.getByLabel(/^Details/).fill('Fictional: the profile advertises a demo product.');
  await visible(page.getByRole('button', { name: 'Send the report' })).click();
  await page.waitForURL(/\/report\?sent=1/);
  await expect(visible(page.getByTestId('report-sent'))).toBeVisible();

  const reviewCase = await caseAbout('profile_report', 'person_id', target.personId);
  expect(reviewCase.status).toBe('open');
  const reports = await getDb().execute<{ reason: string; case_id: string }>(sql`
    SELECT reason, review_case_id::text AS case_id FROM content_report WHERE reporter_user_id = ${reporter.userId}::uuid AND subject_id = ${target.personId}::uuid`);
  expect(reports.rows).toEqual([{ reason: 'spam', case_id: reviewCase.id }]);
  expect(await auditCount('report.create', target.personId)).toBe(1);

  // The same user cannot report it again: the page says so, and the API refuses.
  await page.goto(`/people/${target.slug}/report`);
  await expect(visible(page.getByTestId('report-already'))).toBeVisible();
  await expect(page.getByTestId('report-form')).toHaveCount(0);
  const again = await apiPost(page, '/reports/create', { personId: target.personId, reason: 'misleading', idempotencyKey: randomUUID() });
  expect(again.status()).toBe(409);
  const count = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM content_report WHERE reporter_user_id = ${reporter.userId}::uuid AND subject_id = ${target.personId}::uuid`);
  expect(count.rows[0]!.n).toBe(1);

  // No automatic hiding: the profile is still public; the case waits in the moderators' queue.
  expect((await request.get(`${BASE_URL}/api/v1/people/${target.slug}`)).status()).toBe(200);
  const moderator = await signedIn(browser, 'moderator');
  await moderator.page.goto(`/admin/review/${reviewCase.id}`);
  await expect(visible(moderator.page.getByTestId('case-status'))).toHaveAttribute('data-status', 'open');
  await expect(visible(moderator.page.getByRole('heading', { level: 1 }))).toHaveText('Profile report');
  await Promise.all([target.context.close(), reporter.context.close(), moderator.context.close()]);
});
