/**
 * Milestone M02: accounts, roles and consents (Done when 2). The flows run through the real
 * forms against `next start` and the worker; e-mail links come from the mailbox (the outbox
 * delivered by the worker) or, where the test is about something else, from the outbox job.
 * Every account is fictional (`demo-…@example.test`).
 */

import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { signedSessionToken } from '../src/server/auth/credentials';
import { getDb } from '../src/server/db';
import { uuidv7 } from '../src/server/db/ids';
import { LEGAL_DOCUMENTS } from '../src/server/legal/documents';
import {
  authPost,
  BASE_URL,
  clientAddress,
  closeHelpers,
  createConfirmedAccount,
  emailLinkFromOutbox,
  loadTestEnv,
  NEW_ACCOUNT_PASSWORD,
  signInAs,
  staffTotpCode,
  uniqueEmail,
  giveOwnAddress,
  userIdOf,
} from './helpers/auth';
import { openMailbox } from './helpers/mailbox';
import { expectNoAxeViolations } from './helpers/ui';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  // Rate limits are per client address: each test is its own client.
  await giveOwnAddress(context);
});

/**
 * A field by its label, among the visible ones: Next.js keeps up to three earlier routes in the
 * page, hidden (React Activity), and their forms have the same labels.
 */
const field = (page: Page, label: string | RegExp, exact = false) => page.getByLabel(label, { exact }).filter({ visible: true });
/** The error message of the visible form (not Next.js's route announcer, which is also an alert). */
const formError = (page: Page) => page.locator('[data-form-message][role="alert"]').filter({ visible: true });

const CONSENT_LABELS = {
  age_18_plus: 'I am 18 or older.',
  terms: 'I accept the terms of use.',
  authenticity_declaration: /I will record only what I believe to be true/,
  privacy_ack: /I have read the privacy notice\./,
} as const;

async function fillSignUp(page: Page, email: string, ticks: (keyof typeof CONSENT_LABELS)[]) {
  await page.goto('/sign-up');
  await field(page, 'E-mail address').fill(email);
  await field(page, 'Password', true).fill(NEW_ACCOUNT_PASSWORD);
  for (const tick of ticks) await field(page, CONSENT_LABELS[tick]).check();
  await page.getByRole('button', { name: 'Create account' }).click();
}

async function signInThroughForm(page: Page, email: string, password: string) {
  await page.goto('/sign-in');
  await field(page, 'E-mail address').fill(email);
  await field(page, 'Password', true).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function consentsOf(email: string) {
  const rows = await getDb().execute<{ kind: string; document_version: string; action: string }>(sql`
    SELECT c.kind, c.document_version, c.action
      FROM consent_record c JOIN auth_user u ON u.id = c.user_id
     WHERE u.email = ${email}
     ORDER BY c.kind`);
  return rows.rows;
}

test('@M02 sign up, confirm the email from the outbox and sign in', async ({ page }) => {
  const email = uniqueEmail('signup');
  await fillSignUp(page, email, ['age_18_plus', 'terms', 'authenticity_declaration', 'privacy_ack']);
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(email);

  // Signing in before the address is confirmed is refused (and sends the link again).
  await signInThroughForm(page, email, NEW_ACCOUNT_PASSWORD);
  await expect(formError(page)).toContainText('Confirm your e-mail address first');

  // The e-mail went through the outbox and the worker to the mailbox.
  const message = await openMailbox().waitFor(email, { subject: 'Confirm your e-mail address for WingChunRoots', timeoutMs: 20_000 });
  const link = /https?:\/\/\S+\/verify-email\?token=[^\s"<>)]+/.exec(message.text)?.[0];
  expect(link, 'the confirmation link in the e-mail').toBeDefined();
  expect(new URL(link!).origin).toBe(BASE_URL);

  // The link opens a page that asks for a button press (a mail scanner cannot confirm).
  await page.goto(new URL(link!).pathname + new URL(link!).search);
  await page.getByRole('button', { name: 'Confirm my address' }).click();
  await expect(page).toHaveURL(/\/sign-in\?verified=1$/);
  await expect(page.getByRole('status')).toContainText('Your e-mail address is confirmed');

  await field(page, 'E-mail address').fill(email);
  await field(page, 'Password', true).fill(NEW_ACCOUNT_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // A new account has no profile yet: onboarding comes first.
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Set up your profile' })).toBeVisible();
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === 'wcr.session_token');
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');
});

test('@M02 password reset through the emailed link', async ({ page }) => {
  const account = await createConfirmedAccount(page, 'reset');
  await page.goto('/reset-password');
  await field(page, 'E-mail address').fill(account.email);
  await page.getByRole('button', { name: 'Send the reset link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

  const message = await openMailbox().waitFor(account.email, { subject: 'Reset your WingChunRoots password', timeoutMs: 20_000 });
  const link = /https?:\/\/\S+\/reset-password\?token=[^\s"<>)]+/.exec(message.text)?.[0];
  expect(link, 'the reset link in the e-mail').toBeDefined();

  const newPassword = `demo-new-password-${randomBytes(4).toString('hex')}`;
  await page.goto(new URL(link!).pathname + new URL(link!).search);
  await field(page, 'New password').fill(newPassword);
  await page.getByRole('button', { name: 'Save the new password' }).click();
  await expect(page).toHaveURL(/\/sign-in\?reset=1$/);
  await expect(page.getByRole('status')).toContainText('Your password is changed');

  // The link works once; the old password no longer does; the new one does.
  await page.goto(new URL(link!).pathname + new URL(link!).search);
  await field(page, 'New password').fill(`${newPassword}-again`);
  await page.getByRole('button', { name: 'Save the new password' }).click();
  await expect(formError(page)).toContainText('expired or was already used');

  const old = await authPost(page, '/sign-in/email', { email: account.email, password: account.password });
  expect(old.status()).toBe(401);
  await signInThroughForm(page, account.email, newPassword);
  await expect(page).toHaveURL(/\/onboarding$/);
});

test('@M02 a signed-in visitor asking for a new confirmation link gets the same neutral answer', async ({ page }) => {
  // The form acts for any address, not for the signed-in account (no EMAIL_MISMATCH, no
  // EMAIL_ALREADY_VERIFIED, no generic error).
  await signInAs(page, 'user');
  await page.goto('/verify-email');
  await field(page, 'E-mail address').fill(uniqueEmail('resend'));
  await page.getByRole('button', { name: 'Send a new link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
  await expect(formError(page)).toHaveCount(0);
});

test('@M02 consent and adult checkboxes start unticked and are stored with the document version', async ({ page }) => {
  await page.goto('/sign-up');
  for (const label of Object.values(CONSENT_LABELS)) {
    await expect(field(page, label)).not.toBeChecked();
  }
  // No birth date is asked (DEFAULT D16).
  await expect(field(page, /birth|date of birth/i)).toHaveCount(0);

  const email = uniqueEmail('consents');
  await fillSignUp(page, email, ['age_18_plus', 'terms', 'authenticity_declaration', 'privacy_ack']);
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

  const version = (kind: keyof typeof CONSENT_LABELS) =>
    kind === 'privacy_ack' ? LEGAL_DOCUMENTS.privacy.version : LEGAL_DOCUMENTS.terms.version;
  expect(await consentsOf(email)).toEqual(
    (['age_18_plus', 'authenticity_declaration', 'privacy_ack', 'terms'] as const).map((kind) => ({
      kind,
      document_version: version(kind),
      action: 'granted',
    })),
  );

  // The optional privacy acknowledgement is recorded only when ticked.
  const second = uniqueEmail('consents-optional');
  await fillSignUp(page, second, ['age_18_plus', 'terms', 'authenticity_declaration']);
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
  expect((await consentsOf(second)).map((row) => row.kind)).toEqual(['age_18_plus', 'authenticity_declaration', 'terms']);
});

test('@M02 sign-up is refused unless "I am 18 or older", terms and the authenticity declaration are ticked', async ({ page }) => {
  // The form: every missing required tick gets its own message, and the focus moves to the first.
  const email = uniqueEmail('refused');
  await fillSignUp(page, email, ['privacy_ack']);
  await expect(formError(page)).toContainText('Check the highlighted fields');
  const adult = field(page, CONSENT_LABELS.age_18_plus);
  await expect(adult).toHaveAttribute('aria-invalid', 'true');
  await expect(adult).toBeFocused();
  await expect(page.getByText('The pilot is open to adults only.')).toBeVisible();
  await expect(field(page, CONSENT_LABELS.terms)).toHaveAttribute('aria-invalid', 'true');
  await expect(field(page, CONSENT_LABELS.authenticity_declaration)).toHaveAttribute('aria-invalid', 'true');
  // The ticked box and the address stay as they were.
  await expect(field(page, CONSENT_LABELS.privacy_ack)).toBeChecked();
  await expect(field(page, 'E-mail address')).toHaveValue(email);

  // The API refuses each combination without one of the three, whatever the client.
  const all = { terms: true, privacy_ack: true, authenticity_declaration: true, age_18_plus: true };
  for (const missing of ['age_18_plus', 'terms', 'authenticity_declaration'] as const) {
    const response = await authPost(
      page,
      '/sign-up/email',
      { name: '', email, password: NEW_ACCOUNT_PASSWORD, consents: { ...all, [missing]: false } },
      clientAddress(),
    );
    expect(response.status(), missing).toBe(400);
    expect(((await response.json()) as { code?: string }).code).toBe('CONSENT_REQUIRED');
  }
  const none = await authPost(page, '/sign-up/email', { name: '', email, password: NEW_ACCOUNT_PASSWORD }, clientAddress());
  expect(none.status()).toBe(400);
  expect(await userIdOf(email)).toBeNull();
  expect(await consentsOf(email)).toEqual([]);
});

test('@M02 role cannot be set through the sign-up request', async ({ page }) => {
  const email = uniqueEmail('role');
  const response = await authPost(page, '/sign-up/email', {
    name: '',
    email,
    password: NEW_ACCOUNT_PASSWORD,
    role: 'admin',
    consents: { terms: true, privacy_ack: true, authenticity_declaration: true, age_18_plus: true },
  });
  expect(response.status()).toBe(400);
  expect(await userIdOf(email)).toBeNull();

  // Without the field the same request creates an ordinary member.
  const plain = await authPost(page, '/sign-up/email', {
    name: '',
    email,
    password: NEW_ACCOUNT_PASSWORD,
    consents: { terms: true, privacy_ack: true, authenticity_declaration: true, age_18_plus: true },
  });
  expect(plain.status()).toBe(200);
  const rows = await getDb().execute<{ role: string; two_factor_enabled: boolean }>(
    sql`SELECT role, two_factor_enabled FROM auth_user WHERE email = ${email}`,
  );
  expect(rows.rows).toEqual([{ role: 'user', two_factor_enabled: false }]);
});

test('@M02 a staff session without a verified second factor is redirected from /admin to /account/security', async ({ page, context }) => {
  // A session of the seeded admin that never passed the second factor (sessions created outside
  // the sign-in form; the sign-in form itself always asks for the code).
  const adminId = await userIdOf('demo-admin@example.test');
  expect(adminId, 'the seeded demo-admin account (pnpm db:seed)').not.toBeNull();
  const token = randomBytes(24).toString('base64url');
  await getDb().execute(sql`
    INSERT INTO auth_session (id, user_id, token, expires_at, two_factor_verified_at)
    VALUES (${uuidv7()}, ${adminId}, ${token}, now() + interval '1 hour', NULL)`);
  const value = await signedSessionToken(token, process.env.BETTER_AUTH_SECRET!);
  await context.addCookies([{ name: 'wcr.session_token', value: encodeURIComponent(value), url: BASE_URL, httpOnly: true, sameSite: 'Lax' }]);

  const response = await page.goto('/admin');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/account\/security\?next=%2Fadmin$/);
  await expect(page.getByText('this session has not passed the second factor yet')).toBeVisible();
  // The API refuses the same session.
  const api = await page.request.get('/api/v1/admin/overview');
  expect(api.status()).toBe(403);
  expect(((await api.json()) as { code?: string }).code).toBe('SECOND_FACTOR_REQUIRED');

  // Passing the second factor in this session opens the page.
  await field(page, '6-digit code').fill(await staffTotpCode());
  await page.getByRole('button', { name: 'Verify this session' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Administration' })).toBeVisible();
});

test('@M02 a seeded staff account signs in with the test TOTP and opens /admin', async ({ page }) => {
  await signInThroughForm(page, 'demo-admin@example.test', process.env.E2E_PASSWORD!);
  await expect(page).toHaveURL(/\/sign-in\/two-factor$/);
  // A wrong code is refused with a message on the field.
  await field(page, '6-digit code').fill('000000');
  await page.getByRole('button', { name: 'Continue' }).click();
  const code = field(page, '6-digit code');
  await expect(code).toHaveAttribute('aria-invalid', 'true');
  await expect(code).toBeFocused();
  await code.fill(await staffTotpCode());
  await page.getByRole('button', { name: 'Continue' }).click();
  // demo-admin has no profile of its own, so the account's first stop is onboarding.
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Administration' })).toBeVisible();
  await expect(page.getByText('Failed e-mail deliveries')).toBeVisible();
  await expect(page.getByTestId('failed-email-deliveries')).toHaveText(/^\d+$/);

  // The other staff roles sign in the same way; an ordinary member is not let in.
  const archivist = await page.context().browser()!.newContext({ baseURL: BASE_URL });
  try {
    const other = await archivist.newPage();
    await giveOwnAddress(archivist);
    await signInAs(other, 'archivist');
    await other.goto('/admin');
    await expect(other.getByRole('heading', { level: 1, name: 'Administration' })).toBeVisible();
  } finally {
    await archivist.close();
  }
  const member = await page.context().browser()!.newContext({ baseURL: BASE_URL });
  try {
    const other = await member.newPage();
    await giveOwnAddress(member);
    await signInAs(other, 'user');
    await other.goto('/admin');
    await expect(other.getByRole('heading', { level: 1, name: 'Not available' })).toBeVisible();
  } finally {
    await member.close();
  }
});

async function personOf(email: string) {
  const rows = await getDb().execute<{ id: string; stewardship: string; visibility: string; claimed_by_user_id: string }>(sql`
    SELECT p.id, p.stewardship, p.visibility, p.claimed_by_user_id
      FROM person p JOIN auth_user u ON u.id = p.claimed_by_user_id
     WHERE u.email = ${email}`);
  return rows.rows;
}

test('@M02 onboarding creates a person linked to the account', async ({ page }) => {
  const account = await signInAs(page, 'new');
  await page.goto('/onboarding');
  const publicly = field(page, 'Show my profile publicly');
  await expect(publicly).not.toBeChecked();
  await field(page, 'Name in Latin letters').fill('Demo Newcomer');
  await field(page, 'Country').selectOption({ label: 'Bulgaria' });
  await field(page, 'Year you started Wing Chun').fill('2015');
  await page.getByRole('button', { name: 'Save my profile' }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo Newcomer');
  await expect(page.getByText('Private.')).toBeVisible();

  const userId = await userIdOf(account.email);
  const people = await personOf(account.email);
  expect(people).toHaveLength(1);
  expect(people[0]).toMatchObject({ stewardship: 'self', visibility: 'involved_only', claimed_by_user_id: userId });

  // A second visit goes to the account page; the API refuses a second profile.
  await page.goto('/onboarding');
  await expect(page).toHaveURL(/\/account$/);
  const again = await page.request.post('/api/v1/account/onboard', {
    data: { primaryName: 'Demo Twice' },
    headers: { origin: BASE_URL },
  });
  expect(again.status()).toBe(409);
});

test('@M02 an account with a profile is asked again for a new version of the documents', async ({ page, context }) => {
  const account = await signInAs(page, 'new');
  await page.goto('/onboarding');
  await field(page, 'Name in Latin letters').fill('Demo Returning');
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await expect(page).toHaveURL(/\/account$/);
  const notice = page.getByRole('link', { name: 'Confirm the updated documents' });
  await expect(notice).toHaveCount(0);

  // The terms get a new version: the account's grant is for the old one now.
  await getDb().execute(sql`
    UPDATE consent_record SET document_version = '2000-01-01-demo-old'
     WHERE kind = 'terms' AND user_id = (SELECT id FROM auth_user WHERE email = ${account.email})`);
  await page.goto('/account');
  await expect(notice).toBeVisible();

  // Signing in again lands on the confirmations.
  await context.clearCookies();
  await signInThroughForm(page, account.email, account.password);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Confirm the updated documents');
  const terms = field(page, CONSENT_LABELS.terms);
  await expect(terms).not.toBeChecked();
  for (const theme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expectNoAxeViolations(page, `/onboarding, documents only (${theme})`);
  }
  await page.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(formError(page)).toBeVisible();
  await expect(terms).toBeFocused();
  await expectNoAxeViolations(page, '/onboarding, documents only, with errors');
  await terms.check();
  await page.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(notice).toHaveCount(0);

  const versions = (await consentsOf(account.email)).filter((row) => row.kind === 'terms').map((row) => row.document_version);
  expect(versions).toContain(LEGAL_DOCUMENTS.terms.version);
  // The profile is unchanged: still one person.
  expect(await personOf(account.email)).toHaveLength(1);
});

test('@M02 onboarding requires a Latin-script primary name and stores an optional Chinese name with its lang', async ({ page }) => {
  const account = await signInAs(page, 'new');
  await page.goto('/onboarding');

  const primary = field(page, 'Name in Latin letters');
  await primary.fill('蘇竹晴');
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await expect(formError(page)).toContainText('Check the highlighted fields');
  await expect(primary).toHaveAttribute('aria-invalid', 'true');
  await expect(primary).toBeFocused();
  await expect(page.getByText(/Use Latin letters here/)).toBeVisible();
  expect(await personOf(account.email)).toEqual([]);

  await primary.fill('So Chuk-ching');
  await field(page, /^Original script/).selectOption('zh-Hant');
  const original = field(page, 'Name in the original script');
  await expect(original).toHaveAttribute('lang', 'zh-Hant');
  await original.fill('蘇竹晴');
  await field(page, 'Jyutping').fill('sou1 zuk1 cing4');
  await page.getByRole('button', { name: 'Save my profile' }).click();

  await expect(page).toHaveURL(/\/account$/);
  const chinese = page.locator('[lang="zh-Hant"][translate="no"]', { hasText: '蘇竹晴' }).filter({ visible: true });
  await expect(chinese).toBeVisible();
  await expect(page.locator('h1 [translate="no"]').filter({ visible: true })).toHaveText('So Chuk-ching');

  const rows = await getDb().execute<{ value: string; lang: string; script: string; is_primary: boolean }>(sql`
    SELECT n.value, n.lang, n.script, n.is_primary
      FROM person_name n JOIN person p ON p.id = n.person_id JOIN auth_user u ON u.id = p.claimed_by_user_id
     WHERE u.email = ${account.email}
     ORDER BY n.sort_order`);
  expect(rows.rows).toEqual([
    { value: 'So Chuk-ching', lang: 'und-Latn', script: 'Latn', is_primary: true },
    { value: '蘇竹晴', lang: 'zh-Hant', script: 'Hant', is_primary: false },
    { value: 'sou1 zuk1 cing4', lang: 'yue-Latn', script: 'Latn', is_primary: false },
  ]);
});

test.describe('at 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('@M02 sign-up and onboarding complete at 390x844', async ({ page }) => {
    const noHorizontalScroll = async () =>
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const targetsAtLeast44 = async () => {
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('main button, main input:not([type=hidden]), main select, main label:has(input[type=checkbox])')]
          .map((el) => ({ el, box: el.getBoundingClientRect() }))
          .filter(({ box, el }) => box.width > 0 && box.height > 0 && !(el instanceof HTMLInputElement && el.type === 'checkbox'))
          .filter(({ box }) => box.height < 44 || box.width < 44)
          .map(({ el, box }) => `${el.tagName.toLowerCase()} ${Math.round(box.width)}x${Math.round(box.height)}`),
      );
      expect(small).toEqual([]);
    };

    const email = uniqueEmail('phone');
    await page.goto('/sign-up');
    await noHorizontalScroll();
    await targetsAtLeast44();
    await field(page, 'E-mail address').fill(email);
    await field(page, 'Password', true).fill(NEW_ACCOUNT_PASSWORD);
    for (const label of [CONSENT_LABELS.age_18_plus, CONSENT_LABELS.terms, CONSENT_LABELS.authenticity_declaration]) {
      // The whole row is the touch target.
      await page.locator('label', { hasText: label }).filter({ visible: true }).tap();
      await expect(field(page, label)).toBeChecked();
    }
    await page.getByRole('button', { name: 'Create account' }).tap();
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

    const link = new URL(await emailLinkFromOutbox('verify-email', email));
    await page.goto(link.pathname + link.search);
    await page.getByRole('button', { name: 'Confirm my address' }).tap();
    await expect(page).toHaveURL(/\/sign-in\?verified=1$/);
    await noHorizontalScroll();
    await field(page, 'E-mail address').fill(email);
    await field(page, 'Password', true).fill(NEW_ACCOUNT_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).tap();

    await expect(page).toHaveURL(/\/onboarding$/);
    await noHorizontalScroll();
    await targetsAtLeast44();
    await field(page, 'Name in Latin letters').fill('Mira Probnova');
    await field(page, /^Original script/).selectOption('bg-Cyrl');
    await field(page, 'Name in the original script').fill('Мира Пробнова');
    await page.getByRole('button', { name: 'Save my profile' }).tap();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.locator('[lang="bg-Cyrl"][translate="no"]', { hasText: 'Мира Пробнова' }).filter({ visible: true })).toBeVisible();
    await noHorizontalScroll();
  });
});

test('@M02 no axe violations on sign-up, sign-in and onboarding', async ({ page }) => {
  for (const theme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/sign-up');
    await expectNoAxeViolations(page, `/sign-up (${theme})`);
    // With the server-side errors shown.
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(formError(page)).toBeVisible();
    await expectNoAxeViolations(page, `/sign-up with errors (${theme})`);

    await page.goto('/sign-in');
    await expectNoAxeViolations(page, `/sign-in (${theme})`);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(formError(page)).toBeVisible();
    await expectNoAxeViolations(page, `/sign-in with errors (${theme})`);
  }

  await signInAs(page, 'new');
  for (const theme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/onboarding');
    await expectNoAxeViolations(page, `/onboarding (${theme})`);
    await page.getByRole('button', { name: 'Save my profile' }).click();
    await expect(formError(page)).toBeVisible();
    await expectNoAxeViolations(page, `/onboarding with errors (${theme})`);
  }
});
