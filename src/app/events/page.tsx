// /events (milestone M17, In scope 6): the event calendar. A plain GET form (country, kind, online
// or in person) and the state in the address, read on the server through events.list (the same
// procedure as /api/v1), so the list is in the first HTML and works without JavaScript. Upcoming
// events by month, each in its own time zone (DEFAULT M17, question 1: the month of an event is the
// calendar month in its own zone); past events, newest first, one link away. A read that fails
// shows an error state with Retry, never an empty calendar (plan §5.6).
//
// ADR 0052 (the redesign): two views. The Agenda shows the events as cards (poster or drawn art,
// a date seal, the kind in shape and words) with the next event large above them; the Month view
// is a grid of one month (?view=month&month=2027-03), a day chosen with ?day=. Both offer the
// calendar feed of the same filters (/events/calendar.ics) for a calendar app to subscribe to.

import type { Metadata } from 'next';
import Link from 'next/link';

import { EventCard, NextEvent } from '@/components/events/event-card';
import { EventRow } from '@/components/events/event-list';
import { dayLabel, eventsByDay, KindLegend, MonthGrid, MonthNav } from '@/components/events/month-calendar';
import { CalendarIcon, ChevronDownIcon, CloseIcon } from '@/components/icons';
import { ErrorPanel } from '@/components/lineage/states';
import { buttonVariants } from '@/components/ui/button-variants';
import { FilterDisclosure } from '@/components/ui/filter-disclosure';
import { cx } from '@/lib/cx';
import { type EventFilters as Filters, eventFiltersOf as filtersOf, eventsFeedHref, eventsHref as hrefOf, isFiltered } from '@/lib/event-filters';
import { monthKey, monthLabel, shiftMonth } from '@/lib/event-time';
import { countryName } from '@/lib/regions';
import { EVENT_KIND_LABELS, type EventListDto, type EventSummaryDto } from '@/server/dto/events';
import { failure, lineageClient } from '../people/[slug]/data';

export const instant = false;

export const metadata: Metadata = {
  title: 'Events',
  description: 'Wing Chun seminars, camps, exam sessions and other events of the community, by month, in each event’s own time zone.',
  alternates: { canonical: '/events' },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const KINDS = Object.entries(EVENT_KIND_LABELS) as [keyof typeof EVENT_KIND_LABELS, string][];

/**
 * The items by the month they start in, in their own zone: one section per month (upcoming: the
 * earliest month first; past: the latest), the items of a month in the list's order. The list is
 * ordered by the instant, so two events near a month's end in different zones may fall in the
 * other order of their months; grouping by the key keeps one section (and one heading id) a month.
 */
function byMonth(items: EventSummaryDto[], when: Filters['when']): { month: string; items: EventSummaryDto[] }[] {
  const groups = new Map<string, EventSummaryDto[]>();
  for (const item of items) {
    const month = monthKey(new Date(item.startsAt), item.timezone);
    const group = groups.get(month);
    if (group) group.push(item);
    else groups.set(month, [item]);
  }
  const months = [...groups.keys()].sort();
  if (when === 'past') months.reverse();
  return months.map((month) => ({ month, items: groups.get(month)! }));
}

const fieldClass = 'block min-h-12 w-full min-w-0 appearance-none rounded-sm border border-border-strong bg-surface-1 px-4 pr-11 text-field text-fg hover:border-fg-muted focus-visible:border-fg';

function Select({ id, name, label, value, options }: { id: string; name: string; label: string; value: string; options: [string, string][] }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="relative">
        <select id={id} name={name} defaultValue={value} className={fieldClass}>
          {options.map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </select>
        <ChevronDownIcon size={20} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-fg-muted" />
      </div>
    </div>
  );
}

/** The filters of the form that are set, with the address that clears each (the phone's chips). */
function activeFilters(filters: Filters): { key: 'country' | 'kind' | 'format'; text: string; clear: string }[] {
  const out: { key: 'country' | 'kind' | 'format'; text: string; clear: string }[] = [];
  if (filters.country) out.push({ key: 'country', text: countryName(filters.country) ?? filters.country, clear: hrefOf(filters, { country: null, page: 1 }) });
  if (filters.kind) out.push({ key: 'kind', text: KINDS.find(([v]) => v === filters.kind)?.[1] ?? filters.kind, clear: hrefOf(filters, { kind: null, page: 1 }) });
  if (filters.format) out.push({ key: 'format', text: filters.format === 'online' ? 'Online' : 'In person', clear: hrefOf(filters, { format: null, page: 1 }) });
  return out;
}

/** Under md, the filters that are set as chips, each a link that clears it (the selects are folded away). */
function ActiveFilterChips({ filters }: { filters: Filters }) {
  const active = activeFilters(filters);
  if (active.length === 0) return null;
  return (
    <ul aria-label="Filters set" className="mt-3 flex flex-wrap gap-2 md:hidden" data-testid="event-filter-chips">
      {active.map((f) => (
        <li key={f.key}>
          <Link href={f.clear} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border-strong px-3.5 text-sm hover:bg-surface-3">
            {f.text}
            <CloseIcon size={14} />
            <span className="sr-only">(remove this filter)</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function FilterForm({ filters, countries }: { filters: Filters; countries: string[] }) {
  const countryOptions: [string, string][] = [['', 'All countries'], ...countries.map((c): [string, string] => [c, countryName(c) ?? c])];
  if (filters.country && !countries.includes(filters.country)) countryOptions.push([filters.country, countryName(filters.country) ?? filters.country]);
  return (
    // Phone review 2026-11 (ADR 0053): under md the three selects fold behind a Filters button.
    <form method="get" action="/events" role="search" aria-label="Filter events"
      className="max-md:has-[details[open]]:basis-full md:mt-4 md:grid md:basis-full md:grid-cols-2 md:items-end md:gap-3 lg:grid-cols-[repeat(3,minmax(0,12rem))_auto]"
    >
      {filters.view === 'month' ? <input type="hidden" name="view" value="month" /> : null}
      {filters.view === 'month' && filters.month ? <input type="hidden" name="month" value={filters.month} /> : null}
      {filters.view === 'agenda' && filters.when === 'past' ? <input type="hidden" name="when" value="past" /> : null}
      {filters.person ? <input type="hidden" name="person" value={filters.person} /> : null}
      {filters.school ? <input type="hidden" name="school" value={filters.school} /> : null}
      {filters.organization ? <input type="hidden" name="organization" value={filters.organization} /> : null}
      <FilterDisclosure active={activeFilters(filters).length} from="md" panelClassName="grid grid-cols-1 items-end gap-3 max-md:mt-3 sm:grid-cols-2">
      <Select id="event-country" name="country" label="Country" value={filters.country ?? ''} options={countryOptions} />
      <Select id="event-kind" name="kind" label="Kind" value={filters.kind ?? ''} options={[['', 'All kinds'], ...KINDS]} />
      <Select
        id="event-format"
        name="format"
        label="Where"
        value={filters.format ?? ''}
        options={[
          ['', 'Online and in person'],
          ['in_person', 'In person'],
          ['online', 'Online'],
        ]}
      />
      <button type="submit" className={cx(buttonVariants({ variant: 'primary' }), 'min-h-12')}>
        Show events
      </button>
      </FilterDisclosure>
    </form>
  );
}

async function loadList(f: Filters, month?: { month: string }): Promise<EventListDto | null> {
  const client = await lineageClient();
  try {
    return await client.events.list({
      when: f.when,
      country: f.country ?? undefined,
      kind: f.kind ?? undefined,
      format: f.format ?? undefined,
      person: f.person ?? undefined,
      school: f.school ?? undefined,
      organization: f.organization ?? undefined,
      ...(month ? { month: month.month, limit: 50 } : { page: f.page }),
    });
  } catch (error) {
    console.error(`[events] the list could not be loaded: ${failure(error)}`);
    return null;
  }
}


function ViewSwitch({ filters }: { filters: Filters }) {
  const views = [
    { view: 'agenda' as const, label: 'Agenda', href: hrefOf(filters, { view: 'agenda', month: null, day: null, page: 1 }) },
    { view: 'month' as const, label: 'Month', href: hrefOf(filters, { view: 'month', day: null, page: 1 }) },
  ];
  return (
    <nav aria-label="View" className="inline-flex overflow-hidden rounded-md border border-border-strong" data-testid="event-view">
      {views.map((v) => (
        <Link
          key={v.view}
          href={v.href}
          aria-current={filters.view === v.view ? 'page' : undefined}
          className={cx(
            'inline-flex min-h-11 items-center gap-2 px-4 text-ui font-semibold',
            filters.view === v.view ? 'bg-fg text-fg-inverse' : 'hover:bg-surface-3',
          )}
        >
          {v.label}
        </Link>
      ))}
    </nav>
  );
}

function FeedLink({ filters }: { filters: Filters }) {
  return (
    <div className="grid gap-1 rounded-md border border-border-subtle p-4" data-testid="events-feed">
      <a href={eventsFeedHref(filters)} className="link inline-flex min-h-11 items-center gap-2 font-semibold" data-testid="events-feed-link">
        <CalendarIcon />
        {isFiltered(filters) ? 'Subscribe to these events' : 'Subscribe to every event'}
      </a>
      <p className="text-sm text-fg-muted">
        Copy this link into your calendar app (as a calendar from the internet, or a subscription): new, changed and cancelled events reach it by themselves.
      </p>
    </div>
  );
}

function LoadFailed({ filters }: { filters: Filters }) {
  return (
    <ErrorPanel title="The events could not be loaded." className="mt-6">
      <p className="text-sm text-fg-muted">Nothing was changed. Try again in a moment.</p>
      <Link href={hrefOf(filters)} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
        Try again
      </Link>
    </ErrorPanel>
  );
}

function Scope({ filters }: { filters: Filters }) {
  if (!filters.person && !filters.school && !filters.organization) return null;
  return (
    <p className="mt-4 text-sm" data-testid="event-scope">
      {filters.person ? 'The events of one person, as organizer or instructor.' : filters.school ? 'The events at one school.' : 'The events of one organization.'}{' '}
      <Link href={hrefOf(filters, { person: null, school: null, organization: null, page: 1 })} className="link inline-flex min-h-11 items-center">
        Show every event
      </Link>
    </p>
  );
}

async function AgendaView({ filters }: { filters: Filters }) {
  const list = await loadList(filters);
  if (list === null) return <LoadFailed filters={filters} />;
  const filtered = isFiltered(filters);
  const next = !filtered && filters.when === 'upcoming' && filters.page === 1 ? (list.items.find((e) => e.status !== 'cancelled') ?? null) : null;
  return (
    <>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-2">
      <nav aria-label="Upcoming or past" className="flex gap-2">
        {(['upcoming', 'past'] as const).map((when) => (
          <Link
            key={when}
            href={hrefOf(filters, { when, page: 1 })}
            aria-current={filters.when === when ? 'page' : undefined}
            className={cx(buttonVariants({ variant: filters.when === when ? 'primary' : 'secondary', size: 'sm' }), 'min-h-11')}
          >
            {when === 'upcoming' ? 'Upcoming' : 'Past'}
          </Link>
        ))}
      </nav>
      <FilterForm filters={filters} countries={list.countries} />
      </div>
      <ActiveFilterChips filters={filters} />
      <Scope filters={filters} />
      <p className="mt-6 text-sm text-fg-muted" aria-live="polite" data-testid="event-count">
        {list.total === 1 ? '1 event' : `${list.total} events`}
        {filtered ? ' match these filters' : filters.when === 'upcoming' ? ' coming up' : ' in the past'}.
      </p>
      {list.items.length === 0 ? (
        <div className="mt-4 grid gap-3" data-testid="no-events">
          <p className="text-fg-muted">{filtered ? 'No event matches these filters.' : filters.when === 'upcoming' ? 'No event is coming up yet.' : 'No past event yet.'}</p>
          {filtered ? (
            <p>
              <Link
                href={hrefOf({ ...filters, country: null, kind: null, format: null, person: null, school: null, organization: null, page: 1 })}
                className="link inline-flex min-h-11 items-center"
              >
                Show every event
              </Link>
            </p>
          ) : null}
          {!filtered && filters.when === 'upcoming' ? (
            <p className="text-sm text-fg-muted" data-testid="no-events-next">
              Teaching a seminar?{' '}
              <Link href="/dashboard/events/new" prefetch={false} className="link inline-flex min-h-11 items-center">
                Publish an event
              </Link>
            </p>
          ) : null}
        </div>
      ) : (
        <>
          {next ? <NextEvent event={next} /> : null}
          <div data-testid="event-list">
            {byMonth(list.items, filters.when).map((group) => (
              <section key={group.month} aria-labelledby={`month-${group.month}`} className="mt-10">
                <div className="flex items-baseline gap-3 border-b border-border-strong pb-2">
                  <h2 id={`month-${group.month}`} className="font-display text-2xl">
                    {monthLabel(group.month)}
                  </h2>
                  <p className="text-sm text-fg-subtle">{group.items.length === 1 ? '1 event' : `${group.items.length} events`}</p>
                </div>
                <ul className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {group.items.map((e) => (
                    <EventCard key={e.slug} event={e} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
      {list.pages > 1 ? (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-3 text-sm">
          {filters.page > 1 ? (
            <Link href={hrefOf(filters, { page: filters.page - 1 })} className="link inline-flex min-h-11 items-center">
              Previous page
            </Link>
          ) : (
            <span />
          )}
          <span className="text-fg-muted">
            Page {list.page} of {list.pages}
          </span>
          {filters.page < list.pages ? (
            <Link href={hrefOf(filters, { page: filters.page + 1 })} className="link inline-flex min-h-11 items-center">
              Next page
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  );
}

/** The month the Month view opens on: the one asked for, else the month of the next event, else this month. */
async function monthToShow(filters: Filters): Promise<string> {
  if (filters.month) return filters.month;
  const upcoming = await loadList({ ...filters, when: 'upcoming', page: 1 });
  const first = upcoming?.items[0];
  if (first) return monthKey(new Date(first.startsAt), first.timezone);
  return new Date().toISOString().slice(0, 7);
}

const LONG_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function MonthView({ filters }: { filters: Filters }) {
  const month = await monthToShow(filters);
  const shown = { ...filters, month };
  const list = await loadList(shown, { month });
  if (list === null) return <LoadFailed filters={shown} />;
  const items = list.items.filter((e) => monthKey(new Date(e.startsAt), e.timezone) === month);
  const byDay = eventsByDay(items);
  const day = filters.day;
  const dayItems = day ? (byDay.get(day) ?? []) : items;
  const weekday = day ? LONG_WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()] : null;
  return (
    <>
      <div className="mt-6 md:mt-2">
        <FilterForm filters={shown} countries={list.countries} />
      </div>
      <ActiveFilterChips filters={shown} />
      <Scope filters={shown} />
      <div className="mt-8 grid gap-8 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-4">
          <MonthNav month={month} prevHref={hrefOf(shown, { month: shiftMonth(month, -1), day: null })} nextHref={hrefOf(shown, { month: shiftMonth(month, 1), day: null })} />
          <MonthGrid month={month} byDay={byDay} selected={day} dayHref={(d) => hrefOf(shown, { day: d })} />
          <KindLegend />
          <p className="text-sm text-fg-subtle">Each event sits on the day it starts, in its own time zone.</p>
        </div>
        <section aria-labelledby="month-list" className="min-w-0" data-testid="month-list">
          <h2 id="month-list" className="eyebrow border-b border-border-strong pb-2">
            {day ? `${weekday} ${dayLabel(day)}` : `${monthLabel(month)}: ${items.length === 1 ? '1 event' : `${items.length} events`}`}
          </h2>
          {dayItems.length === 0 ? (
            <p className="mt-3 text-sm text-fg-muted" data-testid="no-events">
              {isFiltered(filters) ? 'No event matches these filters this month.' : 'No event this month.'}
            </p>
          ) : (
            <ul className="grid">
              {dayItems.map((e) => (
                <EventRow key={e.slug} event={e} />
              ))}
            </ul>
          )}
          {day ? (
            <p className="mt-2 text-sm">
              <Link href={hrefOf(shown, { day: null })} className="link inline-flex min-h-11 items-center">
                Every event in {monthLabel(month)}
              </Link>
            </p>
          ) : null}
        </section>
      </div>
    </>
  );
}

export default async function EventsPage({ searchParams }: Props) {
  const query = await searchParams;
  const filters = filtersOf(query);
  const removed = (Array.isArray(query.removed) ? query.removed[0] : query.removed) === '1';
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-[60ch]">
          <h1 className="font-display text-feature">Events</h1>
          <p className="mt-3 text-ui text-fg-muted">
            Seminars, camps and exam sessions. <span className="max-md:hidden">Every date and time is shown in the event’s own time zone.</span>
          </p>
        </div>
        <ViewSwitch filters={filters} />
      </header>
      {removed ? (
        <p role="status" className="mt-4 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-sm" data-testid="event-removed">
          The event was removed. Its reason is in the audit log.
        </p>
      ) : null}
      {filters.view === 'month' ? <MonthView filters={filters} /> : <AgendaView filters={filters} />}
      <div className="mt-12 grid gap-4 md:grid-cols-2">
        <FeedLink filters={filters} />
        <div className="grid content-start gap-1 rounded-md border border-dashed border-border-strong p-4">
          <p className="font-display text-xl">Teaching a seminar?</p>
          <p className="text-sm text-fg-muted">Publish it here. It shows on your profile, your school’s page and this calendar.</p>
          <p>
            <Link href="/dashboard/events" className="link inline-flex min-h-11 items-center">
              Publish an event
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
