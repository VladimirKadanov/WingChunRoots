// Signing in for the E2E tests (milestone M02, In scope 9). `signInAs(page, slugOrRole)` signs the
// page's browser context in as a seeded demo account (`pnpm db:seed`: the password from
// E2E_PASSWORD, the staff TOTP secret from E2E_TOTP_SECRET) through the same HTTP API a native
// client uses; `signInAs(page, 'new')` first creates a confirmed account that has given the
// sign-up consents and has no profile yet, for the onboarding screens.
//
// Rate limits are per client address, so every context gets its own X-Forwarded-For address
// (`next start` keeps the header; docs/adr/0004-auth.md). All addresses and accounts are
// fictional: `demo-…@example.test` in 198.18.0.0/15, the benchmarking range.

import { randomInt, randomUUID } from 'node:crypto';
import path from 'node:path';

import { createOTP } from '@better-auth/utils/otp';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { DEMO_PERSON_ACCOUNT_SLUGS, DEMO_STAFF_ACCOUNTS, demoAccountEmail, type DemoAccountSlug } from '../../src/fixtures/generate';
import { closeDb, getDb } from '../../src/server/db';
import { loadDotEnv } from '../../src/server/db/dotenv';

export const BASE_URL = `http://127.0.0.1:${Number(process.env.E2E_PORT || 3100)}`;

/** The password of the accounts the tests create themselves (throwaway, test only). */
export const NEW_ACCOUNT_PASSWORD = 'demo-password-for-e2e-tests';

export type StaffRole = (typeof DEMO_STAFF_ACCOUNTS)[number]['role'];
/** A demo account by slug, a staff role, `user` (an ordinary seeded member) or `new`. */
export type SignInTarget = DemoAccountSlug | StaffRole | 'user' | 'new';

export interface SignedInAccount {
  email: string;
  password: string;
  slug: DemoAccountSlug | null;
}

let envLoaded = false;
/** The same settings as the web server (environment first, then .env). */
export function loadTestEnv(): void {
  if (envLoaded) return;
  loadDotEnv(path.resolve('.env'));
  envLoaded = true;
}

function required(name: 'E2E_PASSWORD' | 'E2E_TOTP_SECRET' | 'BETTER_AUTH_SECRET'): string {
  loadTestEnv();
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (local: scripts/init-env.sh; cloud: scripts/cloud-setup.sh)`);
  return value;
}

export const demoPassword = () => required('E2E_PASSWORD');

/** The current TOTP code of the seeded staff accounts. */
export const staffTotpCode = () => createOTP(required('E2E_TOTP_SECRET')).totp();

/** A fictional client address of its own (198.18.0.0/15). */
export function clientAddress(): string {
  return `198.${18 + randomInt(2)}.${randomInt(256)}.${1 + randomInt(254)}`;
}

const addresses = new WeakMap<BrowserContext, string>();

/** Gives the context its own client address, for its pages and its API requests. */
export async function giveOwnAddress(context: BrowserContext): Promise<string> {
  const existing = addresses.get(context);
  if (existing) return existing;
  const address = clientAddress();
  addresses.set(context, address);
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': address });
  return address;
}

/**
 * POST to a Better Auth endpoint with the context's cookies, as a same-origin client: from the
 * context's address, or from `address` (sign-up and sign-in allow 3 requests in 10 s per address).
 */
export async function authPost(page: Page, endpoint: string, data: Record<string, unknown>, address?: string) {
  const from = address ?? (await giveOwnAddress(page.context()));
  return page.request.post(`/api/auth${endpoint}`, { data, headers: { origin: BASE_URL, 'x-forwarded-for': from } });
}

/** The newest link of an account e-mail to `to`, read from the outbox job (no wait for the worker). */
export async function emailLinkFromOutbox(template: 'verify-email' | 'reset-password', to: string): Promise<string> {
  loadTestEnv();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rows = await getDb().execute<{ url: string }>(sql`
      SELECT j.data -> 'data' ->> 'url' AS url
        FROM pgboss.job j
        JOIN email_delivery d ON d.id::text = j.data ->> 'deliveryId'
       WHERE d.template = ${template} AND d.to_email = ${to}
       ORDER BY d.created_at DESC
       LIMIT 1`);
    const url = rows.rows[0]?.url;
    if (url) return url;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no ${template} e-mail to ${to} in the outbox`);
}

/** The id of the account with `email`. */
export async function userIdOf(email: string): Promise<string | null> {
  loadTestEnv();
  const rows = await getDb().execute<{ id: string }>(sql`SELECT id FROM auth_user WHERE email = ${email.toLowerCase()}`);
  return rows.rows[0]?.id ?? null;
}

/** Closes the database pool the helpers opened (call in afterAll). */
export async function closeHelpers(): Promise<void> {
  await closeDb();
}

export const uniqueEmail = (label: string) => `demo-e2e-${label}-${randomUUID().slice(0, 8)}@example.test`;

/**
 * A new account through the API: sign-up with every consent ticked, then the confirmation link
 * from the outbox. Not signed in afterwards.
 */
export async function createConfirmedAccount(page: Page, label = 'new'): Promise<SignedInAccount> {
  const email = uniqueEmail(label);
  const signUp = await authPost(page, '/sign-up/email', {
    name: '',
    email,
    password: NEW_ACCOUNT_PASSWORD,
    consents: { terms: true, privacy_ack: true, authenticity_declaration: true, age_18_plus: true },
  });
  expect(signUp.status(), await signUp.text()).toBe(200);
  const link = new URL(await emailLinkFromOutbox('verify-email', email));
  const confirm = await page.request.get(`/api/auth/verify-email?token=${encodeURIComponent(link.searchParams.get('token') ?? '')}`);
  expect(confirm.status(), await confirm.text()).toBe(200);
  return { email, password: NEW_ACCOUNT_PASSWORD, slug: null };
}

function slugFor(target: Exclude<SignInTarget, 'new'>): DemoAccountSlug {
  if (target === 'user') return DEMO_PERSON_ACCOUNT_SLUGS[1]; // demo-root-a
  const staff = DEMO_STAFF_ACCOUNTS.find((account) => account.role === target);
  return staff ? staff.slug : (target as DemoAccountSlug);
}

/** Signs in with a password and, when the account asks for it, the staff TOTP code. */
export async function signInWithPassword(page: Page, email: string, password: string): Promise<void> {
  const first = await authPost(page, '/sign-in/email', { email, password });
  expect(first.status(), await first.text()).toBe(200);
  const body = (await first.json()) as { twoFactorRedirect?: boolean };
  if (body.twoFactorRedirect) {
    const second = await authPost(page, '/two-factor/verify-totp', { code: await staffTotpCode() });
    expect(second.status(), await second.text()).toBe(200);
  }
}

/** Signs the page's context in as a seeded demo account, a staff role, `user` or a new account. */
export async function signInAs(page: Page, target: SignInTarget): Promise<SignedInAccount> {
  if (target === 'new') {
    const account = await createConfirmedAccount(page);
    await signInWithPassword(page, account.email, account.password);
    return account;
  }
  const slug = slugFor(target);
  const account = { email: demoAccountEmail(slug), password: demoPassword(), slug };
  await signInWithPassword(page, account.email, account.password);
  return account;
}

const signedInFor = new WeakMap<Page, SignInTarget>();

/**
 * Signs the page in as a route of e2e/routes.ts needs (`signInAs`), once per page and account
 * kind, so that a loop over the routes checks the guarded pages themselves, not the sign-in page
 * they send an anonymous visitor to.
 */
export async function signInForRoute(page: Page, route: { signInAs?: SignInTarget }): Promise<void> {
  if (!route.signInAs || signedInFor.get(page) === route.signInAs) return;
  await signInAs(page, route.signInAs);
  signedInFor.set(page, route.signInAs);
}
