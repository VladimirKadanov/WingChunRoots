import { describe, expect, it } from 'vitest';

import { formatDay, isoDay, parseIsoDay } from './dates';

describe('dates', () => {
  it('formats a day in UTC', () => {
    expect(formatDay(new Date('2026-02-01T00:00:00Z'))).toBe('1 February 2026');
    expect(formatDay('2026-12-31T23:59:59Z')).toBe('31 December 2026');
  });

  it('round-trips an input date and refuses impossible dates', () => {
    expect(isoDay(parseIsoDay('2026-10-18')!)).toBe('2026-10-18');
    expect(parseIsoDay('2026-02-30')).toBeNull();
    expect(parseIsoDay('18.10.2026')).toBeNull();
    expect(parseIsoDay('')).toBeNull();
  });
});
