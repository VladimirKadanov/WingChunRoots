/**
 * Video embeds of Premium Student (docs/adr/0050-video-embeds.md). A new public student on Premium
 * Student adds two video links to their profile (a refused address first); the public profile shows
 * each as a title and a "Play" link, and no player loads until Play is pressed. The seeded
 * administrator removes one with a reason, which the student is sent. axe runs on the changed pages
 * in both themes. Fictional (D20).
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
  // The test never reaches YouTube or Vimeo: the player frame stays empty, so the run does not
  // depend on a third-party site, and axe checks this page rather than the provider's player.
  await context.route(/^https:\/\/(www\.youtube-nocookie\.com|player\.vimeo\.com)\//, (route) => route.abort());
});

async function axeBothThemes(page: Page, label: string) {
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `${label} (${theme})`);
  }
}

test('@premium a student adds video links; the player loads only on Play; staff remove one with a reason', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const admin = await signedIn(browser, 'admin');
  try {
    const name = `Demo Video Pupil ${Math.random().toString(36).slice(2, 7).replace(/\d/g, 'x')}`;
    const student = await freshAccount(page);
    const onboard = await apiPost(page, '/account/onboard', { primaryName: name, showPublicly: true });
    expect(onboard.status(), await onboard.text()).toBe(200);
    const given = await apiPost(admin.page, '/admin/grants/create', { email: student.email, planCode: 'premium_student', source: 'test_grant', reason: 'Demo pilot test of video embeds' });
    expect(given.status(), await given.text()).toBe(200);
    const rows = await getDb().execute<{ slug: string }>(sql`SELECT slug FROM person WHERE claimed_by_user_id = ${student.userId} AND deleted_at IS NULL`);
    const slug = rows.rows[0]!.slug;

    // Video links: a refused address names its row; then two videos in order.
    await page.goto('/dashboard/profile');
    const form = page.getByTestId('profile-videos-form');
    await expect(form).toBeVisible();
    await form.getByLabel('Video 1 title').fill('Demo form, first section');
    await form.getByLabel('Video 1 address').fill('https://example.test/video');
    await form.getByTestId('profile-videos-save').click();
    await expect(page.getByTestId('profile-videos-error')).toBeVisible();
    await expect(page.getByTestId('profile-videos-form').getByText('Enter the address of a YouTube or Vimeo video').first()).toBeVisible();
    await page.getByTestId('profile-videos-form').getByLabel('Video 1 address').fill('https://www.youtube.com/watch?v=abcDEF12345');
    await page.getByTestId('profile-videos-form').getByLabel('Video 2 title').fill('Demo drill');
    await page.getByTestId('profile-videos-form').getByLabel('Video 2 address').fill('https://vimeo.com/123456789');
    const save = page.getByTestId('profile-videos-save');
    expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await save.click();
    await expect(page.getByTestId('profile-videos-notice')).toBeVisible();
    await axeBothThemes(page, '/dashboard/profile with videos');

    // The public profile: titles and Play links, and no player until Play.
    await page.goto(`/people/${slug}`);
    const videos = page.getByTestId('profile-videos').getByTestId('profile-video');
    await expect(videos).toHaveCount(2);
    await expect(videos.first()).toContainText('Demo form, first section');
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(videos.first().getByTestId('profile-video-page')).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    await expect(videos.first().getByTestId('profile-video-page')).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abcDEF12345');
    await expect(page.getByTestId('profile-videos-moderation')).toHaveCount(0);
    const play = videos.first().getByTestId('profile-video-play');
    expect((await play.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await play.click();
    const player = page.getByTestId('profile-video-player');
    await expect(player).toHaveCount(1);
    await expect(player).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/abcDEF12345/);
    await expect(player).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    await axeBothThemes(page, `/people/${slug} playing a video`);

    // Staff remove the second video with a reason; the student is told.
    await admin.page.goto(`/people/${slug}`);
    const moderation = admin.page.getByTestId('profile-videos-moderation');
    await expect(moderation).toBeVisible();
    await moderation.getByLabel('Video', { exact: true }).selectOption({ label: 'Demo drill (Vimeo)' });
    await moderation.getByLabel('Reason').fill('Demo: the video is not about Wing Chun.');
    await moderation.getByTestId('profile-video-remove-submit').click();
    await expect(admin.page.getByTestId('profile-video-removed')).toHaveText('The video was removed. Its owner was told why.');
    await expect(admin.page.getByTestId('profile-videos').getByTestId('profile-video')).toHaveCount(1);

    await page.goto('/dashboard/notifications');
    await expect(page.getByText('A video on your profile').first()).toBeVisible();
  } finally {
    await admin.context.close();
  }
});
