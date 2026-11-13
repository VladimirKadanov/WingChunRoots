// POST /unsubscribe/one-click?token=… (milestone M18, In scope 4; RFC 8058): the address in an
// e-mail's List-Unsubscribe header. A mail client POSTs `List-Unsubscribe=One-Click` to it, and the
// category is switched off without signing in, through notifications.unsubscribe (the same procedure
// as /api/v1). The route file (src/app/unsubscribe/one-click/route.ts) calls this; a GET (a person
// who opened the address) goes to the page with its one button, there.
//
// The route is public and signed-out, so its body is bounded (review 2026-11-13, auth.md 1;
// docs/adr/0029-safety-net.md): ONE_CLICK_BODY_MAX_BYTES, by the declared Content-Length first and
// then by counting the stream, before the form is parsed. Never 411: a mail client may send the
// body chunked (HTTP/2 has no Content-Length at all) and must still unsubscribe.

import { readBounded } from './http-body';
import { ORPCError, serverClient } from './rpc/server';

const TEXT = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

/**
 * The largest body the POST takes. The real one is the 26 bytes `List-Unsubscribe=One-Click`; a
 * multipart form with its boundaries is a few hundred. DEFAULT review-2026-11: 8 KiB
 * (docs/plan/questions/review-2026-11-safety-net.md, Q3).
 */
export const ONE_CLICK_BODY_MAX_BYTES = 8 * 1024;

const tooLarge = () => new Response('This request is too large.\n', { status: 413, headers: TEXT });

/** Whether Content-Length says the body is above the limit; a value that is not a number is left to the stream count. */
function declaredTooLarge(request: Request): boolean {
  const value = (request.headers.get('content-length') ?? '').trim();
  return /^\d{1,16}$/.test(value) && Number(value) > ONE_CLICK_BODY_MAX_BYTES;
}

/**
 * RFC 8058 §3.2: the POST carries `List-Unsubscribe=One-Click` (urlencoded or multipart). 'too large'
 * when the body is past ONE_CLICK_BODY_MAX_BYTES (the rest is never read), 'no' for anything that
 * is not the one-click form.
 */
async function oneClick(request: Request): Promise<'yes' | 'no' | 'too large'> {
  if (declaredTooLarge(request)) return 'too large';
  const body = await readBounded(request, ONE_CLICK_BODY_MAX_BYTES);
  if (body === null) return 'too large';
  try {
    // The bytes read are parsed as the form they claim to be: a Response parses urlencoded and multipart alike.
    const form = await new Response(Buffer.from(body), { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData();
    return form.get('List-Unsubscribe') === 'One-Click' ? 'yes' : 'no';
  } catch {
    return 'no';
  }
}

export async function handleOneClick(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const answer = await oneClick(request);
  if (answer === 'too large') return tooLarge();
  // Anything else (a scanner, an empty POST) switches nothing off.
  if (answer !== 'yes') return new Response('Send List-Unsubscribe=One-Click, or open the address to unsubscribe.\n', { status: 400, headers: TEXT });
  try {
    const done = await serverClient(request.headers, null).notifications.unsubscribe({ token });
    return new Response(`${done.label} e-mails are off.\n`, { status: 200, headers: TEXT });
  } catch (error) {
    if (error instanceof ORPCError && (error.code === 'NOT_FOUND' || error.code === 'BAD_REQUEST')) {
      return new Response('This unsubscribe link no longer works.\n', { status: 404, headers: TEXT });
    }
    return new Response('Try again later.\n', { status: 503, headers: TEXT });
  }
}
