// The .ics file of an event (milestone M17, In scope 5 and 9; RFC 5545).

import { describe, expect, it } from 'vitest';

import { buildIcs, foldLine, icsText, icsUtc } from './ics';

const event = {
  uid: '0190a5c0-0000-7000-8000-0000000000e1@wingchunroots.local',
  start: new Date('2027-03-13T08:00:00Z'),
  end: new Date('2027-03-13T15:00:00Z'),
  stamp: new Date('2027-01-02T03:04:05.678Z'),
  summary: 'Demo seminar: Chum Kiu, footwork; turning',
  description: 'A fictional seminar.\nBring a notebook, water\\snacks.',
  location: 'Sofia, BG',
  url: 'https://wingchunroots.local/events/demo-seminar-sofia',
};

describe('buildIcs', () => {
  it('is one VEVENT in a VCALENDAR with CRLF line ends and UTC times', () => {
    const ics = buildIcs(event);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WingChunRoots//Events//EN\r\n')).toBe(true);
    expect(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const lines = ics.split('\r\n');
    expect(lines).toContain('DTSTART:20270313T080000Z');
    expect(lines).toContain('DTEND:20270313T150000Z');
    expect(lines).toContain('DTSTAMP:20270102T030405Z');
    expect(lines).toContain('STATUS:CONFIRMED');
    expect(lines).toContain('SUMMARY:Demo seminar: Chum Kiu\\, footwork\\; turning');
    expect(lines).toContain('DESCRIPTION:A fictional seminar.\\nBring a notebook\\, water\\\\snacks.');
    expect(lines).toContain('LOCATION:Sofia\\, BG');
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
  });

  it('a cancelled event says so', () => {
    const lines = buildIcs({ ...event, cancelled: true, sequence: 2 }).split('\r\n');
    expect(lines).toContain('STATUS:CANCELLED');
    expect(lines).toContain('SEQUENCE:2');
    expect(lines.some((l) => l.startsWith('SUMMARY:Cancelled: Demo seminar'))).toBe(true);
  });

  it('folds long lines at 75 octets without splitting a character', () => {
    const long = buildIcs({ ...event, description: 'Семинар '.repeat(30) });
    for (const line of long.split('\r\n')) expect(new TextEncoder().encode(line).length, line).toBeLessThanOrEqual(75);
    const unfolded = long.replace(/\r\n /g, '');
    expect(unfolded).toContain(`DESCRIPTION:${'Семинар '.repeat(30)}`);
  });
});

describe('the parts', () => {
  it('icsUtc', () => expect(icsUtc(new Date('2027-10-31T00:30:00.000Z'))).toBe('20271031T003000Z'));
  it('icsText drops control characters', () => expect(icsText('a\u0007b\r\nc')).toBe('ab\\nc'));
  it('foldLine keeps short lines', () => expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short'));
});
