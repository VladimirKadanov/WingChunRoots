// Account suspension, the part every request shares (review 2026-11; docs/adr/0030-takedown-
// suspension-erasure.md). An account is suspended while auth_user.banned is set and its ban has not
// ended (ban_expires empty, or still in the future). Better Auth's admin plugin already refuses a
// new session for it; this module is the rule the rest uses: the principal of a request
// (session.ts), Better Auth's own endpoints (hooks.ts) and the administrator's service
// (services/suspension.ts). Pure: no database, no Next.js.

type Moment = Date | string | number | null | undefined;

/** Whether an account with these two columns is suspended at `now`. */
export function accountSuspended(user: { banned?: boolean | null; banExpires?: Moment }, now: Date = new Date()): boolean {
  if (user.banned !== true) return false;
  if (user.banExpires === null || user.banExpires === undefined) return true;
  const ends = new Date(user.banExpires).getTime();
  // An unreadable end date is a permanent ban, never an open door.
  return Number.isNaN(ends) || ends > now.getTime();
}

/** The message a suspended account is shown (components/account/messages.ts has the same words). */
export const SUSPENDED_MESSAGE = 'This account is suspended. Write to the pilot team if you think this is a mistake.';

/**
 * The address of an erased account (privacy.ts): its row stays as a tombstone, because other records
 * still point to it, and its address is replaced by `erased-<id>@erased.invalid`. `.invalid` never
 * resolves (RFC 2606), so nothing can be sent to it and nobody can sign up with it.
 */
export const ERASED_EMAIL_DOMAIN = 'erased.invalid';

export function erasedEmail(userId: string): string {
  return `erased-${userId}@${ERASED_EMAIL_DOMAIN}`;
}

export function isErasedEmail(email: string): boolean {
  return email.endsWith(`@${ERASED_EMAIL_DOMAIN}`);
}
