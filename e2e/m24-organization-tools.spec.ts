/**
 * Milestone M24: organization tools. demo-federation-owner checks a fictional CSV file of
 * demo-federation-north with the keyboard: the preview lists every row with its problems by
 * column, and nothing is imported until the owner confirms. The imported rows are private records
 * of the organization (not public, never matched to an account), the stated teacher a claim
 * "claimed by the organization, not verified" (DEFAULT M24 question 4), which the owner withdraws.
 * Analytics show counts only; the heatmap draws a square of three schools at their city's centre and
 * never an exact point (DEFAULT M24 question 7). A member leaves on their own, and an account that
 * administers no organization gets "not found" for every tool page and procedure. axe runs on every
 * new page in both themes; on a phone every control is at least 44 px tall.
 *
 * Nothing here changes a public page: imported people are involved_only, the heatmap's schools
 * are drafts (only listed schools are public, v_public_school), and the leaving member's profile
 * is private. So the spec runs in the ordinary projects. Every name is fictional (`Demo …`, D20).
 */

import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv, signInAs } from './helpers/auth';
import { apiPost, freshAccount } from './helpers/plans';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(async () => {
  if (schools.length > 0) {
    const ids = sql.join(
      schools.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    // The app's role ends links and removes schools; it never deletes their rows.
    await getDb().execute(sql`UPDATE organization_school SET status = 'ended', ended_at = now() WHERE school_id IN (${ids}) AND status = 'accepted'`);
    await getDb().execute(sql`UPDATE school SET deleted_at = now() WHERE id IN (${ids})`);
  }
  await closeHelpers();
});

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

/** The schools this run added for the heatmap (their links ended and the schools removed after the run). */
const schools: string[] = [];

/** A fictional surname in Latin letters only, new for each test. */
const surname = () =>
  `Tool${randomBytes(4)
    .toString('hex')
    .replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]!)}`;

async function federationNorth(): Promise<string> {
  const rows = await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM organization WHERE slug = 'demo-federation-north'`);
  expect(rows.rows, 'the seeded demo-federation-north (pnpm db:seed)').toHaveLength(1);
  return rows.rows[0]!.id;
}

/**
 * The previews of demo-federation-north count against its allowance of ten a day; reruns of this
 * spec on one database would reach it. Moves this organization's earlier previews back two days, so
 * the allowance counts this run only (the allowance itself is in organization-tools.int.test.ts).
 */
async function freshAllowance(organizationId: string) {
  await getDb().execute(sql`UPDATE organization_import SET created_at = created_at - interval '2 days' WHERE organization_id = ${organizationId}::uuid AND created_at > now() - interval '24 hours'`);
}

/** Every visible button, link and field of `scope` is at least 44 px tall (phones only). */
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

test.describe('@M24 organization tools', () => {
  test('a checked file is imported only on confirmation, as private records and claims', async ({ page }, testInfo) => {
    const phone = testInfo.project.name.startsWith('mobile');
    const organizationId = await federationNorth();
    await freshAllowance(organizationId);
    await signInAs(page, 'demo-federation-owner');

    await page.goto(`/dashboard/organization/${organizationId}`);
    await expect(page.getByTestId('organization-separation-rules')).toBeVisible();
    await page.getByTestId('organization-tools-import').click();
    await expect(page.getByTestId('organization-import')).toBeVisible();
    await expect(page.getByTestId('organization-import-header')).toContainText('First_Name,Last_Name,Email,Chinese_Name,Start_Year,Current_Rank,Sifu_Database_ID,School_City');
    await axeInBothThemes(page, '/dashboard/organization/<id>/import');
    if (phone) await expectTouchTargets(page, '[data-testid="organization-import"] a, [data-testid="organization-import"] button, [data-testid="organization-import"] input[type="file"]');

    const name = surname();
    const csv = [
      'First_Name,Last_Name,Email,Chinese_Name,Start_Year,Current_Rank,Sifu_Database_ID,School_City',
      `Demo,${name},demo-not-read@example.test,詠春,2015,Demo first level,/people/demo-hub-a,Demo City`,
      `Demo,${name}b,,,not-a-year,,,`,
    ].join('\n');
    // The keyboard path: the file is chosen in the field (the system dialog is outside the page),
    // then Tab reaches "Check the file" and Enter sends it.
    const file = page.getByLabel('CSV file');
    await file.setInputFiles({ name: 'demo-members.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await file.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Check the file' })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('organization-import-detail')).toBeVisible();
    await expect(page.getByTestId('organization-import-done')).toContainText('Nothing is imported until you confirm');
    await expect(page.getByTestId('organization-import-status')).toHaveAttribute('data-status', 'previewed');
    const rows = page.getByTestId('organization-import-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute('data-status', 'valid');
    await expect(rows.nth(0)).toContainText(`Demo ${name}`);
    await expect(rows.nth(0)).toContainText('Teacher claimed by the organization');
    await expect(rows.nth(1)).toHaveAttribute('data-status', 'error');
    await expect(rows.nth(1).getByTestId('organization-import-row-errors')).toContainText('Start_Year');
    // The Email column is never read or shown (DEFAULT M24 question 3).
    expect(await page.content()).not.toContain('demo-not-read@example.test');
    const importId = page.url().split('/import/')[1]!.split(/[?#]/)[0]!;
    // Nothing exists yet: no person carries the name until the owner confirms.
    const before = await getDb().execute(sql`SELECT 1 FROM person_name WHERE value = ${`Demo ${name}`}`);
    expect(before.rows).toHaveLength(0);
    await axeInBothThemes(page, '/dashboard/organization/<id>/import/<importId> (preview)');
    if (phone) await expectTouchTargets(page, '[data-testid="organization-import-actions"] button');

    await page.getByRole('button', { name: 'Import 1 valid row' }).click();
    await expect(page.getByTestId('organization-import-done')).toContainText('Nobody was contacted and no relationship was verified');
    await expect(page.getByTestId('organization-import-status')).toHaveAttribute('data-status', 'committed');
    await expect(page.getByTestId('organization-import-actions')).toHaveCount(0);
    await expect(rows.nth(0)).toHaveAttribute('data-status', 'imported');

    // A private record of the organization: unclaimed, involved_only, no teaching relationship.
    const made = await getDb().execute<{ slug: string; visibility: string; claimed: string | null; relationships: number }>(sql`
      SELECT p.slug, p.visibility, p.claimed_by_user_id::text AS claimed,
             (SELECT count(*)::int FROM teaching_relationship r WHERE r.student_person_id = p.id) AS relationships
        FROM organization_import_row r JOIN person p ON p.id = r.person_id
       WHERE r.import_id = ${importId}::uuid`);
    expect(made.rows).toHaveLength(1);
    expect(made.rows[0]).toMatchObject({ visibility: 'involved_only', claimed: null, relationships: 0 });
    expect((await page.request.get(`/people/${made.rows[0]!.slug}`)).status()).toBe(404);

    // The claim, listed with its state in words, and withdrawn by the organization.
    await page.goto(`/dashboard/organization/${organizationId}/import`);
    const claim = page.getByTestId('organization-claim').filter({ hasText: `Demo ${name}` });
    await expect(claim).toContainText('Claimed by the organization, not verified');
    await claim.getByRole('button', { name: 'Withdraw' }).click();
    await expect(page.getByTestId('organization-import-done')).toContainText('The claim was withdrawn');
    await expect(page.getByTestId('organization-claim').filter({ hasText: `Demo ${name}` })).toHaveAttribute('data-status', 'withdrawn');
    await expect(page.getByTestId('organization-imports').getByTestId('organization-import-item').first()).toHaveAttribute('data-status', 'committed');
  });

  test('a preview can be discarded and imports nothing', async ({ page }) => {
    const organizationId = await federationNorth();
    await freshAllowance(organizationId);
    await signInAs(page, 'demo-federation-owner');
    const name = surname();
    const preview = await apiPost(page, '/organizations/imports/preview', {
      organizationId,
      contentBase64: Buffer.from(`First_Name,Last_Name\nDemo,${name}\n`).toString('base64'),
    });
    expect(preview.status(), await preview.text()).toBe(200);
    const { id } = (await preview.json()) as { id: string };
    await page.goto(`/dashboard/organization/${organizationId}/import/${id}`);
    await page.getByRole('button', { name: /Discard/ }).click();
    await expect(page.getByTestId('organization-import-done')).toContainText('Nothing was imported');
    await expect(page.getByTestId('organization-import-status')).toHaveAttribute('data-status', 'discarded');
    const people = await getDb().execute(sql`SELECT 1 FROM person_name WHERE value = ${`Demo ${name}`}`);
    expect(people.rows).toHaveLength(0);
  });

  test('analytics are counts, and the heatmap never shows a school’s point', async ({ page }, testInfo) => {
    const phone = testInfo.project.name.startsWith('mobile');
    const organizationId = await federationNorth();
    await signInAs(page, 'demo-federation-owner');

    await page.goto(`/dashboard/organization/${organizationId}/analytics`);
    await expect(page.getByTestId('organization-analytics')).toBeVisible();
    await expect(page.getByTestId('organization-analytics-month-table').locator('tbody tr')).toHaveCount(12);
    await axeInBothThemes(page, '/dashboard/organization/<id>/analytics');

    // Three draft schools (never public) in one city, each with its own exact point, linked to the
    // organization: one square at the city's centre.
    const place = (
      await getDb().execute<{ id: string; lat: number; lng: number }>(sql`
        SELECT id::text AS id, ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng
          FROM place WHERE country_code = 'BG' ORDER BY population DESC NULLS LAST, id LIMIT 1 OFFSET 2`)
    ).rows[0]!;
    const owner = (await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM auth_user WHERE email = 'demo-federation-owner@example.test'`)).rows[0]!.id;
    const exact: string[] = [];
    for (let i = 0; i < 3; i++) {
      const lat = (place.lat + 0.01234 + i * 0.00321).toFixed(5);
      const lng = (place.lng + 0.01567 + i * 0.00432).toFixed(5);
      exact.push(lat, lng);
      const id = (
        await getDb().execute<{ id: string }>(sql`
          INSERT INTO school (slug, name, place_id, location_privacy, public_point, status, created_by_user_id)
          VALUES (${`demo-e2e-heat-${randomBytes(4).toString('hex')}`}, 'Demo Heatmap Hall', ${place.id}::uuid, 'exact',
                  ST_SetSRID(ST_MakePoint(${Number(lng)}, ${Number(lat)}), 4326)::geography, 'draft', ${owner}::uuid)
          RETURNING id::text AS id`)
      ).rows[0]!.id;
      schools.push(id);
      await getDb().execute(sql`INSERT INTO school_private_location (school_id, exact_point) VALUES (${id}::uuid, ST_SetSRID(ST_MakePoint(${Number(lng)}, ${Number(lat)}), 4326)::geography)`);
      await getDb().execute(sql`INSERT INTO organization_school (organization_id, school_id, status, answered_at) VALUES (${organizationId}::uuid, ${id}::uuid, 'accepted', now())`);
    }

    await page.goto(`/dashboard/organization/${organizationId}/heatmap`);
    await expect(page.getByTestId('organization-heatmap')).toBeVisible();
    const south = Math.floor(place.lat);
    const west = Math.floor(place.lng);
    const square = page.getByTestId('organization-heatmap-square').filter({ hasText: `${Math.abs(south)}° N, ${Math.abs(west)}° E` });
    await expect(square).toHaveCount(1);
    expect(Number(await square.locator('td').last().textContent())).toBeGreaterThanOrEqual(3);
    const html = await page.content();
    for (const value of exact) expect(html, 'no exact coordinate in the page').not.toContain(value);
    expect(html).not.toContain(place.lat.toFixed(4));
    await axeInBothThemes(page, '/dashboard/organization/<id>/heatmap');
    if (phone) await expectTouchTargets(page, '[data-testid="organization-heatmap"] a, [data-testid="organization-heatmap"] button');

    // The map on request: the same squares, loaded only now.
    await page.getByTestId('organization-heatmap-show').click();
    const map = page.getByTestId('organization-heatmap-map');
    await expect(map).toHaveAttribute('data-map-loaded', 'true', { timeout: 20_000 });
    await expectNoAxeViolations(page, '/dashboard/organization/<id>/heatmap (map)');
  });

  test('a member leaves on their own; the organization keeps no record of them', async ({ page }) => {
    const organizationId = await federationNorth();
    const name = `Demo ${surname()}`;
    const account = await freshAccount(page, { name });
    const personId = (await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM person WHERE claimed_by_user_id = ${account.userId}::uuid`)).rows[0]!.id;
    // A private profile, so the organization's public page never lists it.
    await getDb().execute(sql`UPDATE person SET visibility = 'involved_only' WHERE id = ${personId}::uuid`);
    await getDb().execute(sql`INSERT INTO organization_membership (organization_id, person_id, role, starts_on) VALUES (${organizationId}::uuid, ${personId}::uuid, 'member', current_date)`);

    await page.goto('/dashboard/organization');
    await expect(page.getByTestId('separation-rules')).toBeVisible();
    const membership = page.getByTestId('my-membership').filter({ hasText: 'Demo Federation North' });
    await expect(membership).toHaveAttribute('data-current', 'true');
    await axeInBothThemes(page, '/dashboard/organization (memberships)');
    await membership.getByRole('button', { name: /Leave/ }).click();
    await expect(page.getByTestId('organization-membership-left')).toContainText('its admins were told');
    const ended = await getDb().execute<{ ends_on: string | null }>(sql`SELECT ends_on::text FROM organization_membership WHERE organization_id = ${organizationId}::uuid AND person_id = ${personId}::uuid`);
    expect(ended.rows[0]!.ends_on).not.toBeNull();
    const told = await getDb().execute(sql`
      SELECT 1 FROM notification n JOIN auth_user u ON u.id = n.user_id
       WHERE u.email = 'demo-federation-owner@example.test' AND n.template = 'organization.member_left' AND n.created_at > now() - interval '5 minutes'`);
    expect(told.rows.length).toBeGreaterThan(0);
  });

  test('an account that administers no organization gets "not found" for every tool', async ({ page }) => {
    const organizationId = await federationNorth();
    await signInAs(page, 'new');
    for (const tool of ['import', 'analytics', 'heatmap']) {
      await page.goto(`/dashboard/organization/${organizationId}/${tool}`);
      await expect(page.getByTestId('organization-not-found')).toBeVisible();
    }
    for (const tool of ['imports', 'claims', 'analytics', 'heatmap']) {
      const answer = await page.request.get(`/api/v1/organizations/mine/${organizationId}/${tool}`, { headers: { origin: BASE_URL } });
      expect(answer.status(), tool).toBe(404);
    }
    const preview = await apiPost(page, '/organizations/imports/preview', { organizationId, contentBase64: Buffer.from('First_Name\nDemo\n').toString('base64') });
    expect(preview.status()).toBe(404);
    await expectNoAxeViolations(page, 'organization tool, not found');
  });
});
