/**
 * Milestone M25: governance (docs/adr/0028-governance.md; specification §15, §16.1). A new
 * Professional Sifu names their verified student on Premium Student as digital successor; the
 * student accepts. Nothing moves until, after more than 180 days without activity on the owner's
 * account, the successor asks with evidence and an administrator approves: the school listing
 * passes to the successor, the owner's record and its life status stay as they were. A new account
 * reports a lineage error with evidence; a moderator does not uphold it (nothing changes); the
 * reporter appeals once, and another member of staff than the moderator decides the appeal. A new
 * account proposes a correction of a shared archival record; an archivist approves it and the change
 * is in the record's history. axe runs on every new state in both themes.
 *
 * It adds review cases and changes a school's listing account, so it runs in the `exclusive`
 * project (e2e/projects.ts, PUBLIC_WRITE_SPECS). Every account is a new `demo-e2e-…@example.test`
 * account with a fictional `Demo …` name, and the archival record is a new `demo-e2e-` record (D20).
 */

import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { uuidv7 } from '../src/server/db/ids';
import { closeHelpers, giveOwnAddress, loadTestEnv, userIdOf } from './helpers/auth';
import { fictionalPdf, letters } from './helpers/evidence';
import { apiPost, freshAccount } from './helpers/plans';
import { createSchool, freshContext, grantProSifu, signedIn, visible } from './helpers/schools';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

async function axeBothThemes(page: Page, label: string) {
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `${label} (${theme})`);
  }
}

/** Chooses one fictional PDF in the evidence field of the page and waits for its upload. */
async function chooseFile(page: Page) {
  const uploader = visible(page.getByTestId('evidence-uploader')).first();
  await uploader.getByTestId('evidence-input').setInputFiles([{ name: 'demo-evidence.pdf', mimeType: 'application/pdf', buffer: fictionalPdf(12_000) }]);
  const items = uploader.getByTestId('evidence-item');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
}

async function personOf(userId: string): Promise<{ id: string; slug: string; lifeStatus: string }> {
  const rows = await getDb().execute<{ id: string; slug: string; life_status: string }>(sql`
    SELECT id::text AS id, slug, life_status FROM person WHERE claimed_by_user_id = ${userId}::uuid AND deleted_at IS NULL`);
  expect(rows.rows).toHaveLength(1);
  return { id: rows.rows[0]!.id, slug: rows.rows[0]!.slug, lifeStatus: rows.rows[0]!.life_status };
}

/** A seeded staff member (`demo-<role>@example.test`) takes a case and decides it through the API. */
async function decide(staff: Page, role: 'admin' | 'moderator' | 'archivist', caseId: string, decision: 'verify' | 'reject', reason: string) {
  const assigneeId = await userIdOf(`demo-${role}@example.test`);
  const assigned = await apiPost(staff, '/review/assign', { caseId, assigneeId, idempotencyKey: randomUUID() });
  expect(assigned.status(), await assigned.text()).toBe(200);
  return apiPost(staff, '/review/decide', { caseId, decision, reason, idempotencyKey: randomUUID() });
}

test('@M25 a successor is named, accepts, and takes over the administration only after inactivity, evidence and an administrator', async ({ page, browser }) => {
  const ownerName = `Demo Owner ${letters()}`;
  const heirName = `Demo Successor ${letters()}`;
  const owner = await freshAccount(page, { name: ownerName, sifu: true });
  const heir = await freshContext(browser);
  const admin = await signedIn(browser, 'admin');
  try {
    const heirAccount = await freshAccount(heir.page, { name: heirName });
    await grantProSifu(admin.page, owner.email);
    const premium = await apiPost(admin.page, '/admin/grants/create', { email: heirAccount.email, planCode: 'premium_student', source: 'test_grant', reason: 'Demo M25 successor test' });
    expect(premium.status(), await premium.text()).toBe(200);
    const ownerPerson = await personOf(owner.userId);
    const heirPerson = await personOf(heirAccount.userId);
    const lineage = await getDb().execute<{ id: string }>(sql`SELECT id FROM lineage WHERE slug LIKE 'demo-%' ORDER BY slug LIMIT 1`);
    await getDb().execute(sql`INSERT INTO teaching_relationship (id, teacher_person_id, student_person_id, lineage_id, status, visibility)
      VALUES (${uuidv7()}, ${ownerPerson.id}::uuid, ${heirPerson.id}::uuid, ${lineage.rows[0]!.id}::uuid, 'verified', 'involved_only')`);
    const school = await createSchool(page);

    // The owner nominates.
    await page.goto('/dashboard/succession');
    const form = visible(page.getByTestId('nominate-form'));
    await form.getByLabel('Successor').selectOption({ label: heirName });
    await form.getByRole('button', { name: 'Nominate' }).click();
    await page.waitForURL(/[?&]nominated=1/);
    await expect(visible(page.getByTestId('succession-nominated'))).toBeVisible();
    await expect(visible(page.getByTestId('succession-nomination-status'))).toContainText('Waiting for an answer');
    await axeBothThemes(page, '/dashboard/succession (nominated)');

    // The nominee accepts; with the owner active, only a reported death could be the basis.
    await heir.page.goto('/dashboard/succession');
    const row = visible(heir.page.getByTestId('succession-received-row'));
    await row.getByRole('button', { name: /^Accept/ }).click();
    await heir.page.waitForURL(/[?&]answered=accepted/);
    await expect(visible(heir.page.getByTestId('succession-received-row'))).toHaveAttribute('data-status', 'accepted');
    await visible(heir.page.getByText('Ask to take over the administration')).click();
    const basis = visible(heir.page.getByTestId('succession-request-form')).getByLabel('The request rests on');
    await expect(basis.locator('option[value="inactivity"]')).toHaveCount(0);
    await axeBothThemes(heir.page, '/dashboard/succession (accepted)');

    // More than 180 days without activity on the owner's account (the owner stays away from now on).
    await getDb().execute(sql`UPDATE auth_user SET last_active_at = now() - interval '200 days', created_at = now() - interval '230 days' WHERE id = ${owner.userId}::uuid`);
    await getDb().execute(sql`UPDATE auth_session SET updated_at = now() - interval '200 days', created_at = now() - interval '200 days' WHERE user_id = ${owner.userId}::uuid`);
    await heir.page.goto('/dashboard/succession');
    await visible(heir.page.getByText('Ask to take over the administration')).click();
    const request = visible(heir.page.getByTestId('succession-request-form'));
    // Without evidence, the request is refused.
    await request.getByLabel('The request rests on').selectOption('inactivity');
    await request.getByLabel('What happened').fill('A fictional request of the tests: the owner has not signed in for months.');
    await request.getByRole('button', { name: 'Send the request' }).click();
    await expect(visible(heir.page.locator('[id$="-summary"]'))).toContainText('Evidence');
    await chooseFile(heir.page);
    await visible(heir.page.getByTestId('succession-request-form')).getByRole('button', { name: 'Send the request' }).click();
    await heir.page.waitForURL(/[?&]requested=/);
    await expect(visible(heir.page.getByTestId('succession-requested'))).toBeVisible();
    const caseId = new URL(heir.page.url()).searchParams.get('requested')!;
    // Nothing moved yet.
    const before = await getDb().execute<{ by: string }>(sql`SELECT created_by_user_id::text AS by FROM school WHERE id = ${school.id}::uuid`);
    expect(before.rows[0]!.by).toBe(owner.userId);

    // An administrator approves it, with a reason.
    const approved = await decide(admin.page, 'admin', caseId, 'verify', 'The fictional evidence and the inactivity were checked.');
    expect(approved.status(), await approved.text()).toBe(200);
    const after = await getDb().execute<{ by: string }>(sql`SELECT created_by_user_id::text AS by FROM school WHERE id = ${school.id}::uuid`);
    expect(after.rows[0]!.by).toBe(heirAccount.userId);
    // Inactivity never marks anyone deceased: the owner's record is as it was.
    expect((await personOf(owner.userId)).lifeStatus).toBe(ownerPerson.lifeStatus);

    await heir.page.goto(`/dashboard/cases/${caseId}`);
    await expect(visible(heir.page.getByTestId('party-case-decision'))).toContainText('the administration of the schools and organizations moved to you');
    await axeBothThemes(heir.page, '/dashboard/cases/[id] (succession approved)');
  } finally {
    await heir.context.close();
    await admin.context.close();
  }
});

test('@M25 a lineage report that is not upheld changes nothing; its one appeal is decided by someone else', async ({ page, browser }) => {
  const reporter = await freshAccount(page, { name: `Demo Reporter ${letters()}` });
  const moderator = await signedIn(browser, 'moderator');
  const admin = await signedIn(browser, 'admin');
  try {
    const slug = 'demo-a-007';
    const statusOf = async () =>
      (
        await getDb().execute<{ status: string }>(sql`
          SELECT r.status FROM teaching_relationship r JOIN person p ON p.id IN (r.teacher_person_id, r.student_person_id) WHERE p.slug = ${slug} AND r.visibility = 'public' ORDER BY r.id`)
      ).rows.map((r) => r.status);
    const before = await statusOf();
    await page.goto(`/people/${slug}/dispute`);
    const form = visible(page.getByTestId('dispute-form'));
    await form.getByLabel('What is wrong').selectOption('wrong_dates');
    await form.getByLabel('Details').fill('A fictional report of the tests: the dates do not match the demo register.');
    await chooseFile(page);
    await visible(page.getByTestId('dispute-form')).getByRole('button', { name: 'Send the report' }).click();
    await page.waitForURL(/[?&]sent=1/);
    await expect(visible(page.getByTestId('dispute-sent'))).toBeVisible();
    await expect(visible(page.getByTestId('dispute-relationships'))).toContainText('You reported this');
    expect(await statusOf()).toEqual(before);
    const cases = await getDb().execute<{ id: string }>(sql`
      SELECT c.id::text AS id FROM review_case c JOIN lineage_report r ON r.review_case_id = c.id WHERE c.opened_by_user_id = (SELECT id FROM auth_user WHERE email = ${reporter.email})`);
    expect(cases.rows).toHaveLength(1);
    const caseId = cases.rows[0]!.id;

    // The moderator does not uphold it: nothing changes.
    const refused = await decide(moderator.page, 'moderator', caseId, 'reject', 'The fictional evidence does not show it.');
    expect(refused.status(), await refused.text()).toBe(200);
    expect(await statusOf()).toEqual(before);

    // The reporter reads the decision and appeals it once.
    await page.goto(`/dashboard/cases/${caseId}`);
    await expect(visible(page.getByTestId('party-case-decision'))).toContainText('Not upheld');
    const appeal = visible(page.getByTestId('case-appeal-form'));
    await appeal.getByRole('button', { name: 'Send the appeal' }).click();
    await expect(visible(page.getByText('Write why the decision should be looked at again.')).first()).toBeVisible();
    await axeBothThemes(page, '/dashboard/cases/[id] (appeal refused)');
    await visible(page.getByTestId('case-appeal-form')).getByLabel('Why the decision should be looked at again').fill('A fictional appeal: the demo register was misread.');
    await visible(page.getByTestId('case-appeal-form')).getByRole('button', { name: 'Send the appeal' }).click();
    await page.waitForURL(/[?&]appealed=1/);
    await expect(visible(page.getByTestId('appeal-status'))).toContainText('Waiting for a decision');
    await expect(page.getByTestId('case-appeal-form')).toHaveCount(0);
    await axeBothThemes(page, '/dashboard/cases/[id] (appealed)');
    const appealCase = (await getDb().execute<{ id: string }>(sql`SELECT review_case_id::text AS id FROM decision_appeal WHERE appealed_case_id = ${caseId}::uuid`)).rows[0]!.id;

    // The moderator who decided cannot decide the appeal; an administrator does.
    const own = await decide(moderator.page, 'moderator', appealCase, 'verify', 'A fictional reason.');
    expect(own.status()).toBe(403);
    const decided = await decide(admin.page, 'admin', appealCase, 'reject', 'Looked at again: the fictional decision stands.');
    expect(decided.status(), await decided.text()).toBe(200);
    await page.goto(`/dashboard/cases/${caseId}`);
    await expect(visible(page.getByTestId('appeal-status'))).toContainText('Not upheld');
    expect(await statusOf()).toEqual(before);
  } finally {
    await moderator.context.close();
    await admin.context.close();
  }
});

test('@M25 a correction of a shared archival record is proposed, approved by an archivist and kept in its history', async ({ page, browser }) => {
  const id = uuidv7();
  const slug = `demo-e2e-record-${letters(8)}`;
  await getDb().execute(sql`INSERT INTO person (id, slug, kind, stewardship, visibility, life_status) VALUES (${id}::uuid, ${slug}, 'historical', 'unclaimed', 'public', 'deceased')`);
  await getDb().execute(sql`INSERT INTO person_name (person_id, value, script, lang, is_primary) VALUES (${id}::uuid, 'Demo Archival Teacher', 'Latn', 'en', true)`);
  await freshAccount(page, { name: `Demo Proposer ${letters()}` });
  const archivist = await signedIn(browser, 'archivist');
  try {
    await page.goto(`/people/${slug}/record`);
    await expect(visible(page.getByTestId('record-history-empty'))).toBeVisible();
    const form = visible(page.getByTestId('propose-form'));
    await form.getByLabel('Biography (English)').fill('A fictional biography of a demo record.');
    await form.getByLabel('Reason').fill('A fictional source: the demo register of the tests.');
    await form.getByRole('button', { name: 'Send the proposal' }).click();
    await page.waitForURL(/[?&]sent=1/);
    await expect(visible(page.getByTestId('record-sent'))).toBeVisible();
    await expect(visible(page.getByTestId('record-pending'))).toBeVisible();
    await axeBothThemes(page, '/people/[slug]/record (pending)');
    // Nothing changed yet.
    const bio = async () => (await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM person_bio WHERE person_id = ${id}::uuid`)).rows[0]!.n;
    expect(await bio()).toBe(0);
    const caseId = (await getDb().execute<{ id: string }>(sql`SELECT review_case_id::text AS id FROM record_proposal WHERE person_id = ${id}::uuid`)).rows[0]!.id;

    const approved = await decide(archivist.page, 'archivist', caseId, 'verify', 'The fictional source was checked.');
    expect(approved.status(), await approved.text()).toBe(200);
    expect(await bio()).toBe(1);
    await page.goto(`/people/${slug}/record`);
    const history = visible(page.getByTestId('record-history'));
    await expect(history).toContainText('Approved proposal');
    await expect(history).toContainText('Biography');
    await axeBothThemes(page, '/people/[slug]/record (history)');
  } finally {
    await archivist.context.close();
  }
});
