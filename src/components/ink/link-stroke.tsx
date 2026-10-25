// A short sample of a link's stroke for legends and badges, in the state's colour. The states
// have two renderings (ADR 0006): the ink geometry of src/design/ink.ts that the home page and
// the lineage pages draw, and the plain strokes of the explorer's canvas (M05), whose routes and
// curves are drawn by StrokePaths below. A legend draws its samples the way its screen draws the
// links (`variant`), so the sample and the drawing never differ (plan §4.6: never colour alone).

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
/** The same curve as a path, for the canvas strokes. */
const SAMPLE_PATH = `M${SAMPLE[0].join(' ')}C${SAMPLE.slice(1).flat().join(' ')}`;

/**
 * A link as the explorer's canvas strokes it (plan §4.6): one line with the state's width and
 * dash (linkStyles), the dotted state with round dots, and the double stroke as a wide stroke
 * with `ground` (the colour behind the drawing) knocked out of its middle. Width and dashes stay
 * in screen pixels at every zoom, so the pattern still reads zoomed out to the dots. `attributes`
 * go on the drawn path, `coreAttributes` on the knocked-out ground of a double stroke.
 */
export function StrokePaths({
  d,
  kind,
  ground,
  attributes,
  coreAttributes,
}: {
  d: string;
  kind: LinkKind;
  ground: string;
  attributes?: { [name: `data-${string}`]: string };
  coreAttributes?: { [name: `data-${string}`]: string };
}) {
  const style = linkStyles[kind];
  const double = style.stroke === 'double';
  const common = { d, fill: 'none', strokeDasharray: style.dash ?? undefined, vectorEffect: 'non-scaling-stroke' } as const;
  return (
    <>
      <path
        {...attributes}
        {...common}
        stroke={`var(--${style.strokeColor})`}
        strokeWidth={double ? style.width * 3.5 : style.width}
        strokeLinecap={style.stroke === 'dotted' ? 'round' : 'butt'}
      />
      {double ? <path {...coreAttributes} {...common} stroke={ground} strokeWidth={style.width * 1.4} /> : null}
    </>
  );
}

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

export function LinkStroke({
  kind,
  variant = 'ink',
  className,
  width = 62,
}: {
  kind: LinkKind;
  /** 'canvas': the explorer's strokes (StrokePaths), on the ground of --seal-ground or the page. */
  variant?: 'ink' | 'canvas';
  className?: string;
  width?: number;
}) {
  return (
    <svg
      viewBox="0 0 62 22"
      width={width}
      height={(width * 22) / 62}
      aria-hidden="true"
      focusable="false"
      className={cx('inline-block shrink-0 overflow-visible', className)}
      style={{ color: `var(--${linkStyles[kind].strokeColor})` }}
      data-stroke={linkStyles[kind].stroke}
      data-variant={variant}
    >
      {variant === 'canvas' ? (
        <StrokePaths d={SAMPLE_PATH} kind={kind} ground="var(--seal-ground, var(--bg))" />
      ) : (
        <InkShapeSvg shape={shapeFor(kind)} />
      )}
    </svg>
  );
}
