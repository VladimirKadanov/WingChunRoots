// The data of an event's page and its calendar file (milestone M17): the public DTO of events.get,
// read in-process through the oRPC router (the same procedure as /api/v1), once per request
// (React cache). Only that DTO feeds the page, its JSON-LD and its .ics file (plan §6.4).

import { cache } from 'react';

import type { EventPageDto } from '@/server/dto/events';
import { ORPCError } from '@/server/rpc/server';
import { failure, lineageClient } from '../../people/[slug]/data';

export type EventRead = { state: 'found'; event: EventPageDto } | { state: 'none' } | { state: 'failed' };

export const loadEvent = cache(async (slug: string): Promise<EventRead> => {
  const client = await lineageClient();
  try {
    return { state: 'found', event: await client.events.get({ slug }) };
  } catch (error) {
    if (error instanceof ORPCError && (error.code === 'NOT_FOUND' || error.code === 'BAD_REQUEST')) return { state: 'none' };
    console.error(`[event-page] the event could not be loaded: ${failure(error)}`);
    return { state: 'failed' };
  }
});
