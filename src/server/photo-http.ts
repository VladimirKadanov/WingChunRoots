// The HTTP side of profile photos (milestone M14; docs/adr/0016-profile-photos.md): GET
// /api/photos/<id>/<hash>/<size>.webp streams one rendition of a person's current photo through
// the app after the check of src/server/services/photos.ts (openPhoto): a public person's photo for
// everyone; a hidden person's only for its own account and staff with a verified second factor;
// 404 for everything else (a hidden or missing person, a replaced or removed photo, a wrong hash),
// one answer for all, as the person pages (plan §6.4). The store is never addressed directly.
//
// Caching: the address carries the content hash, so a new photo is a new address. A public
// person's photo may be stored by any cache but is revalidated on every use (`public, no-cache`)
// with its ETag (the full hash; 304 when unchanged), so a staff removal, a hidden profile or a
// deleted account takes effect at once everywhere (M14 review). A hidden person's photo is
// `private, no-store`.
//
// An unexpected failure is logged in one line (the error's name and the request id), never the
// address, the person or the session (CLAUDE.md §6).

import { principalFromHeaders } from './auth/session';
import { requestLogger } from './log';
import { sessionHeaders } from './rpc/handler';
import { requestMeta } from './services/context';
import { openPhoto } from './services/photos';

export const PUBLIC_PHOTO_CACHE = 'public, no-cache';

function notFound(): Response {
  return new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'No such photo.' }), {
    status: 404,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

export async function handlePhotoRequest(request: Request, address: { id: string; hash: string; file: string }): Promise<Response> {
  const meta = requestMeta(request.headers);
  try {
    const principal = await principalFromHeaders(sessionHeaders(request));
    const photo = await openPhoto(principal, address);
    if (!photo) return notFound();
    const etag = `"${photo.sha256}"`;
    const headers: Record<string, string> = {
      'content-type': 'image/webp',
      'cache-control': photo.public ? PUBLIC_PHOTO_CACHE : 'private, no-store',
      etag,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'same-origin',
    };
    if ((request.headers.get('if-none-match') ?? '').split(',').some((tag) => tag.trim() === etag)) {
      await photo.body.cancel().catch(() => undefined);
      return new Response(null, { status: 304, headers });
    }
    return new Response(photo.body, { status: 200, headers: { ...headers, 'content-length': String(photo.size) } });
  } catch (error) {
    const name = (error instanceof Error ? error.name : typeof error).replace(/[^\w.:-]/g, '?').slice(0, 64);
    requestLogger(meta.requestId).error(`[photos] serve failed: ${name} request ${meta.requestId.replace(/[^\w.:-]/g, '?').slice(0, 64)}`);
    return new Response(JSON.stringify({ code: 'INTERNAL_SERVER_ERROR', message: 'The photo could not be loaded.' }), {
      status: 500,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
}
