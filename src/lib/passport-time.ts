// The time of a training passport (milestone M19, In scope 3; specification §8; DEFAULT M19,
// question 2): experience shown only as precisely as the dates allow, and the timeline by year.
// Pure functions, shared by the passport service and its pages.
//
// Experience comes from the training periods (training_period, M09) and the year training began
// that the person gave. Its start is the earliest of them, its end today while any period goes on,
// otherwise the latest end. A year anywhere among the dates it needs gives whole years only, with
// "about" ("since 2015 · about 10 years"), never months; months appear only when every date it needs
// is known to the month at least ("since March 2015 · 10 years, 7 months").

import { type DatePrecision, formatPartialDate, type PartialDate, parsePartialDate, toPrefix } from './partial-date';

export interface ExperiencePeriod {
  /** "YYYY", "YYYY-MM" or "YYYY-MM-DD"; null when unknown. */
  start: string | null;
  end: string | null;
  ongoing: boolean;
}

export interface Experience {
  /** "2015", "March 2015" or "3 March 2015": as precise as the earliest start. */
  since: string;
  /** "about 10 years", "10 years, 7 months", "less than a year", or null when no end is known. */
  length: string | null;
  /** "since 2015 · about 10 years", or "since 2015" alone. */
  text: string;
  /** The precision the length was counted in: whole years, or months. */
  precision: 'year' | 'month';
  /** The year training began. */
  startYear: number;
}

const ORDER: Record<DatePrecision, number> = { year: 0, month: 1, day: 2 };

function earliest(dates: readonly PartialDate[]): PartialDate | null {
  let best: PartialDate | null = null;
  for (const d of dates) {
    if (!best || d.firstDay < best.firstDay || (d.firstDay === best.firstDay && ORDER[d.precision] < ORDER[best.precision])) best = d;
  }
  return best;
}

function latest(dates: readonly PartialDate[]): PartialDate | null {
  let best: PartialDate | null = null;
  for (const d of dates) if (!best || d.firstDay > best.firstDay) best = d;
  return best;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Experience from the periods and the start year the person gave (either may be missing), as of
 * `today` ("YYYY-MM-DD"). Null when no start is known at all.
 */
export function experience(periods: readonly ExperiencePeriod[], startYear: number | null, today: string): Experience | null {
  const starts = periods.map((p) => (p.start ? parsePartialDate(p.start) : null)).filter((d): d is PartialDate => d !== null);
  if (startYear !== null) {
    const declared = parsePartialDate(String(startYear));
    if (declared) starts.push(declared);
  }
  const start = earliest(starts);
  if (!start) return null;
  const ongoing = periods.some((p) => p.ongoing);
  const ends = periods.map((p) => (p.end ? parsePartialDate(p.end) : null)).filter((d): d is PartialDate => d !== null);
  const now = parsePartialDate(today)!;
  // While a period goes on, experience runs to today; otherwise to the latest end, when one is known.
  const end = ongoing ? now : latest(ends);
  const since = formatPartialDate(start.prefix);
  const startYearOf = Number(start.firstDay.slice(0, 4));
  // DEFAULT M19 (question 2): months only when both ends are known to the month at least.
  const monthly = start.precision !== 'year' && end !== null && end.precision !== 'year';
  if (!end || end.firstDay < start.firstDay) {
    return { since, length: null, text: `since ${since}`, precision: monthly ? 'month' : 'year', startYear: startYearOf };
  }
  const [sy, sm] = start.firstDay.split('-').map(Number) as [number, number];
  const [ey, em] = end.firstDay.split('-').map(Number) as [number, number];
  let length: string | null;
  if (monthly) {
    const months = ey * 12 + em - (sy * 12 + sm);
    const years = Math.floor(months / 12);
    const rest = months % 12;
    if (months < 1) length = 'less than a month';
    else if (years === 0) length = plural(rest, 'month', 'months');
    else length = rest === 0 ? plural(years, 'year', 'years') : `${plural(years, 'year', 'years')}, ${plural(rest, 'month', 'months')}`;
  } else {
    const years = ey - sy;
    // The same year at year precision says nothing about the length: "since 2026" alone.
    length = years < 1 ? null : `about ${plural(years, 'year', 'years')}`;
  }
  return { since, length, text: length ? `since ${since} · ${length}` : `since ${since}`, precision: monthly ? 'month' : 'year', startYear: startYearOf };
}

// --- Dates of entries -----------------------------------------------------------------------------

/** A stored date (first day and precision) as its ISO prefix, or null when unknown. */
export function storedPrefix(firstDay: string | null, precision: string): string | null {
  if (!firstDay || precision === 'unknown') return null;
  return toPrefix(firstDay.slice(0, 10), precision as DatePrecision);
}

/** "2019", "May 2019", "12 May 2019", or "Date not recorded". */
export function entryDate(prefix: string | null): string {
  return prefix ? formatPartialDate(prefix) : 'Date not recorded';
}

// --- The timeline ---------------------------------------------------------------------------------

export interface Dated {
  /** The ISO prefix of the entry's date, or null when unknown. */
  date: string | null;
  /** Ties: the time the entry was written (ISO 8601). */
  createdAt: string;
}

export interface TimelineYear<T> {
  /** The year, or null for the entries without a date (listed last). */
  year: number | null;
  items: T[];
}

/**
 * The entries by year, the latest year first; inside a year the latest first, an entry known only
 * to the year after those known to the month or day (it could be any time that year). Entries
 * without a date come last, the latest written first.
 */
export function timelineByYear<T extends Dated>(entries: readonly T[]): TimelineYear<T>[] {
  const known = entries.filter((e) => e.date !== null);
  const unknown = entries.filter((e) => e.date === null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sortKey = (e: T) => {
    const d = parsePartialDate(e.date!)!;
    // A coarse date sorts as the start of its span, after the finer dates of the same span.
    return `${d.firstDay}:${ORDER[d.precision]}`;
  };
  known.sort((a, b) => sortKey(b).localeCompare(sortKey(a)) || b.createdAt.localeCompare(a.createdAt));
  const years: TimelineYear<T>[] = [];
  for (const e of known) {
    const year = Number(e.date!.slice(0, 4));
    const last = years.at(-1);
    if (last && last.year === year) last.items.push(e);
    else years.push({ year, items: [e] });
  }
  if (unknown.length > 0) years.push({ year: null, items: unknown });
  return years;
}

/**
 * The current rank: the latest by date among the ranks with a date (a rank known only to the year
 * counts from the start of that year), otherwise the latest written.
 */
export function currentOf<T extends Dated>(ranks: readonly T[]): T | null {
  if (ranks.length === 0) return null;
  const dated = ranks.filter((r) => r.date !== null);
  const pool = dated.length > 0 ? dated : ranks;
  return [...pool].sort((a, b) => {
    const da = a.date ? parsePartialDate(a.date)!.firstDay : '';
    const db = b.date ? parsePartialDate(b.date)!.firstDay : '';
    return db.localeCompare(da) || b.createdAt.localeCompare(a.createdAt);
  })[0]!;
}
