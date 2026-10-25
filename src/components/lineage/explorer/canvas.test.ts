// The explorer canvas's view (plan §4.3, §4.8, §5.8 (e)): the moves of the view take the motion
// tokens, and every fit of the whole view stops at the cards' own size.

import { describe, expect, it } from 'vitest';

import { motion } from '@/design/tokens';
import { cubicBezier, FIT_OPTIONS, ms, VIEW_MOTION } from './canvas';

describe('the moves of the view', () => {
  it('take their durations and curve from the motion tokens', () => {
    expect(`${VIEW_MOTION.buttons}ms`).toBe(motion.duration.base);
    expect(`${VIEW_MOTION.scene}ms`).toBe(motion.duration.slow);
    expect(ms('250ms')).toBe(250);
    // The people slide along --ease-out (globals.css); the view moves along the same curve.
    const out = cubicBezier(motion.easing.out);
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) expect(VIEW_MOTION.ease(t)).toBeCloseTo(out(t), 9);
  });

  it('read a cubic-bezier() timing function as CSS does', () => {
    const linear = cubicBezier('cubic-bezier(0, 0, 1, 1)');
    for (const t of [0, 0.2, 0.5, 0.8, 1]) expect(linear(t)).toBeCloseTo(t, 6);
    // CSS `ease-out` (0, 0, 0.58, 1) at the curve's parameter 1/2: x = 3·0.58/8 + 1/8 = 0.3425, y = 3/8 + 1/8 = 0.5.
    expect(cubicBezier('cubic-bezier(0, 0, 0.58, 1)')(0.3425)).toBeCloseTo(0.5, 6);
    const out = cubicBezier(motion.easing.out);
    expect(out(0)).toBe(0);
    expect(out(1)).toBe(1);
    let previous = 0;
    for (let t = 0.05; t < 1; t += 0.05) {
      expect(out(t)).toBeGreaterThanOrEqual(previous);
      previous = out(t);
    }
    // An ease-out curve: ahead of the clock all the way.
    expect(out(0.5)).toBeGreaterThan(0.5);
    expect(() => cubicBezier('ease-out')).toThrow();
  });
});

describe('fitting the whole view', () => {
  it('never zooms past the cards’ own size, for the first view and the button alike', () => {
    expect(FIT_OPTIONS.maxZoom).toBe(1);
  });
});
