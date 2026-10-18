// Plan entitlements (plan §6.5). The plan matrix itself lives in code
// (src/server/entitlements/plans.ts, M08); this table records who holds which plan, from when to
// when, from which source and why. Grants are audited (grant.create, grant.revoke).

import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { authUser } from './auth';
import { GRANT_SOURCES, idColumn, inList, PILOT_REQUEST_STATUSES, PLAN_CODES, timestamps } from './common';
import { organization } from './organizations';

export const entitlementGrant = pgTable(
  'entitlement_grant',
  {
    id: idColumn(),
    // The subject is exactly one of an account (auth_user, foreign key from M02) or an organization.
    subjectUserId: uuid('subject_user_id').references(() => authUser.id, { onDelete: 'cascade' }),
    subjectOrganizationId: uuid('subject_organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    planCode: text('plan_code', { enum: PLAN_CODES }).notNull(),
    source: text('source', { enum: GRANT_SOURCES }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    grantedByUserId: uuid('granted_by_user_id').references(() => authUser.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id').references(() => authUser.id, { onDelete: 'restrict' }),
    revokeReason: text('revoke_reason'),
    ...timestamps(),
  },
  (t) => [
    index('entitlement_grant_subject_user_id_idx').on(t.subjectUserId),
    index('entitlement_grant_subject_organization_id_idx').on(t.subjectOrganizationId),
    index('entitlement_grant_granted_by_user_id_idx').on(t.grantedByUserId),
    index('entitlement_grant_revoked_by_user_id_idx').on(t.revokedByUserId),
    check('entitlement_grant_one_subject', sql`num_nonnulls(${t.subjectUserId}, ${t.subjectOrganizationId}) = 1`),
    check('entitlement_grant_plan_code_check', inList(t.planCode.name, PLAN_CODES)),
    check('entitlement_grant_source_check', inList(t.source.name, GRANT_SOURCES)),
    check('entitlement_grant_period', sql`${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`),
    check('entitlement_grant_reason_not_blank', sql`btrim(${t.reason}) <> ''`),
    check('entitlement_grant_revoke_reason', sql`${t.revokedAt} IS NULL OR ${t.revokeReason} IS NOT NULL`),
  ],
);

/**
 * "Request pilot access" from an upgrade prompt (M08, plan §5.6): there are no payments in the
 * pilot, so the request asks an admin for a test plan, and every admin gets a notification. It
 * never creates a charge. At most one open request per account (partial unique index) and a
 * small number per month (src/server/services/plans.ts); closed when an admin grants the plan.
 */
export const pilotAccessRequest = pgTable(
  'pilot_access_request',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    planCode: text('plan_code', { enum: PLAN_CODES }).notNull(),
    status: text('status', { enum: PILOT_REQUEST_STATUSES }).notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedByUserId: uuid('closed_by_user_id').references(() => authUser.id, { onDelete: 'restrict' }),
    // The grant that answered the request, when one did.
    grantId: uuid('grant_id').references(() => entitlementGrant.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('pilot_access_request_one_open_key').on(t.userId).where(sql`${t.status} = 'open'`),
    index('pilot_access_request_user_id_idx').on(t.userId, t.createdAt),
    index('pilot_access_request_status_idx').on(t.status, t.createdAt),
    index('pilot_access_request_closed_by_user_id_idx').on(t.closedByUserId),
    index('pilot_access_request_grant_id_idx').on(t.grantId),
    check('pilot_access_request_plan_code_check', inList(t.planCode.name, PLAN_CODES)),
    check('pilot_access_request_status_check', inList(t.status.name, PILOT_REQUEST_STATUSES)),
    check('pilot_access_request_closed', sql`(${t.status} = 'open') = (${t.closedAt} IS NULL)`),
  ],
);
