// The principal of a request (milestone M02, In scope 3): Better Auth reads the session from the
// session cookie or, through the bearer plugin, from `Authorization: Bearer <token>`. Pages, the
// oRPC context and Server Actions all come through here, so the guards see the same principal for
// a browser and for a future native client.

import { getAuth } from './config';
import { isRole, type Principal } from './principal';

function hasBearer(headers: Headers): boolean {
  return /^bearer\s/i.test(headers.get('authorization') ?? '');
}

/** The principal for these request headers, or null without a valid session. */
export async function principalFromHeaders(headers: Headers): Promise<Principal | null> {
  // disableRefresh: reading a page or calling a procedure does not extend the session.
  const result = await getAuth()
    .api.getSession({ headers, query: { disableRefresh: true } })
    .catch(() => null);
  if (!result) return null;
  const { user, session } = result;
  const verifiedAt = (session as { twoFactorVerifiedAt?: unknown }).twoFactorVerifiedAt;
  return {
    user: {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      role: isRole(user.role) ? user.role : 'user',
      twoFactorEnabled: (user as { twoFactorEnabled?: unknown }).twoFactorEnabled === true,
    },
    session: {
      id: session.id,
      expiresAt: new Date(session.expiresAt),
      twoFactorVerifiedAt: verifiedAt ? new Date(verifiedAt as string | Date) : null,
    },
    via: hasBearer(headers) ? 'bearer' : 'cookie',
  };
}
