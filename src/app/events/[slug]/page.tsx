// /events/[slug] (milestone M17, In scope 6): an event's public page. The dates in the event's own
// zone with the zone's name, the poster, the organizer and instructors (linked to their profiles),
// the school, "Add to calendar" (.ics), the organizer's link (in the same window: no new window,
// CLAUDE.md §10) and JSON-LD `Event` with the city only (never a venue line or a school's address,
// plan §6.4). Made from the public DTO only (events.get). A cancelled event stays, marked in text
// and shape. A removed event, a malformed slug and none at all show the same "not listed" state,
// never indexed. Staff with a verified second factor see "Remove the event".

import type { Metadata } from 'next';
import Link from 'next/link';

import { NameText } from '@/components/account/person-names';
import { CancelledMark, placeLine } from '@/components/events/event-list';
import { ArrowLeftIcon, CalendarIcon } from '@/components/icons';
import { PersonAvatar } from '@/components/lineage/person-avatar';
import { ErrorPanel } from '@/components/lineage/states';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatDay } from '@/lib/dates';
import { formatEventWhen, isoInZone } from '@/lib/event-time';
import { countryName } from '@/lib/regions';
import { appUrl } from '@/server/auth/env';
import { getRequestPrincipal } from '@/server/auth/web';
import type { EventPageDto } from '@/server/dto/events';
import { readFormResult } from '@/server/forms/flash';
import { canModerateEvents } from '@/server/services/events';
import { loadEvent } from './data';
import { EVENT_REMOVE_FORM } from './form-ids';
import { RemoveEventForm } from './remove-form';

export const instant = false;

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const read = await loadEvent((await params).slug);
  if (read.state === 'none') return { title: 'Event not listed', robots: { index: false, follow: false } };
  if (read.state === 'failed') return { title: 'Event not loaded', robots: { index: false, follow: false } };
  const { event } = read;
  const when = formatEventWhen(new Date(event.startsAt), new Date(event.endsAt), event.timezone);
  const description = `${event.kindLabel}${event.status === 'cancelled' ? ' (cancelled)' : ''}: ${when.short}, ${placeLine(event)}.`;
  return {
    metadataBase: new URL(appUrl()),
    title: event.title,
    description,
    alternates: { canonical: `/events/${event.slug}` },
    openGraph: { type: 'website', title: event.title, description, url: `/events/${event.slug}`, ...(event.poster ? { images: [{ url: event.poster.large, width: 512, height: 512 }] } : {}) },
  };
}

/** schema.org data of the event (JSON-LD), from the public DTO: the city only, never a venue or a point. */
function jsonLd(event: EventPageDto): Record<string, unknown> {
  const url = `${appUrl()}/events/${event.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    url,
    startDate: isoInZone(new Date(event.startsAt), event.timezone),
    endDate: isoInZone(new Date(event.endsAt), event.timezone),
    eventStatus: event.status === 'cancelled' ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    eventAttendanceMode: event.online ? 'https://schema.org/OnlineEventAttendanceMode' : 'https://schema.org/OfflineEventAttendanceMode',
    location: event.online
      ? { '@type': 'VirtualLocation', url: event.externalUrl ?? url }
      : { '@type': 'Place', name: event.city, address: { '@type': 'PostalAddress', addressLocality: event.city, addressCountry: event.countryCode } },
    ...(event.description ? { description: event.description } : {}),
    ...(event.poster ? { image: [`${appUrl()}${event.poster.full}`] } : {}),
    ...(event.organizer
      ? {
          organizer: {
            '@type': event.organizer.kind === 'organization' ? 'Organization' : 'Person',
            name: event.organizer.name.value,
            url: `${appUrl()}/${event.organizer.kind === 'organization' ? 'organizations' : 'people'}/${event.organizer.slug}`,
          },
        }
      : {}),
    ...(event.instructors.length > 0 ? { performer: event.instructors.map((i) => ({ '@type': 'Person', name: i.name.value, url: `${appUrl()}/people/${i.slug}` })) } : {}),
  };
}

/** Whether the event is over (read once per request; the page renders per request). */
function hasEnded(endsAt: string): boolean {
  return new Date(endsAt).getTime() <= Date.now();
}

function Back() {
  return (
    <p className="eyebrow">
      <Link href="/events" className="link inline-flex min-h-11 items-center gap-1.5">
        <ArrowLeftIcon size={16} />
        Events
      </Link>
    </p>
  );
}

export default async function EventPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const read = await loadEvent(slug);
  if (read.state !== 'found') {
    return (
      <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
        <Back />
        {read.state === 'none' ? (
          <div data-testid="event-not-listed">
            <h1 className="mt-2 font-display text-feature">This event is not listed</h1>
            <p className="mt-3 max-w-[56ch] text-fg-muted">The address may be mistyped, or the event is no longer in the calendar.</p>
            <p className="mt-6">
              <Link href="/events" className={buttonVariants({ variant: 'secondary' })}>
                All events
              </Link>
            </p>
          </div>
        ) : (
          <ErrorPanel title="The event could not be loaded." className="mt-6 max-w-[46rem]">
            <p className="text-sm text-fg-muted">Nothing was changed. Try again in a moment.</p>
            <Link href={`/events/${encodeURIComponent(slug)}`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Try again
            </Link>
          </ErrorPanel>
        )}
      </div>
    );
  }

  const { event } = read;
  const when = formatEventWhen(new Date(event.startsAt), new Date(event.endsAt), event.timezone);
  const cancelled = event.status === 'cancelled';
  const past = hasEnded(event.endsAt);
  const moderator = canModerateEvents(await getRequestPrincipal());
  const removeOutcome = moderator ? await readFormResult(EVENT_REMOVE_FORM, (await searchParams).outcome) : null;

  return (
    <article className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14" data-testid="event-page" data-status={event.status}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(event)).replace(/</g, '\\u003c') }} />
      <div className="grid max-w-[60rem] gap-8 md:grid-cols-[minmax(0,1fr)_16rem]">
        <header className="min-w-0">
          <Back />
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-label uppercase text-fg-muted">
            <span>{event.kindLabel}</span>
            {past ? <span>Past event</span> : null}
            {cancelled ? <CancelledMark /> : null}
          </p>
          <h1 className="mt-2 font-display text-feature [overflow-wrap:anywhere]">{event.title}</h1>
          {cancelled ? (
            <div className="mt-4 grid gap-1 rounded-sm border-l-4 border-danger bg-surface-2 px-4 py-3 text-ui" data-testid="event-cancelled-note">
              <p className="font-semibold">This event was cancelled{event.cancelledAt ? ` on ${formatDay(event.cancelledAt.slice(0, 10))}` : ''}.</p>
              {event.cancellationNote ? <p className="whitespace-pre-line text-fg-muted">{event.cancellationNote}</p> : null}
            </div>
          ) : null}
          <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3">
            <dt className="text-sm text-fg-muted">When</dt>
            <dd className="min-w-0">
              <time dateTime={isoInZone(new Date(event.startsAt), event.timezone)} data-testid="event-when">
                {when.text}
              </time>
              <p className="text-sm text-fg-muted" data-testid="event-zone">
                {when.zone}
              </p>
            </dd>
            <dt className="text-sm text-fg-muted">Where</dt>
            <dd className="min-w-0" data-testid="event-where">
              {event.online ? 'Online' : `${event.city}, ${countryName(event.countryCode) ?? event.countryCode}`}
              {event.venue ? <p className="text-sm text-fg-muted">{event.venue}</p> : null}
            </dd>
            {event.organizer ? (
              <>
                <dt className="text-sm text-fg-muted">Organizer</dt>
                <dd className="min-w-0">
                  <Link
                    href={event.organizer.kind === 'organization' ? `/organizations/${event.organizer.slug}` : `/people/${event.organizer.slug}`}
                    className="link inline-flex min-h-11 items-center"
                    data-testid="event-organizer"
                  >
                    <NameText name={event.organizer.name} />
                  </Link>
                </dd>
              </>
            ) : null}
            {event.school ? (
              <>
                <dt className="text-sm text-fg-muted">School</dt>
                <dd className="min-w-0">
                  <Link href={`/schools/${event.school.slug}`} className="link inline-flex min-h-11 items-center" data-testid="event-school">
                    {event.school.name}, {event.school.city}
                  </Link>
                </dd>
              </>
            ) : null}
          </dl>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href={`/events/${event.slug}/calendar.ics`} download={`${event.slug}.ics`} className={buttonVariants({ variant: 'primary' })} data-testid="event-ics">
              <CalendarIcon />
              Add to calendar
            </a>
            {event.externalUrl ? (
              <a href={event.externalUrl} rel="nofollow noopener" className={buttonVariants({ variant: 'secondary' })} data-testid="event-external">
                Organizer’s page
              </a>
            ) : null}
          </div>
          {event.externalUrl ? <p className="mt-2 text-sm text-fg-muted">The organizer’s page is on another site: {new URL(event.externalUrl).host}.</p> : null}
        </header>
        {event.poster ? (
          <figure className="md:pt-14">
            {/* The heading names the event; the poster's words are the organizer's and may say more. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={event.poster.full}
              alt={`Poster of ${event.title}`}
              width={event.poster.width}
              height={event.poster.height}
              className="h-auto w-full rounded-sm border border-border-subtle bg-surface-1"
              data-testid="event-poster"
            />
          </figure>
        ) : null}
      </div>

      <div className="mt-10 grid max-w-[46rem] gap-10">
        {event.description ? (
          <section aria-labelledby="event-about">
            <h2 id="event-about" className="font-display text-xl">
              About
            </h2>
            <p className="mt-2 whitespace-pre-line">{event.description}</p>
          </section>
        ) : null}

        {event.instructors.length > 0 ? (
          <section aria-labelledby="event-instructors">
            <h2 id="event-instructors" className="font-display text-xl">
              Instructors
            </h2>
            <ul className="mt-3 grid gap-2">
              {event.instructors.map((i) => (
                <li key={i.slug} data-testid="event-instructor" data-slug={i.slug}>
                  <Link href={`/people/${i.slug}`} className="link inline-flex min-h-11 items-center gap-3 font-display text-lg">
                    <PersonAvatar name={i.name.value} photo={i.photo} size="sm" decorative />
                    <NameText name={i.name} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="border-t border-border-subtle pt-4 text-sm text-fg-muted">
          Published by its organizer without a review; last changed on {formatDay(event.updatedAt.slice(0, 10))}. An event says nothing about who taught whom.
        </p>

        {moderator ? (
          <section aria-labelledby="event-moderation" className="grid gap-3 rounded-sm border border-border-strong p-4" data-testid="event-moderation">
            <h2 id="event-moderation" className="font-display text-lg">
              Moderation
            </h2>
            <RemoveEventForm id={event.id} slug={event.slug} initial={removeOutcome} />
          </section>
        ) : null}
      </div>
    </article>
  );
}
