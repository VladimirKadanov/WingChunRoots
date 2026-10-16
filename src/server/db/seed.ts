// `pnpm db:seed` (milestone M01, In scope 10): replaces the application data with the
// deterministic fictional demo data of src/fixtures/generate.ts (D20). Never in production.
//
// Runs as the role `migrator` (owner of every table) in one transaction: TRUNCATE of every
// application table except audit_log (append-only, its trigger refuses TRUNCATE), then the
// inserts in foreign-key order. Two runs leave exactly the same content (see contentHash).

import { getTableName, type InferInsertModel } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Client } from 'pg';

import { FIXTURE_SEED, generateFixtures, type Fixtures } from '../../fixtures/generate';
import { contentHash, withClient } from './admin';
import { assertNotProduction, redactUrl } from './env';
import {
  auditLog,
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

const CHUNK = 500;

export interface SeedResult {
  seed: number;
  counts: Record<string, number>;
  hash: string;
}

/** Loads `fixtures` through an open client that is already `migrator`. */
async function load(client: Client, f: Fixtures): Promise<Record<string, number>> {
  const db = drizzle({ client });
  const counts: Record<string, number> = {};
  const insert = async <T extends PgTable>(table: T, rows: readonly InferInsertModel<T>[]) => {
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(table).values(rows.slice(i, i + CHUNK));
    }
    counts[getTableName(table)] = rows.length;
  };
  // Foreign-key order: lineage.root_person_id points at person, relationships at lineages,
  // review cases at relationships, invitations at relationships.
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
  return counts;
}

/** Truncates the application tables and loads the fixtures of `seed` into the database at `url`. */
export async function seedDatabase(url: string, seed: number = FIXTURE_SEED): Promise<SeedResult> {
  assertNotProduction('db:seed');
  const fixtures = generateFixtures(seed);
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
        counts = await load(client, fixtures);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      // Fresh statistics for the planner after a bulk load.
      await client.query(`ANALYZE ${names}`);
      const hash = await contentHash(client, ALL_TABLE_NAMES);
      return { seed, counts, hash };
    },
    'wingchunroots:seed',
  );
}
