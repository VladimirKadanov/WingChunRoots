// The rows of an event list (milestone M17): /events, a profile's and a school's "Upcoming events"
// and the dashboard. Server-rendered from the public DTO only (events.list). The date is shown in
// the event's own zone (src/lib/event-time.ts), never in the reader's; a cancelled event says so in
// text with a mark, never by colour alone (CLAUDE.md §10).

import Link from 'next/link';

import { NameText } from '@/components/account/person-names';
import { formatEventWhen, zoneCity } from '@/lib/event-time';
import { cx } from '@/lib/cx';
import { countryName } from '@/lib/regions';
import type { EventSummaryDto } from '@/server/dto/events';

/** "Cancelled" with a crossed square: text and shape (the colour only repeats them). */
export function CancelledMark({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-label font-semibold uppercase text-danger', className)} data-testid="event-cancelled">
      <svg aria-hidden="true" viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.6}>
        <rect x="2" y="2" width="12" height="12" rx="1" />
        <path d="M5 5l6 6M11 5l-6 6" />
      </svg>
      Cancelled
    </span>
  );
}

/** Where: "Sofia, Bulgaria" or "Online". */
export function placeLine(event: Pick<EventSummaryDto, 'online' | 'city' | 'countryCode'>): string {
  if (event.online) return 'Online';
  return [event.city, countryName(event.countryCode) ?? event.countryCode].filter(Boolean).join(', ');
}

export function EventRow({ event, headingLevel = 3 }: { event: EventSummaryDto; headingLevel?: 2 | 3 }) {
  const when = formatEventWhen(new Date(event.startsAt), new Date(event.endsAt), event.timezone);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const [day, month] = when.short.split(' ').slice(1, 3);
  const cancelled = event.status === 'cancelled';
  return (
    <li className="flex gap-4 border-b border-border-subtle py-4" data-testid="event-row" data-slug={event.slug} data-status={event.status}>
      <div aria-hidden="true" className="grid w-14 shrink-0 content-start justify-items-center rounded-sm border border-border-subtle bg-surface-1 py-2">
        <span className="font-display text-xl leading-none">{day}</span>
        <span className="mt-1 text-caption uppercase text-fg-muted">{month}</span>
      </div>
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label uppercase text-fg-muted">
          <span>{event.kindLabel}</span>
          {cancelled ? <CancelledMark /> : null}
        </p>
        <Heading className="m-0 text-base font-normal">
          <Link href={`/events/${event.slug}`} className={cx('link inline-flex min-h-11 items-center font-display text-lg [overflow-wrap:anywhere]', cancelled && 'line-through decoration-1')}>
            {event.title}
          </Link>
        </Heading>
        <p className="text-sm text-fg-muted">
          <time dateTime={event.startsAt}>{when.text}</time>
          <span title={when.zone}> · {zoneCity(event.timezone)} time</span>
        </p>
        <p className="text-sm text-fg-muted">
          {placeLine(event)}
          {event.organizer ? (
            <>
              {' · '}
              <span className="sr-only">Organized by </span>
              <NameText name={event.organizer.name} />
            </>
          ) : null}
        </p>
      </div>
      {event.poster ? (
        // A decorative thumbnail: the title next to it names the event.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={event.poster.small} alt="" width={64} height={64} loading="lazy" decoding="async" className="hidden size-16 shrink-0 rounded-sm object-cover sm:block" />
      ) : null}
    </li>
  );
}

/** Upcoming events of a person or a school: a short list with a link to all. */
export function UpcomingEvents({
  items,
  total,
  allHref,
  emptyText,
  className,
  headingClassName = 'font-display text-xl',
}: {
  items: EventSummaryDto[];
  total: number;
  allHref: string;
  emptyText?: string;
  className?: string;
  headingClassName?: string;
}) {
  if (items.length === 0 && !emptyText) return null;
  return (
    <section aria-labelledby="upcoming-events" className={className} data-testid="upcoming-events">
      <h2 id="upcoming-events" className={headingClassName}>
        Upcoming events
      </h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">{emptyText}</p>
      ) : (
        <ul className="mt-3 grid">
          {items.map((e) => (
            <EventRow key={e.slug} event={e} />
          ))}
        </ul>
      )}
      {total > items.length ? (
        <p className="mt-3 text-sm">
          <Link href={allHref} className="link inline-flex min-h-11 items-center">
            All {total} upcoming events
          </Link>
        </p>
      ) : null}
    </section>
  );
}
