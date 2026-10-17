// The Better Auth HTTP API under /api/auth (milestone M02): sign-up, sign-in, e-mail confirmation,
// password reset and two-factor authentication, for the web forms (through Server Actions) and for
// a native client (bearer tokens in `set-auth-token` and `Authorization: Bearer`).

import { getAuth } from './config';

export function handleAuthRequest(request: Request): Promise<Response> {
  return getAuth().handler(request);
}
