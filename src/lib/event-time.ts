// The time of an event (milestone M17; docs/adr/0020-events.md): an instant (timestamptz) and the
// event's own IANA time zone. Pure TypeScript on the platform's Intl (no time zone library: plan
// §3.2), shared by the services, the pages and the .ics file:
//
//   - the organizer types a wall time ("2027-03-13T10:00") in the event's zone; wallTimeToInstant()
//     turns it into the instant, across the changes of summer time: a time the clocks skip (the
//     spring change) does not exist and is refused, a time they pass twice (the autumn change) is
//     the first of the two;
//   - every page shows the dates in the event's zone, with the zone's name, whoever looks at it
//     (formatEventWhen); never in the viewer's own zone, so the server's answer is the same for all;
//   - monthKey() is the calendar month in the event's zone: what the Professional Sifu allowance
//     counts (DEFAULT M17, question 1).
//
// Month and weekday names come from fixed tables, so a page reads the same with any ICU build.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** An IANA zone name: letters, digits and _ + - in parts joined by "/", or UTC. */
const ZONE_FORMAT = /^(?:UTC|[A-Za-z][A-Za-z0-9_+-]{0,40}(?:\/[A-Za-z0-9][A-Za-z0-9_+-]{0,40}){1,2})$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    formatters.set(zone, f);
  }
  return f;
}

/** Whether the platform knows this IANA time zone (Europe/Sofia, America/New_York, UTC). */
export function isTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !ZONE_FORMAT.test(zone)) return false;
  try {
    partsFormatter(zone);
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 (Sunday) – 6. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The wall clock of `instant` in `zone`. */
export function zonedParts(instant: Date, zone: string): ZonedParts {
  const out: Record<string, string> = {};
  for (const part of partsFormatter(zone).formatToParts(instant)) out[part.type] = part.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAY_INDEX[out.weekday ?? ''] ?? 0,
  };
}

/** The zone's offset from UTC at `instant`, in minutes (Sofia in summer: 180). */
export function zoneOffsetMinutes(instant: Date, zone: string): number {
  const p = zonedParts(instant, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const whole = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - whole) / MINUTE);
}

/** "UTC+03:00", "UTC−05:00", "UTC+05:30", "UTC". */
export function offsetLabel(minutes: number): string {
  if (minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** A wall time as a form gives it: "2027-03-13T10:00" (seconds optional). */
const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** The parts of "YYYY-MM-DDTHH:mm", or null when it is not a real date and time. */
export function parseWallTime(value: string): WallTime | null {
  const m = WALL_TIME.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [number, number, number, number, number];
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day, hour, minute };
}

const sameWall = (p: ZonedParts, w: WallTime) => p.year === w.year && p.month === w.month && p.day === w.day && p.hour === w.hour && p.minute === w.minute;

export type WallTimeResult = { ok: true; instant: Date } | { ok: false; reason: 'invalid' | 'skipped' };

/**
 * The instant of a wall time in `zone`. A time the clocks skip when summer time starts does not
 * exist (`skipped`); a time they pass twice when it ends is the first of the two (summer time).
 * The offsets a day before and a day after bound every real change of a zone's offset.
 */
export function wallTimeToInstant(value: string, zone: string): WallTimeResult {
  const wall = parseWallTime(value);
  if (!wall || !isTimeZone(zone)) return { ok: false, reason: 'invalid' };
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const offsets = new Set([zoneOffsetMinutes(new Date(guess - DAY), zone), zoneOffsetMinutes(new Date(guess), zone), zoneOffsetMinutes(new Date(guess + DAY), zone)]);
  const candidates = [...offsets]
    .map((offset) => guess - offset * MINUTE)
    .filter((t) => sameWall(zonedParts(new Date(t), zone), wall))
    .sort((a, b) => a - b);
  if (candidates.length === 0) return { ok: false, reason: 'skipped' };
  return { ok: true, instant: new Date(candidates[0]!) };
}

/** The value of an <input type="datetime-local"> for `instant` in `zone`: "2027-03-13T10:00". */
export function toWallTime(instant: Date, zone: string): string {
  const p = zonedParts(instant, zone);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

/**
 * DEFAULT M17 (question 1): the calendar month of `instant` in the event's zone, "2027-03". The
 * Professional Sifu allowance counts the published events that start in one such month.
 */
export function monthKey(instant: Date, zone: string): string {
  const p = zonedParts(instant, zone);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/** "March 2027" for "2027-03". */
export function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  return `${MONTHS[Number(m[2]) - 1] ?? ''} ${m[1]}`;
}

/** The zone's own name in English at `instant` ("Eastern European Summer Time"), or the IANA id. */
export function zoneLongName(instant: Date, zone: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'long' }).formatToParts(instant).find((p) => p.type === 'timeZoneName');
    return part?.value ?? zone;
  } catch {
    return zone;
  }
}

/** "Europe/Sofia" → "Sofia"; "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export function zoneCity(zone: string): string {
  if (zone === 'UTC') return 'UTC';
  return (zone.split('/').pop() ?? zone).replaceAll('_', ' ');
}

const two = (n: number) => String(n).padStart(2, '0');
const clock = (p: ZonedParts) => `${two(p.hour)}:${two(p.minute)}`;
const longDay = (p: ZonedParts) => `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
const shortDay = (p: ZonedParts) => `${SHORT_WEEKDAYS[p.weekday]} ${p.day} ${SHORT_MONTHS[p.month - 1]} ${p.year}`;

export interface EventWhen {
  /** "Saturday 13 March 2027, 10:00–17:00" or "Saturday 13 March 2027, 10:00 – Sunday 14 March 2027, 16:00". */
  text: string;
  /** "Sat 13 Mar 2027 · 10:00" for lists. */
  short: string;
  /** "Eastern European Time (Europe/Sofia, UTC+02:00)": the zone the times are in. */
  zone: string;
  /** The day of the start in the event's zone: "2027-03-13". */
  startDay: string;
  /** The start's month in the event's zone: "2027-03". */
  month: string;
}

/** The dates of an event in its own zone, with the zone's name (In scope 6). */
export function formatEventWhen(start: Date, end: Date, zone: string): EventWhen {
  const s = zonedParts(start, zone);
  const e = zonedParts(end, zone);
  const oneDay = s.year === e.year && s.month === e.month && s.day === e.day;
  const text = oneDay ? `${longDay(s)}, ${clock(s)}–${clock(e)}` : `${longDay(s)}, ${clock(s)} – ${longDay(e)}, ${clock(e)}`;
  const offsets = [zoneOffsetMinutes(start, zone), zoneOffsetMinutes(end, zone)];
  const offset = offsets[0] === offsets[1] ? offsetLabel(offsets[0]!) : `${offsetLabel(offsets[0]!)} to ${offsetLabel(offsets[1]!)}`;
  return {
    text,
    short: `${shortDay(s)} · ${clock(s)}`,
    zone: `${zoneLongName(start, zone)} (${zone}, ${offset})`,
    startDay: `${s.year}-${two(s.month)}-${two(s.day)}`,
    month: monthKey(start, zone),
  };
}

/** The ISO 8601 date-time of `instant` in `zone` with its offset ("2027-03-13T10:00:00+02:00"), for JSON-LD. */
export function isoInZone(instant: Date, zone: string): string {
  const p = zonedParts(instant, zone);
  const offset = zoneOffsetMinutes(instant, zone);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}:${two(p.second)}${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}
