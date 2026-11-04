// The event calendar (milestone M17; specification §3.1 row Events, §11.1; plan §6.4, §6.5, §6.8;
// docs/adr/0020-events.md).
//
// Public reads (anyone, no session needed; public DTOs only, src/server/dto/events.ts; read through
// app_public_ro from v_public_event, the only relation of events that role may read):
//   events.list   upcoming (still running or later) or past events, filtered by country, kind and
//                 online or in person, by the person they name (organizer or instructor) or the
//                 school; pages of up to 50
//   events.get    one event by its slug (404 for a removed one, as for none)
// The organizer (a Sifu's account, or an admin of an approved organization, M15):
//   events.mine        the account's events, whom it may publish as and the allowance of the month
//   events.editor      what the form offers: cities, schools, instructors, zones, one own event
//   events.create      publish at once (DEFAULT M17, question 2: no review first)
//   events.update      change it; a move to another month checks the allowance again
//   events.cancel      it stays shown as "Cancelled" (text and a mark, never colour alone)
//   events.uploadPoster / removePoster
//                      the poster, processed as a gallery photo (no EXIF, GPS, XMP or IPTC)
// Staff with a verified second factor:
//   events.remove      with a reason (audited); a removed event is 404 everywhere
//
// The plan (DEFAULT M17, question 1; plan §6.5): a Sifu's events count against `events`: Professional
// Sifu publishes up to 2 that start in one calendar month in the event's own zone (published ones:
// a cancelled or removed event frees its place). The count and the write share the quota lock
// (lockQuota, READ COMMITTED), so two publications at once never pass the limit together; a move
// to another month counts again. Free Sifu and Student accounts are refused with the
// machine-readable decision (ENTITLEMENT_REQUIRED). An organization publishes only while it holds
// Federation (a grant), without a limit (DEFAULT D25); without it, ENTITLEMENT_REQUIRED.
//
// Notifications (DEFAULT M17, question 3): a background job (events.notify, pg-boss, queued in the
// transaction of the change with a singleton key) gives a dashboard notice to every Premium
// Student whose established teacher (verified or in arbitration) organizes the event or teaches at
// it, once per person, event and change (published, cancelled).
//
// Privacy (plan §6.4): the place is a city and country (never a point); `venue` is what the
// organizer writes; a school is offered only from the organizer's own listings (or the
// organization's accepted links) and shown only while public, by name and city. Logs and audit
// rows carry ids, the kind, the month and field names; never a title, a description or a key.

import { randomBytes } from 'node:crypto';

import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { cacheLife } from 'next/cache';
import * as z from 'zod';

import { formatEventWhen, isTimeZone, monthKey, monthLabel, toWallTime, wallTimeToInstant } from '../../lib/event-time';
import { writeAudit } from '../audit';
import { hasStaff2FA, requireStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { EVENTS_TAG, invalidatePublic, ORGANIZATIONS_TAG, personTag, SCHOOLS_TAG, tagCacheEntry } from '../cache';
import { getDb, getPublicDb } from '../db';
import { uuidv7 } from '../db/ids';
import { event, eventInstructor, organization, organizationAdmin, organizationSchool, person, place, school } from '../db/schema';
import {
  EVENT_DESCRIPTION_MAX,
  EVENT_INSTRUCTORS_MAX,
  EVENT_KINDS,
  EVENT_MAX_DAYS,
  EVENT_REASON_MAX,
  EVENT_TITLE_MAX,
  EVENT_URL_MAX,
  EVENT_VENUE_MAX,
  PUBLIC_RELATIONSHIP_STATUSES,
} from '../db/schema/common';
import {
  EVENT_KIND_LABELS,
  type EventKind,
  type EventListDto,
  type EventPageDto,
  type EventPosterDto,
  type EventSummaryDto,
  toPublicEventList,
  toPublicEventPage,
} from '../dto/events';
import { effectivePlan, type Executor, organizationPlan } from '../entitlements/access';
import { decide, type EntitlementDecision } from '../entitlements/effective';
import { feature, upgradeBenefits } from '../entitlements/plans';
import { lockQuota } from '../entitlements/quota';
import { listedPlaces, type PlaceHit, searchPlaces } from '../geo/places';
import { enqueue, type Transaction } from '../jobs/outbox';
import { QUEUE } from '../jobs/queues';
import { getPhotoStore, newStorageKey, type ObjectStore } from '../storage';
import { PhotoRefused, renderGalleryPhoto } from '../storage/photo';
import { readObjectBytes } from '../storage/read';
import type { RequestMeta } from './context';
import type { UpgradeOffer } from './dashboard';
import { ServiceError } from './errors';
import { PHOTO_HASH_LENGTH, photoOf, publicPhotoRefs } from './photo-refs';
import {
  deleteFiles,
  etagMatches,
  fileBytes,
  type OpenPhotoOptions,
  PHOTO_ADDRESS,
  PHOTO_READ_TIMEOUT_MS,
  PHOTO_RENDITION_MAX_BYTES,
  type PhotoFile,
  photoEtag,
  putRenditions,
  refusalMessage,
  renditionFile,
  sha256,
} from './photos';
import { openPilotRequest, planSummary } from './plans';

// --- Limits and words ----------------------------------------------------------------------------

/** A page of the calendar. */
export const EVENTS_PAGE_SIZE = 20;
/** The most events the dashboard lists. */
export const MY_EVENTS_LIMIT = 200;

const NO_EVENT = 'No such event.';
const notFound = () => new ServiceError('NOT_FOUND', NO_EVENT);
const NO_PROFILE = 'You have no profile yet. Finish setting up your profile first: you are the organizer of the events you publish.';
export const STUDENT_CANNOT_PUBLISH = 'Events are published from a Sifu account. Your account is a Student account.';
export const ORGANIZATION_NEEDS_FEDERATION =
  'Publishing as an organization is part of its Federation plan. In the pilot an administrator of WingChunRoots can give it as a test plan; nothing is charged.';
const CANCELLED_NO_CHANGE = 'This event is cancelled: it can no longer be changed.';

/** The address of one rendition of an event's poster: GET /api/event-posters/<id>/<hash>/<size>.webp. */
export function eventPosterUrl(id: string, sha: string, size: 96 | 512 | 'full'): string {
  return `/api/event-posters/${id}/${sha.slice(0, PHOTO_HASH_LENGTH)}/${size}.webp`;
}

function posterDto(id: string, sha: string | null, width: number | null, height: number | null): EventPosterDto | null {
  if (!sha || !width || !height) return null;
  return { small: eventPosterUrl(id, sha, 96), large: eventPosterUrl(id, sha, 512), full: eventPosterUrl(id, sha, 'full'), width, height };
}

/** The sentence of a refusal at the month's limit (Professional Sifu, DEFAULT M17, question 1). */
export function monthFullMessage(limit: number, month: string, planName: string): string {
  return `You have published ${limit} of ${limit} events starting in ${monthLabel(month)} on ${planName}. Choose another month, or cancel one of them first.`;
}

// --- Input ---------------------------------------------------------------------------------------

const slug = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

/** events.list: the calendar's filters (all optional). */
export const eventsListInput = z.object({
  when: z.enum(['upcoming', 'past']).default('upcoming'),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  kind: z.enum(EVENT_KINDS).optional(),
  format: z.enum(['online', 'in_person']).optional(),
  /** The events a public person organizes or teaches at (their profile's "Upcoming events"). */
  person: slug.optional(),
  /** The events at a public school (its page's "Upcoming events"). */
  school: slug.optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(EVENTS_PAGE_SIZE),
});
export type EventsListInput = z.output<typeof eventsListInput>;

export const eventSlugInput = z.object({ slug: z.string().max(200) });
export const eventIdInput = z.object({ id: z.uuid({ error: NO_EVENT }) });

const text = (max: number) => z.string().max(max * 2).nullish();

/** The fields of the event form: wall times in the event's zone ("2027-03-13T10:00"). */
const eventFields = z.object({
  title: z.string().max(EVENT_TITLE_MAX * 2),
  kind: z.enum(EVENT_KINDS, { error: 'Choose what kind of event it is.' }),
  description: text(EVENT_DESCRIPTION_MAX),
  startsAt: z.string().max(40),
  endsAt: z.string().max(40),
  online: z.boolean().default(false),
  /** The city (place.id); its zone is the event's zone. Not for an online event. */
  placeId: z.uuid({ error: 'Choose the city.' }).nullish(),
  /** The zone of an online event (or of a city that has none recorded). */
  timezone: z.string().max(80).nullish(),
  venue: text(EVENT_VENUE_MAX),
  schoolId: z.uuid({ error: 'Choose a school from the list.' }).nullish(),
  externalUrl: text(EVENT_URL_MAX),
  instructorIds: z.array(z.uuid({ error: 'Choose instructors from the list.' })).max(EVENT_INSTRUCTORS_MAX * 2).default([]),
});

/** events.create: publish an event; `organizationId` publishes as an organization the account administers. */
export const eventCreateInput = eventFields.extend({
  organizationId: z.uuid({ error: 'Choose whom to publish as.' }).nullish(),
});

/** events.update: the same fields; the organizer never changes. */
export const eventUpdateInput = eventFields.extend({ id: z.uuid({ error: NO_EVENT }) });

/** events.cancel: an optional public note ("Moved to the spring"). */
export const eventCancelInput = z.object({ id: z.uuid({ error: NO_EVENT }), note: z.string().max(EVENT_REASON_MAX * 2).nullish() });

/** events.remove: staff, with a reason kept in the audit log. */
export const eventRemoveInput = z.object({ id: z.uuid({ error: NO_EVENT }), reason: z.string().max(EVENT_REASON_MAX * 2) });

/** events.uploadPoster: multipart `id`, `file` (JPEG, PNG or WebP, at most 5 MB). */
export const eventPosterUploadInput = z.object({ id: z.uuid({ error: NO_EVENT }), file: z.file({ error: 'Choose an image.' }) });

/** events.editor: the form's options; `city` searches the cities, `id` loads one own event. */
export const eventEditorInput = z.object({
  id: z.uuid({ error: NO_EVENT }).optional(),
  city: z.string().max(100).optional(),
});

const FIELD_LABELS: Record<string, string> = {
  title: `Give the event a title of 2 to ${EVENT_TITLE_MAX} characters.`,
  kind: 'Choose what kind of event it is.',
  description: `At most ${EVENT_DESCRIPTION_MAX} characters.`,
  startsAt: 'Give the start as a date and a time.',
  endsAt: 'Give the end as a date and a time.',
  placeId: 'Choose the city.',
  timezone: 'Choose the time zone.',
  venue: `At most ${EVENT_VENUE_MAX} characters.`,
  schoolId: 'Choose a school from the list.',
  externalUrl: 'Give a link that starts with https://.',
  instructorIds: `Choose at most ${EVENT_INSTRUCTORS_MAX} instructors from the list.`,
  organizationId: 'Choose whom to publish as.',
  note: `At most ${EVENT_REASON_MAX} characters.`,
  reason: `At most ${EVENT_REASON_MAX} characters.`,
  file: 'Choose an image.',
};

function fieldErrors(error: z.ZodError): ServiceError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    fields[key] ??= FIELD_LABELS[key] ?? issue.message;
  }
  return new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
}

const oneLine = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
const block = (value: string | null | undefined) =>
  (value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

function newSlug(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `${base || 'event'}-${randomBytes(3).toString('hex')}`;
}

function safeUrl(raw: string | null | undefined): string | null | 'bad' {
  const value = oneLine(raw);
  if (value === '') return null;
  if (value.length > EVENT_URL_MAX || !/^https:\/\/\S+$/i.test(value)) return 'bad';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return 'bad';
    return url.toString();
  } catch {
    return 'bad';
  }
}

const SQL_IDS = (ids: readonly string[]) => sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[]`;

// --- Public reads ----------------------------------------------------------------------------------

interface PublicRow extends Record<string, unknown> {
  id: string;
  slug: string;
  title: string;
  kind: EventKind;
  description: string | null;
  starts_at: Date | string;
  ends_at: Date | string;
  timezone: string;
  online: boolean;
  venue: string | null;
  city_name: string | null;
  country_code: string | null;
  external_url: string | null;
  status: 'published' | 'cancelled';
  cancelled_at: Date | string | null;
  cancellation_note: string | null;
  organizer_person_id: string | null;
  organizer_person_slug: string | null;
  organizer_person_name: string | null;
  organizer_person_lang: string | null;
  organization_id: string | null;
  organization_slug: string | null;
  organization_name: string | null;
  school_slug: string | null;
  school_name: string | null;
  school_city: string | null;
  instructors: { id: string; slug: string; display_name: string; lang: string | null }[];
  poster_sha256: string | null;
  poster_width: number | null;
  poster_height: number | null;
  revision: number;
  updated_at: Date | string;
}

const iso = (value: Date | string) => (value instanceof Date ? value : new Date(value)).toISOString();
const latinName = (value: string, lang: string | null) => ({ value, lang: lang ?? 'und-Latn', script: 'Latn' });

function summaryOf(r: PublicRow): EventSummaryDto {
  const organizer =
    r.organization_slug && r.organization_name
      ? { kind: 'organization' as const, slug: r.organization_slug, name: latinName(r.organization_name, 'en') }
      : r.organizer_person_slug && r.organizer_person_name
        ? { kind: 'person' as const, slug: r.organizer_person_slug, name: latinName(r.organizer_person_name, r.organizer_person_lang) }
        : null;
  return {
    slug: r.slug,
    title: r.title,
    kind: r.kind,
    kindLabel: EVENT_KIND_LABELS[r.kind],
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    timezone: r.timezone,
    online: r.online,
    city: r.online ? null : r.city_name,
    countryCode: r.online ? null : r.country_code,
    status: r.status,
    organizer,
    poster: posterDto(r.id, r.poster_sha256, r.poster_width, r.poster_height),
  };
}

/** The person tags of an answer: its organizers and instructors (a profile hidden later drops it). */
function personTags(rows: readonly PublicRow[]): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.organizer_person_id) ids.add(r.organizer_person_id);
    for (const i of r.instructors ?? []) ids.add(i.id);
  }
  return [...ids].map(personTag);
}

const COLUMNS = sql.raw(`v.id, v.slug, v.title, v.kind, v.description, v.starts_at, v.ends_at, v.timezone, v.online, v.venue, v.city_name, v.country_code,
  v.external_url, v.status, v.cancelled_at, v.cancellation_note, v.organizer_person_id, v.organizer_person_slug, v.organizer_person_name,
  v.organizer_person_lang, v.organization_id, v.organization_slug, v.organization_name, v.school_slug, v.school_name, v.school_city,
  v.instructors, v.poster_sha256, v.poster_width, v.poster_height, v.revision, v.updated_at`);

async function cachedEventList(input: EventsListInput): Promise<EventListDto> {
  'use cache';
  // "Upcoming" moves with the clock: a short life, as the school pages (ADR 0020).
  cacheLife('minutes');
  const db = getPublicDb();
  const upcoming = input.when === 'upcoming';
  const filters = [
    upcoming ? sql`v.ends_at > now()` : sql`v.ends_at <= now()`,
    input.country ? sql`NOT v.online AND v.country_code = ${input.country}` : undefined,
    input.kind ? sql`v.kind = ${input.kind}` : undefined,
    input.format === 'online' ? sql`v.online` : input.format === 'in_person' ? sql`NOT v.online` : undefined,
    input.person
      ? sql`(v.organizer_person_slug = ${input.person} OR v.instructors @> ${JSON.stringify([{ slug: input.person }])}::jsonb)`
      : undefined,
    input.school ? sql`v.school_slug = ${input.school}` : undefined,
  ].filter((f) => f !== undefined);
  const where = sql.join(filters, sql` AND `);
  const order = upcoming ? sql`v.starts_at ASC, v.slug ASC` : sql`v.starts_at DESC, v.slug ASC`;
  const offset = (input.page - 1) * input.limit;
  const [rows, counted, countries] = await Promise.all([
    db.execute<PublicRow>(sql`SELECT ${COLUMNS} FROM v_public_event v WHERE ${where} ORDER BY ${order} LIMIT ${input.limit} OFFSET ${offset}`),
    db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM v_public_event v WHERE ${where}`),
    db.execute<{ country_code: string }>(sql`
      SELECT DISTINCT v.country_code FROM v_public_event v
       WHERE ${upcoming ? sql`v.ends_at > now()` : sql`v.ends_at <= now()`} AND NOT v.online AND v.country_code IS NOT NULL
       ORDER BY v.country_code`),
  ]);
  tagCacheEntry([EVENTS_TAG, SCHOOLS_TAG, ORGANIZATIONS_TAG, ...personTags(rows.rows)]);
  const total = counted.rows[0]?.n ?? 0;
  return toPublicEventList({
    when: input.when,
    items: rows.rows.map(summaryOf),
    page: input.page,
    pages: Math.max(1, Math.ceil(total / input.limit)),
    total,
    countries: countries.rows.map((r) => r.country_code),
  });
}

/** events.list: the calendar (anyone). A malformed filter is BAD_REQUEST (the router's schema). */
export async function eventsList(_principal: Principal | null, raw: z.input<typeof eventsListInput> = {}): Promise<EventListDto> {
  const parsed = eventsListInput.safeParse(raw ?? {});
  if (!parsed.success) throw fieldErrors(parsed.error);
  return cachedEventList(parsed.data);
}

async function cachedEventPage(eventSlug: string): Promise<EventPageDto | null> {
  'use cache';
  cacheLife('minutes');
  const db = getPublicDb();
  const found = await db.execute<PublicRow>(sql`SELECT ${COLUMNS} FROM v_public_event v WHERE v.slug = ${eventSlug}`);
  const row = found.rows[0];
  if (!row) {
    tagCacheEntry([EVENTS_TAG]);
    return null;
  }
  const photos = await publicPhotoRefs(db, row.instructors.map((i) => i.id));
  tagCacheEntry([EVENTS_TAG, SCHOOLS_TAG, ORGANIZATIONS_TAG, ...personTags([row])]);
  return toPublicEventPage({
    ...summaryOf(row),
    id: row.id,
    description: row.description,
    venue: row.online ? null : row.venue,
    externalUrl: row.external_url,
    cancelledAt: row.cancelled_at === null ? null : iso(row.cancelled_at),
    cancellationNote: row.cancellation_note,
    school: row.school_slug && row.school_name && row.school_city ? { slug: row.school_slug, name: row.school_name, city: row.school_city } : null,
    instructors: row.instructors.map((i) => ({ slug: i.slug, name: latinName(i.display_name, i.lang), photo: photoOf(photos.get(i.id)) })),
    revision: row.revision,
    updatedAt: iso(row.updated_at),
  });
}

/** events.get: one public event (404 for a removed event, a malformed slug and none at all alike). */
export async function eventGet(_principal: Principal | null, raw: z.input<typeof eventSlugInput>): Promise<EventPageDto> {
  const parsed = eventSlugInput.safeParse(raw);
  if (!parsed.success || !slug.safeParse(parsed.data.slug).success) throw notFound();
  const page = await cachedEventPage(parsed.data.slug.trim());
  if (!page) throw notFound();
  return page;
}

// --- The organizer -----------------------------------------------------------------------------

interface OwnerRow {
  id: string;
  slug: string;
  status: 'published' | 'cancelled' | 'removed';
  organizerUserId: string | null;
  organizationId: string | null;
  startsAt: Date;
  timezone: string;
  posterStorageKey: string | null;
}

/** The organizations this account administers that are approved (whom it may publish as). */
async function administeredOrganizations(db: Executor, userId: string): Promise<{ id: string; name: string; slug: string }[]> {
  return db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organizationAdmin)
    .innerJoin(organization, eq(organization.id, organizationAdmin.organizationId))
    .where(and(eq(organizationAdmin.userId, userId), isNull(organizationAdmin.revokedAt), eq(organization.status, 'active'), isNull(organization.deletedAt)))
    .orderBy(asc(organization.name), asc(organization.id));
}

/** Whether this account may change the event: its Sifu organizer, or an admin of its organization. */
async function mayChange(db: Executor, userId: string, row: Pick<OwnerRow, 'organizerUserId' | 'organizationId'>): Promise<boolean> {
  if (row.organizationId === null) return row.organizerUserId === userId;
  // As administeredOrganizations: an approved organization that is not deleted (a suspended one's
  // events stay as they are, and nobody changes them until it is active again).
  const [admin] = await db
    .select({ id: organizationAdmin.id })
    .from(organizationAdmin)
    .innerJoin(organization, eq(organization.id, organizationAdmin.organizationId))
    .where(
      and(
        eq(organizationAdmin.organizationId, row.organizationId),
        eq(organizationAdmin.userId, userId),
        isNull(organizationAdmin.revokedAt),
        eq(organization.status, 'active'),
        isNull(organization.deletedAt),
      ),
    );
  return admin !== undefined;
}

const ownerColumns = {
  id: event.id,
  slug: event.slug,
  status: event.status,
  organizerUserId: event.organizerUserId,
  organizationId: event.organizationId,
  startsAt: event.startsAt,
  timezone: event.timezone,
  posterStorageKey: event.posterStorageKey,
};

/** The event, when this account may change it and it is not removed; 404 otherwise (one answer for all). */
async function ownEvent(db: Executor, userId: string, id: string, lock = false): Promise<OwnerRow> {
  const query = db.select(ownerColumns).from(event).where(eq(event.id, id));
  const [row] = lock ? await query.for('update') : await query;
  if (!row || row.status === 'removed' || !(await mayChange(db, userId, row))) throw notFound();
  return row as OwnerRow;
}

/** DEFAULT M17 (question 1): the account's own published events that start in `month` in their zone. */
async function publishedInMonth(db: Executor, userId: string, month: string, except: string | null): Promise<number> {
  const result = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM event
     WHERE organizer_user_id = ${userId}::uuid AND organization_id IS NULL AND status = 'published'
       AND to_char(starts_at AT TIME ZONE timezone, 'YYYY-MM') = ${month}
       AND (${except}::uuid IS NULL OR id <> ${except}::uuid)`);
  return result.rows[0]?.n ?? 0;
}

/** The refusal of the plan, as ENTITLEMENT_REQUIRED with the decision in `details` (plan §6.5). */
function entitlementError(decision: Extract<EntitlementDecision, { ok: false }>, month: string | null, message: string): ServiceError {
  return new ServiceError('ENTITLEMENT_REQUIRED', message, { startsAt: message }, { entitlement: { ...decision, key: 'events', month } });
}

/**
 * Under the quota lock of the account's `events` (the caller's READ COMMITTED transaction): whether
 * a Sifu event may be published in `month`. Throws ENTITLEMENT_REQUIRED otherwise.
 */
async function checkMonth(tx: Transaction, userId: string, month: string, except: string | null): Promise<void> {
  const subject = { kind: 'user' as const, userId };
  await lockQuota(tx, subject, 'events');
  const { plan, accountType } = await effectivePlan(subject, { db: tx });
  const used = await publishedInMonth(tx, userId, month, except);
  const decision = decide('events', plan, used);
  if (decision.ok) return;
  if (accountType === 'student') throw entitlementError(decision, month, STUDENT_CANNOT_PUBLISH);
  if (decision.code === 'quota') throw entitlementError(decision, month, monthFullMessage(decision.limit ?? 0, month, planSummary(plan).name));
  throw entitlementError(decision, month, `${planSummary(plan).name} includes no publishing of events. Professional Sifu publishes up to 2 a month.`);
}

/** An organization publishes only while it holds Federation (DEFAULT D25: then without a limit). */
async function checkOrganization(tx: Transaction, organizationId: string): Promise<void> {
  const org = await organizationPlan({ kind: 'organization', organizationId }, { db: tx });
  // DEFAULT D25: Federation's "unlimited publishing" is no limit in the pilot.
  const decision: EntitlementDecision = org.plan
    ? decide('events', org.plan, 0)
    : { ok: false, code: 'plan', plan: 'federation', limit: 0, current: 0, grantedBy: 'federation' };
  if (!decision.ok) throw entitlementError(decision, null, ORGANIZATION_NEEDS_FEDERATION);
}

interface CleanFields {
  title: string;
  kind: EventKind;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  online: boolean;
  placeId: string | null;
  venue: string | null;
  schoolId: string | null;
  externalUrl: string | null;
  instructorIds: string[];
}

/** Checks the form's values that need no organizer; times become instants in the event's zone. */
async function cleanFields(db: Executor, input: z.output<typeof eventFields>, now: Date, unchanged: { startsAt: Date; endsAt: Date } | null): Promise<CleanFields> {
  const fields: Record<string, string> = {};
  const title = oneLine(input.title);
  if (title.length < 2 || title.length > EVENT_TITLE_MAX) fields.title = FIELD_LABELS.title!;
  const description = block(input.description) || null;
  if (description && description.length > EVENT_DESCRIPTION_MAX) fields.description = FIELD_LABELS.description!;
  const venue = input.online ? null : oneLine(input.venue) || null;
  if (venue && venue.length > EVENT_VENUE_MAX) fields.venue = FIELD_LABELS.venue!;
  const externalUrl = safeUrl(input.externalUrl);
  if (externalUrl === 'bad') fields.externalUrl = FIELD_LABELS.externalUrl!;
  const instructorIds = [...new Set(input.instructorIds)];
  if (instructorIds.length > EVENT_INSTRUCTORS_MAX) fields.instructorIds = FIELD_LABELS.instructorIds!;

  // The zone: a city's own (place.timezone); an online event's (or a city without one) from the form.
  let timezone: string | null = null;
  let placeId: string | null = null;
  if (input.online) {
    if (isTimeZone(input.timezone)) timezone = input.timezone;
    else fields.timezone = 'Choose the time zone the times are in.';
  } else if (!input.placeId) {
    fields.placeId = 'Choose the city, or mark the event as online.';
  } else {
    const [city] = await db.select({ id: place.id, timezone: place.timezone }).from(place).where(eq(place.id, input.placeId));
    if (!city) fields.placeId = 'Choose the city from the list.';
    else {
      placeId = city.id;
      if (isTimeZone(city.timezone)) timezone = city.timezone;
      else if (isTimeZone(input.timezone)) timezone = input.timezone;
      else fields.timezone = 'This city has no time zone on record: choose the one the times are in.';
    }
  }

  let startsAt: Date | null = null;
  let endsAt: Date | null = null;
  if (timezone) {
    const start = wallTimeToInstant(input.startsAt, timezone);
    const end = wallTimeToInstant(input.endsAt, timezone);
    const skipped = 'The clocks skip this time when summer time starts: choose another time.';
    if (!start.ok) fields.startsAt = start.reason === 'skipped' ? skipped : FIELD_LABELS.startsAt!;
    else startsAt = start.instant;
    if (!end.ok) fields.endsAt = end.reason === 'skipped' ? skipped : FIELD_LABELS.endsAt!;
    else endsAt = end.instant;
    if (startsAt && endsAt) {
      if (endsAt.getTime() <= startsAt.getTime()) fields.endsAt = 'The end must come after the start.';
      else if (endsAt.getTime() - startsAt.getTime() > EVENT_MAX_DAYS * 86_400_000) fields.endsAt = `An event lasts at most ${EVENT_MAX_DAYS} days.`;
      const moved = !unchanged || unchanged.startsAt.getTime() !== startsAt.getTime();
      if (moved && startsAt.getTime() <= now.getTime()) fields.startsAt = 'The start must be in the future.';
    }
  }
  if (Object.keys(fields).length > 0) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
  return {
    title,
    kind: input.kind,
    description,
    startsAt: startsAt!,
    endsAt: endsAt!,
    timezone: timezone!,
    online: input.online,
    placeId,
    venue,
    schoolId: input.schoolId ?? null,
    externalUrl: externalUrl as string | null,
    instructorIds,
  };
}

/** The organizer's checks: the school is theirs (or the organization's), the instructors are public people. */
async function checkOrganizerFields(db: Executor, f: CleanFields, organizer: { userId: string; personId: string } | { organizationId: string }): Promise<void> {
  const fields: Record<string, string> = {};
  if (f.schoolId) {
    const allowed =
      'organizationId' in organizer
        ? await db
            .select({ id: organizationSchool.id })
            .from(organizationSchool)
            .innerJoin(school, and(eq(school.id, organizationSchool.schoolId), isNull(school.deletedAt)))
            .where(and(eq(organizationSchool.organizationId, organizer.organizationId), eq(organizationSchool.schoolId, f.schoolId), eq(organizationSchool.status, 'accepted')))
        : await db
            .select({ id: school.id })
            .from(school)
            .where(and(eq(school.id, f.schoolId), eq(school.createdByUserId, organizer.userId), isNull(school.deletedAt)));
    if (allowed.length === 0) fields.schoolId = 'Choose one of your schools from the list.';
  }
  if (f.instructorIds.length > 0) {
    // People of the archive: public people, and the organizer's own person.
    const own = 'personId' in organizer ? organizer.personId : null;
    const found = await db.execute<{ id: string }>(sql`
      SELECT p.id FROM v_public_person p WHERE p.id = ANY (${SQL_IDS(f.instructorIds)})
      UNION SELECT p.id FROM person p WHERE p.id = ANY (${SQL_IDS(f.instructorIds)}) AND p.id = ${own}::uuid AND p.deleted_at IS NULL`);
    if (found.rows.length !== f.instructorIds.length) fields.instructorIds = 'Choose the instructors from the list: people with a public profile.';
  }
  if (Object.keys(fields).length > 0) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
}

async function writeInstructors(tx: Transaction, eventId: string, ids: readonly string[], now: Date): Promise<void> {
  await tx.delete(eventInstructor).where(eq(eventInstructor.eventId, eventId));
  if (ids.length > 0) await tx.insert(eventInstructor).values(ids.map((personId, position) => ({ eventId, personId, position, createdAt: now, updatedAt: now })));
}

function changed(): void {
  invalidatePublic([EVENTS_TAG], 'procedure');
}

/** Queues the notices of a change (DEFAULT M17, question 3), in the change's transaction. */
async function queueNotices(tx: Transaction, eventId: string, change: 'published' | 'cancelled'): Promise<void> {
  // The singleton key keeps one job per event and change while it waits; the unique index of
  // notification keeps one notice per person even when the job runs again.
  await enqueue(tx, QUEUE.eventsNotify, { eventId, change }, { singletonKey: `event:${eventId}:${change}` });
}

export interface CreatedEvent {
  id: string;
  slug: string;
}

/**
 * events.create: published at once (DEFAULT M17, question 2). As the account's own Sifu events
 * (with its person) or, with `organizationId`, as an approved organization it administers.
 */
export async function createEvent(principal: Principal | null, raw: z.input<typeof eventCreateInput>, meta: RequestMeta): Promise<CreatedEvent> {
  const p = requireUser(principal);
  const parsed = eventCreateInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  const now = new Date();
  const f = await cleanFields(db, input, now, null);
  let organizer: { userId: string; personId: string } | { organizationId: string };
  if (input.organizationId) {
    const orgs = await administeredOrganizations(db, p.user.id);
    if (!orgs.some((o) => o.id === input.organizationId)) {
      throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { organizationId: 'Choose an organization you administer.' });
    }
    organizer = { organizationId: input.organizationId };
  } else {
    const [own] = await db.select({ id: person.id }).from(person).where(and(eq(person.claimedByUserId, p.user.id), isNull(person.deletedAt)));
    if (!own) throw new ServiceError('NOT_FOUND', NO_PROFILE);
    organizer = { userId: p.user.id, personId: own.id };
  }
  await checkOrganizerFields(db, f, organizer);
  const month = monthKey(f.startsAt, f.timezone);
  const created = await db.transaction(async (tx) => {
    // A form sent twice (a double tap, a resent request) publishes once: the copy that comes after
    // the first one's commit finds it (under the same quota lock) instead of a full month.
    const sameAs = () =>
      tx
      .select({ id: event.id, slug: event.slug })
      .from(event)
      .where(
        and(
          eq(event.createdByUserId, p.user.id),
          eq(event.title, f.title),
          eq(event.startsAt, f.startsAt),
          eq(event.status, 'published'),
          sql`${event.createdAt} > now() - interval '2 minutes'`,
          'organizationId' in organizer ? eq(event.organizationId, organizer.organizationId) : isNull(event.organizationId),
        ),
      );
    try {
      if ('organizationId' in organizer) await checkOrganization(tx, organizer.organizationId);
      else await checkMonth(tx, organizer.userId, month, null);
    } catch (error) {
      const [earlier] = error instanceof ServiceError && error.code === 'ENTITLEMENT_REQUIRED' ? await sameAs() : [];
      if (earlier) return { ...earlier, duplicate: true };
      throw error;
    }
    const [same] = await sameAs();
    if (same) return { ...same, duplicate: true };
    const id = uuidv7();
    // The random suffix (24 bits) makes a taken slug rare; a taken one is drawn again, never a 500.
    let eventSlug = newSlug(f.title);
    for (let i = 0; i < 5; i++) {
      const [taken] = await tx.select({ id: event.id }).from(event).where(eq(event.slug, eventSlug));
      if (!taken) break;
      eventSlug = newSlug(f.title);
    }
    await tx.insert(event).values({
      id,
      slug: eventSlug,
      title: f.title,
      kind: f.kind,
      description: f.description,
      startsAt: f.startsAt,
      endsAt: f.endsAt,
      timezone: f.timezone,
      online: f.online,
      placeId: f.placeId,
      venue: f.venue,
      schoolId: f.schoolId,
      externalUrl: f.externalUrl,
      organizerUserId: 'userId' in organizer ? organizer.userId : null,
      organizerPersonId: 'personId' in organizer ? organizer.personId : null,
      organizationId: 'organizationId' in organizer ? organizer.organizationId : null,
      createdByUserId: p.user.id,
      status: 'published',
      createdAt: now,
      updatedAt: now,
    });
    await writeInstructors(tx, id, f.instructorIds, now);
    await writeAudit(tx, {
      action: 'event.create',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'event',
      subjectId: id,
      after: {
        kind: f.kind,
        month,
        online: f.online,
        organizationId: 'organizationId' in organizer ? organizer.organizationId : null,
        instructors: f.instructorIds.length,
        school: f.schoolId !== null,
      },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    await queueNotices(tx, id, 'published');
    return { id, slug: eventSlug, duplicate: false };
  });
  if (!created.duplicate) changed();
  return { id: created.id, slug: created.slug };
}

/** events.update: the organizer changes the event; a move to another month counts again (DEFAULT M17, question 1). */
export async function updateEvent(principal: Principal | null, raw: z.input<typeof eventUpdateInput>, meta: RequestMeta): Promise<CreatedEvent> {
  const p = requireUser(principal);
  const parsed = eventUpdateInput.safeParse(raw);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === 'id')) throw notFound();
    throw fieldErrors(parsed.error);
  }
  const input = parsed.data;
  const db = getDb();
  const seen = await ownEvent(db, p.user.id, input.id);
  if (seen.status === 'cancelled') throw new ServiceError('CONFLICT', CANCELLED_NO_CHANGE);
  const [current] = await db.select({ startsAt: event.startsAt, endsAt: event.endsAt, organizerPersonId: event.organizerPersonId }).from(event).where(eq(event.id, seen.id));
  const f = await cleanFields(db, input, new Date(), current ?? null);
  const organizer = seen.organizationId ? { organizationId: seen.organizationId } : { userId: p.user.id, personId: current!.organizerPersonId! };
  await checkOrganizerFields(db, f, organizer);
  const month = monthKey(f.startsAt, f.timezone);
  const before = monthKey(seen.startsAt, seen.timezone);
  await db.transaction(async (tx) => {
    // The quota lock first (as events.create), then the event's row.
    if (!seen.organizationId && month !== before) await checkMonth(tx, p.user.id, month, seen.id);
    const row = await ownEvent(tx, p.user.id, seen.id, true);
    if (row.status !== 'published') throw new ServiceError('CONFLICT', CANCELLED_NO_CHANGE);
    // Another change moved it in the meantime: the month read before (and checked, or kept) is no
    // longer the event's, so this change would write a month whose allowance nobody counted.
    if (!row.organizationId && monthKey(row.startsAt, row.timezone) !== before) {
      throw new ServiceError('CONFLICT', 'The event changed in the meantime. Reload the page and try again.');
    }
    const now = new Date();
    await tx
      .update(event)
      .set({
        title: f.title,
        kind: f.kind,
        description: f.description,
        startsAt: f.startsAt,
        endsAt: f.endsAt,
        timezone: f.timezone,
        online: f.online,
        placeId: f.placeId,
        venue: f.venue,
        schoolId: f.schoolId,
        externalUrl: f.externalUrl,
        revision: sql`${event.revision} + 1`,
        updatedAt: now,
      })
      .where(eq(event.id, row.id));
    await writeInstructors(tx, row.id, f.instructorIds, now);
    await writeAudit(tx, {
      action: 'event.update',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'event',
      subjectId: row.id,
      before: { month: before },
      after: { kind: f.kind, month, online: f.online, instructors: f.instructorIds.length, school: f.schoolId !== null },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
  });
  changed();
  return { id: seen.id, slug: seen.slug };
}

/** events.cancel: the organizer's; the event stays shown as cancelled, with an optional note. */
export async function cancelEvent(principal: Principal | null, raw: z.input<typeof eventCancelInput>, meta: RequestMeta): Promise<{ id: string; slug: string; cancelled: boolean }> {
  const p = requireUser(principal);
  const parsed = eventCancelInput.safeParse(raw);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === 'id')) throw notFound();
    throw fieldErrors(parsed.error);
  }
  const note = block(parsed.data.note) || null;
  if (note && note.length > EVENT_REASON_MAX) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { note: FIELD_LABELS.note! });
  const db = getDb();
  await ownEvent(db, p.user.id, parsed.data.id);
  const outcome = await db.transaction(async (tx) => {
    const row = await ownEvent(tx, p.user.id, parsed.data.id, true);
    if (row.status === 'cancelled') return { row, cancelled: false };
    const now = new Date();
    await tx
      .update(event)
      .set({ status: 'cancelled', cancelledAt: now, cancelledByUserId: p.user.id, cancellationNote: note, revision: sql`${event.revision} + 1`, updatedAt: now })
      .where(eq(event.id, row.id));
    await writeAudit(tx, {
      action: 'event.cancel',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'event',
      subjectId: row.id,
      before: { status: row.status },
      after: { status: 'cancelled', note: note === null ? 'none' : 'set' },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    await queueNotices(tx, row.id, 'cancelled');
    return { row, cancelled: true };
  });
  if (outcome.cancelled) changed();
  return { id: outcome.row.id, slug: outcome.row.slug, cancelled: outcome.cancelled };
}

/** events.remove: staff with a verified second factor, with a reason (audited). Removed is 404 everywhere. */
export async function removeEvent(
  principal: Principal | null,
  raw: z.input<typeof eventRemoveInput>,
  meta: RequestMeta,
  store: ObjectStore = getPhotoStore(),
): Promise<{ id: string; removed: boolean }> {
  const p = requireStaff2FA(principal);
  const parsed = eventRemoveInput.safeParse(raw);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === 'id')) throw notFound();
    throw fieldErrors(parsed.error);
  }
  const reason = block(parsed.data.reason);
  const message = 'Say why the event is removed: the reason is kept in the audit log.';
  if (reason.length === 0) throw new ServiceError('BAD_REQUEST', message, { reason: message });
  if (reason.length > EVENT_REASON_MAX) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { reason: FIELD_LABELS.reason! });
  const removed = await getDb().transaction(async (tx) => {
    const [row] = await tx.select(ownerColumns).from(event).where(eq(event.id, parsed.data.id)).for('update');
    if (!row) throw notFound();
    if (row.status === 'removed') return { row, removed: false };
    const now = new Date();
    await tx
      .update(event)
      .set({
        status: 'removed',
        removedAt: now,
        removedByUserId: p.user.id,
        removalReason: reason,
        posterStorageKey: null,
        posterSha256: null,
        posterWidth: null,
        posterHeight: null,
        posterSizeBytes: null,
        revision: sql`${event.revision} + 1`,
        updatedAt: now,
      })
      .where(eq(event.id, row.id));
    await writeAudit(tx, {
      action: 'event.remove',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'event',
      subjectId: row.id,
      before: { status: row.status },
      after: { status: 'removed' },
      reason,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { row, removed: true };
  });
  if (removed.removed) {
    if (removed.row.posterStorageKey) await deleteFiles(store, removed.row.posterStorageKey, removed.row.id);
    changed();
  }
  return { id: removed.row.id, removed: removed.removed };
}

// --- The poster ------------------------------------------------------------------------------------

/**
 * events.uploadPoster: the poster of the organizer's event, replacing the old one. Processed as a
 * gallery photo (src/server/storage/photo.ts): decoded, turned upright and encoded again as WebP
 * without any metadata (no EXIF and its GPS position, no XMP, IPTC or ICC). Apart from every gallery
 * and every allowance.
 */
export async function uploadEventPoster(
  principal: Principal | null,
  raw: z.input<typeof eventPosterUploadInput>,
  meta: RequestMeta,
  store: ObjectStore = getPhotoStore(),
): Promise<{ id: string; poster: EventPosterDto }> {
  const p = requireUser(principal);
  const parsed = eventPosterUploadInput.safeParse(raw);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === 'id')) throw notFound();
    throw fieldErrors(parsed.error);
  }
  const seen = await ownEvent(getDb(), p.user.id, parsed.data.id);
  if (seen.status === 'cancelled') throw new ServiceError('CONFLICT', CANCELLED_NO_CHANGE);
  const bytes = await fileBytes(parsed.data.file);
  let rendered: Awaited<ReturnType<typeof renderGalleryPhoto>>;
  try {
    rendered = await renderGalleryPhoto(bytes);
  } catch (error) {
    if (error instanceof PhotoRefused) {
      const { code, message } = refusalMessage(error);
      throw new ServiceError(code, message, { file: message });
    }
    throw error;
  }
  const full = rendered.full;
  const content = sha256(full.bytes);
  const key = newStorageKey('photos');
  let previous: string | null = null;
  try {
    await putRenditions(store, key, rendered);
    previous = await getDb().transaction(async (tx) => {
      const row = await ownEvent(tx, p.user.id, seen.id, true);
      if (row.status !== 'published') throw new ServiceError('CONFLICT', CANCELLED_NO_CHANGE);
      await tx
        .update(event)
        .set({
          posterStorageKey: key,
          posterSha256: content,
          posterWidth: full.width,
          posterHeight: full.height,
          posterSizeBytes: full.bytes.byteLength,
          revision: sql`${event.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(event.id, row.id));
      await writeAudit(tx, {
        action: 'event.poster_upload',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'event',
        subjectId: row.id,
        before: { poster: row.posterStorageKey !== null },
        after: { width: full.width, height: full.height, sizeBytes: full.bytes.byteLength, sha256: content },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      return row.posterStorageKey;
    });
  } catch (error) {
    await deleteFiles(store, key, seen.id);
    throw error;
  }
  if (previous) await deleteFiles(store, previous, seen.id);
  changed();
  return { id: seen.id, poster: posterDto(seen.id, content, full.width, full.height)! };
}

/** events.removePoster: the organizer's; the files go. */
export async function removeEventPoster(
  principal: Principal | null,
  raw: z.input<typeof eventIdInput>,
  meta: RequestMeta,
  store: ObjectStore = getPhotoStore(),
): Promise<{ id: string; removed: boolean }> {
  const p = requireUser(principal);
  const parsed = eventIdInput.safeParse(raw);
  if (!parsed.success) throw notFound();
  const db = getDb();
  await ownEvent(db, p.user.id, parsed.data.id);
  const key = await db.transaction(async (tx) => {
    const row = await ownEvent(tx, p.user.id, parsed.data.id, true);
    if (!row.posterStorageKey) return null;
    await tx
      .update(event)
      .set({ posterStorageKey: null, posterSha256: null, posterWidth: null, posterHeight: null, posterSizeBytes: null, revision: sql`${event.revision} + 1`, updatedAt: new Date() })
      .where(eq(event.id, row.id));
    await writeAudit(tx, {
      action: 'event.poster_remove',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'event',
      subjectId: row.id,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return row.posterStorageKey;
  });
  if (key) {
    await deleteFiles(store, key, parsed.data.id);
    changed();
  }
  return { id: parsed.data.id, removed: key !== null };
}

/**
 * One rendition for GET /api/event-posters/<id>/<hash>/<size>.webp: the poster of an event the
 * public sees (v_public_event) for everyone; of a removed one for nobody. The read rules of the
 * photo routes (photos.ts): the whole rendition within the deadline, a matching ETag answered
 * without reading the store; null (404) for everything else, one answer for all.
 */
export async function openEventPoster(
  _principal: Principal | null,
  address: { id: string; hash: string; file: string },
  store: ObjectStore = getPhotoStore(),
  options: OpenPhotoOptions = {},
): Promise<PhotoFile | null> {
  if (!PHOTO_ADDRESS.id.safeParse(address.id).success || !PHOTO_ADDRESS.hash.safeParse(address.hash).success || !PHOTO_ADDRESS.file.safeParse(address.file).success) return null;
  const [row] = await getDb()
    .select({ key: event.posterStorageKey, sha: event.posterSha256, status: event.status })
    .from(event)
    .where(eq(event.id, address.id));
  if (!row || !row.key || !row.sha || !row.sha.startsWith(address.hash)) return null;
  const shown = await getPublicDb().execute(sql`SELECT 1 AS one FROM v_public_event WHERE id = ${address.id}::uuid`);
  if (shown.rows.length === 0) return null;
  if (etagMatches(options.ifNoneMatch, photoEtag(row.sha))) return { notModified: true, sha256: row.sha, public: true };
  const bytes = await readObjectBytes(store, renditionFile(row.key, address.file, true), {
    timeoutMs: options.timeoutMs ?? PHOTO_READ_TIMEOUT_MS,
    maxBytes: PHOTO_RENDITION_MAX_BYTES,
    signal: options.signal,
  });
  if (!bytes) return null;
  return { notModified: false, bytes, sha256: row.sha, public: true };
}

// --- The dashboard ---------------------------------------------------------------------------------

export interface MyEventItem {
  id: string;
  slug: string;
  title: string;
  kindLabel: string;
  status: 'published' | 'cancelled' | 'removed';
  statusLabel: string;
  /** "Saturday 13 March 2027, 10:00–17:00" in the event's zone, and the zone. */
  when: string;
  zone: string;
  startsAt: string;
  upcoming: boolean;
  place: string;
  /** Null for the account's own events; the organization's name otherwise. */
  organizationName: string | null;
  poster: EventPosterDto | null;
  canChange: boolean;
}

export interface MonthAllowance {
  month: string;
  label: string;
  used: number;
  limit: number | null;
  remaining: number | null;
}

export interface MyEvents {
  accountType: 'student' | 'sifu';
  hasProfile: boolean;
  /** Whom the account may publish as: itself (a Sifu with a profile) and its approved organizations. */
  publishAs: { kind: 'self' | 'organization'; id: string | null; name: string; canPublish: boolean; note: string | null }[];
  /** The plan of the account's own events and what is left of this month and of every month it has events in. */
  allowance: { planName: string; limit: number | null; included: boolean; months: MonthAllowance[]; sentence: string } | null;
  /** Only at the real limit of a plan without publishing (Free Sifu): the upgrade prompt (only 'now' benefits). */
  upgrade: UpgradeOffer | null;
  events: MyEventItem[];
}

const STATUS_LABELS = { published: 'Published', cancelled: 'Cancelled', removed: 'Removed by a moderator' } as const;

/** events.mine: the signed-in account's events, whom it may publish as and its allowance. */
export async function myEvents(principal: Principal | null): Promise<MyEvents> {
  const p = requireUser(principal);
  const db = getDb();
  const now = new Date();
  const [own] = await db.select({ id: person.id }).from(person).where(and(eq(person.claimedByUserId, p.user.id), isNull(person.deletedAt)));
  const subject = { kind: 'user' as const, userId: p.user.id };
  const { plan, accountType } = await effectivePlan(subject, { db });
  const orgs = await administeredOrganizations(db, p.user.id);
  const orgPlans = await Promise.all(orgs.map((o) => organizationPlan({ kind: 'organization', organizationId: o.id }, { db })));
  const rows = await db
    .select({
      id: event.id,
      slug: event.slug,
      title: event.title,
      kind: event.kind,
      status: event.status,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: event.timezone,
      online: event.online,
      city: place.name,
      countryCode: place.countryCode,
      organizationId: event.organizationId,
      organizerUserId: event.organizerUserId,
      posterSha256: event.posterSha256,
      posterWidth: event.posterWidth,
      posterHeight: event.posterHeight,
    })
    .from(event)
    .leftJoin(place, eq(place.id, event.placeId))
    .where(
      or(
        and(eq(event.organizerUserId, p.user.id), isNull(event.organizationId)),
        orgs.length > 0 ? inArray(event.organizationId, orgs.map((o) => o.id)) : sql`false`,
      ),
    )
    .orderBy(desc(event.startsAt), asc(event.id))
    .limit(MY_EVENTS_LIMIT);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const events: MyEventItem[] = rows.map((r) => {
    const when = formatEventWhen(r.startsAt, r.endsAt, r.timezone);
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      kindLabel: EVENT_KIND_LABELS[r.kind],
      status: r.status,
      statusLabel: STATUS_LABELS[r.status],
      when: when.text,
      zone: when.zone,
      startsAt: r.startsAt.toISOString(),
      upcoming: r.endsAt.getTime() > now.getTime(),
      place: r.online ? 'Online' : `${r.city ?? 'A city'}, ${r.countryCode ?? ''}`.replace(/, $/, ''),
      organizationName: r.organizationId ? (orgName.get(r.organizationId) ?? 'An organization') : null,
      poster: posterDto(r.id, r.posterSha256, r.posterWidth, r.posterHeight),
      canChange: r.status === 'published',
    };
  });

  const value = feature('events').values[plan];
  const limit = value.limit === undefined ? null : value.limit;
  const sifu = accountType === 'sifu';
  let allowance: MyEvents['allowance'] = null;
  let upgrade: UpgradeOffer | null = null;
  if (sifu) {
    const planName = planSummary(plan).name;
    // The month that is still current somewhere (UTC−12, the earliest zone): an event of that month
    // in a zone still in it is shown, whatever the month in UTC (DEFAULT M17, question 1).
    const thisMonth = monthKey(now, 'Etc/GMT+12');
    const counts = new Map<string, number>([[thisMonth, 0]]);
    for (const r of rows) {
      if (r.organizationId !== null || r.status !== 'published') continue;
      const key = monthKey(r.startsAt, r.timezone);
      if (key >= thisMonth) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const months = [...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, used]) => ({ month, label: monthLabel(month), used, limit, remaining: limit === null ? null : Math.max(0, limit - used) }));
    const sentence = !value.included
      ? `${planName} includes no publishing of events.`
      : limit === null
        ? `On ${planName} you publish events without a set limit.`
        : `On ${planName} you publish up to ${limit} events that start in each calendar month, counted in each event's own time zone. A cancelled event frees its place.`;
    allowance = { planName, limit, included: value.included, months, sentence };
    // Only at the real limit (plan §5.6): a plan without publishing, and a higher plan of the pilot that has it.
    const decision = decide('events', plan, 0);
    if (!decision.ok && decision.grantedBy) {
      const from = planSummary(decision.plan);
      const to = planSummary(decision.grantedBy);
      upgrade = {
        feature: 'events',
        heading: (feature('events').upgradeHeading ?? 'More with {plan}').replace('{plan}', to.name),
        allowance: { current: 0, limit: 0, sentence: `On ${from.name} you can browse the calendar but not publish. ${to.name} publishes up to 2 events a month.` },
        from,
        to,
        benefits: upgradeBenefits(decision.plan, decision.grantedBy, 'events'),
        waiting: null,
        pilotRequest: await openPilotRequest(db, p.user.id),
      };
    }
  }
  const publishAs: MyEvents['publishAs'] = [];
  if (sifu && own) {
    publishAs.push({
      kind: 'self',
      id: null,
      name: 'Yourself',
      canPublish: value.included,
      note: value.included ? null : `${planSummary(plan).name} includes no publishing of events.`,
    });
  }
  orgs.forEach((o, i) => {
    const has = orgPlans[i]!.plan === 'federation';
    publishAs.push({ kind: 'organization', id: o.id, name: o.name, canPublish: has, note: has ? null : ORGANIZATION_NEEDS_FEDERATION });
  });
  return { accountType, hasProfile: own !== undefined, publishAs, allowance, upgrade, events };
}

// --- The form's options ----------------------------------------------------------------------------

export interface EventEditorPlace extends PlaceHit {
  found: boolean;
}

export interface EventEditor {
  /** The event being edited, its values in its own zone; null for a new one. */
  event: {
    id: string;
    slug: string;
    title: string;
    kind: EventKind;
    description: string | null;
    startsAt: string;
    endsAt: string;
    timezone: string;
    online: boolean;
    placeId: string | null;
    venue: string | null;
    schoolId: string | null;
    externalUrl: string | null;
    instructorIds: string[];
    organizationId: string | null;
    organizationName: string | null;
    status: 'published' | 'cancelled';
    poster: EventPosterDto | null;
  } | null;
  places: EventEditorPlace[];
  kinds: { key: EventKind; label: string }[];
  /** Schools the event may name: the account's own listings, and each organization's accepted links. */
  schools: { id: string; name: string; organizationId: string | null }[];
  /** People of the archive the form offers: you, your confirmed students and teachers, your schools' instructors, your organizations' members. */
  instructorOptions: { id: string; label: string; self: boolean }[];
  timezones: string[];
}

/** Every zone the platform knows, UTC first. */
function zones(): string[] {
  const list = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return ['UTC', ...list.filter((z) => z !== 'UTC')];
}

/** events.editor: what the event form offers; `id` loads one of the account's events (404 for any other). */
export async function eventEditor(principal: Principal | null, raw: z.input<typeof eventEditorInput> = {}): Promise<EventEditor> {
  const p = requireUser(principal);
  const parsed = eventEditorInput.safeParse(raw ?? {});
  if (!parsed.success) throw notFound();
  const db = getDb();
  let current: EventEditor['event'] = null;
  if (parsed.data.id) {
    const seen = await ownEvent(db, p.user.id, parsed.data.id);
    const [r] = await db
      .select({
        id: event.id,
        slug: event.slug,
        title: event.title,
        kind: event.kind,
        description: event.description,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timezone: event.timezone,
        online: event.online,
        placeId: event.placeId,
        venue: event.venue,
        schoolId: event.schoolId,
        externalUrl: event.externalUrl,
        organizationId: event.organizationId,
        organizationName: organization.name,
        status: event.status,
        posterSha256: event.posterSha256,
        posterWidth: event.posterWidth,
        posterHeight: event.posterHeight,
      })
      .from(event)
      .leftJoin(organization, eq(organization.id, event.organizationId))
      .where(eq(event.id, seen.id));
    const instructors = await db.select({ id: eventInstructor.personId }).from(eventInstructor).where(eq(eventInstructor.eventId, seen.id)).orderBy(asc(eventInstructor.position));
    current = {
      ...r!,
      status: r!.status as 'published' | 'cancelled',
      startsAt: toWallTime(r!.startsAt, r!.timezone),
      endsAt: toWallTime(r!.endsAt, r!.timezone),
      instructorIds: instructors.map((i) => i.id),
      poster: posterDto(r!.id, r!.posterSha256, r!.posterWidth, r!.posterHeight),
    };
  }
  const query = parsed.data.city?.trim() || null;
  const found = query ? await searchPlaces(db, query) : [];
  const listed = await listedPlaces(db, current?.placeId ?? null);
  const seenIds = new Set(found.map((f) => f.id));
  const places: EventEditorPlace[] = [...found.map((f) => ({ ...f, found: true })), ...listed.filter((l) => !seenIds.has(l.id)).map((l) => ({ ...l, found: false }))];

  const [own] = await db.select({ id: person.id }).from(person).where(and(eq(person.claimedByUserId, p.user.id), isNull(person.deletedAt)));
  const orgs = await administeredOrganizations(db, p.user.id);
  const orgIds = orgs.map((o) => o.id);
  const ownSchools = await db
    .select({ id: school.id, name: school.name })
    .from(school)
    .where(and(eq(school.createdByUserId, p.user.id), isNull(school.deletedAt)))
    .orderBy(asc(school.name));
  const orgSchools =
    orgIds.length === 0
      ? []
      : await db
          .select({ id: school.id, name: school.name, organizationId: organizationSchool.organizationId })
          .from(organizationSchool)
          .innerJoin(school, and(eq(school.id, organizationSchool.schoolId), isNull(school.deletedAt)))
          .where(and(inArray(organizationSchool.organizationId, orgIds), eq(organizationSchool.status, 'accepted')))
          .orderBy(asc(school.name));
  const people = await db.execute<{ id: string; display_name: string }>(sql`
    SELECT DISTINCT p.id, p.display_name FROM v_public_person p
     WHERE p.id IN (
       SELECT r.student_person_id FROM teaching_relationship r WHERE r.teacher_person_id = ${own?.id ?? null}::uuid
          AND r.status IN (${sql.join(PUBLIC_RELATIONSHIP_STATUSES.map((s) => sql`${s}`), sql`, `)})
       UNION SELECT r.teacher_person_id FROM teaching_relationship r WHERE r.student_person_id = ${own?.id ?? null}::uuid
          AND r.status IN (${sql.join(PUBLIC_RELATIONSHIP_STATUSES.map((s) => sql`${s}`), sql`, `)})
       UNION SELECT si.person_id FROM school_instructor si JOIN school s ON s.id = si.school_id
          WHERE s.created_by_user_id = ${p.user.id}::uuid AND s.deleted_at IS NULL
       UNION SELECT m.person_id FROM organization_membership m
          WHERE ${orgIds.length > 0 ? sql`m.organization_id = ANY (${SQL_IDS(orgIds)})` : sql`false`}
            AND (m.ends_on IS NULL OR m.ends_on > current_date)
       UNION SELECT ei.person_id FROM event_instructor ei WHERE ei.event_id = ${current?.id ?? null}::uuid
     )
       AND p.id IS DISTINCT FROM ${own?.id ?? null}::uuid
     ORDER BY p.display_name, p.id
     LIMIT 300`);
  const ownName = own
    ? (await db.execute<{ value: string | null }>(sql`SELECT (SELECT pn.value FROM person_name pn WHERE pn.person_id = ${own.id}::uuid AND pn.is_primary LIMIT 1) AS value`)).rows[0]?.value
    : null;
  const instructorOptions = [
    ...(own ? [{ id: own.id, label: `${ownName ?? 'You'} (you)`, self: true }] : []),
    ...people.rows.map((r) => ({ id: r.id, label: r.display_name, self: false })),
  ];
  return {
    event: current,
    places,
    kinds: EVENT_KINDS.map((key) => ({ key, label: EVENT_KIND_LABELS[key] })),
    schools: [...ownSchools.map((s) => ({ ...s, organizationId: null })), ...orgSchools],
    instructorOptions,
    timezones: zones(),
  };
}

/** Whether the principal is staff with a verified second factor (the event page's "Remove" form). */
export function canModerateEvents(principal: Principal | null): boolean {
  return hasStaff2FA(principal);
}
