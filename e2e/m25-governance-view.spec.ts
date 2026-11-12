/**
 * Milestone M25: the governance pages as they are seen (docs/adr/0028-governance.md), on the desktop
 * and the phone. demo-pro-sifu-8 (Professional Sifu) sees "Digital successor" with its verified
 * student on Premium Student to nominate; demo-free-sifu-5 (Free Sifu) the plan's limit, said once.
 * "Report a lineage error" of a public profile with one public relationship, and the change history
 * of a shared archival record with "Propose a correction". The forms are sent only empty, so the
 * services refuse them and nothing is created; a statement in words, never by colour alone. axe
 * runs in both themes; on a phone every control is at least 44 px. It only reads, so it runs in the
 * ordinary projects. Fictional (D20).
 */

import { expect, test, type Locator, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { closeHelpers, giveOwnAddress, loadTestEnv, signInAs } from './helpers/auth';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

/** A public demo record kept by nobody, with one public relationship. */
const RECORD = 'demo-a-005';

/** Only what is on screen: Next.js keeps earlier routes of the tab in the page, hidden. */
const shown = (locator: Locator) => locator.filter({ visible: true });

async function axeBothThemes(page: Page, label: string) {
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `${label} (${theme})`);
  }
}

async function expectTouchTargets(page: Page, selector: string) {
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els.filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height, text: el.textContent ?? '' })),
  );
  expect(boxes.length, selector).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.h, `${selector}: ${box.text}`).toBeGreaterThanOrEqual(44);
    expect(box.w, `${selector}: ${box.text}`).toBeGreaterThanOrEqual(44);
  }
}

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(query);
  return rows.rows[0]!.n;
}

test('@M25 a Professional Sifu sees whom they can name as digital successor, and nothing moves by itself', async ({ page }, testInfo) => {
  await signInAs(page, 'demo-pro-sifu-8');
  await page.goto('/dashboard');
  await expect(shown(page.getByTestId('dashboard-succession'))).toHaveAttribute('href', '/dashboard/succession');
  await page.goto('/dashboard/succession');
  await expect(shown(page.getByRole('heading', { level: 1, name: 'Digital successor' }))).toBeVisible();
  await expect(shown(page.getByText(/Inactivity alone never marks anyone as deceased/))).toBeVisible();
  const form = shown(page.getByTestId('nominate-form'));
  const names = await getDb().execute<{ value: string }>(sql`
    SELECT n.value FROM person_name n JOIN person p ON p.id = n.person_id JOIN auth_user u ON u.id = p.claimed_by_user_id
     WHERE u.email = 'demo-premium-student@example.test' AND n.is_primary`);
  await expect(form.getByLabel('Successor').locator('option', { hasText: names.rows[0]!.value })).toHaveCount(1);
  await axeBothThemes(page, '/dashboard/succession');
  if (testInfo.project.name.startsWith('mobile')) await expectTouchTargets(page, '[data-testid="nominate-form"] button, [data-testid="nominate-form"] select');

  // Without a choice the form is refused and no nomination is made.
  const before = await count(sql`SELECT count(*)::int AS n FROM succession_nomination`);
  await form.getByRole('button', { name: 'Nominate' }).click();
  await expect(shown(page.getByText('Choose one of your verified students.')).first()).toBeVisible();
  expect(await count(sql`SELECT count(*)::int AS n FROM succession_nomination`)).toBe(before);
  await axeBothThemes(page, '/dashboard/succession (refused)');
});

test('@M25 a Free Sifu is told once what the digital successor needs', async ({ page }) => {
  await signInAs(page, 'demo-free-sifu-5');
  await page.goto('/dashboard/succession');
  const note = shown(page.getByTestId('succession-entitlement'));
  await expect(note).toContainText('Professional Sifu');
  await expect(note.getByRole('link', { name: 'See the plans' })).toHaveAttribute('href', '/plans');
  await expect(page.getByTestId('nominate-form')).toHaveCount(0);
  await axeBothThemes(page, '/dashboard/succession (limit)');
});

test('@M25 a lineage error is reported with evidence; an empty report is refused and changes nothing', async ({ page }, testInfo) => {
  await signInAs(page, 'demo-pending');
  await page.goto(`/people/${RECORD}`);
  await shown(page.getByTestId('report-lineage')).click();
  await page.waitForURL(new RegExp(`/people/${RECORD}/dispute$`));
  await expect(shown(page.getByRole('heading', { level: 1, name: 'Report a lineage error' }))).toBeVisible();
  await expect(shown(page.getByText(/Nothing changes while they look at it/))).toBeVisible();
  const list = shown(page.getByTestId('dispute-relationships'));
  await expect(list.locator('li')).toHaveCount(1);
  await axeBothThemes(page, '/people/[slug]/dispute');
  if (testInfo.project.name.startsWith('mobile')) await expectTouchTargets(page, '[data-testid="dispute-form"] button, [data-testid="dispute-form"] select');

  const before = await count(sql`SELECT count(*)::int AS n FROM lineage_report`);
  const statuses = await getDb().execute<{ status: string }>(sql`
    SELECT r.status FROM teaching_relationship r JOIN person p ON p.id IN (r.teacher_person_id, r.student_person_id) WHERE p.slug = ${RECORD} AND r.visibility = 'public'`);
  const form = shown(page.getByTestId('dispute-form'));
  await form.getByRole('button', { name: 'Send the report' }).click();
  const summary = shown(page.locator('[id$="-summary"]'));
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('What is wrong');
  expect(await count(sql`SELECT count(*)::int AS n FROM lineage_report`)).toBe(before);
  // An accusation alone never changes a status.
  const after = await getDb().execute<{ status: string }>(sql`
    SELECT r.status FROM teaching_relationship r JOIN person p ON p.id IN (r.teacher_person_id, r.student_person_id) WHERE p.slug = ${RECORD} AND r.visibility = 'public'`);
  expect(after.rows).toEqual(statuses.rows);
  await axeBothThemes(page, '/people/[slug]/dispute (refused)');
});

test('@M25 a shared archival record shows its change history and takes proposals, never edits', async ({ page }, testInfo) => {
  await page.goto(`/people/${RECORD}`);
  await shown(page.getByTestId('record-history-link')).click();
  await page.waitForURL(new RegExp(`/people/${RECORD}/record$`));
  await expect(shown(page.getByTestId('record-history'))).toBeVisible();
  await expect(shown(page.getByRole('link', { name: 'Sign in to propose a correction' }))).toBeVisible();
  await axeBothThemes(page, '/people/[slug]/record (visitor)');

  await signInAs(page, 'demo-pending');
  await page.goto(`/people/${RECORD}/record`);
  const form = shown(page.getByTestId('propose-form'));
  await expect(form.getByLabel('Name in Latin letters')).not.toHaveValue('');
  await axeBothThemes(page, '/people/[slug]/record');
  if (testInfo.project.name.startsWith('mobile')) await expectTouchTargets(page, '[data-testid="propose-form"] button');
  const before = await count(sql`SELECT count(*)::int AS n FROM record_proposal`);
  await form.getByRole('button', { name: 'Send the proposal' }).click();
  await expect(shown(page.getByText('Write why the record should change.')).first()).toBeVisible();
  expect(await count(sql`SELECT count(*)::int AS n FROM record_proposal`)).toBe(before);

  // A profile kept by its own person is no shared record.
  await page.goto('/people/demo-pending/record');
  await expect(shown(page.getByTestId('record-not-shared'))).toBeVisible();
});
