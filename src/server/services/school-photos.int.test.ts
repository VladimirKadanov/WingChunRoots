// School logos and room galleries (milestone M16; docs/adr/0019-galleries.md), against a migrated
// throwaway database: only the account that listed the school uploads, captions, reorders and
// removes (staff remove with a reason); one logo, replaced by a new one; at most
// SCHOOL_ROOM_PHOTOS_MAX room photos (DEFAULT D07, questions/M16.md: CONFLICT past it); they never
// count against the person's `photos` allowance; a school that is not public shows its photos to
// nobody else; and the location rule (plan §6.4, CLAUDE.md §6): a photo's GPS position never
// reaches a rendition, the school page or a response, and the school's exact point is not there.
//
// Every image is generated here, every school and place is fictional (demo-, D20).

import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { auditLog, entitlementGrant, schoolPhoto } from '../db/schema';
import { SCHOOL_ROOM_PHOTOS_MAX } from '../db/schema/common';
import type { TestDatabase } from '../db/testing';
import { currentUse } from '../entitlements/access';
import { handlePhotoRequest } from '../photo-http';
import { containsAscii, imageFacts, jpegWithGps, plainImage, TEST_EXIF_CAMERA } from '../storage/test-images';
import { member, meta, staff } from './relationships.test-support';
import {
  getSchoolPhotos,
  openSchoolPhoto,
  removeSchoolPhoto,
  reorderSchoolPhotos,
  SCHOOL_ROOMS_FULL_MESSAGE,
  updateSchoolPhoto,
  uploadSchoolPhoto,
} from './school-photos';
import { schoolGet } from './schools';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;
const photoRoot = mkdtempSync(path.join(tmpdir(), 'wcr-school-photos-int-'));
const evidenceRoot = mkdtempSync(path.join(tmpdir(), 'wcr-school-photos-int-evidence-'));
const saved = { media: process.env.MEDIA_STORAGE, mediaDir: process.env.MEDIA_STORAGE_DIR, evidence: process.env.EVIDENCE_STORAGE, evidenceDir: process.env.EVIDENCE_STORAGE_DIR };
let placeId = '';

/** The school's exact (private) point: fictional, and never in a public answer. */
const EXACT = { lat: 41.987654, lng: 23.456789 };

beforeAll(async () => {
  process.env.MEDIA_STORAGE = 'filesystem';
  process.env.MEDIA_STORAGE_DIR = photoRoot;
  process.env.EVIDENCE_STORAGE = 'filesystem';
  process.env.EVIDENCE_STORAGE_DIR = evidenceRoot;
  testDb = await startAuthTestDatabase();
  placeId = uuidv7();
  await getDb().execute(sql`
    INSERT INTO place (id, geonames_id, name, ascii_name, country_code, centroid)
    VALUES (${placeId}::uuid, 990016, 'Demo Town', 'Demo Town', 'BG', ST_SetSRID(ST_MakePoint(23.1, 41.9), 4326)::geography)`);
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

/** `/api/school-photos/<id>/<hash>/full.webp` → the route's params. */
function addressOf(url: string) {
  const [, , , id, hash, file] = url.split('/');
  return { id: id!, hash: hash!, file: file! };
}

const rowsOf = (schoolId: string) => getDb().select().from(schoolPhoto).where(eq(schoolPhoto.schoolId, schoolId)).orderBy(asc(schoolPhoto.createdAt), asc(schoolPhoto.id));

/**
 * A Sifu with a Professional Sifu test plan and a city-only school they listed: public (active)
 * unless `status` says otherwise, its exact point in the private table.
 */
async function sifuSchool(label: string, status: 'active' | 'draft' = 'active') {
  const sifu = await member(label, { sifu: true });
  await getDb()
    .insert(entitlementGrant)
    .values({ subjectUserId: sifu.account.id, planCode: 'pro_sifu', source: 'test_grant', startsAt: new Date(Date.now() - 60_000), reason: 'Demo: M16 test plan' });
  const id = uuidv7();
  const slug = `demo-m16-${label}-${randomBytes(3).toString('hex')}`;
  await getDb().execute(sql`
    INSERT INTO school (id, slug, name, place_id, location_privacy, public_point, status, created_by_user_id)
    VALUES (${id}::uuid, ${slug}, ${`Demo ${label} Hall`}, ${placeId}::uuid, 'city_only', ST_SetSRID(ST_MakePoint(23.1, 41.9), 4326)::geography, ${status}, ${sifu.account.id}::uuid)`);
  await getDb().execute(sql`
    INSERT INTO school_private_location (school_id, exact_point)
    VALUES (${id}::uuid, ST_SetSRID(ST_MakePoint(${EXACT.lng}::float8, ${EXACT.lat}::float8), 4326)::geography)`);
  return { sifu, id, slug };
}

describe('schoolPhotos.upload', () => {
  it('the listing account adds a logo and room photos; they show on the public school page and never count as the person’s photos', async () => {
    const { sifu, id, slug } = await sifuSchool('photos-own');
    const logo = await uploadSchoolPhoto(sifu.principal, { schoolId: id, kind: 'logo', file: await image(300, 100) }, meta);
    expect(logo.logo?.large).toMatch(/^\/api\/school-photos\/[0-9a-f-]{36}\/[0-9a-f]{16}\/512\.webp$/);
    const room = await uploadSchoolPhoto(sifu.principal, { schoolId: id, kind: 'room', file: await image(), caption: 'The demo training room' }, meta);
    expect(room.room).toMatchObject({ caption: 'The demo training room', width: 160, height: 120 });
    const page = await schoolGet(null, { slug });
    expect(page.logo).toEqual(logo.logo);
    expect(page.photos).toEqual([room.room]);
    // DEFAULT D13 and the owner's decision: a school's photos are their own gallery.
    expect(await currentUse(getDb(), { kind: 'user', userId: sifu.account.id }, 'photos')).toBe(0);
    expect(filesIn(evidenceRoot)).toEqual([]);
    const actions = await getDb().select({ action: auditLog.action }).from(auditLog).where(and(eq(auditLog.subjectType, 'school'), eq(auditLog.subjectId, id)));
    expect(actions.map((a) => a.action)).toEqual(['school_photo.upload', 'school_photo.upload']);
    const response = await handlePhotoRequest(new Request(`http://localhost${room.room!.full}`), addressOf(room.room!.full), { kind: 'school' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, no-cache');
  });

  it('strips the GPS position and camera of every rendition; neither it nor the exact point is in the page', async () => {
    const { sifu, id, slug } = await sifuSchool('photos-gps');
    const gps = async () => new File([new Uint8Array(await jpegWithGps(320, 200))], 'demo.jpg', { type: 'image/jpeg' });
    const room = (await uploadSchoolPhoto(sifu.principal, { schoolId: id, kind: 'room', file: await gps() }, meta)).room!;
    const logo = (await uploadSchoolPhoto(sifu.principal, { schoolId: id, kind: 'logo', file: await gps() }, meta)).logo!;
    for (const url of [room.small, room.large, room.full, logo.small, logo.large]) {
      const served = await openSchoolPhoto(null, addressOf(url));
      const bytes = served && !served.notModified ? served.bytes : new Uint8Array();
      expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('WEBP');
      expect((await imageFacts(bytes)).exif).toBe(false);
      expect(containsAscii(bytes, 'GPS')).toBe(false);
      expect(containsAscii(bytes, TEST_EXIF_CAMERA)).toBe(false);
    }
    const page = JSON.stringify(await schoolGet(null, { slug }));
    expect(page).not.toContain(String(EXACT.lat));
    expect(page).not.toContain(String(EXACT.lng));
    expect(page).not.toContain('GPS');
  });

  it('a new logo replaces the old one: the old row replaced, its files deleted, its address 404', async () => {
    const { sifu, id } = await sifuSchool('photos-logo');
    const first = (await uploadSchoolPhoto(sifu.principal, { schoolId: id, kind: 'logo', file: await image() }, meta)).logo!;
    const second = await uploadSchoolPhoto(sifu.principal, { schoolId: id, kind: 'logo', file: await image(200, 200) }, meta);
    expect(second.replaced).toBe(true);
    const rows = await rowsOf(id);
    expect(rows.map((r) => [r.kind, r.status])).toEqual([
      ['logo', 'replaced'],
      ['logo', 'active'],
    ]);
    expect(filesIn(photoRoot).some((f) => f.startsWith(`${rows[0]!.storageKey}/`))).toBe(false);
    expect(await openSchoolPhoto(null, addressOf(first.large))).toBeNull();
  });

  it(`holds at most ${SCHOOL_ROOM_PHOTOS_MAX} room photos (DEFAULT D07): CONFLICT past it, nothing stored; the logo is not one of them`, async () => {
    const { sifu, id } = await sifuSchool('photos-limit');
    await uploadSchoolPhoto(sifu.principal, { schoolId: id, kind: 'logo', file: await image() }, meta);
    for (let i = 0; i < SCHOOL_ROOM_PHOTOS_MAX; i++) await uploadSchoolPhoto(sifu.principal, { schoolId: id, kind: 'room', file: await image() }, meta);
    const files = filesIn(photoRoot).length;
    await expect(uploadSchoolPhoto(sifu.principal, { schoolId: id, kind: 'room', file: await image() }, meta)).rejects.toMatchObject({ code: 'CONFLICT', message: SCHOOL_ROOMS_FULL_MESSAGE });
    expect(filesIn(photoRoot).length).toBe(files);
    const view = await getSchoolPhotos(sifu.principal, { schoolId: id });
    expect(view.rooms).toHaveLength(SCHOOL_ROOM_PHOTOS_MAX);
    expect(view.limit).toBe(SCHOOL_ROOM_PHOTOS_MAX);
    // A new logo still fits: it replaces the old one.
    await uploadSchoolPhoto(sifu.principal, { schoolId: id, kind: 'logo', file: await image() }, meta);
  });

  it('anyone else may not upload: anonymous UNAUTHORIZED; another member, staff and a missing school NOT_FOUND', async () => {
    const { id } = await sifuSchool('photos-others');
    const other = await member('photos-others-stranger');
    const moderator = await staff('photos-others-mod');
    expect(await codeOf(uploadSchoolPhoto(null, { schoolId: id, kind: 'room', file: await image() }, meta))).toBe('UNAUTHORIZED');
    expect(await codeOf(uploadSchoolPhoto(other.principal, { schoolId: id, kind: 'room', file: await image() }, meta))).toBe('NOT_FOUND');
    expect(await codeOf(uploadSchoolPhoto(moderator.principal, { schoolId: id, kind: 'room', file: await image() }, meta))).toBe('NOT_FOUND');
    expect(await codeOf(uploadSchoolPhoto(other.principal, { schoolId: uuidv7(), kind: 'room', file: await image() }, meta))).toBe('NOT_FOUND');
    expect(await rowsOf(id)).toEqual([]);
  });
});

describe('caption, order, removal', () => {
  it('the listing account captions and reorders; staff remove with a reason; another member gets NOT_FOUND', async () => {
    const { sifu, id, slug } = await sifuSchool('photos-arrange');
    const a = (await uploadSchoolPhoto(sifu.principal, { schoolId: id, kind: 'room', file: await image() }, meta)).room!;
    const b = (await uploadSchoolPhoto(sifu.principal, { schoolId: id, kind: 'room', file: await image() }, meta)).room!;
    const other = await member('photos-arrange-stranger');
    expect(await codeOf(updateSchoolPhoto(other.principal, { photoId: a.id, caption: 'Demo' }, meta))).toBe('NOT_FOUND');
    expect(await codeOf(reorderSchoolPhotos(other.principal, { schoolId: id, photoIds: [b.id, a.id] }, meta))).toBe('NOT_FOUND');
    expect(await codeOf(removeSchoolPhoto(other.principal, { photoId: a.id }, meta))).toBe('NOT_FOUND');
    await updateSchoolPhoto(sifu.principal, { photoId: a.id, caption: 'Demo mats' }, meta);
    await reorderSchoolPhotos(sifu.principal, { schoolId: id, photoIds: [b.id, a.id] }, meta);
    expect(await codeOf(reorderSchoolPhotos(sifu.principal, { schoolId: id, photoIds: [a.id] }, meta))).toBe('CONFLICT');
    expect((await schoolGet(null, { slug })).photos.map((p) => [p.id, p.caption])).toEqual([
      [b.id, null],
      [a.id, 'Demo mats'],
    ]);

    const unverified = await staff('photos-mod-no2fa', 'moderator', { unverified: true });
    expect(await codeOf(removeSchoolPhoto(unverified.principal, { photoId: a.id, reason: 'Demo.' }, meta))).toBe('SECOND_FACTOR_REQUIRED');
    const moderator = await staff('photos-mod');
    expect(await codeOf(removeSchoolPhoto(moderator.principal, { photoId: a.id }, meta))).toBe('BAD_REQUEST');
    await removeSchoolPhoto(moderator.principal, { photoId: a.id, reason: 'A fictional moderation reason.' }, meta);
    const removed = (await rowsOf(id)).find((r) => r.id === a.id)!;
    expect(removed).toMatchObject({ status: 'removed', removedByUserId: moderator.account.id, removalReason: 'A fictional moderation reason.' });
    expect(filesIn(photoRoot).some((f) => f.startsWith(`${removed.storageKey}/`))).toBe(false);
    // The owner removes their own without a reason.
    await removeSchoolPhoto(sifu.principal, { photoId: b.id }, meta);
    expect((await schoolGet(null, { slug })).photos).toEqual([]);
  });
});

describe('visibility', () => {
  it('a school that is not public: its photos are 404 to everyone but the listing account and staff with 2FA', async () => {
    const { sifu, id } = await sifuSchool('photos-draft', 'draft');
    const room = (await uploadSchoolPhoto(sifu.principal, { schoolId: id, kind: 'room', file: await image() }, meta)).room!;
    const other = await member('photos-draft-viewer');
    const moderator = await staff('photos-draft-mod');
    const address = addressOf(room.full);
    expect(await openSchoolPhoto(null, address)).toBeNull();
    expect(await openSchoolPhoto(other.principal, address)).toBeNull();
    expect((await openSchoolPhoto(sifu.principal, address))?.public).toBe(false);
    expect((await openSchoolPhoto(moderator.principal, address))?.public).toBe(false);
    expect((await handlePhotoRequest(new Request(`http://localhost${room.full}`), address, { kind: 'school' })).status).toBe(404);
    expect(await codeOf(getSchoolPhotos(other.principal, { schoolId: id }))).toBe('NOT_FOUND');
    expect((await getSchoolPhotos(moderator.principal, { schoolId: id })).canModerate).toBe(true);
    // A school photo is no person photo: the person route does not serve it.
    expect((await handlePhotoRequest(new Request(`http://localhost${room.full}`), address)).status).toBe(404);
  });
});
