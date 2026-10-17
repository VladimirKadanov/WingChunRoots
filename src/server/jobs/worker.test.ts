// The retention.purge handler (src/server/jobs/worker.ts): a failure is logged and rethrown with its
// SQLSTATE only, never with the database message, which can quote row values (plan §6.4).

import type { JobWithMetadata } from 'pg-boss';
import { describe, expect, it } from 'vitest';

import type { Database } from '../db';
import { retentionPurgeHandler } from './worker';

const job = (retryCount: number, retryLimit = 3) =>
  ({ id: 'job-1', name: 'retention.purge', data: {}, retryCount, retryLimit }) as unknown as JobWithMetadata<Record<string, never>>;

/** A database whose every statement fails like a statement timeout that quotes a row. */
const failingDb = {
  execute: async () => {
    throw Object.assign(new Error('canceling statement due to statement timeout: demo@wingchunroots.test'), { code: '57014' });
  },
} as unknown as Database;

const countingDb = {
  execute: async () => ({ rowCount: 0, rows: [] }),
} as unknown as Database;

describe('retentionPurgeHandler', () => {
  it('logs the counts after a purge', async () => {
    const lines: string[] = [];
    await retentionPurgeHandler(countingDb, (line) => lines.push(line))([job(0)]);
    expect(lines).toEqual(['retention.purge: erased 0 delivery address(es), 0 invitation address(es)']);
  });

  it('logs a failure with its SQLSTATE only and rethrows it without the message', async () => {
    const lines: string[] = [];
    const handler = retentionPurgeHandler(failingDb, (line) => lines.push(line));
    await expect(handler([job(0)])).rejects.toThrow(/^retention\.purge failed: database error 57014$/);
    await expect(handler([job(3)])).rejects.toThrow('database error 57014');
    expect(lines).toEqual([
      'retention.purge: job job-1: attempt 1 of 4 failed (database error 57014); will retry',
      'retention.purge: job job-1: attempt 4 of 4 failed (database error 57014); no attempts left, the addresses stay until the next run',
    ]);
    expect(lines.join('\n')).not.toContain('@');
  });
});
