// POST /unsubscribe/one-click?token=… (milestone M18, In scope 4; RFC 8058): the address in an
// e-mail's List-Unsubscribe header. A mail client POSTs `List-Unsubscribe=One-Click` to it, and the
// category is switched off without signing in, through notifications.unsubscribe (the same procedure
// as /api/v1). A GET (a person who opened the address) goes to the page with its one button.

import { ORPCError, serverClient } from '@/server/rpc/server';

const TEXT = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

/** RFC 8058 §3.2: the POST carries `List-Unsubscribe=One-Click` (urlencoded or multipart). */
async function isOneClick(request: Request): Promise<boolean> {
  try {
    return (await request.formData()).get('List-Unsubscribe') === 'One-Click';
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  // Anything else (a scanner, an empty POST) switches nothing off.
  if (!(await isOneClick(request))) return new Response('Send List-Unsubscribe=One-Click, or open the address to unsubscribe.\n', { status: 400, headers: TEXT });
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

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const page = new URL('/unsubscribe', url);
  const token = url.searchParams.get('token');
  if (token) page.searchParams.set('token', token);
  return new Response(null, { status: 303, headers: { location: `${page.pathname}${page.search}`, 'cache-control': 'no-store' } });
}
