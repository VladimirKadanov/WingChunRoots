// purgeUnconfirmedAccounts keeps an account another row refers to, whichever SQLSTATE the server
// reports for the RESTRICT foreign key: 23503 up to PostgreSQL 17, 23001 from PostgreSQL 18. The
// integration test covers the real database of each environment (16 in a cloud session, 18 in CI);
// this one covers both codes everywhere.

import { describe, expect, it } from 'vitest';

import type { Database } from '../db';
import { purgeUnconfirmedAccounts } from './retention';

function databaseRefusing(code: string): Database {
  let listed = false;
  const db = {
    execute: async () => {
      if (listed) return { rows: [] };
      listed = true;
      return { rows: [{ id: '01890000-0000-7000-8000-000000000001' }] };
    },
    transaction: async () => {
      // As drizzle reports it: a DrizzleQueryError with the driver's error as its cause.
      throw Object.assign(new Error('Failed query: DELETE FROM auth_user'), { cause: { code } });
    },
  };
  return db as unknown as Database;
}

describe('purgeUnconfirmedAccounts', () => {
  it.each(['23503', '23001'])('keeps and counts an account that another row refers to (SQLSTATE %s)', async (code) => {
    expect(await purgeUnconfirmedAccounts(databaseRefusing(code), { batchSize: 10 })).toEqual({ accounts: 0, kept: 1 });
  });

  it('passes any other database error on', async () => {
    await expect(purgeUnconfirmedAccounts(databaseRefusing('57014'), { batchSize: 10 })).rejects.toThrow(/Failed query/);
  });
});
