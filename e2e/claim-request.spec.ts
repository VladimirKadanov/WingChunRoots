/**
 * "Is this you? Ask to claim this profile" (ADR 0040): a public, unclaimed record of a living
 * person offers the claim under its header; the claim page sends a visitor to sign in and back
 * (no profile set-up on the way), explains the review, and its form opens the same person_claim
 * case an invitation's claim opens, without a relationship. The database is read to check what the
 * pages cannot show. Every test makes its own records (`demo-claimable-…`, fictional `Demo …`
 * names, D20) and accounts (`demo-e2e-…@example.test`).
 *
 * The tests add public records and an approved claim makes one of them an account's own, which
 * changes the public lists and counts other specs and the visual regression compare, so the spec
 * runs in the `exclusive` project (e2e/projects.ts, PUBLIC_WRITE_SPECS).
 */

import { randomUUID } from 'node:crypto';

import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { uuidv7 } from '../src/server/db/ids';
import { writePersonKeys } from '../src/server/search/store';
import { BASE_URL, closeHelpers, createConfirmedAccount, emailLinkFromOutbox, giveOwnAddress, loadTestEnv, NEW_ACCOUNT_PASSWORD, signInAs, uniqueEmail, userIdOf } from './helpers/auth';
import { letters } from './helpers/evidence';
import { apiPost } from './helpers/plans';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  // Rate limits are per client address: each test is its own client.
  await giveOwnAddress(context);
});

/** A visible element (Next.js keeps earlier routes in the document, hidden). */
const visible = (locator: Locator) => locator.filter({ visible: true });

const capital = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/** A new browser context with its own client address. */
async function newClient(browser: Browser, options: { javaScriptEnabled?: boolean } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL, ...options });
  await giveOwnAddress(context);
  return { context, page: await context.newPage() };
}

type RecordOptions = { kind?: 'living' | 'historical'; lifeStatus?: 'living' | 'deceased'; stewardship?: 'unclaimed' | 'platform' };

/** A public record nobody has claimed, of a living person unless said otherwise (as the demo records are). */
async function claimableRecord(opts: RecordOptions = {}): Promise<{ id: string; slug: string; name: string }> {
  const id = uuidv7();
  const tag = letters();
  const slug = `demo-claimable-${tag}`;
  const name = `Demo Claimable ${capital(tag)}`;
  await getDb().execute(sql`
    INSERT INTO person (id, slug, kind, life_status, stewardship, visibility)
    VALUES (${id}::uuid, ${slug}, ${opts.kind ?? 'living'}, ${opts.lifeStatus ?? 'living'}, ${opts.stewardship ?? 'unclaimed'}, 'public')`);
  await getDb().execute(sql`
    INSERT INTO person_name (person_id, value, script, lang, is_primary) VALUES (${id}::uuid, ${name}, 'Latn', 'en', true)`);
  // Searchable, as a saved record is (ADR 0056: the request form and onboarding find it).
  await writePersonKeys(getDb(), id);
  return { id, slug, name };
}

async function claimRows(userId: string) {
  const rows = await getDb().execute<{ status: string; case_id: string; person_id: string; kind: string; relationship_id: string | null }>(sql`
    SELECT c.status, c.review_case_id::text AS case_id, c.person_id::text AS person_id, r.kind, r.relationship_id::text AS relationship_id
      FROM person_claim c JOIN review_case r ON r.id = c.review_case_id
     WHERE c.user_id = ${userId}::uuid ORDER BY c.created_at`);
  return rows.rows;
}

const NOTE = 'Fictional: I teach the Tuesday class at the Demo Hall; its owner can confirm it.';

test('@claim a visitor asks to claim an unclaimed profile: sign-in and back, the explanation, the claim, the case page; approved, the profile is theirs', async ({ browser }) => {
  test.setTimeout(120_000);
  const target = await claimableRecord();
  const { context, page } = await newClient(browser);

  // The profile offers the claim, and says in plain words who keeps it.
  await page.goto(`/people/${target.slug}`);
  await expect(page.getByText('Person on the record')).toHaveCount(0);
  await expect(visible(page.getByTestId('keeper-hint'))).toHaveText('Kept by the archive; nobody has claimed it yet.');
  await visible(page.getByTestId('claim-profile-link')).click();

  // Signed out: sign in first, and come back to the claim (not to a profile set-up).
  const claimPath = `/people/${target.slug}/claim`;
  await page.waitForURL((u) => u.pathname === '/sign-in' && u.searchParams.get('next') === claimPath, { timeout: 15_000 });
  const account = await createConfirmedAccount(page, 'self-claim');
  await visible(page.getByLabel('E-mail address')).fill(account.email);
  await visible(page.getByLabel('Password', { exact: true })).fill(NEW_ACCOUNT_PASSWORD);
  await visible(page.getByRole('button', { name: 'Sign in' })).click();
  await page.waitForURL((u) => u.pathname === claimPath, { timeout: 15_000 });
  await expect(visible(page.getByRole('heading', { level: 1 }))).toHaveText('Ask to claim this profile');
  const explainer = visible(page.getByTestId('claim-explainer'));
  await expect(explainer).toContainText('A reviewer checks every claim');
  await expect(explainer).toContainText('evidence');
  await expect(explainer).toContainText('one open claim at a time');
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `claim page (${theme})`);
  }

  // An empty note is refused in words, on the page.
  await visible(page.getByRole('button', { name: 'Send the claim' })).click();
  await page.waitForURL((u) => u.pathname === claimPath && u.searchParams.has('outcome'));
  await expect(visible(page.getByTestId('claim-refused'))).toBeVisible();
  await expect(visible(page.getByText('Tell the reviewers who you are and how they can check it.'))).toBeVisible();

  await visible(page.getByLabel('Note for the reviewers')).fill(NOTE);
  await visible(page.getByRole('button', { name: 'Send the claim' })).click();
  await page.waitForURL(/\/dashboard\/cases\/[0-9a-f-]{36}\?claimed=1/, { timeout: 15_000 });
  await expect(visible(page.getByTestId('claim-sent'))).toBeVisible();
  const caseId = new URL(page.url()).pathname.split('/').pop()!;
  const userId = (await userIdOf(account.email))!;
  expect(await claimRows(userId)).toEqual([{ status: 'pending', case_id: caseId, person_id: target.id, kind: 'person_claim', relationship_id: null }]);
  const own = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM person WHERE claimed_by_user_id = ${userId}::uuid`);
  expect(own.rows[0]!.n, 'the account made no profile of its own').toBe(0);

  // Back on the claim page: one claim at a time, with a link to it.
  await page.goto(claimPath);
  await expect(visible(page.getByTestId('claim-waiting-here'))).toBeVisible();
  await expect(visible(page.getByTestId('claim-case-link'))).toHaveAttribute('href', `/dashboard/cases/${caseId}`);
  await expect(page.getByTestId('claim-form')).toHaveCount(0);

  // An administrator approves: the record is the account's, and stays public.
  const admin = await newClient(browser);
  await signInAs(admin.page, 'admin');
  const decided = await apiPost(admin.page, '/review/decide', { caseId, decision: 'verify', reason: null, idempotencyKey: randomUUID() });
  expect(decided.status(), await decided.text()).toBe(200);
  const after = await getDb().execute<{ claimed_by: string | null; stewardship: string; visibility: string }>(sql`
    SELECT claimed_by_user_id::text AS claimed_by, stewardship, visibility FROM person WHERE id = ${target.id}::uuid`);
  expect(after.rows[0]).toEqual({ claimed_by: userId, stewardship: 'self', visibility: 'public' });
  await page.goto(`/people/${target.slug}`);
  await expect(page.getByTestId('claim-profile-link')).toHaveCount(0);
  await Promise.all([context.close(), admin.context.close()]);
});

test('@claim refusals in plain words: an account with a profile, a claimed profile, a historical record; the form works without JavaScript', async ({ browser }) => {
  test.setTimeout(90_000);
  const target = await claimableRecord();

  // An account with its own profile: told why, no form.
  const member = await newClient(browser);
  await signInAs(member.page, 'demo-pending');
  await member.page.goto(`/people/${target.slug}/claim`);
  await expect(visible(member.page.getByTestId('claim-refusal'))).toContainText('already has its own profile');
  // ADR 0056: not a dead end: the record can be reported as a second profile of them.
  await visible(member.page.getByTestId('claim-report-duplicate')).click();
  await member.page.waitForURL((u) => u.pathname === `/people/${target.slug}/report` && u.searchParams.get('reason') === 'misleading');
  await expect(visible(member.page.getByLabel('Reason'))).toHaveValue('misleading');
  await member.page.goto(`/people/${target.slug}/claim`);
  await expect(member.page.getByTestId('claim-form')).toHaveCount(0);
  // A claimed profile offers no claim, and its claim page says why.
  await member.page.goto('/people/demo-two-lineages');
  await expect(visible(member.page.getByRole('heading', { level: 1 }))).toBeVisible();
  await expect(member.page.getByTestId('claim-profile-link')).toHaveCount(0);
  await member.page.goto('/people/demo-two-lineages/claim');
  await expect(visible(member.page.getByTestId('claim-not-claimable'))).toContainText('already belongs to an account');
  // A historical record is corrected, never claimed.
  const historical = await claimableRecord({ kind: 'historical', lifeStatus: 'deceased', stewardship: 'platform' });
  await member.page.goto(`/people/${historical.slug}`);
  await expect(member.page.getByTestId('claim-profile-link')).toHaveCount(0);
  await member.page.goto(`/people/${historical.slug}/claim`);
  await expect(visible(member.page.getByTestId('claim-not-claimable'))).toContainText('historical teacher or of someone who has died');
  // The API answers the same.
  const refused = await apiPost(member.page, '/claims/request', { personId: target.id, note: NOTE, idempotencyKey: randomUUID() });
  expect(refused.status()).toBe(409);

  // Without JavaScript the form posts itself and the action answers with a redirect.
  const noScript = await newClient(browser, { javaScriptEnabled: false });
  const account = await signInAs(noScript.page, 'new');
  await noScript.page.goto(`/people/${target.slug}/claim`);
  await visible(noScript.page.getByLabel('Note for the reviewers')).fill(NOTE);
  await visible(noScript.page.getByRole('button', { name: 'Send the claim' })).click();
  await noScript.page.waitForURL(/\/dashboard\/cases\/[0-9a-f-]{36}\?claimed=1/, { timeout: 15_000 });
  const userId = (await userIdOf(account.email))!;
  expect((await claimRows(userId)).map((r) => [r.status, r.person_id, r.relationship_id])).toEqual([['pending', target.id, null]]);
  await Promise.all([member.context.close(), noScript.context.close()]);
});

test('@claim "Create an account" on the way to a claim keeps it through sign-up and the e-mail confirmation: no profile is set up on the way (ADR 0056)', async ({ browser }) => {
  test.setTimeout(120_000);
  const target = await claimableRecord();
  const { context, page } = await newClient(browser);
  const claimPath = `/people/${target.slug}/claim`;
  await page.goto(claimPath);
  await page.waitForURL((u) => u.pathname === '/sign-in' && u.searchParams.get('next') === claimPath, { timeout: 15_000 });
  await visible(page.getByRole('link', { name: 'Create an account' })).click();
  await page.waitForURL((u) => u.pathname === '/sign-up' && u.searchParams.get('next') === claimPath, { timeout: 15_000 });
  // The page says what comes after: the claim, not a new profile.
  await expect(visible(page.getByText('Then your claim'))).toBeVisible();
  const email = uniqueEmail('claim-sign-up');
  await visible(page.getByLabel('E-mail address')).fill(email);
  await visible(page.getByLabel('Password', { exact: true })).fill(NEW_ACCOUNT_PASSWORD);
  for (const label of ['I am 18 or older.', 'I accept the terms of use.', /I will record only what I believe to be true/, /I have read the privacy notice\./]) {
    await visible(page.getByLabel(label)).check();
  }
  await visible(page.getByRole('button', { name: 'Create account' })).click();
  await expect(visible(page.getByRole('heading', { level: 1, name: 'Check your inbox' }))).toBeVisible();

  // The confirmation link carries the claim page; it signs in the browser that signed up and goes
  // back to it (ADR 0069).
  const link = new URL(await emailLinkFromOutbox('verify-email', email));
  expect(link.searchParams.get('next')).toBe(claimPath);
  await page.goto(`${link.pathname}${link.search}`);
  await visible(page.getByRole('button', { name: 'Confirm my address' })).click();
  await page.waitForURL((u) => u.pathname === claimPath, { timeout: 15_000 });
  await expect(visible(page.getByTestId('claim-explainer'))).toBeVisible();
  const userId = (await userIdOf(email))!;
  const own = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM person WHERE claimed_by_user_id = ${userId}::uuid`);
  expect(own.rows[0]!.n, 'the account made no profile of its own').toBe(0);
  await context.close();
});

test('@claim onboarding finds a profile nobody has claimed and leads to its claim, without JavaScript too (ADR 0056)', async ({ browser }) => {
  test.setTimeout(90_000);
  const target = await claimableRecord();
  for (const javaScriptEnabled of [true, false]) {
    const { context, page } = await newClient(browser, { javaScriptEnabled });
    await signInAs(page, 'new');
    await page.goto('/onboarding');
    const box = visible(page.getByTestId('onboarding-find-yourself'));
    await box.getByText('Is there a profile of you already?').click();
    await box.getByLabel('Your name').fill(target.name);
    await box.getByRole('button', { name: 'Look for my profile' }).click();
    await page.waitForURL((u) => u.pathname === '/onboarding' && u.searchParams.get('find') === target.name);
    const found = visible(page.getByRole('list', { name: 'Profiles nobody has claimed yet' })).getByRole('listitem').filter({ hasText: target.name });
    await expect(found).toHaveCount(1);
    await found.getByRole('link', { name: 'This is me: ask to claim it' }).click();
    await page.waitForURL((u) => u.pathname === `/people/${target.slug}/claim`);
    await expect(visible(page.getByTestId('claim-explainer'))).toBeVisible();
    // A name nobody waits under says so, and the set-up form stays below.
    await page.goto(`/onboarding?find=${encodeURIComponent('Demo Nobody Zzqx')}`);
    await expect(visible(page.getByTestId('onboarding-find-yourself')).getByRole('status')).toContainText('No profile waiting to be claimed');
    await context.close();
  }
});

test('@claim a student names a teacher who is not on WingChunRoots yet: the form says so and sends the request with an invitation to that record (ADR 0056)', async ({ browser }) => {
  test.setTimeout(120_000);
  const target = await claimableRecord();
  const { context, page } = await newClient(browser);
  const account = await signInAs(page, 'new');
  const onboard = await apiPost(page, '/account/onboard', { primaryName: `Demo Student ${capital(letters())}`, showPublicly: false });
  expect(onboard.status(), await onboard.text()).toBe(200);

  await page.goto('/dashboard/teachers/new');
  const input = page.getByRole('combobox', { name: 'Choose your teacher' });
  await expect(async () => {
    await visible(page.getByRole('button', { name: 'Find your teacher' })).click();
    await expect(input).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/rpc/search/query');
  await input.fill(target.name);
  expect((await answered).status()).toBe(200);
  const option = page.getByTestId('search-palette').getByRole('option').filter({ hasText: target.name });
  await expect(option.getByTestId('search-person-not-joined')).toHaveText('Not on WingChunRoots yet');
  await option.click();
  await expect(input).toBeHidden();

  const panel = visible(page.getByTestId('teacher-not-joined'));
  await expect(panel).toContainText(`${target.name} is not on WingChunRoots yet`);
  const teacherEmail = uniqueEmail('not-joined-teacher');
  await panel.getByLabel(/Teacher’s e-mail address/).fill(teacherEmail);
  await visible(page.getByLabel(/^Lineage of this training/)).selectOption({ label: 'Demo Lineage A' });
  await visible(page.getByLabel('Started (year)')).fill('2018');
  await visible(page.getByLabel('I still train with this teacher')).check();
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `request form, teacher not on WingChunRoots yet (${theme})`);
  }
  await visible(page.getByRole('button', { name: 'Send the request and invite' })).click();
  await page.waitForURL((u) => u.pathname === '/dashboard/teachers' && u.searchParams.has('invited'), { timeout: 15_000 });
  await expect(visible(page.getByTestId('teacher-invited'))).toContainText('The invitation was sent');

  // The request waits on the record that was found: no second record of the teacher.
  const userId = (await userIdOf(account.email))!;
  const rows = await getDb().execute<{ teacher: string; status: string }>(sql`
    SELECT r.teacher_person_id::text AS teacher, r.status FROM teaching_relationship r
      JOIN person s ON s.id = r.student_person_id WHERE s.claimed_by_user_id = ${userId}::uuid`);
  expect(rows.rows).toEqual([{ teacher: target.id, status: 'awaiting_claim' }]);
  const invitation = new URL(await emailLinkFromOutbox('invitation', teacherEmail));
  expect(invitation.pathname).toMatch(/^\/invite\//);
  await context.close();
});
