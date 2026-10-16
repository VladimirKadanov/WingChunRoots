// The texts of dashboard notifications (plan §6.1, §6.2; milestone M01b, In scope 3). English
// only, and the only place with notification text: a `notification` row stores a template name
// and a payload, and the dashboard (M08) renders it through renderNotification().
//
// A body is a list of segments rather than one string, so that a person's name keeps its `lang`
// attribute and translate="no" when the dashboard renders it (plan §5.3).

import type { NameData } from './email/types';

export type NotificationSegment = { text: string } | { name: NameData };

export interface RenderedNotification {
  title: string;
  body: NotificationSegment[];
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

/** Every notification template, by name (= template.name). */
export const NOTIFICATION_TEMPLATES = {
  'mail-check.sent': mailCheckSent,
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
