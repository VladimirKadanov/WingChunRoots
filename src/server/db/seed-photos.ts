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
import { demoPortrait, renderProfilePhoto } from '../storage/photo';
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
}

/** Renders the demo photos and writes their files to the photo store; returns their rows' values. */
export async function writeDemoPhotos(store: ObjectStore = getPhotoStore()): Promise<DemoPhoto[]> {
  const out: DemoPhoto[] = [];
  for (const [index, slug] of DEMO_PHOTO_SLUGS.entries()) {
    const seed = digest(`wingchunroots:demo-photo:v1:${slug}`);
    const original = await demoPortrait(seed.readUInt32BE(0));
    const rendered = await renderProfilePhoto(original);
    const storageKey = `photos/${seed.subarray(4, 28).toString('hex')}`;
    for (const [size, bytes] of Object.entries(rendered.renditions)) {
      await store.put(`${storageKey}/${size}`, bytes, { contentType: 'image/webp', sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    const large = rendered.renditions[512];
    out.push({
      slug,
      id: uuidv7FromParts(DEMO_PHOTOS_AT.getTime() + index, 0, seed.subarray(24, 32)),
      storageKey,
      sha256: createHash('sha256').update(large).digest('hex'),
      originalSha256: createHash('sha256').update(original).digest('hex'),
      side: rendered.side,
      sizeBytes: large.byteLength,
      createdAt: DEMO_PHOTOS_AT,
    });
  }
  return out;
}
