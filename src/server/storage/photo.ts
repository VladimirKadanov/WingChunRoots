// Profile photos (milestone M14; docs/adr/0016-profile-photos.md): what is stored of an upload.
// Built on the evidence rules of ./sanitize.ts and the same library (sharp; no new dependency):
//
//   - the type comes from the magic bytes only (sniffMime): JPEG, PNG or WebP. A PDF, a renamed
//     executable or anything else is refused, whatever its name or Content-Type;
//   - the image is decoded with the decompression-bomb guard of evidence (MAX_IMAGE_PIXELS) and
//     `failOn: 'error'`; an animated image keeps its first frame;
//   - `.rotate()` turns the pixels upright by the EXIF orientation first, so the photo stays
//     upright once that tag is gone;
//   - a centred square is cut from it and encoded again as WebP at every size of PHOTO_SIZES (no
//     larger than the square itself: a small photo is never blown up); sharp copies no metadata
//     (no EXIF with its GPS position, no XMP, IPTC, ICC or comment) unless asked, and it is not.

import sharp from 'sharp';

import { PHOTO_MIN_SIDE, PHOTO_SIZES } from '../db/schema/common';
import { ImageRefused, MAX_IMAGE_PIXELS, sniffMime } from './sanitize';

export type PhotoSize = (typeof PHOTO_SIZES)[number];

export class PhotoRefused extends Error {
  constructor(readonly reason: 'not_image' | 'unreadable' | 'too_large' | 'too_small') {
    super(
      reason === 'not_image'
        ? 'The file is not a JPEG, PNG or WebP image.'
        : reason === 'too_large'
          ? 'The image is larger than the limit.'
          : reason === 'too_small'
            ? 'The image is too small.'
            : 'The image could not be read.',
    );
    this.name = 'PhotoRefused';
  }
}

export interface RenderedPhoto {
  /** The side of the largest rendition (a square). */
  side: number;
  /** One WebP per size of PHOTO_SIZES, no larger than `side`. */
  renditions: Record<PhotoSize, Uint8Array>;
}

/** The orientations (EXIF 5–8) that swap width and height once the image is turned upright. */
const SWAPS = new Set([5, 6, 7, 8]);

/**
 * The upload as it is stored: sniffed, decoded under the pixel limit, turned upright, cropped to a
 * centred square and encoded as WebP at each size, without any metadata. Throws PhotoRefused.
 */
export async function renderProfilePhoto(bytes: Uint8Array): Promise<RenderedPhoto> {
  const mime = sniffMime(bytes);
  if (mime === null || mime === 'application/pdf') throw new PhotoRefused('not_image');
  const open = () => sharp(bytes, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS, animated: false });
  let width: number;
  let height: number;
  try {
    const meta = await open().metadata();
    if (!meta.width || !meta.height) throw new PhotoRefused('unreadable');
    if (meta.width * meta.height > MAX_IMAGE_PIXELS) throw new PhotoRefused('too_large');
    const swap = SWAPS.has(meta.orientation ?? 1);
    width = swap ? meta.height : meta.width;
    height = swap ? meta.width : meta.height;
  } catch (error) {
    throw refusal(error);
  }
  const square = Math.min(width, height);
  if (square < PHOTO_MIN_SIDE) throw new PhotoRefused('too_small');
  const largest = PHOTO_SIZES[PHOTO_SIZES.length - 1]!;
  const side = Math.min(square, largest);
  const renditions = {} as Record<PhotoSize, Uint8Array>;
  try {
    for (const size of PHOTO_SIZES) {
      const target = Math.min(size, side);
      const out = await open()
        .rotate()
        .resize(target, target, { fit: 'cover', position: 'centre' })
        .toColourspace('srgb')
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
      renditions[size] = new Uint8Array(out);
    }
  } catch (error) {
    throw refusal(error);
  }
  return { side, renditions };
}

function refusal(error: unknown): PhotoRefused {
  if (error instanceof PhotoRefused) return error;
  if (error instanceof ImageRefused) return new PhotoRefused(error.reason);
  const message = error instanceof Error ? error.message : '';
  return new PhotoRefused(/pixel limit/i.test(message) ? 'too_large' : 'unreadable');
}

/**
 * M14 (D20): a clearly fictional, generated portrait for the demo data: an abstract ink-brush
 * composition of circles and strokes on paper, from a seed, drawn as SVG and rasterised by sharp.
 * Never a face, never a photograph, nothing downloaded.
 */
export async function demoPortrait(seed: number): Promise<Uint8Array> {
  let state = seed >>> 0 || 1;
  const next = () => {
    // xorshift32: deterministic, so two seeds give the same images on every run.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
  const papers = ['#efe6d2', '#e7dcc4', '#f2ecdf', '#e9e1cf'];
  const inks = ['#1f1b16', '#3b2f25', '#7a2418', '#2a3a3a'];
  const paper = papers[Math.floor(next() * papers.length)]!;
  const ink = inks[Math.floor(next() * inks.length)]!;
  const accent = '#a3281a';
  const shapes: string[] = [];
  // An ensō: an open brush circle.
  const r = 150 + next() * 40;
  const start = next() * Math.PI * 2;
  const sweep = Math.PI * (1.55 + next() * 0.3);
  const point = (a: number) => `${(256 + r * Math.cos(a)).toFixed(1)} ${(256 + r * Math.sin(a)).toFixed(1)}`;
  shapes.push(
    `<path d="M ${point(start)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 1 1 ${point(start + sweep)}" fill="none" stroke="${ink}" stroke-width="${(26 + next() * 14).toFixed(1)}" stroke-linecap="round" opacity="0.92"/>`,
  );
  // A few strokes across it.
  const strokes = 2 + Math.floor(next() * 3);
  for (let i = 0; i < strokes; i++) {
    const y = 140 + next() * 240;
    const x1 = 90 + next() * 80;
    const x2 = 340 + next() * 80;
    shapes.push(
      `<path d="M ${x1.toFixed(1)} ${y.toFixed(1)} Q 256 ${(y + (next() - 0.5) * 120).toFixed(1)} ${x2.toFixed(1)} ${(y + (next() - 0.5) * 40).toFixed(1)}" fill="none" stroke="${ink}" stroke-width="${(6 + next() * 10).toFixed(1)}" stroke-linecap="round" opacity="0.75"/>`,
    );
  }
  // A seal in the corner.
  shapes.push(`<rect x="${(372 + next() * 40).toFixed(1)}" y="${(372 + next() * 40).toFixed(1)}" width="56" height="56" rx="6" fill="${accent}" opacity="0.9"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="${paper}"/>${shapes.join('')}</svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}
