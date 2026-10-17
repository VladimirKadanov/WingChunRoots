// The Mailer (plan §6.1; milestone M01b, In scope 3): one email_delivery row per idempotency key,
// at most one successful delivery per row, and every attempt recorded.
//
// send() locks the row (FOR UPDATE SKIP LOCKED) for the length of one attempt, so two workers can
// never deliver the same key at once. Delivery is at least once: if the process dies after the
// SMTP server accepted the message but before the row says `sent`, the retry sends it again with
// the same Message-ID, which lets the receiving side recognise the duplicate.
//
// Nothing here logs: errors stored in email_delivery.error have e-mail addresses removed (plan §6.4).

import { and, eq, sql } from 'drizzle-orm';

import type { Database } from '../db';
import { emailDelivery } from '../db/schema';
import { isEmailTemplateName, renderEmail, TemplateDataError } from '../templates/email';
import { redactAddresses } from './redact';
import type { Mailer, MailTransport, SendResult } from './types';

export { redactAddresses };

/** The transport failed; the job queue retries the attempt. */
export class MailDeliveryError extends Error {
  constructor(
    readonly deliveryId: string,
    readonly reason: string,
  ) {
    super(`delivery ${deliveryId} failed: ${reason}`);
    this.name = 'MailDeliveryError';
  }
}

/** Another attempt holds the delivery right now; try again later. */
export class MailBusyError extends Error {
  constructor(readonly deliveryId: string) {
    super(`delivery ${deliveryId} is being attempted elsewhere`);
    this.name = 'MailBusyError';
  }
}

/** Input that can never be sent: a bad address or key. Permanent. */
export class MailInputError extends Error {
  constructor(problem: string) {
    super(problem);
    this.name = 'MailInputError';
  }
}

const ADDRESS_PART = '[^\\s@<>()\\[\\]\\\\,;:"]+';
const ADDRESS = new RegExp(`^${ADDRESS_PART}@${ADDRESS_PART}\\.${ADDRESS_PART}$`);

/** One plain address (no display name, no list); anything else could inject headers. */
export function checkAddress(to: string): string {
  const address = typeof to === 'string' ? to.trim() : '';
  if (address.length > 254 || !ADDRESS.test(address)) throw new MailInputError('the recipient is not one plain e-mail address');
  return address;
}

/**
 * Printable ASCII without spaces and without `@`, 1 to 200 characters. email_delivery keeps the key
 * after the retention job has erased the address (src/server/services/retention.ts), so a key must
 * never hold personal data: ids (a user, an invitation, a random UUID), never an address or a name.
 * Refusing `@` stops the most likely mistake, an address in the key.
 */
export function checkIdempotencyKey(key: string): string {
  if (typeof key !== 'string' || !/^[\x21-\x3f\x41-\x7e]{1,200}$/.test(key)) {
    throw new MailInputError(
      'the idempotency key must be 1 to 200 printable ASCII characters without spaces or "@"; it must not hold personal data',
    );
  }
  return key;
}

/**
 * A key names one e-mail. Reusing it for another recipient or template is a bug of the caller that
 * would otherwise drop the new e-mail silently (or render the stored template with the wrong data).
 * An address the retention job has erased can no longer be compared; the template still is.
 */
export function checkSameEmail(
  existing: { toEmail: string | null; template: string },
  input: { to: string; template: string },
): void {
  const otherAddress = existing.toEmail !== null && existing.toEmail.toLowerCase() !== input.to.toLowerCase();
  if (otherAddress || existing.template !== input.template) {
    throw new MailInputError('the idempotency key was used for another e-mail (another recipient or template)');
  }
}

/** An error as text for email_delivery.error: code, SMTP status, message; addresses removed. */
export function describeError(error: unknown): string {
  const e = (error ?? {}) as { code?: unknown; responseCode?: unknown; message?: unknown };
  const parts: string[] = [];
  if (typeof e.code === 'string') parts.push(e.code);
  if (typeof e.responseCode === 'number') parts.push(`SMTP ${e.responseCode}`);
  parts.push(typeof e.message === 'string' ? e.message : String(error));
  return redactAddresses(parts.join(': ')).replace(/\s+/g, ' ').trim().slice(0, 500);
}

/** The domain of the sender, for Message-ID. */
function senderDomain(from: string): string {
  const match = /@([^>\s]+)>?\s*$/.exec(from);
  return match?.[1] ?? 'wingchunroots.test';
}

type Attempt = { result: SendResult } | { failure: MailDeliveryError };

export function createMailer({ db, transport, from }: { db: Database; transport: MailTransport; from: string }): Mailer {
  const domain = senderDomain(from);

  async function send(input: Parameters<Mailer['send']>[0]): Promise<SendResult> {
    const idempotencyKey = checkIdempotencyKey(input.idempotencyKey);
    const to = checkAddress(input.to);
    if (!isEmailTemplateName(input.template)) throw new TemplateDataError(String(input.template), 'unknown template');

    // One row per key, whoever comes first (queueEmail() normally created it already).
    await db
      .insert(emailDelivery)
      .values({ toEmail: to, template: input.template, idempotencyKey, userId: input.userId ?? null })
      .onConflictDoNothing({ target: emailDelivery.idempotencyKey });

    const attempt = await db.transaction(async (tx): Promise<Attempt> => {
      const [row] = await tx
        .select()
        .from(emailDelivery)
        .where(eq(emailDelivery.idempotencyKey, idempotencyKey))
        .for('update', { skipLocked: true });
      if (!row) {
        const [held] = await tx
          .select({ id: emailDelivery.id })
          .from(emailDelivery)
          .where(eq(emailDelivery.idempotencyKey, idempotencyKey));
        throw new MailBusyError(held?.id ?? 'unknown');
      }
      checkSameEmail(row, { to, template: input.template });
      if (row.status !== 'queued') return { result: { deliveryId: row.id, status: row.status, duplicate: true } };

      const recorded = { attempts: sql`${emailDelivery.attempts} + 1`, lastAttemptAt: sql`now()` };
      let rendered;
      try {
        rendered = await renderEmail(row.template, input.data);
      } catch (error) {
        if (!(error instanceof TemplateDataError)) throw error;
        // Data the template refuses never improves: fail now, without retries.
        await tx
          .update(emailDelivery)
          .set({ ...recorded, status: 'failed', error: describeError(error) })
          .where(eq(emailDelivery.id, row.id));
        return { result: { deliveryId: row.id, status: 'failed', duplicate: false } };
      }

      try {
        const { messageId } = await transport.deliver({
          from,
          to: row.toEmail ?? to,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          messageId: `<${row.id}@${domain}>`,
          headers: {
            // RFC 3834: no auto-replies to an automatic message.
            'Auto-Submitted': 'auto-generated',
            'X-WingChunRoots-Delivery': row.id,
            'X-WingChunRoots-Template': row.template,
          },
        });
        await tx
          .update(emailDelivery)
          .set({ ...recorded, status: 'sent', sentAt: sql`now()`, providerMessageId: messageId, error: null })
          .where(eq(emailDelivery.id, row.id));
        return { result: { deliveryId: row.id, status: 'sent', duplicate: false } };
      } catch (error) {
        const reason = describeError(error);
        // Recorded and committed; the error is thrown after the commit so the queue retries.
        await tx
          .update(emailDelivery)
          .set({ ...recorded, error: reason })
          .where(eq(emailDelivery.id, row.id));
        return { failure: new MailDeliveryError(row.id, reason) };
      }
    });
    if ('failure' in attempt) throw attempt.failure;
    return attempt.result;
  }

  async function markFailed(deliveryId: string, reason: string): Promise<boolean> {
    const rows = await db
      .update(emailDelivery)
      // The error of the last attempt, when one was recorded, says more than the reason.
      .set({ status: 'failed', error: sql`coalesce(${emailDelivery.error}, ${redactAddresses(reason).slice(0, 500)})` })
      .where(and(eq(emailDelivery.id, deliveryId), eq(emailDelivery.status, 'queued')))
      .returning({ id: emailDelivery.id });
    return rows.length > 0;
  }

  return { send, markFailed };
}
