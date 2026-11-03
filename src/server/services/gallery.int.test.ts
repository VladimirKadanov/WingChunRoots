// Profile galleries (milestone M16; docs/adr/0019-galleries.md), against a migrated throwaway
// database: who may add, caption, reorder, choose and remove a photo; the plan's `photos`
// allowance (DEFAULT D07) counts every photo of the gallery, the profile photo among them, and
// never evidence (DEFAULT D13); the upgrade prompt only at the real limit; a hidden person's
// gallery is 404 and in no public answer; the whole rendition carries no EXIF or GPS; a removed
// photo's files go; pnpm account:delete removes the whole gallery.
//
// The photo store and the evidence store are two private temporary folders, set before either
// store is first made. Every image is generated here: a flat colour, nothing of a real person.

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb, getPublicDb } from '../db';
import { auditLog, entitlementGrant, evidenceFile, person, personPhoto } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { currentUse } from '../entitlements/access';
import { handlePhotoRequest } from '../photo-http';
import { containsAscii, imageFacts, jpegWithGps, plainImage, TEST_EXIF_CAMERA } from '../storage/test-images';
import {
  addGalleryPhoto,
  GALLERY_FULL_MESSAGE,
  getGallery,
  getOwnGallery,
  removeGalleryPhoto,
  reorderGallery,
  setProfilePhoto,
  updateGalleryPhoto,
} from './gallery';
import { personProfile } from './lineage';
import { openPhoto, publicPhotoRefs, uploadPhoto } from './photos';
import { carryOutDeletionFromCommandLine, requestAccountDeletion } from './privacy';
import { member, meta, staff } from './relationships.test-support';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;
const photoRoot = mkdtempSync(path.join(tmpdir(), 'wcr-gallery-int-'));
const evidenceRoot = mkdtempSync(path.join(tmpdir(), 'wcr-gallery-int-evidence-'));
const saved = { media: process.env.MEDIA_STORAGE, mediaDir: process.env.MEDIA_STORAGE_DIR, evidence: process.env.EVIDENCE_STORAGE, evidenceDir: process.env.EVIDENCE_STORAGE_DIR };

beforeAll(async () => {
  process.env.MEDIA_STORAGE = 'filesystem';
  process.env.MEDIA_STORAGE_DIR = photoRoot;
  process.env.EVIDENCE_STORAGE = 'filesystem';
  process.env.EVIDENCE_STORAGE_DIR = evidenceRoot;
  testDb = await startAuthTestDatabase();
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
  rmSync(photoRoot, { recursive: true, force: true });
  rmSync(evidenceRoot, { recursive: true, force: true });
  for (const [name, value] of [
    ['MEDIA_STORAGE', saved.media],
    ['MEDIA_STORAGE_DIR', saved.mediaDir],
    ['EVIDENCE_STORAGE', saved.evidence],
    ['EVIDENCE_STORAGE_DIR', saved.evidenceDir],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const filesIn = (root: string) =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(root, path.join(d.parentPath, d.name)).split(path.sep).join('/'));

async function image(width = 160, height = 120): Promise<File> {
  return new File([new Uint8Array(await plainImage('png', width, height))], 'demo-photo.png', { type: 'image/png' });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

/** `/api/photos/<id>/<hash>/full.webp` → the route's params. */
function addressOf(url: string) {
  const [, , , id, hash, file] = url.split('/');
  return { id: id!, hash: hash!, file: file! };
}

const rowsOf = (personId: string) => getDb().select().from(personPhoto).where(eq(personPhoto.personId, personId)).orderBy(asc(personPhoto.createdAt), asc(personPhoto.id));
const photoIdOf = async (personId: string) => (await getDb().select({ photoId: person.photoId }).from(person).where(eq(person.id, personId)))[0]!.photoId;
const actionsOf = async (personId: string) =>
  (
    await getDb()
      .select({ action: auditLog.action, reason: auditLog.reason })
      .from(auditLog)
      .where(and(eq(auditLog.subjectType, 'person'), eq(auditLog.subjectId, personId)))
      .orderBy(asc(auditLog.occurredAt), asc(auditLog.id))
  ).map((a) => a.action);

/** A Premium Student test plan (DEFAULT D07: 10 photos), as an admin grant gives it. */
async function premium(userId: string) {
  await getDb()
    .insert(entitlementGrant)
    .values({ subjectUserId: userId, planCode: 'premium_student', source: 'test_grant', startsAt: new Date(Date.now() - 60_000), reason: 'Demo: M16 test plan' });
}

describe('gallery.add and the allowance (DEFAULT D07)', () => {
  it('the first photo becomes the profile photo; at the Free Student limit the next one is refused with the upgrade prompt', async () => {
    const owner = await member('gallery-free');
    const subject = { kind: 'user' as const, userId: owner.account.id };
    const before = await getOwnGallery(owner.principal);
    expect(before.allowance).toMatchObject({ used: 0, limit: 1, canAdd: true });
    expect(before.upgrade).toBeNull();

    const first = await addGalleryPhoto(owner.principal, { file: await image(), caption: '  A demo   caption ' }, meta);
    expect(first.photo).toMatchObject({ isProfile: true, caption: 'A demo caption' });
    expect(first.photo.full).toMatch(/^\/api\/photos\/[0-9a-f-]{36}\/[0-9a-f]{16}\/full\.webp$/);
    const [row] = await rowsOf(owner.personId);
    expect(row).toMatchObject({ status: 'active', position: 0, fullWidth: 160, fullHeight: 120 });
    expect(await photoIdOf(owner.personId)).toBe(row!.id);
    expect(filesIn(photoRoot)).toEqual(expect.arrayContaining([`${row!.storageKey}/96`, `${row!.storageKey}/512`, `${row!.storageKey}/full`]));
    expect(await currentUse(getDb(), subject, 'photos')).toBe(1);

    // At the limit: refused, nothing stored, and the prompt names a plan that gives more now.
    const files = filesIn(photoRoot).length;
    await expect(addGalleryPhoto(owner.principal, { file: await image() }, meta)).rejects.toMatchObject({ code: 'ENTITLEMENT_REQUIRED', message: GALLERY_FULL_MESSAGE });
    expect(filesIn(photoRoot).length).toBe(files);
    expect(await rowsOf(owner.personId)).toHaveLength(1);
    const full = await getOwnGallery(owner.principal);
    expect(full.allowance).toMatchObject({ used: 1, limit: 1, canAdd: false });
    expect(full.upgrade).not.toBeNull();
    expect(JSON.stringify(full.upgrade)).toContain('Premium Student');
  });

  it('with a higher plan from an admin grant the gallery grows; every photo counts and evidence never does (DEFAULT D13)', async () => {
    const owner = await member('gallery-premium');
    await premium(owner.account.id);
    const subject = { kind: 'user' as const, userId: owner.account.id };
    // Verification evidence of the same account: in the private evidence store, never counted.
    await getDb().insert(evidenceFile).values({ storageKey: `evidence/demo-${owner.account.id}`, sha256: 'a'.repeat(64), mime: 'image/png', sizeBytes: 10, uploadedByUserId: owner.account.id });
    const a = await addGalleryPhoto(owner.principal, { file: await image() }, meta);
    const b = await addGalleryPhoto(owner.principal, { file: await image() }, meta);
    const c = await addGalleryPhoto(owner.principal, { file: await image() }, meta);
    expect([a, b, c].map((x) => x.photo.isProfile)).toEqual([true, false, false]);
    expect((await rowsOf(owner.personId)).map((r) => [r.status, r.position])).toEqual([
      ['active', 0],
      ['gallery', 1],
      ['gallery', 2],
    ]);
    expect(await currentUse(getDb(), subject, 'photos')).toBe(3);
    const view = await getOwnGallery(owner.principal);
    expect(view.allowance).toMatchObject({ used: 3, limit: 10, canAdd: true });
    expect(view.upgrade).toBeNull();
    // Replacing the profile photo through M14's photos.upload still counts as the same one.
    await uploadPhoto(owner.principal, { file: await image() }, meta);
    expect(await currentUse(getDb(), subject, 'photos')).toBe(3);
    expect(filesIn(evidenceRoot)).toEqual([]);
    expect(await actionsOf(owner.personId)).toEqual(['gallery.add', 'gallery.add', 'gallery.add', 'photo.upload']);
  });

  it('strips the EXIF block and GPS position from every rendition, the whole photo too, and keeps its proportions', async () => {
    const owner = await member('gallery-exif');
    const up = await addGalleryPhoto(owner.principal, { file: new File([new Uint8Array(await jpegWithGps(320, 200))], 'demo.jpg', { type: 'image/jpeg' }) }, meta);
    for (const url of [up.photo.small, up.photo.large, up.photo.full]) {
      const served = await openPhoto(null, addressOf(url));
      const bytes = served && !served.notModified ? served.bytes : new Uint8Array();
      expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('WEBP');
      const facts = await imageFacts(bytes);
      expect(facts.exif).toBe(false);
      expect(containsAscii(bytes, 'GPS')).toBe(false);
      expect(containsAscii(bytes, TEST_EXIF_CAMERA)).toBe(false);
    }
    expect(up.photo).toMatchObject({ width: 320, height: 200 });
  });

  it('refuses a caption over 200 characters, anonymous callers and an account without its own person', async () => {
    const owner = await member('gallery-refused');
    expect(await codeOf(addGalleryPhoto(owner.principal, { file: await image(), caption: 'x'.repeat(201) }, meta))).toBe('BAD_REQUEST');
    expect(await rowsOf(owner.personId)).toEqual([]);
    expect(await codeOf(addGalleryPhoto(null, { file: await image() }, meta))).toBe('UNAUTHORIZED');
    const reviewer = await staff('gallery-no-person');
    expect(await codeOf(addGalleryPhoto(reviewer.principal, { file: await image() }, meta))).toBe('NOT_FOUND');
    expect(await codeOf(getOwnGallery(reviewer.principal))).toBe('NOT_FOUND');
  });
});

describe('caption, order and profile photo', () => {
  it('the owner captions, reorders and chooses the profile photo; nobody else can', async () => {
    const owner = await member('gallery-arrange');
    await premium(owner.account.id);
    const a = (await addGalleryPhoto(owner.principal, { file: await image() }, meta)).photo;
    const b = (await addGalleryPhoto(owner.principal, { file: await image() }, meta)).photo;
    const c = (await addGalleryPhoto(owner.principal, { file: await image() }, meta)).photo;
    const other = await member('gallery-arrange-stranger');
    const moderator = await staff('gallery-arrange-mod');

    expect((await updateGalleryPhoto(owner.principal, { photoId: b.id, caption: 'Demo training hall' }, meta)).photo.caption).toBe('Demo training hall');
    expect((await updateGalleryPhoto(owner.principal, { photoId: b.id, caption: '' }, meta)).photo.caption).toBeNull();
    expect(await codeOf(updateGalleryPhoto(other.principal, { photoId: b.id, caption: 'Demo' }, meta))).toBe('NOT_FOUND');
    expect(await codeOf(updateGalleryPhoto(moderator.principal, { photoId: b.id, caption: 'Demo' }, meta))).toBe('NOT_FOUND');

    const reordered = await reorderGallery(owner.principal, { photoIds: [c.id, a.id, b.id] }, meta);
    expect(reordered.photos.map((p) => p.id)).toEqual([c.id, a.id, b.id]);
    // A list that misses a photo, repeats one or names another's: CONFLICT, nothing moves.
    expect(await codeOf(reorderGallery(owner.principal, { photoIds: [a.id, b.id] }, meta))).toBe('CONFLICT');
    expect(await codeOf(reorderGallery(owner.principal, { photoIds: [a.id, a.id, b.id] }, meta))).toBe('CONFLICT');
    // Another account's list is checked against its own gallery: someone else's photos are not in it.
    expect(await codeOf(reorderGallery(other.principal, { photoIds: [b.id, c.id, a.id] }, meta))).toBe('CONFLICT');
    expect((await getGallery(null, { slug: owner.slug })).photos.map((p) => p.id)).toEqual([c.id, a.id, b.id]);

    await setProfilePhoto(owner.principal, { photoId: c.id }, meta);
    expect(await photoIdOf(owner.personId)).toBe(c.id);
    const statuses = Object.fromEntries((await rowsOf(owner.personId)).map((r) => [r.id, r.status]));
    expect(statuses).toEqual({ [a.id]: 'gallery', [b.id]: 'gallery', [c.id]: 'active' });
    expect((await personProfile(null, { slug: owner.slug })).photo?.small).toBe(c.small);
    expect(await codeOf(setProfilePhoto(other.principal, { photoId: a.id }, meta))).toBe('NOT_FOUND');
    expect(await currentUse(getDb(), { kind: 'user', userId: owner.account.id }, 'photos')).toBe(3);
    expect(await actionsOf(owner.personId)).toEqual(['gallery.add', 'gallery.add', 'gallery.add', 'gallery.update', 'gallery.update', 'gallery.reorder', 'gallery.profile']);
  });
});

describe('gallery.remove', () => {
  it('the owner removes a photo: its files go, the allowance frees one; removing the profile photo leaves the monogram', async () => {
    const owner = await member('gallery-remove');
    await premium(owner.account.id);
    const a = (await addGalleryPhoto(owner.principal, { file: await image() }, meta)).photo;
    const b = (await addGalleryPhoto(owner.principal, { file: await image() }, meta)).photo;
    const [, rowB] = await rowsOf(owner.personId);
    expect((await removeGalleryPhoto(owner.principal, { photoId: b.id }, meta)).removed).toBe(true);
    expect(filesIn(photoRoot).some((f) => f.startsWith(`${rowB!.storageKey}/`))).toBe(false);
    expect(await openPhoto(owner.principal, addressOf(b.full))).toBeNull();
    expect(await currentUse(getDb(), { kind: 'user', userId: owner.account.id }, 'photos')).toBe(1);
    await removeGalleryPhoto(owner.principal, { photoId: a.id }, meta);
    expect(await photoIdOf(owner.personId)).toBeNull();
    expect((await personProfile(null, { slug: owner.slug })).photo).toBeNull();
    expect(await codeOf(removeGalleryPhoto(owner.principal, { photoId: a.id }, meta))).toBe('NOT_FOUND');
  });

  it('another member: NOT_FOUND; staff without 2FA: SECOND_FACTOR_REQUIRED; staff need a reason, which is kept and audited', async () => {
    const owner = await member('gallery-moderate');
    const a = (await addGalleryPhoto(owner.principal, { file: await image() }, meta)).photo;
    const other = await member('gallery-moderate-stranger');
    expect(await codeOf(removeGalleryPhoto(other.principal, { photoId: a.id, reason: 'Demo.' }, meta))).toBe('NOT_FOUND');
    const unverified = await staff('gallery-mod-no2fa', 'moderator', { unverified: true });
    expect(await codeOf(removeGalleryPhoto(unverified.principal, { photoId: a.id, reason: 'Demo.' }, meta))).toBe('SECOND_FACTOR_REQUIRED');
    const moderator = await staff('gallery-mod');
    expect(await codeOf(removeGalleryPhoto(moderator.principal, { photoId: a.id }, meta))).toBe('BAD_REQUEST');
    expect((await rowsOf(owner.personId))[0]!.status).toBe('active');
    expect((await getGallery(moderator.principal, { slug: owner.slug })).canModerate).toBe(true);

    await removeGalleryPhoto(moderator.principal, { photoId: a.id, reason: 'A fictional moderation reason.' }, meta);
    expect((await rowsOf(owner.personId))[0]).toMatchObject({ status: 'removed', removedByUserId: moderator.account.id, removalReason: 'A fictional moderation reason.' });
    const [audit] = await getDb()
      .select({ reason: auditLog.reason, after: auditLog.after })
      .from(auditLog)
      .where(and(eq(auditLog.subjectId, owner.personId), eq(auditLog.action, 'gallery.remove')));
    expect(audit).toMatchObject({ reason: 'A fictional moderation reason.', after: { by: 'staff' } });
  });
});

describe('visibility', () => {
  it("a hidden person's gallery is 404 to everyone but the owner and staff with 2FA, and its photos are never public", async () => {
    const owner = await member('gallery-hidden');
    const up = await addGalleryPhoto(owner.principal, { file: await image() }, meta);
    await premium(owner.account.id);
    const extra = await addGalleryPhoto(owner.principal, { file: await image() }, meta);
    await getDb().update(person).set({ visibility: 'involved_only' }).where(eq(person.id, owner.personId));
    const other = await member('gallery-hidden-viewer');
    const moderator = await staff('gallery-hidden-mod');
    const unverified = await staff('gallery-hidden-no2fa', 'moderator', { unverified: true });

    expect(await codeOf(getGallery(null, { slug: owner.slug }))).toBe('NOT_FOUND');
    expect(await codeOf(getGallery(other.principal, { slug: owner.slug }))).toBe('NOT_FOUND');
    expect(await codeOf(getGallery(unverified.principal, { slug: owner.slug }))).toBe('NOT_FOUND');
    expect((await getGallery(owner.principal, { slug: owner.slug })).photos).toHaveLength(2);
    expect((await getGallery(moderator.principal, { slug: owner.slug })).photos).toHaveLength(2);
    for (const url of [up.photo.full, extra.photo.small, extra.photo.full]) {
      expect(await openPhoto(null, addressOf(url))).toBeNull();
      expect(await openPhoto(other.principal, addressOf(url))).toBeNull();
      expect((await openPhoto(owner.principal, addressOf(url)))?.public).toBe(false);
      expect((await handlePhotoRequest(new Request(`http://localhost${url}`), addressOf(url))).status).toBe(404);
    }
    expect((await publicPhotoRefs(getPublicDb(), [owner.personId])).size).toBe(0);
  });

  it("a public person's gallery photo is served with a public cache; a gallery photo is no profile photo of the public read model", async () => {
    const owner = await member('gallery-public');
    await premium(owner.account.id);
    await addGalleryPhoto(owner.principal, { file: await image() }, meta);
    const extra = await addGalleryPhoto(owner.principal, { file: await image() }, meta);
    const response = await handlePhotoRequest(new Request(`http://localhost${extra.photo.full}`), addressOf(extra.photo.full));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, no-cache');
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect((await publicPhotoRefs(getPublicDb(), [owner.personId])).get(owner.personId)?.id).not.toBe(extra.photo.id);
    const anonymous = await getGallery(null, { slug: owner.slug });
    expect(anonymous).toMatchObject({ canChange: false, canModerate: false, allowance: null, upgrade: null });
    // The public answer carries no storage key and no hash beyond the address.
    const [row] = await getDb().select({ storageKey: personPhoto.storageKey }).from(personPhoto).where(eq(personPhoto.id, extra.photo.id));
    expect(JSON.stringify(anonymous)).not.toContain(row!.storageKey.slice('photos/'.length));
  });

  it('pnpm account:delete removes every photo of the gallery and its files, and keeps no original hash', async () => {
    const owner = await member('gallery-leaving');
    await premium(owner.account.id);
    await addGalleryPhoto(owner.principal, { file: await image() }, meta);
    await addGalleryPhoto(owner.principal, { file: await image() }, meta);
    const rows = await rowsOf(owner.personId);
    const { request } = await requestAccountDeletion(owner.principal, { confirm: true }, meta);
    await carryOutDeletionFromCommandLine(request.id);
    const after = await rowsOf(owner.personId);
    expect(after.map((r) => [r.status, r.originalSha256])).toEqual([
      ['removed', null],
      ['removed', null],
    ]);
    for (const r of rows) expect(filesIn(photoRoot).some((f) => f.startsWith(`${r.storageKey}/`))).toBe(false);
    expect(await photoIdOf(owner.personId)).toBeNull();
  });
});
