// `pnpm admin:create --email <address>` (milestone M02, In scope 10) against a throwaway database:
// the command itself (it prints no secret and not the address), the rules of plan §3.2 (a confirmed
// address and 2FA first), the ended sessions and the role.change audit row.

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDb } from '../db';
import { auditLog, authUser } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { createAccount, sessionCount, signIn, startAuthTestDatabase, stopAuthTestDatabase, userRow } from './test-support';

const run = promisify(execFile);
// tsx's CLI entry run by this Node, not node_modules/.bin/tsx: that is a shell script, which
// execFile cannot start on Windows.
const require = createRequire(import.meta.url);
const TSX_CLI = path.join(path.dirname(require.resolve('tsx/package.json')), (require('tsx/package.json') as { bin: string }).bin);
const TSX_ARGS = [TSX_CLI, 'src/server/auth/cli.ts'];

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

/** Runs the command as `pnpm admin:create` does, on the test database; never throws. */
async function adminCreate(...args: string[]): Promise<{ code: number; out: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: testDb.url, NODE_ENV: 'development' };
  try {
    const { stdout, stderr } = await run(process.execPath, [...TSX_ARGS, ...args], { env });
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === 'number' ? e.code : 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function expectNoSecrets(out: string, email: string) {
  expect(out).not.toContain(email);
  expect(out).not.toMatch(/postgres:\/\//);
  for (const name of ['BETTER_AUTH_SECRET', 'IP_HMAC_KEY', 'DB_APP_RW_PASSWORD', 'DB_MIGRATOR_PASSWORD']) {
    const value = process.env[name];
    if (value) expect(out).not.toContain(value);
  }
}

describe('pnpm admin:create', () => {
  it('prints the usage without --email', async () => {
    const result = await adminCreate();
    expect(result.code).toBe(2);
    expect(result.out).toContain('usage: pnpm admin:create --email <address>');
  });

  it('makes an account with 2FA an admin, ends its sessions and writes role.change', async () => {
    const account = await createAccount({ twoFactor: true, label: 'first-admin' });
    await signIn(account);
    expect(await sessionCount(account.id)).toBe(1);

    const result = await adminCreate('--email', account.email.toUpperCase());
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain('the account is now an admin');
    expectNoSecrets(result.out, account.email);
    expect((await userRow(account.id))?.role).toBe('admin');
    expect(await sessionCount(account.id)).toBe(0);
    const audit = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'role.change'), eq(auditLog.subjectId, account.id)));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: null, before: { role: 'user' }, after: { role: 'admin' } });

    const again = await adminCreate(`--email=${account.email}`);
    expect(again.code).toBe(0);
    expect(again.out).toContain('already an admin');
  });

  it('refuses an account without 2FA, an unconfirmed address and an unknown address', async () => {
    const plain = await createAccount({ label: 'no-2fa' });
    const no2fa = await adminCreate('--email', plain.email);
    expect(no2fa.code).toBe(1);
    expect(no2fa.out).toContain('turn on two-factor authentication');
    expectNoSecrets(no2fa.out, plain.email);
    expect((await userRow(plain.id))?.role).toBe('user');

    const unconfirmed = await createAccount({ twoFactor: true, label: 'unconfirmed' });
    await getDb().update(authUser).set({ emailVerified: false }).where(eq(authUser.id, unconfirmed.id));
    const notConfirmed = await adminCreate('--email', unconfirmed.email);
    expect(notConfirmed.code).toBe(1);
    expect(notConfirmed.out).toContain('has not confirmed its e-mail address');
    expect((await userRow(unconfirmed.id))?.role).toBe('user');

    const unknown = await adminCreate('--email', 'demo-nobody@example.test');
    expect(unknown.code).toBe(1);
    expect(unknown.out).toContain('No account has this e-mail address');
  });

  it('refuses with NODE_ENV=production', async () => {
    const account = await createAccount({ twoFactor: true, label: 'prod' });
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: testDb.url, NODE_ENV: 'production' };
    const result = await run(process.execPath, [...TSX_ARGS, '--email', account.email], { env }).catch(
      (error: { code?: number; stderr?: string }) => ({ code: error.code, stdout: '', stderr: error.stderr ?? '' }),
    );
    expect((result as { code?: number }).code).toBe(1);
    expect(result.stderr).toContain('NODE_ENV=production');
    expect((await userRow(account.id))?.role).toBe('user');
  });
});
