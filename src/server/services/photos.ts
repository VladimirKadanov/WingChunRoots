// Profile photos (milestone M14; docs/adr/0016-profile-photos.md). One current photo per person
// (person.photo_id, a person_photo row with status `active`), shown on the profile and as a small
// round thumbnail on the person cards (the explorer, the selection panel, the lists, search and
// school pages); the monogram stays the fallback.
//
// Who may do what (every function checks it itself, whoever calls it):
//   - upload or replace: the signed-in account whose own person it is (person.claimed_by_user_id);
//     nobody else, staff included (staff remove, they never put a photo on someone's profile);
//   - remove: that account (its own photo), or staff (moderator, archivist or administrator) with a
//     verified second factor, with a reason the owner reads; audited as photo.remove either way;
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

import { and, eq, isNull } from 'drizzle-orm';
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
import { PhotoRefused, type PhotoSize, renderProfilePhoto } from '../storage/photo';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { PHOTO_HASH_LENGTH, photoDto, publicPhotoRefs } from './photo-refs';

export { photoDto, photoUrl, publicPhotoRefs } from './photo-refs';

export const PHOTO_MAX_MB = PHOTO_MAX_BYTES / (1024 * 1024);
export const PHOTO_TOO_LARGE_MESSAGE = `This photo is larger than ${PHOTO_MAX_MB} MB. Choose a smaller copy.`;
export const PHOTO_WRONG_TYPE_MESSAGE = 'The contents of this file are not a JPEG, PNG or WebP image, whatever its name.';
export const NO_OWN_PERSON_MESSAGE = 'You have no profile yet. Finish setting up your profile first.';
const NOT_FOUND_MESSAGE = 'No such person.';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

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

interface OwnPerson {
  id: string;
  slug: string;
  visibility: string;
}

async function ownPerson(userId: string): Promise<OwnPerson | null> {
  const [row] = await getDb()
    .select({ id: person.id, slug: person.slug, visibility: person.visibility })
    .from(person)
    .where(and(eq(person.claimedByUserId, userId), isNull(person.deletedAt)));
  return row ?? null;
}

const filesOf = (key: string) => PHOTO_SIZES.map((size) => `${key}/${size}`);

async function deleteFiles(store: ObjectStore, key: string, photoId: string): Promise<void> {
  for (const file of filesOf(key)) {
    await store.delete(file).catch(() => {
      logger().error(`[photos] a stored file of photo ${photoId} could not be removed`);
    });
  }
}

/** Reads the whole file, refused past the limit (the HTTP layer refused a longer body already). */
async function fileBytes(file: File): Promise<Uint8Array> {
  if (file.size === 0) throw new ServiceError('BAD_REQUEST', 'This file is empty.', { file: 'This file is empty.' });
  if (file.size > PHOTO_MAX_BYTES) throw new ServiceError('PAYLOAD_TOO_LARGE', PHOTO_TOO_LARGE_MESSAGE, { file: PHOTO_TOO_LARGE_MESSAGE });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > PHOTO_MAX_BYTES) throw new ServiceError('PAYLOAD_TOO_LARGE', PHOTO_TOO_LARGE_MESSAGE, { file: PHOTO_TOO_LARGE_MESSAGE });
  return bytes;
}

function refusalMessage(error: PhotoRefused): { code: 'UNSUPPORTED_MEDIA_TYPE' | 'BAD_REQUEST'; message: string } {
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
  let rendered: Awaited<ReturnType<typeof renderProfilePhoto>>;
  try {
    rendered = await renderProfilePhoto(bytes);
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
  for (const size of PHOTO_SIZES) {
    await store.put(`${key}/${size}`, rendered.renditions[size], { contentType: 'image/webp', sha256: sha256(rendered.renditions[size]) });
  }
  const subject: EntitlementSubject = { kind: 'user', userId: p.user.id };
  const id = uuidv7();
  let previous: { id: string; storageKey: string } | null = null;
  try {
    const outcome = await getDb().transaction(async (tx) =>
      // DEFAULT D07: the current photo counts as one against 'photos', which every plan allows;
      // a replacement of the person's photo adds nothing (the unit is the person).
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
            .select({ id: personPhoto.id, storageKey: personPhoto.storageKey })
            .from(personPhoto)
            .where(and(eq(personPhoto.personId, own.id), eq(personPhoto.status, 'active')));
          const now = new Date();
          if (old) await tx.update(personPhoto).set({ status: 'replaced', updatedAt: now }).where(eq(personPhoto.id, old.id));
          await tx.insert(personPhoto).values({
            id,
            personId: own.id,
            storageKey: key,
            sha256: content,
            originalSha256: sha256(bytes),
            width: rendered.side,
            height: rendered.side,
            sizeBytes: large.byteLength,
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
          return old ?? null;
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
 * a verified second factor anyone's, with a required reason. The row stays (status `removed`, who
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
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { slug: 'Must be a profile address.' });
  const own = await ownPerson(p.user.id);
  let target: { id: string; slug: string };
  let asStaff = false;
  if (!parsed.data.slug || (own && parsed.data.slug === own.slug)) {
    if (!own) throw new ServiceError('NOT_FOUND', NO_OWN_PERSON_MESSAGE);
    target = own;
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
  const reason = (parsed.data.reason ?? '').trim();
  if (asStaff && reason.length === 0) {
    throw new ServiceError('BAD_REQUEST', 'Say why the photo is removed: the owner reads it.', { reason: 'Say why the photo is removed: the owner reads it.' });
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

export interface PhotoFile {
  body: ReadableStream<Uint8Array>;
  size: number;
  /** The full content hash, for the ETag. */
  sha256: string;
  /** Whether the person is public: a shared cache may then keep the answer for a while. */
  public: boolean;
}

const ADDRESS = {
  id: z.uuid(),
  hash: z.string().regex(new RegExp(`^[0-9a-f]{${PHOTO_HASH_LENGTH}}$`)),
  file: z.enum(PHOTO_SIZES.map((size) => `${size}.webp`) as [string, ...string[]]),
};

/**
 * One rendition for GET /api/photos/<id>/<hash>/<size>.webp: only the current photo of a person
 * this viewer may see (the rule of getPhoto), and only at its current content hash. Everything
 * else is null (404): a malformed address, a replaced or removed photo, a hidden person.
 */
export async function openPhoto(
  principal: Principal | null,
  address: { id: string; hash: string; file: string },
  store: ObjectStore = getPhotoStore(),
): Promise<PhotoFile | null> {
  if (!ADDRESS.id.safeParse(address.id).success || !ADDRESS.hash.safeParse(address.hash).success || !ADDRESS.file.safeParse(address.file).success) return null;
  const size = Number(address.file.split('.')[0]) as PhotoSize;
  const [row] = await getDb()
    .select({ storageKey: personPhoto.storageKey, sha256: personPhoto.sha256, personId: personPhoto.personId, claimedBy: person.claimedByUserId })
    .from(personPhoto)
    .innerJoin(person, and(eq(person.id, personPhoto.personId), eq(person.photoId, personPhoto.id), isNull(person.deletedAt)))
    .where(and(eq(personPhoto.id, address.id), eq(personPhoto.status, 'active')));
  if (!row || !row.sha256.startsWith(address.hash)) return null;
  // Public exactly when v_public_person shows the person and this photo (app_public_ro): the rule
  // of the person pages (src/proxy.ts), so a hidden person's photo is 404 like their page.
  const isPublic = (await publicPhotoRefs(getPublicDb(), [row.personId])).get(row.personId)?.id === address.id;
  if (!isPublic) {
    const isOwn = principal !== null && row.claimedBy === principal.user.id;
    if (!isOwn && !hasStaff2FA(principal)) return null;
  }
  const object = await store.get(`${row.storageKey}/${size}`);
  if (!object) return null;
  return { body: object.body, size: object.size, sha256: row.sha256, public: isPublic };
}
