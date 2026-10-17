// Every contrast pair the design tokens must hold, in both themes (plan §5.2 table, §4.7 dimmed
// tones, and the roles the "Ink Register" direction adds). src/design/contrast.test.ts checks
// them all and the token generator writes the ratios into tokens.json. Kept apart from
// tokens.ts, so the explanations stay out of the JavaScript that pages load.

import type { ColorRole } from './tokens';

/** Minimum contrast for text (WCAG 1.4.3) and for borders and graphics (WCAG 1.4.11). */
export const MIN_TEXT = 4.5;
export const MIN_GRAPHIC = 3;

export interface ContrastPair {
  fg: ColorRole;
  bg: ColorRole;
  min: number;
  why: string;
}

const GROUNDS: ColorRole[] = ['bg', 'surface-1', 'surface-2'];
const on = (fg: ColorRole, min: number, why: string, grounds: ColorRole[] = GROUNDS): ContrastPair[] =>
  grounds.map((bg) => ({ fg, bg, min, why }));

export const CONTRAST_PAIRS: ContrastPair[] = [
  ...on('fg', MIN_TEXT, 'primary text'),
  ...on('fg', MIN_TEXT, 'primary text on hover and pressed states', ['surface-3', 'surface-pressed']),
  ...on('fg-muted', MIN_TEXT, 'secondary text; dimmed text tone (plan §4.7)'),
  ...on('fg-muted', MIN_TEXT, 'secondary text on hover and pressed states', ['surface-3', 'surface-pressed']),
  ...on('fg-subtle', MIN_TEXT, 'captions, eyebrows and meta lines'),
  ...on('fg-subtle', MIN_TEXT, 'a meta line in a hovered row', ['surface-3']),
  ...on('border-strong', MIN_GRAPHIC, 'field and control frames; dimmed frame tone (plan §4.7)'),
  ...on('border-strong', MIN_GRAPHIC, 'a control frame in a hovered row', ['surface-3']),
  ...on('brand-fg', MIN_TEXT, 'red text on the ground'),
  { fg: 'on-brand', bg: 'brand', min: MIN_TEXT, why: 'label on the primary button' },
  { fg: 'on-brand', bg: 'brand-hover', min: MIN_TEXT, why: 'label on the hovered primary button' },
  { fg: 'on-brand', bg: 'brand-pressed', min: MIN_TEXT, why: 'label on the pressed primary button' },
  { fg: 'brand', bg: 'bg', min: MIN_GRAPHIC, why: 'brand seal and primary button edge against the page' },
  ...on('verified', MIN_TEXT, '"Verified" text, strokes and seals'),
  { fg: 'on-verified', bg: 'verified', min: MIN_TEXT, why: 'check carved into the verified seal' },
  ...on('review', MIN_TEXT, '"Under review" text, strokes and seals'),
  ...on('unconfirmed', MIN_GRAPHIC, 'dotted unconfirmed stroke; dimmed stroke and seal tone (plan §4.7)'),
  ...on('arbitration', MIN_TEXT, '"In arbitration" text, double stroke and seal'),
  ...on('cross-lineage', MIN_TEXT, 'cross-lineage curve and its label'),
  ...on('focus', MIN_GRAPHIC, 'focus ring (drawn with a 2 px offset, so it sits on the ground)'),
  ...on('focus', MIN_GRAPHIC, 'inset focus ring of a hovered or pressed tab', ['surface-3', 'surface-pressed']),
  ...on('danger', MIN_TEXT, 'form error text, its icon and the danger button'),
  ...on('danger', MIN_TEXT, 'label of a hovered or pressed danger button', ['surface-3', 'surface-pressed']),
  { fg: 'fg-inverse', bg: 'fg', min: MIN_TEXT, why: 'text on an ink-filled chip or button' },
  { fg: 'fg-inverse', bg: 'ink-hover', min: MIN_TEXT, why: 'text on a hovered ink button' },
];

/** Print pairs on paper (plan §5.2). */
export const PRINT_PAIRS = [
  { fg: 'ink', bg: 'paper', min: MIN_TEXT },
  { fg: 'seal', bg: 'paper', min: MIN_TEXT },
  { fg: 'print-verified', bg: 'paper', min: MIN_TEXT },
] as const;

/** Every state label printed on paper (print styles use the light theme's state colours). */
export const PRINT_STATE_ROLES = ['verified', 'review', 'arbitration', 'cross-lineage', 'danger', 'fg-muted', 'fg-subtle'] as const;

/** The brand red and the danger rouge stay apart (OKLCH hue, degrees), so an error never reads as the brand. */
export const MIN_DANGER_HUE_DISTANCE = 25;
