import { describe, expect, it } from 'vitest';

import { PSQL_MIN_MAJOR, psqlMajor } from './admin';

describe('psql version check', () => {
  it('reads the major version of `psql --version`', () => {
    expect(psqlMajor('psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)')).toBe(16);
    expect(psqlMajor('psql (PostgreSQL) 14.19 (Ubuntu 14.19-0ubuntu0.22.04.1)')).toBe(14);
    expect(psqlMajor('psql (PostgreSQL) 18.0')).toBe(18);
    expect(psqlMajor('')).toBe(0);
  });

  it('needs psql 15 for \\getenv in scripts/db-bootstrap.sql', () => {
    expect(PSQL_MIN_MAJOR).toBe(15);
    expect(psqlMajor('psql (PostgreSQL) 14.19') < PSQL_MIN_MAJOR).toBe(true);
  });
});
