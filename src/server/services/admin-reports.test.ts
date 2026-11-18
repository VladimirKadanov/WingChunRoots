// The pure parts of the control panel's reports (docs/adr/0041-control-panel-reports.md): the
// buckets of a period, filling the missing ones, shares, days, the stage of a school, and the CSV
// fields (quoted per RFC 4180, a formula never run by a spreadsheet).

import { describe, expect, it } from 'vitest';

import { bucketLabel, niceStep } from '../../app/admin/reports/report-parts';
import { bucketEnds, fillSeries, percent, reportRange, schoolStageKey, secondsToDays } from './admin-reports';
import { csvField, csvFileName, isReportTable, REPORT_TABLES, toCsv } from './admin-reports-csv';

const now = new Date('2026-11-18T10:30:00Z'); // a Wednesday

describe('reportRange', () => {
  it('ends with the current week, from Monday 00:00 UTC', () => {
    const r = reportRange('30d', now);
    expect(r.unit).toBe('week');
    expect(r.starts).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']);
    expect(r.from).toBe('2026-10-19T00:00:00.000Z');
    expect(r.to).toBe(now.toISOString());
    expect(reportRange('90d', now).starts).toHaveLength(13);
  });

  it('has twelve calendar months, across a year end', () => {
    const r = reportRange('12m', now);
    expect(r.unit).toBe('month');
    expect(r.starts[0]).toBe('2025-12-01');
    expect(r.starts.at(-1)).toBe('2026-11-01');
    expect(reportRange('12m', new Date('2026-01-05T00:00:00Z')).starts.slice(0, 2)).toEqual(['2025-02-01', '2025-03-01']);
  });

  it('ends each bucket where the next starts, the last one now', () => {
    const r = reportRange('30d', now);
    const ends = bucketEnds(r);
    expect(ends[0]).toBe('2026-10-26T00:00:00.000Z');
    expect(ends.at(-1)).toBe(now.toISOString());
  });
});

describe('fillSeries', () => {
  it('puts 0 in the buckets without rows and adds rows of the same bucket', () => {
    const r = reportRange('30d', now);
    const filled = fillSeries(r, ['opened', 'decided'] as const, [
      { bucket: '2026-11-16', key: 'opened', n: 2 },
      { bucket: '2026-11-16', key: 'opened', n: 1 },
      { bucket: '2026-10-19T00:00:00', key: 'decided', n: 4 },
      { bucket: '2020-01-06', key: 'decided', n: 9 },
    ]);
    expect(filled).toHaveLength(5);
    expect(filled[0]).toEqual({ start: '2026-10-19', opened: 0, decided: 4 });
    expect(filled[4]).toEqual({ start: '2026-11-16', opened: 3, decided: 0 });
  });
});

describe('small figures', () => {
  it('rounds shares and days, with null when there is nothing', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(0, 0)).toBeNull();
    expect(secondsToDays(86400 * 2.44)).toBe(2.4);
    expect(secondsToDays(null)).toBeNull();
  });

  it('names the stage of a school', () => {
    expect(schoolStageKey('active', 'current')).toBe('current');
    expect(schoolStageKey('active', 'awaiting_confirmation')).toBe('awaiting_confirmation');
    expect(schoolStageKey('active', 'hidden')).toBe('activity_hidden');
    expect(schoolStageKey('pending_review', 'current')).toBe('pending_review');
    expect(schoolStageKey('unknown', 'current')).toBeNull();
  });

  it('labels buckets and steps the axis', () => {
    expect(bucketLabel('2026-11-16', 'week')).toBe('16 Nov');
    expect(bucketLabel('2026-11-01', 'month')).toBe('Nov 2026');
    expect(niceStep(1)).toBe(1);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(12)).toBe(20);
    expect(niceStep(0.3)).toBe(1);
  });
});

describe('CSV', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvField('Demo, Lineage')).toBe('"Demo, Lineage"');
    expect(csvField('Demo "A"')).toBe('"Demo ""A"""');
    expect(csvField('a\nb')).toBe('"a\nb"');
    expect(csvField(null)).toBe('');
    expect(csvField(12)).toBe('12');
  });

  it('never lets a spreadsheet run a text as a formula', () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('-2')).toBe("'-2");
    expect(csvField('@sum')).toBe("'@sum");
    expect(csvField(-2)).toBe('-2');
  });

  it('writes CRLF lines with the header first', () => {
    expect(toCsv(['A', 'B'], [[1, 'x']])).toBe('A,B\r\n1,x\r\n');
  });

  it('knows its tables and names its files', () => {
    expect(isReportTable('review-groups')).toBe(true);
    expect(isReportTable('toString')).toBe(false);
    expect(isReportTable('../etc')).toBe(false);
    expect(Object.keys(REPORT_TABLES)).toHaveLength(9);
    expect(csvFileName('schools-cities', '12m', '2026-11-18T10:30:00.000Z')).toBe('wingchunroots-schools-cities-12m-2026-11-18.csv');
  });
});
