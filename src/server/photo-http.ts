// The HTTP side of profile photos (milestone M14; docs/adr/0016-profile-photos.md): GET
// /api/photos/<id>/<hash>/<size>.webp serves one rendition of a person's current photo through
// the app after the check of src/server/services/photos.ts (openPhoto): a public person's photo for
// everyone; a hidden person's only for its own account and staff with a verified second factor;
// 404 for everything else (a hidden or missing person, a replaced or removed photo, a wrong hash),
// one answer for all, as the person pages (plan §6.4). The store is never addressed directly.
// M16 (docs/adr/0019-galleries.md): the same address serves the other photos of a person's gallery
// and `full.webp` (the whole photo); GET /api/school-photos/<id>/<hash>/<size>.webp serves a
// school's logo and room photos (openSchoolPhoto: public while the school is), with these headers.
//
// Caching: the address carries the content hash, so a new photo is a new address. A public
// person's photo may be stored by any cache but is revalidated on every use (`public, no-cache`)
// with its ETag (the full hash; 304 when unchanged), so a staff removal, a hidden profile or a
// deleted account takes effect at once everywhere (M14 review). A hidden person's photo is
// `private, no-store`.
//
// The rendition is read whole from the photo store within PHOTO_READ_TIMEOUT_MS (5 s, headers and
// body; src/server/storage/read.ts) and sent with its own Content-Length; a revalidation whose ETag
// still matches is answered 304 without reading the store. A store that does not deliver in time
// or fails is a fast 503 (`no-store`), so a page never waits for its `load` event on a stalled
// image (CI run 41470799646).
//
// A failure is logged in one line (the error's name and the request id), never the address, the
// person or the session (CLAUDE.md §6).

import { principalFromHeaders } from './auth/session';
import { requestLogger } from './log';
import { sessionHeaders } from './rpc/handler';
import { requestMeta } from './services/context';
import { openPhoto, photoEtag } from './services/photos';
import { openSchoolPhoto } from './services/school-photos';
import { type ObjectStore, StorageError } from './storage';

export const PUBLIC_PHOTO_CACHE = 'public, no-cache';

function notFound(): Response {
  return new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'No such photo.' }), {
    status: 404,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

function unavailable(): Response {
  return new Response(JSON.stringify({ code: 'SERVICE_UNAVAILABLE', message: 'The photo could not be loaded. Try again later.' }), {
    status: 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

/** The one log line of a failure: the error's name and the request id, nothing else. */
function logFailure(requestId: string, what: string, error: unknown): void {
  const name = (error instanceof Error ? error.name : typeof error).replace(/[^\w.:-]/g, '?').slice(0, 64);
  requestLogger(requestId).error(`[photos] ${what}: ${name} request ${requestId.replace(/[^\w.:-]/g, '?').slice(0, 64)}`);
}

export interface PhotoRequestOptions {
  /** The photo store (tests); the process's photo store otherwise. */
  store?: ObjectStore;
  /** The deadline of the store read (PHOTO_READ_TIMEOUT_MS; tests shorten it). */
  timeoutMs?: number;
  /**
   * M16: which photos the address names: a person's (profile and gallery, GET /api/photos/...,
   * the default) or a school's (logo and room photos, GET /api/school-photos/...). Both follow
   * the same headers and read rules.
   */
  kind?: 'person' | 'school';
}

export async function handlePhotoRequest(
  request: Request,
  address: { id: string; hash: string; file: string },
  options: PhotoRequestOptions = {},
): Promise<Response> {
  const meta = requestMeta(request.headers);
  try {
    const principal = await principalFromHeaders(sessionHeaders(request));
    const open = options.kind === 'school' ? openSchoolPhoto : openPhoto;
    const photo = await open(principal, address, options.store, {
      ifNoneMatch: request.headers.get('if-none-match'),
      timeoutMs: options.timeoutMs,
      signal: request.signal,
    });
    if (!photo) return notFound();
    const headers: Record<string, string> = {
      'content-type': 'image/webp',
      'cache-control': photo.public ? PUBLIC_PHOTO_CACHE : 'private, no-store',
      etag: photoEtag(photo.sha256),
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'same-origin',
    };
    if (photo.notModified) return new Response(null, { status: 304, headers });
    // The whole rendition, already read: Content-Length is the bytes' own length.
    return new Response(photo.bytes, { status: 200, headers: { ...headers, 'content-length': String(photo.bytes.byteLength) } });
  } catch (error) {
    if (error instanceof StorageError) {
      // The store did not deliver in time, or failed: a fast 503 the browser may retry later,
      // logged unless the browser itself went away.
      if (!request.signal.aborted) logFailure(meta.requestId, 'store unavailable', error);
      return unavailable();
    }
    logFailure(meta.requestId, 'serve failed', error);
    return new Response(JSON.stringify({ code: 'INTERNAL_SERVER_ERROR', message: 'The photo could not be loaded.' }), {
      status: 500,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
}
