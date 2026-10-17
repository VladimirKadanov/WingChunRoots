// The living line's row tones (plan §4.7): a dimmed row steps down one solid tone, so in both
// themes a dimmed year or name is quieter than an active one and still readable (>= 4.5:1).

import { describe, expect, it } from 'vitest';
import { MIN_TEXT } from '@/design/contrast-pairs';
import { contrastRatio } from '@/design/color';
import { THEMES, colors } from '@/design/tokens';
import { ROW_TONES, ROW_TONE_ROLES } from './trace-line';

describe('living line row tones', () => {
  it('the classes name the roles', () => {
    for (const tone of ['active', 'dimmed'] as const)
      for (const part of ['year', 'name'] as const) expect(ROW_TONES[tone][part]).toBe(`text-${ROW_TONE_ROLES[tone][part]}`);
  });

  for (const theme of THEMES) {
    for (const ground of ['bg', 'surface-1'] as const) {
      for (const part of ['year', 'name'] as const) {
        it(`${theme}: a dimmed ${part} is quieter than an active one on ${ground} and still >= ${MIN_TEXT}:1`, () => {
          const ratio = (tone: 'active' | 'dimmed') => contrastRatio(colors[theme][ROW_TONE_ROLES[tone][part]], colors[theme][ground]);
          expect(ratio('dimmed')).toBeLessThan(ratio('active'));
          expect(ratio('dimmed')).toBeGreaterThanOrEqual(MIN_TEXT);
        });
      }
    }
  }
});
