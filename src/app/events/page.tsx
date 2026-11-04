// /events (milestone M17, In scope 6): the event calendar. A plain GET form (country, kind, online
// or in person) and the state in the address, read on the server through events.list (the same
// procedure as /api/v1), so the list is in the first HTML and works without JavaScript. Upcoming
// events by month, each in its own time zone (DEFAULT M17, question 1: the month of an event is the
// calendar month in its own zone); past events, newest first, one link away. A read that fails
// shows an error state with Retry, never an empty calendar (plan §5.6).

import type { Metadata } from 'next';
import Link from 'next/link';

import { EventRow } from '@/components/events/event-list';
import { ChevronDownIcon } from '@/components/icons';
import { ErrorPanel } from '@/components/lineage/states';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { formatEventWhen, monthLabel } from '@/lib/event-time';
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

interface Filters {
  when: 'upcoming' | 'past';
  country: string | null;
  kind: keyof typeof EVENT_KIND_LABELS | null;
  format: 'online' | 'in_person' | null;
  /** From a profile's or a school's "Upcoming events": the events of one person or one school. */
  person: string | null;
  school: string | null;
  page: number;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The address's filters; anything malformed is dropped, never an error page. */
function filtersOf(params: Record<string, string | string[] | undefined>): Filters {
  const country = one(params.country)?.toUpperCase() ?? '';
  const kind = one(params.kind) ?? '';
  const format = one(params.format) ?? '';
  const page = Number(one(params.page) ?? '1');
  return {
    when: one(params.when) === 'past' ? 'past' : 'upcoming',
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    kind: kind in EVENT_KIND_LABELS ? (kind as Filters['kind']) : null,
    format: format === 'online' || format === 'in_person' ? format : null,
    person: SLUG.test(one(params.person) ?? '') && (one(params.person) ?? '').length <= 120 ? one(params.person)! : null,
    school: SLUG.test(one(params.school) ?? '') && (one(params.school) ?? '').length <= 120 ? one(params.school)! : null,
    page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}

function hrefOf(f: Filters, change: Partial<Filters> = {}): string {
  const next = { ...f, ...change };
  const q = new URLSearchParams();
  if (next.when === 'past') q.set('when', 'past');
  if (next.country) q.set('country', next.country);
  if (next.kind) q.set('kind', next.kind);
  if (next.format) q.set('format', next.format);
  if (next.person) q.set('person', next.person);
  if (next.school) q.set('school', next.school);
  if (next.page > 1) q.set('page', String(next.page));
  const s = q.toString();
  return s ? `/events?${s}` : '/events';
}

/** The items by the month they start in, in their own zone, in the list's order. */
function byMonth(items: EventSummaryDto[]): { month: string; items: EventSummaryDto[] }[] {
  const groups: { month: string; items: EventSummaryDto[] }[] = [];
  for (const item of items) {
    const month = formatEventWhen(new Date(item.startsAt), new Date(item.endsAt), item.timezone).month;
    const last = groups.at(-1);
    if (last && last.month === month) last.items.push(item);
    else groups.push({ month, items: [item] });
  }
  return groups;
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

function FilterForm({ filters, countries }: { filters: Filters; countries: string[] }) {
  const countryOptions: [string, string][] = [['', 'All countries'], ...countries.map((c): [string, string] => [c, countryName(c) ?? c])];
  if (filters.country && !countries.includes(filters.country)) countryOptions.push([filters.country, countryName(filters.country) ?? filters.country]);
  return (
    <form method="get" action="/events" role="search" aria-label="Filter events" className="mt-6 grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,12rem))_auto]">
      {filters.when === 'past' ? <input type="hidden" name="when" value="past" /> : null}
      {filters.person ? <input type="hidden" name="person" value={filters.person} /> : null}
      {filters.school ? <input type="hidden" name="school" value={filters.school} /> : null}
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
    </form>
  );
}

async function loadList(f: Filters): Promise<EventListDto | null> {
  const client = await lineageClient();
  try {
    return await client.events.list({
      when: f.when,
      country: f.country ?? undefined,
      kind: f.kind ?? undefined,
      format: f.format ?? undefined,
      person: f.person ?? undefined,
      school: f.school ?? undefined,
      page: f.page,
    });
  } catch (error) {
    console.error(`[events] the list could not be loaded: ${failure(error)}`);
    return null;
  }
}

export default async function EventsPage({ searchParams }: Props) {
  const query = await searchParams;
  const filters = filtersOf(query);
  const removed = one(query.removed) === '1';
  const list = await loadList(filters);
  const filtered = filters.country !== null || filters.kind !== null || filters.format !== null || filters.person !== null || filters.school !== null;
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[52rem]">
        <h1 className="font-display text-feature">Events</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          Seminars, camps, exam sessions and other events of the community. Every date and time is shown in the event’s own time zone.
        </p>
        {removed ? (
          <p role="status" className="mt-4 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-sm" data-testid="event-removed">
            The event was removed. Its reason is in the audit log.
          </p>
        ) : null}
        <nav aria-label="Upcoming or past" className="mt-6 flex gap-2">
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
        {list === null ? (
          <ErrorPanel title="The events could not be loaded." className="mt-6">
            <p className="text-sm text-fg-muted">Nothing was changed. Try again in a moment.</p>
            <Link href={hrefOf(filters)} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Try again
            </Link>
          </ErrorPanel>
        ) : (
          <>
            <FilterForm filters={filters} countries={list.countries} />
            {filters.person || filters.school ? (
              <p className="mt-4 text-sm" data-testid="event-scope">
                {filters.person ? 'The events of one person, as organizer or instructor.' : 'The events at one school.'}{' '}
                <Link href={hrefOf(filters, { person: null, school: null, page: 1 })} className="link inline-flex min-h-11 items-center">
                  Show every event
                </Link>
              </p>
            ) : null}
            <p className="mt-6 text-sm text-fg-muted" aria-live="polite" data-testid="event-count">
              {list.total === 1 ? '1 event' : `${list.total} events`}
              {filtered ? ' match these filters' : filters.when === 'upcoming' ? ' coming up' : ' in the past'}.
            </p>
            {list.items.length === 0 ? (
              <div className="mt-4 grid gap-3" data-testid="no-events">
                <p className="text-fg-muted">
                  {filtered
                    ? 'No event matches these filters.'
                    : filters.when === 'upcoming'
                      ? 'No event is coming up yet.'
                      : 'No past event yet.'}
                </p>
                {filtered ? (
                  <p>
                    <Link href={hrefOf({ ...filters, country: null, kind: null, format: null, person: null, school: null, page: 1 })} className="link inline-flex min-h-11 items-center">
                      Show every event
                    </Link>
                  </p>
                ) : null}
              </div>
            ) : (
              <div data-testid="event-list">
                {byMonth(list.items).map((group) => (
                  <section key={group.month} aria-labelledby={`month-${group.month}`} className="mt-6">
                    <h2 id={`month-${group.month}`} className="eyebrow border-b border-border-strong pb-2">
                      {monthLabel(group.month)}
                    </h2>
                    <ul className="grid">
                      {group.items.map((e) => (
                        <EventRow key={e.slug} event={e} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
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
        )}
        <p className="mt-8 text-sm">
          <Link href="/dashboard/events" className="link inline-flex min-h-11 items-center">
            Publish an event
          </Link>
        </p>
      </div>
    </div>
  );
}
