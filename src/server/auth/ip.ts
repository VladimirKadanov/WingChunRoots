// The client address of a request, and ip_hmac (plan §6.2, §6.4; milestone M02).
//
// clientIp() is the one place that reads X-Forwarded-For. The leftmost entry is whatever the
// client sent, so it is never trusted on its own:
//
// - With TRUSTED_PROXIES (IP addresses or CIDR ranges of the reverse proxies in front of the app),
//   the chain is walked from the right, skipping trusted proxies; the first other entry is the
//   client. This is the same rule as Better Auth's `advanced.ipAddress.trustedProxies`.
// - Without it, only a single-entry header is used. `next start` sets the header to the socket
//   address only when the request has none, so a client that talks to `next start` directly can
//   still choose its address: per-address limits are then advisory, which is why production
//   refuses to start without TRUSTED_PROXIES behind a public origin (env.ts) and why the limits
//   that matter are per e-mail address (throttle.ts).
//
// The address is normalised (an IPv4-mapped IPv6 address becomes IPv4; IPv6 is cut to its /64,
// like Better Auth's rate limiter), and withClientIp() hands Better Auth exactly that one address,
// so the rate-limit key, auth_session.ip_address and the audit log all see the same client.
//
// ip_hmac = HMAC-SHA-256(IP_HMAC_KEY, address) in hex: the only form in which an address is stored.
// A plain SHA-256 of an IPv4 address is reversible by trying all 2^32 addresses; the HMAC is not
// without the key.

import { createHmac } from 'node:crypto';
import { BlockList, isIP, isIPv4 } from 'node:net';

import { ipHmacKey, trustedProxies } from './env';

/** An address in canonical form: IPv4 as is, IPv4-mapped IPv6 as IPv4, other IPv6 cut to /64. */
export function normalizeIp(ip: string): string | null {
  const family = isIP(ip);
  if (family === 4) return ip;
  if (family !== 6) return null;
  const groups = expandIPv6(ip);
  if (!groups) return null;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return `${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`;
  }
  return [...groups.slice(0, 4), 0, 0, 0, 0].map((g) => g.toString(16).padStart(4, '0')).join(':');
}

function expandIPv6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  // A trailing dotted IPv4 part (::ffff:192.0.2.1) becomes two groups.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (isIPv4(tail)) {
    const [a, b, c, d] = tail.split('.').map(Number) as [number, number, number, number];
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [left, right] = text.split('::') as [string, string | undefined];
  const head = left ? left.split(':') : [];
  const rest = right === undefined ? [] : right ? right.split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (right === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(right === undefined ? 0 : missing).fill('0'), ...rest].map((g) =>
    Number.parseInt(g, 16),
  );
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** A BlockList of the trusted proxies (addresses and CIDR ranges). Throws on an invalid entry. */
export function proxyList(entries: readonly string[]): BlockList {
  const list = new BlockList();
  for (const entry of entries) {
    const [address, prefix] = entry.split('/') as [string, string | undefined];
    const family = isIP(address);
    const invalid = new Error(`TRUSTED_PROXIES: "${entry}" is not an IP address or CIDR range`);
    if (!family) throw invalid;
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) {
      list.addAddress(address, type);
      continue;
    }
    if (!/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)) throw invalid;
    list.addSubnet(address, Number(prefix), type);
  }
  return list;
}

function isTrusted(list: BlockList, ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return list.check(ip, 'ipv4');
  if (family !== 6) return false;
  const mapped = normalizeIp(ip);
  return list.check(ip, 'ipv6') || (mapped !== null && isIPv4(mapped) && list.check(mapped, 'ipv4'));
}

/** The client address of a request (see the top of this file), normalised; null when unknown. */
export function clientIp(headers: Headers, proxies: readonly string[] = trustedProxies()): string | null {
  const raw = headers.get('x-forwarded-for');
  if (!raw) return null;
  const chain = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (chain.length === 0) return null;
  if (proxies.length === 0) return chain.length === 1 ? normalizeIp(chain[0]!) : null;
  const list = proxyList(proxies);
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const entry = chain[i]!;
    if (!isIP(entry)) return null;
    if (isTrusted(list, entry)) continue;
    return normalizeIp(entry);
  }
  return null;
}

/**
 * A copy of `headers` whose X-Forwarded-For is the resolved client address alone (or absent when
 * none could be resolved), without X-Real-IP: what Better Auth gets, so its rate limiter and its
 * session row use the address clientIp() chose.
 */
export function withClientIp(headers: Headers, proxies: readonly string[] = trustedProxies()): Headers {
  const copy = new Headers(headers);
  const ip = clientIp(headers, proxies);
  copy.delete('x-real-ip');
  if (ip) copy.set('x-forwarded-for', ip);
  else copy.delete('x-forwarded-for');
  return copy;
}

/** The ip_hmac of an address, or null without one. */
export function ipHmac(ip: string | null | undefined, key: string = ipHmacKey()): string | null {
  if (!ip) return null;
  return createHmac('sha256', key).update(ip.toLowerCase()).digest('hex');
}
