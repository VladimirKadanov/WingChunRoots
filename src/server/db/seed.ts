// `pnpm db:seed` (milestone M01, In scope 10): replaces the application data with the
// deterministic fictional demo data of src/fixtures/generate.ts (D20). Never in production.
//
// Runs as the role `migrator` (owner of every table) in one transaction: TRUNCATE of every
// application table except audit_log (append-only, its trigger refuses TRUNCATE), then the
// inserts in foreign-key order. Two runs leave exactly the same content (see contentHash).
//
// From M02 it also creates the demo sign-in accounts (auth_user) linked to anchor records. Their
// credentials come from the environment and are test-only (In scope 9): the password of every
// account from E2E_PASSWORD, the TOTP secret of the staff accounts from E2E_TOTP_SECRET, encrypted
// with BETTER_AUTH_SECRET. Without them the accounts exist but nobody can sign in as them. The
// content hash leaves out the columns that hold a random salt or nonce (HASH_EXCLUDED_COLUMNS).

import { getTableName, type InferInsertModel } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Client } from 'pg';

import { FIXTURE_SEED, generateFixtures, type Fixtures } from '../../fixtures/generate';
import { encryptTotpSecret, generateBackupCodes, hashAccountPassword } from '../auth/credentials';
import { contentHash, withClient } from './admin';
import { assertNotProduction, assertSafeToReset, redactUrl } from './env';
import {
  auditLog,
  authAccount,
  authSession,
  authThrottle,
  authTwoFactor,
  authUser,
  authVerification,
  consentRecord,
  contentReport,
  emailDelivery,
  entitlementGrant,
  evidenceFile,
  evidenceLink,
  invitation,
  lineage,
  lineageMembership,
  notification,
  organization,
  organizationMembership,
  person,
  personBio,
  personClaim,
  personName,
  personNameKey,
  pilotAccessRequest,
  place,
  relationshipEvent,
  reviewCase,
  reviewNote,
  school,
  schoolInstructor,
  schoolPrivateLocation,
  teachingRelationship,
  trainingPeriod,
} from './schema';

/** Every application table except audit_log: what db:seed empties before it loads. */
export const RESETTABLE_TABLES: readonly PgTable[] = [
  authAccount,
  authSession,
  authThrottle,
  authTwoFactor,
  authUser,
  authVerification,
  consentRecord,
  contentReport,
  emailDelivery,
  entitlementGrant,
  evidenceFile,
  evidenceLink,
  invitation,
  lineage,
  lineageMembership,
  notification,
  organization,
  organizationMembership,
  person,
  personBio,
  personClaim,
  personName,
  personNameKey,
  pilotAccessRequest,
  place,
  relationshipEvent,
  reviewCase,
  reviewNote,
  school,
  schoolInstructor,
  schoolPrivateLocation,
  teachingRelationship,
  trainingPeriod,
];

/** Every application table, sorted by name: the input of the content hash. */
export const ALL_TABLE_NAMES: readonly string[] = [...RESETTABLE_TABLES, auditLog].map((t) => getTableName(t)).sort();

/**
 * Columns the content hash leaves out: a scrypt hash with a random salt and values encrypted with
 * a random nonce differ on every load, although they hold the same secret.
 */
export const HASH_EXCLUDED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  auth_account: ['credential_hash'],
  auth_two_factor: ['secret', 'backup_codes'],
};

const CHUNK = 500;

/** Test-only credentials of the demo accounts (In scope 9 of M02); never real secrets. */
export interface DemoCredentials {
  /** E2E_PASSWORD: the password of every demo account. */
  password?: string | undefined;
  /** E2E_TOTP_SECRET: the TOTP secret of the staff accounts. */
  totpSecret?: string | undefined;
  /** BETTER_AUTH_SECRET: the key Better Auth encrypts the TOTP secret with. */
  authSecret?: string | undefined;
}

export function demoCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): DemoCredentials {
  return { password: env.E2E_PASSWORD || undefined, totpSecret: env.E2E_TOTP_SECRET || undefined, authSecret: env.BETTER_AUTH_SECRET || undefined };
}

export interface SeedResult {
  seed: number;
  counts: Record<string, number>;
  hash: string;
  /** What could not be created for lack of a variable (the accounts exist without it). */
  skipped: string[];
}

interface CredentialRows {
  credentials: InferInsertModel<typeof authAccount>[];
  twoFactors: InferInsertModel<typeof authTwoFactor>[];
  skipped: string[];
}

/** The password hashes and encrypted TOTP secrets of the demo accounts, before the transaction. */
async function credentialRows(f: Fixtures, creds: DemoCredentials): Promise<CredentialRows> {
  const skipped: string[] = [];
  let credentials: CredentialRows['credentials'] = [];
  let twoFactors: CredentialRows['twoFactors'] = [];
  if (creds.password) {
    credentials = await Promise.all(f.credentials.map(async (c) => ({ ...c, password: await hashAccountPassword(creds.password!) })));
  } else {
    skipped.push('passwords (E2E_PASSWORD is not set)');
  }
  if (creds.totpSecret && creds.authSecret) {
    const secret = await encryptTotpSecret(creds.totpSecret, creds.authSecret);
    twoFactors = await Promise.all(
      f.twoFactors.map(async (t) => ({ ...t, secret, backupCodes: (await generateBackupCodes(creds.authSecret!)).encrypted })),
    );
  } else {
    skipped.push('staff TOTP secrets (E2E_TOTP_SECRET or BETTER_AUTH_SECRET is not set)');
  }
  return { credentials, twoFactors, skipped };
}

/** Loads `fixtures` through an open client that is already `migrator`. */
async function load(client: Client, f: Fixtures, creds: CredentialRows): Promise<Record<string, number>> {
  const db = drizzle({ client });
  const counts: Record<string, number> = {};
  const insert = async <T extends PgTable>(table: T, rows: readonly InferInsertModel<T>[]) => {
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(table).values(rows.slice(i, i + CHUNK));
    }
    counts[getTableName(table)] = rows.length;
  };
  // Foreign-key order: person.claimed_by_user_id points at auth_user, lineage.root_person_id at
  // person, relationships at lineages, review cases at relationships, invitations at relationships.
  await insert(authUser, f.users);
  await insert(consentRecord, f.consentRecords);
  await insert(authAccount, creds.credentials);
  await insert(authTwoFactor, creds.twoFactors);
  await insert(person, f.persons);
  await insert(personName, f.personNames);
  await insert(personBio, f.personBios);
  await insert(lineage, f.lineages);
  await insert(teachingRelationship, f.relationships);
  await insert(trainingPeriod, f.trainingPeriods);
  await insert(relationshipEvent, f.relationshipEvents);
  await insert(place, f.places);
  await insert(school, f.schools);
  await insert(schoolPrivateLocation, f.schoolPrivateLocations);
  await insert(schoolInstructor, f.schoolInstructors);
  await insert(organization, f.organizations);
  await insert(organizationMembership, f.organizationMemberships);
  await insert(reviewCase, f.reviewCases);
  await insert(reviewNote, f.reviewNotes);
  await insert(invitation, f.invitations);
  await insert(entitlementGrant, f.entitlementGrants);
  return counts;
}

/** Truncates the application tables and loads the fixtures of `seed` into the database at `url`. */
export async function seedDatabase(
  url: string,
  seed: number = FIXTURE_SEED,
  credentials: DemoCredentials = demoCredentialsFromEnv(),
): Promise<SeedResult> {
  assertNotProduction('db:seed');
  // It empties every application table first: like db:reset, only a local or the test database.
  assertSafeToReset(url, process.env, 'db:seed');
  const fixtures = generateFixtures(seed);
  const creds = await credentialRows(fixtures, credentials);
  return withClient(
    url,
    async (client) => {
      try {
        await client.query('SET ROLE migrator');
      } catch (error) {
        throw new Error(
          `cannot SET ROLE migrator on ${redactUrl(url)} (${(error as Error).message}). ` +
            'Run scripts/db-bootstrap.sh and pnpm db:migrate first.',
        );
      }
      await client.query('BEGIN');
      const names = RESETTABLE_TABLES.map((t) => `"${getTableName(t)}"`).join(', ');
      let counts: Record<string, number>;
      try {
        await client.query(`TRUNCATE TABLE ${names}`);
        counts = await load(client, fixtures, creds);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      // Fresh statistics for the planner after a bulk load.
      await client.query(`ANALYZE ${names}`);
      const hash = await contentHash(client, ALL_TABLE_NAMES, HASH_EXCLUDED_COLUMNS);
      return { seed, counts, hash, skipped: creds.skipped };
    },
    'wingchunroots:seed',
  );
}
