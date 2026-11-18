// GET /api/admin/reports/<table>?period=30d|90d|12m (docs/adr/0041-control-panel-reports.md): one
// table of a control panel report as a CSV attachment. The procedures decide who may read it
// (admin.reports for any staff role with a verified second factor, admin.billingReport for
// administrators); this file only reads the request and writes the answer, never cached. A cookie
// session's request from another site gets the same 404 as a table that does not exist, as the
// evidence downloads (./evidence-http.ts). Nothing of the request is logged here; an unexpected
// failure is logged by serverClient in its one safe line.


import { principalFromHeaders } from './auth/session';
import { sessionHeaders } from './rpc/handler';
import { ORPCError, serverClient } from './rpc/server';
import { csvFileName, isReportTable, REPORT_TABLES, reportTableCsv } from './services/admin-reports-csv';
import { DEFAULT_REPORT_PERIOD, REPORT_PERIODS, type ReportPeriod } from './services/admin-reports';

const PRIVATE_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } as const;

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...PRIVATE_HEADERS } });
}

function crossSite(request: Request): boolean {
  if (/^bearer\s/i.test(request.headers.get('authorization') ?? '')) return false;
  const site = request.headers.get('sec-fetch-site');
  return site === 'cross-site' || site === 'same-site';
}

export async function handleReportDownload(request: Request, table: string): Promise<Response> {
  if (crossSite(request) || !isReportTable(table)) return text(404, 'No such report table.');
  const asked = new URL(request.url).searchParams.get('period') ?? DEFAULT_REPORT_PERIOD;
  if (!(REPORT_PERIODS as readonly string[]).includes(asked)) return text(400, 'The period is one of 30d, 90d or 12m.');
  const period = asked as ReportPeriod;
  const headers = sessionHeaders(request);
  try {
    const principal = await principalFromHeaders(headers);
    const client = serverClient(headers, principal);
    const { report } = REPORT_TABLES[table];
    const data = report === 'billing' ? await client.admin.billingReport({ period }) : await client.admin.reports({ report, period });
    return new Response(reportTableCsv(table, data), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${csvFileName(table, period, data.range.to)}"`,
        ...PRIVATE_HEADERS,
        'content-security-policy': "default-src 'none'; sandbox; frame-ancestors 'none'",
        'referrer-policy': 'no-referrer',
      },
    });
  } catch (error) {
    if (error instanceof ORPCError && error.status < 500) return text(error.status, error.status === 401 ? 'Sign in first.' : 'This report is not available to you.');
    return text(500, 'Something went wrong on our side. Try again.');
  }
}
