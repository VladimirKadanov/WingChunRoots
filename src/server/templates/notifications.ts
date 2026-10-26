// The texts of dashboard notifications (plan §6.1, §6.2; milestone M01b, In scope 3). English
// only, and the only place with notification text: a `notification` row stores a template name
// and a payload, and the dashboard (M08) renders it through renderNotification().
//
// A body is a list of segments rather than one string, so that a person's name keeps its `lang`
// attribute and translate="no" when the dashboard renders it (plan §5.3).

import { formatDay, untilPlanEnd } from '../../lib/dates';
import { GRANTABLE_PLANS, type PlanCode, PLANS } from '../entitlements/plans';
import type { NameData } from './email/types';

export type NotificationSegment = { text: string } | { name: NameData };

export interface RenderedNotification {
  title: string;
  body: NotificationSegment[];
  /** A link to where the notification is acted on (M08): a local path, never another site. */
  action?: { label: string; href: string };
}

/** What the stored row adds to its payload: when the notification was created. */
export interface NotificationContext {
  createdAt?: Date;
}

export interface NotificationTemplate<Data> {
  readonly name: string;
  /** Checks untrusted data (the jsonb payload); throws NotificationDataError. */
  parse(payload: unknown): Data;
  render(data: Data, context: NotificationContext): RenderedNotification;
  /** Fictional example data (D20) for the tests. */
  readonly sample: Data;
}

export class NotificationDataError extends Error {
  constructor(template: string, problem: string) {
    super(`notification ${template}: ${problem}`);
    this.name = 'NotificationDataError';
  }
}

/** "mail-check.sent": a mail check was sent to the address of the account (pnpm mail:check). */
const mailCheckSent: NotificationTemplate<Record<string, never>> = {
  name: 'mail-check.sent',
  parse(payload) {
    if (payload !== undefined && payload !== null && (typeof payload !== 'object' || Array.isArray(payload))) {
      throw new NotificationDataError('mail-check.sent', 'payload must be an object');
    }
    return {};
  },
  render: () => ({
    title: 'Mail check sent',
    body: [{ text: 'A test message was sent to the e-mail address of your account. You do not need to do anything.' }],
  }),
  sample: {},
};

// --- Plans (M08) ---------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

function payloadObject(template: string, payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new NotificationDataError(template, 'payload must be an object');
  }
  return payload as Record<string, unknown>;
}

function grantablePlan(template: string, value: unknown): PlanCode {
  if (typeof value !== 'string' || !(GRANTABLE_PLANS as readonly string[]).includes(value)) {
    throw new NotificationDataError(template, 'planCode must be a plan an admin can grant');
  }
  return value as PlanCode;
}

function optionalName(template: string, value: unknown): NameData | null {
  if (value === undefined || value === null) return null;
  const { value: text, lang } = value as Partial<Record<keyof NameData, unknown>>;
  if (typeof text !== 'string' || text.trim() === '' || text.length > 200 || typeof lang !== 'string' || !LANG.test(lang)) {
    throw new NotificationDataError(template, 'requester must be a name with a language tag');
  }
  return { value: text.trim(), lang };
}

function optionalDate(template: string, key: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new NotificationDataError(template, `${key} must be a date`);
  return value;
}

interface PilotAccessRequested {
  requestId: string;
  planCode: PlanCode;
  /**
   * Not stored: services/notifications.ts adds the requester's current name (null without a
   * profile) when an admin's list is read, and `requesterDeleted` when the account is gone.
   */
  requester: NameData | null;
  requesterDeleted: boolean;
  /**
   * Not stored either: true when the session reading the list has not proved the second factor
   * (M08 review round 2, recheck-1). The text then names neither the account nor the plan.
   */
  requesterHidden: boolean;
  /**
   * Not stored either (M08 final check, screens-4): true once the request is no longer open, given
   * or closed, by this admin or another. The notification then says so and offers no review.
   */
  answered: boolean;
}

/**
 * "pilot-access.requested": to every admin, when an account asks for pilot access from an
 * upgrade prompt (plan §5.6). No payment exists in the pilot; the admin may give a test plan.
 */
const pilotAccessRequested: NotificationTemplate<PilotAccessRequested> = {
  name: 'pilot-access.requested',
  parse(payload) {
    const data = payloadObject('pilot-access.requested', payload);
    if (typeof data.requestId !== 'string' || !UUID.test(data.requestId)) {
      throw new NotificationDataError('pilot-access.requested', 'requestId must be a UUID');
    }
    return {
      requestId: data.requestId,
      planCode: grantablePlan('pilot-access.requested', data.planCode),
      requester: optionalName('pilot-access.requested', data.requester),
      requesterDeleted: data.requesterDeleted === true,
      requesterHidden: data.requesterHidden === true,
      answered: data.answered === true,
    };
  },
  render: ({ requestId, planCode, requester, requesterDeleted, requesterHidden, answered }) =>
    requesterHidden
      ? {
          title: 'Pilot access requested',
          body: [{ text: 'An account asked for pilot access. Confirm this session with your authenticator app to see who asked and for which plan.' }],
          // /admin/grants asks for the second factor first and then opens the request (recheck-7).
          action: { label: 'Review the request', href: `/admin/grants?request=${requestId}#give-plan` },
        }
      : requesterDeleted
      ? {
          title: 'Pilot access requested',
          body: [{ text: `A since deleted account asked for pilot access to ${PLANS[planCode].name}. The request was removed with the account.` }],
        }
      : answered
      ? {
          title: 'Pilot access requested',
          // Given or closed, possibly by another administrator: nothing left to review (screens-4).
          body: [
            requester ? { name: requester } : { text: 'An account without a profile' },
            { text: ` asked for ${PLANS[planCode].name}. The request has already been answered.` },
          ],
        }
      : {
          title: 'Pilot access requested',
          body: [requester ? { name: requester } : { text: 'An account without a profile' }, { text: ` asked for ${PLANS[planCode].name}.` }],
          // Straight to the form, filled in with the request (/admin/grants opens it for ?request=).
          action: { label: 'Review the request', href: `/admin/grants?request=${requestId}#give-plan` },
        },
  sample: {
    requestId: '0190a5c0-0000-7000-8000-000000000001',
    planCode: 'pro_sifu',
    requester: { value: 'Demo Sifu Example', lang: 'und-Latn' },
    requesterDeleted: false,
    requesterHidden: false,
    answered: false,
  },
};

interface PlanGranted {
  planCode: PlanCode;
  /** The grant's start; null in rows written before review round 1 (they started at once). */
  startsAt: string | null;
  endsAt: string | null;
}

/** The plan notifications lead to the account's plan, not to the dashboard they are shown on. */
const SEE_YOUR_PLAN = { label: 'See your plan', href: '/dashboard/settings' } as const;

/**
 * "plan.granted": to the account an admin gave a test or complimentary plan (M08). A grant that
 * starts after the notification says from when (review round 1, security-4): until then the
 * account's plan has not changed.
 */
const planGranted: NotificationTemplate<PlanGranted> = {
  name: 'plan.granted',
  parse(payload) {
    const data = payloadObject('plan.granted', payload);
    return {
      planCode: grantablePlan('plan.granted', data.planCode),
      startsAt: optionalDate('plan.granted', 'startsAt', data.startsAt),
      endsAt: optionalDate('plan.granted', 'endsAt', data.endsAt),
    };
  },
  render: ({ planCode, startsAt, endsAt }, { createdAt }) => {
    const later = startsAt !== null && createdAt !== undefined && Date.parse(startsAt) > createdAt.getTime();
    const from = later ? ` from ${formatDay(startsAt)}` : '';
    return {
      title: `Pilot plan added: ${PLANS[planCode].name}`,
      body: [
        {
          text: `An administrator gave your account ${PLANS[planCode].name} for the pilot${from}${endsAt ? `, ${untilPlanEnd(endsAt)}` : ''}. No payment is involved.`,
        },
      ],
      action: SEE_YOUR_PLAN,
    };
  },
  sample: { planCode: 'pro_sifu', startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2026-12-31T00:00:00.000Z' },
};

/** "plan.revoked": to the account whose test or complimentary plan an admin ended (M08). */
const planRevoked: NotificationTemplate<{ planCode: PlanCode }> = {
  name: 'plan.revoked',
  parse(payload) {
    return { planCode: grantablePlan('plan.revoked', payloadObject('plan.revoked', payload).planCode) };
  },
  render: ({ planCode }) => ({
    title: `Pilot plan ended: ${PLANS[planCode].name}`,
    body: [
      {
        // A Student plan approves nobody, so only a Sifu plan speaks of approvals (DEFAULT D06/D08).
        text:
          PLANS[planCode].audience === 'sifu'
            ? `An administrator ended your pilot plan ${PLANS[planCode].name}. Every confirmed link stays confirmed and public; only new approvals above your plan's limit wait.`
            : `An administrator ended your pilot plan ${PLANS[planCode].name}. Your profile and every confirmed link stay as they are.`,
      },
    ],
    action: SEE_YOUR_PLAN,
  }),
  sample: { planCode: 'pro_sifu' },
};

/**
 * "pilot-access.closed": to the account whose pilot access request an admin closed without giving
 * the plan (M08 review round 2, recheck-5). The admin's reason stays in the audit log.
 */
const pilotAccessClosed: NotificationTemplate<{ planCode: PlanCode }> = {
  name: 'pilot-access.closed',
  parse(payload) {
    return { planCode: grantablePlan('pilot-access.closed', payloadObject('pilot-access.closed', payload).planCode) };
  },
  render: ({ planCode }) => ({
    title: 'Pilot access request closed',
    body: [
      {
        text: `An administrator closed your request for pilot access to ${PLANS[planCode].name} without giving the plan. Your plan has not changed and nothing is charged.`,
      },
    ],
    action: SEE_YOUR_PLAN,
  }),
  sample: { planCode: 'pro_sifu' },
};

// --- Account deletion (M07) -----------------------------------------------------------------------

/**
 * "account.deletion-requested": to every admin, when an account asks to be deleted from
 * /account/privacy (milestone M07). The payload holds the review case id only; /admin lists who
 * asked, for a session that proved the second factor.
 */
const accountDeletionRequested: NotificationTemplate<{ caseId: string }> = {
  name: 'account.deletion-requested',
  parse(payload) {
    const data = payloadObject('account.deletion-requested', payload);
    if (typeof data.caseId !== 'string' || !UUID.test(data.caseId)) {
      throw new NotificationDataError('account.deletion-requested', 'caseId must be a UUID');
    }
    return { caseId: data.caseId };
  },
  render: () => ({
    title: 'Account deletion requested',
    body: [
      {
        text: 'An account asked to be deleted. Carry the request out from the administration page: the account’s data is deleted, and relationships that others verified stay as historical records until the legal review.',
      },
    ],
    action: { label: 'See deletion requests', href: '/admin#deletion-requests' },
  }),
  sample: { caseId: '0190a5c0-0000-7000-8000-000000000002' },
};

/** Every notification template, by name (= template.name). */
export const NOTIFICATION_TEMPLATES = {
  'mail-check.sent': mailCheckSent,
  'account.deletion-requested': accountDeletionRequested,
  'pilot-access.requested': pilotAccessRequested,
  'pilot-access.closed': pilotAccessClosed,
  'plan.granted': planGranted,
  'plan.revoked': planRevoked,
} as const;

export type NotificationTemplateName = keyof typeof NOTIFICATION_TEMPLATES;

export function isNotificationTemplateName(name: string): name is NotificationTemplateName {
  return Object.hasOwn(NOTIFICATION_TEMPLATES, name);
}

/** Renders a stored notification. Throws NotificationDataError for an unknown template or bad payload. */
export function renderNotification(template: string, payload: unknown, context: NotificationContext = {}): RenderedNotification {
  if (!isNotificationTemplateName(template)) throw new NotificationDataError(template, 'unknown template');
  const definition = NOTIFICATION_TEMPLATES[template] as NotificationTemplate<unknown>;
  return definition.render(definition.parse(payload), context);
}
