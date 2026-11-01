// The HTTP side of evidence files (milestone M10a, In scope 2 and 3; plan §6.1, §6.4): the route
// handlers POST /api/evidence/upload and GET /api/evidence/<id> call these. They sit outside the
// matcher of src/proxy.ts (which names only the two person paths), so Next.js never buffers or cuts
// the request body (experimental.proxyClientMaxBodySize, docs/evidence-and-review.md); the body
// reaches the service as a stream, unread until its size has been checked.
//
// The services decide (src/server/services/evidence.ts); this file only reads the request (the
// session from the cookie or `Authorization: Bearer`, Content-Length, X-File-Name, ?case=) and
// writes the response. The same CSRF rule as the oRPC endpoints applies to the upload
// (src/server/rpc/handler.ts). A download that a cookie session makes from another site (an <img>
// or a link elsewhere) gets the same 404 as everyone not allowed: the file is opened only from the
// app itself, an address typed in, or a bearer client.
//
// An unexpected failure is logged in one line (the operation, the error's name, the PostgreSQL code
// and the request id), never the file name, the storage key or the session (CLAUDE.md §6).

import { principalFromHeaders } from './auth/session';
import { csrfRefusal, sessionHeaders } from './rpc/handler';
import { requestMeta } from './services/context';
import { openEvidence, uploadEvidence } from './services/evidence';
import { isServiceError, pgErrorOf } from './services/errors';

/** The headers of every evidence answer: never stored by a cache, never sniffed. */
const PRIVATE_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...PRIVATE_HEADERS } });
}

function failureLine(operation: string, error: unknown, requestId: string): string {
  const name = error instanceof Error ? error.name : typeof error;
  const code = pgErrorOf(error)?.code;
  const safe = (value: string) => value.replace(/[^\w.:-]/g, '?').slice(0, 64);
  return `[evidence] ${operation} failed: ${safe(name)}${code ? ` (postgres ${safe(code)})` : ''} request ${safe(requestId)}`;
}

/** The service's refusal as JSON with its status; anything else is logged and becomes a bare 500. */
function failure(operation: string, error: unknown, requestId: string): Response {
  if (isServiceError(error)) {
    return json(error.status, { code: error.code, message: error.message, ...(Object.keys(error.fields).length > 0 ? { fields: error.fields } : {}) });
  }
  console.error(failureLine(operation, error, requestId));
  return json(500, { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong on our side; the file was not saved. Try again.' });
}

/** Content-Length as a whole number, or null when it is missing or malformed (a chunked upload). */
export function declaredLength(headers: Headers): number | null {
  const value = headers.get('content-length');
  if (value === null || !/^\d{1,16}$/.test(value.trim())) return null;
  return Number(value.trim());
}

/**
 * POST /api/evidence/upload: one file per request, the file itself as the body (any Content-Type;
 * the type comes from its magic bytes), its name URI-encoded in X-File-Name, and `?case=<id>` to add
 * it to an open claim of the uploader's. 201 with `{ evidence }`; the refusals of
 * uploadEvidence with their status (401, 404, 409, 411, 413, 415, 429).
 */
export async function handleEvidenceUpload(request: Request): Promise<Response> {
  const meta = requestMeta(request.headers);
  if (csrfRefusal(request)) return json(403, { code: 'CSRF', message: 'Cross-site request refused.' });
  try {
    const principal = await principalFromHeaders(sessionHeaders(request));
    const evidence = await uploadEvidence(
      principal,
      {
        declaredLength: declaredLength(request.headers),
        body: request.body,
        name: request.headers.get('x-file-name'),
        caseId: new URL(request.url).searchParams.get('case'),
      },
      meta,
    );
    return json(201, { evidence });
  } catch (error) {
    return failure('upload', error, meta.requestId);
  }
}

/** A cookie session's request made from another site (Sec-Fetch-Site), never a bearer client's. */
function crossSite(request: Request): boolean {
  if (/^bearer\s/i.test(request.headers.get('authorization') ?? '')) return false;
  const site = request.headers.get('sec-fetch-site');
  return site === 'cross-site' || site === 'same-site';
}

const NOT_FOUND_BODY = { code: 'NOT_FOUND', message: 'No such file.' };

/**
 * GET /api/evidence/<id>: the file, streamed through the app after the check, as an attachment that
 * is never cached, sniffed or rendered in the app's origin (In scope 3). 404 for everyone not
 * allowed, the same as for no such file.
 */
export async function handleEvidenceDownload(request: Request, id: string): Promise<Response> {
  const meta = requestMeta(request.headers);
  if (crossSite(request)) return json(404, NOT_FOUND_BODY);
  try {
    const principal = await principalFromHeaders(sessionHeaders(request));
    const file = await openEvidence(principal, id, meta);
    return new Response(file.body, {
      status: 200,
      headers: {
        'content-type': file.mime,
        'content-length': String(file.size),
        'content-disposition': `attachment; filename="${file.fileName}"`,
        ...PRIVATE_HEADERS,
        // Opened by mistake in a tab, the file can run nothing in the app's origin.
        'content-security-policy': "default-src 'none'; sandbox; frame-ancestors 'none'",
        'cross-origin-resource-policy': 'same-origin',
        'referrer-policy': 'no-referrer',
      },
    });
  } catch (error) {
    if (isServiceError(error) && error.code === 'NOT_FOUND') return json(404, NOT_FOUND_BODY);
    return failure('download', error, meta.requestId);
  }
}
