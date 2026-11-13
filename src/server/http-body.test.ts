// Bounded request bodies (src/server/http-body.ts; review 2026-11-13, auth.md 1): the shared reader
// of /api/auth, the one-click unsubscribe and the internal revalidation. A body is cut off at its
// limit however the client sizes it: an honest Content-Length is refused before the stream is
// touched, and a body without one (chunked) or longer than its header is counted as it is read.

import { describe, expect, it } from 'vitest';

import { BodyTooLargeError, declaredLengthRefusal, payloadTooLarge, readBounded, readBoundedOrThrow } from './http-body';

const URL_OF = 'http://localhost:3100/api/auth/sign-in/email';

/** A chunked body of `chunks` pieces of `size` bytes with no Content-Length; counts the pieces pulled. */
function chunked(size: number, chunks: number, headers: Record<string, string> = {}) {
  const pulled = { count: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled.count === chunks) return controller.close();
      pulled.count += 1;
      controller.enqueue(new Uint8Array(size).fill(0x61));
    },
    cancel() {
      pulled.cancelled = true;
    },
  });
  const request = new Request(URL_OF, { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
  return { request, pulled };
}

describe('readBounded', () => {
  it('returns the whole body when it is exactly the limit, and null one byte over', async () => {
    const exact = new Request(URL_OF, { method: 'POST', body: new Uint8Array(1000).fill(0x61) });
    expect((await readBounded(exact, 1000))?.byteLength).toBe(1000);
    const over = new Request(URL_OF, { method: 'POST', body: new Uint8Array(1001).fill(0x61) });
    expect(await readBounded(over, 1000)).toBeNull();
  });

  it('reads an empty body, or none, as empty bytes', async () => {
    expect((await readBounded(new Request(URL_OF, { method: 'POST' }), 10))?.byteLength).toBe(0);
    expect((await readBounded(new Request(URL_OF, { method: 'POST', body: '' }), 10))?.byteLength).toBe(0);
  });

  it('stops a chunked body without a length past the limit and cancels the rest', async () => {
    const { request, pulled } = chunked(1024, 100_000);
    expect(request.headers.has('content-length')).toBe(false);
    expect(await readBounded(request, 64 * 1024)).toBeNull();
    // One piece past the limit, plus at most one the stream had queued.
    expect(pulled.count).toBeGreaterThanOrEqual(65);
    expect(pulled.count).toBeLessThanOrEqual(66);
    expect(pulled.cancelled).toBe(true);
  });

  it('counts the stream, not the header: a body longer than its Content-Length is cut off too', async () => {
    const { request, pulled } = chunked(1024, 100_000, { 'content-length': '10' });
    expect(await readBounded(request, 64 * 1024)).toBeNull();
    expect(pulled.cancelled).toBe(true);
  });

  it('a chunked body of exactly the limit is read whole', async () => {
    const { request } = chunked(1024, 64);
    expect((await readBounded(request, 64 * 1024))?.byteLength).toBe(64 * 1024);
  });

  it('readBoundedOrThrow throws BodyTooLargeError past the limit', async () => {
    const request = new Request(URL_OF, { method: 'POST', body: new Uint8Array(11) });
    await expect(readBoundedOrThrow(request, 10)).rejects.toBeInstanceOf(BodyTooLargeError);
    const fits = new Request(URL_OF, { method: 'POST', body: new Uint8Array(10) });
    expect((await readBoundedOrThrow(fits, 10)).byteLength).toBe(10);
  });
});

describe('declaredLengthRefusal', () => {
  const withLength = (value: string) => ({ headers: new Headers({ 'content-length': value }) }) as unknown as Request;

  it('is null without a Content-Length (never 411) and within the limit', () => {
    expect(declaredLengthRefusal(new Request(URL_OF, { method: 'POST' }), 100)).toBeNull();
    expect(declaredLengthRefusal(withLength('0'), 100)).toBeNull();
    expect(declaredLengthRefusal(withLength('100'), 100)).toBeNull();
  });

  it('answers 413 in the plain error shape one byte over the limit, and 400 for a value that is not a number', async () => {
    const over = declaredLengthRefusal(withLength('101'), 100, 'Too much.');
    expect(over?.status).toBe(413);
    expect(over?.headers.get('cache-control')).toBe('no-store');
    expect(await over?.json()).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: 'Too much.' });
    for (const value of ['abc', '-1', '1e3', '12 34', '99999999999999999']) {
      expect(declaredLengthRefusal(withLength(value), 100)?.status, value).toBe(400);
    }
  });

  it('payloadTooLarge names no content of the body', async () => {
    const response = payloadTooLarge();
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' });
  });
});
