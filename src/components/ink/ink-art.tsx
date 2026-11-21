// The drawn banner of a page without a banner of its own (docs/adr/0052-public-page-redesign.md):
// the ink motif of src/lib/ink-art.ts as inline SVG, painted with the art tones of the theme
// (`--art-*`), so it follows light and dark with no image file and no JavaScript. Decorative: the
// heading next to it names the page.

import { cx } from '@/lib/cx';
import { ART_HEIGHT, ART_WIDTH, type ArtMotif, type ArtShape, type ArtTone, drawArt, seedOf } from '@/lib/ink-art';

const tone = (t: ArtTone | undefined) => (t ? `var(--art-${t})` : 'none');

function Shape({ shape }: { shape: ArtShape }) {
  const paint = {
    fill: tone(shape.fill),
    stroke: tone(shape.stroke),
    strokeWidth: shape.stroke ? shape.width : undefined,
    strokeLinecap: shape.stroke ? ('round' as const) : undefined,
    strokeLinejoin: shape.stroke ? ('round' as const) : undefined,
  };
  switch (shape.kind) {
    case 'path':
      return <path d={shape.d} strokeDasharray={shape.dash} {...paint} />;
    case 'circle':
      return <circle cx={shape.cx} cy={shape.cy} r={shape.r} strokeDasharray={shape.dash} {...paint} />;
    case 'rect':
      return <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx} {...paint} />;
  }
}

export function InkArt({ slug, motif, className, testId }: { slug: string; motif: ArtMotif; className?: string; testId?: string }) {
  const art = drawArt(slug, motif);
  // Two drawings of one slug on a page share the same tile, so the id may repeat harmlessly.
  const tileId = `ink-tile-${seedOf(`${motif}:${slug}`).toString(36)}`;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${ART_WIDTH} ${ART_HEIGHT}`}
      preserveAspectRatio="xMidYMid slice"
      className={cx('block size-full', className)}
      data-testid={testId}
      data-motif={art.motif}
    >
      {art.tile ? (
        <defs>
          <pattern id={tileId} width={art.tile.size} height={art.tile.size} patternUnits="userSpaceOnUse">
            <rect width={art.tile.size} height={art.tile.size} fill="var(--art-ground)" />
            <path d={art.tile.d} fill="none" stroke="var(--art-mid)" strokeWidth={3} />
          </pattern>
        </defs>
      ) : null}
      <rect width={ART_WIDTH} height={ART_HEIGHT} fill={art.tile ? `url(#${tileId})` : 'var(--art-ground)'} />
      {art.shapes.map((shape, i) => (
        <Shape key={i} shape={shape} />
      ))}
    </svg>
  );
}

/** A monogram crest for a page without a logo: a square seal for a school, a shield for an organization. */
export function Crest({ text, shape, className }: { text: string; shape: 'seal' | 'shield'; className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 40 40" className={cx('block', className)}>
      {shape === 'seal' ? (
        <>
          <rect x="3" y="3" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <rect x="6" y="6" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="0.6" />
        </>
      ) : (
        <path d="M20 3 35 9v11c0 9-6.5 14.5-15 17C11.5 34.5 5 29 5 20V9Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      )}
      <text x="20" y={shape === 'seal' ? 25 : 24.5} textAnchor="middle" className="font-display" fontSize={shape === 'seal' ? 14 : 11} fill="currentColor">
        {text}
      </text>
    </svg>
  );
}
