import { describe, expect, it } from 'vitest';

import { formatDay, formatShortDay, isoDay, lastDayOf, parseIsoDay, untilPlanEnd } from './dates';

describe('dates', () => {
  it('formats a day in UTC', () => {
    expect(formatDay(new Date('2026-02-01T00:00:00Z'))).toBe('1 February 2026');
    expect(formatDay('2026-12-31T23:59:59Z')).toBe('31 December 2026');
  });

  it('names the last full day of a plan that stops at 00:00 UTC (review round 1, design-11)', () => {
    expect(untilPlanEnd('2027-01-01T00:00:00.000Z')).toBe('until 31 December 2026');
    expect(untilPlanEnd(new Date('2026-12-18T00:00:00Z'))).toBe('until 17 December 2026');
    expect(formatDay(lastDayOf('2026-12-18T12:00:00Z'))).toBe('18 December 2026');
  });

  it('formats a short day for tables', () => {
    expect(formatShortDay('2026-10-19T00:00:00Z')).toBe('19 Oct 2026');
    expect(formatShortDay(new Date('2026-09-05T23:00:00Z'))).toBe('5 Sep 2026');
  });

  it('round-trips an input date and refuses impossible dates', () => {
    expect(isoDay(parseIsoDay('2026-10-18')!)).toBe('2026-10-18');
    expect(parseIsoDay('2026-02-30')).toBeNull();
    expect(parseIsoDay('18.10.2026')).toBeNull();
    expect(parseIsoDay('')).toBeNull();
  });
});
