/**
 * Claim links of an organization's imported members (role replay 2026-11-25, P2-6, ADR 0074): the
 * owner of demo-federation-north imports a fictional member, makes the claim links from the
 * import's page and reads the member's link; a new account without a profile opens it in a browser
 * of its own and asks to claim the record, which opens a person_claim review case and never makes
 * the record its own by itself; the used link opens nothing for anyone else. Fictional names only
 * (D20).
 *
 * The claim opens a review case, which changes the review queue the visual regression compares, so
 * the spec runs in the `exclusive` project (e2e/projects.ts, PUBLIC_WRITE_SPECS).
 */

import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { closeHelpers, giveOwnAddress, loadTestEnv, signInAs } from './helpers/auth';
import { apiPost, freshAccount } from './helpers/plans';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

/** A fictional surname in Latin letters only, new for each test. */
const surname = () =>
  `Link${randomBytes(4)
    .toString('hex')
    .replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]!)}`;

async function federationNorth(): Promise<string> {
  const rows = await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM organization WHERE slug = 'demo-federation-north'`);
  expect(rows.rows, 'the seeded demo-federation-north (pnpm db:seed)').toHaveLength(1);
  return rows.rows[0]!.id;
}

/** See e2e/m24-organization-tools.spec.ts: this run's previews only count against the allowance. */
async function freshAllowance(organizationId: string) {
  await getDb().execute(sql`UPDATE organization_import SET created_at = created_at - interval '2 days' WHERE organization_id = ${organizationId}::uuid AND created_at > now() - interval '24 hours'`);
}

/** Every visible button of `selector` is at least 44 px tall (phones only). */
async function expectTouchTargets(page: Page, selector: string) {
  const sizes = await page.locator(selector).evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null && !el.closest('.sr-only'))
      .map((el) => ({ text: (el.textContent ?? el.getAttribute('name') ?? '').trim().slice(0, 40), height: el.getBoundingClientRect().height })),
  );
  expect(sizes.length).toBeGreaterThan(0);
  for (const s of sizes) expect(s.height, `"${s.text}" is at least 44 px tall`).toBeGreaterThanOrEqual(44);
}

async function axeInBothThemes(page: Page, label: string) {
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `${label} (${theme})`);
  }
}

test('@M24 an imported member claims their record with a link the organization passes on (ADR 0074)', async ({ page, browser }, testInfo) => {
  const phone = testInfo.project.name.startsWith('mobile');
  const organizationId = await federationNorth();
  await freshAllowance(organizationId);
  await signInAs(page, 'demo-federation-owner');
  const name = surname();
  const preview = await apiPost(page, '/organizations/imports/preview', {
    organizationId,
    contentBase64: Buffer.from(`First_Name,Last_Name,Email\nDemo,${name},demo-not-read@example.test\n`).toString('base64'),
  });
  expect(preview.status(), await preview.text()).toBe(200);
  const { id: importId } = (await preview.json()) as { id: string };
  const commit = await apiPost(page, '/organizations/imports/commit', { organizationId, importId });
  expect(commit.status(), await commit.text()).toBe(200);

  // The import's page leads to the claim links.
  await page.goto(`/dashboard/organization/${organizationId}/import/${importId}`);
  await page.getByTestId('organization-import-next').getByRole('link', { name: 'Make claim links' }).click();
  await expect(page.getByTestId('organization-claim-links')).toBeVisible();
  const row = page.getByTestId('claim-link-member').filter({ hasText: `Demo ${name}` });
  await expect(row).toHaveAttribute('data-has-link', 'no');
  await page.getByTestId('claim-links-make').getByRole('button').click();
  await expect(page.getByTestId('claim-links-made')).toBeVisible();
  await expect(row).toHaveAttribute('data-has-link', 'yes');
  const url = (await row.getByTestId('claim-link-url').textContent())!.trim();
  expect(url).toMatch(/\/claim\/[A-Za-z0-9_-]{43}$/);
  await axeInBothThemes(page, '/dashboard/organization/<id>/claim-links');
  if (phone) await expectTouchTargets(page, '[data-testid="organization-claim-links"] button');
  const path = new URL(url).pathname;

  // The member, in a browser of their own: a new account without a profile asks to claim it.
  const member = await browser.newContext();
  await giveOwnAddress(member);
  const memberPage = await member.newPage();
  try {
    await memberPage.goto(path);
    await expect(memberPage.getByTestId('claim-link-summary')).toContainText(`Demo ${name}`);
    await expect(memberPage.getByTestId('claim-link-sign-in')).toBeVisible();
    await freshAccount(memberPage);
    await memberPage.goto(path);
    await axeInBothThemes(memberPage, '/claim/<token>');
    await memberPage.getByLabel(/Note for the reviewers/).fill('I train on Tuesdays (fictional).');
    await memberPage.getByRole('button', { name: 'Claim my record' }).click();
    await expect(memberPage).toHaveURL(/\/dashboard\/cases\/[0-9a-f-]{36}\?claimed=1/);
    // A link never signs in or makes the record theirs: the reviewers decide.
    const record = await getDb().execute<{ claimed: string | null }>(sql`
      SELECT p.claimed_by_user_id::text AS claimed FROM organization_import_row r JOIN person p ON p.id = r.person_id WHERE r.import_id = ${importId}::uuid`);
    expect(record.rows[0]!.claimed).toBeNull();
    await memberPage.goto(path);
    await expect(memberPage.getByTestId('claim-link-yours')).toHaveAttribute('data-claim-status', 'pending');
  } finally {
    await member.close();
  }

  // Used: the link opens nothing for anyone else, and the list shows the waiting claim.
  await page.goto(path);
  await expect(page.getByTestId('claim-link-missing')).toBeVisible();
  await page.goto(`/dashboard/organization/${organizationId}/claim-links`);
  await expect(row.getByTestId('claim-link-waiting')).toBeVisible();
});
