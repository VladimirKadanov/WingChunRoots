// The demo profile photos of `pnpm db:seed` (milestone M14; D20; docs/adr/0016-profile-photos.md).
// A handful of `demo-` people get a photo so the cards show both thumbnails and the monogram
// fallback. Every image is generated here, from a seed: an abstract ink-brush composition (an open
// circle, strokes and a red seal on paper; src/server/storage/photo.ts demoPortrait), rendered by
// the same pipeline as an upload. Never a face, never a photograph, nothing downloaded.
//
// Deterministic, so two loads give the same content hash: the ids, the storage keys and the times
// come from the slug, not from randomness (the demo data only; an upload's key is random).

import { createHash } from 'node:crypto';

import { getPhotoStore, type ObjectStore } from '../storage';
import { demoLogo, demoPortrait, demoRoom, renderGalleryPhoto, renderSchoolLogo } from '../storage/photo';
import { uuidv7FromParts } from './ids';

/** The demo people with a photo; the others (demo-root-a, demo-hub-a, ...) keep the monogram. */
export const DEMO_PHOTO_SLUGS = ['demo-root-b', 'demo-hub-b', 'demo-two-lineages', 'demo-cjk-name', 'demo-converging', 'demo-pro-sifu-8'] as const;

/** The time written on the demo photos (fixed, for the content hash). */
const DEMO_PHOTOS_AT = new Date(Date.UTC(2026, 0, 2));

const digest = (text: string) => createHash('sha256').update(text).digest();

export interface DemoPhoto {
  slug: string;
  id: string;
  storageKey: string;
  sha256: string;
  originalSha256: string;
  side: number;
  sizeBytes: number;
  createdAt: Date;
  /** M16: the whole photo's size (null for a logo). */
  fullWidth: number | null;
  fullHeight: number | null;
  /** M16: the place in the gallery and the caption. */
  position: number;
  caption: string | null;
  /**
   * M16: `profile` (the M14 photo), `gallery` (another photo of the person), `logo` or `room` (a
   * school's); M17: `poster` (an event's, by the event's slug; sha256 and sizeBytes of the whole image).
   */
  role: 'profile' | 'gallery' | 'logo' | 'room' | 'poster';
}

/**
 * M16 (D20): the demo galleries: two more photos (generated rooms) in the gallery of
 * demo-pro-sifu-8, beside its profile photo, with fictional captions. Every seeded gallery fits its
 * account's plan: demo-pro-sifu-8 has Professional Sifu (a grant, 100 photos); demo-two-lineages,
 * on Free Student (1 photo), keeps its profile photo alone (owner review, 2026-11-03).
 */
export const DEMO_GALLERY: readonly { slug: string; captions: readonly (string | null)[] }[] = [
  { slug: 'demo-pro-sifu-8', captions: ['Demo training hall, morning class', null] },
];

/**
 * M16 (D20): the demo schools' logos and room photos (generated, fictional), on `demo-` schools
 * only: a logo and two rooms for one exact-location school. demo-school-city-only stays without
 * photos: the M11 privacy check compares its public page with a twin that copies only its columns
 * and instructors (a copied photo would carry another id); a city-only school's photos are covered
 * by src/server/services/school-photos.int.test.ts.
 */
export const DEMO_SCHOOL_PHOTOS: readonly { slug: string; logo: boolean; rooms: readonly (string | null)[] }[] = [
  { slug: 'demo-school-sofia', logo: true, rooms: ['Demo main training room', 'Demo wooden dummy corner'] },
];

/** M17 (D20): the demo events with a generated poster (an abstract room, never a photograph). */
export const DEMO_EVENT_POSTERS: readonly string[] = ['demo-seminar-chum-kiu-sofia', 'demo-federation-summer-camp'];

export async function putAll(store: ObjectStore, storageKey: string, files: Record<string, Uint8Array>): Promise<void> {
  for (const [name, bytes] of Object.entries(files)) {
    await store.put(`${storageKey}/${name}`, bytes, { contentType: 'image/webp', sha256: createHash('sha256').update(bytes).digest('hex') });
  }
}

/** One generated demo image through the pipeline of an upload, its files written, its row's values. */
async function demoPhoto(
  store: ObjectStore,
  key: string,
  index: number,
  role: DemoPhoto['role'],
  slug: string,
  position: number,
  caption: string | null,
): Promise<DemoPhoto> {
  const seed = digest(key);
  const original = role === 'logo' ? await demoLogo(seed.readUInt32BE(0)) : role === 'profile' ? await demoPortrait(seed.readUInt32BE(0)) : await demoRoom(seed.readUInt32BE(0));
  const storageKey = `photos/${seed.subarray(4, 28).toString('hex')}`;
  let side: number;
  let large: Uint8Array;
  let full: { width: number; height: number; bytes: Uint8Array } | null = null;
  if (role === 'logo') {
    const rendered = await renderSchoolLogo(original);
    await putAll(store, storageKey, rendered.renditions);
    side = rendered.side;
    large = rendered.renditions[512];
  } else {
    const rendered = await renderGalleryPhoto(original);
    await putAll(store, storageKey, { ...rendered.renditions, full: rendered.full.bytes });
    side = rendered.side;
    large = rendered.renditions[512];
    full = { width: rendered.full.width, height: rendered.full.height, bytes: rendered.full.bytes };
  }
  // An event's poster is addressed by its whole image (src/server/services/events.ts).
  const hashed = role === 'poster' && full ? full.bytes : large;
  return {
    slug,
    id: uuidv7FromParts(DEMO_PHOTOS_AT.getTime() + index, 0, seed.subarray(24, 32)),
    storageKey,
    sha256: createHash('sha256').update(hashed).digest('hex'),
    originalSha256: createHash('sha256').update(original).digest('hex'),
    side,
    sizeBytes: hashed.byteLength,
    createdAt: DEMO_PHOTOS_AT,
    fullWidth: full?.width ?? null,
    fullHeight: full?.height ?? null,
    position,
    caption,
    role,
  };
}

/**
 * Renders the demo photos and writes their files to the photo store; returns their rows' values:
 * the profile photos of M14, then (M16) the other gallery photos and the schools' logos and rooms,
 * then (M17) the events' posters.
 */
export async function writeDemoPhotos(store: ObjectStore = getPhotoStore()): Promise<DemoPhoto[]> {
  const out: DemoPhoto[] = [];
  for (const [index, slug] of DEMO_PHOTO_SLUGS.entries()) {
    out.push(await demoPhoto(store, `wingchunroots:demo-photo:v1:${slug}`, index, 'profile', slug, 0, null));
  }
  let index = 100;
  for (const g of DEMO_GALLERY) {
    for (const [i, caption] of g.captions.entries()) out.push(await demoPhoto(store, `wingchunroots:demo-gallery:v1:${g.slug}:${i}`, index++, 'gallery', g.slug, i + 1, caption));
  }
  index = 200;
  for (const s of DEMO_SCHOOL_PHOTOS) {
    if (s.logo) out.push(await demoPhoto(store, `wingchunroots:demo-school-logo:v1:${s.slug}`, index++, 'logo', s.slug, 0, null));
    for (const [i, caption] of s.rooms.entries()) out.push(await demoPhoto(store, `wingchunroots:demo-school-room:v1:${s.slug}:${i}`, index++, 'room', s.slug, i, caption));
  }
  index = 300;
  for (const slug of DEMO_EVENT_POSTERS) out.push(await demoPhoto(store, `wingchunroots:demo-event-poster:v1:${slug}`, index++, 'poster', slug, 0, null));
  return out;
}
