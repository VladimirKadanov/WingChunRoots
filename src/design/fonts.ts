// Self-hosted web fonts (plan §5.3; ADR 0006): next/font/local from the @fontsource packages
// (SIL OFL 1.1). Never next/font/google, never a request to Google at build time or in the
// browser. One call per subset, so each face carries its own unicode-range and the browser
// downloads a subset only when the page has a character from it. The family names are fixed
// ('Gloock', 'Schibsted Grotesk', 'Noto Serif Display') so the font stacks in
// src/design/tokens.ts can name them; the size-matched fallback faces live in the generated
// tokens.css. Only the latin subsets are preloaded. next/font needs literal arguments, so
// the unicode ranges (those of the @fontsource CSS) are written out in each call.

import localFont from 'next/font/local';


/** Gloock, display serif: latin (preloaded). */
const gloockLatin = localFont({
  src: '../../node_modules/@fontsource/gloock/files/gloock-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  variable: '--font-face-gloock-latin',
  declarations: [
    { prop: 'font-family', value: "'Gloock'" },
    { prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' },
  ],
});

/** Gloock: latin-ext (Central European and Vietnamese letters, when a page has them). */
const gloockLatinExt = localFont({
  src: '../../node_modules/@fontsource/gloock/files/gloock-latin-ext-400-normal.woff2',
  weight: '400',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-face-gloock-latin-ext',
  declarations: [
    { prop: 'font-family', value: "'Gloock'" },
    { prop: 'unicode-range', value: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF' },
  ],
});

/** Gloock: cyrillic-ext (rare Cyrillic letters only; basic Cyrillic comes from Noto below). */
const gloockCyrillicExt = localFont({
  src: '../../node_modules/@fontsource/gloock/files/gloock-cyrillic-ext-400-normal.woff2',
  weight: '400',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-face-gloock-cyrillic-ext',
  declarations: [
    { prop: 'font-family', value: "'Gloock'" },
    { prop: 'unicode-range', value: 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F' },
  ],
});

/**
 * Noto Serif Display, Cyrillic only: Gloock has no basic Cyrillic, so Bulgarian and other
 * Cyrillic names in display text fall back to it. The 600 weight matches Gloock's colour and is
 * declared as 400 so it pairs with Gloock; its line metrics are overridden to Gloock's
 * (ascent 0.975, descent 0.225 em) and its size adjusted to Gloock's x-height (ADR 0006).
 * Downloaded only when a page shows Cyrillic.
 */
const notoSerifDisplayCyrillic = localFont({
  src: '../../node_modules/@fontsource/noto-serif-display/files/noto-serif-display-cyrillic-600-normal.woff2',
  weight: '400',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-face-noto-serif-display-cyrillic',
  declarations: [
    { prop: 'font-family', value: "'Noto Serif Display'" },
    { prop: 'unicode-range', value: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116' },
    { prop: 'size-adjust', value: '97%' },
    { prop: 'ascent-override', value: '100.52%' },
    { prop: 'descent-override', value: '23.2%' },
    { prop: 'line-gap-override', value: '0%' },
  ],
});

/** Schibsted Grotesk, UI and text (variable weight 400-900): latin (preloaded). */
const schibstedLatin = localFont({
  src: '../../node_modules/@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2',
  weight: '400 900',
  style: 'normal',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  variable: '--font-face-schibsted-latin',
  declarations: [
    { prop: 'font-family', value: "'Schibsted Grotesk'" },
    { prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' },
  ],
});

/** Schibsted Grotesk: latin-ext. */
const schibstedLatinExt = localFont({
  src: '../../node_modules/@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-ext-wght-normal.woff2',
  weight: '400 900',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-face-schibsted-latin-ext',
  declarations: [
    { prop: 'font-family', value: "'Schibsted Grotesk'" },
    { prop: 'unicode-range', value: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF' },
  ],
});

/**
 * Class names to put on <html>: they only define unused custom properties, but referencing
 * them keeps every @font-face rule in the page's CSS.
 */
export const fontFaceClassNames = [
  gloockLatin,
  gloockLatinExt,
  gloockCyrillicExt,
  notoSerifDisplayCyrillic,
  schibstedLatin,
  schibstedLatinExt,
]
  .map((font) => font.variable)
  .join(' ');
