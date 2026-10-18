/**
 * Milestone M08: plans, test plans and dashboards (Done when 3). The flows run through the real
 * pages against `next start`; the database is read to check what the pages cannot show (audit
 * rows, notifications to the administrators, that nothing was charged). Tests that change data
 * use accounts they create themselves (`demo-e2e-…@example.test`, fictional, D20); the seeded
 * demo accounts are only read, so the visual regression of their dashboards stays stable.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { findFomo } from '../src/lib/copy/no-fomo';
import { signedSessionToken } from '../src/server/auth/credentials';
import { getDb } from '../src/server/db';
import { uuidv7 } from '../src/server/db/ids';
import { notification } from '../src/server/db/schema';
import { FEATURES, formatPrice, PLANS, upgradeBenefits } from '../src/server/entitlements/plans';
import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv, signInAs, userIdOf, type SignInTarget } from './helpers/auth';
import { apiPost, freshAccount, giveStudents } from './helpers/plans';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  // Rate limits are per client address: each test is its own client.
  await giveOwnAddress(context);
});

const PROPOSED_PRICE = 'Proposed price (not final)';
const PLANNED = 'Planned — not available yet';
const BANNER = 'Proposed prices — not final. Payments are not available during the pilot.';

/** A field by its label, among the visible ones (Next.js keeps earlier routes in the page, hidden). */
const field = (scope: Page | Locator, label: string | RegExp, exact = false) => scope.getByLabel(label, { exact }).filter({ visible: true });
/** What a form says after its submit (a done text). */
const doneText = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text }).filter({ visible: true });

/** Another browser context signed in as `target`, with its own client address. */
async function signedInContext(browser: Browser, target: SignInTarget) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(context);
  const page = await context.newPage();
  await signInAs(page, target);
  return { context, page };
}

/** The audit rows of `action` about `subjectId`. */
async function auditRows(action: string, subjectId: string) {
  const rows = await getDb().execute<{ actor_user_id: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; reason: string | null }>(sql`
    SELECT actor_user_id, before, after, reason FROM audit_log WHERE action = ${action} AND subject_id = ${subjectId} ORDER BY occurred_at`);
  return rows.rows;
}

/** No horizontal scroll at the current viewport. */
async function expectNoHorizontalScroll(page: Page, label: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label}: no horizontal scroll`).toBe(true);
}

/** A session of the seeded admin that never passed the second factor (as in e2e/m02-auth.spec.ts). */
async function adminSessionWithoutSecondFactor(browser: Browser) {
  const adminId = await userIdOf('demo-admin@example.test');
  expect(adminId, 'the seeded demo-admin account (pnpm db:seed)').not.toBeNull();
  const token = randomBytes(24).toString('base64url');
  await getDb().execute(sql`
    INSERT INTO auth_session (id, user_id, token, expires_at, two_factor_verified_at)
    VALUES (${uuidv7()}, ${adminId}, ${token}, now() + interval '1 hour', NULL)`);
  const value = await signedSessionToken(token, process.env.BETTER_AUTH_SECRET!);
  const context = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(context);
  await context.addCookies([{ name: 'wcr.session_token', value: encodeURIComponent(value), url: BASE_URL, httpOnly: true, sameSite: 'Lax' }]);
  return context;
}

const proSifuPrice = formatPrice(PLANS.pro_sifu.price!);

test('@M08 admin grants a Pro Sifu test plan with a reason; the grant and an audit row appear', async ({ page, browser }) => {
  const sifu = await freshAccount(page, { name: 'Demo Granted Sifu', sifu: true });
  const adminId = await userIdOf('demo-admin@example.test');
  const admin = await signedInContext(browser, 'admin');
  const reason = `Demo pilot test of Professional Sifu (${randomUUID().slice(0, 8)})`;
  const endsOn = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  try {
    const a = admin.page;
    await a.goto('/admin/grants');
    await expect(a.getByRole('heading', { level: 1, name: 'Plan grants' })).toBeVisible();
    const form = a.locator('#give-plan');
    await field(form, 'Account e-mail').fill(sifu.email);
    await field(form, 'Plan', true).selectOption('pro_sifu');
    await expect(field(form, 'Kind', true)).toHaveValue('test_grant');
    await field(form, 'Reason', true).fill(reason);
    await expect(field(form, 'Starts', true)).toHaveValue(new Date().toISOString().slice(0, 10));
    await field(form, /^Ends/).fill(endsOn);
    await form.getByRole('button', { name: 'Give the plan' }).click();
    await expect(doneText(a, `Professional Sifu given to ${sifu.email} from`)).toBeVisible();

    // The grant appears in the table, found by its account.
    await field(a, 'Find by e-mail').fill(sifu.email);
    await a.getByRole('button', { name: 'Search' }).click();
    await expect(a).toHaveURL(/\/admin\/grants\?q=/);
    const row = a.getByTestId('grant-row').filter({ hasText: sifu.email });
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('data-state', 'active');
    await expect(row).toContainText('Professional Sifu');
    await expect(row).toContainText('Test plan');
    await expect(row).toContainText(reason);
    await expect(row).toContainText('Active');

    // One grant and one audit row grant.create with the reason, the admin as actor, no payment.
    const grants = await getDb().execute<{ id: string; plan_code: string; source: string; reason: string; granted_by_user_id: string }>(sql`
      SELECT id, plan_code, source, reason, granted_by_user_id FROM entitlement_grant WHERE subject_user_id = ${sifu.userId}`);
    expect(grants.rows).toHaveLength(1);
    expect(grants.rows[0]).toMatchObject({ plan_code: 'pro_sifu', source: 'test_grant', reason, granted_by_user_id: adminId });
    const audit = await auditRows('grant.create', grants.rows[0]!.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_user_id: adminId, reason });
    expect(audit[0]!.after).toMatchObject({ userId: sifu.userId, planCode: 'pro_sifu', source: 'test_grant' });
    expect(String(audit[0]!.after?.endsAt)).toContain(endsOn);

    // The account has the plan now.
    await page.goto('/dashboard');
    await expect(page.getByTestId('plan-name')).toContainText('Professional Sifu');
    await expect(page.getByTestId('student-allowance')).toHaveText('Students: 0 approved, no limit on Professional Sifu');

    // Revoking it, with a reason, is audited too, and the account is back on Free Sifu.
    await row.locator('summary').click();
    await field(row, 'Reason for revoking').fill('Demo pilot test finished');
    await row.getByRole('button', { name: `Revoke Professional Sifu of ${sifu.email}` }).click();
    await expect(doneText(a, `Professional Sifu of ${sifu.email} revoked. Confirmed links stay confirmed.`)).toBeVisible();
    await expect(a.getByTestId('grant-row').filter({ hasText: sifu.email })).toHaveAttribute('data-state', 'revoked');
    const revoked = await auditRows('grant.revoke', grants.rows[0]!.id);
    expect(revoked).toHaveLength(1);
    expect(revoked[0]).toMatchObject({ actor_user_id: adminId, reason: 'Demo pilot test finished' });
    await page.reload();
    await expect(page.getByTestId('plan-name')).toHaveText('Free Sifu');
  } finally {
    await admin.context.close();
  }
});

test('@M08 a non-admin and a staff session without a verified second factor cannot open /admin/grants', async ({ page, browser }) => {
  const noGrantData = async (target: Page, who: string) => {
    const html = await (await target.request.get('/admin/grants')).text();
    expect(html, who).not.toContain('grants-table');
    expect(html, who).not.toContain('demo-pro-sifu-8@example.test');
    expect(html, who).not.toContain('Give a test plan');
    const api = await target.request.get('/api/v1/admin/grants');
    expect(api.status(), `${who}: the API`).toBe(403);
    return ((await api.json()) as { code?: string }).code;
  };

  // A member: told plainly, and the API refuses.
  await signInAs(page, 'user');
  await page.goto('/admin/grants');
  await expect(page.getByRole('heading', { level: 1, name: 'Not available' })).toBeVisible();
  await expect(page.getByText("You don't have access to plan grants. They are available to administrators.")).toBeVisible();
  expect(await noGrantData(page, 'member')).toBe('FORBIDDEN');

  // Staff that is not an administrator, even with the second factor.
  const archivist = await signedInContext(browser, 'archivist');
  try {
    await archivist.page.goto('/admin/grants');
    await expect(archivist.page.getByRole('heading', { level: 1, name: 'Not available' })).toBeVisible();
    expect(await noGrantData(archivist.page, 'archivist')).toBe('FORBIDDEN');
  } finally {
    await archivist.context.close();
  }

  // The administrator, in a session that has not passed the second factor: sent to verify it.
  const unverified = await adminSessionWithoutSecondFactor(browser);
  try {
    const other = await unverified.newPage();
    expect(await noGrantData(other, 'admin without the second factor')).toBe('SECOND_FACTOR_REQUIRED');
    await other.goto('/admin/grants');
    await expect(other).toHaveURL(/\/account\/security\?next=%2Fadmin%2Fgrants$/);
    await expect(other.getByRole('heading', { level: 1, name: 'Plan grants' })).toHaveCount(0);
  } finally {
    await unverified.close();
  }
});

test('@M08 the upgrade prompt shows the current allowance, real benefits, a "Proposed price (not final)" label and an equally prominent "Not now"', async ({ page }) => {
  // demo-free-sifu-5: Free Sifu with 5 of 5 approved students and one request waiting.
  await signInAs(page, 'demo-free-sifu-5');
  await page.goto('/dashboard');
  const prompt = page.getByTestId('upgrade-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole('heading', { level: 2 })).toHaveText('More students with Professional Sifu');
  await expect(prompt.getByTestId('upgrade-allowance')).toHaveText('You have approved 5 of 5 students on Free Sifu.');
  await expect(prompt).toContainText('One student request waits below. It stays pending and visible until you can approve it.');
  await expect(page.getByTestId('student-allowance')).toHaveText('Students: 5 of 5 approved on Free Sifu');
  // The waiting request stays listed below the prompt.
  await expect(page.getByTestId('student-requests').getByRole('listitem')).toHaveCount(1);

  // Real benefits: what Professional Sifu gives over Free Sifu in this release.
  const benefits = prompt.getByTestId('upgrade-benefits').getByRole('listitem');
  await expect(benefits.first()).toContainText('Approve students: No limit');
  await expect(benefits).toHaveCount(upgradeBenefits('free_sifu', 'pro_sifu').length);

  // The working price with its label; the pilot takes no payments.
  const price = prompt.getByTestId('upgrade-price');
  await expect(price).toContainText(proSifuPrice);
  await expect(price).toContainText(PROPOSED_PRICE);
  await expect(prompt).toContainText('There are no payments during the pilot.');

  // "Request pilot access" and "Not now": the same kind of control, the same size and weight.
  const request = prompt.getByTestId('request-pilot-access');
  const notNow = prompt.getByTestId('upgrade-not-now');
  await expect(request).toBeVisible();
  await expect(notNow).toBeVisible();
  await expect(notNow).toHaveText('Not now');
  const look = (control: Locator) =>
    control.evaluate((el) => {
      const s = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        look: [s.fontSize, s.fontWeight, s.fontFamily, s.color, s.backgroundColor, s.borderTopWidth, s.borderTopStyle, s.borderTopColor, s.borderRadius, s.textDecorationLine].join(' | '),
      };
    });
  const [a, b] = [await look(request), await look(notNow)];
  expect(b.look).toBe(a.look);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
  expect(a.height).toBeGreaterThanOrEqual(44);

  // No countdown, no scarcity or urgency, nothing ticked in advance.
  expect(findFomo(await prompt.innerText())).toEqual([]);
  await expect(prompt.locator('input:checked')).toHaveCount(0);
  await expect(prompt.locator('[role="timer"], [role="progressbar"], meter, progress')).toHaveCount(0);

  // "Not now" puts the prompt away; the requests stay, and the options come back on request.
  await notNow.click();
  await expect(page).toHaveURL(/\/dashboard\?upgrade=later$/);
  await expect(page.getByTestId('upgrade-prompt')).toHaveCount(0);
  await expect(page.getByTestId('upgrade-later')).toContainText('You have approved 5 of 5 students on Free Sifu.');
  await expect(page.getByTestId('student-requests').getByRole('listitem')).toHaveCount(1);
  await page.getByTestId('upgrade-later').getByRole('link', { name: 'Show the options' }).click();
  await expect(page.getByTestId('upgrade-prompt')).toBeVisible();
});

test('@M08 the upgrade prompt lists only features available in the current release', async ({ page }) => {
  await signInAs(page, 'demo-free-sifu-5');
  await page.goto('/dashboard');
  const prompt = page.getByTestId('upgrade-prompt');
  await expect(prompt).toBeVisible();
  const listed = await prompt.getByTestId('upgrade-benefits').locator('li[data-feature]').evaluateAll((items) => items.map((item) => item.getAttribute('data-feature')));
  expect(listed.length).toBeGreaterThan(0);
  const availability = new Map(FEATURES.map((f) => [f.key as string, f.availability]));
  for (const key of listed) expect(availability.get(key ?? ''), `${key} is a feature of this release`).toBe('now');
  // Exactly the features of this release where Professional Sifu gives more than Free Sifu.
  expect(listed).toEqual(upgradeBenefits('free_sifu', 'pro_sifu').map((benefit) => benefit.feature));
  // No planned feature is named, nor the "planned" wording.
  const text = await prompt.innerText();
  for (const planned of FEATURES.filter((f) => f.availability === 'planned')) expect(text, planned.key).not.toContain(planned.label);
  expect(text).not.toContain('Planned');

  // The same through the API that a native client reads.
  const api = await page.request.get('/api/v1/dashboard');
  expect(api.status()).toBe(200);
  const body = (await api.json()) as { sifu: { upgrade: { benefits: { feature: string }[] } | null } };
  expect(body.sifu.upgrade?.benefits.map((benefit) => benefit.feature)).toEqual(listed);
});

test('@M08 /plans labels planned features as not yet available and states that prices are proposals and payments are unavailable', async ({ page }) => {
  await page.goto('/plans');
  await expect(page.getByRole('heading', { level: 1, name: 'Plans of the pilot' })).toBeVisible();
  await expect(page.getByTestId('plans-banner')).toHaveText(BANNER);

  // Two comparison tables (students, instructors); in each, every feature of the matrix in its group.
  const tables = page.getByRole('main').getByRole('table');
  await expect(tables).toHaveCount(2);
  for (const table of await tables.all()) {
    for (const f of FEATURES) {
      const row = table.locator(`tbody[data-group="${f.availability}"] tr[data-feature="${f.key}"]`);
      await expect(row, f.key).toHaveCount(1);
      await expect(row).toHaveAttribute('data-availability', f.availability);
      // A screen reader hears it on the row itself; everyone sees the group's heading.
      if (f.availability === 'planned') await expect(row.getByRole('rowheader')).toContainText(`(${PLANNED})`);
      else await expect(row.getByRole('rowheader')).not.toContainText(PLANNED);
    }
    await expect(table.locator('tbody[data-group="planned"]').getByRole('rowheader').first()).toHaveText(PLANNED);
  }

  // The Federation plan is planned as a whole.
  const federation = page.getByRole('article', { name: 'Federation' });
  await expect(federation).toContainText(PLANNED);

  // Every price is a proposal: one label per plan.
  await expect(page.getByText(PROPOSED_PRICE, { exact: true })).toHaveCount(Object.keys(PLANS).length);
  await expect(page.getByRole('main')).toContainText(proSifuPrice);

  // Nothing to pay or subscribe with, and no urgency.
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('link', { name: /buy|subscribe|checkout|pay\b|upgrade/i })).toHaveCount(0);
  expect(findFomo(await page.getByRole('main').innerText())).toEqual([]);
});

test('@M08 "Request pilot access" notifies admins and creates no charge', async ({ page, browser }) => {
  const sifu = await freshAccount(page, { name: 'Demo Asking Sifu', sifu: true });
  await giveStudents(sifu.userId, 5, 1);
  await page.goto('/dashboard');
  const prompt = page.getByTestId('upgrade-prompt');
  await expect(prompt.getByTestId('upgrade-allowance')).toHaveText('You have approved 5 of 5 students on Free Sifu.');
  await prompt.getByTestId('request-pilot-access').click();
  await expect(doneText(page, 'Your request for Professional Sifu was sent to the administrators. Nothing is charged.')).toBeVisible();
  await expect(prompt.getByTestId('request-pilot-access')).toHaveCount(0);
  await expect(prompt.getByTestId('upgrade-not-now')).toBeVisible();

  // One open request, a notification to every administrator, an audit row, and no plan change.
  const requests = await getDb().execute<{ id: string; plan_code: string; status: string }>(sql`
    SELECT id, plan_code, status FROM pilot_access_request WHERE user_id = ${sifu.userId}`);
  expect(requests.rows).toHaveLength(1);
  expect(requests.rows[0]).toMatchObject({ plan_code: 'pro_sifu', status: 'open' });
  const requestId = requests.rows[0]!.id;
  const notified = await getDb().execute<{ notified: number; admins: number }>(sql`
    SELECT (SELECT count(*)::int FROM notification n JOIN auth_user u ON u.id = n.user_id
             WHERE n.template = 'pilot-access.requested' AND n.payload ->> 'requestId' = ${requestId} AND u.role = 'admin') AS notified,
           (SELECT count(*)::int FROM auth_user WHERE role = 'admin') AS admins`);
  expect(notified.rows[0]!.admins).toBeGreaterThanOrEqual(1);
  expect(notified.rows[0]!.notified).toBe(notified.rows[0]!.admins);
  const audit = await auditRows('pilot_access.request', requestId);
  expect(audit).toHaveLength(1);
  expect(audit[0]!.after).toMatchObject({ planCode: 'pro_sifu', currentPlan: 'free_sifu', notifiedAdmins: notified.rows[0]!.admins });

  // No charge: no grant, the plan is still Free Sifu, the API says so, and there is nothing to charge with.
  const grants = await getDb().execute(sql`SELECT 1 FROM entitlement_grant WHERE subject_user_id = ${sifu.userId}`);
  expect(grants.rows).toHaveLength(0);
  await expect(page.getByTestId('plan-name')).toHaveText('Free Sifu');
  const mine = await page.request.get('/api/v1/plans/mine');
  expect(((await mine.json()) as { plan: { code: string } }).plan.code).toBe('free_sifu');
  const again = await apiPost(page, '/plans/request-pilot-access', { planCode: 'pro_sifu' });
  expect(again.status(), await again.text()).toBe(200);
  expect(await again.json()).toMatchObject({ created: false, charged: false, request: { id: requestId } });
  const paymentTables = await getDb().execute(sql`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name ~ '(payment|charge|invoice|subscription|checkout|billing)'`);
  expect(paymentTables.rows).toEqual([]);

  // The open request is shown from then on; nothing is charged.
  await page.reload();
  await expect(prompt).toContainText('You asked for pilot access to Professional Sifu on');
  await expect(prompt).toContainText('nothing is charged');

  // An administrator sees it among the notifications and opens it in /admin/grants, prefilled.
  const admin = await signedInContext(browser, 'admin');
  try {
    await admin.page.goto('/dashboard');
    const review = admin.page.locator(`a[href="/admin/grants?request=${requestId}"]`);
    await expect(review).toHaveText('Review the request');
    await expect(admin.page.getByTestId('notification').filter({ has: review })).toContainText('Demo Asking Sifu asked for pilot access to Professional Sifu.');
    await review.click();
    await expect(admin.page).toHaveURL(new RegExp(`/admin/grants\\?request=${requestId}$`));
    await expect(admin.page.getByTestId('pilot-requests')).toContainText(sifu.email);
    const form = admin.page.locator('#give-plan');
    await expect(field(form, 'Account e-mail')).toHaveValue(sifu.email);
    await expect(field(form, 'Plan', true)).toHaveValue('pro_sifu');
  } finally {
    await admin.context.close();
  }
});

test('@M08 switching the account type to Sifu sets the Free Sifu plan, shows "Instructor (unverified)" and is audited', async ({ page }) => {
  const account = await freshAccount(page, { name: 'Demo Switching Teacher' });
  await page.goto('/dashboard/settings');
  await expect(page.getByTestId('settings-plan')).toContainText('Free Student');
  // The current type is the one selected; nothing else is ticked for the visitor.
  const student = page.getByRole('radio', { name: /^Student/ });
  const sifu = page.getByRole('radio', { name: /^Sifu/ });
  await expect(student).toBeChecked();
  await expect(sifu).not.toBeChecked();

  await sifu.check();
  await page.getByRole('button', { name: 'Save account type' }).click();
  await expect(doneText(page, 'Your account is now a Sifu account on Free Sifu. It shows as “Instructor (unverified)”.')).toBeVisible();
  await expect(page.getByTestId('settings-plan')).toContainText('Free Sifu');
  await expect(page.getByTestId('instructor-label')).toHaveText('Instructor (unverified)');
  await expect(sifu).toBeChecked();

  await page.goto('/dashboard');
  await expect(page.getByTestId('account-type')).toHaveText('Instructor (unverified)');
  await expect(page.getByTestId('plan-name')).toHaveText('Free Sifu');
  await expect(page.getByTestId('student-allowance')).toHaveText('Students: 0 of 5 approved on Free Sifu');

  // Audited with the plan before and after; no verification is granted (DEFAULT D04).
  const audit = await auditRows('account.type_change', account.userId);
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    actor_user_id: account.userId,
    before: { accountType: 'student', plan: 'free_student' },
    after: { accountType: 'sifu', plan: 'free_sifu' },
  });
  const mine = (await (await page.request.get('/api/v1/plans/mine')).json()) as { accountType: string; plan: { code: string }; instructor: { status: string } };
  expect(mine).toMatchObject({ accountType: 'sifu', plan: { code: 'free_sifu' }, instructor: { status: 'unverified' } });
});

test('@M08 student and Sifu dashboards render empty states with a next action', async ({ page }) => {
  const account = await freshAccount(page);
  const link = (testId: string) => page.getByTestId(testId).getByRole('link');

  // A new account without a profile: every empty state leads to setting one up.
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your dashboard');
  await expect(page.getByTestId('account-type')).toHaveText('Student');
  await expect(page.getByTestId('plan-name')).toHaveText('Free Student');
  for (const id of ['empty-teachers', 'empty-requests']) {
    await expect(link(id)).toHaveText('Set up your profile');
    await expect(link(id)).toHaveAttribute('href', '/onboarding?next=%2Fdashboard');
  }
  await expect(page.getByTestId('unread-count')).toHaveText('none unread');
  await expect(page.locator('#notifications')).toContainText('No notifications yet.');

  // With a profile, a student's empty lists lead to the lineage.
  const onboard = await apiPost(page, '/account/onboard', { primaryName: 'Demo Empty Dashboard' });
  expect(onboard.status(), await onboard.text()).toBe(200);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo Empty Dashboard');
  await expect(page.getByRole('heading', { level: 2, name: 'My teachers' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'My requests' })).toBeVisible();
  await expect(page.getByTestId('empty-teachers')).toContainText('No confirmed teachers yet.');
  await expect(page.getByTestId('empty-requests')).toContainText('No open requests.');
  for (const id of ['empty-teachers', 'empty-requests']) {
    await expect(link(id)).toHaveText('Explore the lineage');
    await expect(link(id)).toHaveAttribute('href', '/');
  }

  // As a Sifu: student requests and schools, each with its next action; no upgrade prompt below the limit.
  const type = await apiPost(page, '/account/type', { accountType: 'sifu' });
  expect(type.status(), await type.text()).toBe(200);
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'Student requests' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'My schools' })).toBeVisible();
  await expect(page.getByTestId('empty-student-requests')).toContainText('No student requests waiting.');
  await expect(link('empty-student-requests')).toHaveText('Check your profile');
  await expect(link('empty-student-requests')).toHaveAttribute('href', '/account');
  await expect(page.getByTestId('empty-schools')).toContainText('No school lists you as an instructor yet.');
  await expect(link('empty-schools')).toHaveText('How schools appear on the map');
  await expect(page.getByTestId('upgrade-prompt')).toHaveCount(0);
  await link('empty-schools').click();
  await expect(page).toHaveURL(/\/plans#instructors$/);
  // The anchor exists: the instructors section, with its heading, is where the link lands.
  await expect(page.locator('section#instructors').getByRole('heading', { level: 2, name: 'For instructors (Sifu)' })).toBeInViewport();
  expect(account.email).toMatch(/^demo-e2e-/);
});

test('@M08 notifications: marking one read updates the count at once, and marking all works without JavaScript', async ({ page, browser }) => {
  const account = await freshAccount(page, { name: 'Demo Reader', sifu: true });
  await getDb()
    .insert(notification)
    .values([
      { userId: account.userId, template: 'plan.granted', payload: { planCode: 'pro_sifu' } },
      { userId: account.userId, template: 'plan.revoked', payload: { planCode: 'pro_sifu' } },
    ]);
  await page.goto('/dashboard');
  const count = page.getByTestId('unread-count');
  await expect(count).toHaveText('2 unread');
  await expect(page.getByRole('link', { name: '2 unread notifications' })).toHaveAttribute('href', '#notifications');
  const items = page.getByTestId('notification');
  await expect(items).toHaveCount(2);
  await expect(items.filter({ hasText: 'New' })).toHaveCount(2);

  // With JavaScript: the count drops as soon as the button is pressed (useOptimistic) and stays.
  await page.getByRole('button', { name: 'Mark as read (Pilot plan added: Professional Sifu)' }).click();
  await expect(count).toHaveText('1 unread');
  await expect(page.locator('#notifications-heading')).toBeFocused();
  await page.reload();
  await expect(count).toHaveText('1 unread');

  // Without JavaScript the same form posts and comes back to the list.
  const nojs = await browser.newContext({ baseURL: BASE_URL, javaScriptEnabled: false, storageState: await page.context().storageState() });
  try {
    await giveOwnAddress(nojs);
    const other = await nojs.newPage();
    await other.goto('/dashboard');
    await expect(other.getByTestId('unread-count')).toHaveText('1 unread');
    await other.getByRole('button', { name: 'Mark all as read' }).click();
    await expect(other).toHaveURL(/\/dashboard#notifications$/);
    await expect(other.getByTestId('unread-count')).toHaveText('none unread');
  } finally {
    await nojs.close();
  }
  const unread = await getDb().execute(sql`SELECT 1 FROM notification WHERE user_id = ${account.userId} AND read_at IS NULL`);
  expect(unread.rows).toHaveLength(0);
});

test.describe('at 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('@M08 the dashboards and the upgrade prompt work at 390x844 with no horizontal scroll', async ({ page, browser }) => {
    await signInAs(page, 'demo-free-sifu-5');
    await page.goto('/dashboard');
    const prompt = page.getByTestId('upgrade-prompt');
    await expect(prompt).toBeVisible();
    await expectNoHorizontalScroll(page, 'Sifu dashboard');
    // Both actions fit the screen, are tall enough to tap, and are the same size.
    const boxes = await Promise.all(
      [prompt.getByTestId('request-pilot-access'), prompt.getByTestId('upgrade-not-now')].map(async (control) => (await control.boundingBox())!),
    );
    for (const box of boxes) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    expect(Math.abs(boxes[0]!.width - boxes[1]!.width)).toBeLessThanOrEqual(1);
    await prompt.getByTestId('upgrade-not-now').tap();
    await expect(page.getByTestId('upgrade-later')).toBeVisible();
    await expectNoHorizontalScroll(page, 'Sifu dashboard, prompt put away');

    for (const path of ['/dashboard/settings', '/plans']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page, path);
    }

    // A student's dashboard, in another phone context.
    const student = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      await giveOwnAddress(student);
      const other = await student.newPage();
      await signInAs(other, 'demo-pending');
      await other.goto('/dashboard');
      await expect(other.getByRole('heading', { level: 2, name: 'My requests' })).toBeVisible();
      await expect(other.getByTestId('requests').getByRole('listitem')).toHaveCount(1);
      await expectNoHorizontalScroll(other, 'student dashboard');
      // Its links are tall enough to tap.
      for (const name of ['Account type and plan', 'Compare plans']) {
        expect((await other.getByRole('link', { name, exact: true }).boundingBox())!.height, name).toBeGreaterThanOrEqual(44);
      }
    } finally {
      await student.close();
    }
  });
});
