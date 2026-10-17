// Settings of the accounts module (milestone M02), from the environment (.env.example lists the
// names; scripts/init-env.sh generates local values, cloud sessions and CI throwaway ones).

type Env = Record<string, string | undefined>;

const DEFAULT_APP_URL = 'http://localhost:3000';
const MIN_SECRET_LENGTH = 32;

/** The public origin of the app (links in e-mail, trusted origin), without a trailing slash. */
export function appUrl(env: Env = process.env): string {
  const raw = env.APP_URL || DEFAULT_APP_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('APP_URL is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('APP_URL must be an http(s) URL');
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('APP_URL must be an origin, without a path');
  return url.origin;
}

function secret(name: string, env: Env): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set (local: scripts/init-env.sh; cloud: scripts/cloud-setup.sh)`);
  if (value.length < MIN_SECRET_LENGTH) throw new Error(`${name} must have at least ${MIN_SECRET_LENGTH} characters`);
  return value;
}

/** Signs session cookies and encrypts the TOTP secrets (Better Auth `secret`). */
export function authSecret(env: Env = process.env): string {
  return secret('BETTER_AUTH_SECRET', env);
}

/** Key of ip_hmac (plan §6.4). */
export function ipHmacKey(env: Env = process.env): string {
  return secret('IP_HMAC_KEY', env);
}
