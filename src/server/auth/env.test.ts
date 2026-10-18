// The accounts module's settings (src/server/auth/env.ts): the production guards of fix round 1.

import { describe, expect, it } from 'vitest';

import { appUrl, isPublicDeployment, trustedProxies } from './env';

describe('appUrl', () => {
  it('defaults to localhost outside production and keeps only the origin', () => {
    expect(appUrl({})).toBe('http://localhost:3000');
    expect(appUrl({ APP_URL: 'http://127.0.0.1:3100' })).toBe('http://127.0.0.1:3100');
    expect(() => appUrl({ APP_URL: 'http://localhost:3000/path' })).toThrow(/origin/);
    expect(() => appUrl({ APP_URL: 'ftp://localhost' })).toThrow(/http\(s\)/);
  });

  it('in production needs APP_URL, and https except on a loopback host', () => {
    expect(() => appUrl({ NODE_ENV: 'production' })).toThrow(/not set/);
    expect(() => appUrl({ NODE_ENV: 'production', APP_URL: 'http://wingchunroots.example' })).toThrow(/https/);
    expect(appUrl({ NODE_ENV: 'production', APP_URL: 'https://wingchunroots.example' })).toBe('https://wingchunroots.example');
    // `next start` for the E2E tests.
    expect(appUrl({ NODE_ENV: 'production', APP_URL: 'http://127.0.0.1:3100' })).toBe('http://127.0.0.1:3100');
    expect(appUrl({ NODE_ENV: 'production', APP_URL: 'http://localhost:3000' })).toBe('http://localhost:3000');
  });
});

describe('trustedProxies and isPublicDeployment', () => {
  it('splits the list and is empty without one', () => {
    expect(trustedProxies({})).toEqual([]);
    expect(trustedProxies({ TRUSTED_PROXIES: ' 10.0.0.0/8 , 192.0.2.1,' })).toEqual(['10.0.0.0/8', '192.0.2.1']);
  });

  it('is required in production behind a public origin, and only there', () => {
    const publicEnv = { NODE_ENV: 'production', APP_URL: 'https://wingchunroots.example' };
    expect(isPublicDeployment(publicEnv)).toBe(true);
    expect(() => trustedProxies(publicEnv)).toThrow(/TRUSTED_PROXIES is not set/);
    expect(trustedProxies({ ...publicEnv, TRUSTED_PROXIES: '10.0.0.1' })).toEqual(['10.0.0.1']);
    expect(isPublicDeployment({ NODE_ENV: 'production', APP_URL: 'http://127.0.0.1:3100' })).toBe(false);
    expect(trustedProxies({ NODE_ENV: 'production', APP_URL: 'http://127.0.0.1:3100' })).toEqual([]);
    expect(isPublicDeployment({ APP_URL: 'https://wingchunroots.example' })).toBe(false);
  });
});
