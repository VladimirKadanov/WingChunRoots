// Webhook signatures (milestone M22; docs/adr/0025-billing.md). Both providers sign the same way
// Stripe does: a header `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` (Stripe-Signature
// for Stripe, X-WCR-Test-Signature for the test provider), checked here by hand (no provider SDK):
// every v1 value is compared in constant time, and a timestamp more than WEBHOOK_TOLERANCE_SECONDS
// from now is refused, so an old request cannot be replayed.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { WebhookSignatureError } from './types';

/** Stripe's default tolerance: five minutes. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** The header value for `body` signed with `secret` at `at` (the test provider; the tests). */
export function signPayload(body: string, secret: string, at: Date = new Date()): string {
  const t = Math.floor(at.getTime() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

/** Parses `t=…,v1=…[,v1=…]`; other schemes (v0) are ignored. */
function parseHeader(header: string): { t: number; signatures: string[] } {
  let t = Number.NaN;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === 't' && /^\d{1,12}$/.test(value)) t = Number(value);
    else if (key === 'v1' && /^[0-9a-f]{64}$/.test(value)) signatures.push(value);
  }
  return { t, signatures };
}

/**
 * Checks `header` against `body` and `secret`. Throws WebhookSignatureError for a missing or
 * malformed header, a timestamp outside the tolerance or no matching signature. The message never
 * repeats the header or the body.
 */
export function verifySignature(body: string, header: string | null, secret: string, now: Date = new Date(), toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS): void {
  if (!header || header.length > 2048) throw new WebhookSignatureError('The billing event has no signature.');
  const { t, signatures } = parseHeader(header);
  if (!Number.isFinite(t) || signatures.length === 0) throw new WebhookSignatureError('The billing event signature is malformed.');
  if (Math.abs(Math.floor(now.getTime() / 1000) - t) > toleranceSeconds) throw new WebhookSignatureError('The billing event signature is too old or from the future.');
  const expected = createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest();
  const matches = signatures.some((hex) => {
    const given = Buffer.from(hex, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!matches) throw new WebhookSignatureError();
}
