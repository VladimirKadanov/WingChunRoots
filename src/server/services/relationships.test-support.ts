// Fixtures of the teacher-request integration tests (milestone M09): members with a claimed person,
// a lineage, principals as the auth layer would build them, and idempotency keys. Fictional data
// only (D20): demo- slugs and example.test addresses.

import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';

import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { authUser, lineage, person, personName } from '../db/schema';

export const meta = { requestId: 'm09-int-test', ipHmac: null };

export const key = () => randomBytes(12).toString('hex');

/** An account row: enough for the services, which take the principal (no password, no session). */
export interface Account {
  id: string;
  email: string;
}

let accounts = 0;

/**
 * An account created directly in the database, confirmed. Staff accounts have two-factor
 * authentication on (CHECK auth_user_staff_needs_2fa). Not src/server/auth/test-support.ts: only
 * test files may import that one (ESLint), and these tests need no sign-in.
 */
export async function createUser(label: string, role: Principal['user']['role'] = 'user'): Promise<Account> {
  accounts += 1;
  const id = uuidv7();
  const email = `demo-${label}-${accounts}-${randomBytes(3).toString('hex')}@example.test`;
  await getDb().insert(authUser).values({ id, email, emailVerified: true, role, twoFactorEnabled: role !== 'user' });
  return { id, email };
}

export interface Member {
  account: Account;
  principal: Principal;
  personId: string;
  slug: string;
}

/** The principal of a signed-in session; staff sessions have proved the second factor unless `unverified`. */
export function principalOf(account: Account, role: Principal['user']['role'] = 'user', opts: { unverified?: boolean } = {}): Principal {
  const staff = role !== 'user';
  return {
    user: { id: account.id, email: account.email, emailVerified: true, role, twoFactorEnabled: staff },
    session: { id: uuidv7(), expiresAt: new Date(Date.now() + 3_600_000), twoFactorVerifiedAt: staff && !opts.unverified ? new Date() : null },
    via: 'bearer',
  };
}

/**
 * An account with its own person (self-stewarded, claimed): public unless `hidden`, a Sifu account
 * when `sifu`. The name is fictional and Latin-script (the primary display name).
 */
export async function member(label: string, opts: { sifu?: boolean; hidden?: boolean; role?: 'moderator' | 'archivist' | 'admin' } = {}): Promise<Member> {
  const account = await createUser(label, opts.role ?? 'user');
  const db = getDb();
  if (opts.sifu) await db.update(authUser).set({ accountType: 'sifu' }).where(eq(authUser.id, account.id));
  const personId = uuidv7();
  const slug = `demo-${label}-${randomBytes(4).toString('hex')}`;
  await db.insert(person).values({
    id: personId,
    slug,
    kind: 'living',
    stewardship: 'self',
    claimedByUserId: account.id,
    visibility: opts.hidden ? 'involved_only' : 'public',
  });
  await db.insert(personName).values({ personId, value: `Demo ${label.replace(/-/g, ' ')}`, script: 'Latn', lang: 'en', isPrimary: true });
  return { account, principal: principalOf(account, opts.role ?? 'user'), personId, slug };
}

/** A staff account without a person (a reviewer). */
export async function staff(label: string, role: 'moderator' | 'archivist' | 'admin' = 'moderator', opts: { unverified?: boolean } = {}) {
  const account = await createUser(label, role);
  return { account, principal: principalOf(account, role, opts) };
}

export async function newLineage(label = 'm09'): Promise<string> {
  const id = uuidv7();
  await getDb().insert(lineage).values({ id, slug: `demo-${label}-${randomBytes(3).toString('hex')}`, name: `Demo ${label} Lineage` });
  return id;
}

/** One ongoing period from a year: the smallest valid request. */
export const ongoingFrom = (from = '2019-04') => [{ from, to: null, ongoing: true }];
