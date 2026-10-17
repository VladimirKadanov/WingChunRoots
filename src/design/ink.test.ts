import { describe, expect, it } from 'vitest';
import { brushWidth, inkShapes, type Cubic } from './ink';
import { VERIFICATION_STATES } from './tokens';

const curve: Cubic = [
  [3, 11],
  [21, 3],
  [41, 18],
  [59, 9],
];

describe('ink strokes', () => {
  it('draws every state as a different kind of shape (never colour alone)', () => {
    const kinds = VERIFICATION_STATES.map((state) => {
      const shape = inkShapes(curve, state);
      return shape.kind === 'fill' ? `fill:${shape.d.split('M').length - 1}` : shape.kind;
    });
    // verified is one ribbon, under review several dashes, unconfirmed dots, arbitration two lines.
    expect(kinds[0]).toBe('dots');
    expect(kinds[1]).toMatch(/^fill:[2-9]/);
    expect(kinds[2]).toBe('fill:1');
    expect(kinds[3]).toBe('double');
  });
  it('draws cross-lineage links hollow, with the state in the dash', () => {
    expect(inkShapes(curve, 'verified', { crossLineage: true })).toMatchObject({ kind: 'hollow', dash: null });
    expect(inkShapes(curve, 'under_review', { crossLineage: true })).toMatchObject({ kind: 'hollow', dash: '7 4' });
  });
  it('tapers from the teacher to the student', () => {
    expect(brushWidth(0.1, 6, 1.5)).toBeGreaterThan(brushWidth(0.9, 6, 1.5));
  });
  it('is deterministic', () => {
    expect(inkShapes(curve, 'verified')).toEqual(inkShapes(curve, 'verified'));
  });
});
