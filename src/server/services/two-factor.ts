// Two-factor authentication of the signed-in account, as /account/security and
// GET /api/v1/account/two-factor show it (milestone M02; fix round 1, findings H3 and H4).
//
// - off: no setup, or none started.
// - pending: /two-factor/enable was called and the first code is still missing.
// - on: the number of backup codes left.
//
// Neither the key of a pending setup nor the backup codes are returned here: Better Auth returns
// them once, from /two-factor/enable and /two-factor/generate-backup-codes (which take the
// password), to the client that asked, so a stolen session alone cannot read them. The web page
// keeps them for its own browser (src/server/forms/two-factor.ts).
//
// A lost second factor (review 2026-11-13, auth.md 2; docs/adr/0029-safety-net.md): the owner runs
// `pnpm account:reset-2fa` on the machine (resetTwoFactorFromCommandLine below, like `pnpm
// admin:create`). There is no HTTP path for it: nobody, staff included, can turn a second factor
// off for another account, so a stolen staff session or password cannot do it either.

import { eq } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import { isStaffRole, type Principal, type Role } from '../auth/principal';
import { readTwoFactor } from '../auth/totp';
import { getDb } from '../db';
import { authSession, authTwoFactor, authUser, authVerification } from '../db/schema';
import { ServiceError } from './errors';
import { sendSecurityNotice } from './security-notices';

export interface TwoFactorOverview {
  status: 'off' | 'pending' | 'on';
  /** This session has passed the second factor. */
  sessionVerified: boolean;
  /** Staff accounts keep it on (they cannot turn it off). */
  staff: boolean;
  /** When on: how many unused backup codes are left. */
  backupCodesLeft: number | null;
}

export async function twoFactorOverview(principal: Principal | null): Promise<TwoFactorOverview> {
  const p = requireUser(principal);
  const record = await readTwoFactor(p.user.id, p.user.email);
  const base = { sessionVerified: p.session.twoFactorVerifiedAt !== null, staff: isStaffRole(p.user.role) };
  if (p.user.twoFactorEnabled) {
    return { ...base, status: 'on', backupCodesLeft: record?.backupCodes.length ?? 0 };
  }
  if (record && !record.verified) {
    return { ...base, status: 'pending', backupCodesLeft: null };
  }
  return { ...base, status: 'off', backupCodesLeft: null };
}

export interface TwoFactorReset {
  /** False when the account had no second factor and no setup in progress: nothing was changed. */
  changed: boolean;
  /** The staff role the account lost (a staff role needs a second factor), or null. */
  roleRemoved: Role | null;
}

/**
 * `pnpm account:reset-2fa --email <address>` (review 2026-11-13, auth.md 2): removes the account's
 * second factor for good, in one transaction.
 *
 * - The TOTP secret and the backup codes (auth_two_factor), and with them a setup that was never
 *   finished and the counter of wrong codes, are deleted; two_factor_enabled is turned off.
 * - A staff role goes with it (set to 'user', audited as role.change): the database refuses a staff
 *   role without a second factor (CHECK auth_user_staff_needs_2fa; plan §3.2), and the CHECK is not
 *   loosened. The account signs in with its password, turns the second factor on again at
 *   /account/security and gets its role back (`pnpm admin:create` for an admin; /admin/users for the
 *   other roles).
 * - Every session of the account ends, and so do its short-lived values (a half-done sign-in, trusted
 *   devices, password-reset links; they carry the user id as their value): the trigger of M02 ends
 *   sessions when a role changes or two-factor turns ON, not when it turns off, so it is done here.
 * - One audit row, auth.2fa.reset, with no actor (the person at the terminal of the local machine),
 *   shapes only: whether it was on and the role before and after; no secret, no address.
 * - The account gets the security notice "Two-factor authentication turned off" (M18), by e-mail
 *   too, so a reset nobody asked for does not go unnoticed. A notice that cannot be written never
 *   undoes the reset.
 *
 * Nothing is returned that could be a secret. The caller has refused a production or remote
 * environment already (src/server/auth/reset-2fa.ts).
 */
export async function resetTwoFactorFromCommandLine(email: string): Promise<TwoFactorReset> {
  const address = z.email().safeParse(email.trim().toLowerCase());
  if (!address.success) throw new ServiceError('BAD_REQUEST', 'That is not an e-mail address.');
  const outcome = await getDb().transaction(async (tx) => {
    const [target] = await tx
      .select({ id: authUser.id, role: authUser.role, twoFactorEnabled: authUser.twoFactorEnabled })
      .from(authUser)
      .where(eq(authUser.email, address.data))
      .for('update');
    if (!target) throw new ServiceError('NOT_FOUND', 'No account has this e-mail address.');
    const [record] = await tx.select({ id: authTwoFactor.id }).from(authTwoFactor).where(eq(authTwoFactor.userId, target.id)).for('update');
    if (!target.twoFactorEnabled && !record) return { changed: false, roleRemoved: null, userId: target.id } as const;

    // DEFAULT review-2026-11: a staff role is taken away with the second factor (docs/plan/questions/
    // review-2026-11-safety-net.md, Q4); the CHECK leaves no other choice, and it is not loosened.
    const staff = isStaffRole(target.role);
    await tx.delete(authTwoFactor).where(eq(authTwoFactor.userId, target.id));
    // One UPDATE, so that the CHECK sees the role and the flag change together.
    await tx
      .update(authUser)
      .set({ twoFactorEnabled: false, ...(staff ? { role: 'user' as const } : {}), updatedAt: new Date() })
      .where(eq(authUser.id, target.id));
    await tx.delete(authSession).where(eq(authSession.userId, target.id));
    await tx.delete(authVerification).where(eq(authVerification.value, target.id));
    await writeAudit(tx, {
      action: 'auth.2fa.reset',
      actorUserId: null,
      actorRole: null,
      subjectType: 'user',
      subjectId: target.id,
      before: { twoFactorEnabled: target.twoFactorEnabled, role: target.role },
      after: { twoFactorEnabled: false, role: staff ? 'user' : target.role },
      reason: 'pnpm account:reset-2fa (local environment)',
    });
    if (staff) {
      await writeAudit(tx, {
        action: 'role.change',
        actorUserId: null,
        actorRole: null,
        subjectType: 'user',
        subjectId: target.id,
        before: { role: target.role },
        after: { role: 'user' },
        reason: 'pnpm account:reset-2fa: a staff role needs a second factor',
      });
    }
    return { changed: true, roleRemoved: staff ? target.role : null, userId: target.id } as const;
  });
  // DEFAULT review-2026-11: the account is told by e-mail (Q4), so a reset nobody asked for shows.
  if (outcome.changed) await sendSecurityNotice(outcome.userId, 'security.two-factor-disabled');
  return { changed: outcome.changed, roleRemoved: outcome.roleRemoved };
}
