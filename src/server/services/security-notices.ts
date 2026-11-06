// Security notices (milestone M18, In scope 5; docs/adr/0021-notices.md): a changed password, two-
// factor authentication turned on or off, new backup codes and a changed e-mail address. They go to
// the dashboard and by e-mail always (category `security`, never switched off), through notify().
//
// The auth hooks call them after Better Auth has made the change (src/server/auth/hooks.ts,
// accounts.ts). A notice that cannot be written never undoes the change or fails the request: the
// failure is logged with the kind and its code only. The text names no IP address, place or device.

import { getDb } from '../db';
import { logger } from '../log';
import { notify } from './notify';

export type SecurityKind = 'security.password-changed' | 'security.two-factor-enabled' | 'security.two-factor-disabled' | 'security.backup-codes';

function failure(kind: string, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  const reason = typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? `database error ${code}` : error instanceof Error ? error.name : 'unknown error';
  logger().error(`[notify] ${kind}: the security notice could not be written (${reason})`);
}

/** Sends one security notice to the account; never throws. */
export async function sendSecurityNotice(userId: string, kind: SecurityKind): Promise<void> {
  try {
    await getDb().transaction((tx) => notify(tx, userId, kind, {}));
  } catch (error) {
    failure(kind, error);
  }
}

/**
 * The account's e-mail address changed: the notice to the new address (the account's own now) and
 * the same notice to the old one, which no longer signs in. No address in either text or payload.
 * The app has no path that changes an address yet (Better Auth's change-email is off; DEFAULT M18,
 * question 5): whoever adds one calls this after the change.
 */
export async function sendEmailChangedNotice(userId: string, previousAddress: string): Promise<void> {
  try {
    await getDb().transaction((tx) =>
      notify(tx, userId, 'security.email-changed', { side: 'new' }, { alsoTo: { address: previousAddress, payload: { side: 'old' } } }),
    );
  } catch (error) {
    failure('security.email-changed', error);
  }
}
