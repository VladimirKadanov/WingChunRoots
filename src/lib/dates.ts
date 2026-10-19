// Dates as the app shows them (M08): always in UTC, so a page reads the same for every viewer and
// every run of the tests, and never with a relative "3 days left" (CLAUDE.md §11: no countdowns).

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "1 February 2026". */
export function formatDay(value: Date | string): string {
  return DAY.format(typeof value === 'string' ? new Date(value) : value);
}

/**
 * The end of a plan, which stops at 00:00 UTC of its end day (milestone M08), as the last full day
 * it covers: an end of 1 January 2027 reads "until 31 December 2026" (review round 1, design-11).
 * The UTC boundary is explained once where a plan is shown in full (/dashboard/settings) and where
 * an admin sets it (/admin/grants), not in every sentence.
 */
export function untilPlanEnd(value: Date | string): string {
  return `until ${formatDay(lastDayOf(value))}`;
}

/** The day of the last instant before `end` (an end at 00:00 UTC is the day before). */
export function lastDayOf(end: Date | string): Date {
  return new Date((typeof end === 'string' ? new Date(end) : end).getTime() - 1);
}

// Fixed abbreviations: ICU versions differ ("Sep" or "Sept"), and a table should not.
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "19 Oct 2026" in UTC: for dense tables, with the full day in a title. */
export function formatShortDay(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return `${date.getUTCDate()} ${SHORT_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "2026-02-01": the value of an <input type="date">. */
export function isoDay(value: Date | string): string {
  return (typeof value === 'string' ? new Date(value) : value).toISOString().slice(0, 10);
}

/** The start (00:00 UTC) of a "YYYY-MM-DD" day, or null when it is not a real date. */
export function parseIsoDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || isoDay(date) !== value ? null : date;
}
