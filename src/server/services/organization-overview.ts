// Journey review P2-5 (docs/adr/0082-organization-overview.md): what the dashboard home shows an
// account that administers an organization, before anything else: its members, linked schools,
// schools that have not answered, the next event, the plan and a short to-do list. Own data only:
// the organizations the signed-in account administers (organization_admin, not revoked).

import { and, asc, count, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';

import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { event, organization, organizationAdmin, organizationMembership, organizationPhoto, organizationSchool } from '../db/schema';
import { myOrganizations } from './organizations';

/** At most this many organizations on the dashboard; the rest are one click away. */
export const OVERVIEW_ORGANIZATIONS_MAX = 3;

export interface OrganizationTodo {
  key: 'logo' | 'school' | 'claim-links' | 'plan' | 'approval';
  label: string;
  href: string;
}

export interface OrganizationOverviewItem {
  id: string;
  slug: string;
  name: string;
  roleLabel: string;
  approvalLabel: string;
  approved: boolean;
  planLabel: string;
  hasPlan: boolean;
  members: number;
  schoolsLinked: number;
  schoolsWaiting: number;
  nextEvent: { title: string; slug: string; startsAt: string; timezone: string } | null;
  todo: OrganizationTodo[];
}

export interface OrganizationOverview {
  organizations: OrganizationOverviewItem[];
  /** How many organizations the account administers in all. */
  total: number;
}

/** The imported members of an organization still without a claim link (organization-claim-links.ts). */
async function membersWithoutClaimLink(organizationId: string): Promise<number> {
  const result = await getDb().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
      FROM person p
     WHERE p.deleted_at IS NULL AND p.claimed_by_user_id IS NULL AND p.stewardship = 'unclaimed'
       AND EXISTS (SELECT 1 FROM organization_import_row r JOIN organization_import i ON i.id = r.import_id
                    WHERE r.person_id = p.id AND r.status = 'imported' AND i.organization_id = ${organizationId}::uuid)
       AND EXISTS (SELECT 1 FROM organization_membership m
                    WHERE m.person_id = p.id AND m.organization_id = ${organizationId}::uuid AND (m.ends_on IS NULL OR m.ends_on >= current_date))
       AND NOT EXISTS (SELECT 1 FROM organization_claim_link l
                        WHERE l.person_id = p.id AND l.organization_id = ${organizationId}::uuid AND l.status = 'active')`);
  return result.rows[0]?.n ?? 0;
}

/** dashboard.organizations: the administered organizations at a glance, with what is left to do. */
export async function organizationOverview(principal: Principal | null, now = new Date()): Promise<OrganizationOverview> {
  const p = requireUser(principal);
  const mine = await myOrganizations(p);
  const db = getDb();
  const shown = mine.organizations.slice(0, OVERVIEW_ORGANIZATIONS_MAX);
  if (shown.length === 0) return { organizations: [], total: 0 };
  const ids = shown.map((o) => o.id);
  // Re-checked here: only organizations this account still administers, never deleted.
  const allowed = new Set(
    (
      await db
        .select({ id: organizationAdmin.organizationId })
        .from(organizationAdmin)
        .innerJoin(organization, and(eq(organization.id, organizationAdmin.organizationId), isNull(organization.deletedAt)))
        .where(and(eq(organizationAdmin.userId, p.user.id), isNull(organizationAdmin.revokedAt), inArray(organizationAdmin.organizationId, ids)))
    ).map((r) => r.id),
  );
  const today = now.toISOString().slice(0, 10);
  const items: OrganizationOverviewItem[] = [];
  for (const org of shown) {
    if (!allowed.has(org.id)) continue;
    const [members] = await db
      .select({ n: count() })
      .from(organizationMembership)
      .where(
        and(
          eq(organizationMembership.organizationId, org.id),
          or(isNull(organizationMembership.endsOn), gte(organizationMembership.endsOn, today)),
        ),
      );
    const links = await db
      .select({ status: organizationSchool.status, n: count() })
      .from(organizationSchool)
      .where(eq(organizationSchool.organizationId, org.id))
      .groupBy(organizationSchool.status);
    const linked = links.find((l) => l.status === 'accepted')?.n ?? 0;
    const waiting = links.find((l) => l.status === 'pending')?.n ?? 0;
    const [next] = await db
      .select({ title: event.title, slug: event.slug, startsAt: event.startsAt, timezone: event.timezone })
      .from(event)
      .where(and(eq(event.organizationId, org.id), eq(event.status, 'published'), gte(event.endsAt, now)))
      .orderBy(asc(event.startsAt), asc(event.id))
      .limit(1);
    const [logo] = await db
      .select({ id: organizationPhoto.id })
      .from(organizationPhoto)
      .where(and(eq(organizationPhoto.organizationId, org.id), eq(organizationPhoto.kind, 'logo'), eq(organizationPhoto.status, 'active')))
      .limit(1);
    const approved = org.status === 'active';
    const hasPlan = org.plan.code !== null;
    const base = `/dashboard/organization/${org.id}`;
    const todo: OrganizationTodo[] = [];
    if (!approved) todo.push({ key: 'approval', label: 'See the application', href: base });
    else {
      if (!hasPlan) todo.push({ key: 'plan', label: 'Choose the Federation plan', href: `${base}/billing` });
      if (!logo) todo.push({ key: 'logo', label: 'Add a logo', href: `${base}/photos` });
      if (hasPlan && linked + waiting === 0) todo.push({ key: 'school', label: 'Link a school', href: `${base}#organization-schools` });
      if (hasPlan) {
        const withoutLink = await membersWithoutClaimLink(org.id);
        if (withoutLink > 0) {
          todo.push({
            key: 'claim-links',
            label: withoutLink === 1 ? 'Pass on 1 claim link' : `Pass on ${withoutLink} claim links`,
            href: `${base}/claim-links`,
          });
        }
      }
    }
    items.push({
      id: org.id,
      slug: org.slug,
      name: org.name,
      roleLabel: org.roleLabel,
      approvalLabel: org.approvalLabel,
      approved,
      planLabel: org.plan.label,
      hasPlan,
      members: members?.n ?? 0,
      schoolsLinked: linked,
      schoolsWaiting: waiting,
      nextEvent: next ? { title: next.title, slug: next.slug, startsAt: next.startsAt.toISOString(), timezone: next.timezone } : null,
      todo,
    });
  }
  return { organizations: items, total: mine.organizations.length };
}
