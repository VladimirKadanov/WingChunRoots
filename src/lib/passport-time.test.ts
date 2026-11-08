// Milestone M19 (In scope 3, 10; DEFAULT M19, question 2): experience only as precise as the dates,
// and the passport's timeline by year.

import { describe, expect, it } from 'vitest';

import { currentOf, entryDate, experience, storedPrefix, timelineByYear } from './passport-time';

const TODAY = '2026-11-07';

describe('experience by the precision of the dates (DEFAULT M19, question 2)', () => {
  it('a start year gives whole years with "about", never months', () => {
    const e = experience([{ start: '2015', end: null, ongoing: true }], null, TODAY)!;
    expect(e.text).toBe('since 2015 · about 11 years');
    expect(e.precision).toBe('year');
    expect(e.text).not.toMatch(/month/);
  });

  it('months only when every date it needs is known to the month', () => {
    expect(experience([{ start: '2015-03', end: null, ongoing: true }], null, TODAY)!.text).toBe('since March 2015 · 11 years, 8 months');
    expect(experience([{ start: '2015-03-12', end: '2019-05', ongoing: false }], null, TODAY)!.text).toBe('since 12 March 2015 · 4 years, 2 months');
    // An end known only to the year: whole years again.
    expect(experience([{ start: '2015-03', end: '2019', ongoing: false }], null, TODAY)!.text).toBe('since March 2015 · about 4 years');
  });

  it('a start year among the periods makes it whole years, whatever the other periods know', () => {
    const e = experience(
      [
        { start: '2016-04', end: '2018-06', ongoing: false },
        { start: '2014', end: null, ongoing: true },
      ],
      null,
      TODAY,
    )!;
    expect(e.text).toBe('since 2014 · about 12 years');
  });

  it('the year the person gave counts when it is earlier than every period', () => {
    expect(experience([{ start: '2018-09', end: null, ongoing: true }], 2012, TODAY)!.text).toBe('since 2012 · about 14 years');
    expect(experience([], 2020, TODAY)!.text).toBe('since 2020');
    expect(experience([], 2020, TODAY)!.startYear).toBe(2020);
  });

  it('runs to the latest end when nothing goes on, and says only "since" without any end', () => {
    expect(experience([{ start: '2001', end: '2009', ongoing: false }], null, TODAY)!.text).toBe('since 2001 · about 8 years');
    expect(experience([{ start: '2001-02', end: null, ongoing: false }], null, TODAY)!.text).toBe('since February 2001');
  });

  it('short spans: less than a year, a single month, and nothing invented within one year', () => {
    expect(experience([{ start: '2026-05', end: null, ongoing: true }], null, TODAY)!.text).toBe('since May 2026 · 6 months');
    expect(experience([{ start: '2026-11', end: null, ongoing: true }], null, TODAY)!.text).toBe('since November 2026 · less than a month');
    expect(experience([{ start: '2026', end: null, ongoing: true }], null, TODAY)!.text).toBe('since 2026');
  });

  it('nothing known: no experience at all', () => {
    expect(experience([{ start: null, end: null, ongoing: true }], null, TODAY)).toBeNull();
    expect(experience([], null, TODAY)).toBeNull();
  });
});

describe('dates of entries', () => {
  it('a stored first day by its precision', () => {
    expect(storedPrefix('2019-01-01', 'year')).toBe('2019');
    expect(storedPrefix('2019-05-01', 'month')).toBe('2019-05');
    expect(storedPrefix('2019-05-12', 'day')).toBe('2019-05-12');
    expect(storedPrefix(null, 'unknown')).toBeNull();
    expect(entryDate('2019-05')).toBe('May 2019');
    expect(entryDate(null)).toBe('Date not recorded');
  });
});

describe('the timeline (In scope 7)', () => {
  const at = (n: number) => `2026-10-0${n}T00:00:00.000Z`;
  it('by year, the latest first; a year-only entry after the finer ones of its year; undated last', () => {
    const years = timelineByYear([
      { id: 'a', date: '2019', createdAt: at(1) },
      { id: 'b', date: '2019-05-12', createdAt: at(2) },
      { id: 'c', date: '2021-02', createdAt: at(3) },
      { id: 'd', date: null, createdAt: at(4) },
      { id: 'e', date: null, createdAt: at(5) },
      { id: 'f', date: '2019-11', createdAt: at(6) },
    ]);
    expect(years.map((y) => [y.year, y.items.map((i) => i.id)])).toEqual([
      [2021, ['c']],
      [2019, ['f', 'b', 'a']],
      [null, ['e', 'd']],
    ]);
  });

  it('the current rank is the latest by date, otherwise the latest written', () => {
    expect(currentOf([{ id: 'a', date: '2018', createdAt: at(3) }, { id: 'b', date: '2021-06', createdAt: at(1) }])!.id).toBe('b');
    expect(currentOf([{ id: 'a', date: null, createdAt: at(1) }, { id: 'b', date: null, createdAt: at(2) }])!.id).toBe('b');
    expect(currentOf([{ id: 'a', date: null, createdAt: at(5) }, { id: 'b', date: '2010', createdAt: at(1) }])!.id).toBe('b');
    expect(currentOf([])).toBeNull();
  });
});
