/**
 * Milestone M15: organizations. A new account applies for a fictional organization with the
 * keyboard only, an archivist approves it from the case card's version, and the public page goes
 * online with the public data only (never the leader of the application). The admin of another
 * organization gets "not found" for it, in the page and through the API. An administrator gives
 * the test Federation plan on /admin/organizations/<id>; the owner then lists a public person;
 * revoking the plan closes that administration and keeps the member on the public page (DEFAULT
 * D08). axe runs on the application form, the organization's dashboard and the public page in both
 * themes. Every name is fictional (`Demo …`, D20) and every account a new `demo-e2e-…` one.
 *
 * Approving an organization adds it to /organizations, a page the axe and route specs read, so the
 * spec runs in the `exclusive` project, in a Playwright run of its own after the others
 * (e2e/projects.ts, PUBLIC_WRITE_SPECS).
 */

import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv, signInAs, userIdOf } from './helpers/auth';
import { letters } from './helpers/evidence';
import { apiPost } from './helpers/plans';
import { signedIn, visible } from './helpers/schools';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

const capital = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
const LEADER = 'Demo Leader Person';

/** Moves the focus with Tab until the focused element is `selector`'s first match (at most `max` steps). */
async function tabTo(page: Page, selector: string, max = 80) {
  const target = page.locator(selector).first();
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
  }
  throw new Error(`Tab never reached ${selector}`);
}

async function organizationOfCase(caseId: string): Promise<{ id: string; slug: string }> {
  const rows = await getDb().execute<{ id: string; slug: string }>(sql`
    SELECT o.id::text AS id, o.slug FROM review_case c JOIN organization o ON o.id = c.organization_id WHERE c.id = ${caseId}::uuid`);
  return rows.rows[0]!;
}

async function caseOfOrganization(organizationId: string): Promise<string> {
  const rows = await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM review_case WHERE organization_id = ${organizationId}::uuid ORDER BY created_at DESC LIMIT 1`);
  return rows.rows[0]!.id;
}

/** organizations.apply through the API, as the account signed in on `page`. */
async function applyThroughApi(page: Page, name: string): Promise<{ organizationId: string; caseId: string }> {
  const applied = await apiPost(page, '/organizations/apply', {
    name,
    kind: 'association',
    leaderName: LEADER,
    leaderTitle: null,
    websiteUrl: null,
    countryCode: 'BG',
    schoolsEstimate: 2,
    evidenceIds: [],
    note: null,
    idempotencyKey: randomUUID(),
  });
  expect(applied.status(), await applied.text()).toBe(200);
  return (await applied.json()) as { organizationId: string; caseId: string };
}

/** An archivist takes the case and approves it from the version on the card (review.get), as the card does. */
async function approveAsArchivist(page: Page, caseId: string) {
  const assigneeId = await userIdOf('demo-archivist@example.test');
  const assigned = await apiPost(page, '/review/assign', { caseId, assigneeId, idempotencyKey: randomUUID() });
  expect(assigned.status(), await assigned.text()).toBe(200);
  const card = await page.request.get(`/api/v1/review/${caseId}`, { headers: { origin: BASE_URL } });
  expect(card.status(), await card.text()).toBe(200);
  const organizationVersion = ((await card.json()) as { organization: { version: string } }).organization.version;
  const decided = await apiPost(page, '/review/decide', { caseId, decision: 'verify', reason: null, idempotencyKey: randomUUID(), organizationVersion });
  expect(decided.status(), await decided.text()).toBe(200);
}

async function axeInBothThemes(page: Page, label: string) {
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `${label} (${theme})`);
  }
}

test('@M15 an account applies with the keyboard, an archivist approves, and the public page shows only public data', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signInAs(page, 'new');
  const name = `Demo ${capital(letters())} Association`;

  await page.goto('/dashboard/organization');
  await expect(page.getByTestId('no-organizations')).toBeVisible();
  await page.getByTestId('organization-apply-link').click();
  await page.waitForURL('**/dashboard/organization/apply');
  const form = page.getByTestId('organization-apply-form');
  await expect(form).toBeVisible();
  await axeInBothThemes(page, 'application form');

  // Keyboard only: Tab into each field and type, choose with the arrow keys, Enter sends.
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await tabTo(page, '[name="name"]');
  await page.keyboard.type(name);
  await page.keyboard.press('Tab');
  await expect(form.locator('select[name="kind"]')).toBeFocused();
  await form.locator('select[name="kind"]').selectOption('association');
  await page.keyboard.press('Tab');
  await expect(form.locator('select[name="countryCode"]')).toBeFocused();
  await form.locator('select[name="countryCode"]').selectOption('BG');
  await page.keyboard.press('Tab');
  await page.keyboard.type(LEADER);
  await page.keyboard.press('Tab');
  await page.keyboard.type('President');
  await page.keyboard.press('Tab');
  await page.keyboard.type('https://example.test/demo-association');
  await page.keyboard.press('Tab');
  await page.keyboard.type('3');
  await tabTo(page, 'form[data-testid="organization-apply-form"] button[type="submit"]');
  await page.keyboard.press('Enter');

  await page.waitForURL(/\/dashboard\/organization\/[0-9a-f-]{36}\?done=applied/);
  const manage = page.getByTestId('organization-manage');
  await expect(manage).toHaveAttribute('data-status', 'pending');
  await expect(visible(page.getByTestId('organization-done'))).toBeVisible();
  // DEFAULT D04: the approval and the plan, apart, in words.
  await expect(page.getByTestId('organization-plan')).toHaveText(/No plan/);
  await expect(page.getByTestId('organization-application')).toBeVisible();
  await axeInBothThemes(page, 'organization dashboard (pending)');
  const organizationId = new URL(page.url()).pathname.split('/').at(-1)!;
  const caseId = await caseOfOrganization(organizationId);
  const { slug } = await organizationOfCase(caseId);

  // Not public while it waits.
  const anonymous = await browser.newContext({ baseURL: BASE_URL });
  const visitor = await anonymous.newPage();
  await visitor.goto(`/organizations/${slug}`);
  await expect(visitor.getByTestId('organization-not-listed')).toBeVisible();

  const archivist = await signedIn(browser, 'archivist');
  try {
    await archivist.page.goto(`/admin/review/${caseId}`);
    await expect(visible(archivist.page.getByTestId('case-organization-card'))).toContainText(name);
    await approveAsArchivist(archivist.page, caseId);
  } finally {
    await archivist.context.close();
  }

  await visitor.goto(`/organizations/${slug}`);
  await expect(visitor.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(visitor.getByTestId('organization-approved')).toBeVisible();
  const html = await visitor.content();
  expect(html).not.toContain(LEADER);
  expect(html).not.toContain('President');
  await axeInBothThemes(visitor, 'public organization page');
  await visitor.goto('/organizations');
  await expect(visitor.locator(`[data-testid="organization-row"][data-slug="${slug}"]`)).toBeVisible();
  await anonymous.close();

  await page.reload();
  await expect(manage).toHaveAttribute('data-status', 'active');
  await expect(page.getByTestId('organization-approval')).toHaveAttribute('data-status', 'active');
  // Approval gives no plan: members are shown, not managed.
  await expect(page.getByTestId('organization-administration-note')).toBeVisible();
});

test('@M15 another organization’s admin gets “not found”, in the page and through the API', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await signInAs(page, 'new');
  const mine = await applyThroughApi(page, `Demo ${capital(letters())} Group`);
  const other = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(other);
  const otherPage = await other.newPage();
  try {
    await signInAs(otherPage, 'new');
    await applyThroughApi(otherPage, `Demo ${capital(letters())} Union`);
    await otherPage.goto(`/dashboard/organization/${mine.organizationId}`);
    await expect(otherPage.getByTestId('organization-not-found')).toBeVisible();
    const read = await otherPage.request.get(`/api/v1/organizations/mine/${mine.organizationId}`, { headers: { origin: BASE_URL } });
    expect(read.status()).toBe(404);
    const edit = await apiPost(otherPage, '/organizations/update', { organizationId: mine.organizationId, name: 'Demo Taken Over', kind: 'association', leaderName: LEADER, countryCode: 'BG', schoolsEstimate: 1 });
    expect(edit.status()).toBe(404);
  } finally {
    await other.close();
  }
  // The owner's own page still says what it was.
  await page.goto(`/dashboard/organization/${mine.organizationId}`);
  await expect(page.getByTestId('organization-manage')).toBeVisible();
});

test('@M15 an administrator gives Federation, the owner lists a public member, and revoking keeps the member public', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await signInAs(page, 'new');
  const name = `Demo ${capital(letters())} Federation`;
  const applied = await applyThroughApi(page, name);
  const { slug } = await organizationOfCase(applied.caseId);
  const archivist = await signedIn(browser, 'archivist');
  try {
    await approveAsArchivist(archivist.page, applied.caseId);
  } finally {
    await archivist.context.close();
  }

  const admin = await signedIn(browser, 'admin');
  try {
    await admin.page.goto(`/admin/organizations/${applied.organizationId}`);
    await expect(admin.page.getByTestId('admin-organization-plan')).toHaveAttribute('data-plan', 'none');
    const grant = admin.page.getByTestId('organization-grant-form');
    await grant.getByLabel('Reason').fill('A fictional test of the federation tools');
    await grant.getByRole('button', { name: 'Give Federation' }).click();
    await expect(visible(admin.page.getByTestId('admin-organization-done'))).toBeVisible();
    await expect(admin.page.getByTestId('admin-organization-plan')).toHaveAttribute('data-plan', 'federation');
  } finally {
    await admin.context.close();
  }

  await page.goto(`/dashboard/organization/${applied.organizationId}`);
  await expect(page.getByTestId('organization-plan')).toHaveAttribute('data-plan', 'federation');
  const add = page.getByTestId('organization-add-member');
  await add.getByLabel('Public profile').fill('/people/demo-root-a');
  await add.getByRole('button', { name: 'Add member' }).click();
  await expect(visible(page.getByTestId('organization-done'))).toBeVisible();
  await expect(page.getByTestId('organization-member')).toHaveCount(1);
  await axeInBothThemes(page, 'organization dashboard (Federation)');

  const relationshipsBefore = await getDb().execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM teaching_relationship`);
  const again = await signedIn(browser, 'admin');
  try {
    await again.page.goto(`/admin/organizations/${applied.organizationId}`);
    const revoke = again.page.getByTestId('organization-revoke-form');
    await revoke.getByLabel('Reason to revoke').fill('End of the fictional test');
    await revoke.getByRole('button', { name: 'Revoke' }).click();
    await expect(visible(again.page.getByTestId('admin-organization-done'))).toBeVisible();
  } finally {
    await again.context.close();
  }
  await page.reload();
  await expect(page.getByTestId('organization-plan')).toHaveAttribute('data-plan', 'none');
  await expect(page.getByTestId('organization-add-member')).toHaveCount(0);
  await expect(page.getByTestId('organization-member')).toHaveCount(1);
  const anonymous = await browser.newContext({ baseURL: BASE_URL });
  const visitor = await anonymous.newPage();
  await visitor.goto(`/organizations/${slug}`);
  await expect(visitor.locator('[data-testid="organization-member"][data-slug="demo-root-a"]')).toBeVisible();
  await anonymous.close();
  // DEFAULT D12: nothing here wrote a teaching relationship.
  const relationshipsAfter = await getDb().execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM teaching_relationship`);
  expect(relationshipsAfter.rows[0]!.n).toBe(relationshipsBefore.rows[0]!.n);
});
