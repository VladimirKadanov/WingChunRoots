import { handleAuthRequest } from '@/server/auth/route';

// Better Auth's HTTP API (src/server/auth/config.ts; docs/adr/0004-auth.md).
export const GET = (request: Request) => handleAuthRequest(request);
export const POST = (request: Request) => handleAuthRequest(request);
