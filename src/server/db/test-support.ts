// Small helpers shared by the integration tests (src/server/db/*.int.test.ts).

import type { Client } from 'pg';

export interface PgError {
  code?: string;
  message: string;
  constraint?: string;
}

/**
 * Awaits a query that must fail and returns the PostgreSQL error (unwrapped from Drizzle's
 * DrizzleQueryError, which keeps the driver error as `cause`).
 */
export async function pgError(query: Promise<unknown>): Promise<PgError> {
  try {
    await query;
  } catch (error) {
    let e = error as PgError & { cause?: unknown };
    while (e.code === undefined && e.cause && typeof e.cause === 'object') e = e.cause as PgError & { cause?: unknown };
    return e;
  }
  throw new Error('expected the query to fail, but it succeeded');
}

/** PostgreSQL error codes used by the tests. */
export const PG = {
  insufficientPrivilege: '42501',
  checkViolation: '23514',
  uniqueViolation: '23505',
} as const;

/** Rows of one query as plain objects. */
export async function rows<T extends Record<string, unknown>>(client: Client, text: string, params: unknown[] = []): Promise<T[]> {
  return (await client.query<T>(text, params)).rows;
}

/** The single value of a one-row, one-column query. */
export async function value<T>(client: Client, text: string, params: unknown[] = []): Promise<T> {
  const result = await client.query(text, params);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`no row: ${text}`);
  return Object.values(row)[0] as T;
}
