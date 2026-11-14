// The request handed to Better Auth by /api/auth (route.ts). Next.js passes a route a request that
// is not an instance of the runtime's own Request class; on Node.js 24 `new Request(request, …)`
// threw on it and every POST to /api/auth answered 500. authRequest builds the request from its
// parts, so a request object of any class works.

import { describe, expect, it } from 'vitest';

import { BodyTooLargeError } from '../http-body';
import { AUTH_BODY_MAX_BYTES, authRequest, handleAuthRequest } from './route';

/**
 * A request that only has the members a route reads, like one from another Request class. The
 * body is read through its stream (the route counts the bytes: a body is never read whole before
 * it is checked), so `body` is a ReadableStream, as on a request from Next.js.
 */
function foreignRequest(method: string, headers: Record<string, string>, body?: string): Request {
  return {
    url: 'http://127.0.0.1:3100/api/auth/sign-up/email?x=1',
    method,
    headers: new Headers(headers),
    body: body === undefined ? null : new Response(body).body,
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

describe('the body limit of /api/auth (review 2026-11-13, auth.md 1)', () => {
  const post = (headers: Record<string, string>, body: BodyInit | null) =>
    new Request('http://127.0.0.1:3100/api/auth/sign-in/email', { method: 'POST', headers, body });

  it('hands on a body of exactly AUTH_BODY_MAX_BYTES', async () => {
    const request = await authRequest(post({ 'content-type': 'application/json' }, 'x'.repeat(AUTH_BODY_MAX_BYTES)));
    expect((await request.arrayBuffer()).byteLength).toBe(AUTH_BODY_MAX_BYTES);
  });

  it('throws BodyTooLargeError for a body one byte longer, however the client sized it', async () => {
    await expect(authRequest(post({ 'content-type': 'application/json' }, 'x'.repeat(AUTH_BODY_MAX_BYTES + 1)))).rejects.toBeInstanceOf(BodyTooLargeError);
    // A header that understates the length does not matter: the stream is what is counted.
    const lying = {
      url: 'http://127.0.0.1:3100/api/auth/sign-in/email',
      method: 'POST',
      headers: new Headers({ 'content-length': '10' }),
      body: new Response('x'.repeat(AUTH_BODY_MAX_BYTES + 1)).body,
    } as unknown as Request;
    await expect(authRequest(lying)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('handleAuthRequest answers 413 for a declared length over the limit, without reading the body', async () => {
    let read = false;
    const request = {
      url: 'http://127.0.0.1:3100/api/auth/sign-in/email',
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json', 'content-length': String(AUTH_BODY_MAX_BYTES + 1) }),
      get body() {
        read = true;
        return null;
      },
    } as unknown as Request;
    const response = await handleAuthRequest(request);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(read).toBe(false);
  });

  it('handleAuthRequest answers 413 for a chunked body past the limit, and 400 for a Content-Length that is not a number', async () => {
    const chunked = new Request('http://127.0.0.1:3100/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(16 * 1024).fill(0x61));
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect((await handleAuthRequest(chunked)).status).toBe(413);
    const garbled = { url: 'http://127.0.0.1:3100/api/auth/sign-in/email', method: 'POST', headers: new Headers({ 'content-length': 'many' }), body: null } as unknown as Request;
    expect((await handleAuthRequest(garbled)).status).toBe(400);
  });
});
