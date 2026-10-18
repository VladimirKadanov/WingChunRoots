// The Better Auth HTTP API under /api/auth (milestone M02): sign-up, sign-in, e-mail confirmation,
// password reset and two-factor authentication, for the web forms (through Server Actions) and for
// a native client (bearer tokens in `set-auth-token` and `Authorization: Bearer`).
//
// Better Auth sees X-Forwarded-For as the one client address clientIp() resolved (ip.ts), so its
// rate limiter, the session's ip_hmac and the audit log agree, and a client cannot pick a new
// address per request by adding entries to the header.

import { getAuth } from './config';
import { withClientIp } from './ip';

export function handleAuthRequest(request: Request): Promise<Response> {
  return getAuth().handler(new Request(request, { headers: withClientIp(request.headers) }));
}
