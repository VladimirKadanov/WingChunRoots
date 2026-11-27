// ADR 0088: which uploads count as a video (sniffVideo): an MP4 with a video brand, a WebM with its
// DocType; never an HEIC or AVIF image in the same box format, or a Matroska file.

import { describe, expect, it } from 'vitest';

import { sniffVideo } from './sanitize';

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const mp4 = (brand: string) => new Uint8Array([0, 0, 0, 0x20, ...ascii('ftyp'), ...ascii(brand), 0, 0, 0, 0]);
const ebml = (docType: string) => new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x80 | docType.length, ...ascii(docType), 0x42, 0x87, 0x81, 0x04]);

describe('sniffVideo', () => {
  it('takes MP4 and QuickTime video brands', () => {
    for (const brand of ['isom', 'mp42', 'avc1', 'qt  ']) expect(sniffVideo(mp4(brand)), brand).toBe('video/mp4');
  });

  it('refuses the images and other files that share the ftyp box', () => {
    for (const brand of ['heic', 'heix', 'mif1', 'avif', 'M4A ']) expect(sniffVideo(mp4(brand)), brand).toBeNull();
  });

  it('takes WebM and refuses Matroska and bare EBML', () => {
    expect(sniffVideo(ebml('webm'))).toBe('video/webm');
    expect(sniffVideo(ebml('matroska'))).toBeNull();
    expect(sniffVideo(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBeNull();
  });

  it('refuses a short or unrelated file', () => {
    expect(sniffVideo(new Uint8Array([0, 0, 0, 0x20, ...ascii('ftyp')]))).toBeNull();
    expect(sniffVideo(new Uint8Array(ascii('%PDF-1.7')))).toBeNull();
  });
});
