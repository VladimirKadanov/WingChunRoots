// Settings of the accounts module (milestone M02), from the environment (.env.example lists the
// names; scripts/init-env.sh generates local values, cloud sessions and CI throwaway ones).

type Env = Record<string, string | undefined>;

const DEFAULT_APP_URL = 'http://localhost:3000';
const MIN_SECRET_LENGTH = 32;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const isProduction = (env: Env) => env.NODE_ENV === 'production';

function isLoopback(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname) || url.hostname.endsWith('.localhost');
}

/**
 * The public origin of the app (links in e-mail, trusted origin), without a trailing slash. In
 * production APP_URL is required and must be https, except on a loopback host (`next start` on
 * this machine, the E2E tests): a missing or plain-http origin would put wrong or interceptable
 * links into account e-mails.
 */
export function appUrl(env: Env = process.env): string {
  if (isProduction(env) && !env.APP_URL) throw new Error('APP_URL is not set (required in production)');
  const raw = env.APP_URL || DEFAULT_APP_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('APP_URL is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('APP_URL must be an http(s) URL');
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('APP_URL must be an origin, without a path');
  if (isProduction(env) && url.protocol !== 'https:' && !isLoopback(url)) {
    throw new Error('APP_URL must be https in production (http only on a loopback host)');
  }
  return url.origin;
}

/**
 * TRUSTED_PROXIES: comma-separated IP addresses or CIDR ranges of the reverse proxies in front of
 * the app (src/server/auth/ip.ts). Empty without one. In production behind a public (non-loopback)
 * origin it is required: without a proxy that appends the real client address, X-Forwarded-For is
 * whatever the client sent and per-address limits mean nothing.
 */
export function trustedProxies(env: Env = process.env): string[] {
  const entries = (env.TRUSTED_PROXIES ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0 && isPublicDeployment(env)) {
    throw new Error('TRUSTED_PROXIES is not set (required in production behind a public APP_URL)');
  }
  return entries;
}

/** True when APP_URL (or its development default) names a loopback host (M04: the test fault switch). */
export function hasLoopbackAppUrl(env: Env = process.env): boolean {
  return isLoopback(new URL(appUrl(env)));
}

/**
 * A production server behind a public origin (not `next start` on a loopback host, which the E2E
 * tests use): the demo accounts cannot sign in there, and TRUSTED_PROXIES is required.
 */
export function isPublicDeployment(env: Env = process.env): boolean {
  return isProduction(env) && !isLoopback(new URL(appUrl(env)));
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

/** Key of ip_hmac (plan §6.4) and of the throttle keys. */
export function ipHmacKey(env: Env = process.env): string {
  return secret('IP_HMAC_KEY', env);
}
