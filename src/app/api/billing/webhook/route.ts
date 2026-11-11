import { receiveWebhook } from '@/server/billing/webhook';

// POST /api/billing/webhook (milestone M22; docs/adr/0025-billing.md): the payment provider's events
// (the test provider of this app, or Stripe in test mode). The one route outside the oRPC contract
// that changes data (plan §6.8): the provider calls it, signs every body, and expects a quick 2xx.
// src/server/billing/webhook.ts verifies the signature over the raw body, stores the event and
// queues its job; the job applies it. No body and no personal data is logged.

export async function POST(request: Request): Promise<Response> {
  return receiveWebhook(request);
}
