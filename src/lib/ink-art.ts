// Drawn banner art (docs/adr/0052-public-page-redesign.md): when a school, an organization or an
// event has no banner of its own, the server draws an ink motif from its slug. Pure TypeScript
// (no React, DOM or Next.js), so the same slug always gives the same drawing on the web, in the
// Open Graph image and in a future mobile app; no image file and no JavaScript reach the browser.
//
// A drawing is a list of shapes in a 640 × 360 view box, each painted in one of the art tones
// (src/design/tokens.ts, `art-*`): decorative ink and paper, never a state, never text. The
// component (src/components/ink/ink-art.tsx) scales it to cover its frame.

export const ART_MOTIFS = ['hills', 'enso', 'dummy', 'peaks', 'lattice', 'roots', 'rings'] as const;
export type ArtMotif = (typeof ART_MOTIFS)[number];

export type ArtTone = 'far' | 'mid' | 'near' | 'line' | 'ink';

export type ArtShape =
  | { kind: 'path'; d: string; fill?: ArtTone; stroke?: ArtTone; width?: number; dash?: string }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill?: ArtTone; stroke?: ArtTone; width?: number; dash?: string }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rx?: number; fill?: ArtTone; stroke?: ArtTone; width?: number };

export interface ArtDrawing {
  motif: ArtMotif;
  /** The lattice motif's tile, drawn as an SVG pattern; null for the others. */
  tile: { size: number; d: string } | null;
  shapes: ArtShape[];
}

export const ART_WIDTH = 640;
export const ART_HEIGHT = 360;

/** FNV-1a, 32 bits: a stable number from a slug. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A small deterministic generator (mulberry32) seeded from the slug. */
function random(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** A soft ridge across the frame: `points` heights joined with smooth curves, closed at the bottom. */
function ridge(rand: () => number, base: number, swing: number, points = 5): string {
  const step = ART_WIDTH / (points - 1);
  const ys = Array.from({ length: points }, () => round(base + (rand() - 0.5) * 2 * swing));
  let d = `M0 ${ys[0]}`;
  for (let i = 1; i < points; i++) {
    const x0 = (i - 1) * step;
    const x1 = i * step;
    d += ` C${round(x0 + step / 2)} ${ys[i - 1]} ${round(x1 - step / 2)} ${ys[i]} ${round(x1)} ${ys[i]}`;
  }
  return `${d} L${ART_WIDTH} ${ART_HEIGHT} L0 ${ART_HEIGHT}Z`;
}

function hills(rand: () => number): ArtShape[] {
  // The sun keeps clear of the left corner, where a page lays its back link.
  const sunX = round(300 + rand() * 260);
  return [
    { kind: 'circle', cx: sunX, cy: round(120 + rand() * 30), r: round(32 + rand() * 12), stroke: 'line', width: 2 },
    { kind: 'path', d: ridge(rand, 170, 40), fill: 'far' },
    { kind: 'path', d: ridge(rand, 235, 26), fill: 'mid' },
    { kind: 'path', d: ridge(rand, 295, 14), fill: 'near' },
  ];
}

function enso(rand: () => number): ArtShape[] {
  const cx = round(250 + rand() * 140);
  const cy = 180;
  const r = 100;
  // The gap of the brush circle turns with the slug.
  const start = rand() * Math.PI * 2;
  const end = start + Math.PI * 1.72;
  const p = (a: number) => `${round(cx + r * Math.cos(a))} ${round(cy + r * Math.sin(a))}`;
  const tail = end + 0.18;
  return [
    { kind: 'path', d: `M${p(start)} A${r} ${r} 0 1 1 ${p(end)}`, stroke: 'ink', width: 18 },
    { kind: 'path', d: `M${p(end)} A${r} ${r} 0 0 1 ${p(tail)}`, stroke: 'ink', width: 7 },
    { kind: 'path', d: `M0 ${ART_HEIGHT - 40} H${ART_WIDTH}`, stroke: 'far', width: 2 },
  ];
}

function dummy(rand: () => number): ArtShape[] {
  const x = round(140 + rand() * 340);
  return [
    { kind: 'path', d: `M0 300 H${ART_WIDTH}`, stroke: 'near', width: 2 },
    { kind: 'rect', x, y: 60, w: 44, h: 240, rx: 10, fill: 'mid' },
    { kind: 'path', d: `M${x + 2} 118 L${x - 62} 100 M${x + 42} 118 L${x + 106} 100`, stroke: 'ink', width: 12 },
    { kind: 'circle', cx: x + 22, cy: 168, r: 10, fill: 'ink' },
    { kind: 'path', d: `M${x + 22} 236 L${x + 72} 280 L${x + 108} 282`, stroke: 'ink', width: 12 },
  ];
}

function peaks(rand: () => number): ArtShape[] {
  const tent = round(200 + rand() * 240);
  const a = round(100 + rand() * 60);
  const b = round(60 + rand() * 50);
  return [
    { kind: 'path', d: `M0 250 L160 ${a + 40} L260 210 L380 ${b + 30} L520 220 L640 160 L640 360 L0 360Z`, fill: 'far' },
    { kind: 'path', d: 'M0 300 L200 230 L360 290 L520 240 L640 280 L640 360 L0 360Z', fill: 'near' },
    { kind: 'path', d: `M${tent} 300 L${tent + 40} 240 L${tent + 80} 300Z`, stroke: 'ink', width: 5 },
  ];
}

const LATTICES = [
  'M2 2H54V54H2Z M16 16H40V40H16Z M28 2V16 M28 40V54 M2 28H16 M40 28H54',
  'M2 2H54V54H2Z M2 28H54 M28 2V54 M15 15H41V41H15Z',
  'M2 2H54V54H2Z M28 2L54 28L28 54L2 28Z',
  'M2 2H54V54H2Z M14 2V54 M42 2V54 M2 14H54 M2 42H54',
  'M2 2H54V54H2Z M2 2L54 54 M54 2L2 54 M18 18H38V38H18Z',
];

function roots(rand: () => number): ArtShape[] {
  const cx = round(240 + rand() * 160);
  const spread = round(100 + rand() * 50);
  const l = cx - spread;
  const r = cx + spread;
  return [
    { kind: 'path', d: `M${cx} 0 V80`, stroke: 'line', width: 3 },
    { kind: 'path', d: `M${cx} 80 C${cx} 120 ${l} 120 ${l} 160 V360 M${cx} 80 C${cx} 120 ${r} 120 ${r} 160 V360 M${cx} 80 V360`, stroke: 'line', width: 3 },
    { kind: 'path', d: `M${l} 160 C${l} 200 ${l - 80} 200 ${l - 80} 360 M${r} 160 C${r} 200 ${r + 80} 200 ${r + 80} 360 M${r} 180 C${r} 210 ${r - 40} 220 ${r - 40} 360`, stroke: 'line', width: 3 },
    { kind: 'circle', cx, cy: 80, r: 8, fill: 'ink' },
    { kind: 'circle', cx: l, cy: 160, r: 6, fill: 'ink' },
    { kind: 'circle', cx: r, cy: 160, r: 6, fill: 'ink' },
  ];
}

function rings(rand: () => number): ArtShape[] {
  const cx = round(220 + rand() * 200);
  return [
    { kind: 'circle', cx, cy: 180, r: 40, stroke: 'line', width: 2 },
    { kind: 'circle', cx, cy: 180, r: 80, stroke: 'near', width: 2, dash: '6 8' },
    { kind: 'circle', cx, cy: 180, r: 124, stroke: 'mid', width: 2, dash: '3 9' },
    { kind: 'circle', cx, cy: 180, r: 10, fill: 'ink' },
  ];
}

/** The drawing of `slug` in `motif`: the same input always gives the same drawing. */
export function drawArt(slug: string, motif: ArtMotif): ArtDrawing {
  const seed = seedOf(`${motif}:${slug}`);
  const rand = random(seed);
  switch (motif) {
    case 'hills':
      return { motif, tile: null, shapes: hills(rand) };
    case 'enso':
      return { motif, tile: null, shapes: enso(rand) };
    case 'dummy':
      return { motif, tile: null, shapes: dummy(rand) };
    case 'peaks':
      return { motif, tile: null, shapes: peaks(rand) };
    case 'roots':
      return { motif, tile: null, shapes: roots(rand) };
    case 'rings':
      return { motif, tile: null, shapes: rings(rand) };
    case 'lattice':
      return { motif, tile: { size: 56, d: LATTICES[seed % LATTICES.length]! }, shapes: [] };
  }
}

/** The motif of an event by its kind; an online event is drawn as rings. */
export function eventMotif(kind: 'seminar' | 'camp' | 'exam_session' | 'other', online: boolean): ArtMotif {
  if (online) return 'rings';
  switch (kind) {
    case 'seminar':
      return 'hills';
    case 'camp':
      return 'peaks';
    case 'exam_session':
      return 'dummy';
    case 'other':
      return 'enso';
  }
}

/** The motif of an organization by its kind: a group of schools grows roots, the others a lattice. */
export function organizationMotif(kind: 'federation' | 'association' | 'school_group'): ArtMotif {
  return kind === 'school_group' ? 'roots' : 'lattice';
}

/** Up to two initials of a name for a monogram crest ("Demo Wing Chun Hall Sofia" → "WS"). */
export function monogram(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, ' ')
    .split(/[\s\-–—:,.]+/)
    .filter((w) => w.length > 0 && !/^(demo|the|of|and|for|de|la|der|die|das)$/i.test(w));
  const letters = words.map((w) => [...w][0]!.toUpperCase()).filter((c) => /\p{L}|\p{N}/u.test(c));
  if (letters.length === 0) return '?';
  if (letters.length === 1) return letters[0]!;
  return `${letters[0]}${letters[letters.length - 1]}`;
}
