// Unit tests of the pg-boss schema step's pure parts (milestone M01b, In scope 1).

import { createRequire } from 'node:module';

import { getConstructionPlans, getMigrationPlans } from 'pg-boss';
import { describe, expect, it } from 'vitest';

import { constructionPlanVersion, PGBOSS_GRANTS, PGBOSS_SCHEMA, PGBOSS_SCHEMA_VERSION, splitMigrationScript } from './schema';

describe('the pinned pg-boss', () => {
  it('names the schema version that its package.json declares and its construction plan installs', () => {
    const declared = (createRequire(import.meta.url)('pg-boss/package.json') as { pgboss: { schema: number } }).pgboss.schema;
    expect(PGBOSS_SCHEMA_VERSION).toBe(declared);
    expect(getConstructionPlans(PGBOSS_SCHEMA)).toContain(`INSERT INTO ${PGBOSS_SCHEMA}.version(version) VALUES ('${PGBOSS_SCHEMA_VERSION}')`);
  });

  it('constructionPlanVersion refuses a plan without a version', () => {
    expect(() => constructionPlanVersion('CREATE SCHEMA x;')).toThrow(/no schema version/);
  });
});

describe('splitMigrationScript', () => {
  it('keeps the transaction whole and sends each CREATE INDEX CONCURRENTLY on its own', () => {
    const script = getMigrationPlans(PGBOSS_SCHEMA, PGBOSS_SCHEMA_VERSION - 1);
    const { transaction, concurrent } = splitMigrationScript(script);
    expect(transaction.trimStart()).toMatch(/^BEGIN;/);
    expect(transaction.trimEnd()).toMatch(/COMMIT;$/);
    expect(transaction).not.toMatch(/CONCURRENTLY/);
    for (const statement of concurrent) {
      expect(statement).toMatch(/CREATE INDEX CONCURRENTLY/);
      expect(statement).not.toMatch(/;\s*\S/);
    }
  });

  it('returns a script without a COMMIT as one piece', () => {
    expect(splitMigrationScript('SELECT 1;')).toEqual({ transaction: 'SELECT 1;', concurrent: [] });
  });

  it('drops chunks that hold only comments', () => {
    const script = 'BEGIN;\nSELECT 1;\nCOMMIT;\n-- inlined\nCREATE INDEX CONCURRENTLY a ON t (x);\n-- trailing comment\n';
    expect(splitMigrationScript(script).concurrent).toEqual(['-- inlined\nCREATE INDEX CONCURRENTLY a ON t (x)']);
  });
});

describe('PGBOSS_GRANTS', () => {
  it('grants app_rw usage and DML only, never CREATE, and nothing to app_public_ro', () => {
    const text = PGBOSS_GRANTS.join('\n');
    expect(text).not.toMatch(/\bCREATE\b/);
    expect(text).not.toMatch(/app_public_ro/);
    expect(text).toMatch(/GRANT USAGE ON SCHEMA pgboss TO app_rw/);
    expect(text).toMatch(/REVOKE ALL ON SCHEMA pgboss FROM PUBLIC/);
  });
});
