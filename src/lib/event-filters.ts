// The state of the event calendar in its address (milestone M17; ADR 0052): the filters of /events,
// its view (the Agenda or the Month grid), the month and the chosen day, and the same filters for
// the calendar feed (/events/calendar.ics). Anything malformed is dropped, never an error page.

import { EVENT_KIND_LABELS, type EventKind } from '@/server/dto/events';

export interface EventFilters {
  when: 'upcoming' | 'past';
  country: string | null;
  kind: EventKind | null;
  format: 'online' | 'in_person' | null;
  /** From a profile's or a school's "Upcoming events": the events of one person or one school. */
  person: string | null;
  school: string | null;
  /** From an organization's page: the events it organizes. */
  organization: string | null;
  /** Role replay 2026-11-25 (P2-5): from the search's "Events in <city>": the events in one place (its id). */
  place: string | null;
  view: 'agenda' | 'month';
  /** The month of the Month view ("2027-03"); null = the month of the next event. */
  month: string | null;
  /** The chosen day of the Month view ("2027-03-13"), inside `month`. */
  day: string | null;
  page: number;
}

type Params = Record<string, string | string[] | undefined>;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MONTH = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const slugOf = (value: string | string[] | undefined) => {
  const v = one(value) ?? '';
  return SLUG.test(v) && v.length <= 120 ? v : null;
};

export function eventFiltersOf(params: Params): EventFilters {
  const country = one(params.country)?.toUpperCase() ?? '';
  const kind = one(params.kind) ?? '';
  const format = one(params.format) ?? '';
  const page = Number(one(params.page) ?? '1');
  const month = one(params.month) ?? '';
  const day = one(params.day) ?? '';
  const view = one(params.view) === 'month' ? 'month' : 'agenda';
  const monthOk = MONTH.test(month) ? month : null;
  return {
    when: one(params.when) === 'past' ? 'past' : 'upcoming',
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    kind: Object.hasOwn(EVENT_KIND_LABELS, kind) ? (kind as EventKind) : null,
    format: format === 'online' || format === 'in_person' ? format : null,
    person: slugOf(params.person),
    school: slugOf(params.school),
    organization: slugOf(params.organization),
    place: UUID.test(one(params.place) ?? '') ? one(params.place)! : null,
    view,
    month: view === 'month' ? monthOk : null,
    day: view === 'month' && monthOk && DAY.test(day) && day.startsWith(`${monthOk}-`) ? day : null,
    page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}

/** The filters that choose events (not the view, the month or the page). */
export function isFiltered(f: EventFilters): boolean {
  return f.country !== null || f.kind !== null || f.format !== null || f.person !== null || f.school !== null || f.organization !== null || f.place !== null;
}

function filterQuery(f: EventFilters): URLSearchParams {
  const q = new URLSearchParams();
  if (f.country) q.set('country', f.country);
  if (f.kind) q.set('kind', f.kind);
  if (f.format) q.set('format', f.format);
  if (f.person) q.set('person', f.person);
  if (f.school) q.set('school', f.school);
  if (f.organization) q.set('organization', f.organization);
  if (f.place) q.set('place', f.place);
  return q;
}

/** The address of the calendar with `change` applied. */
export function eventsHref(f: EventFilters, change: Partial<EventFilters> = {}): string {
  const next = { ...f, ...change };
  const q = new URLSearchParams();
  if (next.view === 'month') q.set('view', 'month');
  if (next.view === 'agenda' && next.when === 'past') q.set('when', 'past');
  for (const [k, v] of filterQuery(next)) q.set(k, v);
  if (next.view === 'month' && next.month) q.set('month', next.month);
  if (next.view === 'month' && next.day) q.set('day', next.day);
  if (next.view === 'agenda' && next.page > 1) q.set('page', String(next.page));
  const s = q.toString();
  return s ? `/events?${s}` : '/events';
}

/** The calendar feed of the same filters: the upcoming events a calendar app subscribes to. */
export function eventsFeedHref(f: EventFilters): string {
  const s = filterQuery(f).toString();
  return s ? `/events/calendar.ics?${s}` : '/events/calendar.ics';
}
