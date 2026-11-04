import { handlePhotoRequest } from '@/server/photo-http';

// GET /api/event-posters/<id>/<hash>/<size>.webp (milestone M17; docs/adr/0020-events.md): one
// rendition of an event's poster (96, 512 or `full`) while the event is public (published or
// cancelled); 404 for a removed event, a replaced poster or a wrong hash (src/server/photo-http.ts).
export async function GET(request: Request, context: RouteContext<'/api/event-posters/[id]/[hash]/[file]'>): Promise<Response> {
  const params = await context.params;
  return handlePhotoRequest(request, params, { kind: 'event' });
}
