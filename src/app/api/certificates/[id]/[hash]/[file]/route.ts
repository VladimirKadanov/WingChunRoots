import { handlePhotoRequest } from '@/server/photo-http';

// GET /api/certificates/<id>/<hash>/<size>.webp (milestone M19; docs/adr/0022-passport.md): one
// rendition of a passport's scanned certificate (96, 512 or `full`), read through the app from the
// private store after the check of openCertificate (src/server/services/passport.ts): everyone while
// the profile shows it (public entry, public person, a plan with the full passport); otherwise only
// its student and their teachers; 404 for everything else, one answer for all. Never a presigned
// address (plan §6.4).
export async function GET(request: Request, context: RouteContext<'/api/certificates/[id]/[hash]/[file]'>): Promise<Response> {
  const params = await context.params;
  return handlePhotoRequest(request, params, { kind: 'certificate' });
}
