// GET /healthz/deep (review 2026-11-13, ops M3; docs/adr/0088-review-1113-leftovers.md): for an
// uptime monitor. The checks of /healthz, plus the worker's heartbeat and, when BACKUP_MAX_AGE_HOURS
// is set, the age of the newest local archive (src/server/services/system.ts). The same answer as
// /healthz: only {"ok":true} with 200 or {"ok":false} with 503; which check failed goes to the log.
// /healthz stays the shallow check of Docker Compose, so a stopped worker never marks web unhealthy.

import { connection } from 'next/server';

import { healthAnswer } from '@/server/services/system';

export async function GET(request: Request): Promise<Response> {
  await connection();
  const { status, body } = await healthAnswer(request.headers, true);
  return new Response(body, { status, headers: { 'cache-control': 'no-store', 'content-type': 'application/json' } });
}
