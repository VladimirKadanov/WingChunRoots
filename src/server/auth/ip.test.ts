// clientIp(): which X-Forwarded-For entry is the client (docs/adr/0004-auth.md §7).

import { describe, expect, it } from 'vitest';

import { clientIp, ipHmac, normalizeIp, proxyList, withClientIp } from './ip';

const h = (xff?: string, extra: Record<string, string> = {}) => new Headers({ ...(xff === undefined ? {} : { 'x-forwarded-for': xff }), ...extra });

describe('normalizeIp', () => {
  it.each([
    ['198.51.100.7', '198.51.100.7'],
    ['::ffff:198.51.100.7', '198.51.100.7'],
    ['::FFFF:c633:6407', '198.51.100.7'],
    ['2001:db8:1:2:3:4:5:6', '2001:0db8:0001:0002:0000:0000:0000:0000'],
    ['2001:DB8::1', '2001:0db8:0000:0000:0000:0000:0000:0000'],
    ['fe80::1%eth0', 'fe80:0000:0000:0000:0000:0000:0000:0000'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeIp(input)).toBe(expected);
  });

  it('refuses what is not an address', () => {
    expect(normalizeIp('example.test')).toBeNull();
    expect(normalizeIp('198.51.100.300')).toBeNull();
  });
});

describe('clientIp without trusted proxies', () => {
  it('takes a single-entry header', () => {
    expect(clientIp(h('198.51.100.7'), [])).toBe('198.51.100.7');
    expect(clientIp(h(' 2001:db8::1 '), [])).toBe('2001:0db8:0000:0000:0000:0000:0000:0000');
  });

  it('believes no entry of a chain: the leftmost is whatever the client sent', () => {
    expect(clientIp(h('203.0.113.9, 198.51.100.7'), [])).toBeNull();
  });

  it('ignores X-Real-IP and missing or invalid headers', () => {
    expect(clientIp(h(undefined, { 'x-real-ip': '198.51.100.7' }), [])).toBeNull();
    expect(clientIp(h(''), [])).toBeNull();
    expect(clientIp(h('not-an-address'), [])).toBeNull();
  });
});

describe('clientIp with trusted proxies', () => {
  const proxies = ['10.0.0.0/8', '2001:db8:ffff::/48', '192.0.2.1'];

  it('walks from the right past the trusted proxies', () => {
    expect(clientIp(h('203.0.113.9, 198.51.100.7, 10.1.2.3'), proxies)).toBe('198.51.100.7');
    expect(clientIp(h('198.51.100.7, 192.0.2.1'), proxies)).toBe('198.51.100.7');
    expect(clientIp(h('198.51.100.7, 2001:db8:ffff::5'), proxies)).toBe('198.51.100.7');
  });

  it('a forged leftmost entry never wins over the address the proxy appended', () => {
    expect(clientIp(h('10.9.9.9, 198.51.100.7'), proxies)).toBe('198.51.100.7');
  });

  it('treats an IPv4-mapped proxy address as the proxy', () => {
    expect(clientIp(h('198.51.100.7, ::ffff:10.0.0.1'), proxies)).toBe('198.51.100.7');
  });

  it('returns null when every entry is a proxy or an entry is not an address', () => {
    expect(clientIp(h('10.0.0.1, 10.0.0.2'), proxies)).toBeNull();
    expect(clientIp(h('junk, 10.0.0.2'), proxies)).toBeNull();
  });

  it('refuses an invalid TRUSTED_PROXIES entry', () => {
    expect(() => proxyList(['10.0.0.0/33'])).toThrow(/TRUSTED_PROXIES/);
    expect(() => proxyList(['proxy.example'])).toThrow(/TRUSTED_PROXIES/);
  });
});

describe('withClientIp', () => {
  it('hands on the resolved address alone, or no header at all', () => {
    expect(withClientIp(h('198.51.100.7', { 'x-real-ip': '203.0.113.1' }), []).get('x-forwarded-for')).toBe('198.51.100.7');
    expect(withClientIp(h('198.51.100.7', { 'x-real-ip': '203.0.113.1' }), []).get('x-real-ip')).toBeNull();
    expect(withClientIp(h('203.0.113.9, 198.51.100.7'), []).has('x-forwarded-for')).toBe(false);
    expect(withClientIp(h('203.0.113.9, 198.51.100.7, 10.0.0.1'), ['10.0.0.0/8']).get('x-forwarded-for')).toBe('198.51.100.7');
  });
});

describe('ipHmac', () => {
  it('is a keyed hash in hex, the same for the same address', () => {
    const key = 'demo-ip-hmac-key-for-unit-tests-0000';
    expect(ipHmac('198.51.100.7', key)).toMatch(/^[0-9a-f]{64}$/);
    expect(ipHmac('198.51.100.7', key)).toBe(ipHmac('198.51.100.7', key));
    expect(ipHmac('198.51.100.7', key)).not.toBe(ipHmac('198.51.100.7', `${key}-2`));
    expect(ipHmac(null, key)).toBeNull();
  });
});
