// POST /api/billing/webhook (milestone M22; docs/adr/0025-billing.md; plan §"Фаза 2"): where the
// provider's events arrive, from Stripe (test mode) or from the test provider of this process.
//
// The handler only records: it verifies the signature over the raw body (signature.ts), reads the
// event, stores it in billing_event (unique per provider and event id; a redacted copy of the raw
// event, never card data) and, in the same transaction, queues the job `billing.event` that applies
// it (src/server/services/billing.ts, through src/server/jobs/billing.ts). Then it answers 200 at
// once. A duplicate delivery is stored and queued once: the second answer is 200 too, so the
// provider stops retrying. A bad signature gets 400 and changes nothing.
//
// Logs carry the provider, the event id and its type only: never the body (plan §6.4).

import { getDb } from '../db';
import { billingEvent } from '../db/schema';
import { enqueue } from '../jobs/outbox';
import { QUEUE } from '../jobs/queues';
import { logger } from '../log';
import { billingProvider } from './provider';
import { type BillingProvider, WebhookSignatureError } from './types';

/** The largest event body read (Stripe's events are far below it). */
export const WEBHOOK_MAX_BODY = 256 * 1024;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** The body as text, or null when it is longer than `max` bytes (the rest is not read). */
async function readAtMost(request: Request, max: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** The provider subscription an event is about, when it names one. */
function objectIdOf(event: ReturnType<BillingProvider['verifyWebhook']>): string | null {
  const n = event.normalized;
  if (n.kind === 'subscription') return n.subscription.id;
  if (n.kind === 'invoice') return n.invoice.subscriptionId;
  if (n.kind === 'checkout') return n.subscriptionId;
  return null;
}

export interface ReceiveOptions {
  provider?: BillingProvider;
  now?: Date;
}

/** Verifies, stores and queues one provider event; answers the provider. */
export async function receiveWebhook(request: Request, options: ReceiveOptions = {}): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  const length = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(length) || length > WEBHOOK_MAX_BODY) return json(413, { error: 'PAYLOAD_TOO_LARGE' });
  const body = await readAtMost(request, WEBHOOK_MAX_BODY);
  if (body === null) return json(413, { error: 'PAYLOAD_TOO_LARGE' });

  const provider = options.provider ?? billingProvider();
  let event: ReturnType<BillingProvider['verifyWebhook']>;
  try {
    event = provider.verifyWebhook(body, request.headers, options.now ?? new Date());
  } catch (error) {
    if (error instanceof WebhookSignatureError) {
      logger().warn(`[billing] ${provider.name} webhook refused: ${error.message}`);
      return json(400, { error: 'BAD_SIGNATURE', message: 'The event could not be verified.' });
    }
    throw error;
  }
  if (event.normalized.kind === 'ignored') {
    logger().info(`[billing] ${event.provider} event ${event.eventId} (${event.type}): not used`);
    return json(200, { received: true });
  }

  const stored = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(billingEvent)
      .values({
        provider: event.provider,
        providerEventId: event.eventId,
        providerType: event.type,
        normalized: event.normalized,
        raw: event.raw as Record<string, unknown>,
        objectId: objectIdOf(event),
        providerCreatedAt: event.createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: billingEvent.id });
    if (!row) return false;
    await enqueue(tx, QUEUE.billingEvent, { eventId: row.id }, { singletonKey: `${event.provider}:${event.eventId}` });
    return true;
  });
  logger().info(`[billing] ${event.provider} event ${event.eventId} (${event.type}): ${stored ? 'stored' : 'already stored'}`);
  return json(200, { received: true });
}
