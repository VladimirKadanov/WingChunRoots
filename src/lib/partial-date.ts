// Training dates as people remember them (milestone M09; plan §6.2): a year, a month or a day. A
// date travels as an ISO 8601 prefix by its precision, the same form the lineage API answers with
// (PeriodDto: "1985", "1992-02", "1992-02-03"), and is stored as the first day it covers with the
// precision beside it (training_period.starts_on, precision). Pure functions, shared by the request
// form in the browser and the relationship service.

export type DatePrecision = 'year' | 'month' | 'day';

export interface PartialDate {
  precision: DatePrecision;
  /** The first day the date covers, "YYYY-MM-DD". */
  firstDay: string;
  /** The ISO prefix by precision: "YYYY", "YYYY-MM" or "YYYY-MM-DD". */
  prefix: string;
}

/** The earliest year a training period may start (the CHECK of person.training_start_year). */
export const EARLIEST_TRAINING_YEAR = 1900;

const PREFIX = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

const pad = (n: number) => String(n).padStart(2, '0');

/** "1985", "1992-02" or "1992-02-03" as a real date with its precision, or null. */
export function parsePartialDate(value: string): PartialDate | null {
  const match = PREFIX.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] === undefined ? null : Number(match[2]);
  const day = match[3] === undefined ? null : Number(match[3]);
  if (month !== null && (month < 1 || month > 12)) return null;
  if (day !== null) {
    const date = new Date(Date.UTC(year, month! - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) return null;
  }
  const precision: DatePrecision = day !== null ? 'day' : month !== null ? 'month' : 'year';
  const firstDay = `${match[1]}-${pad(month ?? 1)}-${pad(day ?? 1)}`;
  return { precision, firstDay, prefix: toPrefix(firstDay, precision) };
}

/** The ISO prefix of a stored first day at `precision`. */
export function toPrefix(firstDay: string, precision: DatePrecision): string {
  return precision === 'year' ? firstDay.slice(0, 4) : precision === 'month' ? firstDay.slice(0, 7) : firstDay.slice(0, 10);
}

const ORDER: Record<DatePrecision, number> = { year: 0, month: 1, day: 2 };

/** The coarser of two precisions: a period keeps one precision for both of its ends. */
export function coarser(a: DatePrecision, b: DatePrecision): DatePrecision {
  return ORDER[a] <= ORDER[b] ? a : b;
}

/** The date cut down to a coarser precision: "1992-02-03" at 'year' is 1992 (1992-01-01). */
export function atPrecision(date: PartialDate, precision: DatePrecision): PartialDate {
  if (ORDER[precision] >= ORDER[date.precision]) return date;
  const firstDay = precision === 'year' ? `${date.firstDay.slice(0, 4)}-01-01` : `${date.firstDay.slice(0, 7)}-01`;
  return { precision, firstDay, prefix: toPrefix(firstDay, precision) };
}

/** The last day a date covers, "YYYY-MM-DD": the end of its year, month or the day itself. */
export function lastDayCovered(date: PartialDate): string {
  const [y, m] = date.firstDay.split('-').map(Number) as [number, number];
  if (date.precision === 'day') return date.firstDay;
  if (date.precision === 'year') return `${y}-12-31`;
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "1985", "February 1992" or "3 February 1992", by the precision of the prefix. */
export function formatPartialDate(prefix: string): string {
  const [year, month, day] = prefix.split('-');
  if (!month) return year!;
  const name = MONTHS[Number(month) - 1] ?? month;
  return day ? `${Number(day)} ${name} ${year}` : `${name} ${year}`;
}

/** Today in UTC as "YYYY-MM-DD". */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
