// The browser's client of the oRPC router (milestone M05; plan §6.8): the same procedures the
// server pages call in-process, over /api/rpc, with TanStack Query helpers. Only the type of the
// router comes from the server code; nothing of it is bundled. Same-origin requests with the
// session cookie (the handler's CSRF check accepts them; src/server/rpc/handler.ts).

import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';

import type { AppRouterClient } from '@/server/rpc/router';

function rpcUrl(): string {
  // Only ever called in the browser (a client island); the server calls the router in-process.
  return `${window.location.origin}/api/rpc`;
}

export const rpcClient: AppRouterClient = createORPCClient(new RPCLink({ url: rpcUrl }));

/** TanStack Query options for every procedure: `orpc.lineage.ego.queryOptions({ input })`. */
export const orpc = createTanstackQueryUtils(rpcClient);
