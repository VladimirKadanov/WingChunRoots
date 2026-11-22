// The calendar entry of one public event (milestone M17; ADR 0052): the same fields for its own
// .ics file (/events/<slug>/calendar.ics) and for the calendar feed (/events/calendar.ics). Made
// from the public DTO of events.get only: the city and the venue line the organizer published,
// never a school's address.

import type { IcsEvent } from '@/lib/ics';
import type { EventPageDto } from '@/server/dto/events';

export function icsEventOf(event: EventPageDto, origin: string): IcsEvent {
  const host = new URL(origin).host;
  const location = event.online ? 'Online' : [event.venue, event.city && event.countryCode ? `${event.city}, ${event.countryCode}` : null].filter(Boolean).join(', ');
  const description = [event.description, event.cancellationNote ? `Cancelled: ${event.cancellationNote}` : null, event.externalUrl].filter(Boolean).join('\n\n');
  return {
    uid: `${event.id}@${host}`,
    start: new Date(event.startsAt),
    end: new Date(event.endsAt),
    stamp: new Date(event.updatedAt),
    summary: event.title,
    description: description || null,
    location: location || null,
    url: `${origin}/events/${event.slug}`,
    cancelled: event.status === 'cancelled',
    sequence: event.revision,
  };
}
