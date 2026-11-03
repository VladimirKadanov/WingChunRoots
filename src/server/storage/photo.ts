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

import { PHOTO_FULL_MAX_SIDE, PHOTO_MIN_SIDE, PHOTO_SIZES } from '../db/schema/common';
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

/** M16: the whole photo, upright, for the gallery's viewer. */
export interface FullRendition {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** M16: a gallery or room photo: the squares of a profile photo and the whole photo (`full`). */
export interface RenderedGalleryPhoto extends RenderedPhoto {
  full: FullRendition;
}

/** The upright size of an upload, refused when it is not an image or over the pixel limit. */
async function uprightSize(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const mime = sniffMime(bytes);
  if (mime === null || mime === 'application/pdf') throw new PhotoRefused('not_image');
  try {
    const meta = await openImage(bytes).metadata();
    if (!meta.width || !meta.height) throw new PhotoRefused('unreadable');
    if (meta.width * meta.height > MAX_IMAGE_PIXELS) throw new PhotoRefused('too_large');
    const swap = SWAPS.has(meta.orientation ?? 1);
    return { width: swap ? meta.height : meta.width, height: swap ? meta.width : meta.height };
  } catch (error) {
    throw refusal(error);
  }
}

const openImage = (bytes: Uint8Array) => sharp(bytes, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS, animated: false });

/**
 * M16 (docs/adr/0019-galleries.md): a photo of a person's gallery or of a school's training room:
 * the centred squares of renderProfilePhoto (so any gallery photo can become the profile photo and
 * the grid shows squares), and the whole photo, upright, at most PHOTO_FULL_MAX_SIDE on its longer
 * side and never enlarged, for the viewer. Every rendition is encoded again as WebP; sharp copies
 * no metadata, so no EXIF (and no GPS position), XMP, IPTC or ICC survives in any of them.
 */
export async function renderGalleryPhoto(bytes: Uint8Array): Promise<RenderedGalleryPhoto> {
  const squares = await renderProfilePhoto(bytes);
  const { width, height } = await uprightSize(bytes);
  const scale = Math.min(1, PHOTO_FULL_MAX_SIDE / Math.max(width, height));
  const target = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  try {
    const out = await openImage(bytes)
      .rotate()
      .resize(target.width, target.height, { fit: 'fill' })
      .toColourspace('srgb')
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return { ...squares, full: { bytes: new Uint8Array(out.data), width: out.info.width, height: out.info.height } };
  } catch (error) {
    throw refusal(error);
  }
}

/**
 * M16: a school's logo, whole (never cropped: a wide logo keeps its ends), centred on a
 * transparent square at 96 and 512 px (no larger than its longer side, never enlarged). Its longer
 * side must be at least PHOTO_MIN_SIDE. Encoded again as WebP with alpha, without any metadata.
 */
export async function renderSchoolLogo(bytes: Uint8Array): Promise<RenderedPhoto> {
  const { width, height } = await uprightSize(bytes);
  const longer = Math.max(width, height);
  if (longer < PHOTO_MIN_SIDE) throw new PhotoRefused('too_small');
  const largest = PHOTO_SIZES[PHOTO_SIZES.length - 1]!;
  const side = Math.min(longer, largest);
  const renditions = {} as Record<PhotoSize, Uint8Array>;
  try {
    for (const size of PHOTO_SIZES) {
      const target = Math.min(size, side);
      const out = await openImage(bytes)
        .rotate()
        .resize(target, target, { fit: 'contain', position: 'centre', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .toColourspace('srgb')
        .webp({ quality: 86, effort: 4, alphaQuality: 100 })
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

/** xorshift32 from a seed: the same seed gives the same images on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * M16 (D20): a clearly fictional, generated "training room" for the demo schools and galleries: a
 * wide abstract of floorboards, a wooden dummy's silhouette as plain bars and window light, drawn
 * as SVG and rasterised by sharp. Never a photograph, never a real place, nothing downloaded.
 */
export async function demoRoom(seed: number, width = 1200, height = 800): Promise<Uint8Array> {
  const next = seeded(seed);
  const walls = ['#e9e1cf', '#e2d6bd', '#ece4d4'];
  const floors = ['#8a6a4a', '#7a5c40', '#94744f'];
  const wall = walls[Math.floor(next() * walls.length)]!;
  const floor = floors[Math.floor(next() * floors.length)]!;
  const horizon = Math.round(height * (0.55 + next() * 0.1));
  const shapes: string[] = [`<rect width="${width}" height="${height}" fill="${wall}"/>`, `<rect y="${horizon}" width="${width}" height="${height - horizon}" fill="${floor}"/>`];
  for (let x = 0; x < width; x += 60 + Math.floor(next() * 30)) {
    shapes.push(`<line x1="${x}" y1="${horizon}" x2="${x - 120}" y2="${height}" stroke="#2a2018" stroke-opacity="0.25" stroke-width="3"/>`);
  }
  const windows = 1 + Math.floor(next() * 3);
  for (let i = 0; i < windows; i++) {
    const wx = Math.round(width * (0.1 + i * 0.3 + next() * 0.05));
    shapes.push(`<rect x="${wx}" y="${Math.round(height * 0.12)}" width="${Math.round(width * 0.16)}" height="${Math.round(height * 0.28)}" fill="#fbf8f0" stroke="#3b2f25" stroke-width="6"/>`);
  }
  const dx = Math.round(width * (0.55 + next() * 0.2));
  shapes.push(`<rect x="${dx}" y="${horizon - 260}" width="34" height="300" rx="10" fill="#3b2f25"/>`);
  shapes.push(`<rect x="${dx - 50}" y="${horizon - 200}" width="134" height="14" rx="6" fill="#3b2f25"/>`);
  shapes.push(`<rect x="${dx - 30}" y="${horizon - 140}" width="94" height="14" rx="6" fill="#3b2f25"/>`);
  shapes.push(`<rect x="${width - 120}" y="${height - 120}" width="72" height="72" rx="8" fill="#a3281a" opacity="0.9"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shapes.join('')}</svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

/** M16 (D20): a generated, fictional school logo: a red seal with a ring and bars, wider than high. */
export async function demoLogo(seed: number): Promise<Uint8Array> {
  const next = seeded(seed);
  const ink = ['#1f1b16', '#7a2418', '#2a3a3a'][Math.floor(next() * 3)]!;
  const bars = 2 + Math.floor(next() * 3);
  const parts = [`<circle cx="160" cy="160" r="120" fill="none" stroke="${ink}" stroke-width="22"/>`, `<rect x="110" y="110" width="100" height="100" rx="10" fill="#a3281a"/>`];
  for (let i = 0; i < bars; i++) parts.push(`<rect x="330" y="${90 + i * 50}" width="${220 + Math.round(next() * 120)}" height="26" rx="6" fill="${ink}"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="320" viewBox="0 0 720 320">${parts.join('')}</svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}
