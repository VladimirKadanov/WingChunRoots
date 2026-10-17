// ip_hmac = HMAC-SHA-256(IP_HMAC_KEY, IP) in hex (plan §6.2, §6.4): the only form in which an IP
// address is stored, in the audit log and in auth_session.ip_address. A plain SHA-256 of an IPv4
// address is reversible by trying all 2^32 addresses; the keyed HMAC is not without the key.

import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

import { ipHmacKey } from './env';

/** The client address of a request: the first X-Forwarded-For entry, else X-Real-IP. */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const candidate = forwarded || headers.get('x-real-ip')?.trim() || '';
  return isIP(candidate) ? candidate : null;
}

/** The ip_hmac of an address, or null without one. */
export function ipHmac(ip: string | null | undefined, key: string = ipHmacKey()): string | null {
  if (!ip) return null;
  return createHmac('sha256', key).update(ip.toLowerCase()).digest('hex');
}
