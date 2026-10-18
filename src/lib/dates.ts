// Dates as the app shows them (M08): always in UTC, so a page reads the same for every viewer and
// every run of the tests, and never with a relative "3 days left" (CLAUDE.md §11: no countdowns).

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "1 February 2026". */
export function formatDay(value: Date | string): string {
  return DAY.format(typeof value === 'string' ? new Date(value) : value);
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
