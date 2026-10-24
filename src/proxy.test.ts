// The request-time check of a person's pages (src/proxy.ts; milestone M04, owner decision
// 2026-10-19, ADR 0008): it runs only on /people/<slug> and /people/<slug>/lineage (and Next.js's
// /_next/data form of them), never on api, healthz or the static _next assets (plan §6.1,
// CLAUDE.md §13); a hidden, missing or malformed address is rewritten
// to the 404 page; the session is read only when the slug is not public and a session may be
// there; a check that fails or runs past its short deadline (recheck-7) never hides a page.

import { NextRequest, type NextResponse } from 'next/server';
// The docs name it unstable_doesProxyMatch; Next.js 16.4.1 still exports the middleware name.
import { getRewrittenUrl, isRewrite, unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const visible = vi.fn<(principalOf: () => Promise<unknown>, input: { slug: string }) => Promise<boolean>>();
const principal = vi.fn<(headers: Headers) => Promise<unknown>>();

const BUDGET_MS = 500;
vi.mock('@/server/services/lineage', () => ({
  PERSON_CHECK_BUDGET_MS: BUDGET_MS,
  personPageVisible: (...args: Parameters<typeof visible>) => visible(...args),
}));
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

  it("runs on Next.js's own data form of the two paths, which is not a static _next asset (final check, code-2)", () => {
    // Next.js compiles each matcher with an optional /_next/data/<build> prefix and a .json (or
    // .rsc) suffix; the proxy then sees the page's own pathname, so the same check applies.
    for (const url of ['/_next/data/x/people/demo-hub-a.json', '/_next/data/x/people/demo-hub-a/lineage.json']) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(true);
    }
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

describe('the deadline of the check (recheck-7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Whether the proxy has answered yet, and with what. */
  function track(pending: Promise<NextResponse>) {
    const state: { response?: NextResponse } = {};
    void pending.then((response) => {
      state.response = response;
    });
    return state;
  }

  it('a check that never answers (a stalled database) lets the page through after the budget, logging only "timeout"', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    visible.mockReturnValue(new Promise<boolean>(() => {}));
    const state = track(proxy(request('/people/demo-secret-slug', { cookie: 'wcr.session_token=abc' })));

    await vi.advanceTimersByTimeAsync(BUDGET_MS - 1);
    expect(state.response).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(state.response).toBeDefined();
    expect(isRewrite(state.response!)).toBe(false);
    expect(state.response!.headers.get('x-middleware-next')).toBe('1');
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0])).toBe('[proxy] the person check failed (timeout); the page answers for itself');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a hidden person whose check answers within the budget still gets the 404 page, and leaves no timer', async () => {
    visible.mockReturnValue(new Promise<boolean>((resolve) => setTimeout(() => resolve(false), BUDGET_MS - 50)));
    const state = track(proxy(request('/people/demo-claim-only-teacher')));
    await vi.advanceTimersByTimeAsync(BUDGET_MS - 50);
    expect(state.response).toBeDefined();
    expect(isRewrite(state.response!)).toBe(true);
    expect(new URL(getRewrittenUrl(state.response!)!).pathname).toBe('/not-on-record');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a check that fails after the deadline has passed is not an unhandled rejection', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      visible.mockReturnValue(new Promise<boolean>((_, reject) => setTimeout(() => reject(Object.assign(new Error('late'), { code: '57014' })), BUDGET_MS + 100)));
      const state = track(proxy(request('/people/demo-hub-a')));
      await vi.advanceTimersByTimeAsync(BUDGET_MS + 200);
      expect(state.response!.headers.get('x-middleware-next')).toBe('1');
      // One log line, for the timeout; the late failure is not logged again.
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0])).toContain('(timeout)');
      await vi.runAllTimersAsync();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
