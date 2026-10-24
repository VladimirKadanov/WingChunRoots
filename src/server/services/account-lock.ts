// The one per-account lock of the M08 writes (review round 1: security-1, code-1, code-3).
//
// Every transaction that changes an account's type, its plan grants or its pilot access requests
// takes the account's auth_user row first, with SELECT ... FOR NO KEY UPDATE, before it reads or
// writes anything else: setAccountType, requestPilotAccess (services/plans.ts), createGrant and
// revokeGrant (services/grants.ts). One lock, always first, so two requests for one account wait
// in line and never deadlock.
//
// FOR NO KEY UPDATE, not FOR UPDATE: it conflicts with itself (the writers above serialize), but
// not with the FOR KEY SHARE that PostgreSQL's foreign-key check takes when another transaction
// inserts a row that references the account (a notification, a pilot request, a grant, an audit
// row's actor). With FOR UPDATE, "Request pilot access" holding its lock and inserting a request
// waited for the account type switch, which held the row and waited for the request's lock: a
// deadlock (40P01) and a 500.
//
// A writer that waits here reads after the other one commits (READ COMMITTED: each statement takes
// a new snapshot), so "Request pilot access" after a grant sees the grant, and a grant after a
// request sees the request and closes it.

import { eq } from 'drizzle-orm';

import { authUser } from '../db/schema';
import type { Executor } from '../entitlements/access';

export interface LockedAccount {
  id: string;
  email: string;
  accountType: 'student' | 'sifu';
}

/** Locks the account (by id or by e-mail) until the transaction ends; null when there is none. */
export async function lockAccount(tx: Executor, by: { id: string } | { email: string }): Promise<LockedAccount | null> {
  const [account] = await tx
    .select({ id: authUser.id, email: authUser.email, accountType: authUser.accountType })
    .from(authUser)
    .where('id' in by ? eq(authUser.id, by.id) : eq(authUser.email, by.email))
    .for('no key update');
  return account ?? null;
}
