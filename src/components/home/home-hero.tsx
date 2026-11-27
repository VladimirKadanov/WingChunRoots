// The home page's hero (journey review 2026-11-26, P1-4; ADR 0078): the living line of a real
// public lineage, from lineage.home (the lineage chosen in the control panel, or today's in the
// rotation), each name a link to the profile. The home page stays prerendered: this part reads per
// request and streams in behind <Suspense>, with HeroFallback (the headline and the search, the
// line still loading) in its place until then. With no public lineage yet, the fictional demo line.

import { headers } from 'next/headers';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import { relationStatus } from '@/components/lineage/status';
import type { HomeLineDto } from '@/server/dto/home';
import { getRequestPrincipal } from '@/server/auth/web';
import { serverClient } from '@/server/rpc/server';
import { DEMO_HERO, type HeroLine } from './demo-lineage';
import { LivingLine } from './living-line';

/** The line as the hero draws it; null when lineage.home has no line. */
export function heroOf(dto: HomeLineDto): HeroLine | null {
  if (!dto.lineage || dto.people.length < 2) return null;
  const lineage = dto.lineage;
  return {
    people: dto.people.map((p, i) => ({
      key: p.slug,
      href: `/people/${p.slug}`,
      name: p.displayName,
      ...(p.original ? { original: p.original } : {}),
      meta: [p.city, i === 0 ? 'Founder (as recorded)' : p.students > 0 ? 'Teacher' : 'Student'].filter(Boolean).join(' · '),
      startYear: p.startYear,
      living: p.living,
    })),
    states: dto.links.map((l) => (l.status === 'in_arbitration' ? 'arbitration' : 'verified')),
    words: dto.links.map((l) => relationStatus(l.status, l.certainty).label),
    caption: lineage.name,
    demo: false,
    explore: { href: `/explore?focus=${dto.people[0]!.id}&lineage=${lineage.id}`, name: lineage.name },
  };
}

type HeroProps = { heading: ReactNode; lede: ReactNode; actions?: ReactNode };

export function HeroFallback(props: HeroProps) {
  return <LivingLine {...props} line={null} />;
}

export async function HomeHero(props: HeroProps) {
  await connection();
  let line: HeroLine = DEMO_HERO;
  try {
    line = heroOf(await serverClient(await headers(), await getRequestPrincipal()).lineage.home()) ?? DEMO_HERO;
  } catch (error) {
    console.error(`[home] the home line could not be loaded: ${error instanceof Error ? error.name : 'unknown'}`);
  }
  return <LivingLine {...props} line={line} />;
}
