// What onRequestError (src/instrumentation.ts) logs of a server error that Next.js caught
// (milestone M12): the request id (a well-formed X-Request-Id, or a new one), the method, the
// route's file path (/people/[slug]) and kind, and the error's type and digest. Never the visited
// path or its query: /people/<slug> names a person and /admin/grants?q= can hold an e-mail address
// (plan §6.4). The error itself is reduced to its type and code by reportError (./redact.ts).

import { requestIdFrom } from '../audit';
import { type ErrorReport, reportError } from './index';

export interface RequestErrorRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface RequestErrorContext {
  routePath: string;
  routeType: string;
  renderSource?: string;
}

/** The fields of the log line for a caught server error. */
export function requestErrorReport(error: unknown, request: RequestErrorRequest, context: RequestErrorContext): ErrorReport {
  const header = request.headers['x-request-id'];
  const given = Array.isArray(header) ? header[0] : header;
  const digest = typeof error === 'object' && error !== null && 'digest' in error ? String((error as { digest: unknown }).digest) : '';
  return {
    requestId: requestIdFrom(new Headers(given ? { 'x-request-id': given } : {})),
    where: 'request',
    method: /^[A-Z]{1,10}$/.test(request.method) ? request.method : 'OTHER',
    route: context.routePath.slice(0, 200),
    routeType: context.routeType,
    ...(context.renderSource ? { renderSource: context.renderSource } : {}),
    ...(/^[\w-]{1,64}$/.test(digest) ? { digest } : {}),
  };
}

/** Logs a caught server error (and hands it to the error provider, empty in Phase 1). */
export async function reportRequestError(error: unknown, request: RequestErrorRequest, context: RequestErrorContext): Promise<void> {
  await reportError(error, requestErrorReport(error, request, context));
}
