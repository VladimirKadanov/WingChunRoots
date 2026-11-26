/**
 * A Sifu's invite link and the beginner's path (role replay 2026-11-25, P1-3 and P1-6, ADR 0058):
 * the invite page shows the link and its QR code; /join/<slug> names the teacher and leads a new
 * student through sign-up, the e-mail and onboarding to the request form with the teacher chosen
 * (no request is sent here, so the seeded teacher's queue does not change); a link of a profile
 * that is not public says so; "I'm new to Wing Chun" ends onboarding on the school finder; the
 * sign-in page says why it is asked for. Fictional accounts only (`demo-e2e-…@example.test`, D20).
 */

import { expect, test, type Locator } from '@playwright/test';

import { BASE_URL, closeHelpers, emailLinkFromOutbox, giveOwnAddress, loadTestEnv, NEW_ACCOUNT_PASSWORD, signInAs, uniqueEmail } from './helpers/auth';
import { letters } from './helpers/evidence';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

const visible = (locator: Locator) => locator.filter({ visible: true });
const TEACHER = { slug: 'demo-pro-sifu-8', name: 'Lee Wai Sing' };

test('@invite a Sifu finds their invite link and its QR code, from Student requests', async ({ page }) => {
  await signInAs(page, 'demo-pro-sifu-8');
  await page.goto('/dashboard/students/requests');
  await visible(page.getByTestId('invite-students-link')).click();
  await page.waitForURL((u) => u.pathname === '/dashboard/students/invite');
  await expect(visible(page.getByTestId('invite-link-text'))).toHaveValue(`${new URL(BASE_URL).origin}/join/${TEACHER.slug}`);
  await expect(visible(page.getByRole('img', { name: 'QR code of your invite link' }))).toBeVisible();
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `/dashboard/students/invite (${theme})`);
  }
});

test('@invite a Student account is told invite links are for teachers', async ({ page }) => {
  await signInAs(page, 'demo-pending');
  await page.goto('/dashboard/students/invite');
  await expect(visible(page.getByTestId('invite-needs-sifu'))).toBeVisible();
  await expect(page.getByTestId('invite-link')).toHaveCount(0);
});

test('@invite a new student opens the link, signs up, and lands on the request form with the teacher chosen', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/join/${TEACHER.slug}`);
  await expect(visible(page.getByRole('heading', { level: 1 }))).toHaveText(`Join ${TEACHER.name} on WingChunRoots`);
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `/join/<slug> (${theme})`);
  }
  const target = `/dashboard/teachers/new?teacher=${TEACHER.slug}&from=invite`;
  await visible(page.getByTestId('join-sign-up')).click();
  await page.waitForURL((u) => u.pathname === '/sign-up' && u.searchParams.get('next') === target);
  await expect(visible(page.getByText('Then your teacher'))).toBeVisible();
  const email = uniqueEmail('invite-link');
  await visible(page.getByLabel('E-mail address')).fill(email);
  await visible(page.getByLabel('Password', { exact: true })).fill(NEW_ACCOUNT_PASSWORD);
  for (const label of ['I am 18 or older.', 'I accept the terms of use.', /I will record only what I believe to be true/, /I have read the privacy notice\./]) {
    await visible(page.getByLabel(label)).check();
  }
  await visible(page.getByRole('button', { name: 'Create account' })).click();
  await expect(visible(page.getByRole('heading', { level: 1, name: 'Check your inbox' }))).toBeVisible();

  const link = new URL(await emailLinkFromOutbox('verify-email', email));
  expect(link.searchParams.get('next')).toBe(target);
  await page.goto(`${link.pathname}${link.search}`);
  await visible(page.getByRole('button', { name: 'Confirm my address' })).click();
  // The browser that signed up is signed in by the confirmation (ADR 0069). Onboarding first (a teacher confirms a name), then the form with the teacher chosen.
  await page.waitForURL((u) => u.pathname === '/onboarding' && u.searchParams.get('next') === target, { timeout: 15_000 });
  await visible(page.getByLabel(/^Name in Latin letters/)).fill(`Demo Invited ${letters().replace(/^./, (c) => c.toUpperCase())}`);
  await visible(page.getByRole('button', { name: 'Save my profile' })).click();
  await page.waitForURL((u) => u.pathname === '/dashboard/teachers/new' && u.searchParams.get('teacher') === TEACHER.slug, { timeout: 15_000 });
  await expect(visible(page.getByTestId('chosen-teacher'))).toContainText(TEACHER.name);
  // ADR 0073: the request this form sends is marked "From your invite link" for this teacher.
  expect(new URL(page.url()).searchParams.get('from')).toBe('invite');
  await expect(page.locator('form input[name="viaInviteFor"]')).toHaveCount(1);
});

test('@invite the link of a profile that is not public says it does not work', async ({ page }) => {
  await page.goto('/join/demo-pending');
  await expect(visible(page.getByTestId('join-not-found'))).toBeVisible();
  await page.goto('/join/demo-no-such-person-zzqx');
  await expect(visible(page.getByTestId('join-not-found'))).toBeVisible();
});

test("@invite \"I'm new to Wing Chun\" ends onboarding on the school finder; the sign-in page says why it asks", async ({ page, browser }) => {
  const visitor = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(visitor);
  const anon = await visitor.newPage();
  await anon.goto('/sign-in?next=%2Fschools%2Fdemo-sofia-centre%2Ftrial');
  await expect(visible(anon.getByText('to ask this school for a trial lesson'))).toBeVisible();
  await visitor.close();

  await signInAs(page, 'new');
  await page.goto('/onboarding');
  await visible(page.getByLabel(/^Name in Latin letters/)).fill(`Demo Beginner ${letters().replace(/^./, (c) => c.toUpperCase())}`);
  await visible(page.getByLabel('I’m new to Wing Chun')).check();
  await visible(page.getByRole('button', { name: 'Save my profile' })).click();
  await page.waitForURL((u) => u.pathname === '/schools', { timeout: 15_000 });
});

test('@invite a visitor asking a school for a trial lesson signs up, is signed in by the confirmation and gives only a name (ADR 0069)', async ({ page }) => {
  test.setTimeout(120_000);
  const trial = '/schools/demo-school-sofia/trial';
  await page.goto(`/sign-up?next=${encodeURIComponent(trial)}`);
  const email = uniqueEmail('trial-visitor');
  await visible(page.getByLabel('E-mail address')).fill(email);
  await visible(page.getByLabel('Password', { exact: true })).fill(NEW_ACCOUNT_PASSWORD);
  for (const label of ['I am 18 or older.', 'I accept the terms of use.', /I will record only what I believe to be true/, /I have read the privacy notice\./]) {
    await visible(page.getByLabel(label)).check();
  }
  await visible(page.getByRole('button', { name: 'Create account' })).click();
  await expect(visible(page.getByRole('heading', { level: 1, name: 'Check your inbox' }))).toBeVisible();

  // The browser that signed up: the confirmation signs in and asks only the name.
  const link = new URL(await emailLinkFromOutbox('verify-email', email));
  expect(link.searchParams.get('next')).toBe(trial);
  await page.goto(`${link.pathname}${link.search}`);
  await visible(page.getByRole('button', { name: 'Confirm my address' })).click();
  await page.waitForURL((u) => u.pathname === '/onboarding' && u.searchParams.get('next') === trial, { timeout: 15_000 });
  await expect(visible(page.getByRole('heading', { level: 1 }))).toHaveText('One thing first: your name');
  await expect(visible(page.getByTestId('onboarding-short'))).toBeVisible();
  for (const absent of ['Original script', 'Country', 'Show my profile publicly']) await expect(visible(page.getByLabel(absent))).toHaveCount(0);
  await expect(visible(page.getByTestId('organization-only'))).toHaveCount(0);
  await expectNoAxeViolations(page, '/onboarding?next=<trial> (name only)');
  await visible(page.getByLabel(/^Name in Latin letters/)).fill(`Demo Visitor ${letters().replace(/^./, (c) => c.toUpperCase())}`);
  await visible(page.getByRole('button', { name: 'Continue to the request' })).click();
  await page.waitForURL((u) => u.pathname === trial, { timeout: 15_000 });
  await expect(visible(page.getByRole('heading', { level: 1, name: 'Request a trial lesson' }))).toBeVisible();
  await expect(page.getByTestId('trial-refused')).toHaveCount(0);
});
