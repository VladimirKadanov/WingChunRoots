// Demo content of the home page (DEFAULT D20): clearly fictional people, a fictional hall and
// fictional links, invented for this page. Slugs start with `demo-`. Nothing here describes a
// real person, lineage, date or rank. The real record comes from the database (M04).

import type { VerificationState } from '@/design/tokens';

export interface DemoName {
  text: string;
  /** BCP 47 language tag of the name (plan §5.3). */
  lang: 'zh-Hant' | 'zh-Hans' | 'bg';
}

export interface DemoPerson {
  slug: `demo-${string}`;
  /** Latin-script display name (mandatory, plan §5.3). */
  name: string;
  original?: DemoName;
  /** Jyutping, searchable but not shown. */
  jyutping?: string;
  city: string;
  role: 'Founder' | 'Sifu' | 'Student';
  /** Year this person began training. */
  startYear: number;
  living: boolean;
}

export interface DemoLink {
  teacher: DemoPerson['slug'];
  student: DemoPerson['slug'];
  state: VerificationState;
}

export const DEMO_LINE: DemoPerson[] = [
  { slug: 'demo-lo-laam-fung', name: 'Lo Laam-fung', original: { text: '盧嵐峰', lang: 'zh-Hant' }, jyutping: 'lou4 laam4 fung1', city: 'Foshan', role: 'Founder', startYear: 1868, living: false },
  { slug: 'demo-mak-kai-chung', name: 'Mak Kai-chung', original: { text: '麥溪松', lang: 'zh-Hant' }, jyutping: 'mak6 kai1 cung4', city: 'Foshan', role: 'Sifu', startYear: 1891, living: false },
  { slug: 'demo-so-chuk-ching', name: 'So Chuk-ching', original: { text: '蘇竹晴', lang: 'zh-Hant' }, jyutping: 'sou1 zuk1 cing4', city: 'Hong Kong', role: 'Sifu', startYear: 1916, living: false },
  { slug: 'demo-fung-lam-chau', name: 'Fung Lam-chau', original: { text: '馮霖舟', lang: 'zh-Hant' }, jyutping: 'fung4 lam4 zau1', city: 'Hong Kong', role: 'Sifu', startYear: 1949, living: false },
  { slug: 'demo-dieter-fauxberg', name: 'Dieter Fauxberg', city: 'Vienna', role: 'Sifu', startYear: 1974, living: true },
  { slug: 'demo-stefan-primerov', name: 'Stefan Primerov', original: { text: 'Стефан Примеров', lang: 'bg' }, city: 'Sofia', role: 'Sifu', startYear: 1996, living: true },
  { slug: 'demo-mira-probnova', name: 'Mira Probnova', original: { text: 'Мира Пробнова', lang: 'bg' }, city: 'Sofia', role: 'Sifu', startYear: 2009, living: true },
  { slug: 'demo-georgi-maketov', name: 'Georgi Maketov', original: { text: 'Георги Макетов', lang: 'bg' }, city: 'Sofia', role: 'Student', startYear: 2019, living: true },
];

/** The link from each person to the next one in DEMO_LINE. */
export const DEMO_LINE_LINKS: DemoLink[] = DEMO_LINE.slice(1).map((student, i) => ({
  teacher: DEMO_LINE[i]!.slug,
  student: student.slug,
  state: student.slug === 'demo-georgi-maketov' ? 'under_review' : 'verified',
}));

export const DEMO_HALL = {
  slug: 'demo-jade-lantern-hall',
  name: 'Jade Lantern Hall',
  original: { text: '玉燈堂', lang: 'zh-Hant' } satisfies DemoName,
  romanization: 'Yuk Dang Tong',
  founded: 1868,
  origin: 'Foshan',
  people: 24,
  generations: 8,
  verifiedLinks: 19,
  links: 23,
} as const;

/** Lower-case, without accents, tone numbers, spaces or hyphens: "Laam fung" matches "Laam-fung". */
export function normalizeQuery(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\d\s\-‐-―'’·.]/g, '');
}

/** Demo search over the line: Latin name, original script, Jyutping or city. */
export function searchDemoLine(query: string): DemoPerson[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  return DEMO_LINE.filter((person) =>
    [person.name, person.original?.text ?? '', person.jyutping ?? '', person.city].some((field) => normalizeQuery(field).includes(q)),
  );
}
