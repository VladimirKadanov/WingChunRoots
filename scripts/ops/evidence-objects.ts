// The evidence objects of a local archive (milestone M12; plan §3.1 "Архиви", §6.4), for
// scripts/backup-local.sh and scripts/restore-drill.sh. Evidence stays private: the copies go only
// into the git-ignored backups/ folder with owner-only permissions, and nothing here prints a
// storage key, a name or a file's content (CLAUDE.md §6).
//
//   tsx scripts/ops/evidence-objects.ts copy --out <dir>
//       storage keys on stdin, one per line: each object of the evidence store (SeaweedFS or the
//       private folder, src/server/storage) is copied to <dir>/<key>
//   tsx scripts/ops/evidence-objects.ts verify [--objects <dir>]
//       lines `<id>|<storage key>|<sha256>` on stdin (a sample of evidence_file from the restored
//       copy): the SHA-256 of each stored object (from <dir> when given, else from the store) must
//       be the row's sha256, the hash of the stored object
//   tsx scripts/ops/evidence-objects.ts restore --objects <dir>
//       lines `<storage key>|<mime>|<sha256>` on stdin (evidence_file of the restored database): puts each
//       object of an archive's copy whose SHA-256 is the row's back into the evidence store (after a real restore that lost
//       the store too; docs/operations/backup-and-restore.md)
//   tsx scripts/ops/evidence-objects.ts fixture [--test-database]
//       one clearly fictional demo PDF in the store and its evidence_file row, so that the drill
//       has an object to check; a local database or TEST_DATABASE_URL only, never in production
//
// Values come from the environment, then from .env.

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { createRoleDatabase } from '../../src/server/db';
import { loadDotEnv } from '../../src/server/db/dotenv';
import { assertSafeToReset, rolePassword, targetDatabaseUrl } from '../../src/server/db/env';
import { evidenceFile } from '../../src/server/db/schema';
import { getEvidenceStore, isStorageKey } from '../../src/server/storage';

const say = (line: string) => process.stdout.write(`${line}\n`);

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

/** <dir>/<key>, refusing a key that is not one (no "..", no absolute path). */
function objectPath(dir: string, key: string): string {
  if (!isStorageKey(key)) throw new Error('a malformed storage key was refused');
  return path.join(dir, ...key.split('/'));
}

async function copy(): Promise<void> {
  const out = option('--out');
  if (!out) throw new Error('copy needs --out <dir>');
  const keys = await stdinLines();
  const store = getEvidenceStore();
  await mkdir(out, { recursive: true, mode: 0o700 });
  let copied = 0;
  const missing: number[] = [];
  for (const [index, key] of keys.entries()) {
    const object = await store.get(key);
    if (!object) {
      missing.push(index + 1);
      continue;
    }
    const target = objectPath(out, key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await pipeline(Readable.fromWeb(object.body as import('node:stream/web').ReadableStream), createWriteStream(target, { mode: 0o600 }));
    await chmod(target, 0o600);
    copied += 1;
  }
  say(`evidence objects: ${copied} of ${keys.length} copied (${store.driver} store)`);
  if (missing.length > 0) {
    say(`evidence objects: ${missing.length} not found in the store (lines ${missing.slice(0, 10).join(', ')})`);
    process.exitCode = 1;
  }
}

async function sha256OfStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of Readable.fromWeb(body as import('node:stream/web').ReadableStream)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function verify(): Promise<void> {
  const dir = option('--objects');
  const rows = (await stdinLines()).map((line) => {
    const [id = '', key = '', sha256 = ''] = line.split('|');
    return { id, key, sha256 };
  });
  const store = dir ? null : getEvidenceStore();
  let matched = 0;
  const failed: string[] = [];
  for (const row of rows) {
    let actual: string | null = null;
    try {
      if (dir) {
        actual = createHash('sha256')
          .update(await readFile(objectPath(dir, row.key)))
          .digest('hex');
      } else {
        const object = await store!.get(row.key);
        actual = object ? await sha256OfStream(object.body) : null;
      }
    } catch {
      actual = null;
    }
    if (actual !== null && actual === row.sha256) matched += 1;
    else failed.push(`${row.id} (${actual === null ? 'object missing' : 'hash differs'})`);
  }
  const source = dir ? 'the archive copy' : `the ${store!.driver} store`;
  say(`evidence sample: ${matched} of ${rows.length} objects match evidence_file.sha256 (${source})`);
  if (failed.length > 0) {
    for (const line of failed.slice(0, 20)) say(`evidence sample: mismatch ${line}`);
    process.exitCode = 1;
  }
}

async function restore(): Promise<void> {
  const dir = option('--objects');
  if (!dir) throw new Error('restore needs --objects <dir>');
  const rows = (await stdinLines()).map((line) => {
    const [key = '', mime = '', sha256 = ''] = line.split('|');
    return { key, mime, sha256 };
  });
  const store = getEvidenceStore();
  let restored = 0;
  const missing: number[] = [];
  const differ: number[] = [];
  for (const [index, row] of rows.entries()) {
    let body: Buffer;
    try {
      body = await readFile(objectPath(dir, row.key));
    } catch {
      missing.push(index + 1);
      continue;
    }
    const actual = createHash('sha256').update(body).digest('hex');
    if (actual !== row.sha256) {
      differ.push(index + 1);
      continue;
    }
    await store.put(row.key, body, { contentType: row.mime, sha256: actual });
    restored += 1;
  }
  if (differ.length > 0) {
    say(`evidence objects: ${differ.length} refused, their SHA-256 is not evidence_file.sha256 (lines ${differ.slice(0, 10).join(', ')})`);
    process.exitCode = 1;
  }
  say(`evidence objects: ${restored} of ${rows.length} put back into the ${store.driver} store`);
  if (missing.length > 0) {
    say(`evidence objects: ${missing.length} not in the archive copy (lines ${missing.slice(0, 10).join(', ')})`);
    process.exitCode = 1;
  }
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
  if (command === 'copy') return copy();
  if (command === 'verify') return verify();
  if (command === 'restore') return restore();
  if (command === 'fixture') return fixture();
  throw new Error('usage: evidence-objects.ts copy --out <dir> | verify [--objects <dir>] | restore --objects <dir> | fixture [--test-database]');
}

main().catch((error: unknown) => {
  process.stderr.write(`evidence-objects: ${error instanceof Error ? error.message : 'failed'}\n`);
  process.exitCode = 1;
});
