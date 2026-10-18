// The CSRF check of the oRPC endpoints (src/server/rpc/handler.ts, csrfRefusal; docs/adr/0004-auth.md
// section 6).

import { describe, expect, it } from 'vitest';

import { csrfRefusal } from './handler';

const APP = 'https://wingchunroots.example';
const post = (headers: Record<string, string>) => new Request(`${APP}/api/v1/consent/record`, { method: 'POST', headers });

describe('csrfRefusal', () => {
  it('lets a same-origin change with cookies through, and refuses one from another site or without an origin', () => {
    expect(csrfRefusal(post({ cookie: 'wcr.session_token=x', origin: APP }), APP)).toBeNull();
    expect(csrfRefusal(post({ cookie: 'wcr.session_token=x', 'sec-fetch-site': 'same-origin' }), APP)).toBeNull();
    expect(csrfRefusal(post({ cookie: 'wcr.session_token=x', origin: 'https://evil.example' }), APP)).toBe('origin');
    expect(csrfRefusal(post({ cookie: 'wcr.session_token=x' }), APP)).toBe('no-origin');
  });

  it('exempts a bearer request: a browser cannot add that header across sites without a preflight', () => {
    expect(csrfRefusal(post({ authorization: 'Bearer abc.def', origin: 'https://evil.example' }), APP)).toBeNull();
    expect(csrfRefusal(post({ authorization: 'bearer abc.def', cookie: 'wcr.session_token=x', origin: 'https://evil.example' }), APP)).toBeNull();
  });

  it('exempts no other Authorization scheme: a browser attaches Basic or Negotiate credentials by itself (fix round 3)', () => {
    for (const authorization of ['Basic eDp5', 'Negotiate abc', 'Bearer', 'Bearerabc', 'Token abc']) {
      expect(csrfRefusal(post({ authorization, cookie: 'wcr.session_token=x', origin: 'https://evil.example' }), APP)).toBe('origin');
    }
  });

  it('leaves safe methods and requests without cookies alone', () => {
    expect(csrfRefusal(new Request(`${APP}/api/v1/account/me`, { headers: { cookie: 'x=1', origin: 'https://evil.example' } }), APP)).toBeNull();
    expect(csrfRefusal(post({ origin: 'https://evil.example' }), APP)).toBeNull();
  });
});
