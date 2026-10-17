// The oRPC context of a request (milestone M02, In scope 3): the principal from the session cookie
// or from `Authorization: Bearer`, and the request id and ip_hmac for the audit log.

import { principalFromHeaders } from '../auth/session';
import { requestMeta } from '../services/context';
import type { RpcContext } from './router';

export async function createContext(headers: Headers): Promise<RpcContext> {
  return { principal: await principalFromHeaders(headers), meta: requestMeta(headers) };
}
