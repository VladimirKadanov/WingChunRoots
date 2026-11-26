// GET /events/calendar.ics (ADR 0052; RFC 5545): the calendar feed. A calendar app subscribes to
// this address once (with the filters of /events in its query: country, kind, online or in person,
// a person, a school or an organization) and reads it again from time to time, so new, changed and
// cancelled events reach it by themselves. The upcoming events only, at most FEED_LIMIT, each made
// from its public DTO (events.list, then events.get, read in-process through the oRPC router), so
// nothing a visitor may not see reaches the file. A read that fails answers 503, never an empty
// calendar that would wipe the subscriber's copy.

import { eventFiltersOf, isFiltered } from '@/lib/event-filters';
import { buildIcsFeed } from '@/lib/ics';
import { countryName } from '@/lib/regions';
import { appUrl } from '@/server/auth/env';
import { EVENT_KIND_LABELS } from '@/server/dto/events';
import { failure, lineageClient } from '../../people/[slug]/data';
import { loadEvent } from '../[slug]/data';
import { icsEventOf } from '../ics-event';

/** The most events one feed carries: the first page of the calendar at its largest. */
const FEED_LIMIT = 50;

function unavailable(): Response {
  return new Response('The events could not be loaded. Try again later.\n', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '300' },
  });
}

export async function GET(request: Request): Promise<Response> {
  const f = eventFiltersOf(Object.fromEntries(new URL(request.url).searchParams));
  const client = await lineageClient();
  let slugs: string[];
  try {
    const list = await client.events.list({
      when: 'upcoming',
      country: f.country ?? undefined,
      kind: f.kind ?? undefined,
      format: f.format ?? undefined,
      person: f.person ?? undefined,
      school: f.school ?? undefined,
      organization: f.organization ?? undefined,
      place: f.place ?? undefined,
      limit: FEED_LIMIT,
    });
    slugs = list.items.map((e) => e.slug);
  } catch (error) {
    console.error(`[events-feed] the list could not be loaded: ${failure(error)}`);
    return unavailable();
  }
  const reads = await Promise.all(slugs.map((slug) => loadEvent(slug)));
  if (reads.some((r) => r.state === 'failed')) return unavailable();
  const origin = appUrl();
  // An event removed between the two reads is simply left out.
  const events = reads.flatMap((r) => (r.state === 'found' ? [icsEventOf(r.event, origin)] : []));
  const parts = [
    f.kind ? `${EVENT_KIND_LABELS[f.kind]}s` : null,
    f.format === 'online' ? 'online' : f.format === 'in_person' ? 'in person' : null,
    f.country ? `in ${countryName(f.country) ?? f.country}` : null,
  ].filter(Boolean);
  const name = isFiltered(f) && parts.length > 0 ? `WingChunRoots events: ${parts.join(', ')}` : 'WingChunRoots events';
  return new Response(buildIcsFeed(events, { name, refreshHours: 12 }), {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      // Inline, not an attachment: a calendar app subscribes to the address.
      'content-disposition': 'inline; filename="wingchunroots-events.ics"',
      'cache-control': 'public, no-cache',
      'x-content-type-options': 'nosniff',
    },
  });
}
