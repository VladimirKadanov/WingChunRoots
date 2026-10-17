// A small, static drawing of the fictional Jade Lantern Hall (server-rendered SVG, no
// JavaScript): eight generations, a student with two teachers, a cross-lineage teacher drawn
// as a hollow curve, and links in every state. Decorative: the text beside it says the same.

import { inkShapes, type Cubic } from '@/design/ink';
import type { VerificationState } from '@/design/tokens';
import { InkShapeSvg } from '@/components/ink/link-stroke';
import { Seal } from '@/components/ink/seal';
import { linkStyles } from '@/design/tokens';

const NO_TRANSLATE = { translate: 'no' } as Record<string, string>;

type Node = { id: string; x: number; g: number; living?: boolean; founder?: boolean; other?: boolean };
type Link = { from: string; to: string; state: VerificationState; cross?: boolean; second?: boolean };

const GAP = 54;
const TOP = 46;
const y = (g: number) => TOP + (g - 1) * GAP;

const NODES: Node[] = [
  { id: 'a', x: 150, g: 1, founder: true },
  { id: 'b', x: 92, g: 2 },
  { id: 'c', x: 214, g: 2 },
  { id: 'd', x: 62, g: 3 },
  { id: 'e', x: 132, g: 3 },
  { id: 'f', x: 236, g: 3 },
  { id: 'g', x: 96, g: 4 },
  { id: 'h', x: 196, g: 4 },
  { id: 'i', x: 70, g: 5, living: true },
  { id: 'j', x: 152, g: 5, living: true },
  { id: 'x', x: 292, g: 5, living: true, other: true },
  { id: 'k', x: 112, g: 6, living: true },
  { id: 'l', x: 214, g: 6, living: true },
  { id: 'm', x: 76, g: 7, living: true },
  { id: 'n', x: 168, g: 7, living: true },
  { id: 'o', x: 250, g: 7, living: true },
  { id: 'p', x: 128, g: 8, living: true },
  { id: 'q', x: 214, g: 8, living: true },
];

const LINKS: Link[] = [
  { from: 'a', to: 'b', state: 'verified' },
  { from: 'a', to: 'c', state: 'verified' },
  { from: 'b', to: 'd', state: 'verified' },
  { from: 'b', to: 'e', state: 'verified' },
  { from: 'c', to: 'f', state: 'verified' },
  { from: 'e', to: 'g', state: 'verified' },
  { from: 'f', to: 'h', state: 'verified' },
  { from: 'g', to: 'i', state: 'verified' },
  { from: 'g', to: 'j', state: 'verified' },
  { from: 'h', to: 'j', state: 'verified', second: true },
  { from: 'j', to: 'k', state: 'verified' },
  { from: 'x', to: 'l', state: 'verified', cross: true },
  { from: 'h', to: 'l', state: 'arbitration' },
  { from: 'k', to: 'm', state: 'verified' },
  { from: 'k', to: 'n', state: 'unconfirmed' },
  { from: 'l', to: 'o', state: 'verified' },
  { from: 'n', to: 'p', state: 'under_review' },
  { from: 'o', to: 'q', state: 'verified' },
];

const byId = new Map(NODES.map((n) => [n.id, n]));

export function HallTree({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 330 470" className={className} aria-hidden="true" focusable="false">
      {Array.from({ length: 8 }, (_, i) => (
        <text key={i} x={8} y={y(i + 1) + 4} className="fill-fg-subtle font-sans text-[12px] font-semibold tabular">
          {i + 1}
        </text>
      ))}
      {LINKS.map((link, i) => {
        const a = byId.get(link.from)!;
        const b = byId.get(link.to)!;
        const y0 = y(a.g) + 8;
        const y1 = y(b.g) - 8;
        const pull = (y1 - y0) * 0.55;
        const curve: Cubic = [
          [a.x, y0],
          [a.x, y0 + pull],
          [b.x, y1 - pull],
          [b.x, y1],
        ];
        const shape = inkShapes(curve, link.state, {
          w0: link.second ? 4.2 : 6.4,
          w1: 1.6,
          n: 26,
          crossLineage: link.cross,
        });
        const color = `var(--${linkStyles[link.cross ? 'cross_lineage' : link.state].strokeColor})`;
        return (
          <g key={i} style={{ color }}>
            <InkShapeSvg shape={shape} />
          </g>
        );
      })}
      {NODES.map((node) =>
        node.founder ? (
          <g key={node.id} fill="var(--fg)">
            <rect x={node.x - 12} y={y(node.g) - 16} width={24} height={3.4} rx={1} />
            <rect x={node.x - 8} y={y(node.g) - 8} width={16} height={16} rx={2} transform={`rotate(4 ${node.x} ${y(node.g)})`} />
          </g>
        ) : node.other ? (
          <circle key={node.id} cx={node.x} cy={y(node.g)} r={6} fill="var(--bg)" stroke="var(--cross-lineage)" strokeWidth={2.2} strokeDasharray="3 2" />
        ) : node.living ? (
          <circle key={node.id} cx={node.x} cy={y(node.g)} r={6} fill="var(--fg)" />
        ) : (
          <circle key={node.id} cx={node.x} cy={y(node.g)} r={5.6} fill="var(--bg)" stroke="var(--fg)" strokeWidth={2} />
        ),
      )}
      <g transform={`translate(${byId.get('n')!.x - 14} ${y(6) + 6})`}>
        <Seal kind="question" size={14} />
      </g>
      <g transform={`translate(${byId.get('n')!.x - 4} ${y(7) + 24})`}>
        <Seal kind="hourglass" size={14} />
      </g>
      <g transform={`translate(${byId.get('l')!.x - 22} ${y(6) - 36})`}>
        <Seal kind="scales" size={14} />
      </g>
      <g transform={`translate(${byId.get('x')!.x + 10} ${y(5) + 6})`}>
        <Seal kind="bridge" size={14} />
      </g>
      {/* A name: never translated (CLAUDE.md §2); React's SVG types do not list `translate`. */}
      <text x={byId.get('a')!.x + 22} y={y(1) - 4} className="fill-fg font-display text-[15px]" lang="en" {...NO_TRANSLATE}>
        Lo Laam-fung
      </text>
      <text x={byId.get('a')!.x + 22} y={y(1) + 11} className="fill-fg-subtle font-sans text-[12px] font-semibold tracking-[0.12em]">
        FOUNDER · 1868
      </text>
      <text x={byId.get('x')!.x - 4} y={y(5) - 14} textAnchor="middle" className="fill-cross-lineage font-sans text-[12px] font-semibold tracking-[0.1em]">
        OTHER HALL
      </text>
    </svg>
  );
}
