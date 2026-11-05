// The time of an event (milestone M17, In scope 9): wall times across the changes of summer time,
// the month key in the event's zone (DEFAULT M17, question 1) and the dates as the pages show them.

import { describe, expect, it } from 'vitest';

import {
  formatEventWhen,
  isoInZone,
  isTimeZone,
  monthKey,
  monthLabel,
  offsetLabel,
  parseWallTime,
  toWallTime,
  wallTimeToInstant,
  zoneOffsetMinutes,
} from './event-time';

const at = (iso: string) => new Date(iso);
const instant = (value: string, zone: string) => {
  const r = wallTimeToInstant(value, zone);
  if (!r.ok) throw new Error(`${value} in ${zone}: ${r.reason}`);
  return r.instant.toISOString();
};

describe('isTimeZone', () => {
  it('accepts IANA zones and UTC, refuses anything else', () => {
    for (const zone of ['Europe/Sofia', 'America/New_York', 'Asia/Hong_Kong', 'America/Argentina/Buenos_Aires', 'UTC']) expect(isTimeZone(zone), zone).toBe(true);
    for (const zone of ['', 'Sofia', 'Europe/Nowhere', 'Europe/Sofia; DROP', '+02:00', 'GMT+2', 42, null]) expect(isTimeZone(zone), String(zone)).toBe(false);
  });
});

describe('parseWallTime', () => {
  it('reads a form value and refuses dates that do not exist', () => {
    expect(parseWallTime('2027-03-13T10:00')).toEqual({ year: 2027, month: 3, day: 13, hour: 10, minute: 0 });
    expect(parseWallTime('2027-02-29T10:00')).toBeNull();
    expect(parseWallTime('2027-13-01T10:00')).toBeNull();
    expect(parseWallTime('2027-03-13T24:00')).toBeNull();
    expect(parseWallTime('13/03/2027 10:00')).toBeNull();
  });
});

describe('wallTimeToInstant across summer time', () => {
  it('a winter and a summer time in Sofia (UTC+2, then UTC+3 from 28 March 2027)', () => {
    expect(instant('2027-03-13T10:00', 'Europe/Sofia')).toBe('2027-03-13T08:00:00.000Z');
    expect(instant('2027-07-01T10:00', 'Europe/Sofia')).toBe('2027-07-01T07:00:00.000Z');
  });

  it('the hour the clocks skip in spring does not exist', () => {
    // Europe/Sofia: 28 March 2027, 03:00 → 04:00.
    expect(wallTimeToInstant('2027-03-28T03:30', 'Europe/Sofia')).toEqual({ ok: false, reason: 'skipped' });
    expect(instant('2027-03-28T02:59', 'Europe/Sofia')).toBe('2027-03-28T00:59:00.000Z');
    expect(instant('2027-03-28T04:00', 'Europe/Sofia')).toBe('2027-03-28T01:00:00.000Z');
    // America/New_York: 14 March 2027, 02:00 → 03:00.
    expect(wallTimeToInstant('2027-03-14T02:30', 'America/New_York')).toEqual({ ok: false, reason: 'skipped' });
  });

  it('the hour the clocks pass twice in autumn is the first of the two', () => {
    // Europe/Sofia: 31 October 2027, 04:00 → 03:00; 03:30 happens at 00:30Z (EEST) and 01:30Z (EET).
    expect(instant('2027-10-31T03:30', 'Europe/Sofia')).toBe('2027-10-31T00:30:00.000Z');
    expect(instant('2027-10-31T04:30', 'Europe/Sofia')).toBe('2027-10-31T02:30:00.000Z');
    // America/New_York: 7 November 2027, 02:00 → 01:00.
    expect(instant('2027-11-07T01:30', 'America/New_York')).toBe('2027-11-07T05:30:00.000Z');
  });

  it('zones without summer time and with half hours', () => {
    expect(instant('2027-03-28T03:30', 'Asia/Hong_Kong')).toBe('2027-03-27T19:30:00.000Z');
    expect(instant('2027-03-28T03:30', 'Asia/Kolkata')).toBe('2027-03-27T22:00:00.000Z');
    expect(instant('2027-03-28T03:30', 'UTC')).toBe('2027-03-28T03:30:00.000Z');
  });

  it('round-trips through toWallTime', () => {
    for (const zone of ['Europe/Sofia', 'America/New_York', 'Australia/Sydney', 'Asia/Kolkata']) {
      for (const value of ['2027-01-15T09:00', '2027-04-02T18:45', '2027-10-30T23:59', '2027-12-31T00:00']) {
        expect(toWallTime(wallTimeToInstant(value, zone).ok ? at(instant(value, zone)) : new Date(NaN), zone), `${value} ${zone}`).toBe(value);
      }
    }
  });

  it('refuses a malformed value or zone', () => {
    expect(wallTimeToInstant('tomorrow', 'Europe/Sofia')).toEqual({ ok: false, reason: 'invalid' });
    expect(wallTimeToInstant('2027-03-13T10:00', 'Mars/Olympus')).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('zone offsets', () => {
  it('follow summer time', () => {
    expect(zoneOffsetMinutes(at('2027-03-28T00:59:00Z'), 'Europe/Sofia')).toBe(120);
    expect(zoneOffsetMinutes(at('2027-03-28T01:00:00Z'), 'Europe/Sofia')).toBe(180);
    expect(zoneOffsetMinutes(at('2027-01-01T12:00:00Z'), 'America/New_York')).toBe(-300);
    expect(offsetLabel(180)).toBe('UTC+03:00');
    expect(offsetLabel(-300)).toBe('UTC−05:00');
    expect(offsetLabel(330)).toBe('UTC+05:30');
    expect(offsetLabel(0)).toBe('UTC');
  });
});

describe('monthKey (DEFAULT M17, question 1)', () => {
  it('is the calendar month in the event’s own zone, not in UTC', () => {
    // 1 April 2027, 01:30 in Sofia is still 31 March in UTC.
    const start = at(instant('2027-04-01T01:30', 'Europe/Sofia'));
    expect(start.toISOString()).toBe('2027-03-31T22:30:00.000Z');
    expect(monthKey(start, 'Europe/Sofia')).toBe('2027-04');
    expect(monthKey(start, 'UTC')).toBe('2027-03');
    // 31 March 2027, 20:00 in New York is 1 April in UTC.
    const evening = at(instant('2027-03-31T20:00', 'America/New_York'));
    expect(monthKey(evening, 'America/New_York')).toBe('2027-03');
    expect(monthKey(evening, 'UTC')).toBe('2027-04');
  });

  it('labels a month', () => {
    expect(monthLabel('2027-03')).toBe('March 2027');
    expect(monthLabel('2027-12')).toBe('December 2027');
  });
});

describe('formatEventWhen', () => {
  it('shows the dates in the event’s zone with the zone’s name, whoever reads it', () => {
    const when = formatEventWhen(at('2027-03-13T08:00:00Z'), at('2027-03-13T15:00:00Z'), 'Europe/Sofia');
    expect(when.text).toBe('Saturday 13 March 2027, 10:00–17:00');
    expect(when.short).toBe('Sat 13 Mar 2027 · 10:00');
    expect(when.zone).toBe('Eastern European Standard Time (Europe/Sofia, UTC+02:00)');
    expect(when.startDay).toBe('2027-03-13');
    expect(when.month).toBe('2027-03');
  });

  it('an event over several days, across the spring change', () => {
    const when = formatEventWhen(at(instant('2027-03-27T09:00', 'Europe/Sofia')), at(instant('2027-03-28T16:00', 'Europe/Sofia')), 'Europe/Sofia');
    expect(when.text).toBe('Saturday 27 March 2027, 09:00 – Sunday 28 March 2027, 16:00');
    expect(when.zone).toBe('Eastern European Standard Time (Europe/Sofia, UTC+02:00 to UTC+03:00)');
  });

  it('the ISO time with the zone’s offset, for JSON-LD', () => {
    expect(isoInZone(at('2027-07-01T07:00:00Z'), 'Europe/Sofia')).toBe('2027-07-01T10:00:00+03:00');
    expect(isoInZone(at('2027-01-15T14:00:00Z'), 'America/New_York')).toBe('2027-01-15T09:00:00-05:00');
  });
});
