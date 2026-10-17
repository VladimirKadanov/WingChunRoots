// The ink trace of the home page ends within one second (plan §5.8 (e), ADR 0006).

import { describe, expect, it } from 'vitest';
import { motion } from '@/design/tokens';
import { INK_DRAW, INK_STEP, INK_TOTAL, SEAL_PRESS, inkStep, inkTraceEnd } from './spine';

describe('ink trace timing', () => {
  it('uses the motion tokens', () => {
    expect(`${INK_TOTAL}ms`).toBe(motion.duration['ink-total']);
    expect(`${INK_STEP}ms`).toBe(motion.duration['ink-step']);
    expect(`${INK_DRAW}ms`).toBe(motion.duration['ink-draw']);
    expect(`${SEAL_PRESS}ms`).toBe(motion.duration.slow);
  });
  it('ends within the total for every length of line, the last seal included', () => {
    for (let links = 1; links <= 40; links++) {
      expect(inkTraceEnd(links), `${links} links`).toBeLessThanOrEqual(INK_TOTAL);
      expect(inkStep(links)).toBeGreaterThan(0);
    }
  });
  it('keeps the full step on short lines', () => {
    expect(inkStep(1)).toBe(INK_STEP);
    expect(inkStep(5)).toBe(INK_STEP);
  });
});
