/**
 * Milestone M19: the training passport (docs/adr/0022-passport.md). A Sifu records a rank and an
 * examination for their verified student from /dashboard/students; the student is told, sees them
 * on /dashboard/passport and on their profile. The student cannot record a rank of their own
 * (DEFAULT M19, question 1), makes an entry private, proposes a correction and uploads a private
 * certificate that a guest cannot open (question 4). axe runs on the passport pages in both themes.
 * The read-only views of the seeded passports, on the desktop and the phone, are in
 * e2e/m19-passport-view.spec.ts. Everything is fictional (D20).
 *
 * The new students' profiles are public, so their passports change public pages: the spec runs in
 * the `exclusive` project, in a Playwright run of its own after the others (e2e/projects.ts,
 * PUBLIC_WRITE_SPECS).
 */

import { expect, test, type Locator, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { teachingRelationship } from '../src/server/db/schema';
import { plainImage } from '../src/server/storage/test-images';
import { closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { apiPost, freshAccount } from './helpers/plans';
import { freshContext, sifuAccount, signedIn } from './helpers/schools';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

/** Only what is on screen: Next.js keeps earlier routes of the tab in the page, hidden. */
const shown = (locator: Locator) => locator.filter({ visible: true });

async function personOf(userId: string): Promise<{ id: string; slug: string }> {
  const rows = await getDb().execute<{ id: string; slug: string }>(sql`SELECT id, slug FROM person WHERE claimed_by_user_id = ${userId} AND deleted_at IS NULL`);
  expect(rows.rows, 'the account has a profile').toHaveLength(1);
  return rows.rows[0]!;
}

/** `teacher` and `student` with a verified public relationship. */
async function relate(teacherUserId: string, studentUserId: string) {
  const lineage = await getDb().execute<{ id: string }>(sql`SELECT id FROM lineage WHERE slug LIKE 'demo-%' ORDER BY slug LIMIT 1`);
  await getDb()
    .insert(teachingRelationship)
    .values({ teacherPersonId: (await personOf(teacherUserId)).id, studentPersonId: (await personOf(studentUserId)).id, lineageId: lineage.rows[0]!.id, status: 'verified', visibility: 'public' });
}

/** A new Student with a public profile, on Premium Student when `premium` (granted by the seeded admin). */
async function publicStudent(page: Page, admin: Page, name: string, premium = true) {
  const student = await freshAccount(page);
  const onboard = await apiPost(page, '/account/onboard', { primaryName: name, showPublicly: true });
  expect(onboard.status(), await onboard.text()).toBe(200);
  if (premium) {
    const given = await apiPost(admin, '/admin/grants/create', { email: student.email, planCode: 'premium_student', source: 'test_grant', reason: 'Demo pilot test of the training passport' });
    expect(given.status(), await given.text()).toBe(200);
  }
  return { ...student, person: await personOf(student.userId) };
}

async function axeBothThemes(page: Page, label: string) {
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `${label} (${theme})`);
  }
}

test('@M19 a teacher records a rank and an examination; the student is told and sees them on the profile', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const admin = await signedIn(browser, 'admin');
  const pupil = await freshContext(browser);
  try {
    const sifu = await sifuAccount(page, 'Passport Sifu');
    const student = await publicStudent(pupil.page, admin.page, 'Demo Passport Pupil');
    await relate(sifu.userId, student.userId);

    await page.goto('/dashboard');
    await shown(page.getByTestId('manage-student-passports')).click();
    await expect(page).toHaveURL(/\/dashboard\/students$/);
    await shown(page.getByTestId('passport-student')).filter({ hasText: 'Demo Passport Pupil' }).getByRole('link').click();
    await expect(page.getByTestId('passport-selected-student')).toContainText('Demo Passport Pupil');
    await axeBothThemes(page, 'student passport, empty');

    // A rank known to the year (DEFAULT M19, question 2).
    const rankForm = page.getByTestId('passport-rank-form');
    await rankForm.getByLabel('Rank').fill('Demo first level');
    await rankForm.getByLabel('Date').fill('2019');
    await rankForm.getByRole('button', { name: 'Record the rank' }).click();
    await expect(page.getByTestId('students-notice')).toHaveText('The rank is recorded. The student was told.');

    // A date after today is refused in words, on its field.
    const examForm = page.getByTestId('passport-exam-form');
    await examForm.getByLabel('Awarded rank').fill('Demo second level');
    await examForm.getByLabel('Date').fill('2999');
    await examForm.getByRole('button', { name: 'Record the examination' }).click();
    await expect(examForm.getByText('The date is after today. Enter the date it happened.').first()).toBeVisible();
    await examForm.getByLabel('Date').fill('2021-06-12');
    await examForm.getByLabel('Examiner').selectOption({ index: 1 });
    await examForm.getByRole('button', { name: 'Record the examination' }).click();
    await expect(page.getByTestId('students-notice')).toHaveText('The examination is recorded. The student was told.');
    await expect(shown(page.getByTestId('student-passport-entry'))).toHaveCount(2);
    await axeBothThemes(page, 'student passport, two entries');

    // The student: the notices, the dashboard and the public profile.
    await pupil.page.goto('/dashboard/notifications');
    await expect(shown(pupil.page.getByTestId('notification')).filter({ hasText: 'New in your training passport' })).toHaveCount(2);
    await pupil.page.goto('/dashboard/passport');
    await expect(pupil.page.getByTestId('passport-level')).toHaveAttribute('data-level', 'full');
    await expect(shown(pupil.page.getByTestId('own-passport-entry'))).toHaveCount(2);
    const visitor = await freshContext(browser);
    try {
      await visitor.page.goto(`/people/${student.person.slug}`);
      const section = visitor.page.getByTestId('profile-passport');
      await expect(section.getByTestId('passport-current-rank')).toContainText('Demo first level');
      await expect(section.getByTestId('passport-timeline')).toContainText('12 June 2021');
      await expect(section.getByTestId('passport-entry').filter({ hasText: 'Examination' }).getByText(/^Examiner:/)).toBeVisible();
    } finally {
      await visitor.context.close();
    }

    // Staff with a verified second factor remove an entry with a reason; without a reason it is
    // refused on the profile, in words (the form is a Server Component: no client module for visitors).
    await admin.page.goto(`/people/${student.person.slug}`);
    const moderation = admin.page.getByTestId('passport-remove-form');
    await moderation.getByLabel('Entry').selectOption({ label: 'Rank: Demo first level (2019)' });
    await moderation.getByRole('button', { name: 'Remove the entry' }).click();
    await expect(admin.page.getByTestId('passport-remove-form').locator('#passport-remove-reason-error')).toBeVisible();
    await admin.page.getByTestId('passport-remove-form').getByLabel('Reason').fill('Demo moderation test: the entry is not about this person.');
    await admin.page.getByTestId('passport-remove-form').getByRole('button', { name: 'Remove the entry' }).click();
    await expect(admin.page.getByTestId('passport-removed')).toHaveText('The entry was removed. Its owner was told why.');
    await expect(admin.page.getByTestId('passport-current-rank')).not.toContainText('Demo first level');
    await axeBothThemes(admin.page, 'profile passport, staff moderation');
  } finally {
    await admin.context.close();
    await pupil.context.close();
  }
});

test('@M19 a student cannot record; they hide an entry, propose a correction and upload a private certificate a guest cannot open', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const admin = await signedIn(browser, 'admin');
  const teacher = await freshContext(browser);
  try {
    const sifu = await sifuAccount(teacher.page, 'Passport Teacher');
    const student = await publicStudent(page, admin.page, 'Demo Passport Owner');
    await relate(sifu.userId, student.userId);
    const recorded = await apiPost(teacher.page, '/passport/rank/add', { personId: student.person.id, rank: 'Demo first level', date: '2020-03' });
    expect(recorded.status(), await recorded.text()).toBe(200);

    // DEFAULT M19, question 1: the student never records their own.
    const own = await apiPost(page, '/passport/rank/add', { personId: student.person.id, rank: 'Demo master', date: '2020' });
    expect(own.status()).toBe(403);
    expect(((await own.json()) as { message: string }).message).toContain('recorded by your teacher');

    await page.goto('/dashboard/passport');
    await expect(page.getByRole('heading', { level: 1, name: 'Your training passport' })).toBeVisible();
    await axeBothThemes(page, 'own passport');
    const entry = shown(page.getByTestId('own-passport-entry')).first();
    await expect(entry.getByTestId('passport-entry-visibility')).toHaveAttribute('data-visibility', 'public');
    await entry.getByTestId('passport-make-private').click();
    await expect(page.getByTestId('passport-notice')).toHaveText('The entry is private now: only you and your teachers see it.');
    await expect(shown(page.getByTestId('own-passport-entry')).first().getByTestId('passport-entry-visibility')).toHaveAttribute('data-visibility', 'private');
    const visitor = await freshContext(browser);
    try {
      await visitor.page.goto(`/people/${student.person.slug}`);
      await expect(visitor.page.getByText('Demo first level')).toHaveCount(0);
    } finally {
      await visitor.context.close();
    }

    // A correction goes to the teacher; the entry stays as it is.
    await shown(page.getByTestId('own-passport-entry')).first().getByTestId('passport-propose-correction').click();
    const correction = page.getByTestId('passport-correction-form');
    await correction.getByLabel('What should change').fill('The rank was awarded in 2019.');
    await correction.getByRole('button', { name: 'Send the correction' }).click();
    await expect(page.getByTestId('passport-notice')).toHaveText('Your correction was sent to whoever recorded the entry.');
    await expect(shown(page.getByTestId('passport-correction-waiting'))).toContainText('The rank was awarded in 2019.');
    await teacher.page.goto(`/dashboard/students?student=${student.person.id}`);
    await expect(teacher.page.getByTestId('student-correction')).toContainText('The rank was awarded in 2019.');

    // A private certificate (DEFAULT M19, questions 4 and 5): the owner and the teacher see it, a guest gets 404.
    const upload = page.getByTestId('certificate-upload');
    await upload.getByTestId('certificate-input').setInputFiles({ name: 'demo-certificate.png', mimeType: 'image/png', buffer: await demoPng() });
    await upload.getByLabel('Title').fill('Demo course certificate');
    await upload.getByTestId('certificate-submit').click();
    await expect(page.getByTestId('certificate-status')).toHaveText('Certificate added. Only you and your teachers see it.');
    const thumb = shown(page.getByTestId('own-passport-entry')).filter({ hasText: 'Demo course certificate' }).getByRole('img');
    await expect(thumb).toBeVisible();
    const src = (await thumb.getAttribute('src'))!;
    expect(src).toMatch(/^\/api\/certificates\/[0-9a-f-]{36}\/[0-9a-f]{16}\/96\.webp$/);
    const mine = await page.request.get(src);
    expect(mine.status()).toBe(200);
    expect(mine.headers()['cache-control']).toBe('private, no-store');
    expect((await teacher.page.request.get(src)).status()).toBe(200);
    const guest = await freshContext(browser);
    try {
      expect((await guest.page.request.get(src)).status()).toBe(404);
      const profile = await guest.page.request.get(`/people/${student.person.slug}`);
      const html = await profile.text();
      expect(html).not.toContain('Demo course certificate');
      expect(html).not.toContain(src.split('/')[3]!);
    } finally {
      await guest.context.close();
    }
    await axeBothThemes(page, 'own passport with a certificate');
  } finally {
    await admin.context.close();
    await teacher.context.close();
  }
});

async function demoPng(): Promise<Buffer> {
  return Buffer.from(await plainImage('png', 320, 220));
}
