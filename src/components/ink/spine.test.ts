// The ink trace of the home page ends within one second (plan §5.8 (e), ADR 0006).

import { describe, expect, it } from 'vitest';
import { motion } from '@/design/tokens';
import { INK_DRAW, INK_STEP, INK_TOTAL, SEAL_PRESS, evenRows, inkStep, inkTraceEnd, spineGeometry } from './spine';

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

describe('spine geometry', () => {
  const states = ['verified', 'verified', 'under_review'] as const;
  it('places each node at its row and each seal between its two nodes', () => {
    const { ys, height } = evenRows(4, 56, 12);
    expect(ys).toEqual([12, 68, 124, 180]);
    expect(height).toBe(224);
    const g = spineGeometry([...states], ys, height);
    expect(g.nodes.map((n) => n.y)).toEqual(ys);
    for (const segment of g.segments) {
      const top = g.nodes[segment.index]!.y;
      const bottom = g.nodes[segment.index + 1]!.y;
      expect(segment.seal.y + 6.5).toBeGreaterThan(top);
      expect(segment.seal.y + 6.5).toBeLessThan(bottom);
    }
  });
  it('follows rows of different heights (large text, wrapped names)', () => {
    const g = spineGeometry([...states], [12, 90, 146, 260], 300);
    expect(g.segments[2]!.seal.y + 6.5).toBeGreaterThan(146);
    expect(g.segments[2]!.seal.y + 6.5).toBeLessThan(260);
    expect(g.height).toBe(300);
  });
  it('draws a thinner draft of every link with the same pattern', () => {
    const g = spineGeometry([...states], evenRows(4, 56, 12).ys, 224);
    for (const segment of g.segments) expect(segment.draft.kind).toBe(segment.shape.kind);
  });
});
