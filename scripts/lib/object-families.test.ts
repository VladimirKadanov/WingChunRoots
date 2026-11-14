// The object families of the archive (review 2026-11-13, ops.md H1): every table that holds a
// storage key is covered by the backup, the row lines parse, and the SQL has the shape the drill
// and the backup rely on. A new column that looks like a storage key and is neither an
// OBJECT_FAMILIES row nor a NOT_OBJECT_COLUMNS entry fails here, so the archive cannot silently
// leave a new kind of file out again.

import { getTableName, is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import * as schema from '../../src/server/db/schema';
import { familyById, hashedPart, listSql, looksLikeObjectColumn, NOT_OBJECT_COLUMNS, OBJECT_FAMILIES, objectKeys, parseRow } from './object-families';

const SHA = 'a'.repeat(64);
const KEY = `photos/${'0'.repeat(48)}`;

const tables = (Object.values(schema) as unknown[]).filter((value): value is PgTable => is(value, PgTable));

describe('object families: coverage of the schema', () => {
  const found = tables.flatMap((table) =>
    getTableConfig(table)
      .columns.map((column) => ({ table: getTableName(table), column: column.name }))
      .filter(({ column }) => looksLikeObjectColumn(column)),
  );

  it('finds the five known storage-key columns (the detection itself works)', () => {
    expect(found.map((c) => `${c.table}.${c.column}`)).toEqual(
      expect.arrayContaining(['evidence_file.storage_key', 'passport_certificate.storage_key', 'person_photo.storage_key', 'school_photo.storage_key', 'event.poster_storage_key']),
    );
  });

  it('covers every table with a storage key: a backup family or a reason why it is not an object', () => {
    const covered = new Set([...OBJECT_FAMILIES, ...NOT_OBJECT_COLUMNS].map((c) => `${c.table}.${c.column}`));
    const uncovered = found.map((c) => `${c.table}.${c.column}`).filter((id) => !covered.has(id));
    expect(uncovered, 'add each of these to OBJECT_FAMILIES in scripts/lib/object-families.ts (with its SELECT) or, with a reason, to NOT_OBJECT_COLUMNS').toEqual([]);
  });

  it('lists only columns that exist (no stale family or exception)', () => {
    const all = new Set(tables.flatMap((table) => getTableConfig(table).columns.map((c) => `${getTableName(table)}.${c.name}`)));
    for (const entry of [...OBJECT_FAMILIES, ...NOT_OBJECT_COLUMNS]) expect(all.has(`${entry.table}.${entry.column}`), `${entry.table}.${entry.column}`).toBe(true);
  });

  it('gives every NOT_OBJECT_COLUMNS entry a reason and never lists a family column there', () => {
    const families = new Set(OBJECT_FAMILIES.map((f) => `${f.table}.${f.column}`));
    for (const entry of NOT_OBJECT_COLUMNS) {
      expect(entry.reason.length).toBeGreaterThan(10);
      expect(families.has(`${entry.table}.${entry.column}`)).toBe(false);
    }
  });
});

describe('object families: the registry', () => {
  it('has one row per family id, each selecting from its own table and column', () => {
    expect(new Set(OBJECT_FAMILIES.map((f) => f.id)).size).toBe(OBJECT_FAMILIES.length);
    for (const family of OBJECT_FAMILIES) {
      expect(family.select).toContain(`FROM ${family.table} `);
      expect(family.select).toContain(family.column);
      expect(family.select.startsWith(`SELECT '${family.id}|'`)).toBe(true);
      // Only rows that have files now: a family never lists every row of its table.
      expect(family.select).toMatch(/ WHERE /);
    }
  });

  it('keeps the two stores apart by key prefix, so an archive can hold every key as a path', () => {
    const byPrefix = new Map<string, Set<string>>();
    for (const family of OBJECT_FAMILIES) byPrefix.set(family.prefix, (byPrefix.get(family.prefix) ?? new Set()).add(family.store));
    for (const [prefix, stores] of byPrefix) expect([...stores], prefix).toHaveLength(1);
    expect(familyById('evidence')?.store).toBe('evidence');
    expect(familyById('certificate')?.store).toBe('evidence');
    expect(familyById('person_photo')?.store).toBe('media');
    expect(familyById('school_photo')?.store).toBe('media');
    expect(familyById('event_poster')?.store).toBe('media');
  });

  it('says which stored object carries the row hash: the key itself, the 512 px square or the whole image', () => {
    expect(hashedPart(familyById('evidence')!)).toBe('');
    expect(hashedPart(familyById('person_photo')!)).toBe('512');
    expect(hashedPart(familyById('school_photo')!)).toBe('512');
    expect(hashedPart(familyById('certificate')!)).toBe('full');
    expect(hashedPart(familyById('event_poster')!)).toBe('full');
  });
});

describe('object families: row lines', () => {
  it('reads a full line and lists the objects under its key', () => {
    const row = parseRow(`person_photo|11111111-1111-1111-1111-111111111111|${KEY}|${SHA}|image/webp|96,512,full`, 'copy');
    expect(row?.family.id).toBe('person_photo');
    expect(row && objectKeys(row)).toEqual([`${KEY}/96`, `${KEY}/512`, `${KEY}/full`]);
    const legacy = parseRow(`evidence|id-1|evidence/${'1'.repeat(48)}|${SHA}|application/pdf|-`, 'verify');
    expect(legacy && objectKeys(legacy)).toEqual([`evidence/${'1'.repeat(48)}`]);
  });

  it('reads the three M12 evidence-only shapes', () => {
    const key = `evidence/${'2'.repeat(48)}`;
    expect(parseRow(key, 'copy')).toMatchObject({ key, parts: [''] });
    expect(parseRow(`row-1|${key}|${SHA}`, 'verify')).toMatchObject({ id: 'row-1', key, sha256: SHA });
    expect(parseRow(`${key}|application/pdf|${SHA}`, 'restore')).toMatchObject({ key, mime: 'application/pdf', sha256: SHA });
    // A shape of another command is not accepted.
    expect(parseRow(`row-1|${key}|${SHA}`, 'restore')).toMatchObject({ key: 'row-1', mime: key });
    expect(parseRow(key, 'verify')).toBeNull();
  });

  it('refuses a line that is none of them, an unknown family, a bad hash or an inconsistent part list', () => {
    expect(parseRow('', 'copy')).toBeNull();
    expect(parseRow(`nope|id|${KEY}|${SHA}|image/webp|96`, 'copy')).toBeNull();
    expect(parseRow(`person_photo|id|${KEY}|not-a-hash|image/webp|96,512`, 'copy')).toBeNull();
    expect(parseRow(`person_photo|id|${KEY}|${SHA}|image/webp|-`, 'copy')).toBeNull();
    expect(parseRow(`evidence|id|evidence/${'1'.repeat(48)}|${SHA}|application/pdf|96`, 'copy')).toBeNull();
    // The part that carries the hash must be in the list.
    expect(parseRow(`certificate|id|certificates/${'3'.repeat(48)}|${SHA}|image/webp|96,512`, 'copy')).toBeNull();
    expect(parseRow(`person_photo|id|${KEY}|${SHA}|image/webp|96,../../etc`, 'copy')).toBeNull();
  });
});

describe('object families: listSql', () => {
  it('lists every family, ordered, without a sample', () => {
    const sql = listSql();
    for (const family of OBJECT_FAMILIES) expect(sql).toContain(`FROM ${family.table} `);
    expect(sql).not.toMatch(/LIMIT/);
    expect(sql.match(/UNION ALL/g)).toHaveLength(OBJECT_FAMILIES.length - 1);
  });

  it('takes a random sample of each family, or one family', () => {
    const sql = listSql({ sample: 7 });
    expect(sql.match(/ORDER BY random\(\) LIMIT 7/g)).toHaveLength(OBJECT_FAMILIES.length);
    expect(listSql({ only: 'event_poster' })).toContain('FROM event ');
    expect(listSql({ only: 'event_poster' })).not.toContain('UNION ALL');
  });

  it('refuses an unknown family and a sample that is not a whole number of at least 1', () => {
    expect(() => listSql({ only: 'nope' })).toThrow();
    expect(() => listSql({ sample: 0 })).toThrow();
    expect(() => listSql({ sample: 1.5 })).toThrow();
    expect(() => listSql({ sample: Number('x') })).toThrow();
  });
});
