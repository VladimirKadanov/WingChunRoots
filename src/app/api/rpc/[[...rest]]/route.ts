import { handleApiRequest } from '@/server/rpc/handler';

// The oRPC router for the web client (plan §6.8; src/server/rpc/router.ts).
const handle = (request: Request) => handleApiRequest(request, 'rpc');

export const GET = handle;
export const POST = handle;
