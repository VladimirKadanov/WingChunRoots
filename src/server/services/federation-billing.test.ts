// The rules of M23 without a database (docs/adr/0026-federation-billing.md): when a change of plan
// or billing period takes effect (DEFAULT M23, question 2) and the length of a federation trial
// in calendar months (DEFAULT M23, question 4).

import { describe, expect, it } from 'vitest';

import { changeTiming } from './billing';
import { addMonths } from './federation-trials';

describe('changeTiming (DEFAULT M23, question 2)', () => {
  it('an upgrade is now; a downgrade waits for the period end', () => {
    expect(changeTiming({ planCode: 'federation', interval: 'month' }, { planCode: 'federation', interval: 'year' })).toBe('now');
    expect(changeTiming({ planCode: 'federation', interval: 'year' }, { planCode: 'federation', interval: 'month' })).toBe('period_end');
    expect(changeTiming({ planCode: 'free_sifu', interval: 'month' }, { planCode: 'pro_sifu', interval: 'month' })).toBe('now');
    expect(changeTiming({ planCode: 'pro_sifu', interval: 'month' }, { planCode: 'free_sifu', interval: 'month' })).toBe('period_end');
  });

  it('during the free period of a trial every change waits for its end', () => {
    expect(changeTiming({ planCode: 'federation', interval: 'month' }, { planCode: 'federation', interval: 'year' }, true)).toBe('period_end');
    expect(changeTiming({ planCode: 'federation', interval: 'year' }, { planCode: 'federation', interval: 'month' }, true)).toBe('period_end');
  });
});

describe('addMonths (the trial length)', () => {
  it('adds calendar months in UTC, ending on the last day of a shorter month', () => {
    expect(addMonths(new Date('2026-11-11T20:00:00Z'), 12).toISOString()).toBe('2027-11-11T20:00:00.000Z');
    expect(addMonths(new Date('2026-11-11T20:00:00Z'), 6).toISOString()).toBe('2027-05-11T20:00:00.000Z');
    expect(addMonths(new Date('2026-08-31T09:00:00Z'), 6).toISOString()).toBe('2027-02-28T09:00:00.000Z');
    expect(addMonths(new Date('2027-08-31T09:00:00Z'), 6).toISOString()).toBe('2028-02-29T09:00:00.000Z');
  });
});
