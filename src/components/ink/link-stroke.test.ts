import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { linkStyles } from '@/design/tokens';
import { type LinkKind, LinkStroke, StrokePaths } from './link-stroke';

const KINDS = Object.keys(linkStyles) as LinkKind[];

const sample = (kind: LinkKind, variant: 'ink' | 'canvas') => renderToStaticMarkup(createElement(LinkStroke, { kind, variant }));
const canvas = (kind: LinkKind) => renderToStaticMarkup(createElement(StrokePaths, { d: 'M3 11C21 3 41 18 59 9', kind, ground: 'var(--seal-ground, var(--bg))' }));

/** The <path> elements of an SVG fragment, without their d (the stroke, not the shape). */
const strokes = (markup: string) => (markup.match(/<path [^>]*>/g) ?? []).map((p) => p.replace(/ d="[^"]*"/, ''));

describe('LinkStroke (plan §4.6: a legend sample is drawn the way its screen draws the link)', () => {
  it.each(KINDS)('the canvas sample of %s is the stroke the explorer canvas draws', (kind) => {
    expect(strokes(sample(kind, 'canvas'))).toEqual(strokes(canvas(kind)));
  });

  it('the canvas strokes: the cross-lineage long dash and dot, a double line as two lines', () => {
    const cross = strokes(canvas('cross_lineage'));
    expect(cross).toHaveLength(1);
    expect(cross[0]).toContain(`stroke-dasharray="${linkStyles.cross_lineage.dash}"`);
    // The double stroke: a wide stroke and the ground knocked out of it, no dash.
    const double = strokes(canvas('arbitration'));
    expect(double).toHaveLength(2);
    expect(double.join('')).not.toContain('stroke-dasharray');
    expect(double[1]).toContain('stroke="var(--seal-ground, var(--bg))"');
  });

  it('the ink samples keep the ink shapes of ADR 0006 (the home page and the lineage screens)', () => {
    // Cross-lineage: a hollow ribbon, solid when verified; in arbitration: two thin dashed lines.
    expect(sample('cross_lineage', 'ink')).not.toContain('stroke-dasharray');
    expect(sample('arbitration', 'ink').match(/<path /g)).toHaveLength(2);
    expect(sample('arbitration', 'ink')).toContain('stroke-dasharray="6 4"');
    expect(sample('verified', 'ink')).toContain('fill="currentColor"');
  });
});
