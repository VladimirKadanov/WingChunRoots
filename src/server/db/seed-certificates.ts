// The demo certificates of `pnpm db:seed` (milestone M19; D20; docs/adr/0022-passport.md): two
// generated scans (src/server/storage/photo.ts demoCertificate) rendered by the pipeline of an
// upload. Apart from the demo photos (seed-photos.ts) on purpose: their files go to the private
// store (the evidence bucket), never the photo store, and the photo code never touches that store.
//
// Deterministic, like the demo photos: the keys come from the certificate's key, not randomness.

import { createHash } from 'node:crypto';

import { DEMO_CERTIFICATES } from '../../fixtures/generate';
import { getEvidenceStore, type ObjectStore } from '../storage';
import { demoCertificate, renderGalleryPhoto } from '../storage/photo';
import { putAll } from './seed-photos';

const digest = (text: string) => createHash('sha256').update(text).digest();

/** M19: the files of a demo certificate (the values its row takes from them). */
export interface DemoCertificateFile {
  key: (typeof DEMO_CERTIFICATES)[number]['key'];
  storageKey: string;
  sha256: string;
  width: number;
  height: number;
  sizeBytes: number;
}

/**
 * M19 (D20): renders the demo certificates (src/fixtures/generate.ts DEMO_CERTIFICATES) through the
 * pipeline of an upload and writes their files to the private store (the evidence bucket, never
 * the photo store: a private certificate is served only through the app, ADR 0022).
 */
export async function writeDemoCertificates(store: ObjectStore = getEvidenceStore()): Promise<DemoCertificateFile[]> {
  const out: DemoCertificateFile[] = [];
  for (const c of DEMO_CERTIFICATES) {
    const seed = digest(`wingchunroots:demo-certificate:v1:${c.key}`);
    const rendered = await renderGalleryPhoto(await demoCertificate(seed.readUInt32BE(0)));
    const storageKey = `certificates/${seed.subarray(4, 28).toString('hex')}`;
    await putAll(store, storageKey, { ...rendered.renditions, full: rendered.full.bytes });
    out.push({
      key: c.key,
      storageKey,
      sha256: createHash('sha256').update(rendered.full.bytes).digest('hex'),
      width: rendered.full.width,
      height: rendered.full.height,
      sizeBytes: rendered.full.bytes.byteLength,
    });
  }
  return out;
}
