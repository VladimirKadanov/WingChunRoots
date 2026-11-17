// How long something has waited, in the short words of the control panel's tables ("4 days",
// "20 h", "under 1 h"), and whether it is late. Pure: the page passes the request time.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The time from `since` to `now`, in whole days from one day on, in whole hours under that. */
export function waitedText(since: string | Date, now: number): string {
  const ms = Math.max(0, now - new Date(since).getTime());
  if (ms >= DAY_MS) {
    const days = Math.floor(ms / DAY_MS);
    return days === 1 ? '1 day' : `${days} days`;
  }
  const hours = Math.floor(ms / HOUR_MS);
  return hours >= 1 ? `${hours} h` : 'under 1 h';
}

/** Whether `since` is more than `days` whole days before `now`. */
export function waitedOver(since: string | Date, now: number, days: number): boolean {
  return now - new Date(since).getTime() > days * DAY_MS;
}
