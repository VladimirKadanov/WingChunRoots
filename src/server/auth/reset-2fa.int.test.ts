// `pnpm account:reset-2fa --email <address>` (review 2026-11-13, auth.md 2) against a throwaway
// database: the command itself (it prints no secret and not the address), what it removes (the TOTP
// secret and backup codes, the sessions and the short-lived values of the account), the staff role
// it takes with them (the CHECK auth_user_staff_needs_2fa stays), the audit rows and the notice,
// and the way back: password sign-in, two-factor on again, `pnpm admin:create`.

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDb } from '../db';
import { auditLog, authTwoFactor, authUser, authVerification, notification } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import {
  authFetch,
  createAccount,
  secretFromTotpUri,
  sessionCount,
  signIn,
  startAuthTestDatabase,
  stopAuthTestDatabase,
  totpCode,
  userRow,
} from './test-support';

const run = promisify(execFile);
// tsx's CLI entry run by this Node, not node_modules/.bin/tsx (a shell script, which execFile
// cannot start on Windows).
const require = createRequire(import.meta.url);
const TSX_CLI = path.join(path.dirname(require.resolve('tsx/package.json')), (require('tsx/package.json') as { bin: string }).bin);
const RESET = [TSX_CLI, 'src/server/auth/reset-2fa-cli.ts'];
const ADMIN_CREATE = [TSX_CLI, 'src/server/auth/cli.ts'];

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

/** Runs a command as `pnpm <script>` does, on the test database; never throws. */
async function command(script: string[], args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  const full: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: testDb.url, NODE_ENV: 'development', ...env };
  try {
    const { stdout, stderr } = await run(process.execPath, [...script, ...args], { env: full });
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === 'number' ? e.code : 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function expectNoSecrets(out: string, email: string) {
  expect(out).not.toContain(email);
  expect(out).not.toMatch(/postgres:\/\//);
  for (const name of ['BETTER_AUTH_SECRET', 'IP_HMAC_KEY', 'MAIL_SEAL_KEY', 'DB_APP_RW_PASSWORD', 'DB_MIGRATOR_PASSWORD']) {
    const value = process.env[name];
    if (value) expect(out).not.toContain(value);
  }
}

const auditOf = (action: string, userId: string) => getDb().select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.subjectId, userId)));
const twoFactorRows = (userId: string) => getDb().select().from(authTwoFactor).where(eq(authTwoFactor.userId, userId));

describe('pnpm account:reset-2fa', () => {
  it('prints the usage without --email', async () => {
    const result = await command(RESET, []);
    expect(result.code).toBe(2);
    expect(result.out).toContain('usage: pnpm account:reset-2fa --email <address>');
  });

  it('removes the second factor of a member: the secret and backup codes, the sessions and the short-lived values', async () => {
    const member = await createAccount({ role: 'user', twoFactor: true, label: 'lost-device' });
    await signIn(member);
    await signIn(member);
    expect(await sessionCount(member.id)).toBe(2);
    expect(await twoFactorRows(member.id)).toHaveLength(1);
    // A half-done sign-in or a trusted device carries the user id as its value.
    await getDb().insert(authVerification).values({ identifier: 'demo-hashed-identifier', value: member.id, expiresAt: new Date(Date.now() + 60_000) });

    const result = await command(RESET, ['--email', member.email.toUpperCase()]);
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain('the second factor of the account is removed');
    expect(result.out).not.toContain('staff role');
    expectNoSecrets(result.out, member.email);

    expect((await userRow(member.id))).toMatchObject({ twoFactorEnabled: false, role: 'user' });
    expect(await twoFactorRows(member.id)).toHaveLength(0);
    expect(await sessionCount(member.id)).toBe(0);
    expect(await getDb().select().from(authVerification).where(eq(authVerification.value, member.id))).toHaveLength(0);

    // Audited once, with no actor, shapes only; a member loses no role, so no role.change.
    const audit = await auditOf('auth.2fa.reset', member.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorUserId: null,
      before: { twoFactorEnabled: true, role: 'user' },
      after: { twoFactorEnabled: false, role: 'user' },
      reason: 'pnpm account:reset-2fa (local environment)',
    });
    expect(JSON.stringify(audit[0])).not.toContain(member.email);
    expect(await auditOf('role.change', member.id)).toHaveLength(0);
    // The account is told: the security notice of M18.
    const notices = await getDb().select().from(notification).where(eq(notification.userId, member.id));
    expect(notices.map((n) => n.template)).toEqual(['security.two-factor-disabled']);
  });

  it('is repeatable: an account with no second factor is left alone, with no second audit row or notice', async () => {
    const member = await createAccount({ role: 'user', twoFactor: true, label: 'twice' });
    expect((await command(RESET, ['--email', member.email])).code).toBe(0);
    await signIn(member);
    const again = await command(RESET, [`--email=${member.email}`]);
    expect(again.code, again.out).toBe(0);
    expect(again.out).toContain('nothing changed');
    // Its new session was not ended, and nothing was written twice.
    expect(await sessionCount(member.id)).toBe(1);
    expect(await auditOf('auth.2fa.reset', member.id)).toHaveLength(1);
    expect(await getDb().select().from(notification).where(eq(notification.userId, member.id))).toHaveLength(1);
  });

  it('clears a setup that was never finished, and the account may start again', async () => {
    const member = await createAccount({ label: 'half-done' });
    const { browser } = await signIn(member);
    const started = await authFetch(browser, '/two-factor/enable', { body: { password: member.password } });
    expect(started.status).toBe(200);
    expect(await twoFactorRows(member.id)).toHaveLength(1);
    expect((await userRow(member.id))?.twoFactorEnabled).toBe(false);

    const result = await command(RESET, ['--email', member.email]);
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain('removed');
    expect(await twoFactorRows(member.id)).toHaveLength(0);
    expect(await sessionCount(member.id)).toBe(0);
  });

  it('takes a staff role with it (the database keeps its rule), and the way back is password, two-factor on, admin:create', async () => {
    const admin = await createAccount({ role: 'admin', label: 'lost-admin' });
    const first = await signIn(admin);
    expect((await userRow(admin.id))?.role).toBe('admin');

    const result = await command(RESET, ['--email', admin.email]);
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain('the account was an admin');
    expect(result.out).toContain('pnpm admin:create');
    expectNoSecrets(result.out, admin.email);
    expect((await userRow(admin.id))).toMatchObject({ twoFactorEnabled: false, role: 'user' });
    expect(await sessionCount(admin.id)).toBe(0);
    // The old bearer token and cookie are dead.
    const stale = await authFetch(first.browser, '/get-session', { method: 'GET' });
    expect(stale.data).toBeNull();

    const audit = await auditOf('auth.2fa.reset', admin.id);
    expect(audit[0]).toMatchObject({ before: { twoFactorEnabled: true, role: 'admin' }, after: { twoFactorEnabled: false, role: 'user' } });
    const roleChange = await auditOf('role.change', admin.id);
    expect(roleChange).toHaveLength(1);
    expect(roleChange[0]).toMatchObject({ actorUserId: null, before: { role: 'admin' }, after: { role: 'user' } });

    // The way back. The password alone signs the account in (no second factor to ask for) ...
    const { browser } = await signIn(admin);
    const signedIn = await authFetch(browser, '/get-session', { method: 'GET' });
    expect((signedIn.data as { user?: { twoFactorEnabled?: boolean } } | null)?.user?.twoFactorEnabled).toBe(false);
    // ... it turns two-factor on again, with a new secret ...
    const enabled = await authFetch(browser, '/two-factor/enable', { body: { password: admin.password } });
    expect(enabled.status).toBe(200);
    const secret = secretFromTotpUri(String(enabled.data?.totpURI));
    expect(secret).not.toBe(admin.totpSecret);
    expect((await authFetch(browser, '/two-factor/verify-totp', { body: { code: await totpCode(secret) } })).status).toBe(200);
    expect((await userRow(admin.id))?.twoFactorEnabled).toBe(true);
    // ... and the owner gives the role back.
    const back = await command(ADMIN_CREATE, ['--email', admin.email]);
    expect(back.code, back.out).toBe(0);
    expect(back.out).toContain('the account is now an admin');
    expect((await userRow(admin.id))?.role).toBe('admin');
  });

  it('takes a moderator or an archivist back to a plain account too', async () => {
    for (const role of ['moderator', 'archivist'] as const) {
      const account = await createAccount({ role, label: `lost-${role}` });
      const result = await command(RESET, ['--email', account.email]);
      expect(result.code, result.out).toBe(0);
      expect(result.out).toContain(`the account was a ${role}`);
      expect((await userRow(account.id))).toMatchObject({ role: 'user', twoFactorEnabled: false });
    }
  });

  it('after a reset the old secret and the old backup codes are gone, so a rotated BETTER_AUTH_SECRET is no longer a lock-out', async () => {
    const staff = await createAccount({ role: 'moderator', label: 'rotated' });
    // The stored secret is unreadable (as after a rotated BETTER_AUTH_SECRET): the reset does not read it.
    await getDb().update(authTwoFactor).set({ secret: 'not-decryptable', backupCodes: 'not-decryptable' }).where(eq(authTwoFactor.userId, staff.id));
    const result = await command(RESET, ['--email', staff.email]);
    expect(result.code, result.out).toBe(0);
    expect(await twoFactorRows(staff.id)).toHaveLength(0);
    expect((await signIn({ ...staff, totpSecret: null })).token).toBeTruthy();
  });

  it('refuses an unknown address, an invalid one, production and a remote database, and changes nothing', async () => {
    const unknown = await command(RESET, ['--email', 'demo-nobody@example.test']);
    expect(unknown.code).toBe(1);
    expect(unknown.out).toContain('No account has this e-mail address');
    expect(unknown.out).not.toContain('demo-nobody@example.test');
    const invalid = await command(RESET, ['--email', 'not-an-address']);
    expect(invalid.code).toBe(1);
    expect(invalid.out).toContain('not an e-mail address');

    const member = await createAccount({ role: 'user', twoFactor: true, label: 'refused' });
    const production = await command(RESET, ['--email', member.email], { NODE_ENV: 'production' });
    expect(production.code).toBe(1);
    expect(production.out).toContain('NODE_ENV=production');
    const remote = await command(RESET, ['--email', member.email], { DATABASE_URL: 'postgres://app:secret-pw@db.example.test:5432/wingchunroots' });
    expect(remote.code).toBe(1);
    expect(remote.out).toContain('only with a database on this machine');
    expect(remote.out).not.toContain('secret-pw');
    expect((await userRow(member.id))?.twoFactorEnabled).toBe(true);
    expect(await twoFactorRows(member.id)).toHaveLength(1);
  });

  it('the CHECK that a staff role needs a second factor still holds', async () => {
    const staff = await createAccount({ role: 'moderator', label: 'check' });
    await expect(getDb().update(authUser).set({ twoFactorEnabled: false }).where(eq(authUser.id, staff.id))).rejects.toThrow();
  });
});
