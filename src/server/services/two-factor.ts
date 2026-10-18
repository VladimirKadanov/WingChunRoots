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

import { requireUser } from '../auth/guards';
import { isStaffRole, type Principal } from '../auth/principal';
import { readTwoFactor } from '../auth/totp';

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
