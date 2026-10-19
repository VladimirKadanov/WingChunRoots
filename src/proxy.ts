// The request-time check of a person's pages (milestone M04, In scope 4: a hidden person answers
// 404; owner decision 2026-10-19, docs/adr/0008-person-pages-404.md). Before /people/<slug> or
// /people/<slug>/lineage renders, the lineage service says whether this viewer may see that person
// (personPageVisible: public, or hidden but theirs or at the other end of their own relationship).
// A missing, malformed or hidden address is rewritten to /not-on-record, an address no route uses,
// with the request marked (NOT_ON_RECORD_HEADER): the app's not-found page then renders "Not on the
// record" in a person's terms, with status 404 and in the HTML itself (it works without
// JavaScript; a notFound() thrown by the page would be drawn only by JavaScript, and after the
// streamed shell it could not change the status). The same page and status for all three, so
// nothing tells them apart (plan §6.4). The address bar keeps the URL.
//
// The matcher names only those two paths, so /api, /healthz and the static /_next assets never
// reach this file (CLAUDE.md §13, plan §6.1). Next.js's own data form of the two paths
// (/_next/data/<build>/people/<slug>.json, and the .rsc forms) does: Next.js compiles every matcher
// with it, and the proxy then sees the page's own pathname, so the same check applies (final check,
// code-2). The check has a short deadline of its own (PERSON_CHECK_BUDGET_MS;
// review round 2, recheck-7): its database reads stop there (statement_timeout), and the proxy
// stops waiting for the whole check, the session read included, after the same time. A check that
// fails or runs out of time never hides a page: the request goes on and the page answers for
// itself (its own "Not on the record", never indexed, or its error state).

import { NextResponse, type NextRequest } from 'next/server';

import { NOT_ON_RECORD_HEADER, NOT_ON_RECORD_PATH } from '@/lib/not-on-record';
import { COOKIE_PREFIX } from '@/server/auth/config';
import { principalFromHeaders } from '@/server/auth/session';
import { PERSON_CHECK_BUDGET_MS, personPageVisible } from '@/server/services/lineage';

/** A session cookie or a bearer token is there (whether it is valid is the session's question). */
function mayHaveSession(request: NextRequest): boolean {
  if (/^bearer\s/i.test(request.headers.get('authorization') ?? '')) return true;
  return request.cookies.has(`${COOKIE_PREFIX}.session_token`) || request.cookies.has(`__Secure-${COOKIE_PREFIX}.session_token`);
}

function slugOf(pathname: string): string {
  try {
    return decodeURIComponent(pathname.split('/')[2] ?? '');
  } catch {
    return '';
  }
}

/** The check's answer, or a rejection with the code 'timeout' once `ms` have passed. The timer never outlives the check. */
function withinDeadline<T>(check: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('The person check ran out of time.'), { code: 'timeout' })), ms);
  });
  return Promise.race([check, timeout]).finally(() => clearTimeout(timer));
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const slug = slugOf(request.nextUrl.pathname);
  try {
    const check = personPageVisible(async () => (mayHaveSession(request) ? principalFromHeaders(request.headers) : null), { slug });
    if (await withinDeadline(check, PERSON_CHECK_BUDGET_MS)) return NextResponse.next();
  } catch (error) {
    // Only the error's code or name: never the slug, the session or the query (CLAUDE.md §6).
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : error instanceof Error ? error.name : 'unknown';
    console.error(`[proxy] the person check failed (${code}); the page answers for itself`);
    return NextResponse.next();
  }
  const headers = new Headers(request.headers);
  headers.set(NOT_ON_RECORD_HEADER, 'person');
  return NextResponse.rewrite(new URL(NOT_ON_RECORD_PATH, request.url), { request: { headers } });
}

export const config = {
  matcher: ['/people/:slug', '/people/:slug/lineage'],
};
