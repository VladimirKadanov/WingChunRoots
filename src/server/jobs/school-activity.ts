// schools.activity (milestone M20; specification §7.3; docs/adr/0023-school-activity.md): once a
// day, the activity check of the listed schools (src/server/services/school-activity.ts): day 90
// asks the owner to confirm the listing, day 105 hides its pin and listing (DEFAULT D17, D18).
// Idempotent by the stages and the notice keys, so a rerun or a retried job changes nothing more.
// After a school is hidden, the public cache of schools is dropped through the web process's
// internal route (src/server/revalidate.ts). Logs carry counts only (plan §6.4).

import type { JobWithMetadata, PgBoss } from 'pg-boss';

import type { Database } from '../db';
import { failureCode, postRevalidate, type RevalidateCall } from './lineage-recompute';
import { runSchoolActivityCheck } from '../services/school-activity';
import { QUEUE } from './queues';

/** Handles schools.activity. A failure is logged and rethrown with its code only (plan §6.4). */
export function schoolActivityHandler(db: Database, log: (line: string) => void, boss?: PgBoss, revalidate: RevalidateCall = postRevalidate) {
  return async (jobs: JobWithMetadata<Record<string, never>>[]): Promise<void> => {
    // The jobs carry nothing: one run answers every job of the batch.
    const job = jobs[0];
    if (!job) return;
    try {
      const result = await runSchoolActivityCheck(db, { boss, revalidate });
      log(`${QUEUE.schoolsActivity}: job ${job.id}: ${result.awaiting} awaiting confirmation, ${result.hidden} hidden, ${result.notices} notice(s)`);
    } catch (error) {
      const code = failureCode(error);
      const last = job.retryCount >= job.retryLimit;
      log(`${QUEUE.schoolsActivity}: job ${job.id}: attempt ${job.retryCount + 1} of ${job.retryLimit + 1} failed (${code})${last ? '; no attempts left' : '; will retry'}`);
      throw new Error(`${QUEUE.schoolsActivity} failed: ${code}`);
    }
  };
}
