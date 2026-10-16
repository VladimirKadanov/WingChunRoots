// Migrations and database structure (milestone M01, Done when 2), on PostgreSQL 16 (cloud
// session) and 18 (CI).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { appliedMigrations, migrateDatabase, migrationNames, runDrizzleKit, withClient } from './admin';
import { rows, value } from './test-support';
import { createTestDatabase, type TestDatabase } from './testing';

let db: TestDatabase;
let appliedOnEmpty: string[];

beforeAll(async () => {
  db = await createTestDatabase({ migrate: false });
  appliedOnEmpty = await migrateDatabase(db.url);
});

afterAll(async () => {
  await db?.drop();
});

const q = <T extends Record<string, unknown>>(text: string, params: unknown[] = []) => withClient(db.url, (c) => rows<T>(c, text, params));
const one = <T>(text: string, params: unknown[] = []) => withClient(db.url, (c) => value<T>(c, text, params));

describe('migrations', () => {
  it('apply in order to an empty database', async () => {
    expect(appliedOnEmpty).toEqual(migrationNames());
    expect(appliedOnEmpty.length).toBeGreaterThanOrEqual(1);
    expect(await withClient(db.url, appliedMigrations)).toEqual(migrationNames());
  });

  it('apply nothing on a second run', async () => {
    expect(await migrateDatabase(db.url)).toEqual([]);
  });

  it('have no conflicts according to drizzle-kit check', () => {
    const result = runDrizzleKit(['check', '--output', 'json']);
    expect(result.status).toBe(0);
    const json = result.stdout.split('\n').find((l) => l.trim().startsWith('{'));
    expect(JSON.parse(json ?? '{}')).toMatchObject({ status: 'ok' });
  });

  it('run on PostgreSQL 16 or newer with PostGIS 3.4 or newer', async () => {
    expect(Number(await one<string>('SHOW server_version_num'))).toBeGreaterThanOrEqual(160000);
    const postgis = await one<string>("SELECT extversion FROM pg_extension WHERE extname = 'postgis'");
    const [major, minor] = postgis.split('.').map(Number);
    expect(major! * 100 + minor!).toBeGreaterThanOrEqual(304);
  });

  it('create the extensions postgis, pg_trgm, unaccent and fuzzystrmatch', async () => {
    const names = (await q<{ extname: string }>('SELECT extname FROM pg_extension')).map((r) => r.extname);
    expect(names).toEqual(expect.arrayContaining(['postgis', 'pg_trgm', 'unaccent', 'fuzzystrmatch']));
  });

  it('leave every application object owned by migrator', async () => {
    const owners = await q<{ relname: string; owner: string }>(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'S')
          -- PostGIS (spatial_ref_sys) belongs to the superuser who created the extension.
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')`,
    );
    expect(owners.length).toBeGreaterThanOrEqual(30);
    expect(owners.filter((o) => o.owner !== 'migrator')).toEqual([]);
  });
});

describe('the UTF-8 locale', () => {
  it('extracts trigrams from Cyrillic and Chinese (show_trgm)', async () => {
    expect((await one<string[]>("SELECT show_trgm('Тестов')")).length).toBeGreaterThan(0);
    expect((await one<string[]>("SELECT show_trgm('蘇晴嵐')")).length).toBeGreaterThan(0);
    expect(await one<string>("SELECT pg_encoding_to_char(encoding) FROM pg_database WHERE datname = current_database()")).toBe('UTF8');
  });
});

describe('structure', () => {
  it('stores the three points as geography(Point,4326) with a GiST index', async () => {
    for (const [table, column] of [
      ['place', 'centroid'],
      ['school', 'public_point'],
      ['school_private_location', 'exact_point'],
    ] as const) {
      const type = await one<string>(
        `SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
          WHERE a.attrelid = $1::regclass AND a.attname = $2`,
        [table, column],
      );
      expect(type).toBe('geography(Point,4326)');
      const gist = await one<number>(
        `SELECT count(*)::int FROM pg_indexes WHERE tablename = $1 AND indexdef LIKE '%USING gist (' || $2 || ')%'`,
        [table, column],
      );
      expect(gist, `${table}.${column}`).toBe(1);
    }
  });

  it('has the covering indexes, the partial unique index and the name-key indexes', async () => {
    const defs = (await q<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'")).map((r) => r.indexdef);
    expect(defs).toContainEqual(expect.stringMatching(/\(student_person_id\) INCLUDE \(teacher_person_id, status, lineage_id\)/));
    expect(defs).toContainEqual(expect.stringMatching(/\(teacher_person_id\) INCLUDE \(student_person_id, status, lineage_id\)/));
    expect(defs).toContainEqual(expect.stringMatching(/UNIQUE INDEX .* ON public\.teaching_relationship .*\(teacher_person_id, student_person_id, lineage_id\) WHERE/));
    expect(defs).toContainEqual(expect.stringMatching(/person_name_key USING gin \(key gin_trgm_ops\)/));
    expect(defs).toContainEqual(expect.stringMatching(/person_name_key USING btree \(key text_pattern_ops\)/));
  });

  it('uses gen_random_uuid() as the id fallback and never uuidv7()', async () => {
    const defaults = await q<{ table_name: string; column_default: string | null }>(
      `SELECT c.table_name, c.column_default FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.column_name = 'id' AND c.data_type = 'uuid'`,
    );
    expect(defaults.length).toBeGreaterThan(15);
    for (const d of defaults) expect(d.column_default, d.table_name).toBe('gen_random_uuid()');
  });

  it('has no Better Auth tables and no media_asset (M02, Phase 2)', async () => {
    const tables = (await q<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).map((r) => r.tablename);
    for (const t of ['user', 'session', 'account', 'verification', 'media_asset']) expect(tables).not.toContain(t);
    expect(tables).toEqual(expect.arrayContaining(['person', 'teaching_relationship', 'school_private_location', 'audit_log', 'evidence_file']));
  });

  it('keeps *_user_id columns as uuid without a foreign key until M02', async () => {
    const fks = await q<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND a.attname LIKE '%user_id'`,
    );
    expect(fks).toEqual([]);
  });
});
