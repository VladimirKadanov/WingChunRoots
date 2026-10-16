// The mail interfaces (plan §6.1; milestone M01b, In scope 3).
//
//   Mailer        send({ template, to, data, idempotencyKey }): renders the template, records the
//                 delivery in email_delivery (one row per idempotency key) and hands the message to
//                 a transport. Retries and their cap are the job queue's (src/server/jobs).
//   MailTransport delivers a rendered message: SMTP (Mailpit locally and in CI) or files (cloud
//                 sessions). A provider for real e-mail arrives with hosting (plan §3.3) as one more
//                 transport, without changes to the callers.

import type { EmailTemplateData, EmailTemplateName } from '../templates/email';

/** A rendered message, ready for a transport. */
export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Message-ID header, derived from the delivery id so a resent message keeps the same id. */
  messageId: string;
  headers: Record<string, string>;
}

export type MailTransportKind = 'smtp' | 'file';

export interface MailTransport {
  readonly kind: MailTransportKind;
  /** Delivers the message or throws; the result is the id the transport assigned. */
  deliver(message: MailMessage): Promise<{ messageId: string }>;
  close(): Promise<void>;
}

export interface SendInput<N extends EmailTemplateName = EmailTemplateName> {
  template: N;
  to: string;
  data: EmailTemplateData<N>;
  /**
   * One e-mail per key, however often send() or queueEmail() is called with it. Built from ids (for
   * example `auth.magic-link:<token id>`), never from personal data: the key outlives the address
   * in email_delivery (retention), so `@` is refused. Reusing a key for another recipient or
   * template is a MailInputError.
   */
  idempotencyKey: string;
  /** The account the e-mail belongs to, when there is one. */
  userId?: string | null;
}

export interface SendResult {
  deliveryId: string;
  status: 'sent' | 'failed';
  /** True when an earlier call with the same key already decided the outcome. */
  duplicate: boolean;
}

export interface Mailer {
  send<N extends EmailTemplateName>(input: SendInput<N>): Promise<SendResult>;
  /** Marks a delivery that is still queued as failed (after the last attempt). */
  markFailed(deliveryId: string, reason: string): Promise<boolean>;
}
