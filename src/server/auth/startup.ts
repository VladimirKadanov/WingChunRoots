// The settings a production server needs before it serves anything (milestone M02 fix round 2).
// src/instrumentation.ts calls checkProductionSettings() once when `next start` starts, so a
// misconfigured server exits at start instead of answering 500 on every account route later.
// Outside production nothing is checked here: `next dev` keeps starting without .env, and each
// setting is still checked where it is used.

import { mailSealKey } from '../mail/seal';
import { appUrl, authSecret, ipHmacKey, trustedProxies } from './env';

type Env = Record<string, string | undefined>;

/**
 * Throws when a production environment lacks a setting the accounts module needs: APP_URL (https
 * except on a loopback host), TRUSTED_PROXIES behind a public origin, and the secrets
 * BETTER_AUTH_SECRET, IP_HMAC_KEY and MAIL_SEAL_KEY.
 */
export function checkProductionSettings(env: Env = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  appUrl(env);
  trustedProxies(env);
  authSecret(env);
  ipHmacKey(env);
  mailSealKey(env);
}
