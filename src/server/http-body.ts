// Bounded request bodies (review 2026-11-13: auth.md 1, uploads.md 1; docs/adr/0016-photos.md, 0029).
//
// A route that reads a body reads at most a limit it names, whatever the client says about the
// length: the declared Content-Length is checked first (the common, cheap refusal), and the stream
// is counted as it is read, so a body without a length (chunked, HTTP/2) or one longer than its
// header is cut off at the limit and never buffered whole. This module is a leaf (no imports): the
// RPC handler (src/server/rpc/handler.ts), the /api/auth route, the one-click unsubscribe and the
// internal revalidation share it.
//
// Nothing here reads, logs or returns a body's content (CLAUDE.md §6).

export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** 413 in the project's plain error shape; never stored by a cache. */
export function payloadTooLarge(message = 'The request body is too large.'): Response {
  return new Response(JSON.stringify({ code: 'PAYLOAD_TOO_LARGE', message }), {
    status: 413,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** A body longer than the limit it was read with. */
export class BodyTooLargeError extends Error {
  constructor() {
    super('the request body is too large');
    this.name = 'BodyTooLargeError';
  }
}

/**
 * The refusal a request's declared Content-Length earns before its body is read: 400 for a value
 * that is not a number, 413 above `limit`; null when there is no header or it is within the limit
 * (a body without a length is counted by readBounded). Never 411: a chunked client is allowed.
 */
export function declaredLengthRefusal(request: Request, limit: number, message?: string): Response | null {
  const value = (request.headers.get('content-length') ?? '').trim();
  if (value === '') return null;
  if (!/^\d{1,16}$/.test(value)) {
    return new Response(JSON.stringify({ code: 'BAD_REQUEST', message: 'The Content-Length header is not a number.' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  return Number(value) > limit ? payloadTooLarge(message) : null;
}

/**
 * The body of `request` as bytes, reading at most `limit` of them: null when it is longer (the
 * read stops at once and the rest is cancelled, never buffered). An empty body, or none, is empty
 * bytes. Reads from the stream only; a request that has no stream has no body.
 */
export async function readBounded(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** readBounded, throwing BodyTooLargeError for a body past the limit. */
export async function readBoundedOrThrow(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const body = await readBounded(request, limit);
  if (body === null) throw new BodyTooLargeError();
  return body;
}
