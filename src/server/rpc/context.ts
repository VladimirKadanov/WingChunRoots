// The oRPC context of a request (milestone M02, In scope 3): the principal from the session cookie
// or from `Authorization: Bearer`, and the request id and ip_hmac for the audit log.

import type { Principal } from '../auth/principal';
import { principalFromHeaders } from '../auth/session';
import { requestMeta } from '../services/context';
import type { RpcContext } from './router';

/** The context of `headers`; a `principal` the caller already read is used as is. */
export async function createContext(headers: Headers, principal?: Principal | null): Promise<RpcContext> {
  return { principal: principal === undefined ? await principalFromHeaders(headers) : principal, meta: requestMeta(headers) };
}
