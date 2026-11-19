// family.digest (docs/adr/0048-kung-fu-family.md): once a week, the digest of the kung fu family
// (src/server/services/family.ts, runFamilyDigest): counts only, one notice per account and ISO
// week, so a rerun or a retried job sends nothing more. Logs carry counts only (plan §6.4).

import type { JobWithMetadata, PgBoss } from 'pg-boss';

import type { Database } from '../db';
import { runFamilyDigest } from '../services/family';
import { failureCode } from './lineage-recompute';
import { QUEUE } from './queues';

/** Handles family.digest. A failure is logged and rethrown with its code only (plan §6.4). */
export function familyDigestHandler(db: Database, log: (line: string) => void, boss?: PgBoss) {
  return async (jobs: JobWithMetadata<Record<string, never>>[]): Promise<void> => {
    // The jobs carry nothing: one run answers every job of the batch.
    const job = jobs[0];
    if (!job) return;
    try {
      const result = await runFamilyDigest(db, new Date(), boss);
      log(`${QUEUE.familyDigest}: job ${job.id}: ${result.accounts} account(s) with news, ${result.notices} notice(s)`);
    } catch (error) {
      const code = failureCode(error);
      const last = job.retryCount >= job.retryLimit;
      log(`${QUEUE.familyDigest}: job ${job.id}: attempt ${job.retryCount + 1} of ${job.retryLimit + 1} failed (${code})${last ? '; no attempts left' : '; will retry'}`);
      throw new Error(`${QUEUE.familyDigest} failed: ${code}`);
    }
  };
}
