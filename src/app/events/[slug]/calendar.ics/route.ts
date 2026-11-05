// GET /events/<slug>/calendar.ics (milestone M17, In scope 5; RFC 5545): "Add to calendar". Made
// from the public DTO of events.get only (read in-process through the oRPC router), so nothing a
// visitor may not see reaches the file; 404 for a removed event, a malformed slug and none alike.
// The file names the city (and the venue line the organizer published), never a school's address.

import { buildIcs } from '@/lib/ics';
import { appUrl } from '@/server/auth/env';
import { loadEvent } from '../data';

function notFound(): Response {
  return new Response('No such event.\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

export async function GET(_request: Request, context: RouteContext<'/events/[slug]/calendar.ics'>): Promise<Response> {
  const { slug } = await context.params;
  const read = await loadEvent(slug);
  if (read.state === 'none') return notFound();
  if (read.state === 'failed') {
    return new Response('The event could not be loaded. Try again later.\n', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
  const { event } = read;
  const origin = appUrl();
  const host = new URL(origin).host;
  const location = event.online ? 'Online' : [event.venue, event.city && event.countryCode ? `${event.city}, ${event.countryCode}` : null].filter(Boolean).join(', ');
  const description = [event.description, event.cancellationNote ? `Cancelled: ${event.cancellationNote}` : null, event.externalUrl].filter(Boolean).join('\n\n');
  const body = buildIcs({
    uid: `${event.id}@${host}`,
    start: new Date(event.startsAt),
    end: new Date(event.endsAt),
    stamp: new Date(event.updatedAt),
    summary: event.title,
    description: description || null,
    location: location || null,
    url: `${origin}/events/${event.slug}`,
    cancelled: event.status === 'cancelled',
    sequence: event.revision,
  });
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="${event.slug}.ics"`,
      'cache-control': 'public, no-cache',
      'x-content-type-options': 'nosniff',
    },
  });
}
