// The school listing review (milestone M11, In scope 2; the queue of M10a, kind school_listing).
// review.ts lists, shows and assigns these cases with the others; this module adds what is their
// own: the school on the case card and the three decisions.
//
//   verify      approve the listing: the school becomes active (its pin shows while the account
//               that listed it holds Professional Sifu, DEFAULT D08/D18) and last_activity_at moves
//               (D17); audit school.publish and review.resolve. On a listed school whose edit
//               reopened the review (schools.update, RE_REVIEWED_CHANGES), the school stays as it
//               is: listed with the edit.
//   reject      return it to draft, with the reason the Sifu reads; audit school.return and
//               review.resolve. On a listed school, this takes the listing off the map.
//   needs_info  ask the Sifu a question; the case waits until they send the listing again
//
// The version (M11 review, code-4): the case card carries the school's version (its updated_at,
// in microseconds), and a decision sends it back. A school edited since the reviewer loaded the
// card is refused with CONFLICT: nobody approves details they did not see. An approval without a
// version is refused too (BAD_REQUEST).
//
// Who: a moderator or an administrator approves or returns a listing (DEFAULT: listings are a
// moderation task, plan §6.7 gives moderators the public content); any reviewer may take the case,
// ask and add notes. Nobody reviews their own listing. The order of the locks is the school, then
// its case, the order schools.submit takes them.
//
// Idempotency: each decision writes a review_note with its request key (the reason, the question,
// or "Listing approved."); the same key again with the same decision is a replay, with another one
// a conflict. The case card never shows the exact point of a city_only school: only its city.

import { and, eq, sql } from 'drizzle-orm';

import { writeAudit } from '../audit';
import { hasStaff2FA, requireStaff2FA } from '../auth/guards';
import type { Principal, StaffRole } from '../auth/principal';
import { invalidatePublic, SCHOOLS_TAG } from '../cache';
import { getDb } from '../db';
import { notification, place, reviewCase, reviewNote, school } from '../db/schema';
import { OPEN_REVIEW_CASE_STATUSES } from '../db/schema/common';
import type { GeoPointDto } from '../dto/schools';
import { type Executor, requireEntitlement } from '../entitlements/access';
import type { RequestMeta } from './context';
import { peopleRefs, type PersonRef } from './dashboard';
import { pgErrorOf, ServiceError } from './errors';
import { DECIDERS } from './review-core';
import { keyReused } from './relationships';
import { LOCATION_LABELS, SCHOOL_FORM_LABELS, SCHOOL_ROLE_LABELS } from './schools';

/** The roles that approve or return a school listing. */
export const LISTING_DECIDE_ROLES: readonly StaffRole[] = DECIDERS.school_listing;
const APPROVED_NOTE = 'Listing approved.';

export interface SchoolCaseView {
  id: string;
  slug: string;
  name: string;
  city: string;
  countryCode: string;
  status: string;
  locationPrivacy: 'exact' | 'city_only';
  locationLabel: string;
  /** The point that becomes public: only for an exact location; null for city only (it stays private). */
  point: GeoPointDto | null;
  websiteUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  description: string | null;
  forms: string[];
  instructors: { person: PersonRef; roleLabel: string }[];
  /** Whether the account that listed it holds Professional Sifu now: the pin shows once approved. */
  pinAllowed: boolean;
  /** The version of the details on the card (updated_at in microseconds): a decision sends it back. */
  version: string;
}

/** A school's version: its updated_at in whole microseconds since 1970, as text (exact). */
const VERSION = sql<string>`(extract(epoch from ${school.updatedAt}) * 1000000)::bigint::text`;

/** The school of a listing case, as the case card shows it. */
export async function schoolCaseView(db: Executor, schoolId: string): Promise<SchoolCaseView | null> {
  const [row] = await db
    .select({
      id: school.id,
      slug: school.slug,
      name: school.name,
      city: place.name,
      countryCode: place.countryCode,
      status: school.status,
      locationPrivacy: school.locationPrivacy,
      // public_point is the exact point only for an exact location (the trigger keeps the centroid for city only).
      lat: sql<number>`ST_Y(${school.publicPoint}::geometry)`,
      lng: sql<number>`ST_X(${school.publicPoint}::geometry)`,
      websiteUrl: school.websiteUrl,
      contactEmail: school.contactEmail,
      contactPhone: school.contactPhone,
      description: school.description,
      formsTaught: school.formsTaught,
      createdByUserId: school.createdByUserId,
      version: VERSION,
    })
    .from(school)
    .innerJoin(place, eq(place.id, school.placeId))
    .where(eq(school.id, schoolId));
  if (!row) return null;
  const instructors = await db.execute<{ person_id: string; role: keyof typeof SCHOOL_ROLE_LABELS }>(sql`
    SELECT person_id, role FROM school_instructor WHERE school_id = ${schoolId}::uuid
     ORDER BY CASE role WHEN 'head_instructor' THEN 0 WHEN 'instructor' THEN 1 ELSE 2 END, person_id`);
  const refs = await peopleRefs(instructors.rows.map((i) => i.person_id));
  const pinAllowed = row.createdByUserId ? (await requireEntitlement({ kind: 'user', userId: row.createdByUserId }, 'school_map', { db })).ok : true;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    city: row.city,
    countryCode: row.countryCode,
    status: row.status,
    locationPrivacy: row.locationPrivacy,
    locationLabel: LOCATION_LABELS[row.locationPrivacy],
    point: row.locationPrivacy === 'exact' ? { lat: Math.round(row.lat * 1e5) / 1e5, lng: Math.round(row.lng * 1e5) / 1e5 } : null,
    websiteUrl: row.websiteUrl,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    description: row.description,
    forms: row.formsTaught.map((f) => SCHOOL_FORM_LABELS[f]),
    instructors: instructors.rows.flatMap((i) => {
      const person = refs.get(i.person_id);
      return person ? [{ person, roleLabel: SCHOOL_ROLE_LABELS[i.role] }] : [];
    }),
    pinAllowed,
    version: row.version,
  };
}

/** The schools of these listing cases, for the queue's rows: name, city and country. */
export async function schoolRowsOf(db: Executor, schoolIds: readonly string[]): Promise<Map<string, { name: string; city: string; countryCode: string }>> {
  const out = new Map<string, { name: string; city: string; countryCode: string }>();
  if (schoolIds.length === 0) return out;
  const result = await db.execute<{ id: string; name: string; city: string; country_code: string }>(sql`
    SELECT s.id, s.name, p.name AS city, p.country_code FROM school s JOIN place p ON p.id = s.place_id
     WHERE s.id = ANY (${sql`ARRAY[${sql.join(schoolIds.map((id) => sql`${id}::uuid`), sql`, `)}]`})`);
  for (const r of result.rows) out.set(r.id, { name: r.name, city: r.city, countryCode: r.country_code });
  return out;
}

/** Locks a listing case's school, then the case (the order schools.submit takes them). */
export async function lockListing(tx: Executor, schoolId: string): Promise<{ status: string; createdByUserId: string | null; version: string } | null> {
  const [row] = await tx.select({ status: school.status, createdByUserId: school.createdByUserId, version: VERSION }).from(school).where(eq(school.id, schoolId)).for('update');
  return row ?? null;
}

export interface ListingDecision {
  caseId: string;
  decision: 'verify' | 'reject' | 'needs_info';
  reason: string | null;
  idempotencyKey: string;
  /** The version of the school on the card the reviewer decided from (SchoolCaseView.version). */
  schoolVersion?: string | null | undefined;
}

/** The school statuses a listing case is decided on: a new listing, or a listed school's edit. */
const DECIDABLE = ['pending_review', 'active'];
export const isDecidableListing = (schoolStatus: string | null | undefined) => schoolStatus != null && DECIDABLE.includes(schoolStatus);

const isOpen = (status: string) => (OPEN_REVIEW_CASE_STATUSES as readonly string[]).includes(status);

/** review.decide on a school_listing case (see the top of this file). Returns whether it was a replay. */
export async function decideSchoolListing(principal: Principal | null, input: ListingDecision, meta: RequestMeta): Promise<boolean> {
  const p = requireStaff2FA(principal);
  const admin = hasStaff2FA(p, ['admin']);
  const db = getDb();
  const body = input.decision === 'verify' ? (input.reason ?? APPROVED_NOTE) : input.reason!;
  try {
    const outcome = await db.transaction(async (tx) => {
      const [seen] = await tx.select({ schoolId: reviewCase.schoolId }).from(reviewCase).where(and(eq(reviewCase.id, input.caseId), eq(reviewCase.kind, 'school_listing')));
      if (!seen?.schoolId) throw new ServiceError('NOT_FOUND', 'No such case.');
      const listing = await lockListing(tx, seen.schoolId);
      const [c] = await tx
        .select({ id: reviewCase.id, status: reviewCase.status, assignedToUserId: reviewCase.assignedToUserId, openedByUserId: reviewCase.openedByUserId })
        .from(reviewCase)
        .where(eq(reviewCase.id, input.caseId))
        .for('update');
      if (!listing || !c) throw new ServiceError('NOT_FOUND', 'No such case.');
      const [earlier] = await tx
        .select({ caseId: reviewNote.reviewCaseId, body: reviewNote.body })
        .from(reviewNote)
        .where(and(eq(reviewNote.authorUserId, p.user.id), eq(reviewNote.idempotencyKey, input.idempotencyKey)));
      if (earlier) {
        if (earlier.caseId !== c.id || earlier.body !== body) throw keyReused();
        return { replayed: true, publicChange: false };
      }
      if (c.openedByUserId === p.user.id || listing.createdByUserId === p.user.id) throw new ServiceError('FORBIDDEN', 'This listing is yours: another reviewer decides it.');
      if (input.decision !== 'needs_info' && !hasStaff2FA(p, LISTING_DECIDE_ROLES)) {
        throw new ServiceError('FORBIDDEN', 'A moderator or an administrator approves or returns a school listing.');
      }
      if (c.assignedToUserId !== p.user.id && !admin) throw new ServiceError('FORBIDDEN', 'Assign the case to yourself before you decide it.');
      if (!isOpen(c.status) || !isDecidableListing(listing.status)) throw new ServiceError('CONFLICT', 'This case has been decided or closed.');
      if (input.decision === 'verify' && !input.schoolVersion) {
        throw new ServiceError('BAD_REQUEST', 'Open the case again and decide from the listing it shows.', { schoolVersion: 'Send the version of the listing you reviewed (the case card has it).' });
      }
      if (input.schoolVersion && input.schoolVersion !== listing.version) {
        throw new ServiceError('CONFLICT', 'The Sifu changed this listing after you opened it. Open the case again and review the new details before you decide.');
      }
      const listed = listing.status === 'active';
      const now = new Date();
      const owner = listing.createdByUserId;
      const audit = (action: 'review.needs_info' | 'review.resolve' | 'school.publish' | 'school.return', subjectType: string, subjectId: string, before: Record<string, unknown>, after: Record<string, unknown>) =>
        writeAudit(tx, { action, actorUserId: p.user.id, actorRole: p.user.role, subjectType, subjectId, before, after, requestId: meta.requestId, ipHmac: meta.ipHmac });

      if (input.decision === 'needs_info') {
        await tx.update(reviewCase).set({ status: 'needs_info', updatedAt: now }).where(eq(reviewCase.id, c.id));
        await tx.insert(reviewNote).values({ reviewCaseId: c.id, authorUserId: p.user.id, body, isInternal: false, idempotencyKey: input.idempotencyKey });
        await audit('review.needs_info', 'review_case', c.id, { status: c.status }, { status: 'needs_info', schoolId: seen.schoolId });
        if (owner) await tx.insert(notification).values({ userId: owner, template: 'school.reviewed', payload: { schoolId: seen.schoolId, decision: 'needs_info' } });
        return { replayed: false, publicChange: false };
      }

      const approve = input.decision === 'verify';
      // Approving a listed school's edit keeps it as it is (listed, with the edit).
      if (!(approve && listed)) {
        await tx
          .update(school)
          .set(approve ? { status: 'active', lastActivityAt: now, updatedAt: now } : { status: 'draft', updatedAt: now })
          .where(eq(school.id, seen.schoolId));
      }
      await tx
        .update(reviewCase)
        .set({ status: 'resolved', resolution: approve ? 'approved' : 'rejected', resolutionReason: input.reason, resolvedAt: now, updatedAt: now })
        .where(eq(reviewCase.id, c.id));
      // An approval's note is for the reviewers; a reason to return it is the Sifu's to read.
      await tx.insert(reviewNote).values({ reviewCaseId: c.id, authorUserId: p.user.id, body, isInternal: approve && input.reason === null, idempotencyKey: input.idempotencyKey });
      await audit(approve ? 'school.publish' : 'school.return', 'school', seen.schoolId, { status: listing.status }, { status: approve ? 'active' : 'draft', caseId: c.id, ...(listed ? { edit: true } : {}) });
      await audit('review.resolve', 'review_case', c.id, { status: c.status }, { status: 'resolved', resolution: approve ? 'approved' : 'rejected', schoolId: seen.schoolId });
      if (owner) await tx.insert(notification).values({ userId: owner, template: 'school.reviewed', payload: { schoolId: seen.schoolId, decision: approve ? 'approved' : 'returned' } });
      // A new listing goes public when approved; a listed one leaves the map when returned.
      return { replayed: false, publicChange: listed ? !approve : approve };
    });
    if (outcome.publicChange) invalidatePublic([SCHOOLS_TAG], 'procedure');
    return outcome.replayed;
  } catch (error) {
    const pg = pgErrorOf(error);
    if (pg?.code === '23505' && pg.constraint === 'review_note_idempotency_key') throw keyReused();
    throw error;
  }
}
