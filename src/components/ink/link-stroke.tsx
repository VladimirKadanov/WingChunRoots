// A short sample of a link's stroke for legends and badges: the same ink geometry the
// explorer draws (src/design/ink.ts), in the state's colour.

import { inkShapes, type Cubic, type InkShape } from '@/design/ink';
import { linkStyles, type VerificationState } from '@/design/tokens';
import { cx } from '@/lib/cx';

export type LinkKind = VerificationState | 'cross_lineage' | 'historical';

const SAMPLE: Cubic = [
  [3, 11],
  [21, 3],
  [41, 18],
  [59, 9],
];

/** Renders one ink shape in the current colour. */
export function InkShapeSvg({ shape }: { shape: InkShape }) {
  switch (shape.kind) {
    case 'fill':
      return <path d={shape.d} fill="currentColor" />;
    case 'dots':
      return (
        <g fill="currentColor">
          {shape.circles.map((c, i) => (
            <circle key={i} cx={c.cx} cy={c.cy} r={c.r} />
          ))}
        </g>
      );
    case 'double':
      return (
        <g fill="none" stroke="currentColor" strokeWidth={1.4} strokeDasharray="6 4">
          <path d={shape.d[0]} />
          <path d={shape.d[1]} />
        </g>
      );
    case 'hollow':
      return (
        <path
          d={shape.d}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.3}
          strokeDasharray={shape.dash ?? undefined}
        />
      );
  }
}

function shapeFor(kind: LinkKind): InkShape {
  if (kind === 'cross_lineage') return inkShapes(SAMPLE, 'verified', { w0: 4.8, w1: 1.3, n: 30, crossLineage: true });
  if (kind === 'historical') return inkShapes(SAMPLE, 'verified', { w0: 1.6, w1: 1, n: 30 });
  return inkShapes(SAMPLE, kind, { w0: 4.8, w1: 1.3, n: 30 });
}

export function LinkStroke({ kind, className, width = 62 }: { kind: LinkKind; className?: string; width?: number }) {
  return (
    <svg
      viewBox="0 0 62 22"
      width={width}
      height={(width * 22) / 62}
      aria-hidden="true"
      focusable="false"
      className={cx('inline-block shrink-0 overflow-visible', className)}
      style={{ color: `var(--${linkStyles[kind].color})` }}
      data-stroke={linkStyles[kind].stroke}
    >
      <InkShapeSvg shape={shapeFor(kind)} />
    </svg>
  );
}
