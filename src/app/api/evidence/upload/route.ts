import { handleEvidenceUpload } from '@/server/evidence-http';

// POST /api/evidence/upload (milestone M10a, In scope 2; plan §6.1, §6.4): one evidence file per
// request, refused over 20 MB before its body is read. Outside the matcher of src/proxy.ts, so the
// body arrives whole and unbuffered (src/server/evidence-http.ts).
export function POST(request: Request): Promise<Response> {
  return handleEvidenceUpload(request);
}
