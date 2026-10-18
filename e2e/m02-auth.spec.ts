/**
 * Milestone M02: accounts, roles and consents (Done when 2). The flows run through the real
 * forms against `next start` and the worker; e-mail links come from the mailbox (the outbox
 * delivered by the worker) or, where the test is about something else, from the outbox job.
 * Every account is fictional (`demo-…@example.test`).
 */

import { randomBytes } from 'node:crypto';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { signedSessionToken } from '../src/server/auth/credentials';
import { secretFromTotpUri, totp } from '../src/server/auth/otp';
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
  signInWithPassword,
  submitStaffCode,
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
/**
 * The error message of the visible form: the summary of the fields that need a look, or the form's
 * own message (not Next.js's route announcer, which is also an alert).
 */
const formError = (page: Page) => page.locator('[data-form-message][role="alert"]').filter({ visible: true });
/** What replaced a form after a submit (a done text), by what it says. */
const doneText = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text }).filter({ visible: true });

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
  // The outcome replaces the page's heading and takes the focus.
  const inbox = page.getByRole('heading', { level: 1, name: 'Check your inbox' });
  await expect(inbox).toBeVisible();
  await expect(inbox).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toHaveCount(0);
  await expect(doneText(page, email)).toBeVisible();

  // Signing in before the address is confirmed is refused like a wrong password (no account
  // enumeration) and sends the link again; the message says what to do in either case.
  await signInThroughForm(page, email, NEW_ACCOUNT_PASSWORD);
  await expect(formError(page)).toContainText('Just signed up? Confirm your address first with the link we sent you.');

  // The e-mail went through the outbox and the worker to the mailbox.
  const message = await openMailbox().waitFor(email, { subject: 'Confirm your e-mail address for WingChunRoots', timeoutMs: 20_000 });
  const link = /https?:\/\/\S+\/verify-email\?token=[^\s"<>)]+/.exec(message.text)?.[0];
  expect(link, 'the confirmation link in the e-mail').toBeDefined();
  expect(new URL(link!).origin).toBe(BASE_URL);

  // The link opens a page that asks for a button press (a mail scanner cannot confirm).
  await page.goto(new URL(link!).pathname + new URL(link!).search);
  await page.getByRole('button', { name: 'Confirm my address' }).click();
  await expect(page).toHaveURL(/\/sign-in\?verified=1$/);
  await expect(doneText(page, 'Address confirmed')).toBeVisible();
  // The confirmed address is filled in (from an httpOnly cookie, never the URL); the password is next.
  await expect(field(page, 'E-mail address')).toHaveValue(email);
  await expect(field(page, 'Password', true)).toBeFocused();
  expect(page.url()).not.toContain(encodeURIComponent(email));

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
  await expect(page.getByRole('heading', { level: 1, name: 'Check your inbox' })).toBeFocused();

  const message = await openMailbox().waitFor(account.email, { subject: 'Reset your WingChunRoots password', timeoutMs: 20_000 });
  const link = /https?:\/\/\S+\/reset-password\?token=[^\s"<>)]+/.exec(message.text)?.[0];
  expect(link, 'the reset link in the e-mail').toBeDefined();

  const newPassword = `demo-new-password-${randomBytes(4).toString('hex')}`;
  await page.goto(new URL(link!).pathname + new URL(link!).search);
  await field(page, 'New password').fill(newPassword);
  await page.getByRole('button', { name: 'Save the new password' }).click();
  await expect(page).toHaveURL(/\/sign-in\?reset=1$/);
  await expect(doneText(page, 'Password changed')).toBeVisible();

  // The link works once: the page then says so in its heading and asks for a new link in place.
  await page.goto(new URL(link!).pathname + new URL(link!).search);
  await field(page, 'New password').fill(`${newPassword}-again`);
  await page.getByRole('button', { name: 'Save the new password' }).click();
  const refused = page.getByRole('heading', { level: 1, name: 'This link no longer works' });
  await expect(refused).toBeFocused();
  await expect(page.getByText('expired or was already used')).toBeVisible();
  await expect(field(page, 'New password')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send a new link' })).toBeVisible();
  // The same way back as without JavaScript (screens-6).
  await expect(page.getByRole('link', { name: 'Back to sign-in' }).filter({ visible: true })).toBeVisible();

  // The old password no longer works; the new one does.

  const old = await authPost(page, '/sign-in/email', { email: account.email, password: account.password });
  expect(old.status()).toBe(401);
  await signInThroughForm(page, account.email, newPassword);
  await expect(page).toHaveURL(/\/onboarding$/);
});

/**
 * Fix round 3 (requirements-1): the request scope (src/server/auth/request-scope.ts) must reach the
 * hooks on every path into Better Auth, through the built server. The bundler copies that module
 * into the /api/auth route and into the Server Actions; the one Better Auth instance is created
 * from whichever path asks first, so each test below goes through the other path before the one it
 * checks. Between them the tests cover both orders, whichever request warmed the server.
 */
test.describe('the request scope on both paths', () => {
  /** Ten wrong passwords for `email` from strangers (no cookies, a new client address each): the address is locked. */
  async function strangersLock(request: APIRequestContext, email: string) {
    const wrong = () =>
      request.post('/api/auth/sign-in/email', {
        data: { email, password: 'a password the owner never chose' },
        headers: { origin: BASE_URL, 'x-forwarded-for': clientAddress() },
      });
    for (const response of await Promise.all(Array.from({ length: 10 }, wrong))) expect([401, 429]).toContain(response.status());
    const locked = await wrong();
    expect(locked.status(), 'the address is locked for browsers it does not know').toBe(429);
  }

  /**
   * The e-mails queued for `email` (within the request, so all are there once it answered) and
   * whether its account still has a password. Two taps in the same second send one confirmation
   * e-mail: the same link, so the same idempotency key.
   */
  async function afterTaps(email: string): Promise<{ templates: string[]; password: boolean }> {
    const sent = await getDb().execute<{ template: string }>(sql`
      SELECT template FROM email_delivery WHERE to_email = ${email} ORDER BY created_at`);
    const account = await getDb().execute<{ password: boolean }>(sql`
      SELECT a.credential_hash IS NOT NULL AS password
        FROM auth_user u JOIN auth_account a ON a.user_id = u.id AND a.provider_id = 'credential'
       WHERE u.email = ${email}`);
    return { templates: [...new Set(sent.rows.map((row) => row.template))], password: account.rows[0]?.password === true };
  }

  test('@M02 a reset through the web form makes the browser known: a stranger who locks the address again cannot keep the owner out', async ({ page, request }) => {
    // The HTTP API first (sign-up and confirmation), then the Server Actions.
    const account = await createConfirmedAccount(page, 'scope-web-reset');
    await strangersLock(request, account.email);

    await page.goto('/reset-password');
    await field(page, 'E-mail address').fill(account.email);
    await page.getByRole('button', { name: 'Send the reset link' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Check your inbox' })).toBeVisible();
    const link = new URL(await emailLinkFromOutbox('reset-password', account.email));
    const newPassword = `demo-new-password-${randomBytes(4).toString('hex')}`;
    await page.goto(link.pathname + link.search);
    await field(page, 'New password').fill(newPassword);
    await page.getByRole('button', { name: 'Save the new password' }).click();
    await expect(page).toHaveURL(/\/sign-in\?reset=1$/);
    const cookies = await page.context().cookies();
    expect(cookies.map((cookie) => cookie.name), 'the reset made this browser a known one').toContain('wcr.known_device');

    // The stranger locks the address again; the owner's browser signs in all the same.
    await strangersLock(request, account.email);
    await signInThroughForm(page, account.email, newPassword);
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test('@M02 the same sign-up submitted twice through the web form keeps the password and sends no finish-sign-up e-mail', async ({ page }) => {
    // The HTTP API first (a refused sign-in), then the Server Actions.
    const warm = await authPost(page, '/sign-in/email', { email: uniqueEmail('scope-warm'), password: 'a password nobody has' });
    expect(warm.status()).toBe(401);

    const email = uniqueEmail('scope-web-twice');
    for (let tap = 0; tap < 2; tap += 1) {
      await fillSignUp(page, email, ['age_18_plus', 'terms', 'authenticity_declaration']);
      await expect(page.getByRole('heading', { level: 1, name: 'Check your inbox' })).toBeVisible();
    }
    expect(await afterTaps(email)).toEqual({ templates: ['verify-email'], password: true });

    const link = new URL(await emailLinkFromOutbox('verify-email', email));
    const confirm = await page.request.get(`/api/auth/verify-email?token=${encodeURIComponent(link.searchParams.get('token') ?? '')}`);
    expect(confirm.status(), await confirm.text()).toBe(200);
    await signInThroughForm(page, email, NEW_ACCOUNT_PASSWORD);
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test('@M02 after the Server Actions, an HTTP API reset makes the client known and a double sign-up keeps the password', async ({ page }) => {
    // The Server Actions first (a refused sign-in through the form), then the HTTP API.
    await signInThroughForm(page, uniqueEmail('scope-warm'), 'a password nobody has');
    await expect(formError(page)).toBeVisible();

    const account = await createConfirmedAccount(page, 'scope-api-reset');
    const asked = await authPost(page, '/request-password-reset', { email: account.email, redirectTo: '/reset-password' });
    expect(asked.status(), await asked.text()).toBe(200);
    const token = new URL(await emailLinkFromOutbox('reset-password', account.email)).searchParams.get('token');
    const reset = await authPost(page, '/reset-password', { token, newPassword: `demo-new-password-${randomBytes(4).toString('hex')}` });
    expect(reset.status(), await reset.text()).toBe(200);
    const set = reset.headersArray().filter((header) => header.name.toLowerCase() === 'set-cookie').map((header) => header.value.split('=')[0]);
    expect(set, 'the reset answer makes the client a known one').toContain('wcr.known_device');

    const email = uniqueEmail('scope-api-twice');
    const consents = { terms: true, privacy_ack: false, authenticity_declaration: true, age_18_plus: true };
    for (let tap = 0; tap < 2; tap += 1) {
      const signUp = await authPost(page, '/sign-up/email', { name: '', email, password: NEW_ACCOUNT_PASSWORD, consents }, clientAddress());
      expect(signUp.status(), await signUp.text()).toBe(200);
    }
    expect(await afterTaps(email)).toEqual({ templates: ['verify-email'], password: true });
  });
});

test('@M02 a refused confirmation link says it is not valid or has expired and keeps the way to sign in', async ({ page }) => {
  // With JavaScript the refusal replaces the form in place (screens-6): the same text and footer
  // as the page renders without JavaScript.
  await page.goto('/verify-email?token=demo-not-a-token');
  await page.getByRole('button', { name: 'Confirm my address' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'This link no longer works' })).toBeFocused();
  await expect(page.getByText('This link is not valid or has expired.')).toBeVisible();
  await expect(page.getByText('already used')).toHaveCount(0);
  await expect(page.locator('p', { hasText: 'Already confirmed?' }).filter({ visible: true }).getByRole('link', { name: 'Sign in' })).toBeVisible();
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
  // A summary that counts the answers to fix takes the focus; each line links to its field.
  const summary = formError(page);
  await expect(summary).toContainText('3 answers need a look');
  await expect(summary).toBeFocused();
  const adult = field(page, CONSENT_LABELS.age_18_plus);
  await expect(adult).toHaveAttribute('aria-invalid', 'true');
  await summary.getByRole('link', { name: /^Age: The pilot is open to adults only/ }).click();
  await expect(adult).toBeFocused();
  await expect(page.getByText('The pilot is open to adults only.').filter({ visible: true }).first()).toBeVisible();
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
  await expect(page.getByText('On, but this session has not passed the second factor')).toBeVisible();
  // The API refuses the same session.
  const api = await page.request.get('/api/v1/admin/overview');
  expect(api.status()).toBe(403);
  expect(((await api.json()) as { code?: string }).code).toBe('SECOND_FACTOR_REQUIRED');

  // Passing the second factor in this session opens the page.
  await submitStaffCode(page, 'Verify this session');
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
  // A form of one field shows its message once, on the field.
  await expect(formError(page)).toHaveCount(0);
  await submitStaffCode(page, 'Continue');
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
  const notice = page.getByRole('link', { name: 'Read and confirm' });
  await expect(notice).toHaveCount(0);

  // The terms get a new version: the account's grant is for the old one now.
  await getDb().execute(sql`
    UPDATE consent_record SET document_version = '2000-01-01-demo-old'
     WHERE kind = 'terms' AND user_id = (SELECT id FROM auth_user WHERE email = ${account.email})`);
  await page.goto('/account');
  await expect(notice).toBeVisible();
  // The notice names the document, its date and what changed.
  await expect(page.getByText('There is a new version of the terms of use')).toBeVisible();
  await expect(page.getByText(`Terms of use, draft of ${LEGAL_DOCUMENTS.terms.date}: ${LEGAL_DOCUMENTS.terms.changes}`)).toBeVisible();

  // Signing in again lands on the confirmations.
  await context.clearCookies();
  await signInThroughForm(page, account.email, account.password);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Confirm the terms of use');
  const terms = field(page, CONSENT_LABELS.terms);
  await expect(terms).not.toBeChecked();
  for (const theme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    // A fresh load in each theme, as in the axe test below: colours that are still changing
    // after a theme switch would be measured mid-transition.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Confirm the terms of use');
    await expectNoAxeViolations(page, `/onboarding, documents only (${theme})`);
  }
  await page.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(formError(page)).toBeFocused();
  await expect(terms).toHaveAttribute('aria-invalid', 'true');
  // The account exists: the message asks to accept the new version, not to create an account (screens-3).
  await expect(page.getByText('Accept the updated terms of use to continue.', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('to create an account').filter({ visible: true })).toHaveCount(0);
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
  await expect(formError(page)).toContainText('1 answer needs a look');
  await expect(formError(page)).toBeFocused();
  await expect(primary).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(/Use Latin letters here/).filter({ visible: true }).first()).toBeVisible();
  expect(await personOf(account.email)).toEqual([]);

  await primary.fill('So Chuk-ching');
  await field(page, /^Original script/).selectOption('zh-Hant');
  const original = field(page, 'Name in the original script');
  await expect(original).toHaveAttribute('lang', 'zh-Hant');
  await original.fill('蘇竹晴');
  await field(page, 'Jyutping').fill('sou1 zuk1 cing4');
  await page.getByRole('button', { name: 'Save my profile' }).click();

  await expect(page).toHaveURL(/\/account$/);
  // The other spellings are listed under Profile.
  const chinese = page.locator('main dl [lang="zh-Hant"][translate="no"]', { hasText: '蘇竹晴' }).filter({ visible: true });
  await expect(chinese).toBeVisible();
  // The heading is the name as the register shows it: Latin first, the original beside it.
  const heading = page.locator('h1').filter({ visible: true });
  await expect(heading.locator('[lang="und-Latn"][translate="no"]')).toHaveText('So Chuk-ching');
  await expect(heading.locator('[lang="zh-Hant"][translate="no"]')).toHaveText('蘇竹晴');

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
    /**
     * What a tap can hit, not only the box (fix round 3, screens-9): a hint drawn over the bottom
     * of a checkbox row, or a padded link over the one on the line above, takes the taps there.
     * Down three columns of each target, the height where elementFromPoint finds the target.
     */
    const tapsAtLeast44 = async () => {
      const small = await page.evaluate(() => {
        const found: string[] = [];
        const targets = [...document.querySelectorAll<HTMLElement>('main a[href], main button, main label:has(input[type=checkbox])')];
        for (const el of targets.filter((target) => target.getClientRects().length > 0)) {
          el.scrollIntoView({ block: 'center' });
          // A link that wraps needs one line that takes the tap: the best fragment counts.
          let best = 0;
          for (const rect of el.getClientRects()) {
            let least = Infinity;
            for (const share of [0.25, 0.5, 0.75]) {
              const x = rect.left + rect.width * share;
              let hits = 0;
              for (let y = Math.floor(rect.top) + 0.5; y < rect.bottom; y += 1) {
                const at = document.elementFromPoint(x, y);
                if (at && el.contains(at)) hits += 1;
              }
              least = Math.min(least, hits);
            }
            best = Math.max(best, least);
          }
          if (best < 43) found.push(`${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 30)}" taps ${best}px`);
        }
        window.scrollTo(0, 0);
        return found;
      });
      expect(small).toEqual([]);
    };

    const email = uniqueEmail('phone');
    await page.goto('/sign-up');
    await noHorizontalScroll();
    await targetsAtLeast44();
    await tapsAtLeast44();
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
    await expect(field(page, 'E-mail address')).toHaveValue(email);
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
    const heading = page.locator('h1').filter({ visible: true });
    await expect(heading.locator('[lang="bg-Cyrl"][translate="no"]')).toHaveText('Мира Пробнова');
    await expect(page.locator('main dl [lang="bg-Cyrl"][translate="no"]', { hasText: 'Мира Пробнова' }).filter({ visible: true })).toBeVisible();
    await noHorizontalScroll();
  });

  test('@M02 the tab bar steps aside while the on-screen keyboard is up, and a box under it still takes the press', async ({ page }) => {
    // A webview that resizes for the keyboard would carry the fixed bar up over the form. The
    // keyboard is emulated the way such a webview shows it: the window gets shorter.
    const keyboard = (up: boolean) => page.setViewportSize({ width: 390, height: up ? 844 - 424 : 844 });
    await page.goto('/sign-up');
    const bar = page.locator('[data-tab-bar]');
    const password = field(page, 'Password', true);
    await password.fill(NEW_ACCOUNT_PASSWORD);
    // A focused field without a keyboard (autofocus on load, a hardware keyboard): the bar stays.
    await expect(password).toBeFocused();
    await expect(bar).toBeVisible();

    await keyboard(true);
    await expect(bar).toBeHidden();
    // The focused field is above the keyboard and below the top bar.
    const header = await page.getByRole('banner').boundingBox();
    const box = await password.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 0.5);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844 - 424 + 0.5);

    await keyboard(false);
    await expect(bar).toBeVisible();

    // With the keyboard up, the press on a box where the bar comes back ticks the box.
    await keyboard(true);
    await expect(bar).toBeHidden();
    const privacy = field(page, CONSENT_LABELS.privacy_ack);
    await privacy.check();
    await expect(privacy).toBeChecked();
    // A box with the focus is not a text field: the bar is back.
    await expect(bar).toBeVisible();
  });
});

test('@M02 the password field shows and hides the password; the button says what a press does', async ({ page }) => {
  await page.goto('/sign-up');
  const password = field(page, 'Password', true);
  await password.fill(NEW_ACCOUNT_PASSWORD);
  // A changing label without aria-pressed: "Hide password, toggle button, pressed" said it twice (screens-12).
  const show = page.getByRole('button', { name: 'Show password' }).filter({ visible: true });
  await expect(show).not.toHaveAttribute('aria-pressed');
  await show.click();
  await expect(password).toHaveAttribute('type', 'text');
  const hide = page.getByRole('button', { name: 'Hide password' }).filter({ visible: true });
  await expect(hide).not.toHaveAttribute('aria-pressed');
  await hide.click();
  await expect(password).toHaveAttribute('type', 'password');
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

/** The onboarding answers that a server error must not lose: script, country and city (H2). */
async function fillOnboardingWithBadYear(page: Page) {
  await field(page, 'Name in Latin letters').fill('So Chuk-ching');
  await field(page, /^Original script/).selectOption('zh-Hant');
  await field(page, 'Name in the original script').fill('蘇竹晴');
  await field(page, 'Country').selectOption('HK');
  await field(page, 'City').selectOption({ label: 'Hong Kong' });
  await field(page, 'Year you started Wing Chun').fill('1850');
  await page.getByRole('button', { name: 'Save my profile' }).click();
}

async function expectOnboardingKept(page: Page) {
  await expect(page.getByText('1850 is before 1900.').filter({ visible: true }).first()).toBeVisible();
  await expect(field(page, /^Original script/)).toHaveValue('zh-Hant');
  await expect(field(page, 'Country')).toHaveValue('HK');
  await expect(field(page, 'City').locator('option:checked')).toHaveText('Hong Kong');
  await expect(field(page, 'Name in the original script')).toHaveValue('蘇竹晴');
  await expect(field(page, 'Name in the original script')).toHaveAttribute('lang', 'zh-Hant');
}

async function profileRow(email: string) {
  const rows = await getDb().execute<{ country_code: string | null; place: string | null; training_start_year: number | null }>(sql`
    SELECT p.country_code, pl.name AS place, p.training_start_year
      FROM person p JOIN auth_user u ON u.id = p.claimed_by_user_id LEFT JOIN place pl ON pl.id = p.place_id
     WHERE u.email = ${email}`);
  return rows.rows;
}

test('@M02 onboarding keeps the chosen script, country and city after a server error; City follows Country', async ({ page }) => {
  const account = await signInAs(page, 'new');
  await page.goto('/onboarding');

  // City lists the chosen country's cities; a city picked first sets its country.
  await field(page, 'Country').selectOption('BG');
  await expect(field(page, 'City').locator('option')).toHaveText(['Not given', 'Plovdiv', 'Sofia', 'Varna']);
  await field(page, 'Country').selectOption('');
  await field(page, 'City').selectOption({ label: 'Berlin' });
  await expect(field(page, 'Country')).toHaveValue('DE');

  // The name as the register will show it, while typing.
  await field(page, 'Name in Latin letters').fill('So Chuk-ching');
  const preview = page.locator('figure').filter({ hasText: 'How your name will appear' });
  await expect(preview.locator('[lang="und-Latn"]')).toHaveText('So Chuk-ching');
  // The Chinese readings appear for a Chinese original only.
  await expect(field(page, 'Jyutping')).toHaveCount(0);

  await fillOnboardingWithBadYear(page);
  await expectOnboardingKept(page);
  await expect(preview.locator('[lang="zh-Hant"]')).toHaveText('蘇竹晴');
  await expect(field(page, 'Jyutping')).toBeVisible();

  // Fixing only the year saves everything that was chosen.
  await field(page, 'Year you started Wing Chun').fill('2009');
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await expect(page).toHaveURL(/\/account$/);
  expect(await profileRow(account.email)).toEqual([{ country_code: 'HK', place: 'Hong Kong', training_start_year: 2009 }]);
});

test('@M02 a country chosen before the page is interactive is kept', async ({ page }) => {
  await signInAs(page, 'new');
  // Hold the scripts back (not the styles), choose, then let the page become interactive.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/_next\/static\/chunks\/.*\.js(\?.*)?$/, async (route) => {
    await gate;
    await route.continue();
  });
  // Deferred scripts hold back DOMContentLoaded too: wait for the response only.
  await page.goto('/onboarding', { waitUntil: 'commit' });
  await field(page, 'Country').selectOption('BG');
  release();
  await expect(page.locator('figure').filter({ hasText: 'How your name will appear' })).toBeVisible();
  await expect(field(page, 'Country')).toHaveValue('BG');
  await expect(field(page, 'City').locator('option')).toHaveText(['Not given', 'Plovdiv', 'Sofia', 'Varna']);
});

/** The current code of the otpauth:// link on the security page. */
async function codeOfSetup(page: Page, step: 0 | 1 = 0): Promise<{ uri: string; code: string }> {
  const uri = await page.locator('a[href^="otpauth:"]').first().getAttribute('href');
  expect(uri, 'the otpauth:// link of the pending setup').toBeTruthy();
  return { uri: uri!, code: totp(secretFromTotpUri(uri!), Date.now() + step * 30_000) };
}

const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** No axe violations on the security page as it is now, in both themes (fix round 3, screens-2). */
async function expectSecurityPageClean(page: Page, state: string) {
  for (const theme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expectNoAxeViolations(page, `/account/security, ${state} (${theme})`);
  }
  await page.emulateMedia({ colorScheme: null });
}

/** The heading or notice of the state the security page just arrived in has the focus (screens-1). */
async function expectArrivalFocus(page: Page, target: ReturnType<Page['getByRole']>) {
  await expect(target).toBeVisible();
  await expect(target).toBeFocused();
}

const FIRST_STEP = 'Add WingChunRoots to your authenticator app';

test('@M02 two-factor setup survives a reload and asks to save the backup codes before it is done', async ({ page, browser }, testInfo) => {
  const account = await signInAs(page, 'new');
  await page.goto('/account/security');
  await expect(page.getByRole('heading', { level: 1, name: 'Two-factor authentication' })).toBeVisible();
  await expectSecurityPageClean(page, 'off');
  await field(page, 'Your password').fill(account.password);
  await page.getByRole('button', { name: 'Set up two-factor authentication' }).click();

  // The pending key is rendered by the server: QR code, the key as text with Copy, the app link.
  // The first step's heading (an h2 under the page's h1) takes the focus.
  await expect(page.getByText('Setup not finished')).toBeVisible();
  await expect(page).toHaveURL(/\/account\/security\?setup=[0-9a-z]+$/);
  await expectArrivalFocus(page, page.getByRole('heading', { level: 2, name: FIRST_STEP }));
  await expect(page.getByText('the same key waits here')).toBeVisible();
  await expectSecurityPageClean(page, 'setup');
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy key' })).toBeVisible();
  // "Open in authenticator app" only where a tap can open another app (a coarse pointer): on a
  // desktop the link would do nothing.
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  if (testInfo.project.name === 'desktop-chromium') expect(coarse).toBe(false);
  if (testInfo.project.name === 'mobile-chromium') expect(coarse).toBe(true);
  const openInApp = page.getByRole('link', { name: 'Open in authenticator app' });
  if (coarse) await expect(openInApp).toBeVisible();
  else await expect(openInApp).toBeHidden();
  const key = (await page.locator('code').filter({ visible: true }).innerText()).trim();
  expect(key).toMatch(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/);
  const { uri } = await codeOfSetup(page);
  expect(new URL(uri).searchParams.get('secret')).toBe(key.replace(/ /g, ''));
  await page.reload();
  await expect(page.locator('code').filter({ visible: true })).toHaveText(key);

  // Another browser of the same account is not shown the key: it can only start again.
  const other = await browser.newContext({ baseURL: BASE_URL });
  try {
    await giveOwnAddress(other);
    const otherPage = await other.newPage();
    await signInWithPassword(otherPage, account.email, account.password);
    await otherPage.goto('/account/security');
    await expect(otherPage.getByText('This setup was started in another browser')).toBeVisible();
    await expect(otherPage.locator('a[href^="otpauth:"]')).toHaveCount(0);
    expect(await otherPage.content()).not.toContain(key.replace(/ /g, ''));
    // The notes beside it do not promise the key that this browser is not shown (screens-4).
    await expect(otherPage.getByText('Setup was started but not finished.')).toBeVisible();
    await expect(otherPage.getByText('the same key waits here')).toHaveCount(0);
  } finally {
    await other.close();
  }

  // Start again: a new key, and the first step's heading takes the focus again.
  const setupUrl = page.url();
  const again = page.locator('details').filter({ hasText: 'Start again with a new key' }).filter({ visible: true });
  await again.locator('summary').click();
  await again.getByLabel('Your password').fill(account.password);
  await again.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(setupUrl);
  await expect(page.locator('code').filter({ visible: true })).not.toHaveText(key);
  await expectArrivalFocus(page, page.getByRole('heading', { level: 2, name: FIRST_STEP }));

  // A wrong code: the field says so, and the page stays clean.
  await field(page, '6-digit code').fill('000000');
  await page.getByRole('button', { name: 'Turn on two-factor authentication' }).click();
  await expect(field(page, '6-digit code')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('That code is not right.').filter({ visible: true })).toBeVisible();
  await expectSecurityPageClean(page, 'setup with a wrong code');

  // The first code turns it on; the backup codes come next, with Copy all and Download, and
  // their heading takes the focus.
  await field(page, '6-digit code').fill((await codeOfSetup(page)).code);
  await page.getByRole('button', { name: 'Turn on two-factor authentication' }).click();
  await expect(page).toHaveURL(/\/account\/security\?codes=new$/);
  await expectArrivalFocus(page, page.getByRole('heading', { level: 2, name: 'Save your backup codes' }));
  await expectSecurityPageClean(page, 'backup codes');
  const codes = await page.getByRole('list', { name: 'Backup codes' }).locator('li span.font-mono').allInnerTexts();
  expect(codes).toHaveLength(10);
  for (const code of codes) expect(code).toMatch(CODE_PATTERN);
  // The list fits the window: no sideways scroll on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Copy all codes' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download as a text file' })).toHaveAttribute('download', 'wingchunroots-backup-codes.txt');

  // "Done" needs the tick.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/\?codes=new$/);
  await field(page, 'I have saved these codes somewhere safe.').check();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/\?saved=on$/);
  await expectArrivalFocus(page, doneText(page, 'Backup codes saved'));
  await expect(page.getByText('10 of 10 left')).toBeVisible();
  await expectSecurityPageClean(page, 'on');

  // A backup code signs in once, instead of the app's code.
  await page.context().clearCookies();
  await signInThroughForm(page, account.email, account.password);
  await expect(page).toHaveURL(/\/sign-in\/two-factor$/);
  await expect(page.getByText('Your password was right.')).toBeVisible();
  // The app's code takes what the phone offers; a backup code field must not offer a code from a message.
  await expect(field(page, '6-digit code')).toHaveAttribute('autocomplete', 'one-time-code');
  await page.getByRole('link', { name: 'No phone at hand? Use a backup code' }).click();
  await expect(field(page, 'Backup code')).toHaveAttribute('autocomplete', 'off');
  await field(page, 'Backup code').fill(codes[0]!.toLowerCase());
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto('/account/security');
  await expect(page.getByText('9 of 10 left')).toBeVisible();

  // Turning it off: the notice says so and takes the focus.
  const off = page.locator('details').filter({ hasText: 'Turn off two-factor authentication' }).filter({ visible: true });
  await off.locator('summary').click();
  await off.getByLabel('Your password').fill(account.password);
  await off.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/account\/security\?off=1$/);
  await expectArrivalFocus(page, doneText(page, 'Two-factor authentication turned off'));
});

test('@M02 /sign-in/two-factor tells only a sign-in that waits for its code that the password was right', async ({ page }) => {
  // No sign-in waits in this browser (screens-5).
  for (const path of ['/sign-in/two-factor', '/sign-in/two-factor?method=backup']) {
    await page.goto(path);
    await expect(page.getByText('asks for a code after the password')).toBeVisible();
    await expect(page.getByText('Your password was right')).toHaveCount(0);
  }
});

test('@M02 /admin sends no staff data to anyone but a verified staff session', async ({ page, browser }) => {
  const staffOnly = async (target: Page, who: string) => {
    const html = await (await target.request.get('/admin')).text();
    expect(html, who).not.toContain('Failed e-mail deliveries');
    expect(html, who).not.toContain('failed-email-deliveries');
  };
  await staffOnly(page, 'anonymous');
  await signInAs(page, 'user');
  await staffOnly(page, 'member');

  // A staff session that has not passed the second factor.
  const context = await browser.newContext({ baseURL: BASE_URL });
  try {
    const adminId = await userIdOf('demo-admin@example.test');
    const token = randomBytes(24).toString('base64url');
    await getDb().execute(sql`
      INSERT INTO auth_session (id, user_id, token, expires_at, two_factor_verified_at)
      VALUES (${uuidv7()}, ${adminId}, ${token}, now() + interval '1 hour', NULL)`);
    const value = await signedSessionToken(token, process.env.BETTER_AUTH_SECRET!);
    await context.addCookies([{ name: 'wcr.session_token', value: encodeURIComponent(value), url: BASE_URL, httpOnly: true, sameSite: 'Lax' }]);
    await staffOnly(await context.newPage(), 'staff without the second factor');
  } finally {
    await context.close();
  }
});

test('@M02 every page sends the security headers; link pages send only the origin as referrer', async ({ page }) => {
  const response = await page.request.get('/sign-in');
  const headers = response.headers();
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  // Not no-referrer: with it a form's POST carries `Origin: null`, which Next.js refuses.
  for (const path of ['/reset-password?token=demo-token', '/verify-email?token=demo-token']) {
    await page.goto(path);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'strict-origin');
  }
});

test.describe('without JavaScript', () => {
  // A plain form post (no JavaScript, or a tap before hydration) gets its answer through a
  // redirect to the same page (src/server/forms/flash.ts, finding H5).
  test.use({ javaScriptEnabled: false });

  test('@M02 a wrong password shows the message and keeps the address', async ({ page }) => {
    const email = uniqueEmail('nojs');
    await signInThroughForm(page, email, 'not the right password');
    await expect(page).toHaveURL(/\/sign-in\?outcome=/);
    await expect(formError(page)).toContainText('The e-mail address or the password is not right.');
    await expect(formError(page)).toBeFocused();
    await expect(field(page, 'E-mail address')).toHaveValue(email);
    // The outcome belongs to that one address: the same page opened again starts empty.
    await page.goto('/sign-in');
    await expect(formError(page)).toHaveCount(0);
  });

  test('@M02 sign-up shows the summary and the fields, then the inbox heading', async ({ page }) => {
    await page.goto('/sign-up');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(formError(page)).toContainText('5 answers need a look');
    await expect(field(page, 'E-mail address')).toHaveAttribute('aria-invalid', 'true');
    await expect(field(page, CONSENT_LABELS.terms)).toHaveAttribute('aria-invalid', 'true');

    const email = uniqueEmail('nojs-signup');
    await fillSignUp(page, email, ['age_18_plus', 'terms', 'authenticity_declaration']);
    await expect(page.getByRole('heading', { level: 1, name: 'Check your inbox' })).toBeFocused();
    await expect(doneText(page, email)).toBeVisible();
  });

  test('@M02 a used or broken link says so and offers a new one', async ({ page }) => {
    await page.goto('/reset-password?token=demo-not-a-token');
    await field(page, 'New password').fill(NEW_ACCOUNT_PASSWORD);
    await page.getByRole('button', { name: 'Save the new password' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'This link no longer works' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Send a new link' })).toBeVisible();

    await page.goto('/verify-email?token=demo-not-a-token');
    await page.getByRole('button', { name: 'Confirm my address' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'This link no longer works' })).toBeVisible();
    await expect(page.getByText('This link is not valid or has expired.')).toBeVisible();
    await expect(field(page, 'E-mail address')).toBeVisible();
    await expect(page.getByText('Already confirmed?')).toBeVisible();
  });

  test('@M02 onboarding keeps every answer after a server error', async ({ page }) => {
    await signInAs(page, 'new');
    await page.goto('/onboarding');
    await fillOnboardingWithBadYear(page);
    await expect(page).toHaveURL(/\/onboarding\?outcome=/);
    await expectOnboardingKept(page);
  });

  test('@M02 two-factor setup works without JavaScript', async ({ page }) => {
    const account = await signInAs(page, 'new');
    await page.goto('/account/security');
    await field(page, 'Your password').fill(account.password);
    await page.getByRole('button', { name: 'Set up two-factor authentication' }).click();
    await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
    // Each new state's heading or notice has the focus (autofocus at load, screens-1).
    await expectArrivalFocus(page, page.getByRole('heading', { level: 2, name: FIRST_STEP }));
    await field(page, '6-digit code').fill((await codeOfSetup(page)).code);
    await page.getByRole('button', { name: 'Turn on two-factor authentication' }).click();
    await expectArrivalFocus(page, page.getByRole('heading', { level: 2, name: 'Save your backup codes' }));
    expect(await page.getByRole('list', { name: 'Backup codes' }).locator('li').count()).toBe(10);
    await field(page, 'I have saved these codes somewhere safe.').check();
    await page.getByRole('button', { name: 'Done' }).click();
    await expectArrivalFocus(page, page.getByRole('status').filter({ hasText: 'Backup codes saved' }));
  });
});
