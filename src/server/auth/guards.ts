// Guards (milestone M02, In scope 2; plan §3.2): who may open a page or call a procedure.
//
//   requireUser(p)       a signed-in account                                  401
//   requireRole(p, ...r) one of the roles r                                   401 / 403
//   requireStaff2FA(p)   a staff role (admin, moderator, archivist) whose
//                        account has 2FA on AND whose session proved the
//                        second factor (two_factor_verified_at)               401 / 403
//
// They take the principal of the request (src/server/auth/session.ts) and return it narrowed, or
// throw AuthError. The same functions serve pages (through guardRoute in
// src/server/auth/web.ts), the oRPC middleware and the services, for cookie and bearer
// sessions alike. ROUTE_POLICIES lists what each protected page needs; checkRoute is the pure
// decision that pages and guards.int.test.ts's role × route matrix share.

import { ServiceError, type ServiceErrorCode } from '../services/errors';
import { isStaffRole, type Principal, type Role, STAFF_ROLES, type StaffRole } from './principal';

export class AuthError extends ServiceError {
  constructor(code: Extract<ServiceErrorCode, 'UNAUTHORIZED' | 'FORBIDDEN' | 'SECOND_FACTOR_REQUIRED'>, message: string) {
    super(code, message);
    this.name = 'AuthError';
  }
}

export function requireUser(principal: Principal | null | undefined): Principal {
  if (!principal) throw new AuthError('UNAUTHORIZED', 'Sign in to continue.');
  return principal;
}

export function requireRole<R extends Role>(principal: Principal | null | undefined, ...roles: R[]): Principal & { user: { role: R } } {
  const p = requireUser(principal);
  if (!(roles as Role[]).includes(p.user.role)) throw new AuthError('FORBIDDEN', 'Your account does not have access to this.');
  return p as Principal & { user: { role: R } };
}

/** Whether a staff session has proved the second factor (plan §3.2), not only enabled it. */
export function hasVerifiedSecondFactor(principal: Principal): boolean {
  return principal.user.twoFactorEnabled && principal.session.twoFactorVerifiedAt !== null;
}

export function requireStaff2FA(
  principal: Principal | null | undefined,
  roles: readonly StaffRole[] = STAFF_ROLES,
): Principal & { user: { role: StaffRole } } {
  const p = requireRole(principal, ...roles);
  if (!isStaffRole(p.user.role)) throw new AuthError('FORBIDDEN', 'Your account does not have access to this.');
  if (!hasVerifiedSecondFactor(p)) {
    throw new AuthError('SECOND_FACTOR_REQUIRED', 'Confirm this session with your authenticator app first.');
  }
  return p as Principal & { user: { role: StaffRole } };
}

/**
 * Whether `principal` passes requireStaff2FA(principal, roles), without throwing: for staff data
 * that a page shared with other accounts shows only to such a session (M08 review round 2,
 * recheck-1: the requester of a pilot access request, the count of open requests). The same
 * check as requireStaff2FA, so a password alone never reaches that data (plan §3.2).
 */
export function hasStaff2FA(principal: Principal | null | undefined, roles: readonly StaffRole[] = STAFF_ROLES): boolean {
  try {
    requireStaff2FA(principal, roles);
    return true;
  } catch (error) {
    if (error instanceof AuthError) return false;
    throw error;
  }
}

// --- Pages -------------------------------------------------------------------------------------

/** `roles` narrows a staff page to some staff roles (M08: /admin/grants is for admins only). */
export type RoutePolicy = { kind: 'user' } | { kind: 'staff2fa'; roles?: readonly StaffRole[] };

/** What each protected page needs. Every other page is public. */
export const ROUTE_POLICIES: Readonly<Record<string, RoutePolicy>> = {
  '/onboarding': { kind: 'user' },
  '/account': { kind: 'user' },
  '/account/security': { kind: 'user' },
  '/admin': { kind: 'staff2fa' },
  // M08: the dashboards and their settings; plan grants for admins only (plan §6.5).
  '/dashboard': { kind: 'user' },
  '/admin/grants': { kind: 'staff2fa', roles: ['admin'] },
};

export const SIGN_IN_PATH = '/sign-in';
export const SECURITY_PATH = '/account/security';

export type RouteDecision =
  | { ok: true; principal: Principal | null }
  | { ok: false; status: 401 | 403; code: AuthError['code']; redirectTo: string | null };

/** The policy of `path`: the longest protected prefix that matches it, or null for a public page. */
export function policyFor(path: string): RoutePolicy | null {
  let best: string | null = null;
  for (const prefix of Object.keys(ROUTE_POLICIES)) {
    if ((path === prefix || path.startsWith(`${prefix}/`)) && (best === null || prefix.length > best.length)) best = prefix;
  }
  return best === null ? null : ROUTE_POLICIES[best]!;
}

/**
 * A local path for `?next=`: only same-site paths, never `//host` or a scheme. The check runs
 * again on the normalised path, because dot segments can turn a local path into a
 * protocol-relative one (`/.//host` and `/a/..//host` both normalise to `//host`).
 */
export function safeNextPath(value: unknown, fallback = '/'): string {
  const local = (path: string) => path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
  if (typeof value !== 'string' || !local(value)) return fallback;
  try {
    const url = new URL(value, 'http://wcr.invalid');
    if (url.origin !== 'http://wcr.invalid') return fallback;
    const path = `${url.pathname}${url.search}`;
    return local(path) ? path : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The decision for opening `path` (which must be a pathname without a query) as `principal`:
 * a visitor without a session goes to sign-in (401), a staff session without a verified second
 * factor goes to /account/security (403), and any other refusal is a plain 403. Both come back to
 * `returnTo` afterwards (`?next=`): `path` itself, or `path` with the query the page was opened
 * with (M08 review round 2, recheck-7: /admin/grants?request=<id> keeps the request it answers).
 */
export function checkRoute(path: string, principal: Principal | null, returnTo: string = path): RouteDecision {
  const policy = policyFor(path);
  const next = encodeURIComponent(safeNextPath(returnTo, path));
  if (!policy) return { ok: true, principal };
  try {
    if (policy.kind === 'user') return { ok: true, principal: requireUser(principal) };
    return { ok: true, principal: requireStaff2FA(principal, policy.roles) };
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    if (error.code === 'UNAUTHORIZED') {
      return { ok: false, status: 401, code: error.code, redirectTo: `${SIGN_IN_PATH}?next=${next}` };
    }
    if (error.code === 'SECOND_FACTOR_REQUIRED') {
      return { ok: false, status: 403, code: error.code, redirectTo: `${SECURITY_PATH}?next=${next}` };
    }
    return { ok: false, status: 403, code: error.code, redirectTo: null };
  }
}
