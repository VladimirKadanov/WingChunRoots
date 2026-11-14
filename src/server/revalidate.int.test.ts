// POST /api/internal/revalidate (milestone M09, Done when; plan §6.4): the route the worker calls
// after each recompute refuses a request without the shared secret, before reading its body, and
// revalidates only known cache tags with revalidateTag(tag, 'max').

import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../app/api/internal/revalidate/route';
import { hasRevalidateSecret, MAX_TAGS, REVALIDATE_BODY_MAX_BYTES, revalidateSecret, revalidateUrl } from './revalidate';

const calls = vi.hoisted(() => ({ revalidated: [] as [string, unknown][] }));
vi.mock('next/cache', () => ({
  revalidateTag: (tag: string, profile: unknown) => {
    calls.revalidated.push([tag, profile]);
  },
}));

const SEAL = 'test-seal-key-0123456789abcdef0123456789abcdef';
const TAG = 'person:0190a5c0-0000-7000-8000-000000000001';

function post(body: unknown, authorization?: string) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (authorization) headers.set('authorization', authorization);
  return new Request('http://127.0.0.1:3999/api/internal/revalidate', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

describe('POST /api/internal/revalidate', () => {
  const saved = { seal: process.env.MAIL_SEAL_KEY, own: process.env.INTERNAL_REVALIDATE_SECRET };
  afterEach(() => {
    calls.revalidated = [];
    process.env.MAIL_SEAL_KEY = saved.seal;
    if (saved.own === undefined) delete process.env.INTERNAL_REVALIDATE_SECRET;
    else process.env.INTERNAL_REVALIDATE_SECRET = saved.own;
  });

  it('refuses a request without the secret, or with a wrong one, with 401 and revalidates nothing', async () => {
    process.env.MAIL_SEAL_KEY = SEAL;
    delete process.env.INTERNAL_REVALIDATE_SECRET;
    for (const authorization of [undefined, 'Bearer ', 'Bearer wrong-secret', `Basic ${revalidateSecret()}`, revalidateSecret()]) {
      const response = await POST(post({ tags: [TAG] }, authorization));
      expect(response.status, String(authorization)).toBe(401);
    }
    expect(calls.revalidated).toEqual([]);
  });

  it('refuses everything when no secret is configured', async () => {
    delete process.env.MAIL_SEAL_KEY;
    delete process.env.INTERNAL_REVALIDATE_SECRET;
    expect((await POST(post({ tags: [TAG] }, 'Bearer anything'))).status).toBe(401);
    expect(() => revalidateSecret()).toThrow(/INTERNAL_REVALIDATE_SECRET/);
  });

  it('with the secret: revalidates each known tag once with the max profile', async () => {
    process.env.MAIL_SEAL_KEY = SEAL;
    delete process.env.INTERNAL_REVALIDATE_SECRET;
    const membership = 'lineage-membership:0190a5c0-0000-7000-8000-00000000000a';
    const response = await POST(post({ tags: [TAG, TAG, 'explore-start', membership] }, `Bearer ${revalidateSecret()}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revalidated: 3 });
    expect(calls.revalidated).toEqual([
      [TAG, 'max'],
      ['explore-start', 'max'],
      [membership, 'max'],
    ]);
  });

  it('with the secret: `schools` (M20: the activity check hid a school) expires at once, not stale', async () => {
    process.env.MAIL_SEAL_KEY = SEAL;
    delete process.env.INTERNAL_REVALIDATE_SECRET;
    const response = await POST(post({ tags: ['schools'] }, `Bearer ${revalidateSecret()}`));
    expect(response.status).toBe(200);
    expect(calls.revalidated).toEqual([['schools', { expire: 0 }]]);
    // Another word is still not a tag.
    expect((await POST(post({ tags: ['events'] }, `Bearer ${revalidateSecret()}`))).status).toBe(400);
  });

  it('with the secret: refuses a body that is not a list of known tags, or too many', async () => {
    process.env.MAIL_SEAL_KEY = SEAL;
    const auth = `Bearer ${revalidateSecret()}`;
    for (const body of ['not json', { tags: 'person:x' }, { tags: ['/people/demo-root-a'] }, { tags: ['person:not-a-uuid'] }, { tags: Array(MAX_TAGS + 1).fill(TAG) }]) {
      expect((await POST(post(body, auth))).status).toBe(400);
    }
    expect(calls.revalidated).toEqual([]);
  });

  it('reads at most REVALIDATE_BODY_MAX_BYTES (review 2026-11-13, auth.md 1): the longest real body fits, one byte over is 413', async () => {
    process.env.MAIL_SEAL_KEY = SEAL;
    const auth = `Bearer ${revalidateSecret()}`;
    // MAX_TAGS of the longest shape is the largest body the worker can send, well within the limit.
    const longest = 'lineage-membership:0190a5c0-0000-7000-8000-00000000000a';
    const real = JSON.stringify({ tags: Array(MAX_TAGS).fill(longest) });
    expect(real.length).toBeLessThan(REVALIDATE_BODY_MAX_BYTES / 1.5);
    expect((await POST(post(real, auth))).status).toBe(200);
    expect(calls.revalidated).toHaveLength(1);
    calls.revalidated = [];

    // Exactly the limit (JSON whitespace pads it): read and answered as a body.
    const base = JSON.stringify({ tags: [TAG] });
    const exact = base + ' '.repeat(REVALIDATE_BODY_MAX_BYTES - base.length);
    expect(exact.length).toBe(REVALIDATE_BODY_MAX_BYTES);
    expect((await POST(post(exact, auth))).status).toBe(200);
    expect(calls.revalidated).toEqual([[TAG, 'max']]);
    calls.revalidated = [];

    // One byte over: 413 by the declared length, and by the count when none is declared.
    const over = exact + ' ';
    const declared = post(over, auth);
    declared.headers.set('content-length', String(over.length));
    const refused = await POST(declared);
    expect(refused.status).toBe(413);
    expect(await refused.json()).toMatchObject({ error: 'PAYLOAD_TOO_LARGE' });
    expect((await POST(post(over, auth))).status).toBe(413);
    const chunked = new Request('http://127.0.0.1:3999/api/internal/revalidate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(64 * 1024).fill(0x20));
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect((await POST(chunked)).status).toBe(413);
    expect(calls.revalidated).toEqual([]);

    // Without the secret an oversize body is still 401: it is not read.
    expect((await POST(post(over))).status).toBe(401);
  });

  it('a dedicated INTERNAL_REVALIDATE_SECRET of 32+ characters wins over the derived one, which never equals the seal key', async () => {
    process.env.MAIL_SEAL_KEY = SEAL;
    const derived = revalidateSecret();
    expect(derived).not.toBe(SEAL);
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
    process.env.INTERNAL_REVALIDATE_SECRET = 'a-dedicated-secret-of-at-least-32-chars';
    expect(revalidateSecret()).toBe('a-dedicated-secret-of-at-least-32-chars');
    expect(hasRevalidateSecret(post({}, `Bearer ${derived}`))).toBe(false);
    expect(hasRevalidateSecret(post({}, 'Bearer a-dedicated-secret-of-at-least-32-chars'))).toBe(true);
    // Too short to be a secret: the derived one is used instead.
    process.env.INTERNAL_REVALIDATE_SECRET = 'short';
    expect(revalidateSecret()).toBe(derived);
  });

  it('the worker reaches the route at INTERNAL_APP_URL, else APP_URL', () => {
    expect(revalidateUrl({ APP_URL: 'http://127.0.0.1:3100' })).toBe('http://127.0.0.1:3100/api/internal/revalidate');
    expect(revalidateUrl({ APP_URL: 'http://127.0.0.1:3100', INTERNAL_APP_URL: 'http://web:3000' })).toBe('http://web:3000/api/internal/revalidate');
  });
});
