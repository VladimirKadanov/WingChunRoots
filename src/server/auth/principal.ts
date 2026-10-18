// The signed-in account of a request (milestone M02): what the guards, the oRPC context and the
// services see. Built from a Better Auth session read from the cookie or from
// `Authorization: Bearer` (src/server/auth/session.ts); the same rules apply to both.

import { STAFF_ROLES, USER_ROLES } from '../db/schema/common';

export type Role = (typeof USER_ROLES)[number];
export type StaffRole = (typeof STAFF_ROLES)[number];

export interface Principal {
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    role: Role;
    twoFactorEnabled: boolean;
  };
  session: {
    id: string;
    expiresAt: Date;
    /** When this session proved the second factor (plan §3.2); null when it has not. */
    twoFactorVerifiedAt: Date | null;
  };
  /** How the request carried the session. */
  via: 'cookie' | 'bearer';
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

export { STAFF_ROLES, USER_ROLES };
