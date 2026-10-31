// The lineage.recompute handler (src/server/jobs/lineage-recompute.ts): a failure is logged with a
// code an administrator can act on (the internal route's status, a refused connection, a SQLSTATE),
// never with a message, which could carry data (plan §6.4; docs/guides/admin-guide.bg.md §14).

import type { JobWithMetadata } from 'pg-boss';
import { describe, expect, it } from 'vitest';

import type { Database } from '../db';
import { MAX_TAGS } from '../revalidate';
import { failureCode, lineageRecomputeHandler, RevalidateAnswerError, revalidatePoster } from './lineage-recompute';
import type { LineageRecomputeJob } from './queues';

const job = (retryCount: number, retryLimit = 5) =>
  ({ id: 'job-1', name: 'lineage.recompute', data: { lineageIds: [], tags: ['explore-start'] }, retryCount, retryLimit }) as unknown as JobWithMetadata<LineageRecomputeJob>;

/** No lineage to recompute: the handler never touches the database. */
const noDb = {} as Database;

describe('lineageRecomputeHandler', () => {
  it('logs the counts after a revalidation', async () => {
    const lines: string[] = [];
    const posted: string[][] = [];
    await lineageRecomputeHandler(noDb, (line) => lines.push(line), async (tags) => {
      posted.push(tags);
    })([job(0)]);
    expect(posted).toEqual([['explore-start']]);
    expect(lines).toEqual(['lineage.recompute: job job-1: 0 lineage(s), 0 member(s), 1 tag(s) revalidated']);
  });

  it('logs the status of a refused revalidation and rethrows it with that code only, so pg-boss retries', async () => {
    const lines: string[] = [];
    const run = lineageRecomputeHandler(noDb, (line) => lines.push(line), async () => {
      throw new RevalidateAnswerError(401);
    });
    await expect(run([job(0)])).rejects.toThrow(/^lineage\.recompute failed: revalidate answered 401$/);
    await expect(run([job(5)])).rejects.toThrow(/revalidate answered 401/);
    expect(lines).toEqual([
      'lineage.recompute: job job-1: attempt 1 of 6 failed (revalidate answered 401); will retry',
      'lineage.recompute: job job-1: attempt 6 of 6 failed (revalidate answered 401); no attempts left',
    ]);
  });
});

describe('failureCode', () => {
  it('names a refused connection by its system code, a database error by its SQLSTATE and anything else by its name', () => {
    const refused = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3000'), { code: 'ECONNREFUSED' }) });
    expect(failureCode(refused)).toBe('revalidate unreachable (ECONNREFUSED)');
    expect(failureCode(Object.assign(new Error('canceling statement: demo@wingchunroots.test'), { code: '57014' }))).toBe('database error 57014');
    expect(failureCode(new RangeError('Demo Person'))).toBe('RangeError');
    expect(failureCode('Demo Person')).toBe('unknown error');
  });
});

describe('revalidatePoster', () => {
  const env = { APP_URL: 'http://localhost:3109', MAIL_SEAL_KEY: 'k'.repeat(64) };

  it('sends the tags in requests of at most MAX_TAGS, with the secret, to the internal route', async () => {
    const sent: { url: string; auth: string | null; tags: string[] }[] = [];
    const send = (async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), auth: new Headers(init?.headers).get('authorization'), tags: JSON.parse(String(init?.body)).tags });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const tags = Array.from({ length: MAX_TAGS + 1 }, (_, i) => `person:00000000-0000-7000-8000-${String(i).padStart(12, '0')}`);
    await revalidatePoster(send, env)(tags);
    expect(sent.map((s) => s.tags.length)).toEqual([MAX_TAGS, 1]);
    expect(sent.flatMap((s) => s.tags)).toEqual(tags);
    expect(new Set(sent.map((s) => s.url))).toEqual(new Set(['http://localhost:3109/api/internal/revalidate']));
    expect(sent.every((s) => /^Bearer [0-9a-f]{64}$/.test(s.auth ?? ''))).toBe(true);
  });

  it('sends nothing for no tags, and throws the status of a refused request', async () => {
    let calls = 0;
    const refuse = (async () => {
      calls += 1;
      return new Response('{}', { status: 401 });
    }) as typeof fetch;
    await revalidatePoster(refuse, env)([]);
    expect(calls).toBe(0);
    await expect(revalidatePoster(refuse, env)(['explore-start'])).rejects.toThrow(RevalidateAnswerError);
    expect(calls).toBe(1);
  });
});
