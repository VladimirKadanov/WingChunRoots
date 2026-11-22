import { describe, expect, it } from 'vitest';

import { eventFiltersOf, eventsFeedHref, eventsHref, isFiltered } from './event-filters';

describe('eventFiltersOf', () => {
  it('reads the agenda by default and drops malformed values', () => {
    const f = eventFiltersOf({ country: 'bg', kind: 'nope', format: 'x', person: 'Bad Slug', page: '0' });
    expect(f).toMatchObject({ view: 'agenda', when: 'upcoming', country: 'BG', kind: null, format: null, person: null, page: 1, month: null, day: null });
  });

  it('reads the month view with its month and a day inside it', () => {
    expect(eventFiltersOf({ view: 'month', month: '2027-03', day: '2027-03-13' })).toMatchObject({ view: 'month', month: '2027-03', day: '2027-03-13' });
    expect(eventFiltersOf({ view: 'month', month: '2027-03', day: '2027-04-01' }).day).toBeNull();
    expect(eventFiltersOf({ view: 'month', month: '2027-13' }).month).toBeNull();
    expect(eventFiltersOf({ month: '2027-03' }).month, 'a month only in the month view').toBeNull();
  });

  it('knows an organization filter', () => {
    const f = eventFiltersOf({ organization: 'demo-federation-north' });
    expect(f.organization).toBe('demo-federation-north');
    expect(isFiltered(f)).toBe(true);
    expect(isFiltered(eventFiltersOf({ view: 'month', month: '2027-03' }))).toBe(false);
  });
});

describe('addresses', () => {
  it('keeps the filters and the view, without empty parts', () => {
    const f = eventFiltersOf({ kind: 'camp', country: 'GB' });
    expect(eventsHref(f)).toBe('/events?country=GB&kind=camp');
    expect(eventsHref(f, { view: 'month', month: '2027-03' })).toBe('/events?view=month&country=GB&kind=camp&month=2027-03');
    expect(eventsHref(eventFiltersOf({}))).toBe('/events');
    expect(eventsHref(eventFiltersOf({ when: 'past' }), { page: 2 })).toBe('/events?when=past&page=2');
  });

  it('gives the feed of the same filters', () => {
    expect(eventsFeedHref(eventFiltersOf({}))).toBe('/events/calendar.ics');
    expect(eventsFeedHref(eventFiltersOf({ kind: 'seminar', view: 'month', month: '2027-03' }))).toBe('/events/calendar.ics?kind=seminar');
  });
});
