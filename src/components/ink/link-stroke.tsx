// A short sample of a link's stroke for legends and badges, in the state's colour. The states
// have three renderings (ADR 0006): the ink geometry of src/design/ink.ts that the home page and
// the lineage pages draw; the explorer's ink along its routes (canvasInk, InkPaths: owner decision
// 2026-10-31, "Ink restyle"), from the compact cards up; and the plain strokes of the explorer's
// canvas zoomed out to the dots (StrokePaths). A legend draws its samples the way its screen draws
// the links (`variant`), so the sample and the drawing never differ (plan §4.6: never colour alone).

import { dotsD, inkAlong, inkShapes, type Cubic, type InkShape, type Route } from '@/design/ink';
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
/** The same curve as a route, for the canvas's ink. */
const SAMPLE_ROUTE: Route = { start: SAMPLE[0], pieces: [{ kind: 'cubic', c1: SAMPLE[1], c2: SAMPLE[2], to: SAMPLE[3] }] };

/**
 * The explorer's ink at the two levels of detail that draw it (plan §4.8): the compact chips are
 * drawn at a smaller zoom, so their ink is wider. The width falls with the distance from the
 * teacher (`reach`), so the links of one teacher share their trunk at one width (b5).
 */
export const CANVAS_INK = {
  full: { w0: 5.6, w1: 1.4, reach: 90, doubleOffset: 2.6 },
  compact: { w0: 9, w1: 2.8, reach: 90, doubleOffset: 4.5 },
} as const;

/**
 * A link of the explorer in ink along its route: the state's shape (inkAlong), a thin ribbon for
 * ended training, and for a teacher of another lineage a hollow ribbon with the long dash of the
 * cross-lineage stroke (plan §4.6: long-dashed), tapering over its whole length.
 */
export function canvasInk(kind: LinkKind, route: Route, lod: keyof typeof CANVAS_INK): InkShape {
  const o = CANVAS_INK[lod];
  if (kind === 'cross_lineage') return inkAlong(route, 'verified', { w0: o.w0, w1: o.w1, crossLineage: { dash: linkStyles.cross_lineage.dash } });
  if (kind === 'historical') return inkAlong(route, 'verified', { w0: o.w0 * 0.36, w1: o.w1 * 0.7, reach: o.reach });
  return inkAlong(route, kind, o);
}

/**
 * One ink shape of the explorer as a single path in the stroke's colour: the dots as one path of
 * circles, the two lines in arbitration as one path of two. The outline of a stroked shape, and
 * the edge a lit link adds (globals.css), stay in screen pixels at every zoom. `color` is a
 * presentation attribute, so the canvas's dimming (a CSS rule) overrides it.
 */
export function InkPaths({ shape, kind, attributes }: { shape: InkShape; kind: LinkKind; attributes?: { [name: `data-${string}`]: string } }) {
  const common = { ...attributes, 'data-ink': shape.kind, color: `var(--${linkStyles[kind].strokeColor})`, vectorEffect: 'non-scaling-stroke' } as const;
  switch (shape.kind) {
    case 'fill':
      return <path {...common} d={shape.d} fill="currentColor" />;
    case 'dots':
      return <path {...common} d={dotsD(shape.circles)} fill="currentColor" />;
    case 'double':
      return <path {...common} d={shape.d.join('')} fill="none" stroke="currentColor" strokeWidth={1.4} strokeDasharray="6 4" />;
    case 'hollow':
      return <path {...common} d={shape.d} fill="none" stroke="currentColor" strokeWidth={1.3} strokeDasharray={shape.dash ?? undefined} />;
  }
}

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
  /**
   * 'canvas': the explorer's strokes zoomed out to the dots (StrokePaths), on the ground of
   * --seal-ground or the page; 'canvas-ink': the explorer's ink from the compact cards up (canvasInk).
   */
  variant?: 'ink' | 'canvas' | 'canvas-ink';
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
      ) : variant === 'canvas-ink' ? (
        <InkPaths shape={canvasInk(kind, SAMPLE_ROUTE, 'full')} kind={kind} />
      ) : (
        <InkShapeSvg shape={shapeFor(kind)} />
      )}
    </svg>
  );
}
