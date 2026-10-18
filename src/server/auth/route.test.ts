// The request handed to Better Auth by /api/auth (route.ts). Next.js passes a route a request that
// is not an instance of the runtime's own Request class; on Node.js 24 `new Request(request, …)`
// threw on it and every POST to /api/auth answered 500. authRequest builds the request from its
// parts, so a request object of any class works.

import { describe, expect, it } from 'vitest';

import { authRequest } from './route';

/** A request that only has the members a route reads, like one from another Request class. */
function foreignRequest(method: string, headers: Record<string, string>, body?: string): Request {
  return {
    url: 'http://127.0.0.1:3100/api/auth/sign-up/email?x=1',
    method,
    headers: new Headers(headers),
    arrayBuffer: async () => new TextEncoder().encode(body ?? '').buffer,
  } as unknown as Request;
}

describe('authRequest', () => {
  it('copies the URL, method and body of a request that is not a Request instance', async () => {
    const request = await authRequest(
      foreignRequest('POST', { 'content-type': 'application/json', origin: 'http://127.0.0.1:3100' }, '{"email":"demo-route@example.test"}'),
    );
    expect(request).toBeInstanceOf(Request);
    expect(request.url).toBe('http://127.0.0.1:3100/api/auth/sign-up/email?x=1');
    expect(request.method).toBe('POST');
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(request.headers.get('origin')).toBe('http://127.0.0.1:3100');
    expect(await request.text()).toBe('{"email":"demo-route@example.test"}');
  });

  it('hands on only the client address that clientIp() resolved', async () => {
    const single = await authRequest(foreignRequest('POST', { 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.1' }, '{}'));
    expect(single.headers.get('x-forwarded-for')).toBe('203.0.113.7');
    expect(single.headers.get('x-real-ip')).toBeNull();
    // Without TRUSTED_PROXIES a chain of addresses is not believed.
    const chain = await authRequest(foreignRequest('POST', { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }, '{}'));
    expect(chain.headers.get('x-forwarded-for')).toBeNull();
  });

  it('sends no body with GET', async () => {
    const request = await authRequest(foreignRequest('GET', {}));
    expect(request.method).toBe('GET');
    expect(request.body).toBeNull();
  });
});
