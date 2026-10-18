// The settings a production server needs before it serves anything (milestone M02 fix rounds 2
// and 3). src/instrumentation.ts calls startOrExit() once when `next start` starts. A missing or
// unsafe setting ends the process with exit status 1 and one line naming the setting: Next.js
// 16.4 only logs a failed instrumentation hook and keeps listening, answering 500 on every route
// (/healthz too), so a process manager would see a live server (fix round 3, code-1). Outside
// production nothing is checked here: `next dev` keeps starting without .env, and each setting is
// still checked where it is used.

import { mailSealKey } from '../mail/seal';
import { appUrl, authSecret, ipHmacKey, trustedProxies } from './env';
import { proxyList } from './ip';

type Env = Record<string, string | undefined>;

/**
 * Throws when a production environment lacks a setting the accounts module needs: APP_URL (https
 * except on a loopback host), TRUSTED_PROXIES behind a public origin, every entry of it a valid
 * address or CIDR range, and the secrets BETTER_AUTH_SECRET, IP_HMAC_KEY and MAIL_SEAL_KEY.
 */
export function checkProductionSettings(env: Env = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  appUrl(env);
  proxyList(trustedProxies(env));
  authSecret(env);
  ipHmacKey(env);
  mailSealKey(env);
}

/**
 * Runs checkProductionSettings() and, when it refuses, prints only its message (it names the
 * setting, never a value) and exits with status 1.
 */
export function startOrExit(env: Env = process.env, exit: (code: number) => never = process.exit): void {
  try {
    checkProductionSettings(env);
  } catch (error) {
    console.error(`WingChunRoots cannot start: ${error instanceof Error ? error.message : 'a production setting is invalid'}`);
    exit(1);
  }
}
