// The stored copy of a provider event (milestone M22; docs/adr/0025-billing.md; plan §6.4): the
// verified raw event with everything personal or card-related removed before it reaches the
// database. A deny list of keys (card data, billing details, names, e-mail and postal addresses,
// phones, tax ids, free text a customer typed) at every depth, and any string value that looks like
// an e-mail address. The app reads only the normalized event; this copy is for staff reading the
// history.

const REMOVED_KEYS = new Set([
  'address',
  'billing_details',
  'card',
  'card_present',
  'customer_address',
  'customer_details',
  'customer_email',
  'customer_name',
  'customer_phone',
  'customer_shipping',
  'customer_tax_ids',
  'custom_fields',
  'description',
  'email',
  'footer',
  'iban',
  'ip_address',
  'last4',
  'name',
  'payment_method',
  'payment_method_details',
  'payment_method_options',
  'phone',
  'receipt_email',
  'shipping',
  'shipping_details',
  'statement_descriptor',
  'tax_ids',
  'us_bank_account',
  'sepa_debit',
  'fingerprint',
]);

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const MAX_DEPTH = 12;

/** The event without the removed keys; e-mail-like strings become "[removed]". */
export function redactEvent(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[removed]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactEvent(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (REMOVED_KEYS.has(key)) continue;
      out[key] = redactEvent(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return EMAIL.test(value) ? '[removed]' : value.length > 500 ? `${value.slice(0, 500)}…` : value;
  return value;
}
