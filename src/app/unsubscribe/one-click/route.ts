// POST /unsubscribe/one-click?token=… (milestone M18, In scope 4; RFC 8058): the address in an
// e-mail's List-Unsubscribe header. A mail client POSTs `List-Unsubscribe=One-Click` to it
// (src/server/one-click.ts, which bounds the body), and the category is switched off without signing
// in. A GET (a person who opened the address) goes to the page with its one button.

import { handleOneClick } from '@/server/one-click';

export async function POST(request: Request): Promise<Response> {
  return handleOneClick(request);
}

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const page = new URL('/unsubscribe', url);
  const token = url.searchParams.get('token');
  if (token) page.searchParams.set('token', token);
  return new Response(null, { status: 303, headers: { location: `${page.pathname}${page.search}`, 'cache-control': 'no-store' } });
}
