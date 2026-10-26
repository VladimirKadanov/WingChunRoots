// The admin placeholder (milestone M02, In scope 7): for a staff session that proved the second
// factor, the number of e-mails that could not be delivered. Nothing personal: a count.
//
// M07: for an administrator, also the open account deletion requests (review_case of kind
// deletion_request), with the account's address and its profile, so the request can be carried
// out (docs/guides/admin-guide.bg.md). Other staff roles get no list.

import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';

import { requireStaff2FA } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { authUser, emailDelivery, person, personName, reviewCase } from '../db/schema';

export interface AdminDeletionRequest {
  caseId: string;
  status: 'open' | 'in_review' | 'needs_info';
  openedAt: string;
  /** The account that asked; null once that account is gone. */
  accountEmail: string | null;
  /** Its own profile, when it has one. */
  person: { slug: string; displayName: string; lang: string } | null;
}

export interface AdminOverview {
  failedEmailDeliveries: number;
  /** Administrators only; [] for other staff roles. */
  deletionRequests: AdminDeletionRequest[];
}

export async function adminOverview(principal: Principal | null): Promise<AdminOverview> {
  const p = requireStaff2FA(principal);
  const db = getDb();
  const [row] = await db.select({ n: count() }).from(emailDelivery).where(eq(emailDelivery.status, 'failed'));
  const deletionRequests =
    p.user.role === 'admin'
      ? await db
          .select({
            caseId: reviewCase.id,
            status: reviewCase.status,
            openedAt: reviewCase.createdAt,
            accountEmail: authUser.email,
            slug: person.slug,
            displayName: personName.value,
            lang: personName.lang,
          })
          .from(reviewCase)
          .leftJoin(authUser, eq(authUser.id, reviewCase.openedByUserId))
          .leftJoin(person, and(eq(person.id, reviewCase.personId), isNull(person.deletedAt)))
          .leftJoin(personName, and(eq(personName.personId, person.id), eq(personName.isPrimary, true)))
          .where(and(eq(reviewCase.kind, 'deletion_request'), inArray(reviewCase.status, ['open', 'in_review', 'needs_info'])))
          .orderBy(asc(reviewCase.createdAt))
      : [];
  return {
    failedEmailDeliveries: row?.n ?? 0,
    deletionRequests: deletionRequests.map((r) => ({
      caseId: r.caseId,
      status: r.status as AdminDeletionRequest['status'],
      openedAt: r.openedAt.toISOString(),
      accountEmail: r.accountEmail,
      person: r.slug && r.displayName ? { slug: r.slug, displayName: r.displayName, lang: r.lang ?? 'und-Latn' } : null,
    })),
  };
}
