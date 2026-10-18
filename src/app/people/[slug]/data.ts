// The data of a person's pages (milestone M04), read through the oRPC procedures in-process
// (serverClient), so the pages and /api/v1 answer from the same services with the same checks.
// One profile read per request: generateMetadata and the page share it (React cache).

import { headers } from 'next/headers';
import { connection } from 'next/server';
import { cache } from 'react';

import { getRequestPrincipal } from '@/server/auth/web';
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
 * The profile, or null: a missing slug, a malformed one and a person this viewer may not see all
 * end in the same "Not on the record" page (plan §6.4).
 */
export const loadProfile = cache(async (slug: string) => {
  const client = await lineageClient();
  try {
    return await client.people.get({ slug });
  } catch (error) {
    if (error instanceof ORPCError && (error.code === 'NOT_FOUND' || error.code === 'BAD_REQUEST')) return null;
    throw error;
  }
});

/** The profile for a page's params, or null (see loadProfile). */
export async function profileFor(params: Promise<{ slug: string }>) {
  return loadProfile((await params).slug);
}
