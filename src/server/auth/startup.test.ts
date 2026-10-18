// The start-up check of a production server (src/server/auth/startup.ts, src/instrumentation.ts).

import { describe, expect, it } from 'vitest';

import { register } from '../../instrumentation';
import { checkProductionSettings } from './startup';

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

  it('lets `next start` on a loopback host run without TRUSTED_PROXIES (the E2E tests)', () => {
    const loopback: Record<string, string> = { ...complete, APP_URL: 'http://127.0.0.1:3100' };
    delete loopback.TRUSTED_PROXIES;
    expect(() => checkProductionSettings(loopback)).not.toThrow();
  });
});

describe('instrumentation register()', () => {
  it('runs the check in the Node.js runtime of a production server', async () => {
    const saved = { ...process.env };
    try {
      process.env.NEXT_RUNTIME = 'nodejs';
      Object.assign(process.env, { NODE_ENV: 'production' });
      delete process.env.APP_URL;
      await expect(register()).rejects.toThrow(/APP_URL is not set/);
      process.env.NEXT_RUNTIME = 'edge';
      await expect(register()).resolves.toBeUndefined();
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });
});
