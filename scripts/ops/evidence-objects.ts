// The objects of a local archive (milestone M12; plan §3.1 "Архиви", §6.4; extended by the review of
// 2026-11-13, ops.md H1), for scripts/backup-local.sh and scripts/restore-drill.sh. The name is the
// M12 one: it began with the evidence files alone and now handles every object family the database
// points at (scripts/lib/object-families.ts: evidence, passport certificates, profile and gallery
// photos, school photos and logos, event posters), each in the store that holds it. Objects stay
// private: the copies go only into the git-ignored backups/ folder with owner-only permissions, and
// nothing here prints a storage key, a name or a file's content (CLAUDE.md §6).
//
//   tsx scripts/ops/evidence-objects.ts sql [--sample <n>] [--family <id>]
//       prints the SELECT that lists the objects of the database, one
//       `<family>|<id>|<key>|<sha256>|<mime>|<parts>` line per row that has files now; with
//       --sample, that many random rows of each family. Pipe it into `psql -t -A -f -`.
//   tsx scripts/ops/evidence-objects.ts copy --out <dir>
//       those lines on stdin (or, as in M12, one evidence storage key per line): each object of
//       each row is copied from its store (SeaweedFS or the private folders, src/server/storage)
//       to <dir>/<key>. A row with an object missing in the store fails the command.
//   tsx scripts/ops/evidence-objects.ts verify [--objects <dir>]
//       those lines on stdin (or, as in M12, `<id>|<key>|<sha256>` of evidence_file): every object
//       of each row must be there (in <dir> when given, else in the store) and the one the row's
//       SHA-256 describes must have that hash. A row that points at a missing object fails.
//   tsx scripts/ops/evidence-objects.ts restore --objects <dir>
//       those lines on stdin (or, as in M12, `<key>|<mime>|<sha256>` of evidence_file): puts each
//       object of an archive's copy back into its store, a row all or nothing, after a real
//       restore that lost the stores too (docs/operations/backup-and-restore.md)
//   tsx scripts/ops/evidence-objects.ts fixture [--test-database]
//       one clearly fictional demo PDF in the store and its evidence_file row, so that the drill
//       has an object to check; a local database or TEST_DATABASE_URL only, never in production
//
// Values come from the environment, then from .env.

import { createHash } from 'node:crypto';

import { createRoleDatabase } from '../../src/server/db';
import { loadDotEnv } from '../../src/server/db/dotenv';
import { assertSafeToReset, rolePassword, targetDatabaseUrl } from '../../src/server/db/env';
import { evidenceFile } from '../../src/server/db/schema';
import { getEvidenceStore, getPhotoStore } from '../../src/server/storage';
import { type ArchiveResult, copyObjects, restoreObjects, type StoreResolver, verifyObjects } from '../lib/object-archive';
import { listSql, OBJECT_FAMILIES, type ObjectRow, parseRow } from '../lib/object-families';

const say = (line: string) => process.stdout.write(`${line}\n`);

const stores: StoreResolver = (name) => (name === 'media' ? getPhotoStore() : getEvidenceStore());

async function stdinLines(): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks)
    .toString('utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

/** The rows on stdin; a line that is not a row is reported (its number only) and fails the command. */
async function stdinRows(legacy: 'copy' | 'verify' | 'restore'): Promise<ObjectRow[]> {
  const rows: ObjectRow[] = [];
  const malformed: number[] = [];
  for (const [index, line] of (await stdinLines()).entries()) {
    const row = parseRow(line, legacy);
    if (row) rows.push(row);
    else malformed.push(index + 1);
  }
  if (malformed.length > 0) {
    say(`objects: ${malformed.length} line(s) of the list are not objects (lines ${malformed.slice(0, 10).join(', ')})`);
    process.exitCode = 1;
  }
  return rows;
}

const WHAT: Record<'copy' | 'verify' | 'restore', { done: string; where: string }> = {
  copy: { done: 'copied', where: 'from the' },
  verify: { done: 'match', where: 'in the' },
  restore: { done: 'put back', where: 'into the' },
};

/** One line per family that had rows, then the problems (row ids and reasons only); exit status 1 on any problem. */
function report(command: 'copy' | 'verify' | 'restore', result: ArchiveResult): void {
  for (const family of OBJECT_FAMILIES) {
    for (const tally of result.tallies.filter((t) => t.family.id === family.id)) {
      const source = tally.source === 'archive' ? 'the archive copy' : `${WHAT[command].where} ${tally.source} store`;
      say(`objects: ${family.id}: ${tally.ok} of ${tally.rows} ${WHAT[command].done} (${source})`);
    }
  }
  if (result.tallies.length === 0) say('objects: no rows with files');
  for (const problem of result.problems.slice(0, 20)) say(`objects: ${problem.family} ${problem.row}: ${problem.reason}`);
  if (result.problems.length > 20) say(`objects: ${result.problems.length - 20} more problems`);
  if (result.problems.length > 0) process.exitCode = 1;
}

function sql(): void {
  const sample = option('--sample');
  say(listSql({ sample: sample === undefined ? undefined : Number(sample), only: option('--family') }));
}

async function copy(): Promise<void> {
  const out = option('--out');
  if (!out) throw new Error('copy needs --out <dir>');
  report('copy', await copyObjects(await stdinRows('copy'), stores, out));
}

async function verify(): Promise<void> {
  const dir = option('--objects');
  report('verify', await verifyObjects(await stdinRows('verify'), dir ? { dir } : { stores }));
}

async function restore(): Promise<void> {
  const dir = option('--objects');
  if (!dir) throw new Error('restore needs --objects <dir>');
  report('restore', await restoreObjects(await stdinRows('restore'), dir, stores));
}

/** A fictional one-page PDF: no person, no lineage, no real record (CLAUDE.md §7). */
const FIXTURE_PDF = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >> endobj',
    '% WingChunRoots demo evidence for the restore drill (fictional, milestone M12)',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
    '',
  ].join('\n'),
  'utf8',
);
// A fixed key, so that running the fixture again changes nothing.
const FIXTURE_KEY = `evidence/${createHash('sha256').update('demo-restore-drill-fixture').digest('hex').slice(0, 48)}`;

async function fixture(): Promise<void> {
  const url = process.argv.includes('--test-database') ? process.env.TEST_DATABASE_URL : targetDatabaseUrl();
  if (!url) throw new Error('--test-database needs TEST_DATABASE_URL');
  assertSafeToReset(url, process.env, 'evidence fixture');
  const sha256 = createHash('sha256').update(FIXTURE_PDF).digest('hex');
  await getEvidenceStore().put(FIXTURE_KEY, FIXTURE_PDF, { contentType: 'application/pdf', sha256 });
  const db = createRoleDatabase('app_rw', url, rolePassword('app_rw'));
  try {
    await db
      .insert(evidenceFile)
      .values({ storageKey: FIXTURE_KEY, sha256, mime: 'application/pdf', sizeBytes: FIXTURE_PDF.length, scanStatus: 'clean', originalName: 'demo-restore-drill.pdf' })
      .onConflictDoUpdate({ target: evidenceFile.storageKey, set: { sha256, sizeBytes: FIXTURE_PDF.length, deletedAt: null } });
  } finally {
    await db.$client.end();
  }
  say('evidence fixture: one fictional demo object stored and recorded');
}

async function main(): Promise<void> {
  loadDotEnv();
  const command = process.argv[2];
  if (command === 'sql') return sql();
  if (command === 'copy') return copy();
  if (command === 'verify') return verify();
  if (command === 'restore') return restore();
  if (command === 'fixture') return fixture();
  throw new Error('usage: evidence-objects.ts sql [--sample <n>] [--family <id>] | copy --out <dir> | verify [--objects <dir>] | restore --objects <dir> | fixture [--test-database]');
}

main().catch((error: unknown) => {
  process.stderr.write(`evidence-objects: ${error instanceof Error ? error.message : 'failed'}\n`);
  process.exitCode = 1;
});
