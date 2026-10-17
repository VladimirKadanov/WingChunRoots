// Colour maths for the design tokens: hex <-> OKLCH conversion and WCAG 2.2 contrast.
// Pure TypeScript, no dependencies, so the token generator, the tests and (later) the
// mobile app's tooling share one implementation.

export interface Oklch {
  /** Lightness, 0..1. */
  l: number;
  /** Chroma, 0..~0.4. */
  c: number;
  /** Hue in degrees, 0..360 (0 when the colour is achromatic). */
  h: number;
}

const HEX = /^#([0-9a-f]{6})$/i;

/** Parses `#RRGGBB` into 0..255 channels; throws on anything else. */
export function parseHex(hex: string): [number, number, number] {
  const match = HEX.exec(hex);
  if (!match?.[1]) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number): number {
  const v = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

/** WCAG 2.2 relative luminance of an sRGB colour. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(toLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio between two colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** sRGB hex to OKLCH (Björn Ottosson's OKLab, D65). */
export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = parseHex(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  // Greys have no meaningful hue; 0 keeps the output stable.
  return { l: L, c, h: c < 0.0002 ? 0 : h };
}

/** OKLCH back to sRGB hex (clamped to the sRGB gamut). */
export function oklchToHex({ l: L, c, h }: Oklch): string {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return `#${[r, g, b].map((v) => fromLinear(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Rounds OKLCH the way the generated CSS writes it (L in % with 2 decimals, C 4, H 2). */
export function roundOklch({ l, c, h }: Oklch): Oklch {
  return {
    l: Math.round(l * 10000) / 10000,
    c: Math.round(c * 10000) / 10000,
    h: Math.round(h * 100) / 100,
  };
}

/** CSS text for a colour: `oklch(14.95% 0.0043 285.82)`. */
export function formatOklch(hex: string): string {
  const { l, c, h } = roundOklch(hexToOklch(hex));
  return `oklch(${(l * 100).toFixed(2)}% ${c.toFixed(4)} ${h.toFixed(2)})`;
}
