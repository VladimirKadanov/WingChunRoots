// Profile photo processing (milestone M14; docs/adr/0016-profile-photos.md): the type from the
// magic bytes only, EXIF with its GPS position dropped, the EXIF orientation applied, a centred
// square at 96 and 512 px as WebP, small and oversized images refused. Every image is generated,
// flat colour, with fictional metadata (./test-images.ts).

import { crc32 } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { MAX_IMAGE_PIXELS } from './sanitize';
import { demoPortrait, PhotoRefused, renderProfilePhoto } from './photo';
import { containsAscii, imageFacts, jpegWithGps, orientedJpeg, pixelAt, plainImage, pngWithGps, TEST_EXIF_CAMERA } from './test-images';

async function refusal(bytes: Uint8Array): Promise<string> {
  try {
    await renderProfilePhoto(bytes);
  } catch (error) {
    if (error instanceof PhotoRefused) return error.reason;
    throw error;
  }
  return 'accepted';
}

describe('renderProfilePhoto', () => {
  it('stores square WebP renditions at 96 and 512 px, without EXIF, GPS, XMP or IPTC', async () => {
    const original = await jpegWithGps(800, 600);
    expect(containsAscii(original, TEST_EXIF_CAMERA)).toBe(true);
    const rendered = await renderProfilePhoto(original);
    expect(rendered.side).toBe(512);
    for (const [size, bytes] of Object.entries(rendered.renditions)) {
      const facts = await imageFacts(bytes);
      expect(facts, size).toMatchObject({ format: 'webp', width: Number(size), height: Number(size), exif: false, xmp: false, iptc: false });
      expect(containsAscii(bytes, TEST_EXIF_CAMERA), size).toBe(false);
      expect(containsAscii(bytes, 'Exif'), size).toBe(false);
    }
  });

  it('drops the EXIF block of a PNG too', async () => {
    const original = await pngWithGps(240, 240);
    expect(containsAscii(original, TEST_EXIF_CAMERA)).toBe(true);
    const rendered = await renderProfilePhoto(original);
    for (const bytes of Object.values(rendered.renditions)) {
      expect((await imageFacts(bytes)).exif).toBe(false);
      expect(containsAscii(bytes, TEST_EXIF_CAMERA)).toBe(false);
    }
  });

  it('turns the photo upright by its EXIF orientation before the square is cut', async () => {
    const rendered = await renderProfilePhoto(await orientedJpeg());
    // Upright the image is 100 x 200, red above blue; the centred square shows both, red on top.
    expect(rendered.side).toBe(100);
    const large = rendered.renditions[512];
    const [top, bottom] = [await pixelAt(large, 50, 10), await pixelAt(large, 50, 90)];
    expect(top[0]).toBeGreaterThan(200);
    expect(top[2]).toBeLessThan(60);
    expect(bottom[2]).toBeGreaterThan(200);
    expect(bottom[0]).toBeLessThan(60);
  });

  it('never enlarges a small photo: the largest rendition is the square itself', async () => {
    const rendered = await renderProfilePhoto(await plainImage('png', 300, 200));
    expect(rendered.side).toBe(200);
    expect((await imageFacts(rendered.renditions[512])).width).toBe(200);
    expect((await imageFacts(rendered.renditions[96])).width).toBe(96);
  });

  it('accepts JPEG, PNG and WebP by their magic bytes', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      expect(await refusal(await plainImage(format, 128, 128)), format).toBe('accepted');
    }
  });

  it('refuses a file that is not an image, whatever it is called: an executable, a PDF, a GIF', async () => {
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, ...new Uint8Array(508)]);
    const pdf = new TextEncoder().encode('%PDF-1.4\n% fictional\n%%EOF\n');
    const gif = new TextEncoder().encode('GIF89a\u0001\u0000\u0001\u0000');
    expect(await refusal(elf)).toBe('not_image');
    expect(await refusal(pdf)).toBe('not_image');
    expect(await refusal(gif)).toBe('not_image');
  });

  it('refuses a fake image: JPEG magic bytes followed by garbage', async () => {
    const fake = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode('not really a photograph at all'.repeat(20))]);
    expect(await refusal(fake)).toBe('unreadable');
  });

  it('refuses an image smaller than 96 px on its shorter side', async () => {
    expect(await refusal(await plainImage('png', 300, 80))).toBe('too_small');
  });

  it('refuses an image over the pixel limit (a decompression bomb) before decoding it', async () => {
    // A tiny PNG whose header claims 10,000 x 10,000 pixels (100 megapixels): a few hundred bytes
    // that would fill the server's memory if decoded.
    const png = Buffer.from(await plainImage('png', 8, 8));
    png.writeUInt32BE(10_000, 16);
    png.writeUInt32BE(10_000, 20);
    png.writeUInt32BE(crc32(png.subarray(12, 29)) >>> 0, 29);
    expect(10_000 * 10_000).toBeGreaterThan(MAX_IMAGE_PIXELS);
    expect(await refusal(new Uint8Array(png))).toBe('too_large');
  });
});

describe('demoPortrait (D20)', () => {
  it('is generated from a seed, the same for the same seed, and goes through the upload pipeline', async () => {
    const a = await demoPortrait(42);
    expect(Buffer.from(a).equals(Buffer.from(await demoPortrait(42)))).toBe(true);
    expect(Buffer.from(a).equals(Buffer.from(await demoPortrait(43)))).toBe(false);
    expect((await renderProfilePhoto(a)).side).toBe(512);
  });
});
