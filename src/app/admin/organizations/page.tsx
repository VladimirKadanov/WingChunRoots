// /admin/organizations (milestone M15): every organization with its approval and its plan, two
// separate states (DEFAULT D04), for administrators with a verified second factor. An application
// is decided in the review queue; a plan is given on the organization's page here (DEFAULT D09:
// a test or complimentary Federation grant, never charged).
//
// Control panel (docs/adr/0035-control-panel.md): a table with a search (name or address), filters
// by approval and plan (a GET form) and pages of 50, all in the URL, so it ships no script. Each
// row opens the organization's page and, while it waits, its application in the review queue.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { ORGANIZATION_LOAD_ERRORS } from '@/components/account/organization-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { adminFieldClass, AdminPageHeader, EmptyState, Mark, type MarkTone, Pager, RangeLine, table as t } from '@/components/admin/table-parts';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatShortDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { type AdminOrganizationList, adminOrganizationsInput } from '@/server/services/organization-grants';

export const instant = false;

export const metadata: Metadata = {
  title: 'Organizations',
  robots: { index: false },
};

const PAGE = '/admin/organizations';

type Search = Promise<Record<string, string | string[] | undefined>>;
type Filters = AdminOrganizationList['filters'];

const APPROVAL_MARK: Record<string, { symbol: string; tone: MarkTone }> = {
  pending: { symbol: '◔', tone: 'attention' },
  active: { symbol: '✓', tone: 'good' },
  rejected: { symbol: '×', tone: 'neutral' },
  suspended: { symbol: '!', tone: 'danger' },
};

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value.slice(0, 120) : undefined);

function organizationsHref(filters: Filters, page = 1): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.plan !== 'all') params.set('plan', filters.plan);
  if (page > 1) params.set('page', String(page));
  const search = params.toString();
  return search ? `${PAGE}?${search}` : PAGE;
}

export default async function AdminOrganizationsPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const asked = { q: one(query.q)?.trim() || undefined, status: one(query.status), plan: one(query.plan), page: one(query.page) };
  const params = new URLSearchParams(Object.entries(asked).filter((e): e is [string, string] => typeof e[1] === 'string'));
  const here = params.size > 0 ? `${PAGE}?${params}` : PAGE;
  const guard = await guardRoute(PAGE, here);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/admin" />;
  // Each parameter is checked against its field: an unknown or malformed value falls back to the default.
  const field = adminOrganizationsInput.unwrap().shape;
  const valid = <T,>(r: { success: true; data: T } | { success: false }) => (r.success ? r.data : undefined);
  const input = {
    q: valid(field.q.safeParse(asked.q)),
    status: valid(field.status.safeParse(asked.status)) ?? 'all',
    plan: valid(field.plan.safeParse(asked.plan)) ?? 'all',
    page: valid(field.page.safeParse(asked.page)) ?? 1,
  };
  const view = await pageRead(serverClient(await headers(), guard.principal).organizations.adminList(input));
  if (!view) return <LoadError {...ORGANIZATION_LOAD_ERRORS.admin} retryHref={PAGE} />;
  const { filters, counts } = view;
  const pages = Math.max(1, Math.ceil(view.total / view.pageSize));
  const filtered = Boolean(filters.q) || filters.status !== 'all' || filters.plan !== 'all';

  return (
    <div className="mx-auto max-w-[96rem] px-page pt-6 pb-10 md:pt-8 md:pb-14">
      <AdminPageHeader
        eyebrow={
          <Link href="/admin" className="link inline-flex min-h-11 items-center">
            Control panel
          </Link>
        }
        title="Organizations"
        summary={
          <span>
            <strong>{counts.all}</strong> {filters.q ? 'matching' : 'in all'} · <strong>{counts.pending}</strong> waiting for review · <strong>{counts.active}</strong> approved
          </span>
        }
        intro="Approval is decided in the review queue. The plan is separate: give an approved organization a test or complimentary Federation plan on its page."
      />

      <form role="search" action={PAGE} method="get" className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] items-end gap-3" data-testid="admin-organizations-filters">
        <div className="grid min-w-0 gap-1.5 sm:col-span-2">
          <label htmlFor="organizations-q" className="text-sm font-semibold">
            Name or address
          </label>
          <input id="organizations-q" name="q" type="search" defaultValue={filters.q} maxLength={120} autoComplete="off" spellCheck={false} className={adminFieldClass} />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="organizations-status" className="text-sm font-semibold">
            Approval
          </label>
          <select id="organizations-status" name="status" defaultValue={filters.status} className={adminFieldClass}>
            <option value="all">Any ({counts.all})</option>
            <option value="pending">Waiting for review ({counts.pending})</option>
            <option value="active">Approved ({counts.active})</option>
            <option value="suspended">Suspended ({counts.suspended})</option>
            <option value="rejected">Declined ({counts.rejected})</option>
          </select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="organizations-plan" className="text-sm font-semibold">
            Plan
          </label>
          <select id="organizations-plan" name="plan" defaultValue={filters.plan} className={adminFieldClass}>
            <option value="all">Any plan</option>
            <option value="federation">Federation</option>
            <option value="none">No plan</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
            Show
          </button>
          {filtered ? (
            <Link href={PAGE} className="link inline-flex min-h-12 items-center text-ui">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <div className="mt-5 grid gap-4">
        <RangeLine noun="Organizations" total={view.total} page={view.page} pageSize={view.pageSize} testId="admin-organizations-count" extra={<span>waiting first, then by name</span>} />
        {view.organizations.length === 0 ? (
          <EmptyState testId="admin-organizations-empty">{filtered ? 'No organization matches these filters. Change them, or clear them.' : 'No organization has applied.'}</EmptyState>
        ) : (
          <div className="@container">
            <table role="table" data-testid="admin-organizations" className={t.table}>
              <caption className="sr-only">Organizations, waiting for review first, then by name</caption>
              <thead role="rowgroup" className={t.thead}>
                <tr role="row" className={t.headRow}>
                  <th role="columnheader" scope="col" className={t.th}>Organization</th>
                  <th role="columnheader" scope="col" className={t.th}>Approval</th>
                  <th role="columnheader" scope="col" className={t.th}>Plan</th>
                  <th role="columnheader" scope="col" className={t.th}>Admins</th>
                  <th role="columnheader" scope="col" className={t.th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup" className={t.tbody}>
                {view.organizations.map((org) => {
                  const mark = APPROVAL_MARK[org.status] ?? { symbol: '·', tone: 'neutral' as const };
                  return (
                    <tr role="row" key={org.id} className={t.row} data-testid="admin-organization" data-status={org.status}>
                      <td role="cell" className={t.td}>
                        <Link href={`${PAGE}/${org.id}`} className="link inline-flex min-h-11 items-center font-semibold [overflow-wrap:anywhere] @min-[52rem]:-my-2.5">
                          {org.name}
                        </Link>
                        <span className="block text-sm text-fg-muted">
                          {org.kindLabel}
                          {org.countryCode ? ` · ${org.countryCode}` : ''}
                        </span>
                      </td>
                      <td role="cell" className={t.td}>
                        <span className={t.cardLabel}>Approval</span>
                        <Mark symbol={mark.symbol} tone={mark.tone}>
                          {org.approvalLabel}
                        </Mark>
                      </td>
                      <td role="cell" className={t.td}>
                        <span className={t.cardLabel}>Plan</span>
                        <span className={org.plan.code ? 'font-semibold' : 'text-fg-muted'}>{org.plan.label}</span>
                        {org.plan.code && org.plan.until ? <span className="block text-sm text-fg-muted">until {formatShortDay(org.plan.until)}</span> : null}
                      </td>
                      <td role="cell" className={t.td}>
                        <span className={t.cardLabel}>Admins</span>
                        <span className="tabular">{org.admins}</span>
                      </td>
                      <td role="cell" className={t.td}>
                        <span className="flex flex-wrap gap-x-4 @min-[52rem]:-my-2.5">
                          <Link href={`${PAGE}/${org.id}`} className="link inline-flex min-h-11 items-center whitespace-nowrap">
                            Plan and details<span className="sr-only"> of {org.name}</span>
                          </Link>
                          {org.caseId ? (
                            <Link href={`/admin/review/${org.caseId}`} className="link inline-flex min-h-11 items-center whitespace-nowrap">
                              Open the application<span className="sr-only"> of {org.name}</span>
                            </Link>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager label="Pages of organizations" page={view.page} pages={pages} href={(page) => organizationsHref(filters, page)} />
      </div>
    </div>
  );
}
