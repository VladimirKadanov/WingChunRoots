// The cards of the event calendar (docs/adr/0052-public-page-redesign.md): /events in its Agenda
// view, "Next up" and "More from this organizer". Server-rendered from the public DTO only. The art
// is the event's poster, cropped to the card, or the ink motif of its kind drawn from its slug; the
// date seal and the kind mark say the day and the kind in text and shape, never by colour alone.

import Link from 'next/link';

import { NameText } from '@/components/account/person-names';
import { InkArt } from '@/components/ink/ink-art';
import { cx } from '@/lib/cx';
import { formatEventWhen, shortMonthName, shortWeekdayName, zoneCity, zonedParts } from '@/lib/event-time';
import { eventMotif } from '@/lib/ink-art';
import type { EventKind, EventSummaryDto } from '@/server/dto/events';
import { CancelledMark, placeLine } from './event-list';

/** The shape of each kind: a circle, a triangle (a tent), a square, a diamond; online is a dashed ring. */
export function KindShape({ kind, online, size = 12 }: { kind: EventKind; online?: boolean; size?: number }) {
  const common = { 'aria-hidden': true, width: size, height: size, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 } as const;
  if (online) {
    return (
      <svg {...common}>
        <circle cx="6" cy="6" r="4.5" strokeDasharray="2 2" />
      </svg>
    );
  }
  switch (kind) {
    case 'seminar':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.5" />
        </svg>
      );
    case 'camp':
      return (
        <svg {...common}>
          <path d="M6 1.5 11 10.5H1Z" strokeLinejoin="round" />
        </svg>
      );
    case 'exam_session':
      return (
        <svg {...common}>
          <rect x="1.5" y="1.5" width="9" height="9" />
        </svg>
      );
    case 'other':
      return (
        <svg {...common}>
          <path d="M6 1 11 6 6 11 1 6Z" strokeLinejoin="round" />
        </svg>
      );
  }
}

/** "Seminar" with its shape, and "Online" for an online event; "Cancelled" in words when it is. */
export function KindLine({ event, className }: { event: Pick<EventSummaryDto, 'kind' | 'kindLabel' | 'online' | 'status'>; className?: string }) {
  return (
    <p className={cx('flex flex-wrap items-center gap-x-3 gap-y-1 text-label uppercase text-fg-muted', className)}>
      <span className="inline-flex items-center gap-1.5">
        <KindShape kind={event.kind} online={event.online} />
        {event.online ? `Online · ${event.kindLabel}` : event.kindLabel}
      </span>
      {event.status === 'cancelled' ? <CancelledMark /> : null}
    </p>
  );
}

/** The day an event starts, in its own zone, as a stamped seal. Decorative: the date is in the text. */
export function DateSeal({ startsAt, timezone, size = 'md', className }: { startsAt: string; timezone: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const p = zonedParts(new Date(startsAt), timezone);
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 flex-col items-center rounded-xs border border-border-strong bg-bg leading-none',
        size === 'sm' ? 'w-13 py-1.5' : size === 'md' ? 'w-15 py-2' : 'w-20 py-2.5',
        className,
      )}
    >
      {size === 'lg' ? <span className="text-caption uppercase text-fg-muted">{shortWeekdayName(p.weekday)}</span> : null}
      <span className={cx('font-display', size === 'sm' ? 'text-xl' : size === 'md' ? 'text-2xl' : 'mt-1 text-3xl')}>{p.day}</span>
      <span className="mt-1 text-caption uppercase text-fg-muted">{shortMonthName(p.month)}</span>
    </span>
  );
}

/** The art of an event: its poster cropped to the frame, or its drawn motif. */
export function EventArt({ event, className }: { event: Pick<EventSummaryDto, 'slug' | 'kind' | 'online' | 'poster'>; className?: string }) {
  return (
    <div className={cx('relative overflow-hidden bg-surface-2', className)}>
      {event.poster ? (
        // A decorative crop: the title next to it names the event, and its page shows the whole poster.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={event.poster.large} alt="" loading="lazy" decoding="async" className="size-full object-cover" data-testid="event-card-poster" />
      ) : (
        <InkArt slug={event.slug} motif={eventMotif(event.kind, event.online)} testId="event-card-art" />
      )}
    </div>
  );
}

function OrganizerLine({ event }: { event: EventSummaryDto }) {
  if (!event.organizer) return null;
  return (
    <p className="mt-auto flex items-center gap-2 border-t border-border-subtle pt-3 text-sm">
      <span className="sr-only">Organized by </span>
      <NameText name={event.organizer.name} />
    </p>
  );
}

/**
 * One event of the Agenda view as a card. The whole card is the title's link (its ::after covers
 * the card), so the accessible name stays the title. Keeps the row's test ids (event-row,
 * data-slug, data-status) so the lists read the same to every check.
 */
export function EventCard({ event, headingLevel = 3 }: { event: EventSummaryDto; headingLevel?: 2 | 3 }) {
  const when = formatEventWhen(new Date(event.startsAt), new Date(event.endsAt), event.timezone);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const cancelled = event.status === 'cancelled';
  return (
    <li
      className="relative flex flex-col overflow-hidden rounded-md border border-border-subtle bg-surface-1 focus-within:border-fg hover:border-border-strong"
      data-testid="event-row"
      data-slug={event.slug}
      data-status={event.status}
    >
      <div className="relative">
        <EventArt event={event} className="aspect-video" />
        <DateSeal startsAt={event.startsAt} timezone={event.timezone} className="absolute top-3 left-3" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <KindLine event={event} />
        <Heading className="m-0 text-base font-normal">
          <Link
            href={`/events/${event.slug}`}
            className={cx(
              'inline-flex min-h-11 items-center font-display text-xl leading-tight [overflow-wrap:anywhere] after:absolute after:inset-0 after:content-[""]',
              cancelled && 'line-through decoration-1',
            )}
          >
            {event.title}
          </Link>
        </Heading>
        <p className="text-sm text-fg-muted">
          <time dateTime={event.startsAt}>{when.short}</time>
          <span> · {zoneCity(event.timezone)} time</span>
        </p>
        <p className="text-sm text-fg-muted">{placeLine(event)}</p>
        <OrganizerLine event={event} />
      </div>
    </li>
  );
}

/** The next event, large, above the Agenda (upcoming, unfiltered, first page). */
export function NextEvent({ event }: { event: EventSummaryDto }) {
  const when = formatEventWhen(new Date(event.startsAt), new Date(event.endsAt), event.timezone);
  return (
    <section
      aria-labelledby="next-event"
      className="relative mt-6 grid overflow-hidden rounded-md border border-border-subtle bg-surface-1 focus-within:border-fg hover:border-border-strong md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
      data-testid="event-next"
      data-slug={event.slug}
    >
      <div className="relative">
        <EventArt event={event} className="aspect-video h-full md:aspect-auto md:min-h-72" />
        <DateSeal startsAt={event.startsAt} timezone={event.timezone} size="lg" className="absolute top-3 left-3" />
      </div>
      <div className="flex flex-col justify-center gap-2 p-5 md:p-8">
        <p className="eyebrow">Next up</p>
        <KindLine event={event} />
        <h2 id="next-event" className="m-0 text-base font-normal">
          <Link
            href={`/events/${event.slug}`}
            className="inline-flex min-h-11 items-center font-display text-feature leading-tight [overflow-wrap:anywhere] after:absolute after:inset-0 after:content-['']"
          >
            {event.title}
          </Link>
        </h2>
        <p className="text-fg-muted">
          <time dateTime={event.startsAt}>{when.text}</time> · {zoneCity(event.timezone)} time
        </p>
        <p className="text-fg-muted">{placeLine(event)}</p>
        {event.organizer ? (
          <p className="text-sm">
            Organized by <NameText name={event.organizer.name} />
          </p>
        ) : null}
      </div>
    </section>
  );
}
