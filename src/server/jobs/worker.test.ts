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
    expect(lines).toEqual([
      'retention.purge: erased 0 delivery address(es), 0 invitation address(es)',
      'retention.purge: deleted 0 expired session(s), 0 expired verification value(s), 0 expired throttle row(s)',
      'retention.purge: deleted 0 unconfirmed account(s), kept 0 still referred to',
      'retention.purge: deleted 0 old notification(s)',
      // M21: closed trial lesson requests after a year, school counters after 400 days.
      'retention.purge: deleted 0 closed trial lesson request(s), 0 old school counter(s)',
      // M24: organization import previews past their 24 hours.
      'retention.purge: ended 0 expired organization import preview(s)',
      // Review 2026-11: third-party records, ended claims, revisions, ip_hmac and unanswered trial requests.
      'retention.purge: deleted 0 and removed 0 third-party record(s), withdrew 0 request(s) waiting for them',
      'retention.purge: set the retention of 0 evidence file(s), deleted 0 (0 not deleted), removed the text of 0 review note(s)',
      'retention.purge: redacted the text of 0 old record revision(s)',
      'retention.purge: removed 0 old audit ip_hmac value(s), 0 old session value(s)',
      'retention.purge: closed and scrubbed 0 unanswered and 0 orphaned trial lesson request(s)',
    ]);
  });

  it('logs a failure with its SQLSTATE only and rethrows it without the message', async () => {
    const lines: string[] = [];
    const handler = retentionPurgeHandler(failingDb, (line) => lines.push(line));
    await expect(handler([job(0)])).rejects.toThrow(/^retention\.purge failed: database error 57014$/);
    await expect(handler([job(3)])).rejects.toThrow('database error 57014');
    // The two lines of the job itself (review 2026-11: every step now also logs its own failure, below).
    expect(lines.filter((line) => line.includes(': job '))).toEqual([
      'retention.purge: job job-1: attempt 1 of 4 failed (database error 57014); will retry',
      'retention.purge: job job-1: attempt 4 of 4 failed (database error 57014); no attempts left, the addresses stay until the next run',
    ]);
    expect(lines.filter((line) => !line.includes(': job ')).every((line) => /^retention\.purge: step [a-z_ -]+ failed \(database error 57014\)$/.test(line))).toBe(true);
    expect(lines.join('\n')).not.toContain('@');
  });

  it('runs the other steps when one fails, then fails the job once', async () => {
    // Review 2026-11: a step that fails every night must not keep the retention periods of the others from running.
    let calls = 0;
    const firstFails = {
      execute: async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
        return { rowCount: 0, rows: [] };
      },
    } as unknown as Database;
    const lines: string[] = [];
    await expect(retentionPurgeHandler(firstFails, (line) => lines.push(line))([job(0)])).rejects.toThrow(/^retention\.purge failed: database error 57014$/);
    expect(lines[0]).toBe('retention.purge: step addresses failed (database error 57014)');
    expect(lines).toContain('retention.purge: redacted the text of 0 old record revision(s)');
    expect(lines).toContain('retention.purge: removed 0 old audit ip_hmac value(s), 0 old session value(s)');
    expect(lines.at(-1)).toBe('retention.purge: job job-1: attempt 1 of 4 failed (database error 57014); will retry');
  });
});
