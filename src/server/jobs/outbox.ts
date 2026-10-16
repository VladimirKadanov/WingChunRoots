// The outbox (plan §6.1; milestone M01b, In scope 2): a job is created in the transaction of the
// change that causes it. pg-boss writes the job through the caller's Drizzle transaction
// (fromDrizzle), so it commits with the change or disappears with its rollback; the worker never
// sees a job for a change that did not happen.

import { eq, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss, type SendOptions } from 'pg-boss';

import type { Database } from '../db';
import { emailDelivery } from '../db/schema';
import { checkAddress, checkIdempotencyKey } from '../mail/mailer';
import type { SendInput } from '../mail/types';
import { EMAIL_TEMPLATES, type EmailTemplateName, isEmailTemplateName, TemplateDataError } from '../templates/email';
import type { EmailTemplate } from '../templates/email/types';
import { getProducer } from './boss';
import { type JobData, QUEUE, type QueueName } from './queues';

/** A Drizzle transaction on the app_rw database. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Creates a job inside `tx`. `boss` defaults to this process's producer. Returns the job id, or
 * null when pg-boss dropped it (a singleton key that is already queued).
 */
export async function enqueue<Q extends QueueName>(
  tx: Transaction,
  queue: Q,
  data: JobData[Q],
  options: Omit<SendOptions, 'db'> = {},
  boss?: PgBoss,
): Promise<string | null> {
  const producer = boss ?? (await getProducer());
  return producer.send(queue, data as object, { ...options, db: fromDrizzle(tx, sql) });
}

export interface QueuedEmail {
  deliveryId: string;
  /** False when the idempotency key already had a delivery: nothing new was queued. */
  queued: boolean;
}

/**
 * Queues an e-mail inside `tx`: the email_delivery row (status `queued`) and the email.send job,
 * both committed or rolled back with the caller's change. One delivery per idempotency key: a
 * second call with the same key queues nothing and returns the first delivery. The template data
 * is checked here, so a bad call fails in the service that made it.
 */
export async function queueEmail<N extends EmailTemplateName>(
  tx: Transaction,
  input: SendInput<N>,
  boss?: PgBoss,
): Promise<QueuedEmail> {
  const idempotencyKey = checkIdempotencyKey(input.idempotencyKey);
  const to = checkAddress(input.to);
  if (!isEmailTemplateName(input.template)) throw new TemplateDataError(String(input.template), 'unknown template');
  const data = (EMAIL_TEMPLATES[input.template] as EmailTemplate<unknown>).parse(input.data);

  const [created] = await tx
    .insert(emailDelivery)
    .values({ toEmail: to, template: input.template, idempotencyKey, userId: input.userId ?? null })
    .onConflictDoNothing({ target: emailDelivery.idempotencyKey })
    .returning({ id: emailDelivery.id });
  if (!created) {
    const [existing] = await tx
      .select({ id: emailDelivery.id })
      .from(emailDelivery)
      .where(eq(emailDelivery.idempotencyKey, idempotencyKey));
    if (!existing) throw new Error('email_delivery: the conflicting row is not visible');
    return { deliveryId: existing.id, queued: false };
  }
  await enqueue(tx, QUEUE.emailSend, { deliveryId: created.id, data }, {}, boss);
  return { deliveryId: created.id, queued: true };
}
