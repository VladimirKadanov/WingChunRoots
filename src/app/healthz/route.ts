// GET /healthz (milestone M12; plan §3.3, §7.6): for Docker Compose's health check and, once hosting
// is decided, an uptime monitor. It checks the database and the job queue inside the server
// (src/server/services/system.ts) and answers only {"ok":true} with 200, or {"ok":false} with 503:
// no versions, no timings, no queue lengths. Which check failed goes to the log (pino, with the
// request id), never to the answer. src/proxy.ts never runs for it (its matcher names only the two
// person paths).

import { connection } from 'next/server';

import { healthAnswer } from '@/server/services/system';

export async function GET(request: Request): Promise<Response> {
  // Request time only: never prerendered or cached (Cache Components).
  await connection();
  const { status, body } = await healthAnswer(request.headers);
  return new Response(body, { status, headers: { 'cache-control': 'no-store', 'content-type': 'application/json' } });
}
