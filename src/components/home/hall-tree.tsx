// A small, static drawing of the fictional Jade Lantern Hall (server-rendered SVG, no
// JavaScript): eight rows from the founder, a student with two teachers, a teacher from another
// hall drawn in its own labelled band, and links in every state. The heavier path is the line
// traced at the top of the page (DEMO_LINE), so the two drawings agree. Decorative: the text
// and the key beside it say the same.
//
// Every label is at least 14 units and the figure is never drawn narrower than 0.79 of its
// viewBox (a 320 px phone), so no text in it renders under 11 px (e2e: "hall tree text").

import { inkShapes, type Cubic } from '@/design/ink';
import type { VerificationState } from '@/design/tokens';
import { legendKinds } from '@/components/ink/legend';
import { InkShapeSvg } from '@/components/ink/link-stroke';
import { Seal } from '@/components/ink/seal';
import { linkStyles } from '@/design/tokens';
import { cx } from '@/lib/cx';
import { DEMO_HALL, DEMO_LINE } from './demo-lineage';

const NO_TRANSLATE = { translate: 'no' } as Record<string, string>;

type Node = { id: string; x: number; g: number; living?: boolean; founder?: boolean; other?: boolean };
type Link = { from: string; to: string; state: VerificationState; primary?: boolean; cross?: boolean; second?: boolean };

export const HALL_TREE_WIDTH = 340;
const HEIGHT = 506;
const GAP = 56;
const TOP = 56;
/** The band of the other hall: right of this x. */
const BAND = 254;
const y = (g: number) => TOP + (g - 1) * GAP;
/** Smallest label, in viewBox units. */
const LABEL = 14;

const NODES: Node[] = [
  { id: 'a', x: 132, g: 1, founder: true },
  { id: 'b', x: 92, g: 2 },
  { id: 'c', x: 190, g: 2 },
  { id: 'd', x: 50, g: 3 },
  { id: 'e', x: 120, g: 3 },
  { id: 'f', x: 212, g: 3 },
  { id: 'g', x: 96, g: 4 },
  { id: 'h', x: 196, g: 4 },
  { id: 'i', x: 52, g: 5, living: true },
  { id: 'j', x: 140, g: 5, living: true },
  { id: 'x', x: 292, g: 5, living: true, other: true },
  { id: 'k', x: 110, g: 6, living: true },
  { id: 'l', x: 214, g: 6, living: true },
  { id: 'm', x: 56, g: 7, living: true },
  { id: 'n', x: 150, g: 7, living: true },
  { id: 'o', x: 228, g: 7, living: true },
  { id: 'p', x: 124, g: 8, living: true },
  { id: 'q', x: 222, g: 8, living: true },
];

// The primary path a → b → e → g → j → k → n → p is DEMO_LINE: verified down to the newest
// link, which is under review.
const LINKS: Link[] = [
  { from: 'a', to: 'b', state: 'verified', primary: true },
  { from: 'a', to: 'c', state: 'verified' },
  { from: 'b', to: 'd', state: 'verified' },
  { from: 'b', to: 'e', state: 'verified', primary: true },
  { from: 'c', to: 'f', state: 'verified' },
  { from: 'e', to: 'g', state: 'verified', primary: true },
  { from: 'f', to: 'h', state: 'verified' },
  { from: 'g', to: 'i', state: 'verified' },
  { from: 'g', to: 'j', state: 'verified', primary: true },
  { from: 'h', to: 'j', state: 'verified', second: true },
  { from: 'j', to: 'k', state: 'verified', primary: true },
  { from: 'x', to: 'l', state: 'verified', cross: true },
  { from: 'h', to: 'l', state: 'arbitration' },
  { from: 'k', to: 'm', state: 'unconfirmed' },
  { from: 'k', to: 'n', state: 'verified', primary: true },
  { from: 'l', to: 'o', state: 'verified' },
  { from: 'n', to: 'p', state: 'under_review', primary: true },
  { from: 'o', to: 'q', state: 'verified' },
];

/** What the drawing shows, for the figures beside it (the other hall's teacher is not counted). */
export const HALL_TREE_STATS = {
  people: NODES.filter((n) => !n.other).length,
  links: LINKS.length,
  verifiedLinks: LINKS.filter((l) => l.state === 'verified').length,
  // DEFAULT D22: generations count only along verified links from the founder (here the
  // longest such path is the traced line's, down to its link under review).
  verifiedGenerations: 1 + LINKS.filter((l) => l.primary && l.state === 'verified').length,
} as const;

/** The link kinds this drawing uses, for its legend. */
export const HALL_TREE_KINDS = legendKinds(LINKS.map((l) => (l.cross ? 'cross_lineage' : l.state)));

const byId = new Map(NODES.map((n) => [n.id, n]));
const node = (id: string) => byId.get(id)!;
const link = (from: string, to: string) => LINKS.find((l) => l.from === from && l.to === to)!;
const founder = DEMO_LINE[0]!;
const newest = DEMO_LINE[DEMO_LINE.length - 1]!;

function curveOf(l: Link): Cubic {
  const a = node(l.from);
  const b = node(l.to);
  const y0 = y(a.g) + 8;
  const y1 = y(b.g) - 8;
  const pull = (y1 - y0) * 0.55;
  return [
    [a.x, y0],
    [a.x, y0 + pull],
    [b.x, y1 - pull],
    [b.x, y1],
  ];
}

/** A 16-unit seal beside the middle of a link's curve. */
function sealAt(l: Link, dx: number, dy = 0) {
  const [p0, , , p3] = curveOf(l);
  return `translate(${(p0[0] + p3[0]) / 2 + dx} ${(p0[1] + p3[1]) / 2 + dy - 8})`;
}

export function HallTree({ className }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${HALL_TREE_WIDTH} ${HEIGHT}`} className={className} aria-hidden="true" focusable="false" data-hall-tree>
      {/* Rows, counted from the founder (DEFAULT D22: the caption says when a row is a generation). */}
      {Array.from({ length: 8 }, (_, i) => (
        <text key={i} x={4} y={y(i + 1) + 5} fontSize={LABEL} className="fill-fg-subtle font-sans font-semibold tabular">
          {i + 1}
        </text>
      ))}

      {/* The other hall's band: a rule, and its name running up its outer edge. */}
      <path d={`M${BAND} ${y(2) - 18}V${HEIGHT - 6}`} stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="2 4" />
      <text transform={`translate(${HALL_TREE_WIDTH - 4} ${HEIGHT - 10}) rotate(-90)`} fontSize={LABEL} className="font-sans font-semibold">
        <tspan className="fill-fg-muted" lang="en" {...NO_TRANSLATE}>
          {DEMO_HALL.otherHall}
        </tspan>
        <tspan className="fill-cross-lineage"> · Cross-lineage</tspan>
      </text>

      {LINKS.map((l, i) => {
        const shape = inkShapes(curveOf(l), l.state, {
          w0: l.primary ? 6.6 : l.second ? 3.4 : 4.4,
          w1: l.primary ? 1.8 : 1.3,
          n: 26,
          crossLineage: l.cross,
        });
        const color = `var(--${linkStyles[l.cross ? 'cross_lineage' : l.state].strokeColor})`;
        return (
          <g key={i} style={{ color }} data-primary={l.primary ? '' : undefined}>
            <InkShapeSvg shape={shape} />
          </g>
        );
      })}

      {NODES.map((n) =>
        n.founder ? (
          <g key={n.id} fill="var(--fg)">
            <rect x={n.x - 12} y={y(n.g) - 16} width={24} height={3.4} rx={1} />
            <rect x={n.x - 8} y={y(n.g) - 8} width={16} height={16} rx={2} transform={`rotate(4 ${n.x} ${y(n.g)})`} />
          </g>
        ) : n.other ? (
          <circle key={n.id} cx={n.x} cy={y(n.g)} r={6} fill="var(--fg)" stroke="var(--cross-lineage)" strokeWidth={2.4} />
        ) : n.living ? (
          <circle key={n.id} cx={n.x} cy={y(n.g)} r={6} fill="var(--fg)" />
        ) : (
          <circle key={n.id} cx={n.x} cy={y(n.g)} r={5.6} fill="var(--bg)" stroke="var(--fg)" strokeWidth={2} />
        ),
      )}

      {/* A seal on every link that is not plainly verified. */}
      <g transform={sealAt(link('k', 'm'), -22)}>
        <Seal kind="question" size={16} />
      </g>
      <g transform={sealAt(link('n', 'p'), 8)}>
        <Seal kind="hourglass" size={16} />
      </g>
      <g transform={sealAt(link('h', 'l'), 10)}>
        <Seal kind="scales" size={16} />
      </g>
      <g transform={sealAt(link('x', 'l'), 12, -4)}>
        <Seal kind="bridge" size={16} />
      </g>

      {/* The two ends of the traced line. Names: never translated (CLAUDE.md §2); React's SVG
          types do not list `translate`. */}
      <text x={node('a').x + 20} y={y(1) - 3} fontSize={16} className="fill-fg font-display" lang="en" {...NO_TRANSLATE}>
        {founder.name}
      </text>
      <text x={node('a').x + 20} y={y(1) + 14} fontSize={LABEL} className="fill-fg-subtle font-sans font-semibold tabular">
        Founder · {founder.startYear}
      </text>
      <text x={node('p').x} y={y(8) + 28} fontSize={16} textAnchor="middle" className="fill-fg font-display" lang="en" {...NO_TRANSLATE}>
        {newest.name}
      </text>
      <text x={node('p').x} y={y(8) + 46} fontSize={LABEL} textAnchor="middle" className="fill-review font-sans font-semibold tabular">
        {newest.startYear} · under review
      </text>
    </svg>
  );
}

/** The key to the nodes and to the heavier stroke (the link states have the shared Legend). */
export function HallTreeKey({ className }: { className?: string }) {
  return (
    <ul aria-label="Legend: people" className={cx('flex flex-wrap gap-x-5 gap-y-2 text-sm text-fg', className)}>
      <li className="flex items-center gap-2">
        <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true" focusable="false">
          <rect x={3} y={3} width={10} height={10} rx={1.5} fill="var(--fg)" transform="rotate(4 8 8)" />
        </svg>
        Founder
      </li>
      <li className="flex items-center gap-2">
        <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true" focusable="false">
          <circle cx={8} cy={8} r={5} fill="var(--fg)" />
        </svg>
        Living
      </li>
      <li className="flex items-center gap-2">
        <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true" focusable="false">
          <circle cx={8} cy={8} r={4.6} fill="none" stroke="var(--fg)" strokeWidth={1.8} />
        </svg>
        Deceased
      </li>
      <li className="flex items-center gap-2">
        <svg viewBox="0 0 34 16" width={34} height={16} aria-hidden="true" focusable="false">
          <path d="M2 6.2C12 5.4 22 5.6 32 6.4L32 9.6C22 10.4 12 10.6 2 9.8Z" fill="var(--fg)" />
        </svg>
        Heavier: the line traced at the top
      </li>
    </ul>
  );
}
