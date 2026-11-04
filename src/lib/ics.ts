// An iCalendar file (RFC 5545) of one event (milestone M17, In scope 5: "Add to calendar"). Pure
// TypeScript, no calendar library (plan §3.2). The times are written in UTC (the form `...Z` of
// RFC 5545 §3.3.5), so the file needs no VTIMEZONE block and every calendar shows the event at the
// same instant, in its user's own zone; the page itself shows the event's own zone.
//
// Text is escaped (§3.3.11: backslash, semicolon, comma, line breaks) and every content line is
// folded at 75 octets of UTF-8 (§3.1), never inside a character. Lines end with CRLF.

export interface IcsEvent {
  /** A stable, globally unique id: the event's id at the app's host. */
  uid: string;
  start: Date;
  end: Date;
  /** When the event was last changed: DTSTAMP and LAST-MODIFIED. */
  stamp: Date;
  summary: string;
  description?: string | null;
  location?: string | null;
  /** The event's page. */
  url?: string | null;
  cancelled?: boolean;
  /** Bumped with every change, so a calendar that imported it before takes the new version. */
  sequence?: number;
}

/** "20270313T080000Z". */
export function icsUtc(instant: Date): string {
  return instant.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

/** RFC 5545 §3.3.11 TEXT: \\ ; , escaped, every line break as \n, other control characters dropped. */
export function icsText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

const encoder = new TextEncoder();

/** Folds one content line at 75 octets (§3.1): the next line starts with a space. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let size = 0;
  // Each continuation line carries one octet of leading space: at most 74 octets of content then.
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const max = out.length === 0 ? 75 : 74;
    if (size + bytes > max) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  out.push(current);
  return out.join('\r\n ');
}

/** The whole VCALENDAR with one VEVENT, CRLF line ends. */
export function buildIcs(event: IcsEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WingChunRoots//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsText(event.uid)}`,
    `DTSTAMP:${icsUtc(event.stamp)}`,
    `LAST-MODIFIED:${icsUtc(event.stamp)}`,
    `SEQUENCE:${Math.max(0, Math.floor(event.sequence ?? 0))}`,
    `DTSTART:${icsUtc(event.start)}`,
    `DTEND:${icsUtc(event.end)}`,
    `SUMMARY:${icsText(event.cancelled ? `Cancelled: ${event.summary}` : event.summary)}`,
    ...(event.description ? [`DESCRIPTION:${icsText(event.description)}`] : []),
    ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    `STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
