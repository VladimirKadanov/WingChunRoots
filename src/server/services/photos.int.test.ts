// Profile photos (milestone M14; docs/adr/0016-profile-photos.md), against a migrated throwaway
// database: who may upload, replace, remove and see a photo; a hidden person's photo is 404 and
// never in a public DTO; a replaced or removed photo's files are deleted; the photo counts as one
// against the plan's `photos` (DEFAULT D07); the evidence store is never touched.
//
// The photo store and the evidence store are two private temporary folders (MEDIA_STORAGE_DIR and
// EVIDENCE_STORAGE_DIR), set before either store is first made. Every image is generated here: a
// flat colour, nothing of a real person.

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { and, asc, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb, getPublicDb } from '../db';
import { auditLog, evidenceFile, person, personPhoto } from '../db/schema';
import { PHOTO_MAX_BYTES } from '../db/schema/common';
import type { TestDatabase } from '../db/testing';
import { currentUse } from '../entitlements/access';
import { handlePhotoRequest } from '../photo-http';
import { jpegWithGps, plainImage } from '../storage/test-images';
import { personProfile } from './lineage';
import { getPhoto, openPhoto, PHOTO_TOO_LARGE_MESSAGE, PHOTO_WRONG_TYPE_MESSAGE, publicPhotoRefs, removePhoto, uploadPhoto } from './photos';
import { member, meta, principalOf, staff } from './relationships.test-support';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;
const photoRoot = mkdtempSync(path.join(tmpdir(), 'wcr-photos-int-'));
const evidenceRoot = mkdtempSync(path.join(tmpdir(), 'wcr-photos-int-evidence-'));
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

async function image(format: 'jpeg' | 'png' | 'webp' = 'png', width = 160, height = 120): Promise<File> {
  return new File([new Uint8Array(await plainImage(format, width, height))], `demo-photo.${format}`, { type: `image/${format}` });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

/** `/api/photos/<id>/<hash>/96.webp` → the route's params. */
function addressOf(url: string) {
  const [, , , id, hash, file] = url.split('/');
  return { id: id!, hash: hash!, file: file! };
}

async function photoRows(personId: string) {
  return getDb().select().from(personPhoto).where(eq(personPhoto.personId, personId)).orderBy(asc(personPhoto.createdAt), asc(personPhoto.id));
}

async function auditOf(personId: string) {
  return getDb()
    .select({ action: auditLog.action, actor: auditLog.actorUserId, reason: auditLog.reason, after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.subjectType, 'person'), eq(auditLog.subjectId, personId)))
    .orderBy(asc(auditLog.occurredAt), asc(auditLog.id));
}

describe('upload', () => {
  it('stores a square WebP at 96 and 512 px in the photo store, sets the person, audits, and leaves the evidence store alone', async () => {
    const owner = await member('photo-owner');
    const result = await uploadPhoto(owner.principal, { file: await image('png', 800, 600) }, meta);
    expect(result).toMatchObject({ personId: owner.personId, slug: owner.slug, side: 512, replaced: false });
    expect(result.photo.small).toMatch(/^\/api\/photos\/[0-9a-f-]{36}\/[0-9a-f]{16}\/96\.webp$/);
    expect(result.photo.large).toMatch(/\/512\.webp$/);
    const [row] = await photoRows(owner.personId);
    // No storage key in the answer.
    expect(JSON.stringify(result)).not.toContain(row!.storageKey.slice('photos/'.length));
    expect(row).toMatchObject({ status: 'active', width: 512, height: 512, uploadedByUserId: owner.account.id });
    const [p] = await getDb().select({ photoId: person.photoId }).from(person).where(eq(person.id, owner.personId));
    expect(p!.photoId).toBe(row!.id);
    expect(filesIn(photoRoot)).toEqual(expect.arrayContaining([`${row!.storageKey}/96`, `${row!.storageKey}/512`]));
    expect(filesIn(evidenceRoot)).toEqual([]);
    expect((await getDb().select({ n: count() }).from(evidenceFile))[0]!.n).toBe(0);

    const audit = await auditOf(owner.personId);
    expect(audit.map((a) => a.action)).toEqual(['photo.upload']);
    expect(audit[0]!.actor).toBe(owner.account.id);
    expect(audit[0]!.after).toMatchObject({ photoId: row!.id, side: 512 });
  });

  it('strips the EXIF block and GPS position of a JPEG', async () => {
    const owner = await member('photo-exif');
    const result = await uploadPhoto(owner.principal, { file: new File([new Uint8Array(await jpegWithGps(200, 200))], 'demo.jpg', { type: 'image/jpeg' }) }, meta);
    const served = await openPhoto(null, addressOf(result.photo.large));
    const bytes = new Uint8Array(await new Response(served!.body).arrayBuffer());
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('WEBP');
    expect(Buffer.from(bytes).includes(Buffer.from('Exif'))).toBe(false);
    expect(Buffer.from(bytes).includes(Buffer.from('GPS'))).toBe(false);
  });

  it('replacing the photo marks the old one replaced, deletes its files and still counts one photo (DEFAULT D07)', async () => {
    const owner = await member('photo-replace');
    const subject = { kind: 'user' as const, userId: owner.account.id };
    expect(await currentUse(getDb(), subject, 'photos')).toBe(0);
    const first = await uploadPhoto(owner.principal, { file: await image('png') }, meta);
    expect(await currentUse(getDb(), subject, 'photos')).toBe(1);
    const second = await uploadPhoto(owner.principal, { file: await image('webp', 300, 300) }, meta);
    expect(second.replaced).toBe(true);
    expect(await currentUse(getDb(), subject, 'photos')).toBe(1);

    const [old, current] = await photoRows(owner.personId);
    expect(old!.status).toBe('replaced');
    expect(current!.status).toBe('active');
    const files = filesIn(photoRoot);
    expect(files.some((f) => f.startsWith(`${old!.storageKey}/`))).toBe(false);
    expect(files.some((f) => f.startsWith(`${current!.storageKey}/`))).toBe(true);
    // The old address is gone at once.
    expect(await openPhoto(null, addressOf(first.photo.small))).toBeNull();
    expect(await openPhoto(null, addressOf(second.photo.small))).not.toBeNull();
  });

  it('refuses a non-image, a too-small image and a file over the size limit, storing nothing', async () => {
    const owner = await member('photo-refused');
    const before = filesIn(photoRoot).length;
    const pdf = new File([new TextEncoder().encode('%PDF-1.4\n% demo\n%%EOF\n')], 'demo.png', { type: 'image/png' });
    await expect(uploadPhoto(owner.principal, { file: pdf }, meta)).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE', message: PHOTO_WRONG_TYPE_MESSAGE });
    await expect(uploadPhoto(owner.principal, { file: await image('png', 64, 64) }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const big = new File([new Uint8Array(PHOTO_MAX_BYTES + 1)], 'demo.png', { type: 'image/png' });
    await expect(uploadPhoto(owner.principal, { file: big }, meta)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', message: PHOTO_TOO_LARGE_MESSAGE });
    expect(filesIn(photoRoot).length).toBe(before);
    expect(await photoRows(owner.personId)).toEqual([]);
  });

  it('anonymous: UNAUTHORIZED; an account without its own person: NOT_FOUND', async () => {
    expect(await codeOf(uploadPhoto(null, { file: await image() }, meta))).toBe('UNAUTHORIZED');
    const reviewer = await staff('photo-no-person');
    expect(await codeOf(uploadPhoto(reviewer.principal, { file: await image() }, meta))).toBe('NOT_FOUND');
  });
});

describe('remove', () => {
  it('the owner removes their own photo: status removed, files deleted, audited, 404 afterwards', async () => {
    const owner = await member('photo-remove-own');
    const up = await uploadPhoto(owner.principal, { file: await image() }, meta);
    const result = await removePhoto(owner.principal, {}, meta);
    expect(result).toEqual({ personId: owner.personId, slug: owner.slug, removed: true });
    const [row] = await photoRows(owner.personId);
    expect(row).toMatchObject({ status: 'removed', removedByUserId: owner.account.id, removalReason: null });
    expect(filesIn(photoRoot).some((f) => f.startsWith(`${row!.storageKey}/`))).toBe(false);
    expect(await openPhoto(owner.principal, addressOf(up.photo.small))).toBeNull();
    expect((await auditOf(owner.personId)).map((a) => a.action)).toEqual(['photo.upload', 'photo.remove']);
    // Again: nothing to remove, said so.
    expect((await removePhoto(owner.principal, {}, meta)).removed).toBe(false);
  });

  it("another account: NOT_FOUND; staff without 2FA: SECOND_FACTOR_REQUIRED; staff need a reason, which is audited", async () => {
    const owner = await member('photo-remove-other');
    await uploadPhoto(owner.principal, { file: await image() }, meta);
    const other = await member('photo-remove-stranger');
    expect(await codeOf(removePhoto(other.principal, { slug: owner.slug, reason: 'Demo.' }, meta))).toBe('NOT_FOUND');
    const unverified = await staff('photo-mod-no2fa', 'moderator', { unverified: true });
    expect(await codeOf(removePhoto(unverified.principal, { slug: owner.slug, reason: 'Demo.' }, meta))).toBe('SECOND_FACTOR_REQUIRED');
    const moderator = await staff('photo-mod');
    expect(await codeOf(removePhoto(moderator.principal, { slug: owner.slug }, meta))).toBe('BAD_REQUEST');
    expect((await photoRows(owner.personId))[0]!.status).toBe('active');

    const result = await removePhoto(moderator.principal, { slug: owner.slug, reason: 'A fictional moderation reason.' }, meta);
    expect(result.removed).toBe(true);
    const [row] = await photoRows(owner.personId);
    expect(row).toMatchObject({ status: 'removed', removedByUserId: moderator.account.id, removalReason: 'A fictional moderation reason.' });
    const audit = await auditOf(owner.personId);
    expect(audit.at(-1)).toMatchObject({ action: 'photo.remove', actor: moderator.account.id, reason: 'A fictional moderation reason.' });
  });
});

describe('visibility', () => {
  it("a hidden person's photo is 404 to everyone but the owner and staff with 2FA, and in no public DTO", async () => {
    const owner = await member('photo-hidden');
    const up = await uploadPhoto(owner.principal, { file: await image() }, meta);
    await getDb().update(person).set({ visibility: 'involved_only' }).where(eq(person.id, owner.personId));
    const other = await member('photo-hidden-viewer');
    const moderator = await staff('photo-hidden-mod');
    const unverified = await staff('photo-hidden-no2fa', 'moderator', { unverified: true });
    const address = addressOf(up.photo.small);

    // The image itself.
    expect(await openPhoto(null, address)).toBeNull();
    expect(await openPhoto(other.principal, address)).toBeNull();
    expect(await openPhoto(unverified.principal, address)).toBeNull();
    expect((await openPhoto(owner.principal, address))?.public).toBe(false);
    expect((await openPhoto(moderator.principal, address))?.public).toBe(false);
    const anonymous = await handlePhotoRequest(new Request(`http://localhost${up.photo.small}`), address);
    expect(anonymous.status).toBe(404);

    // photos.get
    expect(await codeOf(getPhoto(null, { slug: owner.slug }))).toBe('NOT_FOUND');
    expect(await codeOf(getPhoto(other.principal, { slug: owner.slug }))).toBe('NOT_FOUND');
    expect((await getPhoto(owner.principal, { slug: owner.slug })).photo).toEqual(up.photo);
    expect((await getPhoto(moderator.principal, { slug: owner.slug })).canModerate).toBe(true);

    // The public read model never has it; the owner's own profile does.
    expect((await publicPhotoRefs(getPublicDb(), [owner.personId])).size).toBe(0);
    expect(await codeOf(personProfile(null, { slug: owner.slug }))).toBe('NOT_FOUND');
    expect((await personProfile(owner.principal, { slug: owner.slug })).photo).toEqual(up.photo);
  });

  it("a public person's photo: in the profile DTO, served with a public cache and its ETag", async () => {
    const owner = await member('photo-public');
    const up = await uploadPhoto(owner.principal, { file: await image() }, meta);
    expect((await personProfile(null, { slug: owner.slug })).photo).toEqual(up.photo);
    expect((await publicPhotoRefs(getPublicDb(), [owner.personId])).get(owner.personId)?.id).toBe(addressOf(up.photo.small).id);
    const response = await handlePhotoRequest(new Request(`http://localhost${up.photo.small}`), addressOf(up.photo.small));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toMatch(/^public, max-age=\d+/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const etag = response.headers.get('etag')!;
    const again = await handlePhotoRequest(new Request(`http://localhost${up.photo.small}`, { headers: { 'if-none-match': etag } }), addressOf(up.photo.small));
    expect(again.status).toBe(304);
    // A wrong content hash or size: 404.
    expect((await handlePhotoRequest(new Request('http://localhost/x'), { ...addressOf(up.photo.small), hash: '0'.repeat(16) })).status).toBe(404);
    expect((await handlePhotoRequest(new Request('http://localhost/x'), { ...addressOf(up.photo.small), file: '200.webp' })).status).toBe(404);
  });

  it('a removed or deleted person keeps no public photo', async () => {
    const owner = await member('photo-deleted');
    const up = await uploadPhoto(owner.principal, { file: await image() }, meta);
    await getDb().update(person).set({ deletedAt: new Date() }).where(eq(person.id, owner.personId));
    expect(await openPhoto(null, addressOf(up.photo.small))).toBeNull();
    expect(await openPhoto(principalOf(owner.account), addressOf(up.photo.small))).toBeNull();
    expect((await publicPhotoRefs(getPublicDb(), [owner.personId])).size).toBe(0);
  });
});
