import { handleAccountExport } from '@/server/account-export-http';

// GET /api/account/export (review 2026-11-13, ADR 0088): "Download my data" as a JSON attachment,
// for the signed-in account only (src/server/account-export-http.ts, procedure account.export).
export async function GET(request: Request): Promise<Response> {
  return handleAccountExport(request);
}
