// The generated CSS and JSON match src/design/tokens.ts (plan §5.2): run `pnpm tokens:build`
// after changing the tokens.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GENERATED_CSS_PATH, GENERATED_JSON_PATH, buildCss, buildJson, pxToRem } from './build';
import { formatOklch, hexToOklch, oklchToHex, roundOklch } from './color';
import { COLOR_ROLES, THEMES, colors, typeScale } from './tokens';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('generated token files', () => {
  it(`${GENERATED_CSS_PATH} is up to date (run pnpm tokens:build)`, () => {
    expect(read(GENERATED_CSS_PATH)).toBe(buildCss());
  });
  it(`${GENERATED_JSON_PATH} is up to date (run pnpm tokens:build)`, () => {
    expect(read(GENERATED_JSON_PATH)).toBe(buildJson());
  });
});

describe('the CSS', () => {
  const css = buildCss();
  it('writes every role of both themes in OKLCH with its hex value in a comment', () => {
    for (const theme of THEMES) {
      for (const role of COLOR_ROLES) {
        const hex = colors[theme][role];
        expect(css).toContain(`--${role}: ${formatOklch(hex)}; /* ${hex} */`);
      }
    }
  });
  it('the OKLCH values round-trip to the same hex colours', () => {
    for (const theme of THEMES) {
      for (const role of COLOR_ROLES) {
        const hex = colors[theme][role];
        expect(oklchToHex(roundOklch(hexToOklch(hex))), `${theme} ${role}`).toBe(hex);
      }
    }
  });
  it('follows the system theme unless a manual choice overrides it', () => {
    expect(css).toContain('@media (prefers-color-scheme: light) {\n  :root:not([data-theme=\'dark\']) {\n    color-scheme: light;');
    expect(css).toContain(":root[data-theme='light'] {\n  color-scheme: light;");
    expect(css).toMatch(/^:root \{\n {2}color-scheme: dark;/m);
  });
  it('defines a Tailwind theme with only the semantic tokens', () => {
    expect(css).toContain('@theme inline {');
    for (const reset of ['--color-*: initial;', '--font-*: initial;', '--text-*: initial;', '--radius-*: initial;', '--shadow-*: initial;']) {
      expect(css).toContain(reset);
    }
  });
  it('makes motion instant under prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n {2}:root \{\n( {4}--duration-[a-z-]+: 0ms;\n)+/);
  });
  it('writes font sizes in rem and keeps every label at 11 px or more', () => {
    expect(pxToRem('clamp(40px, 10.8vw, 78px)')).toBe('clamp(2.5rem, 10.8vw, 4.875rem)');
    for (const step of Object.values(typeScale)) {
      const smallest = Math.min(...[...step.size.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])));
      expect(smallest).toBeGreaterThanOrEqual(11);
    }
  });
});
