// The archive covers every object family (review 2026-11-13, ops.md H1; scripts/lib/object-families.ts)
// against a migrated and seeded database: the SQL that lists the objects runs, lists the rows that
// have files and no others, and every listed object is in its store with the hash the row carries
// (the demo photos, school photos, event posters and certificates are the seed's real files).

import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { copyObjects, type StoreResolver, verifyObjects } from '../../scripts/lib/object-archive';
import { listSql, looksLikeObjectColumn, NOT_OBJECT_COLUMNS, OBJECT_FAMILIES, type ObjectRow, parseRow } from '../../scripts/lib/object-families';
import { withClient } from './db/admin';
import { rows, value } from './db/test-support';
import { createTestDatabase, type TestDatabase } from './db/testing';
import { getEvidenceStore, getPhotoStore } from './storage';

let db: TestDatabase;
let workdir: string;
const stores: StoreResolver = (name) => (name === 'media' ? getPhotoStore() : getEvidenceStore());

beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
  workdir = await mkdtemp(path.join(tmpdir(), 'wcr-archive-'));
});

afterAll(async () => {
  await db?.drop();
  if (workdir) await rm(workdir, { recursive: true, force: true });
});

/** The listed rows, as the backup reads them (psql -t -A output, here through pg). */
async function listed(sql = listSql()): Promise<ObjectRow[]> {
  const lines = await withClient(db.url, async (c) => (await rows<{ line: string }>(c, sql)).map((r) => r.line));
  return lines.map((line) => {
    const row = parseRow(line, 'copy');
    if (!row) throw new Error('the list holds a line that is not an object row');
    return row;
  });
}

const count = (list: ObjectRow[], family: string) => list.filter((row) => row.family.id === family).length;

describe('the migrated database and the object families', () => {
  it('has no column that looks like a storage key outside OBJECT_FAMILIES or NOT_OBJECT_COLUMNS', async () => {
    const found = await withClient(db.url, async (c) =>
      (await rows<{ table_name: string; column_name: string }>(c, "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name NOT LIKE 'v\\_%' ORDER BY 1, 2")).filter((r) =>
        looksLikeObjectColumn(r.column_name),
      ),
    );
    const covered = new Set([...OBJECT_FAMILIES, ...NOT_OBJECT_COLUMNS].map((c) => `${c.table}.${c.column}`));
    expect(found.map((r) => `${r.table_name}.${r.column_name}`).filter((id) => !covered.has(id))).toEqual([]);
    for (const family of OBJECT_FAMILIES) expect(found.map((r) => `${r.table_name}.${r.column_name}`)).toContain(`${family.table}.${family.column}`);
  });

  it('runs the listing SQL of every family and of the sample', async () => {
    for (const family of OBJECT_FAMILIES) await expect(listed(listSql({ only: family.id }))).resolves.toBeDefined();
    await expect(listed(listSql({ sample: 3 }))).resolves.toBeDefined();
  });
});

describe('what the archive lists in the seeded database', () => {
  let evidenceKey: string;

  beforeAll(async () => {
    // One fictional evidence file with its object (the seed has none).
    const bytes = Buffer.from('%PDF-1.4\n% demo evidence for the archive test (fictional)\n%%EOF\n');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    evidenceKey = `evidence/${createHash('sha256').update(`archive-test-${db.name}`).digest('hex').slice(0, 48)}`;
    await getEvidenceStore().put(evidenceKey, bytes, { contentType: 'application/pdf', sha256 });
    await withClient(db.url, (c) =>
      c.query("INSERT INTO evidence_file (storage_key, sha256, mime, size_bytes, scan_status, original_name) VALUES ($1, $2, 'application/pdf', $3, 'clean', 'demo-archive-test.pdf')", [evidenceKey, sha256, bytes.length]),
    );
  });

  it('lists rows of every family (the seed holds photos, logos, posters and certificates)', async () => {
    const list = await listed();
    for (const family of OBJECT_FAMILIES) expect(count(list, family.id), family.id).toBeGreaterThan(0);
  });

  it('finds every listed object in its store, with the SHA-256 the row carries', async () => {
    const list = await listed();
    const checked = await verifyObjects(list, { stores });
    expect(checked.problems).toEqual([]);
    expect(checked.tallies.reduce((sum, t) => sum + t.ok, 0)).toBe(list.length);
  });

  it('copies them into an archive folder and verifies the copy there', async () => {
    const list = await listed();
    const out = path.join(workdir, 'objects');
    const copied = await copyObjects(list, stores, out);
    expect(copied.problems).toEqual([]);
    const checked = await verifyObjects(list, { dir: out });
    expect(checked.problems).toEqual([]);
    expect(checked.tallies.reduce((sum, t) => sum + t.rows, 0)).toBe(list.length);
  });

  it('lists a sample of each family, never more than asked for', async () => {
    const list = await listed(listSql({ sample: 1 }));
    for (const family of OBJECT_FAMILIES) expect(count(list, family.id), family.id).toBeLessThanOrEqual(1);
    expect(list.length).toBeGreaterThanOrEqual(OBJECT_FAMILIES.length);
  });

  it('does not list rows whose files were deleted: replaced or removed photos, withdrawn certificates, removed posters, deleted evidence', async () => {
    const before = await listed();
    await withClient(db.url, async (c) => {
      await c.query("UPDATE person_photo SET status = 'removed', removed_at = now() WHERE id = (SELECT id FROM person_photo WHERE status = 'active' ORDER BY id LIMIT 1)");
      await c.query("UPDATE school_photo SET status = 'replaced' WHERE id = (SELECT id FROM school_photo WHERE status = 'active' ORDER BY id LIMIT 1)");
      await c.query("UPDATE passport_certificate SET status = 'withdrawn', withdrawn_at = now() WHERE id = (SELECT id FROM passport_certificate WHERE status = 'active' ORDER BY id LIMIT 1)");
      await c.query(
        "UPDATE event SET poster_storage_key = NULL, poster_sha256 = NULL, poster_width = NULL, poster_height = NULL, poster_size_bytes = NULL WHERE id = (SELECT id FROM event WHERE poster_storage_key IS NOT NULL ORDER BY id LIMIT 1)",
      );
      await c.query('UPDATE evidence_file SET deleted_at = now() WHERE storage_key = $1', [evidenceKey]);
    });
    const after = await listed();
    for (const family of OBJECT_FAMILIES) expect(count(after, family.id), family.id).toBe(count(before, family.id) - 1);
  });

  it('counts the same rows the database has with files: person photos by status', async () => {
    const list = await listed();
    const expected = await withClient(db.url, (c) => value<string>(c, "SELECT count(*) FROM person_photo WHERE status IN ('active', 'gallery')"));
    expect(count(list, 'person_photo')).toBe(Number(expected));
  });
});
