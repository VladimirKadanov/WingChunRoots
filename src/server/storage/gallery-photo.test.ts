// Gallery, room and logo processing (milestone M16; docs/adr/0019-galleries.md): every rendition
// is encoded again without metadata (no EXIF, so no GPS position: CLAUDE.md §6, the exact place a
// school photo was taken never leaves the upload), the whole photo is kept upright and never
// enlarged, and a logo is never cropped. Every image is generated, flat colour, with fictional
// metadata (./test-images.ts).

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { PHOTO_FULL_MAX_SIDE, PHOTO_RENDITION_MAX_BYTES } from '../db/schema/common';
import { PhotoRefused, renderGalleryPhoto, renderSchoolLogo } from './photo';
import { alphaAt, containsAscii, imageFacts, jpegWithGps, orientedJpeg, pixelAt, plainImage, pngWithGps, TEST_EXIF_CAMERA } from './test-images';

async function refusalOf(render: () => Promise<unknown>): Promise<string> {
  try {
    await render();
  } catch (error) {
    if (error instanceof PhotoRefused) return error.reason;
    throw error;
  }
  return 'accepted';
}

describe('renderGalleryPhoto', () => {
  it('encodes a detailed photo again until its whole rendition fits the routes\' limit (code review)', async () => {
    // Pseudo-random pixels from a fixed seed (generated, nothing of a real person): at quality 82
    // its whole photo is over 1 MB, so the first encoding does not fit.
    const width = 1280;
    const height = 1280;
    const raw = Buffer.alloc(width * height * 3);
    let seed = 12345;
    for (let i = 0; i < raw.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      raw[i] = (seed >> 16) & 255;
    }
    const noisy = new Uint8Array(await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer());
    expect((await sharp(noisy).webp({ quality: 82, effort: 4 }).toBuffer()).byteLength).toBeGreaterThan(PHOTO_RENDITION_MAX_BYTES);
    const rendered = await renderGalleryPhoto(noisy);
    expect(rendered.full.bytes.byteLength).toBeLessThanOrEqual(PHOTO_RENDITION_MAX_BYTES);
    expect(Math.max(rendered.full.width, rendered.full.height)).toBeLessThanOrEqual(PHOTO_FULL_MAX_SIDE);
    for (const bytes of Object.values(rendered.renditions)) expect(bytes.byteLength).toBeLessThanOrEqual(PHOTO_RENDITION_MAX_BYTES);
  });

  it('stores the squares and the whole photo as WebP, without EXIF, GPS, XMP or IPTC in any rendition', async () => {
    const original = await jpegWithGps(1600, 900);
    expect(containsAscii(original, TEST_EXIF_CAMERA)).toBe(true);
    const rendered = await renderGalleryPhoto(original);
    expect(rendered.side).toBe(512);
    const all: [string, Uint8Array][] = [...Object.entries(rendered.renditions), ['full', rendered.full.bytes]];
    for (const [name, bytes] of all) {
      const facts = await imageFacts(bytes);
      expect(facts, name).toMatchObject({ format: 'webp', exif: false, xmp: false, iptc: false });
      expect(containsAscii(bytes, TEST_EXIF_CAMERA), name).toBe(false);
      expect(containsAscii(bytes, 'Exif'), name).toBe(false);
    }
    // The whole photo: its shape kept, its longer side at the limit.
    expect(rendered.full.width).toBe(PHOTO_FULL_MAX_SIDE);
    expect(rendered.full.height).toBe(720);
    expect(await imageFacts(rendered.full.bytes)).toMatchObject({ width: PHOTO_FULL_MAX_SIDE, height: 720 });
  });

  it('drops the EXIF block of a PNG in the whole photo too', async () => {
    const rendered = await renderGalleryPhoto(await pngWithGps(300, 200));
    expect((await imageFacts(rendered.full.bytes)).exif).toBe(false);
    expect(containsAscii(rendered.full.bytes, TEST_EXIF_CAMERA)).toBe(false);
  });

  it('never enlarges the whole photo and keeps it upright by its EXIF orientation', async () => {
    const rendered = await renderGalleryPhoto(await orientedJpeg());
    // Upright the image is 100 x 200, red above blue.
    expect([rendered.full.width, rendered.full.height]).toEqual([100, 200]);
    const [top, bottom] = [await pixelAt(rendered.full.bytes, 50, 20), await pixelAt(rendered.full.bytes, 50, 180)];
    expect(top[0]).toBeGreaterThan(200);
    expect(bottom[2]).toBeGreaterThan(200);
  });

  it('refuses what is not an image and a photo too small for its squares', async () => {
    expect(await refusalOf(() => renderGalleryPhoto(new TextEncoder().encode('%PDF-1.7 not a photo')))).toBe('not_image');
    expect(await refusalOf(async () => renderGalleryPhoto(await plainImage('png', 400, 60)))).toBe('too_small');
  });
});

describe('renderSchoolLogo', () => {
  it('fits a wide logo whole into a transparent square, without metadata', async () => {
    const original = await jpegWithGps(600, 150);
    const rendered = await renderSchoolLogo(original);
    expect(rendered.side).toBe(512);
    for (const [size, bytes] of Object.entries(rendered.renditions)) {
      const facts = await imageFacts(bytes);
      expect(facts, size).toMatchObject({ format: 'webp', width: Number(size), height: Number(size), exif: false, xmp: false, iptc: false });
      expect(containsAscii(bytes, TEST_EXIF_CAMERA), size).toBe(false);
    }
    // Not cropped: the colour reaches both ends of the middle line; above it the square is clear.
    const large = rendered.renditions[512];
    expect((await pixelAt(large, 2, 256))[0]).toBeGreaterThan(150);
    expect((await pixelAt(large, 509, 256))[0]).toBeGreaterThan(150);
    expect(await alphaAt(large, 256, 10)).toBe(0);
  });

  it('accepts a logo whose shorter side is small, refuses one whose longer side is under 96 px', async () => {
    expect((await renderSchoolLogo(await plainImage('png', 200, 40))).side).toBe(200);
    expect(await refusalOf(async () => renderSchoolLogo(await plainImage('png', 80, 80)))).toBe('too_small');
    expect(await refusalOf(() => renderSchoolLogo(new TextEncoder().encode('MZ not an image')))).toBe('not_image');
  });
});
