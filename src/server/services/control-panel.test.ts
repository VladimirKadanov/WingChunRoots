import { describe, expect, it } from 'vitest';

import { billingPrice } from '@/server/entitlements/plans';

import { initialsFor } from './account-menu';
import { likePattern, listAccountsInput } from './account-directory';
import { fillWeeks, monthlyValueCents, weekStart } from './admin-dashboard';

describe('weekStart', () => {
  it('is Monday 00:00 UTC of the week', () => {
    expect(weekStart(new Date('2026-11-17T20:00:00Z')).toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(weekStart(new Date('2026-11-22T23:59:00Z')).toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(weekStart(new Date('2026-11-16T00:00:00Z')).toISOString()).toBe('2026-11-16T00:00:00.000Z');
  });
});

describe('fillWeeks', () => {
  it('lists the last weeks oldest first, missing weeks as 0', () => {
    const weeks = fillWeeks(new Date('2026-11-17T12:00:00Z'), 3, [{ week: '2026-11-16T00:00:00Z', n: 4 }], [{ week: '2026-11-02', n: 2 }]);
    expect(weeks).toEqual([
      { weekStart: '2026-11-02', accounts: 0, people: 2 },
      { weekStart: '2026-11-09', accounts: 0, people: 0 },
      { weekStart: '2026-11-16', accounts: 4, people: 0 },
    ]);
  });
});

describe('monthlyValueCents', () => {
  it('counts a yearly plan as a twelfth of its price a month', () => {
    const month = billingPrice('federation', 'month');
    const year = billingPrice('federation', 'year');
    expect(month && year).toBeTruthy();
    if (!month || !year) return;
    expect(monthlyValueCents([{ planCode: 'federation', interval: 'month', n: 2 }])).toBe(month.amountCents * 2);
    expect(monthlyValueCents([{ planCode: 'federation', interval: 'year', n: 1 }])).toBe(Math.round(year.amountCents / 12));
  });
  it('is 0 without subscriptions', () => {
    expect(monthlyValueCents([])).toBe(0);
  });
});

describe('initialsFor', () => {
  it('takes the first and last word of a name', () => {
    expect(initialsFor('Demo Wong Junior', 'x@example.test')).toBe('DJ');
    expect(initialsFor('demo', 'x@example.test')).toBe('D');
  });
  it('falls back to the address', () => {
    expect(initialsFor(null, 'member@example.test')).toBe('M');
    expect(initialsFor('  ', '')).toBe('?');
  });
});

describe('likePattern', () => {
  it('escapes the ILIKE wildcards typed into the search', () => {
    expect(likePattern('a_b%c\\d')).toBe('%a\\_b\\%c\\\\d%');
  });
});

describe('listAccountsInput', () => {
  it('defaults to every account, newest first, page 1', () => {
    expect(listAccountsInput.parse({})).toMatchObject({ state: 'all', sort: 'newest', page: 1 });
  });
  it('refuses an unknown order', () => {
    expect(() => listAccountsInput.parse({ sort: 'name; drop' })).toThrow();
  });
});
