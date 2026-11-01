// The data of a school's page and its Open Graph image (milestone M11, In scope 7 and 8): the public
// DTO of schools.get, read in-process through the oRPC router (the same procedure as /api/v1),
// once per request (React cache). Only that DTO feeds the page, its JSON-LD and its image, so a
// city-only school's exact point can reach none of them (plan §6.4).

import { cache } from 'react';

import type { SchoolPageDto } from '@/server/dto/schools';
import { ORPCError } from '@/server/rpc/server';
import { failure, lineageClient } from '../../people/[slug]/data';

export type SchoolRead = { state: 'found'; school: SchoolPageDto } | { state: 'none' } | { state: 'failed' };

export const loadSchool = cache(async (slug: string): Promise<SchoolRead> => {
  const client = await lineageClient();
  try {
    return { state: 'found', school: await client.schools.get({ slug }) };
  } catch (error) {
    if (error instanceof ORPCError && (error.code === 'NOT_FOUND' || error.code === 'BAD_REQUEST')) return { state: 'none' };
    console.error(`[school-page] the school could not be loaded: ${failure(error)}`);
    return { state: 'failed' };
  }
});

/** "Exact location" or "Private club, by invitation", with the city. */
export function locationLine(school: Pick<SchoolPageDto, 'precision' | 'city' | 'countryCode'>): string {
  return school.precision === 'exact' ? `${school.city}, ${school.countryCode} · Exact location` : `${school.city}, ${school.countryCode} · Private club, by invitation (city only)`;
}
