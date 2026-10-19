// The data of a person's pages (milestone M04), read through the oRPC procedures in-process
// (serverClient), so the pages and /api/v1 answer from the same services with the same checks.
// One profile read per request: generateMetadata and the page share it (React cache).

import { headers } from 'next/headers';
import { connection } from 'next/server';
import { cache } from 'react';

import { getRequestPrincipal } from '@/server/auth/web';
import type { PersonProfileDto } from '@/server/dto/public';
import { ORPCError, serverClient } from '@/server/rpc/server';

/**
 * The router client of this request (the session read once). Request time from here on: the
 * client carries this request's id and session, so nothing below is prerendered.
 */
export const lineageClient = cache(async () => {
  await connection();
  return serverClient(await headers(), await getRequestPrincipal());
});

/**
 * What a person's page shows:
 *   - `found`: the profile;
 *   - `none`: a missing slug, a malformed one and a person this viewer may not see all end in the
 *     same "Not on the record" page, never indexed (plan §6.4, ADR 0008);
 *   - `failed`: the read itself failed (a statement timeout, the database restarting). The page
 *     shows its own error state inside the app shell, never Next.js's error screen.
 */
export type ProfileRead = { state: 'found'; profile: PersonProfileDto } | { state: 'none' } | { state: 'failed' };

/** The reason a read failed, for the server log: a code or an error name, never the data. */
export function failure(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'code' in reason && typeof reason.code === 'string') return reason.code;
  return reason instanceof Error ? reason.name : 'unknown';
}

export const loadProfile = cache(async (slug: string): Promise<ProfileRead> => {
  const client = await lineageClient();
  try {
    return { state: 'found', profile: await client.people.get({ slug }) };
  } catch (error) {
    if (error instanceof ORPCError && (error.code === 'NOT_FOUND' || error.code === 'BAD_REQUEST')) return { state: 'none' };
    console.error(`[person-page] the profile could not be loaded: ${failure(error)}`);
    return { state: 'failed' };
  }
});

/** The profile read for a page's params (see loadProfile), with the slug for a Retry link. */
export async function profileFor(params: Promise<{ slug: string }>): Promise<ProfileRead & { slug: string }> {
  const { slug } = await params;
  return { ...(await loadProfile(slug)), slug };
}
