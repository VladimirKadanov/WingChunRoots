// An organization's logo and banner (ADR 0052), against a migrated throwaway database: only its
// admins upload and remove (staff remove with a reason, and the admins are told); one of each kind,
// a new one replacing the old; the images show on the public page and the list once the
// organization is approved, and before that only to its admins and staff with 2FA; the GPS position
// of an upload never reaches a rendition.
//
// Every image is generated here, every organization is fictional (demo-, D20).

import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { auditLog, notification, organizationPhoto } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { handlePhotoRequest } from '../photo-http';
import { containsAscii, imageFacts, jpegWithGps, plainImage } from '../storage/test-images';
import { getOrganizationPhotos, openOrganizationPhoto, removeOrganizationPhoto, uploadOrganizationPhoto } from './organization-photos';
import { organizationGet, organizationsList } from './organizations';
import { member, meta, staff } from './relationships.test-support';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;
const photoRoot = mkdtempSync(path.join(tmpdir(), 'wcr-organization-photos-int-'));
const saved = { media: process.env.MEDIA_STORAGE, mediaDir: process.env.MEDIA_STORAGE_DIR };

beforeAll(async () => {
  process.env.MEDIA_STORAGE = 'filesystem';
  process.env.MEDIA_STORAGE_DIR = photoRoot;
  testDb = await startAuthTestDatabase();
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
  rmSync(photoRoot, { recursive: true, force: true });
  for (const [name, value] of [
    ['MEDIA_STORAGE', saved.media],
    ['MEDIA_STORAGE_DIR', saved.mediaDir],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const filesIn = (root: string) =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(root, path.join(d.parentPath, d.name)).split(path.sep).join('/'));

async function image(width = 640, height = 200): Promise<File> {
  return new File([new Uint8Array(await plainImage('png', width, height))], 'demo-image.png', { type: 'image/png' });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

function addressOf(url: string) {
  const [, , , id, hash, file] = url.split('/');
  return { id: id!, hash: hash!, file: file! };
}

const rowsOf = (organizationId: string) =>
  getDb().select().from(organizationPhoto).where(eq(organizationPhoto.organizationId, organizationId)).orderBy(asc(organizationPhoto.createdAt), asc(organizationPhoto.id));

/** A fictional organization (approved unless `pending`) with one admin account. */
async function organizationWithAdmin(label: string, status: 'active' | 'pending' = 'active') {
  const admin = await member(`${label}-admin`);
  const id = uuidv7();
  const slug = `demo-${label}-${randomBytes(3).toString('hex')}`;
  await getDb().execute(sql`
    INSERT INTO organization (id, slug, name, kind, status, country_code, approved_at, created_by_user_id)
    VALUES (${id}::uuid, ${slug}, ${`Demo ${label} Federation`}, 'federation', ${status}, 'BG', ${status === 'active' ? sql`now()` : null}, ${admin.account.id}::uuid)`);
  await getDb().execute(sql`INSERT INTO organization_admin (organization_id, user_id, role) VALUES (${id}::uuid, ${admin.account.id}::uuid, 'owner')`);
  return { admin, id, slug };
}

describe('organizationPhotos.upload', () => {
  it('an admin adds a logo and a banner; both show on the public page and the list, audited', async () => {
    const { admin, id, slug } = await organizationWithAdmin('org-images');
    const logo = await uploadOrganizationPhoto(admin.principal, { organizationId: id, kind: 'logo', file: await image(300, 100) }, meta);
    expect(logo.logo?.large).toMatch(/^\/api\/organization-photos\/[0-9a-f-]{36}\/[0-9a-f]{16}\/512\.webp$/);
    const banner = await uploadOrganizationPhoto(admin.principal, { organizationId: id, kind: 'banner', file: await image() }, meta);
    expect(banner.banner).toMatchObject({ width: 640, height: 200 });
    const page = await organizationGet(null, { slug });
    expect(page.logo).toEqual(logo.logo);
    expect(page.banner).toEqual(banner.banner);
    expect((await organizationsList()).organizations.find((o) => o.slug === slug)).toMatchObject({ logo: logo.logo, banner: banner.banner });
    const actions = await getDb().select({ action: auditLog.action }).from(auditLog).where(and(eq(auditLog.subjectType, 'organization'), eq(auditLog.subjectId, id)));
    expect(actions.map((a) => a.action)).toEqual(['organization_photo.upload', 'organization_photo.upload']);
    const response = await handlePhotoRequest(new Request(`http://localhost${banner.banner!.full}`), addressOf(banner.banner!.full), { kind: 'organization' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, no-cache');
  });

  it('strips the GPS position from every rendition', async () => {
    const { admin, id } = await organizationWithAdmin('org-gps');
    const gps = async () => new File([new Uint8Array(await jpegWithGps(320, 200))], 'demo.jpg', { type: 'image/jpeg' });
    const logo = (await uploadOrganizationPhoto(admin.principal, { organizationId: id, kind: 'logo', file: await gps() }, meta)).logo!;
    const banner = (await uploadOrganizationPhoto(admin.principal, { organizationId: id, kind: 'banner', file: await gps() }, meta)).banner!;
    for (const url of [logo.small, logo.large, banner.large, banner.full]) {
      const served = await openOrganizationPhoto(null, addressOf(url));
      const bytes = served && !served.notModified ? served.bytes : new Uint8Array();
      expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('WEBP');
      expect((await imageFacts(bytes)).exif).toBe(false);
      expect(containsAscii(bytes, 'GPS')).toBe(false);
    }
  });

  it('a new banner replaces the old one: the old row replaced, its files deleted, its address 404', async () => {
    const { admin, id } = await organizationWithAdmin('org-replace');
    const first = (await uploadOrganizationPhoto(admin.principal, { organizationId: id, kind: 'banner', file: await image() }, meta)).banner!;
    const second = await uploadOrganizationPhoto(admin.principal, { organizationId: id, kind: 'banner', file: await image(800, 300) }, meta);
    expect(second.replaced).toBe(true);
    const rows = await rowsOf(id);
    expect(rows.map((r) => [r.kind, r.status])).toEqual([
      ['banner', 'replaced'],
      ['banner', 'active'],
    ]);
    expect(filesIn(photoRoot).some((f) => f.startsWith(`${rows[0]!.storageKey}/`))).toBe(false);
    expect(await openOrganizationPhoto(null, addressOf(first.full))).toBeNull();
  });

  it('anyone else may not upload: anonymous UNAUTHORIZED; another member, staff and a missing organization NOT_FOUND', async () => {
    const { id } = await organizationWithAdmin('org-others');
    const other = await member('org-others-stranger');
    const moderator = await staff('org-others-mod');
    expect(await codeOf(uploadOrganizationPhoto(null, { organizationId: id, kind: 'logo', file: await image() }, meta))).toBe('UNAUTHORIZED');
    expect(await codeOf(uploadOrganizationPhoto(other.principal, { organizationId: id, kind: 'logo', file: await image() }, meta))).toBe('NOT_FOUND');
    expect(await codeOf(uploadOrganizationPhoto(moderator.principal, { organizationId: id, kind: 'logo', file: await image() }, meta))).toBe('NOT_FOUND');
    expect(await codeOf(uploadOrganizationPhoto(other.principal, { organizationId: uuidv7(), kind: 'logo', file: await image() }, meta))).toBe('NOT_FOUND');
    expect(await rowsOf(id)).toEqual([]);
  });
});

describe('removal', () => {
  it('the admin removes without a reason; staff need one and the admins are told', async () => {
    const { admin, id, slug } = await organizationWithAdmin('org-remove');
    const logo = (await uploadOrganizationPhoto(admin.principal, { organizationId: id, kind: 'logo', file: await image(200, 200) }, meta)).logo!;
    const banner = (await uploadOrganizationPhoto(admin.principal, { organizationId: id, kind: 'banner', file: await image() }, meta)).banner!;
    const other = await member('org-remove-stranger');
    expect(await codeOf(removeOrganizationPhoto(other.principal, { photoId: logo.id }, meta))).toBe('NOT_FOUND');
    const unverified = await staff('org-remove-no2fa', 'moderator', { unverified: true });
    expect(await codeOf(removeOrganizationPhoto(unverified.principal, { photoId: logo.id, reason: 'Demo.' }, meta))).toBe('SECOND_FACTOR_REQUIRED');
    const moderator = await staff('org-remove-mod');
    expect(await codeOf(removeOrganizationPhoto(moderator.principal, { photoId: logo.id }, meta))).toBe('BAD_REQUEST');
    await removeOrganizationPhoto(moderator.principal, { photoId: logo.id, reason: 'A fictional moderation reason.' }, meta);
    const removed = (await rowsOf(id)).find((r) => r.id === logo.id)!;
    expect(removed).toMatchObject({ status: 'removed', removedByUserId: moderator.account.id, removalReason: 'A fictional moderation reason.' });
    expect(filesIn(photoRoot).some((f) => f.startsWith(`${removed.storageKey}/`))).toBe(false);
    const told = await getDb().select().from(notification).where(and(eq(notification.userId, admin.account.id), eq(notification.template, 'content.removed')));
    expect(told.map((n) => n.payload)).toEqual([{ content: 'organization_photo', reason: 'A fictional moderation reason.' }]);
    // The admin removes their own without a reason, and nobody is told.
    await removeOrganizationPhoto(admin.principal, { photoId: banner.id }, meta);
    const page = await organizationGet(null, { slug });
    expect([page.logo, page.banner]).toEqual([null, null]);
    expect(await getDb().select().from(notification).where(eq(notification.userId, admin.account.id))).toHaveLength(1);
  });
});

describe('visibility', () => {
  it('an organization not yet approved: its images are 404 to everyone but its admins and staff with 2FA', async () => {
    const { admin, id } = await organizationWithAdmin('org-pending', 'pending');
    const logo = (await uploadOrganizationPhoto(admin.principal, { organizationId: id, kind: 'logo', file: await image(200, 200) }, meta)).logo!;
    const other = await member('org-pending-viewer');
    const moderator = await staff('org-pending-mod');
    const address = addressOf(logo.large);
    expect(await openOrganizationPhoto(null, address)).toBeNull();
    expect(await openOrganizationPhoto(other.principal, address)).toBeNull();
    expect((await openOrganizationPhoto(admin.principal, address))?.public).toBe(false);
    expect((await openOrganizationPhoto(moderator.principal, address))?.public).toBe(false);
    expect((await handlePhotoRequest(new Request(`http://localhost${logo.large}`), address, { kind: 'organization' })).status).toBe(404);
    expect(await codeOf(getOrganizationPhotos(other.principal, { organizationId: id }))).toBe('NOT_FOUND');
    expect(await getOrganizationPhotos(admin.principal, { organizationId: id })).toMatchObject({ canChange: true, canModerate: false, logo, banner: null });
    expect((await getOrganizationPhotos(moderator.principal, { organizationId: id })).canModerate).toBe(true);
    // An organization's image is no school photo: the school route does not serve it.
    expect((await handlePhotoRequest(new Request(`http://localhost${logo.large}`), address, { kind: 'school' })).status).toBe(404);
  });
});
