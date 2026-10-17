// Plan entitlements (plan §6.5). The plan matrix itself lives in code
// (src/server/entitlements/plans.ts, M08); this table records who holds which plan, from when to
// when, from which source and why. Grants are audited (grant.create, grant.revoke).

import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { GRANT_SOURCES, idColumn, inList, PLAN_CODES, timestamps } from './common';
import { organization } from './organizations';

export const entitlementGrant = pgTable(
  'entitlement_grant',
  {
    id: idColumn(),
    // The subject is exactly one of an account (auth_user, foreign key from M02) or an organization.
    subjectUserId: uuid('subject_user_id'),
    subjectOrganizationId: uuid('subject_organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    planCode: text('plan_code', { enum: PLAN_CODES }).notNull(),
    source: text('source', { enum: GRANT_SOURCES }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    grantedByUserId: uuid('granted_by_user_id'),
    reason: text('reason').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id'),
    revokeReason: text('revoke_reason'),
    ...timestamps(),
  },
  (t) => [
    index('entitlement_grant_subject_user_id_idx').on(t.subjectUserId),
    index('entitlement_grant_subject_organization_id_idx').on(t.subjectOrganizationId),
    check('entitlement_grant_one_subject', sql`num_nonnulls(${t.subjectUserId}, ${t.subjectOrganizationId}) = 1`),
    check('entitlement_grant_plan_code_check', inList(t.planCode.name, PLAN_CODES)),
    check('entitlement_grant_source_check', inList(t.source.name, GRANT_SOURCES)),
    check('entitlement_grant_period', sql`${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`),
    check('entitlement_grant_reason_not_blank', sql`btrim(${t.reason}) <> ''`),
    check('entitlement_grant_revoke_reason', sql`${t.revokedAt} IS NULL OR ${t.revokeReason} IS NOT NULL`),
  ],
);
