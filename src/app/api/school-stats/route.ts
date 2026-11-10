import { serverClient } from '@/server/rpc/server';

// POST /api/school-stats (milestone M21; docs/adr/0024-trial-lessons.md): the beacon of the school
// pages and the finder (navigator.sendBeacon, src/lib/school-beacon.ts). It only adds one to a
// counter of a public school (schools.track, the same procedure as POST /api/v1/schools/track):
// nothing about the visitor is kept, and the procedure leaves out the school's own account, staff
// and bot-like user agents. The body is a small JSON text; anything else is ignored. Always 204, so
// the answer says nothing about the school or the visitor. No request is logged.

const MAX_BODY = 512;

export async function POST(request: Request): Promise<Response> {
  const none = new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  // A page of this site only: another origin's beacon counts nothing.
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(request.url).origin && request.headers.get('sec-fetch-site') !== 'same-origin') return none;
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return none;
    body = JSON.parse(text);
  } catch {
    return none;
  }
  const { schoolId, event } = (body ?? {}) as { schoolId?: unknown; event?: unknown };
  if (typeof schoolId !== 'string' || typeof event !== 'string') return none;
  try {
    await serverClient(request.headers).schools.track({ schoolId, event: event as 'page_view' });
  } catch {
    // A refused or failed count changes nothing for the visitor.
  }
  return none;
}
