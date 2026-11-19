/**
 * The Supporter badge of Premium Student (docs/adr/0049-supporter-badge.md). A new public student
 * on Premium Student finds the badge off, switches it on in /dashboard/profile, sees it on the
 * public profile (a word and a shape, not colour alone), and switches it off again. axe runs on
 * both pages in both themes. Fictional (D20).
 *
 * The student's profile is public, so the spec changes public pages: it runs in the `exclusive`
 * project, in a Playwright run of its own after the others (e2e/projects.ts, PUBLIC_WRITE_SPECS).
 */

import { expect, test, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { apiPost, freshAccount } from './helpers/plans';
import { signedIn } from './helpers/schools';
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

test('@premium a student switches the Supporter badge on and off', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const admin = await signedIn(browser, 'admin');
  try {
    const name = `Demo Supporter Pupil ${Math.random().toString(36).slice(2, 7).replace(/\d/g, 'x')}`;
    const student = await freshAccount(page);
    const onboard = await apiPost(page, '/account/onboard', { primaryName: name, showPublicly: true });
    expect(onboard.status(), await onboard.text()).toBe(200);
    const given = await apiPost(admin.page, '/admin/grants/create', { email: student.email, planCode: 'premium_student', source: 'test_grant', reason: 'Demo pilot test of the supporter badge' });
    expect(given.status(), await given.text()).toBe(200);
    const rows = await getDb().execute<{ slug: string }>(sql`SELECT slug FROM person WHERE claimed_by_user_id = ${student.userId} AND deleted_at IS NULL`);
    const slug = rows.rows[0]!.slug;

    await page.goto(`/people/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('supporter-badge')).toHaveCount(0);

    await page.goto('/dashboard/profile');
    const section = page.getByTestId('profile-supporter');
    await expect(section.getByTestId('profile-supporter-show')).not.toBeChecked();
    await section.getByTestId('profile-supporter-show').check();
    const save = section.getByTestId('profile-supporter-save');
    expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await save.click();
    await expect(page.getByTestId('profile-supporter-notice')).toHaveText('Your profile shows the Supporter badge.');
    await expect(page.getByTestId('profile-supporter-show')).toBeChecked();
    await axeBothThemes(page, '/dashboard/profile with the supporter badge');

    await page.goto(`/people/${slug}`);
    await expect(page.getByTestId('supporter-badge')).toContainText('Supporter');
    await axeBothThemes(page, `/people/${slug} with the supporter badge`);

    await page.goto('/dashboard/profile');
    await page.getByTestId('profile-supporter-show').uncheck();
    await page.getByTestId('profile-supporter-save').click();
    await expect(page.getByTestId('profile-supporter-notice')).toHaveText('Your profile does not show the Supporter badge.');
    await page.goto(`/people/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('supporter-badge')).toHaveCount(0);
  } finally {
    await admin.context.close();
  }
});
