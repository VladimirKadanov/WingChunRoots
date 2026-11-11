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
  // A larger body is never read: Content-Length first, then at most MAX_BODY bytes of the stream.
  const length = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(length) || length > MAX_BODY) return none;
  let body: unknown;
  try {
    const text = await readAtMost(request, MAX_BODY);
    if (text === null) return none;
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

/** The body as text, or null when it is longer than `max` bytes (the rest is not read). */
async function readAtMost(request: Request, max: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
