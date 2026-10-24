// Accounts for the plan and dashboard tests (milestone M08): a fresh account with or without a
// profile, as Student or Sifu, and fictional students for its own person, so a test can reach the
// Free Sifu limit without changing a seeded demo account (whose dashboards the visual regression
// compares). Used by e2e/m08-entitlements.spec.ts and the screen states of e2e/screenshots.spec.ts.

import { randomBytes } from 'node:crypto';

import { expect, type BrowserContext, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { signedSessionToken } from '../../src/server/auth/credentials';
import { getDb } from '../../src/server/db';
import { uuidv7 } from '../../src/server/db/ids';
import { person, personName, teachingRelationship } from '../../src/server/db/schema';
import { BASE_URL, loadTestEnv, signInAs, userIdOf } from './auth';

/**
 * Signs `context` in as the seeded demo-admin with a session written straight to the database:
 * one that has passed the second factor when `verified` is set, otherwise one that knows only
 * the password (the state /account/security asks to verify). Returns the session token.
 */
export async function signInSeededAdmin(context: BrowserContext, { verified = false } = {}): Promise<string> {
  const adminId = await userIdOf('demo-admin@example.test');
  expect(adminId, 'the seeded demo-admin account (pnpm db:seed)').not.toBeNull();
  const token = randomBytes(24).toString('base64url');
  await getDb().execute(sql`
    INSERT INTO auth_session (id, user_id, token, expires_at, two_factor_verified_at)
    VALUES (${uuidv7()}, ${adminId}, ${token}, now() + interval '1 hour', ${verified ? sql`now()` : null})`);
  loadTestEnv();
  const value = await signedSessionToken(token, process.env.BETTER_AUTH_SECRET!);
  await context.addCookies([{ name: 'wcr.session_token', value: encodeURIComponent(value), url: BASE_URL, httpOnly: true, sameSite: 'Lax' }]);
  return token;
}

/** POST to /api/v1 with the page's session, as a same-origin client. */
export function apiPost(page: Page, path: string, data: Record<string, unknown>) {
  return page.request.post(`/api/v1${path}`, { data, headers: { origin: BASE_URL } });
}

export interface FreshAccount {
  email: string;
  userId: string;
}

/**
 * A new confirmed account, signed in on `page`: with a profile when `name` is given (through the
 * API, as onboarding does), and a Sifu account when `sifu` is set.
 */
export async function freshAccount(page: Page, options: { name?: string; sifu?: boolean } = {}): Promise<FreshAccount> {
  const account = await signInAs(page, 'new');
  const userId = await userIdOf(account.email);
  expect(userId).not.toBeNull();
  if (options.name) {
    const onboard = await apiPost(page, '/account/onboard', { primaryName: options.name });
    expect(onboard.status(), await onboard.text()).toBe(200);
  }
  if (options.sifu) {
    const type = await apiPost(page, '/account/type', { accountType: 'sifu' });
    expect(type.status(), await type.text()).toBe(200);
  }
  return { email: account.email, userId: userId! };
}

/**
 * Gives the account's own person `verified` established students and `pending` requests waiting
 * for it, as the teacher-approval flow of a later milestone will (fictional people, involved_only,
 * so nothing public changes).
 */
export async function giveStudents(userId: string, verified: number, pending: number): Promise<void> {
  const db = getDb();
  const own = await db.execute<{ id: string }>(sql`SELECT id FROM person WHERE claimed_by_user_id = ${userId} AND deleted_at IS NULL`);
  const lineage = await db.execute<{ id: string }>(sql`SELECT id FROM lineage WHERE slug LIKE 'demo-%' ORDER BY slug LIMIT 1`);
  expect(own.rows, 'the account has a profile').toHaveLength(1);
  expect(lineage.rows, 'a demo lineage (pnpm db:seed)').toHaveLength(1);
  const statuses = [...Array<'verified'>(verified).fill('verified'), ...Array<'pending_teacher'>(pending).fill('pending_teacher')];
  for (const [i, status] of statuses.entries()) {
    const studentId = uuidv7();
    await db.insert(person).values({ id: studentId, slug: `demo-e2e-student-${randomBytes(5).toString('hex')}`, kind: 'living', stewardship: 'unclaimed' });
    await db.insert(personName).values({ personId: studentId, value: `Demo Student ${i + 1}`, script: 'Latn', lang: 'und-Latn', isPrimary: true });
    await db.insert(teachingRelationship).values({
      id: uuidv7(),
      teacherPersonId: own.rows[0]!.id,
      studentPersonId: studentId,
      lineageId: lineage.rows[0]!.id,
      status,
      visibility: 'involved_only',
    });
  }
}
