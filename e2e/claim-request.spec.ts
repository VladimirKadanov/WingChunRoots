/**
 * "Is this you? Ask to claim this profile" (ADR 0037): a public, unclaimed record of a living
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
import { BASE_URL, closeHelpers, createConfirmedAccount, giveOwnAddress, loadTestEnv, NEW_ACCOUNT_PASSWORD, signInAs, userIdOf } from './helpers/auth';
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
