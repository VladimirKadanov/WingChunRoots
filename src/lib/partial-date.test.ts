import { describe, expect, it } from 'vitest';

import { atPrecision, coarser, formatPartialDate, lastDayCovered, parsePartialDate, todayUtc, toPrefix } from './partial-date';

describe('partial dates (M09)', () => {
  it('parses a year, a month and a day with their precision', () => {
    expect(parsePartialDate('1985')).toEqual({ precision: 'year', firstDay: '1985-01-01', prefix: '1985' });
    expect(parsePartialDate(' 1992-02 ')).toEqual({ precision: 'month', firstDay: '1992-02-01', prefix: '1992-02' });
    expect(parsePartialDate('1992-02-29')).toEqual({ precision: 'day', firstDay: '1992-02-29', prefix: '1992-02-29' });
  });

  it('refuses what is not a real date', () => {
    for (const value of ['', '85', '1992-2', '1992-13', '1993-02-29', '1992-02-30', '1992/02', 'soon', '1992-02-03T00:00']) {
      expect(parsePartialDate(value), value).toBeNull();
    }
  });

  it('keeps one precision per period: the coarser, cutting the finer date down', () => {
    expect(coarser('day', 'month')).toBe('month');
    expect(coarser('year', 'day')).toBe('year');
    expect(atPrecision(parsePartialDate('1992-02-03')!, 'year')).toEqual({ precision: 'year', firstDay: '1992-01-01', prefix: '1992' });
    expect(atPrecision(parsePartialDate('1992-02-03')!, 'month')).toEqual({ precision: 'month', firstDay: '1992-02-01', prefix: '1992-02' });
    expect(atPrecision(parsePartialDate('1992')!, 'day')).toEqual(parsePartialDate('1992'));
  });

  it('knows the last day a date covers and its prefix', () => {
    expect(lastDayCovered(parsePartialDate('2024')!)).toBe('2024-12-31');
    expect(lastDayCovered(parsePartialDate('2024-02')!)).toBe('2024-02-29');
    expect(lastDayCovered(parsePartialDate('2023-02')!)).toBe('2023-02-28');
    expect(lastDayCovered(parsePartialDate('2024-02-10')!)).toBe('2024-02-10');
    expect(toPrefix('2024-02-10', 'month')).toBe('2024-02');
  });

  it('reads as people write it', () => {
    expect(formatPartialDate('1985')).toBe('1985');
    expect(formatPartialDate('2019-04')).toBe('April 2019');
    expect(formatPartialDate('2019-04-07')).toBe('7 April 2019');
    expect(todayUtc(new Date('2026-10-31T23:59:59Z'))).toBe('2026-10-31');
  });
});
