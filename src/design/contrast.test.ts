// Every contrast pair of the design tokens, in both themes (plan §5.2, §4.7; WCAG 1.4.3 and
// 1.4.11). Values are never lowered to follow the prototype: a failing pair means the token
// changes and the deviation is recorded in docs/adr/0006-design-system.md.

import { describe, expect, it } from 'vitest';
import { buildCss, PRINT_OVERRIDES } from './build';
import { contrastRatio, hexToOklch } from './color';
import {
  CONTRAST_PAIRS,
  MIN_DANGER_HUE_DISTANCE,
  MIN_GRAPHIC,
  MIN_TEXT,
  PRINT_PAIRS,
  PRINT_STATE_ROLES,
} from './contrast-pairs';
import { COLOR_ROLES, DIM_TONES, THEMES, colors, linkStyles, print } from './tokens';

describe('contrast of the theme tokens', () => {
  for (const theme of THEMES) {
    describe(theme, () => {
      it.each(CONTRAST_PAIRS.map((pair) => [`${pair.fg} on ${pair.bg} (>= ${pair.min}:1, ${pair.why})`, pair] as const))(
        '%s',
        (_, pair) => {
          const ratio = contrastRatio(colors[theme][pair.fg], colors[theme][pair.bg]);
          expect(ratio, `${theme}: ${pair.fg} ${colors[theme][pair.fg]} on ${pair.bg} ${colors[theme][pair.bg]}`).toBeGreaterThanOrEqual(pair.min);
        },
      );
    });
  }
});

describe('the pairs cover the plan §5.2 table', () => {
  const covered = new Set(CONTRAST_PAIRS.map((pair) => `${pair.fg}|${pair.bg}`));
  const required: [string, string, number][] = [
    // Text on the page and on surfaces.
    ['fg', 'bg', MIN_TEXT],
    ['fg', 'surface-1', MIN_TEXT],
    ['fg', 'surface-2', MIN_TEXT],
    ['fg-muted', 'bg', MIN_TEXT],
    ['fg-muted', 'surface-1', MIN_TEXT],
    ['fg-muted', 'surface-2', MIN_TEXT],
    // Borders of controls.
    ['border-strong', 'bg', MIN_GRAPHIC],
    ['border-strong', 'surface-1', MIN_GRAPHIC],
    // The primary action: white on red (plan §5.2).
    ['on-brand', 'brand', MIN_TEXT],
    // Red text uses the contrast-corrected lighter red on dark.
    ['brand-fg', 'bg', MIN_TEXT],
    // Every verification state carries text, so it meets the text threshold.
    ['verified', 'bg', MIN_TEXT],
    ['review', 'bg', MIN_TEXT],
    ['arbitration', 'bg', MIN_TEXT],
    ['cross-lineage', 'bg', MIN_TEXT],
    ['unconfirmed', 'bg', MIN_GRAPHIC],
    ['focus', 'bg', MIN_GRAPHIC],
    ['danger', 'bg', MIN_TEXT],
  ];
  it.each(required)('%s on %s is checked at >= %s:1', (fg, bg, min) => {
    expect(covered.has(`${fg}|${bg}`)).toBe(true);
    const pair = CONTRAST_PAIRS.find((p) => p.fg === fg && p.bg === bg);
    expect(pair?.min).toBeGreaterThanOrEqual(min);
  });
});

describe('solid dimming tones (plan §4.7)', () => {
  for (const theme of THEMES) {
    it(`${theme}: dimmed stroke, frame and text keep their thresholds on every ground`, () => {
      for (const ground of ['bg', 'surface-1', 'surface-2'] as const) {
        const bg = colors[theme][ground];
        expect(contrastRatio(colors[theme][DIM_TONES.stroke], bg)).toBeGreaterThanOrEqual(MIN_GRAPHIC);
        expect(contrastRatio(colors[theme][DIM_TONES.frame], bg)).toBeGreaterThanOrEqual(MIN_GRAPHIC);
        expect(contrastRatio(colors[theme][DIM_TONES.text], bg)).toBeGreaterThanOrEqual(MIN_TEXT);
      }
    });
    it(`${theme}: every token is an opaque #RRGGBB colour (no opacity for dimming)`, () => {
      for (const hex of Object.values(colors[theme])) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    });
  }
});

describe('status is never colour alone (plan §4.6)', () => {
  it('every link style has a distinct stroke, a distinct seal and a text label', () => {
    const styles = Object.values(linkStyles);
    expect(new Set(styles.map((s) => s.stroke)).size).toBe(styles.length);
    expect(new Set(styles.map((s) => s.seal)).size).toBe(styles.length);
    for (const style of styles) expect(style.label.length).toBeGreaterThan(0);
  });
  it('every status label colour is text-grade (4.5:1) in both themes', () => {
    for (const theme of THEMES) {
      for (const style of Object.values(linkStyles)) {
        const pair = CONTRAST_PAIRS.find((p) => p.fg === style.labelColor && p.bg === 'bg');
        expect(pair?.min, `${theme}: ${style.label} label (${style.labelColor})`).toBe(MIN_TEXT);
        expect(contrastRatio(colors[theme][style.labelColor], colors[theme].bg)).toBeGreaterThanOrEqual(MIN_TEXT);
      }
    }
  });
  it('every stroke colour is graphic-grade (3:1) on the ground in both themes', () => {
    for (const theme of THEMES) {
      for (const style of Object.values(linkStyles)) {
        for (const bg of ['bg', 'surface-1', 'surface-2'] as const) {
          expect(
            contrastRatio(colors[theme][style.strokeColor], colors[theme][bg]),
            `${theme}: ${style.label} stroke (${style.strokeColor}) on ${bg}`,
          ).toBeGreaterThanOrEqual(MIN_GRAPHIC);
        }
      }
    }
  });
  it('red is reserved for the brand: no verification state uses a brand role', () => {
    for (const style of Object.values(linkStyles)) {
      expect(style.color.startsWith('brand')).toBe(false);
      expect(style.strokeColor.startsWith('brand')).toBe(false);
      expect(style.labelColor.startsWith('brand')).toBe(false);
    }
  });
  it('focus is neither red nor a verification colour', () => {
    for (const theme of THEMES) {
      const focus = colors[theme].focus;
      for (const role of ['brand', 'brand-fg', 'verified', 'review', 'danger'] as const) {
        expect(focus).not.toBe(colors[theme][role]);
      }
    }
  });
});

describe('print tokens (plan §5.2)', () => {
  it.each(PRINT_PAIRS.map((pair) => [`${pair.fg} on ${pair.bg}`, pair] as const))('%s', (_, pair) => {
    expect(contrastRatio(print[pair.fg], print[pair.bg])).toBeGreaterThanOrEqual(pair.min);
  });
  it('the print block of tokens.css declares every colour role, so no screen-theme colour reaches paper', () => {
    const block = /@media print \{\n([\s\S]*?)\n\}/.exec(buildCss());
    expect(block).not.toBeNull();
    for (const role of COLOR_ROLES) expect(block![1], role).toContain(`--${role}:`);
  });
  it('state labels and secondary text stay text-grade (4.5:1) on print paper', () => {
    for (const role of PRINT_STATE_ROLES) {
      const override = PRINT_OVERRIDES[role as keyof typeof PRINT_OVERRIDES];
      const hex = override ? print[override === 'verified' ? 'print-verified' : override] : colors.light[role];
      expect(contrastRatio(hex, print.paper), role).toBeGreaterThanOrEqual(MIN_TEXT);
    }
  });
});

describe('red stays the brand', () => {
  it(`the danger rouge is at least ${MIN_DANGER_HUE_DISTANCE}° of OKLCH hue away from the brand red in both themes`, () => {
    for (const theme of THEMES) {
      const brand = hexToOklch(colors[theme].brand).h;
      const danger = hexToOklch(colors[theme].danger).h;
      const distance = Math.min(Math.abs(brand - danger), 360 - Math.abs(brand - danger));
      expect(distance, `${theme}: brand ${colors[theme].brand}, danger ${colors[theme].danger}`).toBeGreaterThanOrEqual(MIN_DANGER_HUE_DISTANCE);
    }
  });
});
