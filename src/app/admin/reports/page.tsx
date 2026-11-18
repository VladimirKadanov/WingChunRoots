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
import { getAdminT } from '@/components/admin/i18n/server';
import type { AdminT } from '@/components/admin/i18n/translate';
import { adminFieldClass, AdminPageHeader, EmptyState } from '@/components/admin/table-parts';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { countryName } from '@/lib/regions';
import { guardRoute } from '@/server/auth/web';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { ReportTable } from '@/server/services/admin-reports-csv';
import {
  type ArchiveReport,
  type BillingReport,
  DEFAULT_REPORT_PERIOD,
  GROWTH_SERIES,
  type GrowthReport,
  type GrowthSeries,
  REPORT_PERIODS,
  type ReportPeriod,
  type ReportRange,
  type ReviewReport,
  type SchoolsReport,
  type SchoolStageKey,
  type StaffReport,
  type SubscriptionStatus,
  SUBSCRIPTION_STATUS_LABELS,
} from '@/server/services/admin-reports';

import { BarChart, bucketLabel, ChartLegend, type ChartSeries, CsvLink, FigureTable, ReportCard } from './report-parts';

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getAdminT();
  return { title: t('Reports'), robots: { index: false } };
}

const PAGE = '/admin/reports';
const REPORTS = [{ key: 'growth' }, { key: 'review' }, { key: 'archive' }, { key: 'schools' }, { key: 'billing', adminOnly: true }] as const;
type ReportKey = (typeof REPORTS)[number]['key'];

/** A report's name and its note in the list. */
function reportText(t: AdminT, key: ReportKey): { label: string; note: string } {
  switch (key) {
    case 'growth': return { label: t('Growth'), note: t('Accounts, people on record, verified links, schools') };
    case 'review': return { label: t('Review throughput'), note: t('Requests opened and decided, time to decide') };
    case 'archive': return { label: t('Archive completeness'), note: t('People and sourced links per lineage') };
    case 'schools': return { label: t('Schools'), note: t('By stage, country and city') };
    case 'billing': return { label: t('Billing'), note: t('Plans and their monthly value (test mode)') };
  }
}

function periodLabel(t: AdminT, period: ReportPeriod): string {
  switch (period) {
    case '30d': return t('Last 30 days');
    case '90d': return t('Last 90 days');
    case '12m': return t('Last 12 months');
  }
}

function growthLabel(t: AdminT, key: GrowthSeries): string {
  switch (key) {
    case 'accounts': return t('New accounts');
    case 'people': return t('New people on record');
    case 'verifiedLinks': return t('Links verified');
    case 'schools': return t('Schools added, listed now');
  }
}

/** The review groups of admin-dashboard.ts REVIEW_KIND_GROUPS, by key; an unknown one keeps its label. */
function groupLabel(t: AdminT, key: string, label: string): string {
  switch (key) {
    case 'claims': return t('Historical and profile claims');
    case 'instructors': return t('Instructor checks');
    case 'schools': return t('School listings');
    case 'organizations': return t('Organizations');
    case 'records': return t('Record proposals');
    case 'disputes': return t('Disputes, reports and appeals');
    case 'deletions': return t('Account deletion requests');
    case 'all': return t('All groups');
    default: return label;
  }
}

function stageLabel(t: AdminT, key: SchoolStageKey): string {
  switch (key) {
    case 'current': return t('Listed, current');
    case 'awaiting_confirmation': return t('Listed, awaiting confirmation');
    case 'activity_hidden': return t('Hidden from the map (no confirmation)');
    case 'pending_review': return t('Waiting for review');
    case 'draft': return t('Draft');
    case 'hidden': return t('Hidden by staff or the owner');
    case 'archived': return t('Archived');
  }
}

function statusLabel(t: AdminT, status: SubscriptionStatus): string {
  switch (status) {
    case 'incomplete': return t('Not completed');
    case 'active': return t('Active');
    case 'past_due': return t('Payment overdue');
    case 'canceled': return t('Ended');
  }
}

/** A country's name: English as the rest of the site shows it, Bulgarian from Intl. */
function country(t: AdminT, code: string): string | null {
  if (t.lang === 'en') return countryName(code);
  try {
    return new Intl.DisplayNames(t.locale, { type: 'region' }).of(code) ?? countryName(code);
  } catch {
    return countryName(code);
  }
}

function loadError(t: AdminT) {
  return {
    eyebrow: t('Control panel'),
    title: t('Reports'),
    message: t("We couldn't load this report. Nothing was changed."),
    back: { href: '/admin', label: t('Back to the dashboard') },
  };
}

type Search = Promise<Record<string, string | string[] | undefined>>;

function reportsHref(report: ReportKey, period: ReportPeriod): string {
  const params = new URLSearchParams();
  if (report !== 'growth') params.set('report', report);
  if (period !== DEFAULT_REPORT_PERIOD) params.set('period', period);
  const search = params.toString();
  return search ? `${PAGE}?${search}` : PAGE;
}

const csvHref = (table: ReportTable, period: ReportPeriod) => `/api/admin/reports/${table}?period=${period}`;
const usdOf = (t: AdminT) => new Intl.NumberFormat(t.locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
function days(t: AdminT, d: number | null): string {
  if (d === null) return '—';
  const fixed = t.lang === 'bg' ? d.toFixed(1).replace('.', ',') : d.toFixed(1);
  return d === 1 ? t('{d} day', { d: fixed }) : t('{d} days', { d: fixed });
}
const pct = (p: number | null) => (p === null ? '—' : `${p}%`);
const perUnit = (t: AdminT, unit: ReportRange['unit']) => (unit === 'week' ? t('per week') : t('per month'));
const firstColumnOf = (t: AdminT, unit: ReportRange['unit']) => (unit === 'week' ? t('Week of') : t('Month'));

function rangeLine(t: AdminT, range: ReportRange): string {
  const from = t.day(range.from);
  const to = t.day(range.to);
  return range.unit === 'week' ? t('{from} to {to}, per week (from Monday), UTC.', { from, to }) : t('{from} to {to}, per month, UTC.', { from, to });
}

const FILLED_OUTLINE = (a: string, b: string): ChartSeries[] => [
  { name: a, style: 'filled' },
  { name: b, style: 'outline' },
];

export default async function AdminReportsPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const t = await getAdminT();
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
  if (!data) return <LoadError {...loadError(t)} retryHref={reportsHref(report, period)} />;
  const current = reportText(t, report);

  return (
    <div className="mx-auto max-w-[96rem] px-page pt-6 pb-10 md:pt-8 md:pb-14">
      <AdminPageHeader
        eyebrow={
          <Link href="/admin" className="link inline-flex min-h-11 items-center">
            {t('Control panel')}
          </Link>
        }
        title={t('Reports')}
        summary={<span data-testid="report-range">{rangeLine(t, data.range)}</span>}
        intro={t('Counts only: no row names a person, an account or an e-mail address, and schools are counted by city, never by their place on the map. Each table downloads as CSV with the same rows.')}
      />

      <form action={PAGE} method="get" className="mt-5 flex flex-wrap items-end gap-3" data-testid="report-period-form">
        {report !== 'growth' ? <input type="hidden" name="report" value={report} /> : null}
        <div className="grid min-w-0 basis-[14rem] gap-1.5">
          <label htmlFor="report-period" className="text-sm font-semibold">
            {t('Period')}
          </label>
          <select id="report-period" name="period" defaultValue={period} className={adminFieldClass}>
            {REPORT_PERIODS.map((p) => (
              <option key={p} value={p}>
                {periodLabel(t, p)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
          {t('Show')}
        </button>
      </form>

      <div className="mt-6 grid gap-5 2xl:grid-cols-[15rem_minmax(0,1fr)] 2xl:items-start">
        <nav aria-label={t('Reports')}>
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
                  <span>{reportText(t, r.key).label}</span>
                  <span className="hidden text-sm font-normal text-fg-muted 2xl:block">{reportText(t, r.key).note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <section aria-label={current.label} className="grid min-w-0 gap-4" data-testid="report" data-report={report}>
          {data.kind === 'growth' ? <Growth r={data} period={period} t={t} /> : null}
          {data.kind === 'review' ? <Review r={data} period={period} t={t} /> : null}
          {data.kind === 'archive' ? <Archive r={data} period={period} t={t} /> : null}
          {data.kind === 'schools' ? <Schools r={data} period={period} t={t} /> : null}
          {data.kind === 'billing' ? <Billing r={data} period={period} t={t} /> : null}
        </section>
      </div>
    </div>
  );
}

function Growth({ r, period, t }: { r: GrowthReport; period: ReportPeriod; t: AdminT }) {
  const unit = r.range.unit;
  return (
    <>
      <section aria-label={t('Totals')} className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
        {GROWTH_SERIES.map((key) => (
          <div key={key} className="grid min-w-0 content-start gap-1.5 rounded-md border border-border-subtle bg-surface-1 p-4" data-testid="growth-total" data-series={key}>
            <span className="text-sm text-fg-muted">{growthLabel(t, key)}</span>
            <span className="font-display text-2xl leading-none">{t.num(r.totals[key].inPeriod)}</span>
            <span className="text-sm text-fg-muted">{t('{count} in all now', { count: t.num(r.totals[key].now) })}</span>
          </div>
        ))}
      </section>
      {GROWTH_SERIES.map((key) => (
        <ReportCard key={key} title={growthLabel(t, key)} id={`growth-${key}`}>
          <BarChart
            buckets={r.buckets.map((b) => ({ label: bucketLabel(b.start, unit, t.lang), values: [b[key]] }))}
            series={[{ name: growthLabel(t, key), style: 'filled' }]}
            caption={t('{series} {unit}', { series: growthLabel(t, key), unit: perUnit(t, unit) })}
            firstColumn={firstColumnOf(t, unit)}
            format={t.num}
          />
        </ReportCard>
      ))}
      <p className="text-sm text-fg-muted">
        {t('Schools count by the day they were added, if they are listed now. People on record leave out erased records.')} <CsvLink t={t} href={csvHref('growth', period)} label={t('growth per period')} />
      </p>
    </>
  );
}

function Review({ r, period, t }: { r: ReviewReport; period: ReportPeriod; t: AdminT }) {
  const unit = r.range.unit;
  const series = FILLED_OUTLINE(t('Opened'), t('Decided'));
  type Row = ReviewReport['groups'][number];
  const total: Row = { key: 'all', label: t('All groups'), ...r.totals };
  return (
    <>
      <ReportCard title={t('Requests opened and decided, {unit}', { unit: perUnit(t, unit) })} id="review-chart" action={<ChartLegend series={series} />} testId="review-chart">
        <BarChart
          buckets={r.buckets.map((b) => ({ label: bucketLabel(b.start, unit, t.lang), values: [b.opened, b.decided] }))}
          series={series}
          caption={t('Review requests opened and decided {unit}', { unit: perUnit(t, unit) })}
          firstColumn={firstColumnOf(t, unit)}
          format={t.num}
        />
        <p className="mt-2 text-sm text-fg-muted">
          {t('{opened} opened and {decided} decided in the period; median time to a decision {median}.', { opened: t.num(r.totals.opened), decided: t.num(r.totals.decided), median: days(t, r.totals.medianDays) })}{' '}
          <CsvLink t={t} href={csvHref('review-periods', period)} label={t('opened and decided per period')} />
        </p>
      </ReportCard>
      <ReportCard title={t('By group')} id="review-groups" action={<CsvLink t={t} href={csvHref('review-groups', period)} label={t('review throughput by group')} />}>
        <p className="mt-1 text-sm text-fg-muted">{t('Decided means approved, rejected or closed without a decision (withdrawn, or the account was erased). The median counts the cases decided in the period.')}</p>
        <FigureTable<Row>
          caption={t('Review throughput by group in the period')}
          testId="review-group"
          rows={r.groups}
          rowKey={(g) => g.key}
          footer={total}
          columns={[
            { header: t('Group'), cell: (g) => groupLabel(t, g.key, g.label) },
            { header: t('Opened'), cell: (g) => t.num(g.opened) },
            { header: t('Decided'), cell: (g) => t.num(g.decided) },
            { header: t('Approved'), cell: (g) => t.num(g.approved) },
            { header: t('Rejected'), cell: (g) => t.num(g.rejected) },
            { header: t('Closed'), cell: (g) => t.num(g.dismissed) },
            { header: t('Median time'), cell: (g) => days(t, g.medianDays) },
            { header: t('Appealed'), cell: (g) => t.num(g.appealed) },
            { header: t('Open now'), cell: (g) => t.num(g.openNow) },
          ]}
        />
      </ReportCard>
    </>
  );
}

function Archive({ r, period, t }: { r: ArchiveReport; period: ReportPeriod; t: AdminT }) {
  type Row = ArchiveReport['lineages'][number];
  return (
    <ReportCard title={t('Archive completeness by lineage')} id="archive-lineages" action={<CsvLink t={t} href={csvHref('archive-lineages', period)} label={t('archive completeness by lineage')} />}>
      <p className="mt-1 max-w-[72ch] text-sm text-fg-muted">
        {t('Established links are verified or in arbitration. A link is sourced when an archivist noted where it was found, or an evidence file is attached to it or to its review.')}{' '}
        {t('Someone in two lineages counts once in the total.')}
      </p>
      {r.lineages.length === 0 ? (
        <div className="mt-3">
          <EmptyState testId="archive-empty">{t('No lineage is recorded yet. Add one in the archive editor.')}</EmptyState>
        </div>
      ) : (
        <FigureTable<Row>
          caption={t('People, established links and sourced links per lineage')}
          testId="archive-lineage"
          rows={r.lineages}
          rowKey={(l) => l.slug}
          footer={{ slug: '', name: t('All lineages'), ...r.totals }}
          columns={[
            { header: t('Lineage'), cell: (l) => (l.slug ? <span translate="no">{l.name}</span> : l.name) },
            { header: t('People'), cell: (l) => t.num(l.people) },
            { header: t('Links'), cell: (l) => t.num(l.links) },
            { header: t('Sourced'), cell: (l) => t.num(l.sourced) },
            { header: t('Sourced share'), cell: (l) => <ShareBar value={l.sourcedPercent} /> },
            { header: t('Added in period'), cell: (l) => t.num(l.addedInPeriod) },
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

function Schools({ r, period, t }: { r: SchoolsReport; period: ReportPeriod; t: AdminT }) {
  type Stage = SchoolsReport['stages'][number];
  type Country = SchoolsReport['countries'][number];
  type City = SchoolsReport['cities'][number];
  return (
    <>
      <ReportCard title={t('Schools by stage')} id="schools-stages" action={<CsvLink t={t} href={csvHref('schools-stages', period)} label={t('schools by stage')} />}>
        <p className="mt-1 text-sm text-fg-muted">{t('{count} on the public map now. A listed school awaits confirmation from day 90 without an edit, and is hidden from the map from day 105.', { count: t.num(r.listed) })}</p>
        <FigureTable<Stage>
          caption={t('Schools by stage')}
          testId="schools-stage"
          rows={r.stages}
          rowKey={(s) => s.key}
          columns={[
            { header: t('Stage'), cell: (s) => stageLabel(t, s.key) },
            { header: t('Schools'), cell: (s) => t.num(s.count) },
            { header: t('Added in period'), cell: (s) => t.num(s.addedInPeriod) },
          ]}
        />
      </ReportCard>
      <ReportCard title={t('Listed schools by country')} id="schools-countries" action={<CsvLink t={t} href={csvHref('schools-countries', period)} label={t('listed schools by country')} />}>
        {r.countries.length === 0 ? (
          <div className="mt-3">
            <EmptyState testId="schools-empty">{t('No school is on the public map yet. New listings are decided in the review queue.')}</EmptyState>
          </div>
        ) : (
          <FigureTable<Country>
            caption={t('Listed schools by country')}
            testId="schools-country"
            rows={r.countries}
            rowKey={(c) => c.countryCode}
            columns={[
              { header: t('Country'), cell: (c) => country(t, c.countryCode) },
              { header: t('Listed schools'), cell: (c) => t.num(c.listed) },
              { header: t('Cities'), cell: (c) => t.num(c.cities) },
              { header: t('Added in period'), cell: (c) => t.num(c.addedInPeriod) },
            ]}
          />
        )}
      </ReportCard>
      {r.cities.length > 0 ? (
        <ReportCard title={t('Listed schools by city')} id="schools-cities" action={<CsvLink t={t} href={csvHref('schools-cities', period)} label={t('listed schools by city')} />}>
          <FigureTable<City>
            caption={t('Listed schools by city, the most first')}
            testId="schools-city"
            rows={r.cities}
            rowKey={(c) => `${c.countryCode}-${c.city}`}
            columns={[
              { header: t('City'), cell: (c) => <span translate="no">{c.city}</span> },
              { header: t('Country'), cell: (c) => country(t, c.countryCode), numeric: false },
              { header: t('Listed schools'), cell: (c) => t.num(c.listed) },
            ]}
          />
        </ReportCard>
      ) : null}
    </>
  );
}

function Billing({ r, period, t }: { r: BillingReport; period: ReportPeriod; t: AdminT }) {
  const unit = r.range.unit;
  const series = FILLED_OUTLINE(t('Started'), t('Ended'));
  const usd = usdOf(t);
  type Bucket = BillingReport['buckets'][number];
  type Plan = BillingReport['byPlan'][number];
  const statuses = Object.keys(SUBSCRIPTION_STATUS_LABELS) as (keyof typeof SUBSCRIPTION_STATUS_LABELS)[];
  return (
    <>
      <p className="text-ui" data-testid="billing-monthly">
        {t('Test mode, no real charge. Monthly value now at the proposed prices:')} <strong>{usd.format(r.monthlyCents / 100)}</strong> {t('(a yearly plan counts a twelfth).')}
      </p>
      <ReportCard title={t('Subscriptions started and ended, {unit}', { unit: perUnit(t, unit) })} id="billing-chart" action={<ChartLegend series={series} />}>
        <BarChart
          buckets={r.buckets.map((b) => ({ label: bucketLabel(b.start, unit, t.lang), values: [b.started, b.ended] }))}
          series={series}
          caption={t('Subscriptions started and ended {unit}', { unit: perUnit(t, unit) })}
          firstColumn={firstColumnOf(t, unit)}
          format={t.num}
        />
      </ReportCard>
      <ReportCard title={t('Running and monthly value')} id="billing-periods" action={<CsvLink t={t} href={csvHref('billing-periods', period)} label={t('subscriptions per period')} />}>
        <p className="mt-1 max-w-[72ch] text-sm text-fg-muted">
          {unit === 'week'
            ? t('At the end of each week: subscriptions that had started and not ended, at the plan they have now (a change of plan is not kept as history).')
            : t('At the end of each month: subscriptions that had started and not ended, at the plan they have now (a change of plan is not kept as history).')}
        </p>
        <FigureTable<Bucket>
          caption={t('Subscriptions per period and their monthly value')}
          testId="billing-period"
          rows={r.buckets}
          rowKey={(b) => b.start}
          columns={[
            { header: firstColumnOf(t, unit), cell: (b) => bucketLabel(b.start, unit, t.lang) },
            { header: t('Started'), cell: (b) => t.num(b.started) },
            { header: t('Ended'), cell: (b) => t.num(b.ended) },
            { header: t('Running at the end'), cell: (b) => t.num(b.running) },
            { header: t('Monthly value'), cell: (b) => usd.format(b.monthlyCents / 100) },
          ]}
        />
      </ReportCard>
      <ReportCard title={t('By plan and status, now')} id="billing-plans" action={<CsvLink t={t} href={csvHref('billing-plans', period)} label={t('subscriptions by plan and status')} />}>
        {r.byPlan.length === 0 ? (
          <div className="mt-3">
            <EmptyState testId="billing-empty">{t('No subscription yet. A test checkout on /billing adds one.')}</EmptyState>
          </div>
        ) : (
          <FigureTable<Plan>
            caption={t('Subscriptions by plan and status')}
            testId="billing-plan"
            rows={r.byPlan}
            rowKey={(p) => p.code}
            columns={[
              { header: t('Plan'), cell: (p) => p.name },
              ...statuses.map((s) => ({ header: statusLabel(t, s), cell: (p: Plan) => t.num(p.counts[s]) })),
              { header: t('All'), cell: (p) => t.num(p.total) },
            ]}
          />
        )}
      </ReportCard>
    </>
  );
}
