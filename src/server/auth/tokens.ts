// What a confirmation link's token says (milestone M02). Better Auth's e-mail confirmation token is
// a signed JWT; these claims are read WITHOUT checking the signature, so they only ever narrow what
// happens (refuse a stale link, prefill the sign-in form after the endpoint confirmed the address),
// never grant anything.

export interface ConfirmationClaims {
  email?: unknown;
  iat?: unknown;
}

/** The unchecked claims of a confirmation token, or null when it is not a JWT. */
export function confirmationClaims(token: string): ConfirmationClaims | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return value && typeof value === 'object' ? (value as ConfirmationClaims) : null;
  } catch {
    return null;
  }
}

/** The address a confirmation token names, in lower case, or null. */
export function confirmationEmail(token: string): string | null {
  const email = confirmationClaims(token)?.email;
  return typeof email === 'string' && email.length <= 254 ? email.toLowerCase() : null;
}
