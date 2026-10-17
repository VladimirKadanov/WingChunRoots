import { handleApiRequest } from '@/server/rpc/handler';

// The same router as an OpenAPI (REST) API for the future native app (plan §6.8).
const handle = (request: Request) => handleApiRequest(request, 'openapi');

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
