// Runs once when a Next.js server starts, before it serves a request (instrumentation; not during
// `next build`). A production server whose account settings are missing or unsafe exits with
// status 1 instead of serving pages whose routes would all answer 500
// (src/server/auth/startup.ts, docs/adr/0004-auth.md section 15).
//
// M12: onRequestError reports every server error that Next.js catches (a page, a route handler, a
// Server Action) through reportError (src/server/log): one pino line with the request id, the
// route's file path (/people/[slug], never the visited address, which can hold a slug or a
// searched e-mail address), the method and the error's type and digest; then the error provider,
// empty in Phase 1 (plan §3.3).

import type { Instrumentation } from 'next';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startOrExit } = await import('./server/auth/startup');
  startOrExit();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { reportRequestError } = await import('./server/log/request-error');
  await reportRequestError(error, request, context);
};
