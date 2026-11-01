import { handleEvidenceDownload } from '@/server/evidence-http';

// GET /api/evidence/<id> (milestone M10a, In scope 3; plan §6.4): an evidence file streamed through
// the app after the check, as an attachment with Cache-Control: no-store and nosniff; 404 for
// everyone not allowed. No presigned address exists (src/server/evidence-http.ts).
export async function GET(request: Request, context: RouteContext<'/api/evidence/[id]'>): Promise<Response> {
  const { id } = await context.params;
  return handleEvidenceDownload(request, id);
}
