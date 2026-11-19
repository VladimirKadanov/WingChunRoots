/**
 * The passport extras of Premium Student (docs/adr/0046-passport-extras.md). A new public student on
 * Premium Student asks the organizer of a past seminar (demo-past-seminar-athens, organized by
 * demo-pro-sifu-8) to confirm they attended: it waits, shown only on their own passport page; the
 * organizer confirms it on /dashboard/events/attendance and it joins the public passport. The
 * student puts two photos of their gallery on a rank, which the profile shows, and prints the
 * passport with and without private entries; on paper only the sheet is left. axe runs on the new
 * pages in both themes. Fictional (D20).
 *
 * The student's profile is public, so the spec changes public pages: it runs in the `exclusive`
 * project, in a Playwright run of its own after the others (e2e/projects.ts, PUBLIC_WRITE_SPECS).
 */

import { expect, test, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { uuidv7 } from '../src/server/db/ids';
import { passportRank } from '../src/server/db/schema';
import { plainImage } from '../src/server/storage/test-images';
import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
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

/** A new Student with a public profile on Premium Student (granted by the seeded admin). */
async function premiumStudent(page: Page, admin: Page, name: string) {
  const student = await freshAccount(page);
  const onboard = await apiPost(page, '/account/onboard', { primaryName: name, showPublicly: true });
  expect(onboard.status(), await onboard.text()).toBe(200);
  const given = await apiPost(admin, '/admin/grants/create', { email: student.email, planCode: 'premium_student', source: 'test_grant', reason: 'Demo pilot test of the passport extras' });
  expect(given.status(), await given.text()).toBe(200);
  const rows = await getDb().execute<{ id: string; slug: string }>(sql`SELECT id::text AS id, slug FROM person WHERE claimed_by_user_id = ${student.userId} AND deleted_at IS NULL`);
  return { ...student, person: rows.rows[0]! };
}

async function galleryPhoto(page: Page, side: number) {
  const added = await page.request.post(`${BASE_URL}/api/v1/gallery/add`, {
    multipart: { file: { name: 'demo-photo.png', mimeType: 'image/png', buffer: Buffer.from(await plainImage('png', side, side)) } },
    headers: { origin: BASE_URL },
  });
  expect(added.status(), await added.text()).toBe(200);
}

test('@premium a student asks the organizer to confirm a seminar, puts photos on a rank and prints the passport', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const admin = await signedIn(browser, 'admin');
  const organizer = await signedIn(browser, 'demo-pro-sifu-8');
  try {
    const name = `Demo Extras Pupil ${Math.random().toString(36).slice(2, 7).replace(/\d/g, 'x')}`;
    const student = await premiumStudent(page, admin.page, name);

    // The request: it waits, shown only here.
    await page.goto('/dashboard/passport');
    const section = page.locator('#passport-claims');
    await expect(section.getByRole('heading', { name: 'Add an event you attended' })).toBeVisible();
    const select = section.getByTestId('passport-claim-event');
    const athens = await select.locator('option', { hasText: 'Athens' }).first().getAttribute('value');
    expect(athens).toBeTruthy();
    await select.selectOption(athens!);
    const submit = section.getByTestId('passport-claim-submit');
    expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await submit.click();
    await expect(page.getByTestId('passport-notice')).toHaveText('Your request was sent to the organizer. It shows only here until they confirm it.');
    const waiting = page.getByTestId('own-passport-entry').filter({ has: page.locator('[data-visibility="waiting"]') });
    await expect(waiting).toHaveCount(1);
    await expect(waiting.getByTestId('passport-claim-withdraw')).toBeVisible();
    await axeBothThemes(page, '/dashboard/passport with a waiting request');
    await page.goto(`/people/${student.person.slug}`);
    await expect(page.getByTestId('profile-passport')).not.toContainText('Athens');

    // The organizer confirms it.
    await organizer.page.goto('/dashboard/events');
    await organizer.page.getByTestId('events-attendance-link').click();
    await expect(organizer.page).toHaveURL(/\/dashboard\/events\/attendance$/);
    const claim = organizer.page.getByTestId('attendance-claim').filter({ hasText: name });
    await expect(claim).toHaveCount(1);
    await axeBothThemes(organizer.page, '/dashboard/events/attendance');
    await claim.getByTestId('attendance-confirm').click();
    await expect(organizer.page.getByTestId('attendance-notice')).toHaveText('Confirmed. The event is in the student’s passport now.');
    await expect(organizer.page.getByTestId('attendance-claim').filter({ hasText: name })).toHaveCount(0);

    await page.goto(`/people/${student.person.slug}`);
    await expect(page.getByTestId('profile-passport')).toContainText('Athens');

    // Photos on a rank: a rank of the student (recorded here directly), two gallery photos.
    const rankId = uuidv7();
    await getDb().insert(passportRank).values({ id: rankId, personId: student.person.id, rank: 'Demo extras level', on: '2025-03-01', precision: 'month', visibility: 'public' });
    await galleryPhoto(page, 300);
    await galleryPhoto(page, 320);
    await page.goto('/dashboard/passport');
    const rank = page.locator(`#entry-${rankId}`);
    await rank.getByTestId('passport-rank-photos-link').click();
    const form = page.getByTestId('passport-rank-photos-form');
    await expect(form).toBeVisible();
    const choices = form.getByTestId('passport-rank-photo-choice');
    await expect(choices).toHaveCount(2);
    await choices.nth(0).check();
    await choices.nth(1).check();
    await axeBothThemes(page, '/dashboard/passport choosing rank photos');
    await form.getByRole('button', { name: 'Save photos' }).click();
    await expect(page.getByTestId('passport-notice')).toHaveText('The photos of the rank were saved.');
    await expect(page.locator(`#entry-${rankId}`).getByTestId('rank-photo')).toHaveCount(2);
    await page.goto(`/people/${student.person.slug}`);
    await expect(page.getByTestId('profile-passport').getByTestId('rank-photo')).toHaveCount(2);

    // The print view: public entries by default, private ones on request; on paper only the sheet.
    await getDb().execute(sql`UPDATE passport_rank SET visibility = 'private' WHERE id = ${rankId}::uuid`);
    await page.goto('/dashboard/passport');
    await page.getByTestId('passport-print-link').click();
    await expect(page).toHaveURL(/\/dashboard\/passport\/print$/);
    const sheet = page.getByTestId('passport-print-sheet');
    await expect(sheet).toContainText(name);
    await expect(sheet).toContainText('Athens');
    await expect(sheet.locator('[data-testid="passport-print-entry"][data-visibility="private"]')).toHaveCount(0);
    await page.getByTestId('passport-print-choice').getByRole('link', { name: /Include private entries/ }).click();
    await expect(page).toHaveURL(/\?private=1$/);
    await expect(sheet.locator('[data-testid="passport-print-entry"][data-visibility="private"]')).toHaveCount(1);
    await expect(sheet).toContainText('Private entry: not shown on the profile');
    await expect(page.getByTestId('print-card')).toBeVisible();
    await axeBothThemes(page, '/dashboard/passport/print');
    await page.emulateMedia({ media: 'print' });
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('passport-print-choice')).toBeHidden();
    await expect(page.getByTestId('print-card')).toBeHidden();
  } finally {
    await admin.context.close();
    await organizer.context.close();
  }
});
