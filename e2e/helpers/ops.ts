// Fixtures of the M12 tests and screenshots of /admin/system (milestone M12): fictional archive
// names in the E2E server's BACKUP_DIR (playwright.config.ts) and a job deferred by a day, which
// the running worker leaves alone, so the queue has a known depth.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { sql } from 'drizzle-orm';

import { getDb } from '../../src/server/db';
import { databaseName, targetDatabaseUrl } from '../../src/server/db/env';
import { QUEUE } from '../../src/server/jobs/queues';
import { loadTestEnv } from './auth';

/** BACKUP_DIR of the E2E server (playwright.config.ts serverEnv). */
export const E2E_BACKUP_DIR = 'test-results/backups';

/**
 * The times of the two fictional archives: 02:00 UTC yesterday and the day before. They follow the
 * clock, so the newest archive stays younger than the page's eight-day staleness limit on any day
 * the suite runs (fixed dates turned the backup verdict to "Needs attention" eight days later).
 * Every project of a run writes the same names unless the run crosses midnight UTC.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const yesterdayAtTwo = new Date(Date.now() - DAY_MS);
yesterdayAtTwo.setUTCHours(2, 0, 0, 0);
export const NEWEST_ARCHIVE = yesterdayAtTwo.toISOString();
export const OLDER_ARCHIVE = new Date(yesterdayAtTwo.getTime() - DAY_MS).toISOString();

const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/**
 * Two archive names of the server's database (scripts/backup-local.sh names them so), with their
 * .sha256 files; the content is a line of text, not a dump. Returns the newest file's name.
 */
export function writeDemoArchives(): string {
  loadTestEnv();
  const database = databaseName(targetDatabaseUrl());
  mkdirSync(E2E_BACKUP_DIR, { recursive: true });
  let newest = '';
  for (const iso of [OLDER_ARCHIVE, NEWEST_ARCHIVE]) {
    const file = `${database}-${stamp(iso)}.dump`;
    writeFileSync(path.join(E2E_BACKUP_DIR, file), 'Fictional archive for the E2E tests of /admin/system (not a dump).\n');
    writeFileSync(path.join(E2E_BACKUP_DIR, `${file}.sha256`), `${'0'.repeat(64)}  ${file}\n`);
    newest = file;
  }
  return newest;
}

/** A retention.purge job that starts in a day: it adds one to the queue's depth until deleted. */
export async function deferredJob(): Promise<string> {
  loadTestEnv();
  const { rows } = await getDb().execute<{ id: string }>(sql`
    INSERT INTO pgboss.job (name, data, start_after) VALUES (${QUEUE.retentionPurge}, '{}'::jsonb, now() + interval '1 day')
    RETURNING id::text AS id`);
  return rows[0]!.id;
}

export async function deleteJob(id: string): Promise<void> {
  await getDb().execute(sql`DELETE FROM pgboss.job WHERE name = ${QUEUE.retentionPurge} AND id = ${id}::uuid`);
}
