import { handlePhotoRequest } from '@/server/photo-http';

// GET /api/school-photos/<id>/<hash>/<size>.webp (milestone M16; docs/adr/0019-galleries.md): one
// rendition of a school's logo or room photo (96, 512 or `full`), after the visibility check: a
// public school's for everyone, a school that is not public only for the account that listed it
// and staff with a verified second factor; 404 for everything else (src/server/photo-http.ts).
export async function GET(request: Request, context: RouteContext<'/api/school-photos/[id]/[hash]/[file]'>): Promise<Response> {
  const params = await context.params;
  return handlePhotoRequest(request, params, { kind: 'school' });
}
