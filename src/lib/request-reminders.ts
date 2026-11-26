// Role replay 2026-11-25 (P2-1, ADR 0060): how long a teacher request waits before its student can
// send a reminder, and when Your teachers says that the wait is long. Shared by the service and the
// pages; plain numbers, no I/O.

/** A reminder can go 14 days after the request was (last) sent, then 14 days after each reminder. */
export const REMINDER_INTERVAL_DAYS = 14;
/** From 60 days without an answer, Your teachers says so and what the student can do. */
export const LONG_WAIT_DAYS = 60;
