// The start-up check of a production server (src/server/auth/startup.ts, src/instrumentation.ts).

import { describe, expect, it, vi } from 'vitest';

import { register } from '../../instrumentation';
import { checkProductionSettings, startOrExit } from './startup';

const SECRET = 'x'.repeat(40);
const complete = {
  NODE_ENV: 'production',
  APP_URL: 'https://wingchunroots.example',
  TRUSTED_PROXIES: '10.0.0.1',
  BETTER_AUTH_SECRET: SECRET,
  IP_HMAC_KEY: SECRET,
  MAIL_SEAL_KEY: SECRET,
};

describe('checkProductionSettings', () => {
  it('passes a complete production environment, and checks nothing outside production', () => {
    expect(() => checkProductionSettings(complete)).not.toThrow();
    expect(() => checkProductionSettings({})).not.toThrow();
    expect(() => checkProductionSettings({ NODE_ENV: 'development' })).not.toThrow();
  });

  it('refuses each missing or unsafe setting', () => {
    const without = (name: keyof typeof complete) => {
      const env: Record<string, string> = { ...complete };
      delete env[name];
      return env;
    };
    expect(() => checkProductionSettings(without('APP_URL'))).toThrow(/APP_URL is not set/);
    expect(() => checkProductionSettings({ ...complete, APP_URL: 'http://wingchunroots.example' })).toThrow(/https/);
    expect(() => checkProductionSettings(without('TRUSTED_PROXIES'))).toThrow(/TRUSTED_PROXIES/);
    expect(() => checkProductionSettings(without('BETTER_AUTH_SECRET'))).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => checkProductionSettings(without('IP_HMAC_KEY'))).toThrow(/IP_HMAC_KEY/);
    expect(() => checkProductionSettings({ ...complete, MAIL_SEAL_KEY: 'short' })).toThrow(/MAIL_SEAL_KEY/);
  });

  it('refuses a TRUSTED_PROXIES entry that is not an address or a CIDR range (fix round 3)', () => {
    // Before, only the first request that needed the client address failed: every auth and rpc
    // route answered 500 while the static pages worked.
    expect(() => checkProductionSettings({ ...complete, TRUSTED_PROXIES: '10.0.0.0/33' })).toThrow(/TRUSTED_PROXIES: "10.0.0.0\/33"/);
    expect(() => checkProductionSettings({ ...complete, TRUSTED_PROXIES: '10.0.0.1, proxy.internal' })).toThrow(/"proxy.internal"/);
    expect(() => checkProductionSettings({ ...complete, TRUSTED_PROXIES: '10.0.0.0/8, 2001:db8::/32' })).not.toThrow();
  });

  it('lets `next start` on a loopback host run without TRUSTED_PROXIES (the E2E tests)', () => {
    const loopback: Record<string, string> = { ...complete, APP_URL: 'http://127.0.0.1:3100' };
    delete loopback.TRUSTED_PROXIES;
    expect(() => checkProductionSettings(loopback)).not.toThrow();
  });
});

describe('startOrExit', () => {
  it('exits with status 1 and prints only the message naming the setting (fix round 3)', () => {
    // Next.js 16.4 logs a failed instrumentation hook and keeps listening (500 on every route).
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.fn((code: number) => {
      throw new Error(`exit ${code}`);
    }) as unknown as (code: number) => never;
    try {
      expect(() => startOrExit({ ...complete, BETTER_AUTH_SECRET: 'short' }, exit)).toThrow('exit 1');
      expect(exit).toHaveBeenCalledWith(1);
      expect(error).toHaveBeenCalledTimes(1);
      const line = String(error.mock.calls[0]?.[0]);
      expect(line).toMatch(/^WingChunRoots cannot start: BETTER_AUTH_SECRET must have at least 32 characters$/);
      expect(line).not.toContain('short');
      startOrExit(complete, exit);
      expect(exit).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
    }
  });
});

describe('instrumentation register()', () => {
  it('exits a production server in the Node.js runtime whose settings are missing; does nothing in the edge runtime', async () => {
    const saved = { ...process.env };
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      process.env.NEXT_RUNTIME = 'nodejs';
      Object.assign(process.env, { NODE_ENV: 'production' });
      delete process.env.APP_URL;
      await expect(register()).rejects.toThrow('exit 1');
      expect(error.mock.calls[0]?.[0]).toMatch(/APP_URL is not set/);
      process.env.NEXT_RUNTIME = 'edge';
      await expect(register()).resolves.toBeUndefined();
      expect(exit).toHaveBeenCalledTimes(1);
    } finally {
      exit.mockRestore();
      error.mockRestore();
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });
});
