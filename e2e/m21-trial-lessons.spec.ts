/**
 * Milestone M21: trial lessons, the schedule and fees, and the basic school stats
 * (docs/adr/0024-trial-lessons.md). A new Professional Sifu lists a school in Leipzig, the
 * administrator approves it, and the Sifu sets its weekly schedule and fees from the dashboard. A
 * visitor sees them on the public page with "Sign in to request a trial lesson", which comes back to
 * the form after sign-in. A new student requests a trial lesson by phone; the owner sees the
 * request in the school's inbox with the name and the phone, answers with a reply, and the student
 * sees the answer on /dashboard/trial-lessons and in their notifications. The owner's statistics
 * count the student's page view and the request, never the owner's own visits. A Free Sifu's
 * statistics show the upgrade prompt and no numbers. axe runs on every new page in both themes.
 *
 * The school becomes public and its page changes, so the spec runs in the `exclusive` project
 * (e2e/projects.ts, PUBLIC_WRITE_SPECS). The school is in Leipzig, far from the searches of the
 * other tests; every account is a new `demo-e2e-…@example.test` account with a fictional `Demo …`
 * name (D20).
 */

import { expect, test, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { apiPost, freshAccount } from './helpers/plans';
import { approveListing, createSchool, freshContext, grantProSifu, sifuAccount, signedIn, visible } from './helpers/schools';
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

async function counted(schoolId: string): Promise<{ page_views: number; trial_inquiries: number }> {
  const rows = await getDb().execute<{ page_views: number; trial_inquiries: number }>(sql`
    SELECT coalesce(sum(page_views), 0)::int AS page_views, coalesce(sum(trial_inquiries), 0)::int AS trial_inquiries
      FROM school_stat_day WHERE school_id = ${schoolId}::uuid`);
  return rows.rows[0]!;
}

test('@M21 a student requests a trial lesson, the owner answers, the student sees the reply', async ({ page, browser, request }) => {
  // The Sifu, the listing and its approval.
  const sifu = await sifuAccount(page, 'Trial Sifu');
  const admin = await signedIn(browser, 'admin');
  let school: { id: string; slug: string; name: string };
  try {
    await grantProSifu(admin.page, sifu.email);
    school = await createSchool(page);
    const submitted = await apiPost(page, '/schools/submit', { id: school.id });
    expect(submitted.status(), await submitted.text()).toBe(200);
    await approveListing(admin.page, school.id);
  } finally {
    await admin.context.close();
  }
  const { id, slug } = school;

  // The schedule and fees, from the school's page in the dashboard.
  await page.goto(`/dashboard/schools/${id}`);
  await visible(page.getByTestId('school-schedule-link')).click();
  await page.waitForURL(new RegExp(`/dashboard/schools/${id}/schedule$`));
  const form = visible(page.getByTestId('schedule-form'));
  await form.getByLabel('Day').first().selectOption({ label: 'Tuesday' });
  await form.getByLabel('Starts').first().fill('18:30');
  await form.getByLabel('Ends').first().fill('20:00');
  await form.getByLabel('Class (optional)').first().fill('Demo beginners');
  await form.getByLabel('The first trial lesson is free').check();
  await form.getByLabel('Fees (optional)').fill('A fictional fee of the tests.');
  await axeBothThemes(page, '/dashboard/schools/[id]/schedule');
  await form.getByRole('button', { name: 'Save the schedule' }).click();
  await page.waitForURL(/[?&]schedule=1/);
  await expect(visible(page.getByTestId('school-schedule-saved'))).toBeVisible();
  await expect(visible(page.getByTestId('school-schedule-summary'))).toContainText('1 weekly class, fees described, the first trial lesson is free');

  // The owner's own visit is never counted.
  await page.goto(`/schools/${slug}`);
  await expect(visible(page.getByTestId('school-trial-state'))).toHaveAttribute('data-state', 'own_school');
  await page.waitForTimeout(500);
  expect((await counted(id)).page_views).toBe(0);

  // A visitor: the schedule and fees, and a sign-in link that comes back to the form.
  const guest = await freshContext(browser);
  const student = await freshContext(browser);
  try {
    await guest.page.goto(`/schools/${slug}`);
    const schedule = visible(guest.page.getByTestId('school-schedule'));
    await expect(schedule.getByTestId('school-schedule-slot')).toHaveCount(1);
    await expect(schedule).toContainText('Tuesday');
    await expect(schedule).toContainText('18:30–20:00');
    await expect(schedule).toContainText('Demo beginners');
    await expect(visible(guest.page.getByTestId('school-first-trial-free'))).toHaveText('The first trial lesson is free.');
    await expect(visible(guest.page.getByTestId('school-fees'))).toHaveText('A fictional fee of the tests.');
    const signIn = visible(guest.page.getByTestId('school-trial-sign-in'));
    await expect(signIn).toHaveAttribute('href', `/sign-in?next=${encodeURIComponent(`/schools/${slug}/trial`)}`);
    // The beacon counts the visit (counts only).
    await expect.poll(async () => (await counted(id)).page_views).toBeGreaterThanOrEqual(1);
    // The request API refuses a visitor without a session.
    expect((await request.post(`${BASE_URL}/api/v1/trial-lessons/request`, { data: { schoolId: id, contactMethod: 'email' } })).status()).toBe(401);

    // The student: a new account with a profile asks by phone.
    await freshAccount(student.page, { name: 'Demo Trial Student' });
    await student.page.goto(`/schools/${slug}`);
    await visible(student.page.getByTestId('school-trial-request')).click();
    await student.page.waitForURL(new RegExp(`/schools/${slug}/trial$`));
    const trial = visible(student.page.getByTestId('trial-form'));
    await expect(visible(student.page.getByTestId('trial-privacy-notice'))).toContainText('your profile name (Demo Trial Student) and the contact you chose');
    await axeBothThemes(student.page, '/schools/[slug]/trial');
    await trial.getByLabel('Times that suit you (optional)').fill('Tuesday evenings');
    await trial.getByLabel('Message to the school (optional)').fill('A fictional request of the tests.');
    await trial.getByTestId('trial-contact-phone').check();
    await trial.getByLabel('Phone number').fill('+000 000 0021');
    await trial.getByRole('button', { name: 'Send the request' }).click();
    await student.page.waitForURL(/\/dashboard\/trial-lessons\?sent=1/);
    await expect(visible(student.page.getByTestId('trial-sent'))).toBeVisible();
    const own = visible(student.page.getByTestId('own-trial-request'));
    await expect(own).toHaveCount(1);
    await expect(own).toHaveAttribute('data-status', 'open');
    await expect(own.getByTestId('trial-status')).toHaveText('Waiting for the school');
    // A second request at the same school waits until this one is answered.
    await student.page.goto(`/schools/${slug}/trial`);
    await expect(visible(student.page.getByTestId('trial-refused'))).toHaveAttribute('data-state', 'open');

    // The owner's inbox: the name, the phone, the times and the message; then the answer.
    await page.goto('/dashboard/schools');
    await visible(page.getByTestId('own-school-trials')).filter({ hasText: '1 trial lesson request waits for an answer' }).click();
    await page.waitForURL(new RegExp(`/dashboard/schools/${id}/inquiries$`));
    const inquiry = visible(page.getByTestId('trial-inquiry'));
    await expect(inquiry).toHaveCount(1);
    await expect(inquiry).toContainText('Demo Trial Student');
    await expect(inquiry.getByTestId('trial-contact')).toHaveText('+000 000 0021');
    await expect(inquiry).toContainText('Times: Tuesday evenings');
    await expect(inquiry).toContainText('A fictional request of the tests.');
    await axeBothThemes(page, '/dashboard/schools/[id]/inquiries');
    await inquiry.getByLabel('Reply or reason (optional)').fill('Come on Tuesday at 18:30; bring flat shoes.');
    await inquiry.getByTestId('trial-answer').click();
    await page.waitForURL(/[?&]done=answered/);
    await expect(visible(page.getByTestId('trial-done'))).toBeVisible();
    await expect(visible(page.getByTestId('trial-inquiry'))).toHaveAttribute('data-status', 'answered');

    // The student sees the answer, and is told.
    await student.page.goto('/dashboard/trial-lessons');
    const answered = visible(student.page.getByTestId('own-trial-request'));
    await expect(answered).toHaveAttribute('data-status', 'answered');
    await expect(answered.getByTestId('own-trial-reply')).toContainText('Come on Tuesday at 18:30; bring flat shoes.');
    await axeBothThemes(student.page, '/dashboard/trial-lessons');
    await student.page.goto('/dashboard/notifications');
    await expect(visible(student.page.getByText('Your trial lesson request was answered')).first()).toBeVisible();
  } finally {
    await guest.context.close();
    await student.context.close();
  }

  // The statistics: the student's request and the visits, never the owner's own.
  await page.goto(`/dashboard/schools/${id}`);
  await visible(page.getByTestId('school-stats-link')).click();
  await page.waitForURL(new RegExp(`/dashboard/schools/${id}/stats$`));
  const stats = visible(page.getByTestId('school-stats'));
  await expect(stats.getByTestId('stats-week')).toHaveCount(12);
  const trials = visible(page.getByTestId('stats-totals')).locator('div').filter({ hasText: 'Trial requests' }).locator('dd');
  await expect(trials).toHaveText('1');
  expect((await counted(id)).trial_inquiries).toBe(1);
  await axeBothThemes(page, '/dashboard/schools/[id]/stats');
});

test('@M21 a student withdraws an open request: the words go at once, the school sees it without a name (review 2026-11)', async ({ page, browser }) => {
  const sifu = await sifuAccount(page, 'Withdraw Sifu');
  const admin = await signedIn(browser, 'admin');
  let school: { id: string; slug: string; name: string };
  try {
    await grantProSifu(admin.page, sifu.email);
    school = await createSchool(page);
    const submitted = await apiPost(page, '/schools/submit', { id: school.id });
    expect(submitted.status(), await submitted.text()).toBe(200);
    await approveListing(admin.page, school.id);
  } finally {
    await admin.context.close();
  }
  const { id, slug } = school;

  const student = await freshContext(browser);
  try {
    await freshAccount(student.page, { name: 'Demo Withdraw Student' });
    await student.page.goto(`/schools/${slug}/trial`);
    const form = visible(student.page.getByTestId('trial-form'));
    await form.getByLabel('Message to the school (optional)').fill('A fictional request that will be withdrawn.');
    await form.getByRole('button', { name: 'Send the request' }).click();
    await student.page.waitForURL(/\/dashboard\/trial-lessons\?sent=1/);
    const own = visible(student.page.getByTestId('own-trial-request'));
    await expect(own).toHaveAttribute('data-status', 'open');
    await axeBothThemes(student.page, '/dashboard/trial-lessons (open request)');

    // The owner sees the name and the message while it waits.
    await page.goto(`/dashboard/schools/${id}/inquiries`);
    await expect(visible(page.getByTestId('trial-inquiry'))).toContainText('Demo Withdraw Student');

    // The student withdraws it: one press, and the words are gone.
    await own.getByTestId('trial-withdraw').click();
    await student.page.waitForURL(/\/dashboard\/trial-lessons\?withdrawn=1/);
    await expect(visible(student.page.getByTestId('trial-withdrawn'))).toBeVisible();
    const withdrawn = visible(student.page.getByTestId('own-trial-request'));
    await expect(withdrawn).toHaveAttribute('data-status', 'withdrawn');
    await expect(withdrawn.getByTestId('trial-status')).toHaveText('Withdrawn');
    await expect(visible(student.page.getByTestId('own-trial-scrubbed'))).toContainText('You withdrew this request');
    await expect(withdrawn).not.toContainText('A fictional request that will be withdrawn.');
    await expect(withdrawn.getByTestId('trial-withdraw')).toHaveCount(0);
    await axeBothThemes(student.page, '/dashboard/trial-lessons (withdrawn)');

    // The school sees a withdrawn request with no name and no message, and cannot answer it.
    await page.goto(`/dashboard/schools/${id}/inquiries`);
    const inbox = visible(page.getByTestId('trial-inquiry'));
    await expect(inbox).toHaveAttribute('data-status', 'withdrawn');
    await expect(inbox).not.toContainText('Demo Withdraw Student');
    await expect(inbox).not.toContainText('A fictional request that will be withdrawn.');
    await expect(inbox.getByTestId('trial-scrubbed')).toBeVisible();
    await expect(inbox.getByTestId('trial-answer')).toHaveCount(0);

    // The student may ask again: the withdrawn request no longer holds the one open place.
    await student.page.goto(`/schools/${slug}/trial`);
    await expect(visible(student.page.getByTestId('trial-form'))).toBeVisible();
  } finally {
    await student.context.close();
  }
});

test('@M21 a Free Sifu sets a schedule without a plan, and the statistics show the upgrade prompt and no numbers', async ({ page }) => {
  const sifu = await sifuAccount(page, 'Free Trial Sifu');
  expect(sifu.email).toMatch(/@example\.test$/);
  const school = await createSchool(page);
  const saved = await apiPost(page, '/schools/schedule/update', { id: school.id, slots: [{ weekday: 6, startsAt: '10:00', endsAt: '12:00', label: 'Demo open practice' }], fees: null, firstTrialFree: false });
  expect(saved.status(), await saved.text()).toBe(200);
  await page.goto(`/dashboard/schools/${school.id}/stats`);
  await expect(visible(page.getByTestId('stats-unavailable'))).toBeVisible();
  await expect(visible(page.getByTestId('stats-table'))).toHaveCount(0);
  await expect(visible(page.getByText('Weekly statistics need Professional Sifu.', { exact: false }))).toBeVisible();
  await axeBothThemes(page, '/dashboard/schools/[id]/stats (Free Sifu)');
});
