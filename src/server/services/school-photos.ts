// School photos (milestone M16; docs/adr/0019-galleries.md): a school's logo (one) and the photos
// of its training rooms (a separate gallery, at most SCHOOL_ROOM_PHOTOS_MAX, DEFAULT D07), shown on
// the public school page. Apart from every person's gallery: they never count against a person's
// `photos` allowance, and evidence never counts against either (DEFAULT D13).
//
// Who may do what (every function checks it itself, whoever calls it):
//   - upload, caption, reorder: the account that listed the school (school.created_by_user_id),
//     the one that edits it (M11); nobody else, staff included;
//   - remove: that account, or staff with a verified second factor with a reason (audited);
//   - read: everyone while the school is public (v_public_school), as part of its page
//     (schools.get) and through GET /api/school-photos/...; the listing account and staff with a
//     verified second factor also while it is not (the editor, the listing review). Anyone else
//     gets 404, the same as for no such school.
//
// The location rule (plan §6.4, CLAUDE.md §6): a photo's EXIF block can carry the GPS position
// where it was taken, the exact place of a city-only school. Every rendition is encoded again
// without any metadata (src/server/storage/photo.ts; gallery-photo.test.ts), so no position
// reaches the store, a response or a log. Logs and audit rows carry ids, sizes and hashes, never a
// caption, a storage key or a file name.

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { hasStaff2FA, requireStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { invalidatePublic, SCHOOLS_TAG } from '../cache';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { school, schoolPhoto } from '../db/schema';
import { PHOTO_CAPTION_MAX, PHOTO_REASON_MAX, SCHOOL_PHOTO_KINDS, SCHOOL_ROOM_PHOTOS_MAX } from '../db/schema/common';
import type { GalleryPhotoDto, SchoolLogoDto } from '../dto/gallery';
import type { Executor } from '../entitlements/access';
import { getPhotoStore, newStorageKey, type ObjectStore } from '../storage';
import { PhotoRefused, renderGalleryPhoto, renderSchoolLogo } from '../storage/photo';
import { readObjectBytes } from '../storage/read';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { schoolPhotoUrl } from './photo-refs';
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

const NOT_FOUND_MESSAGE = 'No such school.';
const NO_PHOTO_MESSAGE = 'No such photo of your school.';
export const SCHOOL_ROOMS_FULL_MESSAGE = `A school's gallery holds up to ${SCHOOL_ROOM_PHOTOS_MAX} photos of its rooms. Remove one first.`;

// --- Input -------------------------------------------------------------------------------------

const caption = z
  .string()
  .max(PHOTO_CAPTION_MAX * 2, { error: `At most ${PHOTO_CAPTION_MAX} characters.` })
  .nullish();

/** schoolPhotos.get: the photos of one of the account's schools, for its editor. */
export const schoolPhotosGetInput = z.object({ schoolId: z.uuid({ error: 'No such school.' }) });

/** schoolPhotos.upload: the logo (replacing the old one) or one more room photo, multipart. */
export const schoolPhotoUploadInput = z.object({
  schoolId: z.uuid({ error: 'No such school.' }),
  kind: z.enum(SCHOOL_PHOTO_KINDS, { error: 'Choose the logo or a room photo.' }),
  file: z.file({ error: 'Choose a photo.' }),
  caption: caption.optional(),
});

/** schoolPhotos.remove: a photo of the own school, or for staff any school's with a reason. */
export const schoolPhotoRemoveInput = z.object({
  photoId: z.uuid({ error: 'Choose a photo.' }),
  reason: z.string().max(PHOTO_REASON_MAX * 2).optional(),
});

/** schoolPhotos.update: the caption of a room photo (null or empty removes it). */
export const schoolPhotoUpdateInput = z.object({ photoId: z.uuid({ error: 'Choose a photo.' }), caption });

/** schoolPhotos.reorder: every room photo of the school, in its new order. */
export const schoolPhotoReorderInput = z.object({
  schoolId: z.uuid({ error: 'No such school.' }),
  photoIds: z.array(z.uuid()).min(1).max(SCHOOL_ROOM_PHOTOS_MAX * 2),
});

// --- Views -------------------------------------------------------------------------------------

export interface SchoolPhotosView {
  schoolId: string;
  logo: SchoolLogoDto | null;
  rooms: GalleryPhotoDto[];
  /** DEFAULT D07 (M16): the room gallery's limit. */
  limit: number;
  /** The listing account: may upload, caption, reorder and remove. */
  canChange: boolean;
  /** Staff with a verified second factor: may remove any photo, with a reason. */
  canModerate: boolean;
}

interface Row {
  id: string;
  kind: string;
  sha256: string;
  width: number;
  fullWidth: number | null;
  fullHeight: number | null;
  caption: string | null;
}

const logoDto = (r: Row): SchoolLogoDto => ({ id: r.id, small: schoolPhotoUrl(r.id, r.sha256, 96), large: schoolPhotoUrl(r.id, r.sha256, 512) });

function roomDto(r: Row): GalleryPhotoDto {
  const hasFull = r.fullWidth !== null && r.fullHeight !== null;
  return {
    id: r.id,
    small: schoolPhotoUrl(r.id, r.sha256, 96),
    large: schoolPhotoUrl(r.id, r.sha256, 512),
    full: schoolPhotoUrl(r.id, r.sha256, 'full'),
    width: hasFull ? r.fullWidth! : r.width,
    height: hasFull ? r.fullHeight! : r.width,
    caption: r.caption,
  };
}

/** The shown photos of these schools: the logo and the room photos in their order. */
export async function schoolPhotosOf(db: Executor, schoolId: string): Promise<{ logo: SchoolLogoDto | null; rooms: GalleryPhotoDto[] }> {
  const rows = await db
    .select({
      id: schoolPhoto.id,
      kind: schoolPhoto.kind,
      sha256: schoolPhoto.sha256,
      width: schoolPhoto.width,
      fullWidth: schoolPhoto.fullWidth,
      fullHeight: schoolPhoto.fullHeight,
      caption: schoolPhoto.caption,
    })
    .from(schoolPhoto)
    .where(and(eq(schoolPhoto.schoolId, schoolId), eq(schoolPhoto.status, 'active')))
    .orderBy(asc(schoolPhoto.position), asc(schoolPhoto.createdAt), asc(schoolPhoto.id));
  const logo = rows.find((r) => r.kind === 'logo');
  return { logo: logo ? logoDto(logo) : null, rooms: rows.filter((r) => r.kind === 'room').map(roomDto) };
}

function cleanCaption(raw: string | null | undefined): string | null {
  const value = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (value.length > PHOTO_CAPTION_MAX) throw new ServiceError('BAD_REQUEST', `At most ${PHOTO_CAPTION_MAX} characters.`, { caption: `At most ${PHOTO_CAPTION_MAX} characters.` });
  return value.length === 0 ? null : value;
}

function fieldErrors(error: z.ZodError): ServiceError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (key === 'caption') fields.caption = `At most ${PHOTO_CAPTION_MAX} characters.`;
    else if (key === 'reason') fields.reason = `At most ${PHOTO_REASON_MAX} characters.`;
    else if (key === 'kind') fields.kind = 'Choose the logo or a room photo.';
    else if (key === 'file') fields.file = 'Choose a photo.';
    else fields[key] = issue.message;
  }
  return new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
}

/** The school, when it is not deleted; and whether this account listed it. */
async function schoolOf(db: Executor, schoolId: string, lock = false): Promise<{ id: string; createdBy: string | null } | null> {
  const query = db
    .select({ id: school.id, createdBy: school.createdByUserId })
    .from(school)
    .where(and(eq(school.id, schoolId), isNull(school.deletedAt)));
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

/** The listing account's own school, locked for a change; 404 for any other. */
async function lockOwnSchool(tx: Executor, userId: string, schoolId: string): Promise<void> {
  const row = await schoolOf(tx, schoolId, true);
  if (!row || row.createdBy !== userId) throw new ServiceError('NOT_FOUND', NOT_FOUND_MESSAGE);
}

function changed(): void {
  // The school pages and the finder's answers are cached under `schools`.
  invalidatePublic([SCHOOLS_TAG], 'procedure');
}

// --- Read --------------------------------------------------------------------------------------

/** schoolPhotos.get: the photos of a school for its editor (the listing account) or for staff with 2FA. */
export async function getSchoolPhotos(principal: Principal | null, raw: z.input<typeof schoolPhotosGetInput>): Promise<SchoolPhotosView> {
  const p = requireUser(principal);
  const parsed = schoolPhotosGetInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', NOT_FOUND_MESSAGE);
  const db = getDb();
  const row = await schoolOf(db, parsed.data.schoolId);
  const own = row !== null && row.createdBy === p.user.id;
  const staff = hasStaff2FA(p);
  if (!row || (!own && !staff)) {
    if (row && !own && p.user.role !== 'user') requireStaff2FA(p);
    throw new ServiceError('NOT_FOUND', NOT_FOUND_MESSAGE);
  }
  const photos = await schoolPhotosOf(db, row.id);
  return {
    schoolId: row.id,
    ...photos,
    limit: SCHOOL_ROOM_PHOTOS_MAX,
    canChange: own,
    canModerate: staff && (photos.logo !== null || photos.rooms.length > 0),
  };
}

// --- Upload ------------------------------------------------------------------------------------

/**
 * schoolPhotos.upload: the school's logo (a new one replaces the old one) or one more photo of its
 * rooms, at most SCHOOL_ROOM_PHOTOS_MAX (DEFAULT D07; CONFLICT past it, counted with the school row
 * locked, so two uploads at once never pass the limit together).
 */
export async function uploadSchoolPhoto(
  principal: Principal | null,
  raw: z.input<typeof schoolPhotoUploadInput>,
  meta: RequestMeta,
  store: ObjectStore = getPhotoStore(),
): Promise<{ schoolId: string; logo: SchoolLogoDto | null; room: GalleryPhotoDto | null; replaced: boolean }> {
  const p = requireUser(principal);
  const parsed = schoolPhotoUploadInput.safeParse(raw);
  if (!parsed.success) {
    // A malformed school id says nothing about any school.
    if (parsed.error.issues.some((i) => i.path[0] === 'schoolId')) throw new ServiceError('NOT_FOUND', NOT_FOUND_MESSAGE);
    throw fieldErrors(parsed.error);
  }
  const { schoolId, kind } = parsed.data;
  const owned = await schoolOf(getDb(), schoolId);
  if (!owned || owned.createdBy !== p.user.id) throw new ServiceError('NOT_FOUND', NOT_FOUND_MESSAGE);
  const text = kind === 'room' ? cleanCaption(parsed.data.caption) : null;
  const bytes = await fileBytes(parsed.data.file);
  let rendered: { side: number; renditions: Record<96 | 512, Uint8Array>; full?: { bytes: Uint8Array; width: number; height: number } };
  try {
    rendered = kind === 'logo' ? await renderSchoolLogo(bytes) : await renderGalleryPhoto(bytes);
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
  const id = uuidv7();
  let previous: { id: string; storageKey: string } | null = null;
  let row: Row;
  try {
    await putRenditions(store, key, rendered);
    const outcome = await getDb().transaction(async (tx) => {
      await lockOwnSchool(tx, p.user.id, schoolId);
      const now = new Date();
      let old: { id: string; storageKey: string } | null = null;
      let position = 0;
      if (kind === 'logo') {
        const [current] = await tx
          .select({ id: schoolPhoto.id, storageKey: schoolPhoto.storageKey })
          .from(schoolPhoto)
          .where(and(eq(schoolPhoto.schoolId, schoolId), eq(schoolPhoto.kind, 'logo'), eq(schoolPhoto.status, 'active')));
        if (current) {
          await tx.update(schoolPhoto).set({ status: 'replaced', updatedAt: now }).where(eq(schoolPhoto.id, current.id));
          old = current;
        }
      } else {
        const counted = await tx.execute(
          sql`SELECT count(*)::int AS n, COALESCE(MAX(position), -1) + 1 AS next FROM school_photo WHERE school_id = ${schoolId}::uuid AND kind = 'room' AND status = 'active'`,
        );
        // DEFAULT D07 (M16): the room gallery's own limit.
        if (Number(counted.rows[0]?.n ?? 0) >= SCHOOL_ROOM_PHOTOS_MAX) throw new ServiceError('CONFLICT', SCHOOL_ROOMS_FULL_MESSAGE, { file: SCHOOL_ROOMS_FULL_MESSAGE });
        position = Number(counted.rows[0]?.next ?? 0);
      }
      const values = {
        id,
        schoolId,
        kind,
        storageKey: key,
        sha256: content,
        originalSha256: sha256(bytes),
        width: rendered.side,
        height: rendered.side,
        fullWidth: rendered.full?.width ?? null,
        fullHeight: rendered.full?.height ?? null,
        sizeBytes: large.byteLength,
        caption: text,
        position,
        status: 'active' as const,
        uploadedByUserId: p.user.id,
      };
      await tx.insert(schoolPhoto).values(values);
      await writeAudit(tx, {
        action: 'school_photo.upload',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'school',
        subjectId: schoolId,
        before: old ? { photoId: old.id } : null,
        after: { photoId: id, kind, side: rendered.side, sizeBytes: large.byteLength, sha256: content },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      return { old, row: values };
    });
    previous = outcome.old;
    row = outcome.row;
  } catch (error) {
    await deleteFiles(store, key, id);
    throw error;
  }
  if (previous) await deleteFiles(store, previous.storageKey, previous.id);
  changed();
  return { schoolId, logo: kind === 'logo' ? logoDto(row) : null, room: kind === 'room' ? roomDto(row) : null, replaced: previous !== null };
}

// --- Remove, caption, order --------------------------------------------------------------------

/** schoolPhotos.remove: the listing account's, or staff with a verified second factor with a reason. */
export async function removeSchoolPhoto(
  principal: Principal | null,
  raw: z.input<typeof schoolPhotoRemoveInput>,
  meta: RequestMeta,
  store: ObjectStore = getPhotoStore(),
): Promise<{ schoolId: string; removed: boolean }> {
  const p = requireUser(principal);
  const parsed = schoolPhotoRemoveInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const reason = (parsed.data.reason ?? '').trim();
  const [row] = await getDb()
    .select({ id: schoolPhoto.id, schoolId: schoolPhoto.schoolId, createdBy: school.createdByUserId })
    .from(schoolPhoto)
    .innerJoin(school, and(eq(school.id, schoolPhoto.schoolId), isNull(school.deletedAt)))
    .where(and(eq(schoolPhoto.id, parsed.data.photoId), eq(schoolPhoto.status, 'active')));
  const own = row !== undefined && row.createdBy === p.user.id;
  const asStaff = hasStaff2FA(p) && (!own || reason.length > 0);
  if (!row || (!own && !asStaff)) {
    if (!own && p.user.role !== 'user') requireStaff2FA(p);
    throw new ServiceError('NOT_FOUND', NO_PHOTO_MESSAGE);
  }
  if (asStaff && reason.length === 0) {
    throw new ServiceError('BAD_REQUEST', 'Say why the photo is removed: the reason is kept in the audit log.', { reason: 'Say why the photo is removed: the reason is kept in the audit log.' });
  }
  if (reason.length > PHOTO_REASON_MAX) throw new ServiceError('BAD_REQUEST', `At most ${PHOTO_REASON_MAX} characters.`, { reason: `At most ${PHOTO_REASON_MAX} characters.` });
  const removed = await getDb().transaction(async (tx) => {
    await tx.select({ id: school.id }).from(school).where(eq(school.id, row.schoolId)).for('update');
    const [current] = await tx
      .select({ id: schoolPhoto.id, storageKey: schoolPhoto.storageKey, kind: schoolPhoto.kind })
      .from(schoolPhoto)
      .where(and(eq(schoolPhoto.id, row.id), eq(schoolPhoto.status, 'active')));
    if (!current) return null;
    const now = new Date();
    await tx
      .update(schoolPhoto)
      .set({ status: 'removed', removedAt: now, removedByUserId: p.user.id, removalReason: asStaff ? reason : null, updatedAt: now })
      .where(eq(schoolPhoto.id, current.id));
    await writeAudit(tx, {
      action: 'school_photo.remove',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'school',
      subjectId: row.schoolId,
      before: { photoId: current.id, kind: current.kind },
      after: { by: asStaff ? 'staff' : 'owner' },
      reason: asStaff ? reason : null,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return current;
  });
  if (removed) {
    await deleteFiles(store, removed.storageKey, removed.id);
    changed();
  }
  return { schoolId: row.schoolId, removed: removed !== null };
}

/** schoolPhotos.update: the caption of a room photo of the own school. */
export async function updateSchoolPhoto(
  principal: Principal | null,
  raw: z.input<typeof schoolPhotoUpdateInput>,
  meta: RequestMeta,
): Promise<{ schoolId: string; room: GalleryPhotoDto }> {
  const p = requireUser(principal);
  const parsed = schoolPhotoUpdateInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const text = cleanCaption(parsed.data.caption);
  const [found] = await getDb()
    .select({ schoolId: schoolPhoto.schoolId, createdBy: school.createdByUserId })
    .from(schoolPhoto)
    .innerJoin(school, and(eq(school.id, schoolPhoto.schoolId), isNull(school.deletedAt)))
    .where(and(eq(schoolPhoto.id, parsed.data.photoId), eq(schoolPhoto.kind, 'room'), eq(schoolPhoto.status, 'active')));
  if (!found || found.createdBy !== p.user.id) throw new ServiceError('NOT_FOUND', NO_PHOTO_MESSAGE);
  const updated = await getDb().transaction(async (tx) => {
    await lockOwnSchool(tx, p.user.id, found.schoolId);
    const [r] = await tx
      .update(schoolPhoto)
      .set({ caption: text, updatedAt: new Date() })
      .where(and(eq(schoolPhoto.id, parsed.data.photoId), eq(schoolPhoto.status, 'active')))
      .returning({
        id: schoolPhoto.id,
        kind: schoolPhoto.kind,
        sha256: schoolPhoto.sha256,
        width: schoolPhoto.width,
        fullWidth: schoolPhoto.fullWidth,
        fullHeight: schoolPhoto.fullHeight,
        caption: schoolPhoto.caption,
      });
    if (!r) throw new ServiceError('NOT_FOUND', NO_PHOTO_MESSAGE);
    await writeAudit(tx, {
      action: 'school_photo.update',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'school',
      subjectId: found.schoolId,
      after: { photoId: r.id, caption: text === null ? 'none' : 'set' },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return r;
  });
  changed();
  return { schoolId: found.schoolId, room: roomDto(updated) };
}

/** schoolPhotos.reorder: every room photo of the own school once, in the new order (CONFLICT otherwise). */
export async function reorderSchoolPhotos(
  principal: Principal | null,
  raw: z.input<typeof schoolPhotoReorderInput>,
  meta: RequestMeta,
): Promise<{ schoolId: string; rooms: GalleryPhotoDto[] }> {
  const p = requireUser(principal);
  const parsed = schoolPhotoReorderInput.safeParse(raw);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === 'schoolId')) throw new ServiceError('NOT_FOUND', NOT_FOUND_MESSAGE);
    throw new ServiceError('BAD_REQUEST', 'Name every photo of the school once.');
  }
  const { schoolId, photoIds } = parsed.data;
  const rooms = await getDb().transaction(async (tx) => {
    await lockOwnSchool(tx, p.user.id, schoolId);
    const current = (await schoolPhotosOf(tx, schoolId)).rooms;
    const known = new Set(current.map((r) => r.id));
    if (new Set(photoIds).size !== photoIds.length || photoIds.length !== current.length || photoIds.some((id) => !known.has(id))) {
      throw new ServiceError('CONFLICT', 'The school’s photos changed in the meantime. Reload the page and try again.');
    }
    const now = new Date();
    for (const [index, id] of photoIds.entries()) await tx.update(schoolPhoto).set({ position: index, updatedAt: now }).where(eq(schoolPhoto.id, id));
    await writeAudit(tx, {
      action: 'school_photo.reorder',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'school',
      subjectId: schoolId,
      after: { photoIds },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return (await schoolPhotosOf(tx, schoolId)).rooms;
  });
  changed();
  return { schoolId, rooms };
}

// --- Serving -----------------------------------------------------------------------------------

/**
 * One rendition for GET /api/school-photos/<id>/<hash>/<size>.webp: a shown photo of a school
 * that is public (v_public_school) for everyone; of a school that is not, only for the listing
 * account and staff with a verified second factor. null (404) for everything else, one answer for
 * all. The read rules of openPhoto (photos.ts): the whole rendition within the deadline, and a
 * matching ETag answered without reading the store.
 */
export async function openSchoolPhoto(
  principal: Principal | null,
  address: { id: string; hash: string; file: string },
  store: ObjectStore = getPhotoStore(),
  options: OpenPhotoOptions = {},
): Promise<PhotoFile | null> {
  if (!PHOTO_ADDRESS.id.safeParse(address.id).success || !PHOTO_ADDRESS.hash.safeParse(address.hash).success || !PHOTO_ADDRESS.file.safeParse(address.file).success) return null;
  const db = getDb();
  const [row] = await db
    .select({ storageKey: schoolPhoto.storageKey, sha256: schoolPhoto.sha256, schoolId: schoolPhoto.schoolId, fullWidth: schoolPhoto.fullWidth, createdBy: school.createdByUserId })
    .from(schoolPhoto)
    .innerJoin(school, and(eq(school.id, schoolPhoto.schoolId), isNull(school.deletedAt)))
    .where(and(eq(schoolPhoto.id, address.id), eq(schoolPhoto.status, 'active')));
  if (!row || !row.sha256.startsWith(address.hash)) return null;
  const shown = await db.execute(sql`SELECT 1 AS one FROM v_public_school WHERE id = ${row.schoolId}::uuid`);
  const isPublic = shown.rows.length > 0;
  if (!isPublic) {
    const own = principal !== null && row.createdBy === principal.user.id;
    if (!own && !hasStaff2FA(principal)) return null;
  }
  if (etagMatches(options.ifNoneMatch, photoEtag(row.sha256))) return { notModified: true, sha256: row.sha256, public: isPublic };
  const bytes = await readObjectBytes(store, renditionFile(row.storageKey, address.file, row.fullWidth !== null), {
    timeoutMs: options.timeoutMs ?? PHOTO_READ_TIMEOUT_MS,
    maxBytes: PHOTO_RENDITION_MAX_BYTES,
    signal: options.signal,
  });
  if (!bytes) return null;
  return { notModified: false, bytes, sha256: row.sha256, public: isPublic };
}
