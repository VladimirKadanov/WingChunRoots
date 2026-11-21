// Organization images (ADR 0052, docs/adr/0052-public-page-redesign.md): an organization's logo
// and banner, at most one active of each, shown on its public page and its card while it is
// approved (v_public_organization). Stored like a school's photos (school-photos.ts): every
// rendition encoded again without any metadata, so no GPS position reaches the store, a response
// or a log.
//
// Who may do what (every function checks it itself, whoever calls it):
//   - upload and remove: the organization's admins (organization_admin, owner or admin), whether or
//     not it is approved yet and whatever its plan: a face for the page is not administration of
//     members or schools (DEFAULT D08 is about those);
//   - remove: also staff with a verified second factor, with a reason (audited; the admins are told);
//   - read: everyone while the organization is approved, as part of its page (organizations.get,
//     organizations.list) and through GET /api/organization-photos/...; its admins and staff with a
//     verified second factor also while it is not. Anyone else gets 404, the same as for no image.
//
// Logs and audit rows carry ids, sizes and hashes, never a storage key or a file name.

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { hasStaff2FA, requireStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { invalidatePublic, ORGANIZATIONS_TAG } from '../cache';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { organization, organizationAdmin, organizationPhoto } from '../db/schema';
import { ORGANIZATION_PHOTO_KINDS, PHOTO_REASON_MAX } from '../db/schema/common';
import type { BannerDto, SchoolLogoDto } from '../dto/gallery';
import type { Executor } from '../entitlements/access';
import { getPhotoStore, newStorageKey, type ObjectStore } from '../storage';
import { PhotoRefused, renderGalleryPhoto, renderSchoolLogo } from '../storage/photo';
import { readObjectBytes } from '../storage/read';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { notifyEach } from './notify';
import { PHOTO_HASH_LENGTH } from './photo-refs';
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

const NOT_FOUND_MESSAGE = 'No such organization.';
const NO_PHOTO_MESSAGE = 'No such image of your organization.';

export type OrganizationPhotoKind = (typeof ORGANIZATION_PHOTO_KINDS)[number];

/** The app's own address of one rendition: GET /api/organization-photos/<id>/<hash>/<size>.webp. */
export function organizationPhotoUrl(id: string, sha: string, size: 96 | 512 | 'full'): string {
  return `/api/organization-photos/${id}/${sha.slice(0, PHOTO_HASH_LENGTH)}/${size}.webp`;
}

// --- Input -------------------------------------------------------------------------------------

/** organizationPhotos.get: the images of an organization the account administers. */
export const organizationPhotosGetInput = z.object({ organizationId: z.uuid({ error: NOT_FOUND_MESSAGE }) });

/** organizationPhotos.upload: the logo or the banner, replacing the old one, multipart. */
export const organizationPhotoUploadInput = z.object({
  organizationId: z.uuid({ error: NOT_FOUND_MESSAGE }),
  kind: z.enum(ORGANIZATION_PHOTO_KINDS, { error: 'Choose the logo or the banner.' }),
  file: z.file({ error: 'Choose an image.' }),
});

/** organizationPhotos.remove: an image of the own organization, or for staff any one with a reason. */
export const organizationPhotoRemoveInput = z.object({
  photoId: z.uuid({ error: 'Choose an image.' }),
  reason: z.string().max(PHOTO_REASON_MAX * 2).optional(),
});

// --- Views -------------------------------------------------------------------------------------

export interface OrganizationImages {
  logo: SchoolLogoDto | null;
  banner: BannerDto | null;
}

export interface OrganizationPhotosView extends OrganizationImages {
  organizationId: string;
  /** An admin of the organization: may upload and remove. */
  canChange: boolean;
  /** Staff with a verified second factor: may remove either image, with a reason. */
  canModerate: boolean;
}

interface Row {
  id: string;
  organizationId: string;
  kind: string;
  sha256: string;
  width: number;
  fullWidth: number | null;
  fullHeight: number | null;
}

const logoDto = (r: Row): SchoolLogoDto => ({ id: r.id, small: organizationPhotoUrl(r.id, r.sha256, 96), large: organizationPhotoUrl(r.id, r.sha256, 512) });
const bannerDto = (r: Row): BannerDto => ({
  id: r.id,
  large: organizationPhotoUrl(r.id, r.sha256, 512),
  full: organizationPhotoUrl(r.id, r.sha256, 'full'),
  width: r.fullWidth ?? r.width,
  height: r.fullHeight ?? r.width,
});

const columns = {
  id: organizationPhoto.id,
  organizationId: organizationPhoto.organizationId,
  kind: organizationPhoto.kind,
  sha256: organizationPhoto.sha256,
  width: organizationPhoto.width,
  fullWidth: organizationPhoto.fullWidth,
  fullHeight: organizationPhoto.fullHeight,
};

/** The shown logo and banner of these organizations, by organization id (no visibility check: the caller's). */
export async function organizationImagesOf(db: Executor, organizationIds: readonly string[]): Promise<Map<string, OrganizationImages>> {
  const images = new Map<string, OrganizationImages>();
  if (organizationIds.length === 0) return images;
  const rows = await db
    .select(columns)
    .from(organizationPhoto)
    .where(and(inArray(organizationPhoto.organizationId, [...organizationIds]), eq(organizationPhoto.status, 'active')));
  for (const r of rows) {
    const current = images.get(r.organizationId) ?? { logo: null, banner: null };
    if (r.kind === 'logo') current.logo = logoDto(r);
    else if (r.kind === 'banner') current.banner = bannerDto(r);
    images.set(r.organizationId, current);
  }
  return images;
}

function fieldErrors(error: z.ZodError): ServiceError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (key === 'reason') fields.reason = `At most ${PHOTO_REASON_MAX} characters.`;
    else if (key === 'kind') fields.kind = 'Choose the logo or the banner.';
    else if (key === 'file') fields.file = 'Choose an image.';
    else fields[key] = issue.message;
  }
  return new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
}

// The admin checks of organizations.ts, here again: that module reads this one (no import cycle).
async function adminRoleOf(db: Executor, organizationId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: organizationAdmin.role })
    .from(organizationAdmin)
    .where(and(eq(organizationAdmin.organizationId, organizationId), eq(organizationAdmin.userId, userId), isNull(organizationAdmin.revokedAt)));
  return row?.role ?? null;
}

async function adminIdsOf(db: Executor, organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: organizationAdmin.userId })
    .from(organizationAdmin)
    .where(and(eq(organizationAdmin.organizationId, organizationId), isNull(organizationAdmin.revokedAt)));
  return rows.map((r) => r.userId);
}

async function organizationExists(db: Executor, organizationId: string, lock = false): Promise<boolean> {
  const query = db
    .select({ id: organization.id })
    .from(organization)
    .where(and(eq(organization.id, organizationId), isNull(organization.deletedAt)));
  const [row] = lock ? await query.for('update') : await query;
  return row !== undefined;
}

function changed(): void {
  // The organization pages and the list are cached under `organizations`.
  invalidatePublic([ORGANIZATIONS_TAG], 'procedure');
}

// --- Read --------------------------------------------------------------------------------------

/** organizationPhotos.get: the images of an organization for its admins (or staff with a verified second factor). */
export async function getOrganizationPhotos(principal: Principal | null, raw: z.input<typeof organizationPhotosGetInput>): Promise<OrganizationPhotosView> {
  const p = requireUser(principal);
  const parsed = organizationPhotosGetInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', NOT_FOUND_MESSAGE);
  const db = getDb();
  const { organizationId } = parsed.data;
  const exists = await organizationExists(db, organizationId);
  const admin = exists && (await adminRoleOf(db, organizationId, p.user.id)) !== null;
  const staff = hasStaff2FA(p);
  if (!exists || (!admin && !staff)) {
    if (exists && !admin && p.user.role !== 'user') requireStaff2FA(p);
    throw new ServiceError('NOT_FOUND', NOT_FOUND_MESSAGE);
  }
  const images = (await organizationImagesOf(db, [organizationId])).get(organizationId) ?? { logo: null, banner: null };
  return { organizationId, ...images, canChange: admin, canModerate: staff && (images.logo !== null || images.banner !== null) };
}

// --- Upload ------------------------------------------------------------------------------------

/**
 * organizationPhotos.upload: the logo (whole, on a transparent square) or the banner (the whole
 * image and a centred square); a new one replaces the old one, whose files are deleted.
 */
export async function uploadOrganizationPhoto(
  principal: Principal | null,
  raw: z.input<typeof organizationPhotoUploadInput>,
  meta: RequestMeta,
  store: ObjectStore = getPhotoStore(),
): Promise<{ organizationId: string; logo: SchoolLogoDto | null; banner: BannerDto | null; replaced: boolean }> {
  const p = requireUser(principal);
  const parsed = organizationPhotoUploadInput.safeParse(raw);
  if (!parsed.success) {
    // A malformed organization id says nothing about any organization.
    if (parsed.error.issues.some((i) => i.path[0] === 'organizationId')) throw new ServiceError('NOT_FOUND', NOT_FOUND_MESSAGE);
    throw fieldErrors(parsed.error);
  }
  const { organizationId, kind } = parsed.data;
  const db = getDb();
  if (!(await organizationExists(db, organizationId)) || (await adminRoleOf(db, organizationId, p.user.id)) === null) throw new ServiceError('NOT_FOUND', NOT_FOUND_MESSAGE);
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
    const outcome = await db.transaction(async (tx) => {
      // The organization first, as every organization write; then the admin role, again under the lock.
      if (!(await organizationExists(tx, organizationId, true)) || (await adminRoleOf(tx, organizationId, p.user.id)) === null) {
        throw new ServiceError('NOT_FOUND', NOT_FOUND_MESSAGE);
      }
      const now = new Date();
      const [current] = await tx
        .select({ id: organizationPhoto.id, storageKey: organizationPhoto.storageKey })
        .from(organizationPhoto)
        .where(and(eq(organizationPhoto.organizationId, organizationId), eq(organizationPhoto.kind, kind), eq(organizationPhoto.status, 'active')));
      if (current) await tx.update(organizationPhoto).set({ status: 'replaced', updatedAt: now }).where(eq(organizationPhoto.id, current.id));
      const values = {
        id,
        organizationId,
        kind,
        storageKey: key,
        sha256: content,
        originalSha256: sha256(bytes),
        width: rendered.side,
        height: rendered.side,
        fullWidth: rendered.full?.width ?? null,
        fullHeight: rendered.full?.height ?? null,
        sizeBytes: large.byteLength,
        status: 'active' as const,
        uploadedByUserId: p.user.id,
      };
      await tx.insert(organizationPhoto).values(values);
      await writeAudit(tx, {
        action: 'organization_photo.upload',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'organization',
        subjectId: organizationId,
        before: current ? { photoId: current.id } : null,
        after: { photoId: id, kind, side: rendered.side, sizeBytes: large.byteLength, sha256: content },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      return { old: current ?? null, row: values };
    });
    previous = outcome.old;
    row = outcome.row;
  } catch (error) {
    await deleteFiles(store, key, id);
    throw error;
  }
  if (previous) await deleteFiles(store, previous.storageKey, previous.id);
  changed();
  return { organizationId, logo: kind === 'logo' ? logoDto(row) : null, banner: kind === 'banner' ? bannerDto(row) : null, replaced: previous !== null };
}

// --- Remove ------------------------------------------------------------------------------------

/** organizationPhotos.remove: an admin's, or staff with a verified second factor with a reason (the admins are told). */
export async function removeOrganizationPhoto(
  principal: Principal | null,
  raw: z.input<typeof organizationPhotoRemoveInput>,
  meta: RequestMeta,
  store: ObjectStore = getPhotoStore(),
): Promise<{ organizationId: string; removed: boolean }> {
  const p = requireUser(principal);
  const parsed = organizationPhotoRemoveInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const reason = (parsed.data.reason ?? '').trim();
  const db = getDb();
  const [row] = await db
    .select({ id: organizationPhoto.id, organizationId: organizationPhoto.organizationId })
    .from(organizationPhoto)
    .innerJoin(organization, and(eq(organization.id, organizationPhoto.organizationId), isNull(organization.deletedAt)))
    .where(and(eq(organizationPhoto.id, parsed.data.photoId), eq(organizationPhoto.status, 'active')));
  const own = row !== undefined && (await adminRoleOf(db, row.organizationId, p.user.id)) !== null;
  const asStaff = hasStaff2FA(p) && (!own || reason.length > 0);
  if (!row || (!own && !asStaff)) {
    if (!own && p.user.role !== 'user') requireStaff2FA(p);
    throw new ServiceError('NOT_FOUND', NO_PHOTO_MESSAGE);
  }
  if (asStaff && reason.length === 0) {
    throw new ServiceError('BAD_REQUEST', 'Say why the image is removed: the reason is kept in the audit log.', { reason: 'Say why the image is removed: the reason is kept in the audit log.' });
  }
  if (reason.length > PHOTO_REASON_MAX) throw new ServiceError('BAD_REQUEST', `At most ${PHOTO_REASON_MAX} characters.`, { reason: `At most ${PHOTO_REASON_MAX} characters.` });
  const removed = await db.transaction(async (tx) => {
    await tx.select({ id: organization.id }).from(organization).where(eq(organization.id, row.organizationId)).for('update');
    // An admin's removal: the role again, under the lock (it may have been taken away meanwhile).
    if (!asStaff && (await adminRoleOf(tx, row.organizationId, p.user.id)) === null) throw new ServiceError('NOT_FOUND', NO_PHOTO_MESSAGE);
    const [current] = await tx
      .select({ id: organizationPhoto.id, storageKey: organizationPhoto.storageKey, kind: organizationPhoto.kind })
      .from(organizationPhoto)
      .where(and(eq(organizationPhoto.id, row.id), eq(organizationPhoto.status, 'active')));
    if (!current) return null;
    const now = new Date();
    await tx
      .update(organizationPhoto)
      .set({ status: 'removed', removedAt: now, removedByUserId: p.user.id, removalReason: asStaff ? reason : null, updatedAt: now })
      .where(eq(organizationPhoto.id, current.id));
    await writeAudit(tx, {
      action: 'organization_photo.remove',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'organization',
      subjectId: row.organizationId,
      before: { photoId: current.id, kind: current.kind },
      after: { by: asStaff ? 'staff' : 'owner' },
      reason: asStaff ? reason : null,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    // M18 (In scope 5): the organization's admins are told of a staff removal, with the reason.
    if (asStaff) {
      const admins = (await adminIdsOf(tx, row.organizationId)).filter((id) => id !== p.user.id);
      if (admins.length > 0) await notifyEach(tx, admins, 'content.removed', { content: 'organization_photo', reason }, { key: `content.removed:organization_photo:${current.id}` });
    }
    return current;
  });
  if (removed) {
    await deleteFiles(store, removed.storageKey, removed.id);
    changed();
  }
  return { organizationId: row.organizationId, removed: removed !== null };
}

// --- The image route ---------------------------------------------------------------------------

/**
 * One rendition for GET /api/organization-photos/<id>/<hash>/<size>.webp: a shown image of an
 * approved organization (v_public_organization) for everyone; of one that is not, only for its
 * admins and staff with a verified second factor. null (404) for everything else, one answer for
 * all. The read rules of openPhoto (photos.ts).
 */
export async function openOrganizationPhoto(
  principal: Principal | null,
  address: { id: string; hash: string; file: string },
  store: ObjectStore = getPhotoStore(),
  options: OpenPhotoOptions = {},
): Promise<PhotoFile | null> {
  if (!PHOTO_ADDRESS.id.safeParse(address.id).success || !PHOTO_ADDRESS.hash.safeParse(address.hash).success || !PHOTO_ADDRESS.file.safeParse(address.file).success) return null;
  const db = getDb();
  const [row] = await db
    .select({ storageKey: organizationPhoto.storageKey, sha256: organizationPhoto.sha256, organizationId: organizationPhoto.organizationId, fullWidth: organizationPhoto.fullWidth })
    .from(organizationPhoto)
    .innerJoin(organization, and(eq(organization.id, organizationPhoto.organizationId), isNull(organization.deletedAt)))
    .where(and(eq(organizationPhoto.id, address.id), eq(organizationPhoto.status, 'active')));
  if (!row || !row.sha256.startsWith(address.hash)) return null;
  const shown = await db.execute(sql`SELECT 1 AS one FROM v_public_organization WHERE id = ${row.organizationId}::uuid`);
  const isPublic = shown.rows.length > 0;
  if (!isPublic) {
    const admin = principal !== null && (await adminRoleOf(db, row.organizationId, principal.user.id)) !== null;
    if (!admin && !hasStaff2FA(principal)) return null;
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
