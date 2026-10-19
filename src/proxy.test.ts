// The request-time check of a person's pages (src/proxy.ts; milestone M04 fix round 1): it runs
// only on /people/<slug> and /people/<slug>/lineage, never on api, healthz or _next (plan §6.1,
// CLAUDE.md §13); a hidden, missing or malformed address is rewritten to the 404 page; the
// session is read only when the slug is not public and a session may be there; a failed check
// never hides a page.

import { NextRequest } from 'next/server';
// The docs name it unstable_doesProxyMatch; Next.js 16.4.1 still exports the middleware name.
import { getRewrittenUrl, isRewrite, unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const visible = vi.fn<(principalOf: () => Promise<unknown>, input: { slug: string }) => Promise<boolean>>();
const principal = vi.fn<(headers: Headers) => Promise<unknown>>();

vi.mock('@/server/services/lineage', () => ({ personPageVisible: (...args: Parameters<typeof visible>) => visible(...args) }));
vi.mock('@/server/auth/session', () => ({ principalFromHeaders: (headers: Headers) => principal(headers) }));
vi.mock('@/server/auth/config', () => ({ COOKIE_PREFIX: 'wcr' }));

const { config, proxy } = await import('./proxy');

const request = (path: string, init?: { cookie?: string; authorization?: string }) => {
  const headers = new Headers();
  if (init?.cookie) headers.set('cookie', init.cookie);
  if (init?.authorization) headers.set('authorization', init.authorization);
  return new NextRequest(`http://127.0.0.1:3100${path}`, { headers });
};

beforeEach(() => {
  visible.mockReset();
  principal.mockReset();
});

describe('matcher', () => {
  it.each(['/people/demo-hub-a', '/people/demo-hub-a/lineage', '/people/BAD_slug', '/people/demo-hub-a/lineage?page=2'])('runs on %s', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });

  it.each([
    '/',
    '/people',
    '/people/demo-hub-a/lineage/more',
    '/api/v1/people/demo-hub-a',
    '/api/rpc/people/get',
    '/api/auth/get-session',
    '/healthz',
    '/_next/static/chunks/main.js',
    '/_next/image?url=x',
    '/account',
    '/not-on-record',
  ])('never runs on %s', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });

  it('names only the two person paths', () => {
    expect(config.matcher).toEqual(['/people/:slug', '/people/:slug/lineage']);
  });
});

describe('proxy', () => {
  it('lets a visible person through', async () => {
    visible.mockResolvedValue(true);
    const response = await proxy(request('/people/demo-hub-a'));
    expect(isRewrite(response)).toBe(false);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(visible.mock.calls[0]![1]).toEqual({ slug: 'demo-hub-a' });
  });

  it('rewrites a person this viewer may not see to the 404 page, keeping the address', async () => {
    visible.mockResolvedValue(false);
    for (const path of ['/people/demo-claim-only-teacher', '/people/demo-no-such-person/lineage', '/people/%E0%A4%A']) {
      const response = await proxy(request(path));
      expect(isRewrite(response), path).toBe(true);
      expect(new URL(getRewrittenUrl(response)!).pathname, path).toBe('/not-on-record');
      expect(response.headers.get('x-middleware-request-x-wcr-not-on-record'), path).toBe('person');
    }
    // A malformed escape is passed on as an empty slug (which no person has), never thrown.
    expect(visible.mock.calls.at(-1)![1]).toEqual({ slug: '' });
  });

  it('reads the session only when a session cookie or a bearer token is there', async () => {
    visible.mockImplementation(async (principalOf) => (await principalOf()) !== null);
    principal.mockResolvedValue({ user: { id: 'u' } });

    await proxy(request('/people/demo-pending'));
    expect(principal).not.toHaveBeenCalled();

    await proxy(request('/people/demo-pending', { cookie: 'wcr.session_token=abc' }));
    await proxy(request('/people/demo-pending', { cookie: '__Secure-wcr.session_token=abc' }));
    await proxy(request('/people/demo-pending', { authorization: 'Bearer abc' }));
    expect(principal).toHaveBeenCalledTimes(3);
  });

  it('never hides a page when the check fails, and logs no slug', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    visible.mockRejectedValue(Object.assign(new Error('canceling statement due to statement timeout: demo-secret-slug'), { code: '57014' }));
    const response = await proxy(request('/people/demo-secret-slug'));
    expect(isRewrite(response)).toBe(false);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0])).toContain('57014');
    expect(String(log.mock.calls[0])).not.toContain('demo-secret-slug');
    log.mockRestore();
  });
});
