// What an evidence upload is, and what is stored of it (milestone M10a; plan §6.4):
//
//   - the type comes from the file's magic bytes, never from its name or the client's
//     Content-Type: JPEG (FF D8 FF), PNG (89 50 4E 47 0D 0A 1A 0A), WebP (RIFF....WEBP) and PDF
//     (%PDF-) only. A renamed executable is none of them and is refused;
//   - images are decoded and encoded again with sharp, which keeps the pixels (turned upright by
//     their EXIF orientation first) and drops every metadata block: EXIF with its GPS position,
//     XMP, IPTC and the comments. A file sharp cannot decode is refused;
//   - a PDF is stored as uploaded, byte for byte (its SHA-256 equals the client's);
//   - ADR 0088 (impersonation reports): a short private video, MP4 (an ISO BMFF `ftyp` box at byte
//     4 with a video brand, not an HEIC or AVIF image's) or WebM (EBML 1A 45 DF A3 with the DocType
//     "webm"), is also stored as uploaded. sniffMime never returns one: only
//     sniffVideo does, and only an identity report's case takes it (evidence.ts).

import sharp, { type Sharp } from 'sharp';

import { EVIDENCE_MIME_TYPES } from '../db/schema/common';

export type EvidenceMime = (typeof EVIDENCE_MIME_TYPES)[number];

/** The bytes of the start of a file that sniffMime needs. */
export const SNIFF_BYTES = 12;

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((byte, i) => bytes[offset + i] === byte);

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];
const FTYP = [0x66, 0x74, 0x79, 0x70];
const EBML = [0x1a, 0x45, 0xdf, 0xa3];

export type EvidenceVideoMime = 'video/mp4' | 'video/webm';
export type EvidenceDocumentMime = Exclude<EvidenceMime, EvidenceVideoMime>;

/** The evidence type of a file by its first bytes, or null when it is not one of the four. */
export function sniffMime(head: Uint8Array): EvidenceMime | null {
  if (startsWith(head, JPEG)) return 'image/jpeg';
  if (startsWith(head, PNG)) return 'image/png';
  if (startsWith(head, RIFF) && startsWith(head, WEBP, 8)) return 'image/webp';
  if (startsWith(head, PDF)) return 'application/pdf';
  return null;
}

/** ADR 0088: the video type of a file by its first bytes (MP4 or WebM), or null. */
export function sniffVideo(head: Uint8Array): EvidenceVideoMime | null {
  // MP4: `ftyp` and a video major brand. HEIC and AVIF images share the box, so a brand outside the
  // list (heic, mif1, avif…) is no video. QuickTime (`qt  `) is what an iPhone records; it plays as MP4.
  if (startsWith(head, FTYP, 4) && head.length >= 12 && MP4_BRANDS.has(String.fromCharCode(...head.subarray(8, 12)))) return 'video/mp4';
  // WebM: an EBML header whose DocType is "webm" (Matroska files say "matroska").
  if (startsWith(head, EBML) && includes(head.subarray(0, 64), WEBM_DOCTYPE)) return 'video/webm';
  return null;
}

const MP4_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso8', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ', 'mmp4', 'qt  ']);
/** The EBML DocType element (42 82), its one-byte size (0x84) and "webm". */
const WEBM_DOCTYPE = [0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d];

function includes(bytes: Uint8Array, needle: readonly number[]): boolean {
  for (let i = 0; i + needle.length <= bytes.length; i++) if (startsWith(bytes, needle, i)) return true;
  return false;
}

export const isImage = (mime: EvidenceMime): mime is Exclude<EvidenceDocumentMime, 'application/pdf'> => mime.startsWith('image/');
export const isVideo = (mime: string): mime is EvidenceVideoMime => mime.startsWith('video/');

/** The file extension of a type, for the download's file name. */
export const EXTENSION: Record<EvidenceMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/**
 * The largest image sharp decodes: 50 megapixels (a 20 MB file can hold a far larger image that
 * would fill the server's memory when decoded, a "decompression bomb"). Phone photographs and
 * scans of documents are well below it.
 */
export const MAX_IMAGE_PIXELS = 50_000_000;

export class ImageRefused extends Error {
  constructor(readonly reason: 'unreadable' | 'too_large') {
    super(reason === 'too_large' ? 'The image is larger than the limit.' : 'The image could not be read.');
    this.name = 'ImageRefused';
  }
}

sharp.cache(false);

/**
 * The image decoded and encoded again in its own format, without any metadata (sharp keeps none
 * unless asked: no EXIF, GPS, XMP, IPTC or ICC block is copied). `.rotate()` without an angle first
 * turns the pixels by the EXIF orientation, so a photograph stays upright once that tag is gone.
 * Animated images keep their first frame.
 */
export async function reencodeImage(bytes: Uint8Array, mime: Exclude<EvidenceDocumentMime, 'application/pdf'>): Promise<Uint8Array> {
  let pipeline: Sharp;
  try {
    pipeline = sharp(bytes, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS, animated: false }).rotate();
  } catch {
    throw new ImageRefused('unreadable');
  }
  if (mime === 'image/jpeg') pipeline = pipeline.jpeg({ quality: 90 });
  else if (mime === 'image/png') pipeline = pipeline.png({ compressionLevel: 9 });
  else pipeline = pipeline.webp({ quality: 90 });
  try {
    return new Uint8Array(await pipeline.toBuffer());
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    throw new ImageRefused(/pixel limit/i.test(message) ? 'too_large' : 'unreadable');
  }
}
