// The CSV downloads of /admin/reports (docs/adr/0041-control-panel-reports.md): one file per table
// of a report, the same aggregate rows the page shows and nothing more (no person, account or
// e-mail address; a lineage, a country and a city by name, as the page). Pure: the route handler
// src/app/api/admin/reports/[table]/route.ts reads the report through oRPC and writes these.

import { countryName } from '@/lib/regions';

import {
  type ArchiveReport,
  type BillingReport,
  GROWTH_LABELS,
  GROWTH_SERIES,
  type GrowthReport,
  type ReportPeriod,
  type ReviewReport,
  type SchoolsReport,
  type StaffReportKind,
  SUBSCRIPTION_STATUS_LABELS,
} from './admin-reports';

type Cell = string | number | null;

/**
 * One CSV field (RFC 4180): quoted when it holds a comma, a quote or a line break. A text that a
 * spreadsheet would run as a formula (=, +, -, @, a tab or a carriage return first) gets a leading
 * apostrophe, so a lineage or city name can never become one; numbers stay numbers.
 */
export function csvField(value: Cell): string {
  if (value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The rows as CSV text with CRLF line ends, the header first. */
export function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  return [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/** The tables that can be downloaded, by the report they come from. */
export const REPORT_TABLES = {
  growth: { report: 'growth', title: 'Growth per period' },
  'review-periods': { report: 'review', title: 'Review cases opened and decided per period' },
  'review-groups': { report: 'review', title: 'Review throughput by group' },
  'archive-lineages': { report: 'archive', title: 'Archive completeness by lineage' },
  'schools-stages': { report: 'schools', title: 'Schools by stage' },
  'schools-countries': { report: 'schools', title: 'Listed schools by country' },
  'schools-cities': { report: 'schools', title: 'Listed schools by city' },
  'billing-periods': { report: 'billing', title: 'Subscriptions per period (test mode)' },
  'billing-plans': { report: 'billing', title: 'Subscriptions by plan and status (test mode)' },
} as const satisfies Record<string, { report: StaffReportKind | 'billing'; title: string }>;
export type ReportTable = keyof typeof REPORT_TABLES;

export function isReportTable(value: string): value is ReportTable {
  return Object.hasOwn(REPORT_TABLES, value);
}

/** "wingchunroots-review-groups-90d-2026-11-17.csv" */
export function csvFileName(table: ReportTable, period: ReportPeriod, at: string): string {
  return `wingchunroots-${table}-${period}-${at.slice(0, 10)}.csv`;
}

const PERIOD_START = 'Period starting (UTC)';
const dollars = (cents: number) => (cents / 100).toFixed(2);

type AnyReport = GrowthReport | ReviewReport | ArchiveReport | SchoolsReport | BillingReport;

/** The CSV text of one table of a report; the report must be the table's own kind. */
export function reportTableCsv(table: ReportTable, report: AnyReport): string {
  if (REPORT_TABLES[table].report !== report.kind) throw new Error(`The table ${table} is not part of the ${report.kind} report`);
  switch (table) {
    case 'growth': {
      const r = report as GrowthReport;
      return toCsv([PERIOD_START, ...GROWTH_SERIES.map((k) => GROWTH_LABELS[k])], r.buckets.map((b) => [b.start, ...GROWTH_SERIES.map((k) => b[k])]));
    }
    case 'review-periods': {
      const r = report as ReviewReport;
      return toCsv([PERIOD_START, 'Opened', 'Decided'], r.buckets.map((b) => [b.start, b.opened, b.decided]));
    }
    case 'review-groups': {
      const r = report as ReviewReport;
      const row = (label: string, g: ReviewReport['totals']): Cell[] => [label, g.opened, g.decided, g.approved, g.rejected, g.dismissed, g.medianDays, g.appealed, g.openNow];
      return toCsv(
        ['Group', 'Opened', 'Decided', 'Approved', 'Rejected', 'Closed without a decision', 'Median days to decision', 'Appealed', 'Open now'],
        [...r.groups.map((g) => row(g.label, g)), row('All groups', r.totals)],
      );
    }
    case 'archive-lineages': {
      const r = report as ArchiveReport;
      return toCsv(
        ['Lineage', 'People', 'Established links', 'Sourced links', 'Sourced share (%)', 'Links added in period'],
        [...r.lineages.map((l): Cell[] => [l.name, l.people, l.links, l.sourced, l.sourcedPercent, l.addedInPeriod]), ['All lineages', r.totals.people, r.totals.links, r.totals.sourced, r.totals.sourcedPercent, r.totals.addedInPeriod]],
      );
    }
    case 'schools-stages': {
      const r = report as SchoolsReport;
      return toCsv(['Stage', 'Schools', 'Added in period'], r.stages.map((s) => [s.label, s.count, s.addedInPeriod]));
    }
    case 'schools-countries': {
      const r = report as SchoolsReport;
      return toCsv(['Country', 'Country code', 'Listed schools', 'Cities', 'Added in period'], r.countries.map((c) => [countryName(c.countryCode), c.countryCode, c.listed, c.cities, c.addedInPeriod]));
    }
    case 'schools-cities': {
      const r = report as SchoolsReport;
      return toCsv(['City', 'Country code', 'Listed schools'], r.cities.map((c) => [c.city, c.countryCode, c.listed]));
    }
    case 'billing-periods': {
      const r = report as BillingReport;
      return toCsv([PERIOD_START, 'Started', 'Ended', 'Running at the end', 'Monthly value at the end (USD, test mode)'], r.buckets.map((b) => [b.start, b.started, b.ended, b.running, dollars(b.monthlyCents)]));
    }
    case 'billing-plans': {
      const r = report as BillingReport;
      const statuses = Object.keys(SUBSCRIPTION_STATUS_LABELS) as (keyof typeof SUBSCRIPTION_STATUS_LABELS)[];
      return toCsv(['Plan', ...statuses.map((s) => SUBSCRIPTION_STATUS_LABELS[s]), 'All'], r.byPlan.map((p) => [p.name, ...statuses.map((s) => p.counts[s]), p.total]));
    }
  }
}
