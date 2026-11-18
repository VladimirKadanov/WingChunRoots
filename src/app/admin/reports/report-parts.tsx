// The parts of /admin/reports (docs/adr/0041-control-panel-reports.md): a bar chart drawn on the
// server as SVG, with the same numbers in a table for screen readers (as the dashboard's growth
// chart), a numeric table that becomes cards under 52rem, and a CSV download link. No script: a
// bar's value is in its <title> and in the table, never in a tooltip that needs JavaScript. The
// two series of a chart differ by shape (a filled bar, an outlined bar) as well as by tone, never
// by colour alone.

import type { ReactNode } from 'react';

import type { AdminLang, AdminT } from '@/components/admin/i18n/translate';
import { table as tbl } from '@/components/admin/table-parts';
import { cx } from '@/lib/cx';

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const BG_SHORT_MONTHS = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'] as const;
export const number = new Intl.NumberFormat('en');

/** "3 Nov" for a week, "Nov 2026" for a month (UTC); "3 ное" and "ное 2026" in Bulgarian. */
export function bucketLabel(start: string, unit: 'week' | 'month', lang: AdminLang = 'en'): string {
  const d = new Date(`${start}T00:00:00Z`);
  const month = (lang === 'bg' ? BG_SHORT_MONTHS : SHORT_MONTHS)[d.getUTCMonth()];
  return unit === 'month' ? `${month} ${d.getUTCFullYear()}` : `${d.getUTCDate()} ${month}`;
}

export interface ChartSeries {
  name: string;
  /** filled: solid ink; outline: an outlined bar in the second tone. */
  style: 'filled' | 'outline';
}

function SeriesKey({ style }: { style: ChartSeries['style'] }) {
  return (
    <svg aria-hidden="true" width="12" height="12" className="shrink-0">
      {style === 'filled' ? <rect width="12" height="12" rx="2" fill="var(--fg)" /> : <rect x="1" y="1" width="10" height="10" rx="2" fill="none" stroke="var(--cross-lineage)" strokeWidth="2" />}
    </svg>
  );
}

export function ChartLegend({ series }: { series: readonly ChartSeries[] }) {
  if (series.length < 2) return null;
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
      {series.map((s) => (
        <span key={s.name} className="inline-flex items-center gap-1.5">
          <SeriesKey style={s.style} />
          {s.name}
        </span>
      ))}
    </span>
  );
}

/**
 * Grouped bars, one group per bucket, on one axis from 0. The labels of the first and the last
 * bucket are drawn; every bucket is in the sr-only table and in each bar's title.
 */
export function BarChart({
  buckets,
  series,
  caption,
  firstColumn,
  format = (v: number) => number.format(v),
  testId,
}: {
  buckets: readonly { label: string; values: readonly number[] }[];
  series: readonly ChartSeries[];
  caption: string;
  firstColumn: string;
  format?: (value: number) => string;
  testId?: string;
}) {
  const W = 640;
  const H = 200;
  const left = 44;
  const right = 8;
  const top = 12;
  const bottom = 176;
  const max = Math.max(4, ...buckets.flatMap((b) => b.values));
  const step = niceStep(max / 4);
  const ceiling = step * 4;
  const y = (v: number) => bottom - (v / ceiling) * (bottom - top);
  const slot = (W - left - right) / Math.max(1, buckets.length);
  const gap = 2;
  const barWidth = Math.max(3, Math.min(22, (slot * 0.7 - gap * (series.length - 1)) / series.length));
  const groupWidth = barWidth * series.length + gap * (series.length - 1);
  return (
    <figure className="mt-4" data-testid={testId}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={left} x2={W - right} y1={y(i * step)} y2={y(i * step)} stroke="var(--border-subtle)" />
            <text x={left - 8} y={y(i * step) + 4} textAnchor="end" fontSize="11" fill="var(--fg-subtle)">
              {format(i * step)}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const x0 = left + i * slot + (slot - groupWidth) / 2;
          return (
            <g key={b.label}>
              {b.values.map((v, j) => {
                const s = series[j]!;
                const x = x0 + j * (barWidth + gap);
                const h = Math.max(0, bottom - y(v));
                const title = `${b.label}: ${s.name} ${format(v)}`;
                if (v === 0) {
                  return (
                    <line key={s.name} x1={x} x2={x + barWidth} y1={bottom - 0.5} y2={bottom - 0.5} stroke={s.style === 'filled' ? 'var(--fg)' : 'var(--cross-lineage)'} strokeWidth="1">
                      <title>{title}</title>
                    </line>
                  );
                }
                return s.style === 'filled' ? (
                  <rect key={s.name} x={x} y={bottom - h} width={barWidth} height={h} rx="2" fill="var(--fg)">
                    <title>{title}</title>
                  </rect>
                ) : (
                  <rect key={s.name} x={x + 1} y={bottom - h + 1} width={Math.max(1, barWidth - 2)} height={Math.max(1, h - 1)} rx="2" fill="none" stroke="var(--cross-lineage)" strokeWidth="2">
                    <title>{title}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
        {buckets.length > 0 ? (
          <>
            <text x={left} y={H - 4} fontSize="11" fill="var(--fg-subtle)">
              {buckets[0]!.label}
            </text>
            <text x={W - right} y={H - 4} fontSize="11" fill="var(--fg-subtle)" textAnchor="end">
              {buckets[buckets.length - 1]!.label}
            </text>
          </>
        ) : null}
      </svg>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{firstColumn}</th>
            {series.map((s) => (
              <th key={s.name} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.label}>
              <th scope="row">{b.label}</th>
              {b.values.map((v, j) => (
                <td key={series[j]!.name}>{format(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** 1, 2 or 5 times a power of ten, at least `raw` (a whole number, at least 1). */
export function niceStep(raw: number): number {
  const target = Math.max(1, raw);
  const power = 10 ** Math.floor(Math.log10(target));
  for (const m of [1, 2, 5, 10]) if (m * power >= target) return Math.ceil(m * power);
  return Math.ceil(10 * power);
}

export function ReportCard({ title, id, action, children, testId }: { title: string; id: string; action?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-md border border-border-subtle bg-surface-1 p-5" data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="font-display text-2xl">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The link that downloads one table as CSV (a plain GET, staff-guarded by its route). */
export function CsvLink({ href, label, t }: { href: string; label: string; t: AdminT }) {
  return (
    <a href={href} download className="link inline-flex min-h-11 items-center text-ui" data-testid="report-csv">
      {t('Download CSV')}<span className="sr-only">: {label}</span>
    </a>
  );
}

export interface Column<R> {
  header: string;
  cell: (row: R) => ReactNode;
  numeric?: boolean;
}

/** A dense table of figures; the first column names the row, the others are numbers right-aligned. Cards under 52rem. */
export function FigureTable<R>({ caption, columns, rows, rowKey, footer, testId }: { caption: string; columns: readonly Column<R>[]; rows: readonly R[]; rowKey: (row: R) => string; footer?: R; testId?: string }) {
  const line = (row: R, total: boolean) => (
    <tr role="row" key={total ? '__total' : rowKey(row)} className={cx(tbl.row, total && 'font-semibold')} data-testid={total ? `${testId}-total` : `${testId}-row`}>
      {columns.map((c, i) =>
        i === 0 ? (
          <th role="rowheader" scope="row" key={c.header} className={cx(tbl.td, 'font-semibold [overflow-wrap:anywhere]')}>
            {c.cell(row)}
          </th>
        ) : (
          <td role="cell" key={c.header} className={cx(tbl.td, c.numeric !== false && 'tabular @min-[52rem]:text-right')}>
            <span className={tbl.cardLabel}>{c.header}</span>
            {c.cell(row)}
          </td>
        ),
      )}
    </tr>
  );
  return (
    <div className="mt-3 @container">
      <table role="table" className={tbl.table} data-testid={testId}>
        <caption className="sr-only">{caption}</caption>
        <thead role="rowgroup" className={tbl.thead}>
          <tr role="row" className={tbl.headRow}>
            {columns.map((c, i) => (
              <th role="columnheader" scope="col" key={c.header} className={cx(tbl.th, i > 0 && c.numeric !== false && 'text-right')}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className={tbl.tbody}>
          {rows.map((row) => line(row, false))}
          {footer ? line(footer, true) : null}
        </tbody>
      </table>
    </div>
  );
}
