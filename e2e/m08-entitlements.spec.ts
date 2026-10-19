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

/** The page's widths: what it scrolls, what the viewport shows, and the layout viewport. */
const widths = (page: Page) =>
  page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, innerWidth: window.innerWidth }));

/**
 * No horizontal scroll at the current viewport: nothing wider than the page's own width, and a
 * layout viewport that a phone browser did not widen to fit wider content (review round 1,
 * requirements-6: under isMobile, innerWidth alone grows with the content).
 */
async function expectNoHorizontalScroll(page: Page, label: string) {
  const viewport = page.viewportSize()!.width;
  const w = await widths(page);
  expect(w.scrollWidth, `${label}: no horizontal scroll (${JSON.stringify(w)})`).toBeLessThanOrEqual(w.clientWidth);
  expect(w.innerWidth, `${label}: the layout viewport is the screen's width`).toBeLessThanOrEqual(viewport);
  expect(w.clientWidth, `${label}: the page is the screen's width`).toBeLessThanOrEqual(viewport);
}

/**
 * A session of the seeded admin (as in e2e/m02-auth.spec.ts): one that never passed the second
 * factor, or with `verified`, one that did; `token` lets a test take the verification away.
 */
async function adminSession(browser: Browser, { verified = false } = {}) {
  const adminId = await userIdOf('demo-admin@example.test');
  expect(adminId, 'the seeded demo-admin account (pnpm db:seed)').not.toBeNull();
  const token = randomBytes(24).toString('base64url');
  await getDb().execute(sql`
    INSERT INTO auth_session (id, user_id, token, expires_at, two_factor_verified_at)
    VALUES (${uuidv7()}, ${adminId}, ${token}, now() + interval '1 hour', ${verified ? sql`now()` : null})`);
  const value = await signedSessionToken(token, process.env.BETTER_AUTH_SECRET!);
  const context = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(context);
  await context.addCookies([{ name: 'wcr.session_token', value: encodeURIComponent(value), url: BASE_URL, httpOnly: true, sameSite: 'Lax' }]);
  return { context, token };
}

const adminSessionWithoutSecondFactor = async (browser: Browser) => (await adminSession(browser)).context;

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
    // The table comes first; the form waits behind its disclosure, with no plan chosen in advance.
    const form = a.locator('#give-plan');
    await expect(field(form, 'Account e-mail')).toBeHidden();
    await form.getByTestId('give-plan-toggle').click();
    await expect(field(form, 'Plan', true)).toHaveValue('');
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

  // A session that loses its verification while the page is open: the form sends it to verify
  // again and back here, instead of a bare refusal (review round 1, security-8).
  const lapsing = await adminSession(browser, { verified: true });
  try {
    const a = await lapsing.context.newPage();
    await a.goto('/admin/grants');
    await expect(a.getByRole('heading', { level: 1, name: 'Plan grants' })).toBeVisible();
    const form = a.locator('#give-plan');
    await form.getByTestId('give-plan-toggle').click();
    // An address with no account: had the refusal not come first, the grant would fail anyway.
    await field(form, 'Account e-mail').fill(`demo-e2e-nobody-${randomUUID().slice(0, 8)}@example.test`);
    await field(form, 'Plan', true).selectOption('pro_sifu');
    await field(form, 'Reason', true).fill('Demo pilot test that never reaches the server');
    await getDb().execute(sql`UPDATE auth_session SET two_factor_verified_at = NULL WHERE token = ${lapsing.token}`);
    await form.getByRole('button', { name: 'Give the plan' }).click();
    await expect(a).toHaveURL(/\/account\/security\?next=%2Fadmin%2Fgrants$/);
    const given = await getDb().execute(sql`SELECT 1 FROM entitlement_grant WHERE reason = 'Demo pilot test that never reaches the server'`);
    expect(given.rows).toHaveLength(0);
  } finally {
    await lapsing.context.close();
  }
});

test('@M08 the upgrade prompt shows the current allowance, real benefits, a "Proposed price (not final)" label and an equally prominent "Not now"', async ({ page }) => {
  // demo-free-sifu-5: Free Sifu with 5 of 5 approved students and one request waiting.
  await signInAs(page, 'demo-free-sifu-5');
  await page.goto('/dashboard');
  const prompt = page.getByTestId('upgrade-prompt');
  // Calm by default (review round 1): one closed line at the top of the requests the limit holds back.
  await expect(page.locator('section#student-requests').getByTestId('upgrade-prompt')).toBeVisible();
  await expect(prompt).not.toHaveAttribute('open');
  await expect(prompt.getByTestId('upgrade-allowance')).toHaveText('You have approved 5 of 5 students on Free Sifu.');
  await expect(prompt.getByTestId('upgrade-summary')).toContainText('What Professional Sifu adds');
  await expect(prompt.getByTestId('upgrade-benefits')).toBeHidden();
  await expect(page.getByTestId('student-allowance')).toHaveText('Students: 5 of 5 approved on Free Sifu');
  // The waiting request stays listed below the prompt.
  await expect(page.getByTestId('student-requests').getByRole('listitem')).toHaveCount(1);

  // Opened, the whole offer.
  await prompt.getByTestId('upgrade-summary').click();
  await expect(prompt).toHaveAttribute('open');
  await expect(prompt.getByRole('heading', { level: 3 })).toHaveText('More students with Professional Sifu');
  await expect(prompt).toContainText('One student request waits below. It stays pending and visible.');

  // Real benefits: what Professional Sifu adds over Free Sifu during the pilot, each with when it
  // opens while its screens are not built yet.
  await expect(prompt.getByRole('heading', { level: 4 })).toHaveText('What Professional Sifu adds during the pilot');
  const benefits = prompt.getByTestId('upgrade-benefits').getByRole('listitem');
  await expect(benefits.first()).toContainText('Approve students: No limit');
  await expect(benefits).toHaveCount(upgradeBenefits('free_sifu', 'pro_sifu').length);
  for (const benefit of upgradeBenefits('free_sifu', 'pro_sifu')) {
    const item = prompt.locator(`li[data-feature="${benefit.feature}"]`);
    if (benefit.opens) await expect(item.getByTestId('benefit-opens')).toHaveText(benefit.opens);
    else await expect(item.getByTestId('benefit-opens')).toHaveCount(0);
  }

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

  // "Not now" closes it again and gives the focus back to its line; the requests stay. It never
  // opens by itself, also on the next visit. Without JavaScript it is a link back to the closed prompt.
  await expect(notNow).toHaveAttribute('href', '/dashboard#student-requests');
  await notNow.click();
  await expect(prompt).not.toHaveAttribute('open');
  await expect(prompt.getByTestId('upgrade-summary')).toBeFocused();
  await expect(prompt.getByTestId('upgrade-allowance')).toBeVisible();
  await expect(page.getByTestId('student-requests').getByRole('listitem')).toHaveCount(1);
  await page.reload();
  await expect(prompt).toBeVisible();
  await expect(prompt).not.toHaveAttribute('open');
});

test('@M08 the upgrade prompt lists only features available in the current release', async ({ page }) => {
  await signInAs(page, 'demo-free-sifu-5');
  await page.goto('/dashboard');
  const prompt = page.getByTestId('upgrade-prompt');
  await expect(prompt).toBeVisible();
  await prompt.getByTestId('upgrade-summary').click();
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
  // Review round 1: no claim about "this release" for a feature whose screens open later; such a
  // benefit says when it opens, and the dashboard around it says the same.
  expect(text).not.toMatch(/in this release/i);
  for (const benefit of upgradeBenefits('free_sifu', 'pro_sifu').filter((b) => b.opens)) expect(text, benefit.feature).toContain(benefit.opens!);

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

  // A comparison per audience (students, instructors); in each, every feature of the matrix in its
  // group. From md up the planned features follow in the same table; below md they wait behind a
  // closed disclosure with their own table (review round 1, design-3), opened here.
  let opened = 0;
  for (const id of ['students', 'instructors']) {
    const section = page.locator(`section#${id}`);
    const disclosure = section.getByTestId('planned-features');
    if (await disclosure.isVisible()) {
      await expect(disclosure).not.toHaveAttribute('open');
      await expect(disclosure.locator('summary')).toContainText(PLANNED);
      await disclosure.locator('summary').click();
      opened += 1;
    }
    for (const f of FEATURES) {
      const row = section.locator(`tbody[data-group="${f.availability}"] tr[data-feature="${f.key}"]`).filter({ visible: true });
      await expect(row, f.key).toHaveCount(1);
      await expect(row).toHaveAttribute('data-availability', f.availability);
      // A screen reader hears it on the row itself; everyone sees the group's heading.
      if (f.availability === 'planned') await expect(row.getByRole('rowheader')).toContainText(`(${PLANNED})`);
      else await expect(row.getByRole('rowheader')).not.toContainText(PLANNED);
    }
    await expect(section.getByText(PLANNED).filter({ visible: true }).first()).toBeVisible();
    // Marks follow the meaning (design-4): "Ads shown" never gets a check, "Browse only" no mark.
    await expect(section.locator('tr[data-feature="advertising"] [data-mark="included"]').filter({ visible: true }).filter({ hasText: 'Ads shown' })).toHaveCount(0);
  }
  await expect(page.getByRole('main').getByRole('table')).toHaveCount(2 + opened);

  // The Federation plan is planned as a whole.
  const federation = page.getByRole('article', { name: 'Federation' });
  await expect(federation).toContainText(PLANNED);

  // Every price is a proposal: one label per plan with a price. A free plan says "Free", with no
  // proposal label (review round 1, design-10); the yearly proposal is shown too (requirements-3).
  const plans = Object.values(PLANS);
  await expect(page.getByText(PROPOSED_PRICE, { exact: true })).toHaveCount(plans.filter((plan) => plan.price.monthlyUsd > 0).length);
  for (const plan of plans.filter((p) => p.price.monthlyUsd === 0)) {
    const entry = page.getByRole('article', { name: plan.name });
    await expect(entry).toContainText('Free');
    await expect(entry).not.toContainText(PROPOSED_PRICE);
  }
  await expect(page.getByRole('main')).toContainText(proSifuPrice);
  await expect(page.getByRole('main')).toContainText(formatPrice(PLANS.federation.price));
  // No spec jargon for visitors: no tier eyebrows, no matrix version.
  await expect(page.getByRole('main')).not.toContainText(/\bTier\b/i);
  await expect(page.getByRole('main')).not.toContainText('matrix is version');

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
  await prompt.getByTestId('upgrade-summary').click();
  await prompt.getByTestId('request-pilot-access').click();
  await expect(doneText(page, 'Your request for Professional Sifu was sent to the administrators. Nothing is charged.')).toBeVisible();
  // Once asked, only the allowance and the state remain: no price, benefits or buttons.
  await expect(prompt).toHaveAttribute('data-state', 'asked');
  await expect(prompt.getByTestId('request-pilot-access')).toHaveCount(0);
  await expect(prompt.getByTestId('upgrade-not-now')).toHaveCount(0);
  await expect(prompt.getByTestId('upgrade-price')).toHaveCount(0);
  await expect(prompt.getByTestId('upgrade-benefits')).toHaveCount(0);
  await expect(prompt.getByRole('link', { name: 'Compare plans' })).toBeVisible();

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
  await expect(prompt.getByTestId('pilot-request-state')).toContainText('You asked for pilot access to Professional Sifu on');
  await expect(prompt).toContainText('nothing is charged');
  await expect(prompt.getByTestId('upgrade-price')).toHaveCount(0);

  // An administrator sees it among the notifications and opens it in /admin/grants, prefilled.
  const admin = await signedInContext(browser, 'admin');
  try {
    await admin.page.goto('/dashboard');
    // Staff work first: the open pilot access requests, with the way to answer them.
    await expect(admin.page.getByTestId('staff-work')).toContainText('open pilot access request');
    await expect(admin.page.getByTestId('staff-work').getByRole('link', { name: 'Answer them in Plan grants' })).toHaveAttribute('href', '/admin/grants#pilot-requests');
    const review = admin.page.locator(`a[href="/admin/grants?request=${requestId}#give-plan"]`);
    await expect(review).toHaveText('Review the request');
    await expect(admin.page.getByTestId('notification').filter({ has: review })).toContainText('Demo Asking Sifu asked for Professional Sifu.');
    await review.click();
    await expect(admin.page).toHaveURL(new RegExp(`/admin/grants\\?request=${requestId}#give-plan$`));
    await expect(admin.page.getByTestId('pilot-requests')).toContainText(sifu.email);
    // The form is open, filled in, and in view.
    const form = admin.page.locator('#give-plan');
    await expect(form.locator('details')).toHaveAttribute('open');
    await expect(field(form, 'Account e-mail')).toBeInViewport();
    await expect(field(form, 'Account e-mail')).toHaveValue(sifu.email);
    await expect(field(form, 'Plan', true)).toHaveValue('pro_sifu');

    // Without JavaScript the same form answers the request from that address: the outcome address
    // names the form's message, so the page opens there with the focus on it (a11y-webview-1).
    const nojs = await browser.newContext({ baseURL: BASE_URL, javaScriptEnabled: false, storageState: await admin.context.storageState() });
    try {
      await giveOwnAddress(nojs);
      const b = await nojs.newPage();
      await b.goto(`/admin/grants?request=${requestId}#give-plan`);
      const give = b.locator('#give-plan');
      await field(give, 'Reason', true).fill('Demo pilot request answered');
      await give.getByRole('button', { name: 'Give the plan' }).click();
      await expect(b).toHaveURL(/\/admin\/grants\?outcome=[\w-]+#create-grant-message$/);
      const message = b.locator('#give-plan').getByRole('status');
      await expect(message).toContainText(`Professional Sifu given to ${sifu.email}`);
      await expect(message).toBeFocused();
      await expect(message).toBeInViewport();
    } finally {
      await nojs.close();
    }
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
  await expect(page.getByTestId('account-type')).toHaveText('Sifu');
  await expect(page.getByTestId('shown-as')).toHaveText('Instructor (unverified)');
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

  // No label twice on one screen, and no link that leads nowhere new (review round 1, design-9).
  const labelsAreUnique = async (where: string) => {
    const labels = await page.getByRole('main').getByRole('link').evaluateAll((links) => links.filter((a) => a.checkVisibility()).map((a) => a.textContent?.trim() ?? ''));
    expect(labels.filter((label, i) => labels.indexOf(label) !== i), `${where}: repeated link labels`).toEqual([]);
  };

  // A new account without a profile: one call to set it up, and every empty state says why it is
  // empty and that the profile comes first.
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your dashboard');
  await expect(page.getByTestId('account-type')).toHaveText('Student');
  await expect(page.getByTestId('plan-name')).toHaveText('Free Student');
  const setUp = page.getByRole('main').getByRole('link', { name: 'Set up your profile' });
  await expect(setUp).toHaveCount(1);
  await expect(setUp).toHaveAttribute('href', '/onboarding?next=%2Fdashboard');
  await expect(page.getByTestId('empty-teachers')).toContainText('once your profile is set up');
  await expect(page.getByTestId('empty-requests')).toContainText('With a profile');
  for (const id of ['empty-teachers', 'empty-requests']) await expect(link(id)).toHaveCount(0);
  await expect(page.getByTestId('unread-count')).toHaveText('none unread');
  await expect(page.locator('#notifications')).toContainText('No notifications yet.');
  await labelsAreUnique('no profile');

  // With a profile: the real next step for teachers (how your name reads, which they search for),
  // and requests say honestly when they open.
  const onboard = await apiPost(page, '/account/onboard', { primaryName: 'Demo Empty Dashboard' });
  expect(onboard.status(), await onboard.text()).toBe(200);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo Empty Dashboard');
  await expect(page.getByRole('heading', { level: 2, name: 'My teachers' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'My requests' })).toBeVisible();
  await expect(page.getByTestId('empty-teachers')).toContainText('No confirmed teachers yet.');
  await expect(link('empty-teachers')).toHaveText('See how your name reads');
  await expect(link('empty-teachers')).toHaveAttribute('href', '/account');
  await expect(page.getByTestId('empty-requests')).toContainText('No open requests. Requests to teachers open later in the pilot');
  await expect(link('empty-requests')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('link', { name: 'Set up your profile' })).toHaveCount(0);
  await labelsAreUnique('student with a profile');

  // As a Sifu: student requests and schools, each saying what comes next; no upgrade prompt below the limit.
  const type = await apiPost(page, '/account/type', { accountType: 'sifu' });
  expect(type.status(), await type.text()).toBe(200);
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'Student requests' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'My schools' })).toBeVisible();
  await expect(page.getByTestId('empty-student-requests')).toContainText('No student requests waiting.');
  await expect(link('empty-student-requests')).toHaveText('See how your name reads');
  await expect(link('empty-student-requests')).toHaveAttribute('href', '/account');
  await expect(page.getByTestId('empty-schools')).toContainText('No school lists you as an instructor yet. Schools and the map open later in the pilot');
  // Help, not a price table: the schools empty state links nowhere.
  await expect(link('empty-schools')).toHaveCount(0);
  await expect(page.getByTestId('upgrade-prompt')).toHaveCount(0);
  await labelsAreUnique('Sifu');
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
  const headerLink = page.getByTestId('unread-link');
  await expect(headerLink).toHaveText('2 unread notifications');
  await expect(headerLink).toHaveAttribute('href', '#notifications');
  const items = page.getByTestId('notification');
  await expect(items).toHaveCount(2);
  await expect(items.filter({ hasText: 'New' })).toHaveCount(2);

  // With JavaScript the count drops while the server is still answering (useOptimistic), in the
  // section and in the header alike (review round 1, code-2 and a11y-webview-9): the Server
  // Action is held until the new count has been seen.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let posted = 0;
  await page.route('**/dashboard', async (route) => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
      posted += 1;
      await held;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Mark as read (Pilot plan added: Professional Sifu)' }).click();
  await expect(count).toHaveText('1 unread', { timeout: 1_000 });
  await expect(headerLink).toHaveText('1 unread notification', { timeout: 1_000 });
  expect(posted, 'the Server Action is still held').toBe(1);
  // A polite announcement, and the focus moves on to the next unread item (a11y-webview-3).
  await expect(page.getByTestId('notifications-status')).toHaveText('Marked as read. 1 unread.');
  await expect(page.getByRole('button', { name: 'Mark as read (Pilot plan ended: Professional Sifu)' })).toBeFocused();
  release();
  await expect(count).toHaveText('1 unread');
  await page.unroute('**/dashboard');
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

test('@M08 notifications: a failed "Mark as read" says so, puts the item back and returns the focus', async ({ page }) => {
  const account = await freshAccount(page, { name: 'Demo Offline Reader', sifu: true });
  await getDb().insert(notification).values([{ userId: account.userId, template: 'plan.granted', payload: { planCode: 'pro_sifu' } }]);
  await page.goto('/dashboard');
  const count = page.getByTestId('unread-count');
  await expect(count).toHaveText('1 unread');
  // The connection drops: the Server Action never reaches the server (review round 1, a11y-webview-2).
  await page.route('**/dashboard', (route) =>
    route.request().method() === 'POST' && route.request().headers()['next-action'] ? route.abort('failed') : route.continue(),
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const button = page.getByRole('button', { name: 'Mark as read (Pilot plan added: Professional Sifu)' });
  await button.click();
  const status = page.getByTestId('notifications-status');
  await expect(status).toHaveText('Could not mark it as read. Check your connection and try again.');
  await expect(status).toBeVisible();
  await expect(count).toHaveText('1 unread');
  await expect(page.getByTestId('notification').first()).toHaveAttribute('data-unread', 'true');
  await expect(button).toBeFocused();
  expect(errors, 'no uncaught error').toEqual([]);
  // Nothing was marked.
  const unread = await getDb().execute(sql`SELECT 1 FROM notification WHERE user_id = ${account.userId} AND read_at IS NULL`);
  expect(unread.rows).toHaveLength(1);
});

test('@M08 without JavaScript, a refused revoke comes back open with the focus on its reason', async ({ page, browser }) => {
  const sifu = await freshAccount(page, { name: 'Demo Revoke Focus Sifu', sifu: true });
  const admin = await signedInContext(browser, 'admin');
  const nojs = await browser.newContext({ baseURL: BASE_URL, javaScriptEnabled: false, storageState: await admin.context.storageState() });
  try {
    await giveOwnAddress(nojs);
    const created = await apiPost(admin.page, '/admin/grants/create', { email: sifu.email, planCode: 'pro_sifu', reason: 'Demo pilot test of the revoke focus' });
    expect(created.status(), await created.text()).toBe(200);
    const grantId = ((await created.json()) as { id: string }).id;
    const a = await nojs.newPage();
    const list = `/admin/grants?q=${encodeURIComponent(sifu.email)}`;
    const revokeIn = async (start: string, reason: string) => {
      await a.goto(start);
      const row = a.getByTestId('grant-row').filter({ hasText: sifu.email });
      await row.locator('summary').click();
      if (reason) await field(row, 'Reason for revoking').fill(reason);
      await row.getByRole('button', { name: `Revoke Professional Sifu of ${sifu.email}` }).click();
    };
    // Opened directly, after a "Give …" link left #give-plan in the address, and after the skip
    // link left #main (review round 1, a11y-webview-1): the outcome address names the row's reason,
    // so the browser opens the long list there, with the focus on it.
    for (const start of [list, `${list}#give-plan`, `${list}#main`]) {
      await revokeIn(start, '');
      await expect(a).toHaveURL(new RegExp(`/admin/grants\\?q=[^#]+&outcome=[\\w-]+#revoke-grant-${grantId}-reason$`));
      const again = a.getByTestId('grant-row').filter({ hasText: sifu.email });
      await expect(again).toContainText('Give a reason; it is kept in the audit log.');
      const reason = field(again, 'Reason for revoking');
      await expect(reason).toBeFocused();
      await expect(reason).toBeInViewport();
    }
    await expect(a.getByTestId('grant-row').filter({ hasText: sifu.email })).toHaveAttribute('data-state', 'active');
    // Revoked: the page opens at the row's message, which has the focus.
    await revokeIn(`${list}#give-plan`, 'Demo pilot test ends');
    await expect(a).toHaveURL(new RegExp(`#revoke-grant-${grantId}-message$`));
    const done = a.getByTestId('grant-row').filter({ hasText: sifu.email });
    await expect(done).toHaveAttribute('data-state', 'revoked');
    const message = done.getByRole('status');
    await expect(message).toContainText(`Professional Sifu of ${sifu.email} revoked.`);
    await expect(message).toBeFocused();
    await expect(message).toBeInViewport();
  } finally {
    await nojs.close();
    await admin.context.close();
  }
});

test.describe('at 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('@M08 the dashboards and the upgrade prompt work at 390x844 with no horizontal scroll', async ({ page, browser }) => {
    await signInAs(page, 'demo-free-sifu-5');
    await page.goto('/dashboard');
    const prompt = page.getByTestId('upgrade-prompt');
    await expect(prompt).toBeVisible();
    await expectNoHorizontalScroll(page, 'Sifu dashboard');
    // The check itself can fail: a 700 px element makes it see the overflow.
    await page.evaluate(() => {
      const wide = document.createElement('div');
      wide.id = 'too-wide';
      wide.style.width = '700px';
      wide.style.height = '1px';
      document.querySelector('main')!.append(wide);
    });
    const wide = await widths(page);
    expect(wide.scrollWidth > wide.clientWidth || wide.innerWidth > 390, `the check sees a 700 px element (${JSON.stringify(wide)})`).toBe(true);
    await page.evaluate(() => document.getElementById('too-wide')!.remove());

    // Calm on a phone (review round 1, design-2): one closed line, and the request it is about on
    // the first screen.
    expect((await prompt.boundingBox())!.height).toBeLessThanOrEqual(140);
    expect((await page.getByTestId('student-requests').getByRole('listitem').first().boundingBox())!.y).toBeLessThan(844);
    await prompt.getByTestId('upgrade-summary').tap();
    await expect(prompt).toHaveAttribute('open');
    await expectNoHorizontalScroll(page, 'Sifu dashboard, prompt open');
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
    await expect(prompt).not.toHaveAttribute('open');
    await expectNoHorizontalScroll(page, 'Sifu dashboard, prompt put away');

    // With a large text size (Android webviews apply it as text zoom; a11y-webview-6).
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expectNoHorizontalScroll(page, 'Sifu dashboard at 200 % text');

    for (const path of ['/dashboard/settings', '/plans']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page, path);
    }
    // /plans on a phone: the planned features wait behind a closed disclosure, and words never
    // break in the middle (design-3). It reflows at 320 x 568 too (a11y-webview-8).
    await expect(page.getByTestId('planned-features').first()).not.toHaveAttribute('open');
    await page.getByTestId('planned-features').first().locator('summary').tap();
    await expectNoHorizontalScroll(page, '/plans, planned features open');
    await page.setViewportSize({ width: 320, height: 568 });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page, '/plans at 320 x 568');
    await page.setViewportSize({ width: 390, height: 844 });

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
      for (const name of ['Account type and plan', 'Account and security', 'Compare plans']) {
        expect((await other.getByRole('link', { name, exact: true }).boundingBox())!.height, name).toBeGreaterThanOrEqual(44);
      }
      await other.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await expectNoHorizontalScroll(other, 'student dashboard at 200 % text');
    } finally {
      await student.close();
    }
  });
  test('@M08 /admin/grants at 390x844: cards with a visible sort bar, and every focus stop is on screen', async ({ browser }) => {
    const admin = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      await giveOwnAddress(admin);
      const a = await admin.newPage();
      await signInAs(a, 'admin');
      await a.goto('/admin/grants');
      await expect(a.getByRole('heading', { level: 1, name: 'Plan grants' })).toBeVisible();
      await expectNoHorizontalScroll(a, '/admin/grants');
      // Cards: the header row is not displayed (so its sort links leave the tab order), and the
      // "Sort by" bar takes its place (review round 1, design-5 and a11y-webview-4).
      await expect(a.getByTestId('grants-table').locator('thead')).toBeHidden();
      const sort = a.getByRole('navigation', { name: 'Sort grants' });
      await expect(sort).toBeVisible();
      await expect(sort.getByRole('link', { name: /^Date given/ })).toHaveAttribute('aria-current', 'true');
      await sort.getByRole('link', { name: 'Account' }).tap();
      await expect(a).toHaveURL(/\/admin\/grants\?sort=email&dir=asc$/);
      await expect(sort.getByRole('link', { name: /^Account/ })).toHaveAttribute('aria-current', 'true');
      await expect(a.getByTestId('grants-table').locator('caption')).toHaveText('Plan grants. Sorted by account, A to Z');

      // Every element the keyboard reaches is visible and inside the screen once focused.
      await a.getByLabel('Find by e-mail').focus();
      for (let i = 0; i < 25; i += 1) {
        await a.keyboard.press('Tab');
        const focused = await a.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const box = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return {
            label: (el.textContent ?? el.getAttribute('aria-label') ?? el.tagName).trim().slice(0, 60),
            visible: el.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
            clipped: style.clipPath === 'inset(50%)' || box.width < 2 || box.height < 2,
            inside: box.right > 0 && box.left < window.innerWidth && box.bottom > 0 && box.top < window.innerHeight,
          };
        });
        if (!focused) break;
        expect(focused.visible, `${focused.label}: visible`).toBe(true);
        expect(focused.clipped, `${focused.label}: not clipped away`).toBe(false);
        expect(focused.inside, `${focused.label}: on screen`).toBe(true);
      }
    } finally {
      await admin.close();
    }
  });
});
