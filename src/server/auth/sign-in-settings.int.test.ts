// Journey review P2-4 (docs/adr/0081-sign-in-settings.md): changing the password, the e-mail
// address and signing out of other devices from the settings, through Better Auth's HTTP API.

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDb } from '../db';
import { auditLog } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { SIGN_IN_FAILURE_LIMIT } from './throttle';
import {
  authFetch,
  createAccount,
  sessionCount,
  signIn,
  signInWith,
  startAuthTestDatabase,
  stopAuthTestDatabase,
  TestBrowser,
  tokenFromOutbox,
  userRow,
} from './test-support';

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

const fresh = (label: string) => `demo-new-${label}-${Date.now().toString(36)}@example.test`;

async function noticeTargets(userId: string): Promise<string[]> {
  const rows = await getDb().execute<{ to_email: string }>(
    sql`SELECT to_email FROM email_delivery WHERE user_id = ${userId} AND template = 'notice' ORDER BY created_at`,
  );
  return rows.rows.map((row) => row.to_email);
}

describe('sign-in settings', () => {
  it('changes the password with the current one and can sign other devices out', async () => {
    const owner = await createAccount({ label: 'change-password' });
    const { browser } = await signIn(owner);
    await signIn(owner);
    expect(await sessionCount(owner.id)).toBe(2);
    const wrong = await authFetch(browser, '/change-password', { body: { currentPassword: 'not the password', newPassword: 'a new long password' } });
    expect(wrong.data?.code).toBe('INVALID_PASSWORD');
    const right = await authFetch(browser, '/change-password', {
      body: { currentPassword: owner.password, newPassword: 'a new long password', revokeOtherSessions: true },
    });
    expect(right.status).toBe(200);
    expect(await sessionCount(owner.id)).toBe(1);
    expect((await signInWith(owner.email, 'a new long password')).status).toBe(200);
  });

  it('signs out of the other devices and keeps this one', async () => {
    const owner = await createAccount({ label: 'revoke-others' });
    const { browser } = await signIn(owner);
    await signIn(owner);
    await signIn(owner);
    expect(await sessionCount(owner.id)).toBe(3);
    expect((await authFetch(browser, '/revoke-other-sessions', { body: {} })).status).toBe(200);
    expect(await sessionCount(owner.id)).toBe(1);
    expect((await authFetch(browser, '/get-session', { method: 'GET' })).data).not.toBeNull();
  });

  it('changes the address only after the new mailbox confirms it, and tells both addresses', async () => {
    const owner = await createAccount({ label: 'change-email' });
    const { browser } = await signIn(owner);
    const to = fresh('change');

    const wrong = await authFetch(browser, '/change-email', { body: { newEmail: to, password: 'not the password' } });
    expect(wrong.data?.code).toBe('INVALID_PASSWORD');
    expect((await authFetch(browser, '/change-email', { body: { newEmail: to } })).data?.code).toBe('INVALID_PASSWORD');

    const asked = await authFetch(browser, '/change-email', { body: { newEmail: to, password: owner.password } });
    expect(asked.status).toBe(200);
    // Nothing has changed yet: the link went to the new address.
    expect((await userRow(owner.id))?.email).toBe(owner.email);
    const token = await tokenFromOutbox('verify-email', to);

    const confirmed = await authFetch(browser, '/verify-email', { method: 'GET', query: { token } });
    expect(confirmed.status).toBe(200);
    const row = await userRow(owner.id);
    expect(row?.email).toBe(to);
    expect(row?.emailVerified).toBe(true);
    expect(await noticeTargets(owner.id)).toEqual(expect.arrayContaining([to, owner.email]));
    const [audit] = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'account.email_change'), eq(auditLog.subjectId, owner.id)));
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit)).not.toContain(to);

    expect((await signInWith(to, owner.password)).status).toBe(200);
    expect((await signInWith(owner.email, owner.password)).status).toBe(401);
  });

  it('refuses a change link from before the password changed, and one whose address was taken since', async () => {
    const owner = await createAccount({ label: 'change-email-stale' });
    const { browser } = await signIn(owner);
    const to = fresh('stale');
    expect((await authFetch(browser, '/change-email', { body: { newEmail: to, password: owner.password } })).status).toBe(200);
    const token = await tokenFromOutbox('verify-email', to);
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    expect(
      (await authFetch(browser, '/change-password', { body: { currentPassword: owner.password, newPassword: 'a changed long password' } })).status,
    ).toBe(200);
    const stale = await authFetch(new TestBrowser(), '/verify-email', { method: 'GET', query: { token } });
    expect(stale.data?.code).toBe('INVALID_TOKEN');
    expect((await userRow(owner.id))?.email).toBe(owner.email);

    const other = await createAccount({ label: 'change-email-taken' });
    const { browser: second } = await signIn(other);
    const taken = await createAccount({ label: 'already-there' });
    expect((await authFetch(second, '/change-email', { body: { newEmail: fresh('taken'), password: other.password } })).status).toBe(200);
    // An address that belongs to another account gets the same answer, and no link.
    expect((await authFetch(second, '/change-email', { body: { newEmail: taken.email, password: other.password } })).status).toBe(200);
  }, 20_000);

  it('wrong passwords on the address change count toward the lock', async () => {
    const owner = await createAccount({ label: 'change-email-guess' });
    const { browser } = await signIn(owner);
    const thief = () => {
      const copy = new TestBrowser();
      for (const [name, value] of browser.cookies) if (!name.includes('known_device')) copy.cookies.set(name, value);
      return copy;
    };
    for (let i = 0; i < SIGN_IN_FAILURE_LIMIT; i += 1) {
      expect((await authFetch(thief(), '/change-email', { body: { newEmail: fresh(`g${i}`), password: `guess ${i}` } })).data?.code).toBe(
        'INVALID_PASSWORD',
      );
    }
    const locked = await authFetch(thief(), '/change-email', { body: { newEmail: fresh('locked'), password: owner.password } });
    expect(locked.data?.code).toBe('TOO_MANY_ATTEMPTS');
  });
});
