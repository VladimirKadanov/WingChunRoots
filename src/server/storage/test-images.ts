// Test images for the evidence tests (milestone M10a): built here because only src/server/storage
// may import sharp (ESLint, modulePackages). Every image is generated, flat colour, with fictional
// metadata: a camera named "DemoCam" and a GPS position that points at no real place of the pilot.
// Only tests import this file.

import { crc32 } from 'node:zlib';

import sharp from 'sharp';

/** A flat-colour image of `width` x `height` in `format`, with no metadata. */
export async function plainImage(format: 'jpeg' | 'png' | 'webp', width = 64, height = 48): Promise<Uint8Array> {
  const image = sharp({ create: { width, height, channels: 3, background: { r: 180, g: 40, b: 30 } } });
  const buffer = await (format === 'jpeg' ? image.jpeg() : format === 'png' ? image.png() : image.webp()).toBuffer();
  return new Uint8Array(buffer);
}

/** The fictional camera name and GPS reference written into the test EXIF block. */
export const TEST_EXIF_CAMERA = 'DemoCam';

/**
 * A little-endian TIFF block as EXIF carries it: IFD0 with Make = DemoCam and a GPSInfo pointer,
 * and a GPS IFD with latitude 12°34'56" N and longitude 65°43'21" E (fictional).
 */
export function exifTiff(): Uint8Array {
  const buf = new Uint8Array(148);
  const view = new DataView(buf.buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((c, i) => (buf[offset + i] = c.charCodeAt(0)));
  // Header: "II", 42, IFD0 at 8.
  ascii(0, 'II');
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  const entry = (offset: number, tag: number, type: number, count: number, value: number) => {
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, count, true);
    view.setUint32(offset + 8, value, true);
  };
  // IFD0 (8..38): Make (ASCII, 8 bytes at 38), GPSInfo (LONG, the GPS IFD at 46); no next IFD.
  view.setUint16(8, 2, true);
  entry(10, 0x010f, 2, 8, 38);
  entry(22, 0x8825, 4, 1, 46);
  view.setUint32(34, 0, true);
  ascii(38, `${TEST_EXIF_CAMERA}\0`);
  // GPS IFD (46..100): LatitudeRef "N", Latitude (3 RATIONAL at 100), LongitudeRef "E", Longitude (at 124).
  view.setUint16(46, 4, true);
  entry(48, 0x0001, 2, 2, 0);
  ascii(56, 'N\0');
  entry(60, 0x0002, 5, 3, 100);
  entry(72, 0x0003, 2, 2, 0);
  ascii(80, 'E\0');
  entry(84, 0x0004, 5, 3, 124);
  view.setUint32(96, 0, true);
  const rationals = (offset: number, values: number[]) =>
    values.forEach((v, i) => {
      view.setUint32(offset + i * 8, v, true);
      view.setUint32(offset + i * 8 + 4, 1, true);
    });
  rationals(100, [12, 34, 56]);
  rationals(124, [65, 43, 21]);
  return buf;
}

/** A JPEG with the EXIF block above (camera and GPS position) in an APP1 segment after SOI. */
export async function jpegWithGps(): Promise<Uint8Array> {
  const jpeg = await plainImage('jpeg');
  const tiff = exifTiff();
  const header = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0]); // "Exif\0\0"
  const length = 2 + header.length + tiff.length;
  const app1 = new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff, ...header, ...tiff]);
  return new Uint8Array([...jpeg.subarray(0, 2), ...app1, ...jpeg.subarray(2)]);
}

/** A PNG with the same EXIF block in an eXIf chunk before IDAT. */
export async function pngWithGps(): Promise<Uint8Array> {
  const png = await plainImage('png');
  const tiff = exifTiff();
  const type = new TextEncoder().encode('eXIf');
  const chunk = new Uint8Array(12 + tiff.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, tiff.length);
  chunk.set(type, 4);
  chunk.set(tiff, 8);
  view.setUint32(8 + tiff.length, crc32(Buffer.concat([type, tiff])) >>> 0);
  // After the 8-byte signature and the 25-byte IHDR chunk.
  const at = 8 + 25;
  return new Uint8Array([...png.subarray(0, at), ...chunk, ...png.subarray(at)]);
}

/** What sharp reads of an image: its format, size and whether it carries EXIF, XMP, IPTC or ICC. */
export async function imageFacts(bytes: Uint8Array) {
  const meta = await sharp(bytes).metadata();
  return {
    format: meta.format,
    width: meta.width,
    height: meta.height,
    exif: meta.exif !== undefined,
    xmp: meta.xmp !== undefined,
    iptc: meta.iptc !== undefined,
  };
}

/** Whether `needle` occurs in `bytes` (an ASCII marker such as "Exif" or the camera name). */
export function containsAscii(bytes: Uint8Array, needle: string): boolean {
  return Buffer.from(bytes).includes(Buffer.from(needle, 'latin1'));
}
