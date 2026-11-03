// Person galleries (milestone M16; docs/adr/0019-galleries.md). A person's gallery is their
// person_photo rows with status `active` (the profile photo, at most one, M14) or `gallery` (the
// other photos), in their `position` order. Every photo of it counts against the plan's `photos`
// allowance (DEFAULT D07: Free Student 1, Premium Student 10, Free Sifu 2, Professional Sifu 100,
// Federation without a number), counted under the quota lock (withQuota) in the transaction that
// adds it; a higher allowance comes only from an admin's grant (no payments). Evidence files are
// never gallery photos and never count (DEFAULT D13): they stay in the evidence store, private.
//
// Who may do what (every function checks it itself, whoever calls it):
//   - read (gallery.get): everyone for a person v_public_person shows; for a person who is not
//     public only the account whose own person it is and staff with a verified second factor;
//     anyone else gets 404, the same answer as for no such person (plan §6.4, ADR 0008);
//   - add, caption, reorder, choose the profile photo: the account whose own person it is
//     (person.claimed_by_user_id); nobody else, staff included;
//   - remove: that account, or staff with a verified second factor with a reason, kept with the
//     row and in the audit log (gallery.remove), the rule of M14's photos.remove.
//
// Every change is audited (gallery.add, gallery.remove, gallery.update, gallery.reorder,
// gallery.profile), with ids, sizes and hashes, never a name, a caption, a storage key or a file
// name (CLAUDE.md §6). The upload is processed as M14's (src/server/storage/photo.ts): the type by
// its magic bytes, the pixel limit, turned upright, every metadata block dropped (EXIF with its GPS
// position), the squares at 96 and 512 px and the whole photo at most 1280 px, as WebP.

import { allowanceSentence } from '@/lib/allowance-text';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { hasStaff2FA, requireStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { invalidatePublic, personTag, SCHOOLS_TAG } from '../cache';
import { getDb, getPublicDb } from '../db';
import { uuidv7 } from '../db/ids';
import { person, personName, personPhoto } from '../db/schema';
import { GALLERY_PHOTO_STATUSES, PHOTO_CAPTION_MAX, PHOTO_REASON_MAX } from '../db/schema/common';
import { type PersonGalleryPhotoDto, toPublicGallery } from '../dto/gallery';
import { effectivePlan, type Executor, requireEntitlement } from '../entitlements/access';
import { feature, upgradeBenefits } from '../entitlements/plans';
import { withQuota } from '../entitlements/quota';
import { getPhotoStore, newStorageKey, type ObjectStore } from '../storage';
import { PhotoRefused, renderGalleryPhoto } from '../storage/photo';
import type { RequestMeta } from './context';
import { offerText, type UpgradeOffer } from './dashboard';
import { ServiceError } from './errors';
import { photoUrl } from './photo-refs';
import { deleteFiles, fileBytes, isPublicPerson, NO_OWN_PERSON_MESSAGE, ownPerson, photoGetInput, putRenditions, refusalMessage, sha256 } from './photos';
import { openPilotRequest, planSummary } from './plans';

const NOT_FOUND_MESSAGE = 'No such person.';
const NO_PHOTO_MESSAGE = 'No such photo in your gallery.';
export const GALLERY_FULL_MESSAGE = 'Your plan has no room for another photo.';

// --- Input -------------------------------------------------------------------------------------

/** A caption: trimmed; empty means none. */
const caption = z
  .string()
  .max(PHOTO_CAPTION_MAX * 2, { error: `At most ${PHOTO_CAPTION_MAX} characters.` })
  .nullish();

/** gallery.get: a person's gallery. */
export const galleryGetInput = photoGetInput;

/** gallery.add: one image file for the own gallery, with an optional caption. */
export const galleryAddInput = z.object({
  file: z.file({ error: 'Choose a photo.' }),
  caption: caption.optional(),
});

/** gallery.remove: a photo of the own gallery, or for staff anyone's with a reason. */
export const galleryRemoveInput = z.object({
  photoId: z.uuid({ error: 'Choose a photo.' }),
  reason: z.string().max(PHOTO_REASON_MAX * 2).optional(),
});

/** gallery.update: the caption of a photo of the own gallery (null or empty removes it). */
export const galleryUpdateInput = z.object({
  photoId: z.uuid({ error: 'Choose a photo.' }),
  caption,
});

/** gallery.reorder: every photo of the own gallery, in its new order. */
export const galleryReorderInput = z.object({
  photoIds: z.array(z.uuid()).min(1).max(500),
});

/** gallery.setProfile: which photo of the own gallery is the profile photo. */
export const gallerySetProfileInput = z.object({
  photoId: z.uuid({ error: 'Choose a photo.' }),
});

// --- Views -------------------------------------------------------------------------------------

export interface GalleryAllowance {
  /** Photos in the gallery now (the profile photo among them). */
  used: number;
  /** The plan's allowance; null for no number (Federation). */
  limit: number | null;
  planName: string;
  /** "You have added 1 of 1 photo on Free Student." */
  sentence: string;
  /** Whether one more photo fits. */
  canAdd: boolean;
}

export interface GalleryView {
  personId: string;
  slug: string;
  displayName: string;
  photos: PersonGalleryPhotoDto[];
  /** The account whose own person it is: may add, caption, reorder, choose and remove. */
  canChange: boolean;
  /** Staff with a verified second factor: may remove any photo, with a reason. */
  canModerate: boolean;
  /** The owner's allowance (null for anyone else). */
  allowance: GalleryAllowance | null;
  /**
   * The owner's upgrade prompt, only at the real limit and only when a higher plan of the pilot
   * gives more (plan §5.6, CLAUDE.md §11); null otherwise.
   */
  upgrade: UpgradeOffer | null;
}

// --- Helpers -----------------------------------------------------------------------------------

function notFound(): ServiceError {
  return new ServiceError('NOT_FOUND', NOT_FOUND_MESSAGE);
}

function cleanCaption(raw: string | null | undefined): string | null {
  const value = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (value.length > PHOTO_CAPTION_MAX) throw new ServiceError('BAD_REQUEST', `At most ${PHOTO_CAPTION_MAX} characters.`, { caption: `At most ${PHOTO_CAPTION_MAX} characters.` });
  return value.length === 0 ? null : value;
}

function fieldErrors(error: z.ZodError, fallback: string): ServiceError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (key === 'caption') fields.caption = `At most ${PHOTO_CAPTION_MAX} characters.`;
    else if (key === 'reason') fields.reason = `At most ${PHOTO_REASON_MAX} characters.`;
    else if (key === 'file') fields.file = 'Choose a photo.';
    else fields[key] = fallback;
  }
  return new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
}

interface GalleryRow {
  id: string;
  sha256: string;
  width: number;
  fullWidth: number | null;
  fullHeight: number | null;
  caption: string | null;
  status: string;
  position: number;
}

/** The gallery of a person, in its order: the photos of statuses active and gallery. */
async function galleryRows(db: Executor, personId: string): Promise<GalleryRow[]> {
  return db
    .select({
      id: personPhoto.id,
      sha256: personPhoto.sha256,
      width: personPhoto.width,
      fullWidth: personPhoto.fullWidth,
      fullHeight: personPhoto.fullHeight,
      caption: personPhoto.caption,
      status: personPhoto.status,
      position: personPhoto.position,
    })
    .from(personPhoto)
    .where(and(eq(personPhoto.personId, personId), inArray(personPhoto.status, [...GALLERY_PHOTO_STATUSES])))
    .orderBy(asc(personPhoto.position), asc(personPhoto.createdAt), asc(personPhoto.id));
}

/** The DTO of a gallery photo (its addresses, never its key); the profile photo is the active one. */
export function galleryPhotoDto(row: GalleryRow): PersonGalleryPhotoDto {
  const hasFull = row.fullWidth !== null && row.fullHeight !== null;
  return {
    id: row.id,
    small: photoUrl(row.id, row.sha256, 96),
    large: photoUrl(row.id, row.sha256, 512),
    full: photoUrl(row.id, row.sha256, 'full'),
    width: hasFull ? row.fullWidth! : row.width,
    height: hasFull ? row.fullHeight! : row.width,
    caption: row.caption,
    isProfile: row.status === 'active',
  };
}

async function primaryName(db: Executor, personId: string): Promise<string> {
  const [row] = await db
    .select({ value: personName.value })
    .from(personName)
    .where(and(eq(personName.personId, personId), eq(personName.isPrimary, true)));
  return row?.value ?? '';
}

/** The owner's allowance and, at the real limit, the upgrade prompt (only 'now' benefits). */
async function allowanceOf(db: Executor, userId: string): Promise<{ allowance: GalleryAllowance; upgrade: UpgradeOffer | null }> {
  const subject = { kind: 'user' as const, userId };
  const decision = await requireEntitlement(subject, 'photos', { db });
  const { plan } = await effectivePlan(subject, { db });
  const from = planSummary(plan);
  const unit = feature('photos').unit!;
  const limit = decision.limit;
  const used = decision.current;
  // Over the limit (a downgrade, an ended grant): "You have 3 photos; Free Student includes 1. …".
  const sentence = allowanceSentence(unit, used, limit, from.name, true);
  const allowance: GalleryAllowance = { used, limit, planName: from.name, sentence, canAdd: decision.ok };
  let upgrade: UpgradeOffer | null = null;
  // Only at the real limit (plan §5.6): the allowance is used up and a higher plan of the pilot
  // gives more; its benefits are only the features available now (upgradeBenefits).
  if (!decision.ok && decision.code === 'quota' && decision.grantedBy && limit !== null) {
    const to = planSummary(decision.grantedBy);
    const text = offerText('photos', used, limit, from, to);
    upgrade = {
      feature: 'photos',
      heading: text.heading,
      allowance: { current: used, limit, sentence: text.sentence },
      from,
      to,
      benefits: upgradeBenefits(decision.plan, decision.grantedBy, 'photos'),
      waiting: null,
      pilotRequest: await openPilotRequest(db, userId),
    };
  }
  return { allowance, upgrade };
}

/** Locks the own person row for a change of its gallery; 404 when it is no longer the account's. */
async function lockOwn(tx: Executor, userId: string, personId: string): Promise<void> {
  const [locked] = await tx
    .select({ claimedBy: person.claimedByUserId, deletedAt: person.deletedAt })
    .from(person)
    .where(eq(person.id, personId))
    .for('update');
  if (!locked || locked.claimedBy !== userId || locked.deletedAt) throw new ServiceError('NOT_FOUND', NO_OWN_PERSON_MESSAGE);
}

function changed(personId: string): void {
  // The profile photo is on the school pages too (the instructors).
  invalidatePublic([personTag(personId), SCHOOLS_TAG], 'procedure');
}

// --- Read --------------------------------------------------------------------------------------

/**
 * gallery.get: a person's gallery for this viewer (the rule of the person pages: 404 for a
 * person this viewer may not see). The owner also gets the allowance and, at the limit, the
 * upgrade prompt.
 */
export async function getGallery(principal: Principal | null, raw: z.input<typeof galleryGetInput>): Promise<GalleryView> {
  const parsed = galleryGetInput.safeParse(raw);
  if (!parsed.success) throw notFound();
  const db = getDb();
  const [row] = await db
    .select({ id: person.id, slug: person.slug, claimedBy: person.claimedByUserId })
    .from(person)
    .where(and(eq(person.slug, parsed.data.slug), isNull(person.deletedAt)));
  if (!row) throw notFound();
  const isOwn = principal !== null && row.claimedBy === principal.user.id;
  const staff = hasStaff2FA(principal);
  // Public exactly when v_public_person shows the person (app_public_ro), as the person pages.
  const isPublic = await isPublicPerson(getPublicDb(), row.id);
  if (!isPublic && !isOwn && !staff) throw notFound();
  const photos = (await galleryRows(db, row.id)).map(galleryPhotoDto);
  const displayName = await primaryName(db, row.id);
  const owner = isOwn ? await allowanceOf(db, principal!.user.id) : null;
  return {
    // The public part through its schema, which keeps nothing else.
    ...toPublicGallery({ personId: row.id, slug: row.slug, displayName, photos }),
    canChange: isOwn,
    canModerate: staff && photos.length > 0,
    allowance: owner?.allowance ?? null,
    upgrade: owner?.upgrade ?? null,
  };
}

/** gallery.mine: the signed-in account's own gallery, with its allowance (404 without a profile yet). */
export async function getOwnGallery(principal: Principal | null): Promise<GalleryView> {
  const p = requireUser(principal);
  const own = await ownPerson(p.user.id);
  if (!own) throw new ServiceError('NOT_FOUND', NO_OWN_PERSON_MESSAGE);
  return getGallery(p, { slug: own.slug });
}

// --- Add ---------------------------------------------------------------------------------------

export interface AddedGalleryPhoto {
  personId: string;
  slug: string;
  photo: PersonGalleryPhotoDto;
}

/**
 * gallery.add: a new photo at the end of the own gallery. The first photo of a person without a
 * profile photo becomes the profile photo. Refused with ENTITLEMENT_REQUIRED (and the refusal of
 * requireEntitlement in `details`) when the plan's allowance is used up (DEFAULT D07).
 */
export async function addGalleryPhoto(
  principal: Principal | null,
  raw: z.input<typeof galleryAddInput>,
  meta: RequestMeta,
  store: ObjectStore = getPhotoStore(),
): Promise<AddedGalleryPhoto> {
  const p = requireUser(principal);
  const own = await ownPerson(p.user.id);
  if (!own) throw new ServiceError('NOT_FOUND', NO_OWN_PERSON_MESSAGE);
  const parsed = galleryAddInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error, 'Choose a photo.');
  const text = cleanCaption(parsed.data.caption);
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
  const large = rendered.renditions[512];
  const content = sha256(large);
  const key = newStorageKey('photos');
  const id = uuidv7();
  let added: GalleryRow;
  try {
    await putRenditions(store, key, rendered);
    const outcome = await getDb().transaction(async (tx) =>
      // DEFAULT D07: every photo of the gallery counts against 'photos' (no unit: a new photo never
      // replaces one); the count and the write share the quota lock.
      withQuota(tx, { kind: 'user', userId: p.user.id }, 'photos', async () => {
        await lockOwn(tx, p.user.id, own.id);
        const [current] = await tx
          .select({ photoId: person.photoId })
          .from(person)
          .innerJoin(personPhoto, and(eq(personPhoto.id, person.photoId), eq(personPhoto.status, 'active')))
          .where(eq(person.id, own.id));
        const asProfile = !current;
        const last = await tx.execute(
          sql`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM person_photo WHERE person_id = ${own.id}::uuid AND status IN ('active', 'gallery')`,
        );
        const position = Number(last.rows[0]?.p ?? 0);
        const now = new Date();
        const values = {
          id,
          personId: own.id,
          storageKey: key,
          sha256: content,
          originalSha256: sha256(bytes),
          width: rendered.side,
          height: rendered.side,
          fullWidth: rendered.full.width,
          fullHeight: rendered.full.height,
          sizeBytes: large.byteLength,
          caption: text,
          position,
          status: asProfile ? ('active' as const) : ('gallery' as const),
          uploadedByUserId: p.user.id,
        };
        await tx.insert(personPhoto).values(values);
        if (asProfile) await tx.update(person).set({ photoId: id, updatedAt: now }).where(eq(person.id, own.id));
        await writeAudit(tx, {
          action: 'gallery.add',
          actorUserId: p.user.id,
          actorRole: p.user.role,
          subjectType: 'person',
          subjectId: own.id,
          after: { photoId: id, side: rendered.side, sizeBytes: large.byteLength, sha256: content, profile: asProfile },
          requestId: meta.requestId,
          ipHmac: meta.ipHmac,
        });
        return { ...values, status: values.status as string } satisfies GalleryRow;
      }),
    );
    if (!outcome.ok) {
      throw new ServiceError('ENTITLEMENT_REQUIRED', GALLERY_FULL_MESSAGE, { file: GALLERY_FULL_MESSAGE }, { entitlement: { ...outcome, key: 'photos' } });
    }
    added = outcome.value;
  } catch (error) {
    await deleteFiles(store, key, id);
    throw error;
  }
  changed(own.id);
  return { personId: own.id, slug: own.slug, photo: galleryPhotoDto(added) };
}

// --- Remove ------------------------------------------------------------------------------------

/**
 * gallery.remove: a photo of the own gallery, or as staff with a verified second factor anyone's,
 * with a required reason (as M14's photos.remove). The row stays (`removed`, who, when, why), the
 * files go. Removing the profile photo leaves the person without one (the monogram).
 */
export async function removeGalleryPhoto(
  principal: Principal | null,
  raw: z.input<typeof galleryRemoveInput>,
  meta: RequestMeta,
  store: ObjectStore = getPhotoStore(),
): Promise<{ personId: string; slug: string; removed: boolean }> {
  const p = requireUser(principal);
  const parsed = galleryRemoveInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error, 'Choose a photo.');
  const reason = (parsed.data.reason ?? '').trim();
  const [row] = await getDb()
    .select({ id: personPhoto.id, personId: personPhoto.personId, slug: person.slug, claimedBy: person.claimedByUserId })
    .from(personPhoto)
    .innerJoin(person, and(eq(person.id, personPhoto.personId), isNull(person.deletedAt)))
    .where(and(eq(personPhoto.id, parsed.data.photoId), inArray(personPhoto.status, [...GALLERY_PHOTO_STATUSES])));
  const isOwn = row !== undefined && row.claimedBy === p.user.id;
  // Staff with a reason remove as staff, even from their own gallery (M14's rule).
  const asStaff = hasStaff2FA(p) && (!isOwn || reason.length > 0);
  if (!row || (!isOwn && !asStaff)) {
    // Someone else's photo: a signed-in account that is not staff learns nothing (404); staff
    // without a verified second factor are told to confirm the session.
    if (!isOwn && p.user.role !== 'user') requireStaff2FA(p);
    throw new ServiceError('NOT_FOUND', NO_PHOTO_MESSAGE);
  }
  if (asStaff && reason.length === 0) {
    throw new ServiceError('BAD_REQUEST', 'Say why the photo is removed: the reason is kept in the audit log.', { reason: 'Say why the photo is removed: the reason is kept in the audit log.' });
  }
  if (reason.length > PHOTO_REASON_MAX) {
    throw new ServiceError('BAD_REQUEST', `At most ${PHOTO_REASON_MAX} characters.`, { reason: `At most ${PHOTO_REASON_MAX} characters.` });
  }
  const removed = await getDb().transaction(async (tx) => {
    await tx.select({ id: person.id }).from(person).where(eq(person.id, row.personId)).for('update');
    const [current] = await tx
      .select({ id: personPhoto.id, storageKey: personPhoto.storageKey, status: personPhoto.status })
      .from(personPhoto)
      .where(and(eq(personPhoto.id, row.id), inArray(personPhoto.status, [...GALLERY_PHOTO_STATUSES])));
    if (!current) return null;
    const now = new Date();
    await tx
      .update(personPhoto)
      .set({ status: 'removed', removedAt: now, removedByUserId: p.user.id, removalReason: asStaff ? reason : null, updatedAt: now })
      .where(eq(personPhoto.id, current.id));
    if (current.status === 'active') await tx.update(person).set({ photoId: null, updatedAt: now }).where(eq(person.id, row.personId));
    await writeAudit(tx, {
      action: 'gallery.remove',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'person',
      subjectId: row.personId,
      before: { photoId: current.id, profile: current.status === 'active' },
      after: { by: asStaff ? 'staff' : 'owner' },
      reason: asStaff ? reason : null,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return current;
  });
  if (removed) {
    await deleteFiles(store, removed.storageKey, removed.id);
    changed(row.personId);
  }
  return { personId: row.personId, slug: row.slug, removed: removed !== null };
}

// --- Caption, order, profile photo ----------------------------------------------------------------

/** The own person and one photo of its gallery, for a change by the owner (404 otherwise). */
async function ownPhoto(userId: string, photoId: string): Promise<{ personId: string; slug: string }> {
  const own = await ownPerson(userId);
  if (!own) throw new ServiceError('NOT_FOUND', NO_OWN_PERSON_MESSAGE);
  const [row] = await getDb()
    .select({ id: personPhoto.id })
    .from(personPhoto)
    .where(and(eq(personPhoto.id, photoId), eq(personPhoto.personId, own.id), inArray(personPhoto.status, [...GALLERY_PHOTO_STATUSES])));
  if (!row) throw new ServiceError('NOT_FOUND', NO_PHOTO_MESSAGE);
  return { personId: own.id, slug: own.slug };
}

/** gallery.update: the caption of a photo of the own gallery (the viewer's alt text). */
export async function updateGalleryPhoto(
  principal: Principal | null,
  raw: z.input<typeof galleryUpdateInput>,
  meta: RequestMeta,
): Promise<{ personId: string; photo: PersonGalleryPhotoDto }> {
  const p = requireUser(principal);
  const parsed = galleryUpdateInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error, 'Choose a photo.');
  const text = cleanCaption(parsed.data.caption);
  const { personId } = await ownPhoto(p.user.id, parsed.data.photoId);
  const row = await getDb().transaction(async (tx) => {
    await lockOwn(tx, p.user.id, personId);
    const [updated] = await tx
      .update(personPhoto)
      .set({ caption: text, updatedAt: new Date() })
      .where(and(eq(personPhoto.id, parsed.data.photoId), eq(personPhoto.personId, personId), inArray(personPhoto.status, [...GALLERY_PHOTO_STATUSES])))
      .returning({
        id: personPhoto.id,
        sha256: personPhoto.sha256,
        width: personPhoto.width,
        fullWidth: personPhoto.fullWidth,
        fullHeight: personPhoto.fullHeight,
        caption: personPhoto.caption,
        status: personPhoto.status,
        position: personPhoto.position,
      });
    if (!updated) throw new ServiceError('NOT_FOUND', NO_PHOTO_MESSAGE);
    // The caption is the owner's words: the audit says only that it changed.
    await writeAudit(tx, {
      action: 'gallery.update',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'person',
      subjectId: personId,
      after: { photoId: updated.id, caption: text === null ? 'none' : 'set' },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return updated;
  });
  changed(personId);
  return { personId, photo: galleryPhotoDto(row) };
}

/**
 * gallery.reorder: the new order of the own gallery. The list must name every photo of the
 * gallery exactly once (CONFLICT otherwise: the gallery changed in another tab or app).
 */
export async function reorderGallery(
  principal: Principal | null,
  raw: z.input<typeof galleryReorderInput>,
  meta: RequestMeta,
): Promise<{ personId: string; photos: PersonGalleryPhotoDto[] }> {
  const p = requireUser(principal);
  const parsed = galleryReorderInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Name every photo of your gallery once.');
  const own = await ownPerson(p.user.id);
  if (!own) throw new ServiceError('NOT_FOUND', NO_OWN_PERSON_MESSAGE);
  const ids = parsed.data.photoIds;
  const rows = await getDb().transaction(async (tx) => {
    await lockOwn(tx, p.user.id, own.id);
    const current = await galleryRows(tx, own.id);
    const known = new Set(current.map((r) => r.id));
    if (new Set(ids).size !== ids.length || ids.length !== current.length || ids.some((id) => !known.has(id))) {
      throw new ServiceError('CONFLICT', 'Your gallery changed in the meantime. Reload the page and try again.');
    }
    const now = new Date();
    for (const [index, id] of ids.entries()) {
      await tx.update(personPhoto).set({ position: index, updatedAt: now }).where(eq(personPhoto.id, id));
    }
    await writeAudit(tx, {
      action: 'gallery.reorder',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'person',
      subjectId: own.id,
      after: { photoIds: ids },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return galleryRows(tx, own.id);
  });
  changed(own.id);
  return { personId: own.id, photos: rows.map(galleryPhotoDto) };
}

/**
 * gallery.setProfile: makes a photo of the own gallery the profile photo; the previous profile
 * photo stays in the gallery. Counts nothing: the gallery keeps its size.
 */
export async function setProfilePhoto(
  principal: Principal | null,
  raw: z.input<typeof gallerySetProfileInput>,
  meta: RequestMeta,
): Promise<{ personId: string; photo: PersonGalleryPhotoDto }> {
  const p = requireUser(principal);
  const parsed = gallerySetProfileInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error, 'Choose a photo.');
  const { personId } = await ownPhoto(p.user.id, parsed.data.photoId);
  const row = await getDb().transaction(async (tx) => {
    await lockOwn(tx, p.user.id, personId);
    const rows = await galleryRows(tx, personId);
    const target = rows.find((r) => r.id === parsed.data.photoId);
    if (!target) throw new ServiceError('NOT_FOUND', NO_PHOTO_MESSAGE);
    const previous = rows.find((r) => r.status === 'active');
    const now = new Date();
    if (previous && previous.id !== target.id) {
      // One active photo per person (person_photo_one_active_key): the old one first.
      await tx.update(personPhoto).set({ status: 'gallery', updatedAt: now }).where(eq(personPhoto.id, previous.id));
    }
    if (target.status !== 'active') await tx.update(personPhoto).set({ status: 'active', updatedAt: now }).where(eq(personPhoto.id, target.id));
    await tx.update(person).set({ photoId: target.id, updatedAt: now }).where(eq(person.id, personId));
    await writeAudit(tx, {
      action: 'gallery.profile',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'person',
      subjectId: personId,
      before: { photoId: previous?.id ?? null },
      after: { photoId: target.id },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { ...target, status: 'active' };
  });
  changed(personId);
  return { personId, photo: galleryPhotoDto(row) };
}
