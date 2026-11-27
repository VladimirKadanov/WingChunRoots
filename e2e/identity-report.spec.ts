/**
 * "This account is pretending to be me" (ADR 0089): a member without a profile reports a public
 * profile that another account runs. Nothing changes for the profile until a moderator's check; the
 * hold then shows "Identity under review" on the public page and tells the account that holds it.
 * The reporter asks the profile's verified teacher to vouch, the teacher answers on their own page,
 * and an administrator, who reads the proof on the case card, upholds the report: the profile moves
 * to the reporter and the other account is suspended (the box ticked in advance). The database is
 * read to check what the pages cannot show. Every test makes its own records (`demo-identity-…`,
 * fictional `Demo …` names, D20) and accounts (`demo-e2e-…@example.test`).
 *
 * The test adds public records and moves one to another account, which changes the public lists
 * other specs and the visual regression compare, so the spec runs in the `exclusive` project
 * (e2e/projects.ts, PUBLIC_WRITE_SPECS).
 */

import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { uuidv7 } from '../src/server/db/ids';
import { BASE_URL, closeHelpers, createConfirmedAccount, giveOwnAddress, loadTestEnv, signInAs, signInWithPassword, userIdOf } from './helpers/auth';
import { letters } from './helpers/evidence';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

/** A visible element (Next.js keeps earlier routes in the document, hidden). */
const visible = (locator: Locator) => locator.filter({ visible: true });

const capital = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

async function newClient(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(context);
  return { context, page: await context.newPage() };
}

/** A new confirmed account, signed in on its own client; with `profile`, a public profile of its own. */
async function member(browser: Browser, label: string, profile: boolean) {
  const client = await newClient(browser);
  const account = await createConfirmedAccount(client.page, label);
  const userId = (await userIdOf(account.email))!;
  let personId: string | null = null;
  let slug: string | null = null;
  let name: string | null = null;
  if (profile) {
    personId = uuidv7();
    const tag = letters();
    slug = `demo-identity-${tag}`;
    name = `Demo Identity ${capital(tag)}`;
    await getDb().execute(sql`
      INSERT INTO person (id, slug, kind, life_status, stewardship, visibility, claimed_by_user_id)
      VALUES (${personId}::uuid, ${slug}, 'living', 'living', 'self', 'public', ${userId}::uuid)`);
    await getDb().execute(sql`INSERT INTO person_name (person_id, value, script, lang, is_primary) VALUES (${personId}::uuid, ${name}, 'Latn', 'en', true)`);
  }
  await signInWithPassword(client.page, account.email, account.password);
  return { ...client, email: account.email, userId, personId, slug, name };
}

test('@identity a member reports a profile pretending to be them: the moderator holds it, a teacher vouches, an administrator moves it to them', async ({ browser }) => {
  test.setTimeout(180_000);
  const impostor = await member(browser, 'id-impostor', true);
  const teacher = await member(browser, 'id-teacher', true);
  const reporter = await member(browser, 'id-reporter', false);
  // The teacher's account is old enough to vouch (decision 6), and verified as the profile's teacher.
  await getDb().execute(sql`UPDATE auth_user SET created_at = now() - interval '400 days' WHERE id = ${teacher.userId}::uuid`);
  const lineage = await getDb().execute<{ id: string }>(sql`SELECT id::text FROM lineage ORDER BY created_at LIMIT 1`);
  await getDb().execute(sql`
    INSERT INTO teaching_relationship (teacher_person_id, student_person_id, lineage_id, status, visibility)
    VALUES (${teacher.personId}::uuid, ${impostor.personId}::uuid, ${lineage.rows[0]!.id}::uuid, 'verified', 'public')`);

  // The profile offers the report; the page explains that nothing changes before a check.
  const page = reporter.page;
  await page.goto(`/people/${impostor.slug}`);
  await visible(page.getByTestId('report-identity')).click();
  const reportPath = `/people/${impostor.slug}/identity`;
  await page.waitForURL((u) => u.pathname === reportPath, { timeout: 15_000 });
  await expect(visible(page.getByRole('heading', { level: 1 }))).toHaveText('This account is pretending to be me');
  const explainer = visible(page.getByTestId('identity-explainer'));
  await expect(explainer).toHaveAttribute('data-type', 'impostor');
  await expect(explainer).toContainText('Nothing changes for the profile until a moderator has checked your report');
  await expect(explainer).toContainText('We never ask for identity documents');
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `identity report page (${theme})`);
  }

  // A route is required; then the report opens a case and the reporter lands on it.
  await visible(page.getByLabel('Why this profile is yours')).fill('Fictional: this is my profile; the account that holds it is not mine.');
  await visible(page.getByRole('button', { name: 'Send the report' })).click();
  // A hydrated form shows the answer in place; before hydration the page comes back with ?outcome.
  await expect(visible(page.getByText('Choose how you will show that you are this person.')).first()).toBeVisible();
  await visible(page.getByTestId('identity-route-vouching')).check();
  await visible(page.getByLabel('Why this profile is yours')).fill('Fictional: this is my profile; the account that holds it is not mine.');
  await visible(page.getByRole('button', { name: 'Send the report' })).click();
  await page.waitForURL(/\/dashboard\/cases\/[0-9a-f-]{36}\?sent=1/, { timeout: 15_000 });
  const caseId = new URL(page.url()).pathname.split('/').pop()!;
  await expect(visible(page.getByTestId('identity-proof'))).toHaveAttribute('data-status', 'open');

  // Nothing yet for the profile or its account.
  await impostor.page.goto(`/people/${impostor.slug}`);
  await expect(impostor.page.getByTestId('identity-hold-fact')).toHaveCount(0);
  const unseen = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM notification WHERE user_id = ${impostor.userId}::uuid AND template = 'identity.notice'`);
  expect(unseen.rows[0]!.n).toBe(0);

  // A moderator checks it and holds the profile.
  const moderator = await newClient(browser);
  await signInAs(moderator.page, 'moderator');
  await moderator.page.goto(`/admin/review/${caseId}`);
  await expect(visible(moderator.page.getByTestId('case-identity'))).toHaveAttribute('data-status', 'open');
  await visible(moderator.page.getByTestId('triage-hold')).locator('summary').click();
  await visible(moderator.page.getByTestId('triage-hold')).getByRole('button', { name: 'Hold the profile' }).click();
  await expect(visible(moderator.page.getByTestId('case-outcome'))).toContainText('The profile is held');
  await expect(visible(moderator.page.getByTestId('case-identity'))).toHaveAttribute('data-status', 'held');

  // The public page says so, and the account that holds the profile is told (never who reported).
  await impostor.page.goto(`/people/${impostor.slug}`);
  await expect(visible(impostor.page.getByTestId('identity-hold-fact'))).toBeVisible();
  const told = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM notification WHERE user_id = ${impostor.userId}::uuid AND template = 'identity.notice'`);
  expect(told.rows[0]!.n).toBeGreaterThan(0);

  // The reporter asks the profile's teacher to vouch.
  await page.goto(`/dashboard/cases/${caseId}`);
  await visible(page.getByText('Ask someone to vouch for you')).click();
  const vouchForm = visible(page.getByTestId('identity-vouch-form'));
  await vouchForm.getByLabel('Their profile address').fill(`/people/${teacher.slug}`);
  await vouchForm.getByLabel('My verified teacher, or a verified instructor').check();
  await vouchForm.getByLabel('Your message to them').fill('Fictional: you taught me at the Demo Hall.');
  await vouchForm.getByRole('button', { name: 'Ask them to vouch' }).click();
  await expect(visible(page.getByTestId('identity-vouches'))).toContainText(teacher.name!);
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `identity case page (${theme})`);
  }

  // The teacher answers on their own page.
  const vouch = await getDb().execute<{ id: string }>(sql`SELECT id::text FROM identity_vouch WHERE review_case_id = ${caseId}::uuid`);
  await teacher.page.goto(`/dashboard/vouches/${vouch.rows[0]!.id}`);
  await expect(visible(teacher.page.getByTestId('vouch-message'))).toHaveText('Fictional: you taught me at the Demo Hall.');
  for (const theme of THEMES) {
    await switchColorScheme(teacher.page, theme);
    await expectNoAxeViolations(teacher.page, `vouch page (${theme})`);
  }
  await visible(teacher.page.getByTestId('vouch-answer-yes')).check();
  await visible(teacher.page.getByRole('button', { name: 'Send the answer' })).click();
  await expect(visible(teacher.page.getByTestId('vouch-answered'))).toHaveAttribute('data-answer', 'yes');
  // Anyone else gets "No such question".
  await impostor.page.goto(`/dashboard/vouches/${vouch.rows[0]!.id}`);
  await expect(visible(impostor.page.getByRole('heading', { level: 1 }))).toHaveText('No such question');

  // An administrator reads the proof, takes the case and upholds the report, with the suggested suspension.
  const admin = await newClient(browser);
  await signInAs(admin.page, 'admin');
  await admin.page.goto(`/admin/review/${caseId}`);
  await expect(visible(admin.page.getByTestId('identity-side-reporter').getByTestId('identity-proof-vouching'))).toContainText(/1/);
  await visible(admin.page.getByTestId('assign-self')).getByRole('button').click();
  await admin.page.waitForURL(/[?&]done=assigned/);
  const verify = visible(admin.page.getByTestId('decide-verify'));
  await verify.locator('summary').click();
  await expect(verify.getByRole('checkbox')).toBeChecked();
  await verify.getByRole('textbox').fill('Fictional: the profile’s verified teacher confirmed who the reporter is.');
  await verify.getByRole('button').last().click();
  await admin.page.waitForURL(/[?&]done=verified/);
  await expect(visible(admin.page.getByTestId('case-outcome'))).toBeVisible();

  const after = await getDb().execute<{ claimed_by: string | null; held: string | null; banned: boolean | null; status: string }>(sql`
    SELECT p.claimed_by_user_id::text AS claimed_by, p.identity_hold_at::text AS held, u.banned, r.status
      FROM person p JOIN identity_report r ON r.subject_person_id = p.id JOIN auth_user u ON u.id = ${impostor.userId}::uuid
     WHERE p.id = ${impostor.personId}::uuid AND r.review_case_id = ${caseId}::uuid`);
  expect(after.rows[0]).toEqual({ claimed_by: reporter.userId, held: null, banned: true, status: 'upheld' });

  await Promise.all([impostor.context.close(), teacher.context.close(), reporter.context.close(), moderator.context.close(), admin.context.close()]);
});
