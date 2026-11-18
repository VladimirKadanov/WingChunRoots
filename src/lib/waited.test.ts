import { describe, expect, it } from 'vitest';

import { waitedOver, waitedText } from './waited';

const now = Date.parse('2026-11-17T12:00:00Z');

describe('waited', () => {
  it('says days from one day on, hours under that', () => {
    expect(waitedText('2026-11-13T09:00:00Z', now)).toBe('4 days');
    expect(waitedText('2026-11-16T12:00:00Z', now)).toBe('1 day');
    expect(waitedText('2026-11-16T16:00:00Z', now)).toBe('20 h');
    expect(waitedText('2026-11-17T11:30:00Z', now)).toBe('under 1 h');
    // A clock a little ahead never gives a negative wait.
    expect(waitedText('2026-11-17T12:05:00Z', now)).toBe('under 1 h');
  });

  it('marks a wait over a number of days', () => {
    expect(waitedOver('2026-11-14T11:59:00Z', now, 3)).toBe(true);
    expect(waitedOver('2026-11-14T12:00:00Z', now, 3)).toBe(false);
    expect(waitedOver(new Date('2026-11-17T00:00:00Z'), now, 3)).toBe(false);
  });
});
