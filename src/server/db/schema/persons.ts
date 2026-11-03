// People and their names (plan §6.2, §5.3). A person is an archival record, separate from the
// login account (auth_user, M02): historical and unclaimed people exist without one, and an
// account gets its own record at onboarding (stewardship = self, claimed_by_user_id).

import { sql } from 'drizzle-orm';
import { type AnyPgColumn, boolean, check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { authUser } from './auth';
import { reviewCase } from './evidence';
import { teachingRelationship } from './lineage';
import { place } from './schools';
import {
  CLAIM_STATUSES,
  deletedAt,
  idColumn,
  inList,
  INVITATION_STATUSES,
  LIFE_STATUSES,
  NAME_KEY_KINDS,
  NAME_KINDS,
  PERSON_KINDS,
  PHOTO_CAPTION_MAX,
  PHOTO_FULL_MAX_SIDE,
  PHOTO_REASON_MAX,
  PHOTO_STATUSES,
  ROMANIZATIONS,
  STEWARDSHIPS,
  timestamps,
  VISIBILITIES,
} from './common';

/** `demo-root-a`, `demo-hub-a`: lowercase ASCII words joined by single hyphens. */
export const SLUG_PATTERN = '^[a-z0-9]+(-[a-z0-9]+)*$';

export const person = pgTable(
  'person',
  {
    id: idColumn(),
    slug: text('slug').notNull(),
    kind: text('kind', { enum: PERSON_KINDS }).notNull(),
    lifeStatus: text('life_status', { enum: LIFE_STATUSES }).notNull().default('unknown'),
    stewardship: text('stewardship', { enum: STEWARDSHIPS }).notNull().default('unclaimed'),
    // DEFAULT D03: a record is private to the people involved until one of its relationships is
    // verified, or until its own claimed owner publishes it.
    visibility: text('visibility', { enum: VISIBILITIES }).notNull().default('involved_only'),
    claimedByUserId: uuid('claimed_by_user_id').references(() => authUser.id, { onDelete: 'restrict' }),
    createdByUserId: uuid('created_by_user_id').references(() => authUser.id, { onDelete: 'restrict' }),
    // ISO 3166-1 alpha-2 country of residence or activity, when known.
    countryCode: text('country_code'),
    // City of residence or activity from the GeoNames excerpt (onboarding, M02), when known.
    placeId: uuid('place_id').references(() => place.id, { onDelete: 'set null' }),
    // The year this person started training, as they state it (onboarding, M02).
    trainingStartYear: integer('training_start_year'),
    // Private and not collected in the pilot (D16); the public role never sees it.
    birthDate: date('birth_date'),
    // M14: the current profile photo (person_photo, status active), or none. v_public_person
    // shows it only for a public person (docs/adr/0016-profile-photos.md).
    photoId: uuid('photo_id').references((): AnyPgColumn => personPhoto.id, { onDelete: 'set null' }),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('person_slug_key').on(t.slug),
    // One claimed record per account; many records have no account at all.
    uniqueIndex('person_claimed_by_user_id_key').on(t.claimedByUserId).where(sql`${t.claimedByUserId} IS NOT NULL`),
    index('person_visibility_idx').on(t.visibility),
    check('person_slug_format', sql`${t.slug} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`),
    check('person_kind_check', inList(t.kind.name, PERSON_KINDS)),
    check('person_life_status_check', inList(t.lifeStatus.name, LIFE_STATUSES)),
    check('person_stewardship_check', inList(t.stewardship.name, STEWARDSHIPS)),
    check('person_visibility_check', inList(t.visibility.name, VISIBILITIES)),
    // A self-stewarded record always belongs to an account.
    check('person_self_needs_account', sql`${t.stewardship} <> 'self' OR ${t.claimedByUserId} IS NOT NULL`),
    check('person_country_code_format', sql`${t.countryCode} IS NULL OR ${t.countryCode} ~ '^[A-Z]{2}$'`),
    check(
      'person_training_start_year_range',
      sql`${t.trainingStartYear} IS NULL OR ${t.trainingStartYear} BETWEEN 1900 AND 2100`,
    ),
    index('person_place_id_idx').on(t.placeId),
    index('person_created_by_user_id_idx').on(t.createdByUserId),
    index('person_photo_id_idx').on(t.photoId),
  ],
);

/**
 * M14 (docs/adr/0016-profile-photos.md): a profile photo of a person. The upload is decoded,
 * turned upright, stripped of every metadata block (EXIF with its GPS position), cropped to a
 * centred square and stored as WebP at the sizes of PHOTO_SIZES under `<storage_key>/<size>` in
 * the photo store, never in the evidence store (src/server/storage). The person's current photo is
 * person.photo_id and has status `active`; a replaced or removed photo keeps its row (who uploaded
 * and who removed it, for the audit trail) while its files are deleted.
 */
export const personPhoto = pgTable(
  'person_photo',
  {
    id: idColumn(),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    // `photos/<48 hex digits>` from 24 random bytes: nothing in it comes from the file or the person.
    storageKey: text('storage_key').notNull(),
    // SHA-256 of the stored 512 px rendition: the content hash in the photo's address.
    sha256: text('sha256').notNull(),
    // SHA-256 of the uploaded original (never stored itself). Cleared when the account is deleted
    // (M14 review): nothing then ties the row to the file that was uploaded.
    originalSha256: text('original_sha256'),
    // The largest rendition stored: a square of this side (at most 512, at least PHOTO_MIN_SIDE).
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    status: text('status', { enum: PHOTO_STATUSES }).notNull().default('active'),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    removedByUserId: uuid('removed_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    // Staff removal only: the reason, for staff and the audit log (never shown publicly).
    removalReason: text('removal_reason'),
    // M16 (docs/adr/0019-galleries.md): the owner's caption (the viewer's alt text), the order in
    // the gallery (smallest first) and the size of the `full` rendition, the whole photo at most
    // PHOTO_FULL_MAX_SIDE on its longer side; null for a photo stored before M16 (512 px only).
    caption: text('caption'),
    position: integer('position').notNull().default(0),
    fullWidth: integer('full_width'),
    fullHeight: integer('full_height'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('person_photo_storage_key_key').on(t.storageKey),
    // M16: the gallery of a person, in its order.
    index('person_photo_gallery_idx').on(t.personId, t.position).where(sql`${t.status} IN ('active', 'gallery')`),
    check('person_photo_caption_length', sql`${t.caption} IS NULL OR char_length(${t.caption}) BETWEEN 1 AND ${sql.raw(String(PHOTO_CAPTION_MAX))}`),
    check(
      'person_photo_full_size',
      sql`(${t.fullWidth} IS NULL AND ${t.fullHeight} IS NULL) OR (${t.fullWidth} BETWEEN 1 AND ${sql.raw(String(PHOTO_FULL_MAX_SIDE))} AND ${t.fullHeight} BETWEEN 1 AND ${sql.raw(String(PHOTO_FULL_MAX_SIDE))})`,
    ),
    // One current photo per person.
    uniqueIndex('person_photo_one_active_key').on(t.personId).where(sql`${t.status} = 'active'`),
    index('person_photo_person_id_idx').on(t.personId),
    index('person_photo_uploaded_by_user_id_idx').on(t.uploadedByUserId),
    index('person_photo_removed_by_user_id_idx').on(t.removedByUserId),
    check('person_photo_status_check', inList(t.status.name, PHOTO_STATUSES)),
    check('person_photo_storage_key_format', sql`${t.storageKey} ~ '^photos/[0-9a-f]{48}$'`),
    check('person_photo_sha256_format', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('person_photo_original_sha256_format', sql`${t.originalSha256} IS NULL OR ${t.originalSha256} ~ '^[0-9a-f]{64}$'`),
    check('person_photo_square', sql`${t.width} = ${t.height} AND ${t.width} BETWEEN 96 AND 512`),
    check('person_photo_size_check', sql`${t.sizeBytes} > 0`),
    check('person_photo_removed_has_time', sql`${t.status} <> 'removed' OR ${t.removedAt} IS NOT NULL`),
    check('person_photo_reason_length', sql`${t.removalReason} IS NULL OR char_length(${t.removalReason}) BETWEEN 1 AND ${sql.raw(String(PHOTO_REASON_MAX))}`),
  ],
);

/**
 * Every spelling of a person's name (plan §5.3): a value with its script (ISO 15924: Latn, Hant,
 * Hans, Cyrl, ...), language tag (BCP 47) and romanization system. Exactly one name per person
 * is the primary display name, which must be a Latin-script name (CHECK here; the "exactly one"
 * part is validated by the service and by the seed's integration test).
 */
export const personName = pgTable(
  'person_name',
  {
    id: idColumn(),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: NAME_KINDS }).notNull().default('name'),
    value: text('value').notNull(),
    script: text('script').notNull(),
    lang: text('lang').notNull(),
    romanization: text('romanization', { enum: ROMANIZATIONS }),
    isPrimary: boolean('is_primary').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index('person_name_person_id_idx').on(t.personId),
    uniqueIndex('person_name_one_primary_key').on(t.personId).where(sql`${t.isPrimary}`),
    check('person_name_kind_check', inList(t.kind.name, NAME_KINDS)),
    check(
      'person_name_romanization_check',
      sql`${t.romanization} IS NULL OR ${inList(t.romanization.name, ROMANIZATIONS)}`,
    ),
    check('person_name_script_format', sql`${t.script} ~ '^[A-Z][a-z]{3}$'`),
    check('person_name_lang_format', sql`${t.lang} ~ '^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$'`),
    check('person_name_value_not_blank', sql`btrim(${t.value}) <> ''`),
    // The primary display name is mandatory Latin script (plan §5.3).
    check('person_name_primary_is_latin', sql`NOT ${t.isPrimary} OR (${t.script} = 'Latn' AND ${t.kind} = 'name')`),
  ],
);

/**
 * Normalised search keys (plan §6.2): Latin without diacritics, Jyutping and pinyin without
 * tones, folded Traditional/Simplified characters, and Hong Kong spellings (`alias`). Written by
 * src/server/search/store.ts whenever a person's names change (M07); `source` says how each key
 * was made (`name`, `bg_streamlined`, `pinyin-pro`, `alias:hk-spelling`, ...). A key is never
 * shown: a match shows the stored name it came from.
 */
export const personNameKey = pgTable(
  'person_name_key',
  {
    id: idColumn(),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    personNameId: uuid('person_name_id')
      .notNull()
      .references(() => personName.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    keyKind: text('key_kind', { enum: NAME_KEY_KINDS }).notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    source: text('source').notNull().default('name'),
    ...timestamps(),
  },
  (t) => [
    index('person_name_key_person_id_idx').on(t.personId),
    index('person_name_key_person_name_id_idx').on(t.personNameId),
    index('person_name_key_trgm_idx').using('gin', t.key.op('gin_trgm_ops')),
    index('person_name_key_prefix_idx').on(t.key.op('text_pattern_ops')),
    check('person_name_key_kind_check', inList(t.keyKind.name, NAME_KEY_KINDS)),
    check('person_name_key_not_blank', sql`${t.key} <> ''`),
  ],
);

/** Biographies, one per language tag. */
export const personBio = pgTable(
  'person_bio',
  {
    id: idColumn(),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    lang: text('lang').notNull(),
    body: text('body').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('person_bio_person_lang_key').on(t.personId, t.lang),
    check('person_bio_lang_format', sql`${t.lang} ~ '^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$'`),
  ],
);

/** A request by an account to take over a record (D04, D12; reviewed in M10b). */
export const personClaim = pgTable(
  'person_claim',
  {
    id: idColumn(),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    status: text('status', { enum: CLAIM_STATUSES }).notNull().default('pending'),
    message: text('message'),
    reviewCaseId: uuid('review_case_id').references(() => reviewCase.id, { onDelete: 'set null' }),
    decidedByUserId: uuid('decided_by_user_id').references(() => authUser.id, { onDelete: 'restrict' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index('person_claim_person_id_idx').on(t.personId),
    index('person_claim_user_id_idx').on(t.userId),
    index('person_claim_decided_by_user_id_idx').on(t.decidedByUserId),
    uniqueIndex('person_claim_one_pending_key').on(t.personId, t.userId).where(sql`${t.status} = 'pending'`),
    check('person_claim_status_check', inList(t.status.name, CLAIM_STATUSES)),
  ],
);

/**
 * An invitation to a living teacher who has no account yet (relationship status awaiting_claim,
 * plan §6.7). The e-mail address is personal data; only a hash of the token is stored.
 */
export const invitation = pgTable(
  'invitation',
  {
    id: idColumn(),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    relationshipId: uuid('relationship_id').references(() => teachingRelationship.id, { onDelete: 'set null' }),
    invitedByUserId: uuid('invited_by_user_id').references(() => authUser.id, { onDelete: 'restrict' }),
    // Erased 30 days after the invitation ends (retention job, docs/data-model.md §7); a pending
    // invitation always has one.
    email: text('email'),
    tokenHash: text('token_hash').notNull(),
    status: text('status', { enum: INVITATION_STATUSES }).notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    // M10b: the account that accepted the invitation (single use: set once, with accepted_at).
    acceptedByUserId: uuid('accepted_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    // M10b (plan §5.6): the idempotency key of the student's form; the same key from the same
    // account sends no second invitation.
    idempotencyKey: text('idempotency_key'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('invitation_token_hash_key').on(t.tokenHash),
    index('invitation_accepted_by_user_id_idx').on(t.acceptedByUserId),
    uniqueIndex('invitation_idempotency_key')
      .on(t.invitedByUserId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    check('invitation_idempotency_key_format', sql`${t.idempotencyKey} IS NULL OR ${t.idempotencyKey} ~ '^[A-Za-z0-9_-]{8,64}$'`),
    check('invitation_accepted_has_account', sql`${t.status} <> 'accepted' OR ${t.acceptedAt} IS NOT NULL`),
    index('invitation_person_id_idx').on(t.personId),
    index('invitation_relationship_id_idx').on(t.relationshipId),
    index('invitation_invited_by_user_id_idx').on(t.invitedByUserId),
    check('invitation_status_check', inList(t.status.name, INVITATION_STATUSES)),
    check('invitation_token_hash_format', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('invitation_pending_has_email', sql`${t.status} <> 'pending' OR ${t.email} IS NOT NULL`),
  ],
);
