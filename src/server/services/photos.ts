// Profile photos (milestone M14; docs/adr/0016-profile-photos.md). One current photo per person
// (person.photo_id, a person_photo row with status `active`), shown on the profile and as a small
// round thumbnail on the person cards (the explorer, the selection panel, the lists, search and
// school pages); the monogram stays the fallback.
//
// Who may do what (every function checks it itself, whoever calls it):
//   - upload or replace: the signed-in account whose own person it is (person.claimed_by_user_id);
//     nobody else, staff included (staff remove, they never put a photo on someone's profile);
//   - remove: that account (its own photo), or staff (moderator, archivist or administrator) with a
//     verified second factor, with a reason kept with the row and in the audit log (staff read it;
//     the owner is not notified in Phase 1); audited as photo.remove either way;
//   - read (photos.get, GET /api/photos/...): everyone for a public person; for a person who is not
//     public only the account whose own person it is and staff with a verified second factor.
//     Anyone else gets 404, the same answer as for no such person (plan §6.4).
//
// The upload, in this order:
//   1. a signed-in account with an own person (404 "no profile yet" otherwise);
//   2. at most PHOTO_MAX_BYTES (DEFAULT D07: 5 MB), checked by the HTTP layer before the body is
//      buffered (src/server/rpc/handler.ts) and again here; an empty file is refused;
//   3. the type from the magic bytes (JPEG, PNG, WebP; 415 otherwise), never the name or the
//      client's Content-Type; decoded with the decompression-bomb guard, turned upright, every
//      metadata block dropped, a centred square at 96 and 512 px as WebP (../storage/photo.ts);
//   4. a random storage key `photos/<48 hex>`, the renditions in the photo store (never the evidence
//      store), then in one transaction under the quota lock of 'photos' (DEFAULT D07: the current
//      photo counts as one; a replacement adds nothing): the old photo `replaced`, the new row,
//      person.photo_id, the audit row photo.upload. If the transaction fails, the new files go; once
//      it commits, the old files go. Then the public cache of the person is dropped.
//
// Logs and audit rows carry ids, sizes and hashes, never a name, a storage key or a file name
// (CLAUDE.md §6).

import { createHash } from 'node:crypto';

import { and, eq, isNull, or, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { hasStaff2FA, requireStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { invalidatePublic, personTag, SCHOOLS_TAG } from '../cache';
import { getDb, getPublicDb } from '../db';
import { uuidv7 } from '../db/ids';
import { person, personPhoto } from '../db/schema';
import { PHOTO_MAX_BYTES, PHOTO_REASON_MAX, PHOTO_SIZES } from '../db/schema/common';
import { SLUG_PATTERN } from '../db/schema/persons';
import type { PhotoDto } from '../dto/public';
import type { EntitlementSubject } from '../entitlements/access';
import { withQuota } from '../entitlements/quota';
import { logger } from '../log';
import { getPhotoStore, newStorageKey, type ObjectStore } from '../storage';
import { PhotoRefused, type PhotoSize, renderGalleryPhoto } from '../storage/photo';
import { readObjectBytes } from '../storage/read';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { PHOTO_HASH_LENGTH, photoDto, publicPhotoRefs } from './photo-refs';

export { photoDto, photoUrl, publicPhotoRefs } from './photo-refs';

export const PHOTO_MAX_MB = PHOTO_MAX_BYTES / (1024 * 1024);
export const PHOTO_TOO_LARGE_MESSAGE = `This photo is larger than ${PHOTO_MAX_MB} MB. Choose a smaller copy.`;
export const PHOTO_WRONG_TYPE_MESSAGE = 'The contents of this file are not a JPEG, PNG or WebP image, whatever its name.';
export const NO_OWN_PERSON_MESSAGE = 'You have no profile yet. Finish setting up your profile first.';
const NOT_FOUND_MESSAGE = 'No such person.';

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

// --- Input -------------------------------------------------------------------------------------

const slug = z
  .string()
  .min(1, { error: 'Must be a profile address.' })
  .max(120, { error: 'Must be a profile address.' })
  .regex(new RegExp(SLUG_PATTERN), { error: 'Must be a profile address.' });

/** photos.upload: one image file, for the account's own person. */
export const photoUploadInput = z.object({
  file: z.file({ error: 'Choose a photo.' }),
});

/** photos.remove: the own photo (no slug, or the own slug), or, for staff, anyone's with a reason. */
export const photoRemoveInput = z.object({
  slug: slug.optional(),
  reason: z.string().max(PHOTO_REASON_MAX * 2).optional(),
});

/** photos.get: a person's current photo. */
export const photoGetInput = z.object({ slug });

// --- Views -------------------------------------------------------------------------------------

export interface PhotoInfo {
  personId: string;
  slug: string;
  /** The current photo, or null when there is none. */
  photo: PhotoDto | null;
  /** The side of the largest rendition, in pixels; null without a photo. */
  side: number | null;
  /** When the current photo was uploaded (ISO 8601); null without a photo. */
  uploadedAt: string | null;
  /** Whether this viewer may upload, replace or remove it: the account whose own person it is. */
  canChange: boolean;
  /** Whether this viewer may remove it as staff (with a reason). */
  canModerate: boolean;
}

export interface UploadedPhoto {
  personId: string;
  slug: string;
  photo: PhotoDto;
  side: number;
  /** Whether an earlier photo was replaced. */
  replaced: boolean;
}

// --- Helpers -----------------------------------------------------------------------------------

function notFound(): ServiceError {
  return new ServiceError('NOT_FOUND', NOT_FOUND_MESSAGE);
}

export interface OwnPerson {
  id: string;
  slug: string;
  visibility: string;
}

/** The signed-in account's own person (not deleted), or null. */
export async function ownPerson(userId: string): Promise<OwnPerson | null> {
  const [row] = await getDb()
    .select({ id: person.id, slug: person.slug, visibility: person.visibility })
    .from(person)
    .where(and(eq(person.claimedByUserId, userId), isNull(person.deletedAt)));
  return row ?? null;
}

/** The stored files of a photo: its squares and (M16) its whole photo, which a photo of M14 lacks. */
const filesOf = (key: string) => [...PHOTO_SIZES.map((size) => `${key}/${size}`), `${key}/full`];

/**
 * Deletes the files of photos whose rows are already `removed` (account deletion, src/server/services/
 * privacy.ts): best effort, after the transaction that changed the rows has committed.
 */
export async function deletePhotoFiles(photos: readonly { id: string; storageKey: string }[], store: ObjectStore = getPhotoStore()): Promise<void> {
  for (const photo of photos) await deleteFiles(store, photo.storageKey, photo.id);
}

export async function deleteFiles(store: ObjectStore, key: string, photoId: string): Promise<void> {
  for (const file of filesOf(key)) {
    await store.delete(file).catch(() => {
      logger().error(`[photos] a stored file of photo ${photoId} could not be removed`);
    });
  }
}

/** Reads the whole file, refused past the limit (the HTTP layer refused a longer body already). */
export async function fileBytes(file: File): Promise<Uint8Array> {
  if (file.size === 0) throw new ServiceError('BAD_REQUEST', 'This file is empty.', { file: 'This file is empty.' });
  if (file.size > PHOTO_MAX_BYTES) throw new ServiceError('PAYLOAD_TOO_LARGE', PHOTO_TOO_LARGE_MESSAGE, { file: PHOTO_TOO_LARGE_MESSAGE });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > PHOTO_MAX_BYTES) throw new ServiceError('PAYLOAD_TOO_LARGE', PHOTO_TOO_LARGE_MESSAGE, { file: PHOTO_TOO_LARGE_MESSAGE });
  return bytes;
}

export function refusalMessage(error: PhotoRefused): { code: 'UNSUPPORTED_MEDIA_TYPE' | 'BAD_REQUEST'; message: string } {
  switch (error.reason) {
    case 'not_image':
      return { code: 'UNSUPPORTED_MEDIA_TYPE', message: PHOTO_WRONG_TYPE_MESSAGE };
    case 'too_large':
      return { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'This image has too many pixels. Save a smaller copy and choose that.' };
    case 'too_small':
      return { code: 'BAD_REQUEST', message: 'This image is too small. Choose one at least 96 pixels wide and high.' };
    default:
      return { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'This image could not be read. Save it again as JPEG, PNG or WebP.' };
  }
}

/** Writes every rendition of a gallery photo (the squares and the whole photo) under `key`. */
export async function putRenditions(store: ObjectStore, key: string, rendered: { renditions: Record<PhotoSize, Uint8Array>; full?: { bytes: Uint8Array } }): Promise<void> {
  for (const size of PHOTO_SIZES) {
    await store.put(`${key}/${size}`, rendered.renditions[size], { contentType: 'image/webp', sha256: sha256(rendered.renditions[size]) });
  }
  if (rendered.full) await store.put(`${key}/full`, rendered.full.bytes, { contentType: 'image/webp', sha256: sha256(rendered.full.bytes) });
}

/** M16: the position before every photo of the person's gallery (the first place). */
export async function firstPosition(tx: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }> }, personId: string): Promise<number> {
  const result = await tx.execute(sql`SELECT COALESCE(MIN(position), 1) - 1 AS p FROM person_photo WHERE person_id = ${personId}::uuid AND status IN ('active', 'gallery')`);
  return Number(result.rows[0]?.p ?? 0);
}

// --- Upload ------------------------------------------------------------------------------------

/**
 * Uploads or replaces the profile photo of the signed-in account's own person (see the top of
 * this file for the order of the checks). Returns the new photo's addresses; never a storage key.
 */
export async function uploadPhoto(
  principal: Principal | null,
  raw: z.input<typeof photoUploadInput>,
  meta: RequestMeta,
  store: ObjectStore = getPhotoStore(),
): Promise<UploadedPhoto> {
  const p = requireUser(principal);
  const own = await ownPerson(p.user.id);
  if (!own) throw new ServiceError('NOT_FOUND', NO_OWN_PERSON_MESSAGE);
  const parsed = photoUploadInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Choose a photo.', { file: 'Choose a photo.' });
  const bytes = await fileBytes(parsed.data.file);
  // M16: with the whole photo too, as every photo of the gallery (the profile photo is one of them).
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
  const large = rendered.renditions[512];
  const content = sha256(large);
  const key = newStorageKey('photos');
  const subject: EntitlementSubject = { kind: 'user', userId: p.user.id };
  const id = uuidv7();
  let previous: { id: string; storageKey: string } | null = null;
  try {
    // Inside the try: a rendition written before a failed one is deleted with it.
    await putRenditions(store, key, rendered);
    const outcome = await getDb().transaction(async (tx) =>
      // DEFAULT D07: the current photo counts as one against 'photos', which every plan allows;
      // a replacement of the person's photo adds nothing (the unit is the person). M16: every
      // other photo of the gallery counts too; only the profile photo is replaced here.
      withQuota(
        tx,
        subject,
        'photos',
        async () => {
          const [locked] = await tx
            .select({ id: person.id, photoId: person.photoId, claimedBy: person.claimedByUserId, deletedAt: person.deletedAt })
            .from(person)
            .where(eq(person.id, own.id))
            .for('update');
          if (!locked || locked.claimedBy !== p.user.id || locked.deletedAt) throw new ServiceError('NOT_FOUND', NO_OWN_PERSON_MESSAGE);
          const [old] = await tx
            .select({ id: personPhoto.id, storageKey: personPhoto.storageKey, position: personPhoto.position })
            .from(personPhoto)
            .where(and(eq(personPhoto.personId, own.id), eq(personPhoto.status, 'active')));
          const now = new Date();
          if (old) await tx.update(personPhoto).set({ status: 'replaced', updatedAt: now }).where(eq(personPhoto.id, old.id));
          // M16: the new profile photo takes the old one's place in the gallery, or goes first.
          const position = old ? old.position : await firstPosition(tx, own.id);
          await tx.insert(personPhoto).values({
            id,
            personId: own.id,
            storageKey: key,
            sha256: content,
            originalSha256: sha256(bytes),
            width: rendered.side,
            height: rendered.side,
            sizeBytes: large.byteLength,
            fullWidth: rendered.full.width,
            fullHeight: rendered.full.height,
            position,
            status: 'active',
            uploadedByUserId: p.user.id,
          });
          await tx.update(person).set({ photoId: id, updatedAt: now }).where(eq(person.id, own.id));
          await writeAudit(tx, {
            action: 'photo.upload',
            actorUserId: p.user.id,
            actorRole: p.user.role,
            subjectType: 'person',
            subjectId: own.id,
            before: old ? { photoId: old.id } : null,
            after: { photoId: id, side: rendered.side, sizeBytes: large.byteLength, sha256: content },
            requestId: meta.requestId,
            ipHmac: meta.ipHmac,
          });
          return old ? { id: old.id, storageKey: old.storageKey } : null;
        },
        { unit: own.id },
      ),
    );
    if (!outcome.ok) {
      throw new ServiceError('ENTITLEMENT_REQUIRED', 'Your plan has no room for another photo.', {}, { entitlement: { ...outcome, key: 'photos' } });
    }
    previous = outcome.value;
  } catch (error) {
    await deleteFiles(store, key, id);
    throw error;
  }
  if (previous) await deleteFiles(store, previous.storageKey, previous.id);
  invalidatePublic([personTag(own.id), SCHOOLS_TAG], 'procedure');
  return { personId: own.id, slug: own.slug, photo: photoDto(id, content), side: rendered.side, replaced: previous !== null };
}

// --- Remove ------------------------------------------------------------------------------------

/**
 * Removes a person's current photo: the account's own (no slug, or its own slug), or as staff with
 * a verified second factor anyone's, with a required reason (staff who give a reason for their own
 * person's photo remove it as staff too). The row stays (status `removed`, who
 * and when), the files go. Removing when there is no photo is a no-op that says so.
 */
export async function removePhoto(
  principal: Principal | null,
  raw: z.input<typeof photoRemoveInput>,
  meta: RequestMeta,
  store: ObjectStore = getPhotoStore(),
): Promise<{ personId: string; slug: string; removed: boolean }> {
  const p = requireUser(principal);
  const parsed = photoRemoveInput.safeParse(raw);
  if (!parsed.success) {
    // Each refused field says so on its own: a reason too long is not a bad address.
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === 'reason') fields.reason = `At most ${PHOTO_REASON_MAX} characters.`;
      else fields.slug = 'Must be a profile address.';
    }
    throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
  }
  const own = await ownPerson(p.user.id);
  const reason = (parsed.data.reason ?? '').trim();
  let target: { id: string; slug: string };
  let asStaff = false;
  if (!parsed.data.slug || (own && parsed.data.slug === own.slug)) {
    if (!own) throw new ServiceError('NOT_FOUND', NO_OWN_PERSON_MESSAGE);
    target = own;
    // M14 review: staff with a verified second factor who give a reason remove as staff, even
    // their own person's photo (the reason kept, the audit says staff). Without a reason, or for
    // any other account, this is the owner's removal and a reason is not kept.
    asStaff = hasStaff2FA(p) && reason.length > 0;
  } else {
    // Someone else's photo: staff only (a verified second factor), with a reason.
    if (!hasStaff2FA(p)) {
      // A signed-in account that is not staff learns nothing about the person (404, plan §6.4);
      // staff without a verified second factor are told to confirm the session.
      if (p.user.role !== 'user') requireStaff2FA(p);
      throw notFound();
    }
    asStaff = true;
    const [row] = await getDb()
      .select({ id: person.id, slug: person.slug })
      .from(person)
      .where(and(eq(person.slug, parsed.data.slug), isNull(person.deletedAt)));
    if (!row) throw notFound();
    target = row;
  }
  if (asStaff && reason.length === 0) {
    throw new ServiceError('BAD_REQUEST', 'Say why the photo is removed: the reason is kept in the audit log.', { reason: 'Say why the photo is removed: the reason is kept in the audit log.' });
  }
  if (reason.length > PHOTO_REASON_MAX) {
    throw new ServiceError('BAD_REQUEST', `At most ${PHOTO_REASON_MAX} characters.`, { reason: `At most ${PHOTO_REASON_MAX} characters.` });
  }
  const removed = await getDb().transaction(async (tx) => {
    await tx.select({ id: person.id }).from(person).where(eq(person.id, target.id)).for('update');
    const [current] = await tx
      .select({ id: personPhoto.id, storageKey: personPhoto.storageKey })
      .from(personPhoto)
      .where(and(eq(personPhoto.personId, target.id), eq(personPhoto.status, 'active')));
    if (!current) return null;
    const now = new Date();
    await tx
      .update(personPhoto)
      .set({ status: 'removed', removedAt: now, removedByUserId: p.user.id, removalReason: asStaff ? reason : null, updatedAt: now })
      .where(eq(personPhoto.id, current.id));
    await tx.update(person).set({ photoId: null, updatedAt: now }).where(eq(person.id, target.id));
    await writeAudit(tx, {
      action: 'photo.remove',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'person',
      subjectId: target.id,
      before: { photoId: current.id },
      after: { by: asStaff ? 'staff' : 'owner' },
      reason: asStaff ? reason : null,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return current;
  });
  if (removed) {
    await deleteFiles(store, removed.storageKey, removed.id);
    invalidatePublic([personTag(target.id), SCHOOLS_TAG], 'procedure');
  }
  return { personId: target.id, slug: target.slug, removed: removed !== null };
}

// --- Read --------------------------------------------------------------------------------------

/**
 * A person's current photo for this viewer: a public person's for everyone; a person who is not
 * public only for the account whose own person it is and staff with a verified second factor. 404
 * otherwise, the same as for no such person.
 */
export async function getPhoto(principal: Principal | null, raw: z.input<typeof photoGetInput>): Promise<PhotoInfo> {
  const parsed = photoGetInput.safeParse(raw);
  if (!parsed.success) throw notFound();
  const [row] = await getDb()
    .select({ id: person.id, slug: person.slug, visibility: person.visibility, claimedBy: person.claimedByUserId })
    .from(person)
    .where(and(eq(person.slug, parsed.data.slug), isNull(person.deletedAt)));
  if (!row) throw notFound();
  const isOwn = principal !== null && row.claimedBy === principal.user.id;
  const staff = hasStaff2FA(principal);
  if (row.visibility !== 'public' && !isOwn && !staff) throw notFound();
  const [photo] = await getDb()
    .select({ id: personPhoto.id, sha256: personPhoto.sha256, side: personPhoto.width, createdAt: personPhoto.createdAt })
    .from(person)
    .innerJoin(personPhoto, and(eq(personPhoto.id, person.photoId), eq(personPhoto.personId, person.id), eq(personPhoto.status, 'active')))
    .where(eq(person.id, row.id));
  return {
    personId: row.id,
    slug: row.slug,
    photo: photo ? photoDto(photo.id, photo.sha256) : null,
    side: photo?.side ?? null,
    uploadedAt: photo?.createdAt.toISOString() ?? null,
    canChange: isOwn,
    canModerate: staff && photo !== undefined,
  };
}

// --- Serving -----------------------------------------------------------------------------------

/**
 * The whole read of one rendition from the photo store, headers and body (M14, CI run
 * 41470799646): renditions are small (a few tens of KB), so a store that takes longer has stalled,
 * and the route answers 503 at once instead of holding the browser's request and the page's
 * `load` event for the S3 driver's own 30 s deadlines.
 */
export const PHOTO_READ_TIMEOUT_MS = 5_000;
/** No rendition comes near this; a larger object in the store is refused, never sent. */
export const PHOTO_RENDITION_MAX_BYTES = 1024 * 1024;

/** The ETag of a photo: its full content hash, so the same bytes keep the same tag. */
export const photoEtag = (sha256: string) => `"${sha256}"`;

interface PhotoFileBase {
  /** The full content hash, for the ETag. */
  sha256: string;
  /** Whether the person is public: a shared cache may then keep the answer for a while. */
  public: boolean;
}

/** The rendition's bytes, or `notModified` when the caller's If-None-Match names it (no store read). */
export type PhotoFile = (PhotoFileBase & { notModified: false; bytes: Uint8Array<ArrayBuffer> }) | (PhotoFileBase & { notModified: true });

export interface OpenPhotoOptions {
  /** The request's If-None-Match header: a match answers notModified without reading the store. */
  ifNoneMatch?: string | null;
  /** The deadline of the store read (PHOTO_READ_TIMEOUT_MS). */
  timeoutMs?: number;
  /** The request's signal: a browser that went away ends the store read. */
  signal?: AbortSignal;
}

export const PHOTO_ADDRESS = {
  id: z.uuid(),
  hash: z.string().regex(new RegExp(`^[0-9a-f]{${PHOTO_HASH_LENGTH}}$`)),
  // M16: `full.webp`, the whole photo of a gallery or room photo (the 512 px square of a photo of M14).
  file: z.enum(['full.webp', ...PHOTO_SIZES.map((size) => `${size}.webp`)] as [string, ...string[]]),
};
const ADDRESS = PHOTO_ADDRESS;

/** The stored file of an address's rendition: `<key>/96`, `<key>/512` or `<key>/full` (`<key>/512` without one). */
export function renditionFile(storageKey: string, file: string, hasFull: boolean): string {
  const name = file.split('.')[0]!;
  if (name === 'full') return hasFull ? `${storageKey}/full` : `${storageKey}/512`;
  return `${storageKey}/${Number(name) as PhotoSize}`;
}

/** M16: whether v_public_person shows this person (app_public_ro may read it): the rule of the person pages. */
export async function isPublicPerson(ex: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }> }, personId: string): Promise<boolean> {
  const result = await ex.execute(sql`SELECT 1 AS one FROM v_public_person WHERE id = ${personId}::uuid`);
  return result.rows.length > 0;
}

export const etagMatches = (header: string | null | undefined, etag: string) =>
  (header ?? '').split(',').some((tag) => {
    const trimmed = tag.trim();
    return trimmed === etag || trimmed === `W/${etag}` || trimmed === '*';
  });

/**
 * One rendition for GET /api/photos/<id>/<hash>/<size>.webp: only the current photo of a person
 * this viewer may see (the rule of getPhoto), and only at its current content hash. Everything
 * else is null (404): a malformed address, a replaced or removed photo, a hidden person. The
 * rendition is read whole within `timeoutMs` (StorageError otherwise; the store's response is
 * always read to its end or cancelled, ../storage/read.ts); a revalidation whose ETag still matches
 * reads nothing from the store.
 */
export async function openPhoto(
  principal: Principal | null,
  address: { id: string; hash: string; file: string },
  store: ObjectStore = getPhotoStore(),
  options: OpenPhotoOptions = {},
): Promise<PhotoFile | null> {
  if (!ADDRESS.id.safeParse(address.id).success || !ADDRESS.hash.safeParse(address.hash).success || !ADDRESS.file.safeParse(address.file).success) return null;
  // M16: the profile photo (active, the one the person points to) or another photo of the gallery.
  const [row] = await getDb()
    .select({
      storageKey: personPhoto.storageKey,
      sha256: personPhoto.sha256,
      personId: personPhoto.personId,
      status: personPhoto.status,
      fullWidth: personPhoto.fullWidth,
      claimedBy: person.claimedByUserId,
    })
    .from(personPhoto)
    .innerJoin(person, and(eq(person.id, personPhoto.personId), isNull(person.deletedAt)))
    .where(
      and(
        eq(personPhoto.id, address.id),
        or(and(eq(personPhoto.status, 'active'), eq(person.photoId, personPhoto.id)), eq(personPhoto.status, 'gallery')),
      ),
    );
  if (!row || !row.sha256.startsWith(address.hash)) return null;
  // Public exactly when v_public_person shows the person and this photo (app_public_ro): the rule
  // of the person pages (src/proxy.ts), so a hidden person's photo is 404 like their page. M16: a
  // gallery photo when v_public_person shows the person.
  const isPublic =
    row.status === 'active'
      ? (await publicPhotoRefs(getPublicDb(), [row.personId])).get(row.personId)?.id === address.id
      : await isPublicPerson(getPublicDb(), row.personId);
  if (!isPublic) {
    const isOwn = principal !== null && row.claimedBy === principal.user.id;
    if (!isOwn && !hasStaff2FA(principal)) return null;
  }
  // Checked after the visibility rule, so a 304 tells nobody more than a 404 would.
  if (etagMatches(options.ifNoneMatch, photoEtag(row.sha256))) return { notModified: true, sha256: row.sha256, public: isPublic };
  const bytes = await readObjectBytes(store, renditionFile(row.storageKey, address.file, row.fullWidth !== null), {
    timeoutMs: options.timeoutMs ?? PHOTO_READ_TIMEOUT_MS,
    maxBytes: PHOTO_RENDITION_MAX_BYTES,
    signal: options.signal,
  });
  if (!bytes) return null;
  return { notModified: false, bytes, sha256: row.sha256, public: isPublic };
}
