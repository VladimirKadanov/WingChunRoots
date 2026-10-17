// Roles (milestone M02, In scope 2; plan §3.2): only an admin whose session proved the second
// factor changes a role; a staff role (admin, moderator, archivist) only for an account that has
// two-factor authentication on. The change ends every session of that account (database trigger
// auth_user_end_sessions, for cookie and bearer sessions alike) and is audited as role.change.
//
// DEFAULT D04: administrative roles are separate from plans and from verification: no plan or
// entitlement grants a role, and a role verifies no relationship by itself.

import { eq } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireStaff2FA } from '../auth/guards';
import { isStaffRole, type Principal, type Role, USER_ROLES } from '../auth/principal';
import { getDb } from '../db';
import { authUser } from '../db/schema';
import type { RequestMeta } from './context';
import { pgErrorOf, ServiceError } from './errors';

export const setRoleInput = z.object({
  userId: z.uuid(),
  role: z.enum(USER_ROLES),
  reason: z.string().trim().max(500).optional(),
});

export interface RoleChange {
  userId: string;
  before: Role;
  after: Role;
  changed: boolean;
}

export async function setUserRole(principal: Principal | null, raw: unknown, meta: RequestMeta): Promise<RoleChange> {
  const actor = requireStaff2FA(principal, ['admin']);
  const parsed = setRoleInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Choose an account and one of the roles.');
  const { userId, role, reason } = parsed.data;
  if (userId === actor.user.id) throw new ServiceError('FORBIDDEN', 'Another admin changes your own role.');

  return getDb()
    .transaction(async (tx) => {
      const [target] = await tx
        .select({ id: authUser.id, role: authUser.role, twoFactorEnabled: authUser.twoFactorEnabled })
        .from(authUser)
        .where(eq(authUser.id, userId))
        .for('update');
      if (!target) throw new ServiceError('NOT_FOUND', 'No such account.');
      if (target.role === role) return { userId, before: target.role, after: role, changed: false };
      if (isStaffRole(role) && !target.twoFactorEnabled) {
        throw new ServiceError('TWO_FACTOR_REQUIRED', 'The account must turn on two-factor authentication before it gets a staff role.');
      }
      await tx.update(authUser).set({ role, updatedAt: new Date() }).where(eq(authUser.id, userId));
      await writeAudit(tx, {
        action: 'role.change',
        actorUserId: actor.user.id,
        actorRole: actor.user.role,
        subjectType: 'user',
        subjectId: userId,
        before: { role: target.role },
        after: { role },
        reason: reason || null,
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      return { userId, before: target.role, after: role, changed: true };
    })
    .catch((error: unknown) => {
      // 2FA turned off between the read and the update: the CHECK is the last line (plan §3.2).
      if (pgErrorOf(error)?.constraint === 'auth_user_staff_needs_2fa') {
        throw new ServiceError('TWO_FACTOR_REQUIRED', 'The account must turn on two-factor authentication before it gets a staff role.');
      }
      throw error;
    });
}

/** What `pnpm admin:create` did (src/server/auth/cli.ts). */
export type FirstAdminOutcome = 'granted' | 'already-admin';

/**
 * `pnpm admin:create --email <address>` (milestone M02, In scope 10): makes an existing account an
 * admin from the command line of a local environment, where no admin exists yet to do it through
 * setUserRole(). The caller (the CLI) has already refused production and a non-local database.
 * The same rules as setUserRole(): only an account with a confirmed address and 2FA on gets a
 * staff role (plan §3.2); the change ends every session of the account (trigger) and is audited
 * as role.change with no actor (the person at the terminal of the local machine).
 */
export async function grantAdminFromCommandLine(email: string): Promise<FirstAdminOutcome> {
  const address = z.email().safeParse(email.trim().toLowerCase());
  if (!address.success) throw new ServiceError('BAD_REQUEST', 'That is not an e-mail address.');
  return getDb().transaction(async (tx) => {
    const [target] = await tx
      .select({ id: authUser.id, role: authUser.role, emailVerified: authUser.emailVerified, twoFactorEnabled: authUser.twoFactorEnabled })
      .from(authUser)
      .where(eq(authUser.email, address.data))
      .for('update');
    if (!target) throw new ServiceError('NOT_FOUND', 'No account has this e-mail address.');
    if (target.role === 'admin') return 'already-admin';
    if (!target.emailVerified) throw new ServiceError('CONFLICT', 'The account has not confirmed its e-mail address yet.');
    if (!target.twoFactorEnabled) {
      throw new ServiceError('TWO_FACTOR_REQUIRED', 'The account must turn on two-factor authentication before it gets a staff role.');
    }
    await tx.update(authUser).set({ role: 'admin', updatedAt: new Date() }).where(eq(authUser.id, target.id));
    await writeAudit(tx, {
      action: 'role.change',
      actorUserId: null,
      actorRole: null,
      subjectType: 'user',
      subjectId: target.id,
      before: { role: target.role },
      after: { role: 'admin' },
      reason: 'pnpm admin:create (local environment)',
    });
    return 'granted';
  });
}
