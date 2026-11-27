// GET /api/account/export (review 2026-11-13, ADR 0088): "Download my data" on /account/privacy as
// a JSON attachment. The procedure account.export decides who may read it (the signed-in account,
// its own data only); this file only reads the request and writes the answer, never cached. A
// cookie session's request from another site is refused like an anonymous one, as the report
// downloads (./admin-reports-http.ts). Nothing of the request or the answer is logged here.

import { principalFromHeaders } from './auth/session';
import { sessionHeaders } from './rpc/handler';
import { ORPCError, serverClient } from './rpc/server';

const PRIVATE_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } as const;

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...PRIVATE_HEADERS } });
}

function crossSite(request: Request): boolean {
  if (/^bearer\s/i.test(request.headers.get('authorization') ?? '')) return false;
  const site = request.headers.get('sec-fetch-site');
  return site === 'cross-site' || site === 'same-site';
}

/** "wingchunroots-my-data-2026-11-27.json". */
export function exportFileName(exportedAt: string): string {
  return `wingchunroots-my-data-${exportedAt.slice(0, 10)}.json`;
}

export async function handleAccountExport(request: Request): Promise<Response> {
  if (crossSite(request)) return text(403, 'Open this download from your privacy settings.');
  const headers = sessionHeaders(request);
  try {
    const principal = await principalFromHeaders(headers);
    const data = await serverClient(headers, principal).account.export();
    return new Response(`${JSON.stringify(data, null, 2)}\n`, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${exportFileName(data.exportedAt)}"`,
        ...PRIVATE_HEADERS,
        'content-security-policy': "default-src 'none'; sandbox; frame-ancestors 'none'",
      },
    });
  } catch (error) {
    if (error instanceof ORPCError && error.status < 500) return text(error.status, error.status === 401 ? 'Sign in first.' : 'This download is not available to you.');
    return text(500, 'Something went wrong on our side. Try again.');
  }
}
