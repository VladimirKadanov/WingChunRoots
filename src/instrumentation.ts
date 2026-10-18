// Runs once when a Next.js server starts, before it serves a request (instrumentation; not during
// `next build`). A production server whose account settings are missing or unsafe exits with
// status 1 instead of serving pages whose routes would all answer 500
// (src/server/auth/startup.ts, docs/adr/0004-auth.md section 15).

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startOrExit } = await import('./server/auth/startup');
  startOrExit();
}
