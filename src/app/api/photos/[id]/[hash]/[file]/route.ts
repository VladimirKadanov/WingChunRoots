import { handlePhotoRequest } from '@/server/photo-http';

// GET /api/photos/<id>/<hash>/<size>.webp (milestone M14; docs/adr/0016-profile-photos.md): one
// rendition of a person's current profile photo, streamed after the visibility check; 404 for a
// person this viewer may not see, the same as for no such photo (src/server/photo-http.ts).
export async function GET(request: Request, context: RouteContext<'/api/photos/[id]/[hash]/[file]'>): Promise<Response> {
  const params = await context.params;
  return handlePhotoRequest(request, params);
}
