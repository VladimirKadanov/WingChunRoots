// The texts of dashboard notifications (plan §6.1, §6.2; milestone M01b, In scope 3). English
// only, and the only place with notification text: a `notification` row stores a template name
// and a payload, and the dashboard (M08) renders it through renderNotification().
//
// A body is a list of segments rather than one string, so that a person's name keeps its `lang`
// attribute and translate="no" when the dashboard renders it (plan §5.3).

import { formatDay } from '../../lib/dates';
import { GRANTABLE_PLANS, type PlanCode, PLANS } from '../entitlements/plans';
import type { NameData } from './email/types';

export type NotificationSegment = { text: string } | { name: NameData };

export interface RenderedNotification {
  title: string;
  body: NotificationSegment[];
  /** A link to where the notification is acted on (M08): a local path, never another site. */
  action?: { label: string; href: string };
}

export interface NotificationTemplate<Data> {
  readonly name: string;
  /** Checks untrusted data (the jsonb payload); throws NotificationDataError. */
  parse(payload: unknown): Data;
  render(data: Data): RenderedNotification;
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

function optionalDate(template: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new NotificationDataError(template, 'endsAt must be a date');
  return value;
}

interface PilotAccessRequested {
  requestId: string;
  planCode: PlanCode;
  requester: NameData | null;
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
    };
  },
  render: ({ requestId, planCode, requester }) => ({
    title: 'Pilot access requested',
    body: [
      requester ? { name: requester } : { text: 'An account without a profile' },
      { text: ` asked for pilot access to ${PLANS[planCode].name}. There are no payments in the pilot: you can give a test plan or leave the request open.` },
    ],
    action: { label: 'Review the request', href: `/admin/grants?request=${requestId}` },
  }),
  sample: { requestId: '0190a5c0-0000-7000-8000-000000000001', planCode: 'pro_sifu', requester: { value: 'Demo Sifu Example', lang: 'und-Latn' } },
};

interface PlanGranted {
  planCode: PlanCode;
  endsAt: string | null;
}

/** "plan.granted": to the account an admin gave a test or complimentary plan (M08). */
const planGranted: NotificationTemplate<PlanGranted> = {
  name: 'plan.granted',
  parse(payload) {
    const data = payloadObject('plan.granted', payload);
    return { planCode: grantablePlan('plan.granted', data.planCode), endsAt: optionalDate('plan.granted', data.endsAt) };
  },
  render: ({ planCode, endsAt }) => ({
    title: `Pilot plan added: ${PLANS[planCode].name}`,
    body: [
      {
        text: `An administrator gave your account ${PLANS[planCode].name} for the pilot${endsAt ? `, until ${formatDay(endsAt)}` : ''}. No payment is involved.`,
      },
    ],
    action: { label: 'Open your dashboard', href: '/dashboard' },
  }),
  sample: { planCode: 'pro_sifu', endsAt: '2026-12-31T00:00:00.000Z' },
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
        text: `An administrator ended your pilot plan ${PLANS[planCode].name}. Every confirmed link stays confirmed and public; only new approvals above your plan's limit wait.`,
      },
    ],
    action: { label: 'Open your dashboard', href: '/dashboard' },
  }),
  sample: { planCode: 'pro_sifu' },
};

/** Every notification template, by name (= template.name). */
export const NOTIFICATION_TEMPLATES = {
  'mail-check.sent': mailCheckSent,
  'pilot-access.requested': pilotAccessRequested,
  'plan.granted': planGranted,
  'plan.revoked': planRevoked,
} as const;

export type NotificationTemplateName = keyof typeof NOTIFICATION_TEMPLATES;

export function isNotificationTemplateName(name: string): name is NotificationTemplateName {
  return Object.hasOwn(NOTIFICATION_TEMPLATES, name);
}

/** Renders a stored notification. Throws NotificationDataError for an unknown template or bad payload. */
export function renderNotification(template: string, payload: unknown): RenderedNotification {
  if (!isNotificationTemplateName(template)) throw new NotificationDataError(template, 'unknown template');
  const definition = NOTIFICATION_TEMPLATES[template] as NotificationTemplate<unknown>;
  return definition.render(definition.parse(payload));
}
