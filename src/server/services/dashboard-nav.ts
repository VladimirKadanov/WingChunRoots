// The dashboard's navigation (owner request 2026-11-17, docs/adr/0039-member-navigation.md): what a
// signed-in account needs to draw the grouped menu beside or above every /dashboard page, and the
// "Next steps" a new account still has to take. Only the account's own data and counts; never
// cached (the @nav slot reads it per request behind <Suspense>). Each page still guards itself:
// the menu is only a way there.

import { and, asc, count, eq, isNull } from 'drizzle-orm';

import { requireUser } from '../auth/guards';
import { isStaffRole, type Principal } from '../auth/principal';
import { getDb } from '../db';
import { notification, organization, organizationAdmin, person } from '../db/schema';
import { effectivePlan } from '../entitlements/access';
import { waitingRequests } from './dashboard';
import { instructorStatus } from './plans';

export interface DashboardNavOrganization {
  id: string;
  name: string;
  role: 'owner' | 'admin';
}

export interface DashboardNav {
  accountType: 'student' | 'sifu';
  instructor: 'not_instructor' | 'unverified' | 'verified';
  hasProfile: boolean;
  /** The slug of the account's own public or private profile: the menu links to how it reads. */
  profileSlug: string | null;
  /** A staff account without a profile: no learning or teaching sections. */
  staffOnly: boolean;
  /** The organizations this account administers (organization_admin, not revoked). */
  organizations: DashboardNavOrganization[];
  unreadNotifications: number;
  /** Student requests waiting for this Sifu's answer (pending_teacher); 0 for a student. */
  waitingStudentRequests: number;
}

export async function dashboardNav(principal: Principal | null): Promise<DashboardNav> {
  const p = requireUser(principal);
  const db = getDb();
  const [[own], effective, [unread], organizations] = await Promise.all([
    db
      .select({ id: person.id, slug: person.slug })
      .from(person)
      .where(and(eq(person.claimedByUserId, p.user.id), isNull(person.deletedAt)))
      .limit(1),
    effectivePlan({ kind: 'user', userId: p.user.id }, { db }),
    db
      .select({ n: count() })
      .from(notification)
      .where(and(eq(notification.userId, p.user.id), isNull(notification.readAt))),
    db
      .select({ id: organization.id, name: organization.name, role: organizationAdmin.role })
      .from(organizationAdmin)
      .innerJoin(organization, eq(organization.id, organizationAdmin.organizationId))
      .where(and(eq(organizationAdmin.userId, p.user.id), isNull(organizationAdmin.revokedAt)))
      .orderBy(asc(organization.name), asc(organization.id)),
  ]);
  const instructor = await instructorStatus(db, p.user.id, effective.accountType);
  const waitingStudentRequests = own && effective.accountType === 'sifu' ? await waitingRequests(db, own.id) : 0;
  return {
    accountType: effective.accountType,
    instructor,
    hasProfile: Boolean(own),
    profileSlug: own?.slug ?? null,
    staffOnly: isStaffRole(p.user.role) && !own,
    organizations: organizations.map((o) => ({ id: o.id, name: o.name, role: o.role })),
    unreadNotifications: unread?.n ?? 0,
    waitingStudentRequests,
  };
}
