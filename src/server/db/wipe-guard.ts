// The data check of the destructive db:* commands (review 2026-11-13, ops.md H2).
//
// `pnpm db:seed` empties every application table and `pnpm db:reset` drops them all. Their first
// guard (assertSafeToReset in ./env.ts) asks where the database is: a loopback host passes. On a
// single-VPS Compose host the real database IS on loopback, so that guard alone lets both commands
// erase it, and docs/operations/local-run.md used to tell the operator to run `pnpm db:seed` there.
//
// This second guard asks what the database holds. Both commands refuse when it holds anything that
// is not clearly demo data (CLAUDE.md §7: demo slugs start with `demo-`, demo accounts live in the
// reserved `.test` domain), unless the operator sets WCR_ALLOW_WIPE=1. Demo data goes into a
// separate database, never the real one.
//
// Nothing here reads or prints a name, an address or a slug: only counts (CLAUDE.md §6).
// Integration and E2E flows that reset their own databases create them empty, so they pass; the
// one flow that resets a database that already holds test rows, scripts/verify.sh (test database
// only), sets WCR_ALLOW_WIPE=1 for that single command.

import type { Client } from 'pg';

import { redactUrl } from './env';

type Env = Record<string, string | undefined>;

/** The explicit, loudly named variable that lets a destructive command wipe a database with real-looking data. */
export const ALLOW_WIPE_VARIABLE = 'WCR_ALLOW_WIPE';

/**
 * The tables that carry a slug, with the rule for demo data: the slug starts with `demo-`
 * (CLAUDE.md §7; every seeded and every test fixture row does). `person` is the one that holds the
 * real historical teachers a staging database is for; the others catch a database that has only a
 * real school, lineage, organization or event.
 */
export const DEMO_SLUG_TABLES = ['person', 'school', 'organization', 'lineage', 'event'] as const;

export interface NonDemoFindings {
  /** Rows per DEMO_SLUG_TABLES table whose slug does not start with `demo-`. */
  bySlug: Record<(typeof DEMO_SLUG_TABLES)[number], number>;
  /** Accounts whose address is not in the reserved `.test` top-level domain (RFC 2606). */
  accounts: number;
}

export type WipeVerdict =
  | { allowed: true; via: 'demo-only' | typeof ALLOW_WIPE_VARIABLE }
  | { allowed: false; message: string };

const TABLE_WORDS: Record<(typeof DEMO_SLUG_TABLES)[number], [string, string]> = {
  person: ['person', 'people'],
  school: ['school', 'schools'],
  organization: ['organization', 'organizations'],
  lineage: ['lineage', 'lineages'],
  event: ['event', 'events'],
};

/** What is not demo data, in words and numbers only ("2 people whose slug does not start with demo-, 1 account outside .test"). */
export function describeFindings(findings: NonDemoFindings): string[] {
  const parts: string[] = [];
  for (const table of DEMO_SLUG_TABLES) {
    const n = findings.bySlug[table];
    if (n > 0) parts.push(`${n} ${TABLE_WORDS[table][n === 1 ? 0 : 1]} whose slug does not start with demo-`);
  }
  if (findings.accounts > 0) parts.push(`${findings.accounts} ${findings.accounts === 1 ? 'account' : 'accounts'} whose address is not in the reserved .test domain`);
  return parts;
}

export const hasNonDemoData = (findings: NonDemoFindings): boolean => describeFindings(findings).length > 0;

/**
 * The decision, with no database in it: demo data only (or nothing) passes; anything else passes only
 * with WCR_ALLOW_WIPE=1 (exactly "1": "true" or "yes" are not enough, so it is never set by accident).
 * `target` is the redacted URL, for the message.
 */
export function wipeVerdict(command: string, target: string, findings: NonDemoFindings, env: Env = process.env): WipeVerdict {
  const found = describeFindings(findings);
  if (found.length === 0) return { allowed: true, via: 'demo-only' };
  if (env[ALLOW_WIPE_VARIABLE] === '1') return { allowed: true, via: ALLOW_WIPE_VARIABLE };
  return {
    allowed: false,
    message:
      `${command} refuses ${target}: it holds data that is not demo data (${found.join('; ')}). ` +
      `${command} ${command === 'db:reset' ? 'drops every application table' : 'empties every application table'}. ` +
      'This looks like a real database: load demo data into a separate database, never into the real one ' +
      '(docs/operations/local-run.md). To wipe it anyway, once you have a backup you have restored successfully, ' +
      `set ${ALLOW_WIPE_VARIABLE}=1 for this one command.`,
  };
}

const SLUG_QUERIES = DEMO_SLUG_TABLES.map(
  (table) => `SELECT '${table}' AS name, CASE WHEN to_regclass('public.${table}') IS NULL THEN 0 ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM public.${table} WHERE left(slug, 5) <> ''demo-''', false, true, '')))[1]::text::bigint END AS n`,
);
const ACCOUNT_QUERY = `SELECT 'account' AS name, CASE WHEN to_regclass('public.auth_user') IS NULL THEN 0 ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM public.auth_user WHERE lower(email) !~ ''@[^@]+\\.test$''', false, true, '')))[1]::text::bigint END AS n`;

/**
 * Counts what in the database is not demo data. A table that does not exist (an empty or an
 * unmigrated database) holds nothing. Reads counts only, as the connected role (a superuser for
 * db:reset, migrator for db:seed): a role that cannot read a table makes the command fail, never pass.
 */
export async function findNonDemoData(client: Pick<Client, 'query'>): Promise<NonDemoFindings> {
  const { rows } = await client.query<{ name: string; n: string }>([...SLUG_QUERIES, ACCOUNT_QUERY].join(' UNION ALL '));
  const count = (name: string) => Number(rows.find((r) => r.name === name)?.n ?? 0);
  return {
    bySlug: Object.fromEntries(DEMO_SLUG_TABLES.map((table) => [table, count(table)])) as NonDemoFindings['bySlug'],
    accounts: count('account'),
  };
}

/**
 * Throws unless `command` may wipe the database `client` is connected to (see the top of this file).
 * Returns how it was allowed, so the command can say so when WCR_ALLOW_WIPE=1 overrode a refusal.
 */
export async function assertWipeAllowed(
  client: Pick<Client, 'query'>,
  command: string,
  url: string,
  options: { env?: Env; quiet?: boolean } = {},
): Promise<WipeVerdict & { allowed: true }> {
  const verdict = wipeVerdict(command, redactUrl(url), await findNonDemoData(client), options.env ?? process.env);
  if (!verdict.allowed) throw new Error(verdict.message);
  if (verdict.via === ALLOW_WIPE_VARIABLE && !options.quiet) {
    console.warn(`${command}: ${ALLOW_WIPE_VARIABLE}=1 is set: wiping ${redactUrl(url)}, which holds data that is not demo data`);
  }
  return verdict;
}
