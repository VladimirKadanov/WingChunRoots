import { handlePhotoRequest } from '@/server/photo-http';

// GET /api/organization-photos/<id>/<hash>/<size>.webp (ADR 0052): one rendition of an
// organization's logo or banner (96, 512 or `full`), after the visibility check: an approved
// organization's for everyone, one that is not approved only for its admins and staff with a
// verified second factor; 404 for everything else (src/server/photo-http.ts).
export async function GET(request: Request, context: RouteContext<'/api/organization-photos/[id]/[hash]/[file]'>): Promise<Response> {
  const params = await context.params;
  return handlePhotoRequest(request, params, { kind: 'organization' });
}
