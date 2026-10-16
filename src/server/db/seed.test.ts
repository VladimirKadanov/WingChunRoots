import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import * as schema from './schema';
import { ALL_TABLE_NAMES, RESETTABLE_TABLES } from './seed';

describe('db:seed table lists', () => {
  const schemaTables = (Object.values(schema) as unknown[])
    .filter((value): value is PgTable => is(value, PgTable))
    .map((t) => getTableName(t))
    .sort();

  it('covers every table of the schema, so a new table is emptied and hashed too', () => {
    expect(schemaTables.length).toBeGreaterThanOrEqual(27);
    expect([...ALL_TABLE_NAMES]).toEqual(schemaTables);
  });

  it('never empties the append-only audit log', () => {
    expect(RESETTABLE_TABLES.map((t) => getTableName(t))).not.toContain('audit_log');
    expect(RESETTABLE_TABLES).toHaveLength(schemaTables.length - 1);
  });
});
