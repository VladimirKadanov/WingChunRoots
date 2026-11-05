// The public DTOs of events (milestone M17; plan §6.4; docs/adr/0020-events.md). events.list and
// events.get answer with these shapes, and only a value that went through a `toPublic…` function
// below may enter a 'use cache' function or leave those procedures: z.object() drops every key the
// schema does not name.
//
// What is never here: the organizer's or the publisher's account, staff's reason for a removal, a
// storage key, an instructor or organizer who is not a public person (or an approved organization),
// a school that is not public, and any point: a city by its name and country only (plan §6.4).

import * as z from 'zod';

import { EVENT_KINDS, PUBLIC_EVENT_STATUSES } from '../db/schema/common';
import { photoSchema } from './public';
import { searchNameSchema } from './search';

export const eventKindSchema = z.enum(EVENT_KINDS);
export type EventKind = z.infer<typeof eventKindSchema>;

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  seminar: 'Seminar',
  camp: 'Camp',
  exam_session: 'Exam session',
  other: 'Other event',
};

/** Who organizes it: a public person (a Sifu) or an approved organization; null when hidden. */
export const eventOrganizerSchema = z.object({
  kind: z.enum(['person', 'organization']),
  slug: z.string(),
  name: searchNameSchema,
});

/** The poster's renditions: squares for the lists, the whole image for the page. */
export const eventPosterSchema = z.object({
  small: z.string(),
  large: z.string(),
  full: z.string(),
  width: z.number().int(),
  height: z.number().int(),
});
export type EventPosterDto = z.infer<typeof eventPosterSchema>;

export const eventSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  kind: eventKindSchema,
  kindLabel: z.string(),
  /** ISO 8601 instants; the pages show them in `timezone` (src/lib/event-time.ts). */
  startsAt: z.string(),
  endsAt: z.string(),
  /** The event's own IANA time zone. */
  timezone: z.string(),
  online: z.boolean(),
  /** The city's name and country (never a point); null for an online event. */
  city: z.string().nullable(),
  countryCode: z.string().nullable(),
  status: z.enum(PUBLIC_EVENT_STATUSES),
  organizer: eventOrganizerSchema.nullable(),
  poster: eventPosterSchema.nullable(),
});
export type EventSummaryDto = z.infer<typeof eventSummarySchema>;

export const eventListSchema = z.object({
  when: z.enum(['upcoming', 'past']),
  items: z.array(eventSummarySchema),
  page: z.number().int(),
  pages: z.number().int(),
  total: z.number().int(),
  /** The countries of the events of this list (`when`), for the filter. */
  countries: z.array(z.string()),
});
export type EventListDto = z.infer<typeof eventListSchema>;

export const eventInstructorSchema = z.object({
  slug: z.string(),
  name: searchNameSchema,
  photo: photoSchema.nullable(),
});

export const eventPageSchema = eventSummarySchema.extend({
  /** The event's id: the UID of its .ics file and the address of its poster. */
  id: z.string(),
  description: z.string().nullable(),
  /** The line the organizer published about where it is (never a school's private address). */
  venue: z.string().nullable(),
  /** An https link the organizer gave. */
  externalUrl: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancellationNote: z.string().nullable(),
  /** A public school, by name and city. */
  school: z.object({ slug: z.string(), name: z.string(), city: z.string() }).nullable(),
  instructors: z.array(eventInstructorSchema),
  /** Bumped by every change: the SEQUENCE of the .ics file. */
  revision: z.number().int(),
  updatedAt: z.string(),
});
export type EventPageDto = z.infer<typeof eventPageSchema>;

export function toPublicEventList(value: EventListDto): EventListDto {
  return eventListSchema.parse(value);
}

export function toPublicEventPage(value: EventPageDto): EventPageDto {
  return eventPageSchema.parse(value);
}
