// The Better Auth tables in the database (milestone M02): staff roles need 2FA (CHECK), every
// session ends on a role change and when 2FA is turned on (trigger), the public role never reads
// them, and the *_user_id columns of M01 now point at auth_user.

import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authSession, authUser, authVerification, person } from './schema';
import { PG, pgError, value } from './test-support';
import { createTestDatabase, type TestDatabase } from './testing';

let db: TestDatabase;
let client: Client;
let orm: NodePgDatabase;
let publicClient: Client;

beforeAll(async () => {
  db = await createTestDatabase();
  client = new Client({ connectionString: db.roleUrl('app_rw') });
  await client.connect();
  orm = drizzle({ client });
  publicClient = new Client({ connectionString: db.roleUrl('app_public_ro') });
  await publicClient.connect();
});

afterAll(async () => {
  await client?.end();
  await publicClient?.end();
  await db?.drop();
});

let n = 0;
async function newUser(overrides: Partial<typeof authUser.$inferInsert> = {}) {
  n += 1;
  const [user] = await orm
    .insert(authUser)
    .values({ email: `demo-auth-${n}@example.test`, ...overrides })
    .returning();
  return user!;
}

async function newSession(userId: string) {
  n += 1;
  await orm.insert(authSession).values({ userId, token: `demo-token-${n}`, expiresAt: new Date(Date.now() + 3_600_000) });
}

const sessionCount = (userId: string) =>
  value<number>(client, 'SELECT count(*)::int FROM auth_session WHERE user_id = $1', [userId]);

describe('auth_user', () => {
  it('refuses a staff role for an account without two-factor authentication', async () => {
    for (const role of ['admin', 'moderator', 'archivist'] as const) {
      const error = await pgError(newUser({ role }));
      expect(error.code, role).toBe(PG.checkViolation);
      expect(error.constraint, role).toBe('auth_user_staff_needs_2fa');
    }
    const user = await newUser();
    const error = await pgError(orm.update(authUser).set({ role: 'admin' }).where(eq(authUser.id, user.id)));
    expect(error.constraint).toBe('auth_user_staff_needs_2fa');
    const staff = await newUser({ role: 'archivist', twoFactorEnabled: true });
    const off = await pgError(orm.update(authUser).set({ twoFactorEnabled: false }).where(eq(authUser.id, staff.id)));
    expect(off.constraint).toBe('auth_user_staff_needs_2fa');
  });

  it('refuses an unknown role and an e-mail address with capitals', async () => {
    expect((await pgError(newUser({ role: 'owner' as 'user' }))).constraint).toBe('auth_user_role_check');
    expect((await pgError(newUser({ email: 'Demo-Caps@example.test' }))).constraint).toBe('auth_user_email_lowercase');
  });
});

describe('ending sessions (plan §3.2)', () => {
  it('deletes every session and verification value of an account when its role changes', async () => {
    const user = await newUser({ twoFactorEnabled: true });
    await newSession(user.id);
    await newSession(user.id);
    await orm.insert(authVerification).values({ identifier: 'demo-trust-device', value: user.id, expiresAt: new Date(Date.now() + 60_000) });
    const other = await newUser();
    await newSession(other.id);

    await orm.update(authUser).set({ role: 'moderator' }).where(eq(authUser.id, user.id));
    expect(await sessionCount(user.id)).toBe(0);
    expect(await value<number>(client, 'SELECT count(*)::int FROM auth_verification WHERE value = $1', [user.id])).toBe(0);
    expect(await sessionCount(other.id)).toBe(1);

    await newSession(user.id);
    await orm.update(authUser).set({ role: 'user' }).where(eq(authUser.id, user.id));
    expect(await sessionCount(user.id)).toBe(0);
  });

  it('deletes every session when two-factor authentication is turned on, not on other changes', async () => {
    const user = await newUser();
    await newSession(user.id);
    await orm.update(authUser).set({ name: 'Demo Renamed', emailVerified: true }).where(eq(authUser.id, user.id));
    expect(await sessionCount(user.id)).toBe(1);
    await orm.update(authUser).set({ twoFactorEnabled: true }).where(eq(authUser.id, user.id));
    expect(await sessionCount(user.id)).toBe(0);
    // Turning it off ends nothing (a staff account cannot: CHECK above).
    await newSession(user.id);
    await orm.update(authUser).set({ twoFactorEnabled: false }).where(eq(authUser.id, user.id));
    expect(await sessionCount(user.id)).toBe(1);
  });
});

describe('privileges and foreign keys', () => {
  it('app_public_ro cannot read any auth table', async () => {
    for (const table of ['auth_user', 'auth_session', 'auth_account', 'auth_verification', 'auth_two_factor']) {
      const error = await pgError(publicClient.query(`SELECT 1 FROM ${table} LIMIT 1`));
      expect(error.code, table).toBe(PG.insufficientPrivilege);
    }
  });

  it('person.claimed_by_user_id must name an account', async () => {
    const error = await pgError(
      orm.insert(person).values({ slug: 'demo-auth-orphan', kind: 'living', stewardship: 'self', claimedByUserId: '01890000-0000-7000-8000-000000000000' }),
    );
    expect(error.code).toBe(PG.foreignKeyViolation);
    const user = await newUser();
    const [p] = await orm.insert(person).values({ slug: 'demo-auth-own', kind: 'living', stewardship: 'self', claimedByUserId: user.id }).returning();
    expect(p!.claimedByUserId).toBe(user.id);
  });
});
