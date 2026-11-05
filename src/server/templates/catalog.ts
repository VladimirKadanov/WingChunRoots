// The notification catalog (milestone M18, In scope 1; docs/adr/0021-notices.md): one entry for
// every kind of notice the app sends, with its category, its channels and whether its e-mail is on
// by default. src/server/services/notify.ts reads it for every notice; templates.test.ts checks that
// no kind is outside it and no kind lacks a text.
//
// Channels:
// - dashboard: always (DEFAULT M18, question 1): every notice is in /dashboard/notifications.
// - email: null (dashboard only), 'notice' (the generic e-mail, src/server/templates/email/notice.tsx,
//   which renders the notice's own text from notifications.ts), or a dedicated e-mail template of
//   M09–M10b, which the sender fills with its own data.
//
// Whether an e-mail goes out (notify.ts): the kind has an e-mail channel, and its category cannot be
// switched off (security, account) or the account's choice for the category says yes; without a
// choice, the kind's `emailDefault`.

import { NOTIFICATION_CATEGORIES } from '../db/schema/common';
import type { EmailTemplateName } from './email';
import type { NotificationTemplateName } from './notifications';

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export { NOTIFICATION_CATEGORIES };

export interface CategoryDefinition {
  /** The heading of the category in /dashboard/settings and on the unsubscribe page. */
  label: string;
  /** What the category's notices are about, one sentence. */
  description: string;
  /** False for security and the legal notices of the account: their e-mail is never switched off. */
  optOut: boolean;
  /** The e-mail of the category without a choice of the account (DEFAULT M18, question 1). */
  emailDefault: boolean;
}

/**
 * DEFAULT M18 (question 1): e-mail is on by default for security, account, plan, teaching, review,
 * schools and organizations, and off for events (as in M17); security and account cannot be
 * switched off.
 */
export const CATEGORIES: Readonly<Record<NotificationCategory, CategoryDefinition>> = {
  security: {
    label: 'Security',
    description: 'Your password, two-factor authentication, backup codes and e-mail address.',
    optOut: false,
    emailDefault: true,
  },
  account: {
    label: 'Account',
    description: 'Deletion of your account, changes to the terms, and content the moderators removed, with their reason.',
    optOut: false,
    emailDefault: true,
  },
  plan: { label: 'Plan', description: 'Your plan, its end date, and the limits of your plan.', optOut: true, emailDefault: true },
  teaching: {
    label: 'Teachers and students',
    description: 'Requests, approvals, invitations and ended training between you and your teachers or students.',
    optOut: true,
    emailDefault: true,
  },
  review: {
    label: 'Reviews',
    description: 'Decisions of the reviewers about your claims, your instructor verification and arbitration.',
    optOut: true,
    emailDefault: true,
  },
  schools: { label: 'Schools', description: 'The review of the schools you listed.', optOut: true, emailDefault: true },
  organizations: { label: 'Organizations', description: 'The review of your organization and its schools.', optOut: true, emailDefault: true },
  events: {
    label: 'Events',
    description: 'Events your teachers publish or cancel (Premium Student).',
    optOut: true,
    emailDefault: false,
  },
};

export type EmailChannel = null | 'notice' | EmailTemplateName;

export interface CatalogEntry {
  category: NotificationCategory;
  /** The e-mail of the kind, or null for the dashboard only. */
  email: EmailChannel;
  /** Whether the e-mail goes out when the account has made no choice for the category. */
  emailDefault: boolean;
}

const dashboardOnly = (category: NotificationCategory): CatalogEntry => ({ category, email: null, emailDefault: false });
const mailed = (category: NotificationCategory, email: Exclude<EmailChannel, null>): CatalogEntry => ({
  category,
  email,
  emailDefault: CATEGORIES[category].emailDefault,
});

/**
 * Every kind of notice. The kinds of M02–M17 keep their channels: a dedicated e-mail stays the one
 * it was, a dashboard-only notice stays dashboard-only, except the four that M18 adds an e-mail to
 * (In scope 5): relationship.ended, invitation.claimed, school.reviewed and organization.reviewed
 * (DEFAULT M18, question 4: every stage and decision, not only the accepting ones).
 */
export const NOTIFICATION_CATALOG = {
  // M01b, M07, M08: system and staff notices, and the plan notices of an admin's grant.
  'mail-check.sent': dashboardOnly('account'),
  'account.deletion-requested': dashboardOnly('account'),
  'pilot-access.requested': dashboardOnly('plan'),
  'pilot-access.closed': dashboardOnly('plan'),
  'plan.granted': dashboardOnly('plan'),
  'plan.revoked': dashboardOnly('plan'),
  // M09: teacher requests (their e-mails since M09).
  'relationship.requested': mailed('teaching', 'relationship-requested'),
  'relationship.approved': mailed('teaching', 'relationship-approved'),
  'relationship.rejected': mailed('teaching', 'relationship-rejected'),
  'relationship.ended': mailed('teaching', 'notice'),
  // M10a, M10b: reviews (staff notices stay in the dashboard).
  'review.decided': mailed('review', 'review-decided'),
  'review.opened': dashboardOnly('review'),
  'review.updated': dashboardOnly('review'),
  'claim.decided': mailed('review', 'claim-decided'),
  'invitation.claimed': mailed('teaching', 'notice'),
  'instructor.decided': mailed('review', 'instructor-decided'),
  // DEFAULT D19: both parties of an arbitration, its decision included (e-mailed since M10b).
  'relationship.arbitration': mailed('review', 'relationship-arbitration'),
  // M11: school listings.
  'school.submitted': dashboardOnly('schools'),
  'school.reviewed': mailed('schools', 'notice'),
  // M15: organizations.
  'organization.reviewed': mailed('organizations', 'notice'),
  'organization.admin_added': dashboardOnly('organizations'),
  'organization.school_requested': dashboardOnly('organizations'),
  'organization.school_answered': dashboardOnly('organizations'),
  // M17: events (DEFAULT M17, question 3: e-mail off by default; an account may switch it on).
  'event.published': mailed('events', 'notice'),
  'event.cancelled': mailed('events', 'notice'),
  // M18: security (e-mail always), the end of a plan, a limit (dashboard only; DEFAULT M18,
  // question 2), and content removed by the moderators (a statement of reasons: never off).
  'security.password-changed': mailed('security', 'notice'),
  'security.two-factor-enabled': mailed('security', 'notice'),
  'security.two-factor-disabled': mailed('security', 'notice'),
  'security.backup-codes': mailed('security', 'notice'),
  'security.email-changed': mailed('security', 'notice'),
  'plan.expiring': mailed('plan', 'notice'),
  'plan.expired': mailed('plan', 'notice'),
  'limit.reached': dashboardOnly('plan'),
  'content.removed': mailed('account', 'notice'),
} as const satisfies Record<NotificationTemplateName, CatalogEntry>;

export type NotificationKind = keyof typeof NOTIFICATION_CATALOG;

export function isNotificationKind(kind: string): kind is NotificationKind {
  return Object.hasOwn(NOTIFICATION_CATALOG, kind);
}

export function catalogEntry(kind: NotificationKind): CatalogEntry {
  return NOTIFICATION_CATALOG[kind];
}

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return typeof value === 'string' && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

/** The kinds of a category, for the dashboard's filter. */
export function kindsOf(category: NotificationCategory): NotificationKind[] {
  return (Object.keys(NOTIFICATION_CATALOG) as NotificationKind[]).filter((kind) => NOTIFICATION_CATALOG[kind].category === category);
}

/**
 * Whether a kind is e-mailed to an account (In scope 2, 3): it has an e-mail channel, and its
 * category cannot be switched off, or the account's choice says yes, or without a choice the kind's
 * default. `choice` is the account's notification_preference.email for the category, if any.
 */
export function emailWanted(kind: NotificationKind, choice: boolean | undefined): boolean {
  const entry = NOTIFICATION_CATALOG[kind];
  if (entry.email === null) return false;
  if (!CATEGORIES[entry.category].optOut) return true;
  return choice ?? entry.emailDefault;
}
