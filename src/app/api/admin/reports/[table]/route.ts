import { handleReportDownload } from '@/server/admin-reports-http';

// GET /api/admin/reports/<table>?period= (docs/adr/0041-control-panel-reports.md): one table of a
// control panel report as CSV, for the staff the report's procedure allows (src/server/admin-reports-http.ts).
export async function GET(request: Request, context: RouteContext<'/api/admin/reports/[table]'>): Promise<Response> {
  const { table } = await context.params;
  return handleReportDownload(request, table);
}
