/**
 * The featured profile of Premium Student (docs/adr/0047-featured-profile.md). A new public student
 * on Premium Student writes a biography longer than 1,000 characters and adds two links to their
 * profile (a refused address first); the public profile shows them, marked as the member's own.
 * The seeded administrator removes one with a reason, which the student is sent. axe runs on the
 * changed pages in both themes. Fictional (D20).
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

test('@premium a student writes a longer biography and adds links; staff remove one with a reason', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const admin = await signedIn(browser, 'admin');
  try {
    const name = `Demo Featured Pupil ${Math.random().toString(36).slice(2, 7).replace(/\d/g, 'x')}`;
    const student = await freshAccount(page);
    const onboard = await apiPost(page, '/account/onboard', { primaryName: name, showPublicly: true });
    expect(onboard.status(), await onboard.text()).toBe(200);
    const given = await apiPost(admin.page, '/admin/grants/create', { email: student.email, planCode: 'premium_student', source: 'test_grant', reason: 'Demo pilot test of the featured profile' });
    expect(given.status(), await given.text()).toBe(200);
    const rows = await getDb().execute<{ slug: string }>(sql`SELECT slug FROM person WHERE claimed_by_user_id = ${student.userId} AND deleted_at IS NULL`);
    const slug = rows.rows[0]!.slug;

    // The longer biography: 2,000 characters on this plan.
    await page.goto('/dashboard/profile');
    const bio = page.getByLabel('Short biography');
    await expect(bio).toHaveAttribute('maxlength', '2000');
    const words = 'Demo training notes for a fictional student. ';
    const long = words.repeat(Math.ceil(1500 / words.length)).slice(0, 1500).trim();
    await bio.fill(long);
    await page.getByRole('button', { name: 'Save my profile' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Your profile is saved.' })).toBeVisible();

    // Links: a refused address names its row; then two links in order.
    const form = page.getByTestId('profile-links-form');
    await expect(form).toBeVisible();
    await expect(form.getByTestId('profile-link-row')).toHaveCount(5);
    await form.getByLabel('Link 1 name').fill('Demo kwoon site');
    await form.getByLabel('Link 1 address').fill('http://example.test/kwoon');
    await form.getByTestId('profile-links-save').click();
    await expect(page.getByTestId('profile-links-error')).toBeVisible();
    await expect(page.getByTestId('profile-links-form').getByText('Enter a full address that starts with https://')).toBeVisible();
    await page.getByTestId('profile-links-form').getByLabel('Link 1 address').fill('https://example.test/kwoon');
    await page.getByTestId('profile-links-form').getByLabel('Link 2 name').fill('Demo training diary');
    await page.getByTestId('profile-links-form').getByLabel('Link 2 address').fill('https://diary.example.test/');
    const save = page.getByTestId('profile-links-save');
    expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await save.click();
    await expect(page.getByTestId('profile-links-notice')).toHaveText('Your links are saved.');
    await axeBothThemes(page, '/dashboard/profile with links');

    // The public profile: the longer biography and the links, marked as the member's own.
    await page.goto(`/people/${slug}`);
    const links = page.getByTestId('profile-links').getByTestId('profile-link');
    await expect(links).toHaveCount(2);
    await expect(links.first()).toContainText('Demo kwoon site');
    await expect(links.first()).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    await expect(links.first()).toHaveAttribute('href', 'https://example.test/kwoon');
    await expect(page.getByTestId('profile-links-moderation')).toHaveCount(0);

    // Staff remove the second link with a reason; the student is told.
    await admin.page.goto(`/people/${slug}`);
    const moderation = admin.page.getByTestId('profile-links-moderation');
    await expect(moderation).toBeVisible();
    await axeBothThemes(admin.page, `/people/${slug} with links, as staff`);
    await moderation.getByLabel('Link', { exact: true }).selectOption({ label: 'Demo training diary (diary.example.test)' });
    await moderation.getByLabel('Reason').fill('Demo: the address no longer belongs to the member.');
    await moderation.getByTestId('profile-link-remove-submit').click();
    await expect(admin.page.getByTestId('profile-link-removed')).toHaveText('The link was removed. Its owner was told why.');
    await expect(admin.page.getByTestId('profile-links').getByTestId('profile-link')).toHaveCount(1);

    await page.goto('/dashboard/notifications');
    await expect(page.getByText('A link on your profile').first()).toBeVisible();
  } finally {
    await admin.context.close();
  }
});
