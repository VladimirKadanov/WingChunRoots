// /admin/reports (owner request 2026-11-17, docs/adr/0041-control-panel-reports.md): the control
// panel's reports over a chosen period, for staff with a verified second factor; the billing report
// for administrators only (as /admin/billing). One report at a time, picked from the list beside it
// (?report=), over 30 days, 90 days or 12 months (?period=): plain links and a GET form, so the page
// sends no script of its own. Aggregate counts only (admin.reports, admin.billingReport): no row
// names a person, an account or an e-mail address; schools are counted by country and city, never
// by a point. Each table downloads as CSV through GET /api/admin/reports/<table>. Reads the session,
// so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { PageRedirect } from '@/components/account/page-redirect';
import { adminFieldClass, AdminPageHeader, EmptyState } from '@/components/admin/table-parts';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { formatDay } from '@/lib/dates';
import { countryName } from '@/lib/regions';
import { guardRoute } from '@/server/auth/web';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { ReportTable } from '@/server/services/admin-reports-csv';
import {
  type ArchiveReport,
  type BillingReport,
  DEFAULT_REPORT_PERIOD,
  GROWTH_LABELS,
  GROWTH_SERIES,
  type GrowthReport,
  PERIOD_LABELS,
  REPORT_PERIODS,
  type ReportPeriod,
  type ReportRange,
  type ReviewReport,
  type SchoolsReport,
  type StaffReport,
  SUBSCRIPTION_STATUS_LABELS,
} from '@/server/services/admin-reports';

import { BarChart, bucketLabel, ChartLegend, type ChartSeries, CsvLink, FigureTable, number, ReportCard } from './report-parts';

export const instant = false;

export const metadata: Metadata = {
  title: 'Reports',
  robots: { index: false },
};

const PAGE = '/admin/reports';
const REPORTS = [
  { key: 'growth', label: 'Growth', note: 'Accounts, people on record, verified links, schools' },
  { key: 'review', label: 'Review throughput', note: 'Requests opened and decided, time to decide' },
  { key: 'archive', label: 'Archive completeness', note: 'People and sourced links per lineage' },
  { key: 'schools', label: 'Schools', note: 'By stage, country and city' },
  { key: 'billing', label: 'Billing', note: 'Plans and their monthly value (test mode)', adminOnly: true },
] as const;
type ReportKey = (typeof REPORTS)[number]['key'];

const LOAD_ERROR = {
  eyebrow: 'Control panel',
  title: 'Reports',
  message: "We couldn't load this report. Nothing was changed.",
  back: { href: '/admin', label: 'Back to the dashboard' },
} as const;

type Search = Promise<Record<string, string | string[] | undefined>>;

function reportsHref(report: ReportKey, period: ReportPeriod): string {
  const params = new URLSearchParams();
  if (report !== 'growth') params.set('report', report);
  if (period !== DEFAULT_REPORT_PERIOD) params.set('period', period);
  const search = params.toString();
  return search ? `${PAGE}?${search}` : PAGE;
}

const csvHref = (table: ReportTable, period: ReportPeriod) => `/api/admin/reports/${table}?period=${period}`;
const usd = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const days = (d: number | null) => (d === null ? '—' : `${d.toFixed(1)} ${d === 1 ? 'day' : 'days'}`);
const pct = (p: number | null) => (p === null ? '—' : `${p}%`);

function rangeLine(range: ReportRange): string {
  const unit = range.unit === 'week' ? 'per week (from Monday)' : 'per month';
  return `${formatDay(range.from)} to ${formatDay(range.to)}, ${unit}, UTC.`;
}

const FILLED_OUTLINE = (a: string, b: string): ChartSeries[] => [
  { name: a, style: 'filled' },
  { name: b, style: 'outline' },
];

export default async function AdminReportsPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const askedPeriod = typeof query.period === 'string' ? query.period : DEFAULT_REPORT_PERIOD;
  const period: ReportPeriod = (REPORT_PERIODS as readonly string[]).includes(askedPeriod) ? (askedPeriod as ReportPeriod) : DEFAULT_REPORT_PERIOD;
  const askedReport = typeof query.report === 'string' ? query.report : 'growth';
  const chosen: ReportKey = REPORTS.some((r) => r.key === askedReport) ? (askedReport as ReportKey) : 'growth';
  const guard = await guardRoute(PAGE, reportsHref(chosen, period));
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/admin" />;
  const isAdmin = guard.principal?.user.role === 'admin';
  const reports = REPORTS.filter((r) => isAdmin || !('adminOnly' in r));
  // The billing report is for administrators: anyone else gets the growth report in its place.
  const report: ReportKey = reports.some((r) => r.key === chosen) ? chosen : 'growth';
  const client = serverClient(await headers(), guard.principal);
  const read: Promise<StaffReport | BillingReport> = report === 'billing' ? client.admin.billingReport({ period }) : client.admin.reports({ report, period });
  const data = await pageRead(read);
  if (!data) return <LoadError {...LOAD_ERROR} retryHref={reportsHref(report, period)} />;
  const current = REPORTS.find((r) => r.key === report)!;

  return (
    <div className="mx-auto max-w-[96rem] px-page pt-6 pb-10 md:pt-8 md:pb-14">
      <AdminPageHeader
        eyebrow={
          <Link href="/admin" className="link inline-flex min-h-11 items-center">
            Control panel
          </Link>
        }
        title="Reports"
        summary={<span data-testid="report-range">{rangeLine(data.range)}</span>}
        intro="Counts only: no row names a person, an account or an e-mail address, and schools are counted by city, never by their place on the map. Each table downloads as CSV with the same rows."
      />

      <form action={PAGE} method="get" className="mt-5 flex flex-wrap items-end gap-3" data-testid="report-period-form">
        {report !== 'growth' ? <input type="hidden" name="report" value={report} /> : null}
        <div className="grid min-w-0 basis-[14rem] gap-1.5">
          <label htmlFor="report-period" className="text-sm font-semibold">
            Period
          </label>
          <select id="report-period" name="period" defaultValue={period} className={adminFieldClass}>
            {REPORT_PERIODS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
          Show
        </button>
      </form>

      <div className="mt-6 grid gap-5 2xl:grid-cols-[15rem_minmax(0,1fr)] 2xl:items-start">
        <nav aria-label="Reports">
          <ul className="flex flex-wrap gap-2 2xl:grid 2xl:gap-1" data-testid="report-list">
            {reports.map((r) => (
              <li key={r.key}>
                <Link
                  href={reportsHref(r.key, period)}
                  aria-current={r.key === report ? 'page' : undefined}
                  data-testid="report-link"
                  data-report={r.key}
                  className={cx(
                    'grid min-h-11 content-center gap-0.5 rounded-sm border px-3 py-2 text-ui',
                    r.key === report ? 'border-fg bg-surface-2 font-semibold 2xl:border-l-[3px]' : 'border-border-subtle hover:bg-surface-1 2xl:border-transparent',
                  )}
                >
                  <span>{r.label}</span>
                  <span className="hidden text-sm font-normal text-fg-muted 2xl:block">{r.note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <section aria-label={current.label} className="grid min-w-0 gap-4" data-testid="report" data-report={report}>
          {data.kind === 'growth' ? <Growth r={data} period={period} /> : null}
          {data.kind === 'review' ? <Review r={data} period={period} /> : null}
          {data.kind === 'archive' ? <Archive r={data} period={period} /> : null}
          {data.kind === 'schools' ? <Schools r={data} period={period} /> : null}
          {data.kind === 'billing' ? <Billing r={data} period={period} /> : null}
        </section>
      </div>
    </div>
  );
}

function Growth({ r, period }: { r: GrowthReport; period: ReportPeriod }) {
  const unit = r.range.unit;
  return (
    <>
      <section aria-label="Totals" className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
        {GROWTH_SERIES.map((key) => (
          <div key={key} className="grid min-w-0 content-start gap-1.5 rounded-md border border-border-subtle bg-surface-1 p-4" data-testid="growth-total" data-series={key}>
            <span className="text-sm text-fg-muted">{GROWTH_LABELS[key]}</span>
            <span className="font-display text-[2rem] leading-none">{number.format(r.totals[key].inPeriod)}</span>
            <span className="text-sm text-fg-muted">{number.format(r.totals[key].now)} in all now</span>
          </div>
        ))}
      </section>
      {GROWTH_SERIES.map((key) => (
        <ReportCard key={key} title={GROWTH_LABELS[key]} id={`growth-${key}`}>
          <BarChart
            buckets={r.buckets.map((b) => ({ label: bucketLabel(b.start, unit), values: [b[key]] }))}
            series={[{ name: GROWTH_LABELS[key], style: 'filled' }]}
            caption={`${GROWTH_LABELS[key]} ${unit === 'week' ? 'per week' : 'per month'}`}
            firstColumn={unit === 'week' ? 'Week of' : 'Month'}
          />
        </ReportCard>
      ))}
      <p className="text-sm text-fg-muted">
        Schools count by the day they were added, if they are listed now. People on record leave out erased records. <CsvLink href={csvHref('growth', period)} label="growth per period" />
      </p>
    </>
  );
}

function Review({ r, period }: { r: ReviewReport; period: ReportPeriod }) {
  const unit = r.range.unit;
  const series = FILLED_OUTLINE('Opened', 'Decided');
  type Row = ReviewReport['groups'][number];
  const total: Row = { key: 'all', label: 'All groups', ...r.totals };
  return (
    <>
      <ReportCard title={`Requests opened and decided, ${unit === 'week' ? 'per week' : 'per month'}`} id="review-chart" action={<ChartLegend series={series} />} testId="review-chart">
        <BarChart
          buckets={r.buckets.map((b) => ({ label: bucketLabel(b.start, unit), values: [b.opened, b.decided] }))}
          series={series}
          caption={`Review requests opened and decided ${unit === 'week' ? 'per week' : 'per month'}`}
          firstColumn={unit === 'week' ? 'Week of' : 'Month'}
        />
        <p className="mt-2 text-sm text-fg-muted">
          {number.format(r.totals.opened)} opened and {number.format(r.totals.decided)} decided in the period; median time to a decision {days(r.totals.medianDays)}.{' '}
          <CsvLink href={csvHref('review-periods', period)} label="opened and decided per period" />
        </p>
      </ReportCard>
      <ReportCard title="By group" id="review-groups" action={<CsvLink href={csvHref('review-groups', period)} label="review throughput by group" />}>
        <p className="mt-1 text-sm text-fg-muted">Decided means approved, rejected or closed without a decision (withdrawn, or the account was erased). The median counts the cases decided in the period.</p>
        <FigureTable<Row>
          caption="Review throughput by group in the period"
          testId="review-group"
          rows={r.groups}
          rowKey={(g) => g.key}
          footer={total}
          columns={[
            { header: 'Group', cell: (g) => g.label },
            { header: 'Opened', cell: (g) => number.format(g.opened) },
            { header: 'Decided', cell: (g) => number.format(g.decided) },
            { header: 'Approved', cell: (g) => number.format(g.approved) },
            { header: 'Rejected', cell: (g) => number.format(g.rejected) },
            { header: 'Closed', cell: (g) => number.format(g.dismissed) },
            { header: 'Median time', cell: (g) => days(g.medianDays) },
            { header: 'Appealed', cell: (g) => number.format(g.appealed) },
            { header: 'Open now', cell: (g) => number.format(g.openNow) },
          ]}
        />
      </ReportCard>
    </>
  );
}

function Archive({ r, period }: { r: ArchiveReport; period: ReportPeriod }) {
  type Row = ArchiveReport['lineages'][number];
  return (
    <ReportCard title="Archive completeness by lineage" id="archive-lineages" action={<CsvLink href={csvHref('archive-lineages', period)} label="archive completeness by lineage" />}>
      <p className="mt-1 max-w-[72ch] text-sm text-fg-muted">
        Established links are verified or in arbitration. A link is sourced when an archivist noted where it was found, or an evidence file is attached to it or to its review.
        Someone in two lineages counts once in the total.
      </p>
      {r.lineages.length === 0 ? (
        <div className="mt-3">
          <EmptyState testId="archive-empty">No lineage is recorded yet. Add one in the archive editor.</EmptyState>
        </div>
      ) : (
        <FigureTable<Row>
          caption="People, established links and sourced links per lineage"
          testId="archive-lineage"
          rows={r.lineages}
          rowKey={(l) => l.slug}
          footer={{ slug: '', name: 'All lineages', ...r.totals }}
          columns={[
            { header: 'Lineage', cell: (l) => (l.slug ? <span translate="no">{l.name}</span> : l.name) },
            { header: 'People', cell: (l) => number.format(l.people) },
            { header: 'Links', cell: (l) => number.format(l.links) },
            { header: 'Sourced', cell: (l) => number.format(l.sourced) },
            { header: 'Sourced share', cell: (l) => <ShareBar value={l.sourcedPercent} /> },
            { header: 'Added in period', cell: (l) => number.format(l.addedInPeriod) },
          ]}
        />
      )}
    </ReportCard>
  );
}

/** A share as its number, with a thin bar after it (aria-hidden: the number says it). */
function ShareBar({ value }: { value: number | null }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-10 text-right">{pct(value)}</span>
      <span aria-hidden="true" className="inline-block h-2 w-16 rounded-[2px] bg-surface-3">
        <span className="block h-full rounded-[2px] bg-fg" style={{ width: `${value ?? 0}%` }} />
      </span>
    </span>
  );
}

function Schools({ r, period }: { r: SchoolsReport; period: ReportPeriod }) {
  type Stage = SchoolsReport['stages'][number];
  type Country = SchoolsReport['countries'][number];
  type City = SchoolsReport['cities'][number];
  return (
    <>
      <ReportCard title="Schools by stage" id="schools-stages" action={<CsvLink href={csvHref('schools-stages', period)} label="schools by stage" />}>
        <p className="mt-1 text-sm text-fg-muted">{number.format(r.listed)} on the public map now. A listed school awaits confirmation from day 90 without an edit, and is hidden from the map from day 105.</p>
        <FigureTable<Stage>
          caption="Schools by stage"
          testId="schools-stage"
          rows={r.stages}
          rowKey={(s) => s.key}
          columns={[
            { header: 'Stage', cell: (s) => s.label },
            { header: 'Schools', cell: (s) => number.format(s.count) },
            { header: 'Added in period', cell: (s) => number.format(s.addedInPeriod) },
          ]}
        />
      </ReportCard>
      <ReportCard title="Listed schools by country" id="schools-countries" action={<CsvLink href={csvHref('schools-countries', period)} label="listed schools by country" />}>
        {r.countries.length === 0 ? (
          <div className="mt-3">
            <EmptyState testId="schools-empty">No school is on the public map yet. New listings are decided in the review queue.</EmptyState>
          </div>
        ) : (
          <FigureTable<Country>
            caption="Listed schools by country"
            testId="schools-country"
            rows={r.countries}
            rowKey={(c) => c.countryCode}
            columns={[
              { header: 'Country', cell: (c) => countryName(c.countryCode) },
              { header: 'Listed schools', cell: (c) => number.format(c.listed) },
              { header: 'Cities', cell: (c) => number.format(c.cities) },
              { header: 'Added in period', cell: (c) => number.format(c.addedInPeriod) },
            ]}
          />
        )}
      </ReportCard>
      {r.cities.length > 0 ? (
        <ReportCard title="Listed schools by city" id="schools-cities" action={<CsvLink href={csvHref('schools-cities', period)} label="listed schools by city" />}>
          <FigureTable<City>
            caption="Listed schools by city, the most first"
            testId="schools-city"
            rows={r.cities}
            rowKey={(c) => `${c.countryCode}-${c.city}`}
            columns={[
              { header: 'City', cell: (c) => <span translate="no">{c.city}</span> },
              { header: 'Country', cell: (c) => countryName(c.countryCode), numeric: false },
              { header: 'Listed schools', cell: (c) => number.format(c.listed) },
            ]}
          />
        </ReportCard>
      ) : null}
    </>
  );
}

function Billing({ r, period }: { r: BillingReport; period: ReportPeriod }) {
  const unit = r.range.unit;
  const series = FILLED_OUTLINE('Started', 'Ended');
  type Bucket = BillingReport['buckets'][number];
  type Plan = BillingReport['byPlan'][number];
  const statuses = Object.keys(SUBSCRIPTION_STATUS_LABELS) as (keyof typeof SUBSCRIPTION_STATUS_LABELS)[];
  return (
    <>
      <p className="text-ui" data-testid="billing-monthly">
        Test mode, no real charge. Monthly value now at the proposed prices: <strong>{usd.format(r.monthlyCents / 100)}</strong> (a yearly plan counts a twelfth).
      </p>
      <ReportCard title={`Subscriptions started and ended, ${unit === 'week' ? 'per week' : 'per month'}`} id="billing-chart" action={<ChartLegend series={series} />}>
        <BarChart
          buckets={r.buckets.map((b) => ({ label: bucketLabel(b.start, unit), values: [b.started, b.ended] }))}
          series={series}
          caption={`Subscriptions started and ended ${unit === 'week' ? 'per week' : 'per month'}`}
          firstColumn={unit === 'week' ? 'Week of' : 'Month'}
        />
      </ReportCard>
      <ReportCard title="Running and monthly value" id="billing-periods" action={<CsvLink href={csvHref('billing-periods', period)} label="subscriptions per period" />}>
        <p className="mt-1 max-w-[72ch] text-sm text-fg-muted">At the end of each {unit}: subscriptions that had started and not ended, at the plan they have now (a change of plan is not kept as history).</p>
        <FigureTable<Bucket>
          caption="Subscriptions per period and their monthly value"
          testId="billing-period"
          rows={r.buckets}
          rowKey={(b) => b.start}
          columns={[
            { header: unit === 'week' ? 'Week of' : 'Month', cell: (b) => bucketLabel(b.start, unit) },
            { header: 'Started', cell: (b) => number.format(b.started) },
            { header: 'Ended', cell: (b) => number.format(b.ended) },
            { header: 'Running at the end', cell: (b) => number.format(b.running) },
            { header: 'Monthly value', cell: (b) => usd.format(b.monthlyCents / 100) },
          ]}
        />
      </ReportCard>
      <ReportCard title="By plan and status, now" id="billing-plans" action={<CsvLink href={csvHref('billing-plans', period)} label="subscriptions by plan and status" />}>
        {r.byPlan.length === 0 ? (
          <div className="mt-3">
            <EmptyState testId="billing-empty">No subscription yet. A test checkout on /billing adds one.</EmptyState>
          </div>
        ) : (
          <FigureTable<Plan>
            caption="Subscriptions by plan and status"
            testId="billing-plan"
            rows={r.byPlan}
            rowKey={(p) => p.code}
            columns={[
              { header: 'Plan', cell: (p) => p.name },
              ...statuses.map((s) => ({ header: SUBSCRIPTION_STATUS_LABELS[s], cell: (p: Plan) => number.format(p.counts[s]) })),
              { header: 'All', cell: (p) => number.format(p.total) },
            ]}
          />
        )}
      </ReportCard>
    </>
  );
}
