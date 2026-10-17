// The router called in-process (plan §6.8): Server Actions call the procedures through this
// client, with the context of the current request, so a form and an API call run the same
// procedure, the same checks and the same services.

import { createRouterClient } from '@orpc/server';

import { createContext } from './context';
import { router } from './router';

export function serverClient(headers: Headers) {
  return createRouterClient(router, { context: () => createContext(headers) });
}

export { ORPCError } from '@orpc/server';
export type { Router } from './router';
