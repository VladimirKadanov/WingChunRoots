// The fallback faces in tokens.ts match the font files (plan §5.3, CLS): recomputed with the
// same fontkit and formula Next.js uses for next/font/local.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fallbackFaces } from './tokens';

const require = createRequire(import.meta.url);
const fontkit = require('next/dist/compiled/@next/font/dist/fontkit').default as (buffer: Buffer) => unknown;
const { getFallbackMetricsFromFontFile } = require('next/dist/compiled/@next/font/dist/local/get-fallback-metrics-from-font-file') as {
  getFallbackMetricsFromFontFile: (
    font: unknown,
    category: 'serif' | 'sans-serif',
  ) => { fallbackFont: string; sizeAdjust: string; ascentOverride: string; descentOverride: string; lineGapOverride: string };
};

describe('size-matched fallback faces', () => {
  it.each(fallbackFaces.map((face) => [face.family, face] as const))('%s', (_, face) => {
    const font = fontkit(readFileSync(require.resolve(face.file)));
    const { fallbackFont, ...metrics } = getFallbackMetricsFromFontFile(font, face.category);
    expect(face.local[0]).toBe(fallbackFont);
    expect({
      sizeAdjust: face.sizeAdjust,
      ascentOverride: face.ascentOverride,
      descentOverride: face.descentOverride,
      lineGapOverride: face.lineGapOverride,
    }).toEqual(metrics);
  });
});
