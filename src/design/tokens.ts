// The design tokens of WingChunRoots: the single source for the web (CSS for Tailwind's
// @theme) and for the future mobile app (JSON). Plan §5.2, §5.3, §5.8, §6.8.
//
// Direction: "Ink Register" (docs/design/direction.md): the ink, paper and seal language of
// the Ink Lineage prototype on top of the Living Archive explorer model. Chosen by the owner
// on 2026-10-17.
//
// `pnpm tokens:build` writes src/design/generated/tokens.css and tokens.json from this file;
// src/design/tokens.build.test.ts fails when they are out of date and
// src/design/contrast.test.ts re-checks every contrast pair below for both themes.
//
// Hex values are the reference for contrast (plan §5.2); the CSS writes them in OKLCH with
// the hex value in a comment. Every deliberate deviation from the prototype or from plan §5.2
// is recorded in docs/adr/0006-design-system.md.

import { GROUND, THEMES, THEME_COOKIE, type ThemeName } from './theme-constants';

export { THEMES, THEME_COOKIE, type ThemeName };

/** The default theme when the browser states no preference ("black lacquer", night paper). */
export const DEFAULT_THEME: ThemeName = 'dark';

/**
 * Semantic colour roles (plan §5.2 roles, plus the roles the direction adds).
 * Every role exists in both themes.
 */
export const COLOR_ROLES = [
  // Grounds
  'bg', // page ground: lacquer (dark) or rice paper (light)
  'surface-1', // cards, panels, the side rail
  'surface-2', // raised: sheets, dialogs, menus, toasts
  'surface-3', // hover states only; never text in brand-fg on it
  'surface-pressed', // pressed state of secondary and ghost controls (one step beyond hover)
  // Ink (text)
  'fg', // primary text and ink strokes
  'fg-muted', // secondary text; also the solid tone for dimmed text (plan §4.7)
  'fg-subtle', // captions, eyebrows, meta lines (still >= 4.5:1 on bg, surface-1, surface-2)
  'fg-inverse', // text on an fg-filled chip or button (pressed segmented control, ink button)
  'ink-hover', // fill of an ink (fg-filled) button when hovered: a small step, never a disabled grey
  // Lines
  'border-subtle', // decorative hairlines only (never the only boundary of a control)
  'border-strong', // field and control frames (>= 3:1); also the dimmed frame tone (plan §4.7)
  // Seal (brand): red is reserved for the brand mark and the primary action
  'brand', // fill of the primary button and the brand seal, always with on-brand text
  'brand-hover', // primary button when hovered
  'brand-pressed', // primary button while pressed
  'brand-fg', // red text on the ground (brand wordmark accents only, never links or selection)
  'on-brand', // text and glyphs on brand fills: pure white (plan §5.2)
  // Verification states (plan §4.6): never colour alone, always stroke + seal + text
  'verified', // jade: solid stroke, check seal, "Verified"
  'on-verified', // glyph on a verified (jade) seal
  'review', // ochre: broken stroke, hourglass seal, "Under review"
  'unconfirmed', // grey: dotted stroke, "?" seal, "Unconfirmed"; also the dimmed stroke tone (§4.7)
  'arbitration', // ink: double stroke, scales seal, "In arbitration"
  'cross-lineage', // cyan: hollow curve with its own dash, "Cross-lineage" label
  // Interaction
  'focus', // focus ring, 2 px with a 2 px offset; gold, never red or green
  'danger', // form errors and destructive actions: a rouge at least 25° of hue away from the brand red
] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

export const colors: Record<ThemeName, Record<ColorRole, string>> = {
  // Night paper: black lacquer with warm grey ink.
  dark: {
    bg: GROUND.dark,
    'surface-1': '#19191C',
    'surface-2': '#222226',
    'surface-3': '#2C2C31',
    'surface-pressed': '#36363C',
    fg: '#EAEAEA',
    'fg-muted': '#ABA8A3',
    'fg-subtle': '#9C9993',
    'fg-inverse': '#121214',
    'ink-hover': '#D4D4D2',
    'border-subtle': '#2E2E33',
    'border-strong': '#78756F',
    brand: '#D32F2F',
    'brand-hover': '#B71C1C',
    'brand-pressed': '#9A1616',
    'brand-fg': '#F2665F',
    'on-brand': '#FFFFFF',
    verified: '#45D98F',
    'on-verified': '#121214',
    review: '#E0A64A',
    unconfirmed: '#8A8A93',
    arbitration: '#EAEAEA',
    'cross-lineage': '#4DD0E1',
    focus: '#F2C14E',
    danger: '#FF8AB8',
  },
  // Paper: warm rice paper with lamp-black ink.
  light: {
    bg: GROUND.light,
    'surface-1': '#F7F5F0',
    'surface-2': '#FFFDF9',
    'surface-3': '#E2E0D9',
    'surface-pressed': '#D8D6CE',
    fg: '#161618',
    'fg-muted': '#4E4C48',
    'fg-subtle': '#64615C',
    'fg-inverse': '#F7F5F0',
    'ink-hover': '#2E2E31',
    'border-subtle': '#D6D4CC',
    'border-strong': '#7D7A72',
    brand: '#C62828',
    'brand-hover': '#A51D1D',
    'brand-pressed': '#8C1717',
    'brand-fg': '#B3261E',
    'on-brand': '#FFFFFF',
    verified: '#0A6E43',
    'on-verified': '#FFFFFF',
    review: '#7C5300',
    unconfirmed: '#77757A',
    arbitration: '#161618',
    'cross-lineage': '#0B6874',
    focus: '#9A6400',
    danger: '#9B1B5A',
  },
};

/**
 * Solid tones for dimming (plan §4.7): dimming never uses opacity. A dimmed link keeps its
 * pattern and is drawn 1 px in `stroke`; a dimmed node has a `frame` border and `text` labels.
 */
export const DIM_TONES = { stroke: 'unconfirmed', frame: 'border-strong', text: 'fg-muted' } as const satisfies Record<
  string,
  ColorRole
>;

/** Print tokens (plan §5.2): theme-independent, used by print styles and the Phase 4 posters. */
export const print = {
  paper: '#FDFBF7',
  ink: '#1A1A1A',
  seal: '#B71C1C',
  'print-verified': '#007A3D',
} as const;

/** Theme-dependent effects (not colours, so they are not contrast-checked). */
export const effects: Record<ThemeName, { scrim: string; 'shadow-pop': string; 'shadow-sheet': string; 'shadow-raise': string }> = {
  dark: {
    scrim: 'rgb(4 4 6 / 0.64)',
    'shadow-pop': '0 28px 70px -18px rgb(0 0 0 / 0.72)',
    'shadow-sheet': '0 -20px 50px -12px rgb(0 0 0 / 0.5)',
    'shadow-raise': '0 10px 24px -12px rgb(0 0 0 / 0.55)',
  },
  light: {
    scrim: 'rgb(24 22 20 / 0.36)',
    'shadow-pop': '0 28px 70px -20px rgb(40 32 24 / 0.32)',
    'shadow-sheet': '0 -10px 34px -16px rgb(40 32 24 / 0.24)',
    'shadow-raise': '0 10px 24px -14px rgb(40 32 24 / 0.3)',
  },
};

// ---------------------------------------------------------------------------------------
// Type (plan §5.3). Gloock for display (names, headings, numerals), Schibsted Grotesk for UI
// and text, Noto Serif Display for Cyrillic display text (neither main face has basic
// Cyrillic), system CJK fonts for Chinese. All self-hosted from @fontsource packages (OFL).

export const fontFamilies = {
  /** Display: names, headings, numerals. */
  display: ['Gloock', 'Noto Serif Display', 'Gloock Fallback', 'var(--font-cjk-serif)', 'Georgia', 'serif'],
  /** UI and running text (the UI is English only). */
  text: [
    'Schibsted Grotesk',
    'Schibsted Grotesk Fallback',
    'var(--font-cjk-sans)',
    'system-ui',
    '-apple-system',
    'Segoe UI',
    'Arial',
    'sans-serif',
  ],
  /** Code in the style guide and technical notes: the platform's monospace. */
  mono: ['ui-monospace', 'SFMono-Regular', 'Cascadia Mono', 'Liberation Mono', 'monospace'],
  /** Chinese names in serif (display) contexts; Traditional by default (plan §5.3). */
  'cjk-serif-hant': ['Songti TC', 'PMingLiU', 'Noto Serif CJK TC', 'Noto Serif TC', 'serif'],
  'cjk-serif-hans': ['Songti SC', 'SimSun', 'Noto Serif CJK SC', 'Noto Serif SC', 'serif'],
  /** Chinese names in sans (UI) contexts. */
  'cjk-sans-hant': ['PingFang TC', 'Microsoft JhengHei', 'Noto Sans CJK TC', 'Noto Sans TC', 'sans-serif'],
  'cjk-sans-hans': ['PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans SC', 'sans-serif'],
} as const;

/**
 * Size-matched fallback faces (plan §5.3, CLS): local system fonts scaled to the metrics of the
 * web font, so text keeps its measure while the web font loads. The values come from the
 * font files (src/design/fonts.test.ts recomputes them with Next.js's fontkit).
 */
export const fallbackFaces = [
  {
    family: 'Gloock Fallback',
    for: 'Gloock',
    file: '@fontsource/gloock/files/gloock-latin-400-normal.woff2',
    category: 'serif',
    local: ['Times New Roman', 'Liberation Serif', 'Tinos', 'Times'],
    sizeAdjust: '114.18%',
    ascentOverride: '85.39%',
    descentOverride: '19.71%',
    lineGapOverride: '0.00%',
  },
  {
    family: 'Schibsted Grotesk Fallback',
    for: 'Schibsted Grotesk',
    file: '@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2',
    category: 'sans-serif',
    local: ['Arial', 'Liberation Sans', 'Arimo', 'Helvetica'],
    sizeAdjust: '105.53%',
    ascentOverride: '92.54%',
    descentOverride: '24.43%',
    lineGapOverride: '0.00%',
  },
] as const;

export interface TypeStep {
  size: string;
  lineHeight: string;
  letterSpacing?: string;
  weight?: number;
}

/**
 * Type scale: the only font sizes the UI uses (verify.d/M00b.sh rejects arbitrary `text-[…]`
 * sizes in src/app and src/components). Minimum label size is 11 px (from the comparison: every
 * label shown, at every level of detail). Fluid steps use clamp() so phones and desktops share
 * one scale; px values are written as rem, so they follow the reader's text size.
 */
export const typeScale: Record<string, TypeStep> = {
  /** Uppercase eyebrows, meta lines, tab labels and table heads (with `uppercase`). */
  caption: { size: '11px', lineHeight: '1.3', letterSpacing: '0.14em', weight: 600 },
  /** Compact semibold labels: small status badges. */
  label: { size: '12px', lineHeight: '1.35', letterSpacing: '0.02em', weight: 600 },
  /** Fine print: notes in the rail, code and licence texts. */
  xs: { size: '12px', lineHeight: '1.45' },
  /** Secondary UI text: hints, legends, captions, small buttons. */
  sm: { size: '13px', lineHeight: '1.45' },
  /** Buttons, navigation and short explanations. */
  ui: { size: '14px', lineHeight: '1.4' },
  /** Running text. */
  base: { size: '15px', lineHeight: '1.55' },
  /** Form fields: 16 px, so iOS does not zoom the page when a field gets focus. */
  field: { size: '16px', lineHeight: '1.4' },
  /** Lead paragraphs and names in lists. */
  md: { size: '17px', lineHeight: '1.5' },
  lg: { size: '19px', lineHeight: '1.25' },
  xl: { size: '23px', lineHeight: '1.15' },
  '2xl': { size: '28px', lineHeight: '1.08', letterSpacing: '-0.01em' },
  /** Figures: counts and step numerals in the display face. */
  '3xl': { size: '32px', lineHeight: '1.05', letterSpacing: '-0.01em' },
  section: { size: 'clamp(29px, 7vw, 44px)', lineHeight: '1.04', letterSpacing: '-0.015em' },
  feature: { size: 'clamp(32px, 8vw, 52px)', lineHeight: '1', letterSpacing: '-0.015em' },
  /**
   * The thesis of the home page. It follows the viewport (9vw) but never outgrows its column:
   * 14cqi of the nearest inline-size container keeps the longest of three lines inside it (the
   * home page's head area from 1280 px, beside the line). Without a container cqi falls back to
   * the small viewport width, so elsewhere the size is 9vw.
   */
  hero: { size: 'clamp(34px, min(9vw, 14cqi), 78px)', lineHeight: '0.98', letterSpacing: '-0.022em' },
};

/** Smallest font size any visible label may use (px). */
export const MIN_LABEL_PX = 11;

// ---------------------------------------------------------------------------------------
// Shape, space and motion.

/**
 * Radii. The direction cuts crisp, paper-like corners (2-6 px) instead of the 10 px of plan
 * §5.2; sheets keep a soft 18 px top edge. Deviation recorded in ADR 0006.
 */
export const radius = {
  xs: '2px',
  sm: '3px',
  md: '4px',
  lg: '6px',
  sheet: '18px',
  full: '9999px',
} as const;

/**
 * Space. Every Tailwind spacing step (p-*, m-*, gap-*) is a multiple of `unit`; the named
 * steps are the gutters and section rhythm that pages share (the `px-page` utility and
 * `py-section`).
 */
export const space = {
  /** The spacing unit (Tailwind's --spacing): p-1 is 4 px, p-4 is 16 px. */
  unit: '4px',
  /** Page gutters on phones and from 768 px (never less than the safe-area inset). */
  'gutter-phone': '16px',
  'gutter-desktop': '40px',
  /** Vertical padding of a page section on phones and from 768 px. */
  section: '40px',
  'section-desktop': '56px',
} as const;

/** Layout measures of the app shell (plan §5.8 (b)). */
export const layout = {
  /** Minimum touch target on phones (plan §5.8 (b); WCAG 2.5.8 asks only 24 px). */
  touch: '44px',
  /** Height of the phone bottom tab bar, without the safe-area inset. */
  'tab-h': '64px',
  /** Height of the phone top bar. */
  'top-h': '56px',
  /** Width of the desktop side rail. */
  'rail-w': '232px',
  /** Maximum content width. */
  'content-max': '1180px',
  /** Comfortable reading measure. */
  measure: '62ch',
  /** Width of a side sheet from 768 px (the sheet becomes a right-hand panel there). */
  'sheet-w': '420px',
} as const;

/**
 * Motion (plan §5.8 (e)): purposeful, 150-250 ms, nothing that starts on its own, and instant
 * under prefers-reduced-motion. The ink trace is the one longer sequence: it runs only on a
 * tap, one generation at a time, and finishes within `ink-total`.
 */
export const motion = {
  duration: {
    fast: '150ms',
    base: '200ms',
    slow: '250ms',
    /** Per-generation delay of the ink trace. */
    'ink-step': '110ms',
    /** Time one stroke takes to ink in. */
    'ink-draw': '220ms',
    /** Upper bound for the whole trace, however many generations it has. */
    'ink-total': '1000ms',
  },
  easing: {
    out: 'cubic-bezier(0.2, 0.75, 0.2, 1)',
    'in-out': 'cubic-bezier(0.45, 0.05, 0.2, 1)',
    /** A seal pressed onto paper: a short overshoot, then rest. */
    stamp: 'cubic-bezier(0.3, 1.45, 0.45, 1)',
  },
} as const;

// ---------------------------------------------------------------------------------------
// Verification states and link styles (plan §4.6): never colour alone. Each state has a
// stroke pattern, a seal icon and a text label; the explorer (M05) draws links from these.

export const VERIFICATION_STATES = ['unconfirmed', 'under_review', 'verified', 'arbitration'] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export interface LinkStyle {
  label: string;
  /** Colour role of the seal (the state's colour). */
  color: ColorRole;
  /**
   * Colour role of the stroke. A verified link is drawn in solid ink and the jade seal carries
   * the colour (Ink Lineage); every other state draws its stroke in its own colour.
   */
  strokeColor: ColorRole;
  /**
   * Colour role of the text label (status badges): text-grade (4.5:1). Unconfirmed grey is a
   * stroke colour at 3:1 only, so its label is set in the secondary text colour.
   */
  labelColor: ColorRole;
  /** How the stroke is drawn. */
  stroke: 'dotted' | 'broken' | 'solid' | 'double' | 'hollow-curve' | 'thin';
  /** SVG stroke-dasharray of a 2 px stroke, or null for a continuous stroke. */
  dash: string | null;
  /** Stroke width in px at 100% zoom. */
  width: number;
  /** Seal icon (src/components/seal.tsx). */
  seal: 'question' | 'hourglass' | 'check' | 'scales' | 'bridge' | 'period';
  /** One-line explanation used by legends. */
  description: string;
}

export const linkStyles: Record<VerificationState | 'cross_lineage' | 'historical', LinkStyle> = {
  unconfirmed: {
    label: 'Unconfirmed',
    color: 'unconfirmed',
    strokeColor: 'unconfirmed',
    labelColor: 'fg-muted',
    stroke: 'dotted',
    dash: '0.1 4',
    width: 1.5,
    seal: 'question',
    description: 'Named, not yet confirmed by the teacher or by evidence.',
  },
  under_review: {
    label: 'Under review',
    color: 'review',
    strokeColor: 'review',
    labelColor: 'review',
    stroke: 'broken',
    dash: '7 4',
    width: 2,
    seal: 'hourglass',
    description: 'Evidence submitted; an archivist is checking it.',
  },
  verified: {
    label: 'Verified',
    color: 'verified',
    strokeColor: 'fg',
    labelColor: 'verified',
    stroke: 'solid',
    dash: null,
    width: 2,
    seal: 'check',
    description: 'Confirmed by the teacher or by evidence that holds up.',
  },
  arbitration: {
    label: 'In arbitration',
    color: 'arbitration',
    strokeColor: 'arbitration',
    labelColor: 'arbitration',
    stroke: 'double',
    dash: null,
    width: 1.25,
    seal: 'scales',
    description: 'Disputed; an independent panel is hearing both sides.',
  },
  cross_lineage: {
    label: 'Cross-lineage',
    color: 'cross-lineage',
    strokeColor: 'cross-lineage',
    labelColor: 'cross-lineage',
    stroke: 'hollow-curve',
    dash: '9 3 2 3',
    width: 1.75,
    seal: 'bridge',
    description: 'A teacher from another lineage; drawn as its own curve and labelled.',
  },
  historical: {
    label: 'Historical',
    color: 'fg-muted',
    strokeColor: 'fg-muted',
    labelColor: 'fg-muted',
    stroke: 'thin',
    dash: null,
    width: 1,
    seal: 'period',
    description: 'Training that has ended; shown with its years.',
  },
};
