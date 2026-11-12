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

import { getTableName, type InferInsertModel, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Client } from 'pg';

import { demoBilling, seedDay } from '../../fixtures/billing';
import { DEMO_PREMIUM_STUDENT, FIXTURE_SEED, generateFixtures, type Fixtures } from '../../fixtures/generate';
import { encryptTotpSecret, generateBackupCodes, hashAccountPassword } from '../auth/credentials';
import { readExtract } from '../geo/extract-file';
import { loadPlaces } from '../geo/places';
import { recomputeLineageMembership } from '../jobs/lineage-recompute';
import { contentHash, withClient } from './admin';
import { type DemoCertificateFile, writeDemoCertificates } from './seed-certificates';
import { type DemoPhoto, writeDemoPhotos } from './seed-photos';
import { assertNotProduction, assertSafeToReset, redactUrl } from './env';
import {
  auditLog,
  authAccount,
  authSession,
  authThrottle,
  authTwoFactor,
  authUser,
  authVerification,
  billingCheckout,
  billingCustomer,
  billingEvent,
  billingInvoice,
  billingSubscription,
  billingTestSubscription,
  consentRecord,
  contentReport,
  emailDelivery,
  entitlementGrant,
  event,
  eventAttendance,
  eventInstructor,
  evidenceFile,
  evidenceLink,
  invitation,
  lineage,
  lineageMembership,
  notification,
  notificationPreference,
  organization,
  organizationAdmin,
  organizationImport,
  organizationImportRow,
  organizationMemberRecord,
  organizationMembership,
  organizationSchool,
  organizationTeacherClaim,
  passportCertificate,
  passportExam,
  passportRank,
  passportSkill,
  person,
  personBio,
  personClaim,
  personName,
  personNameKey,
  personPhoto,
  pilotAccessRequest,
  place,
  relationshipEvent,
  reviewCase,
  reviewEvent,
  reviewNote,
  school,
  schoolInstructor,
  schoolPhoto,
  schoolPrivateLocation,
  schoolScheduleSlot,
  schoolStatDay,
  teachingRelationship,
  trainingPeriod,
  trialInquiry,
} from './schema';

/** Every application table except audit_log: what db:seed empties before it loads. */
export const RESETTABLE_TABLES: readonly PgTable[] = [
  authAccount,
  authSession,
  authThrottle,
  authTwoFactor,
  authUser,
  authVerification,
  // M22: the demo subscriptions (demoBilling, src/fixtures/generate.ts).
  billingCheckout,
  billingCustomer,
  billingEvent,
  billingInvoice,
  billingSubscription,
  billingTestSubscription,
  consentRecord,
  contentReport,
  emailDelivery,
  entitlementGrant,
  event,
  eventAttendance,
  eventInstructor,
  evidenceFile,
  evidenceLink,
  invitation,
  lineage,
  lineageMembership,
  notification,
  notificationPreference,
  organization,
  organizationAdmin,
  // M24: the organization tools (no demo rows; emptied like every table).
  organizationImport,
  organizationImportRow,
  organizationMemberRecord,
  organizationMembership,
  organizationSchool,
  organizationTeacherClaim,
  passportCertificate,
  passportExam,
  passportRank,
  passportSkill,
  person,
  personBio,
  personClaim,
  personName,
  personNameKey,
  personPhoto,
  pilotAccessRequest,
  place,
  relationshipEvent,
  reviewCase,
  reviewEvent,
  reviewNote,
  school,
  schoolInstructor,
  schoolPhoto,
  schoolPrivateLocation,
  schoolScheduleSlot,
  schoolStatDay,
  teachingRelationship,
  trainingPeriod,
  trialInquiry,
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
  // M11: lineage_membership is computed after the load (the same job the worker runs); its rows
  // are the same on every run, its timestamps are the time of the run.
  lineage_membership: ['computed_at', 'created_at', 'updated_at'],
};

/** M11: the time written on the places of the GeoNames extract by db:seed (fixed, for the content hash). */
const PLACES_LOADED_AT = new Date(Date.UTC(2026, 0, 1));

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
async function load(
  client: Client,
  f: Fixtures,
  creds: CredentialRows,
  photos: readonly DemoPhoto[] = [],
  certificates: readonly DemoCertificateFile[] = [],
): Promise<Record<string, number>> {
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
  // M14: the generated demo photos (seed-photos.ts) and person.photo_id of their people.
  const personIds = new Map(f.persons.map((p) => [p.slug, p.id]));
  const photoRows = photos
    .filter((ph) => (ph.role === 'profile' || ph.role === 'gallery') && personIds.has(ph.slug))
    .map((ph) => ({
      id: ph.id,
      personId: personIds.get(ph.slug)!,
      storageKey: ph.storageKey,
      sha256: ph.sha256,
      originalSha256: ph.originalSha256,
      width: ph.side,
      height: ph.side,
      sizeBytes: ph.sizeBytes,
      // M16: the gallery's other photos beside the profile photo.
      status: ph.role === 'profile' ? ('active' as const) : ('gallery' as const),
      fullWidth: ph.fullWidth,
      fullHeight: ph.fullHeight,
      position: ph.position,
      caption: ph.caption,
      uploadedByUserId: null,
      removedByUserId: null,
      removedAt: null,
      removalReason: null,
      createdAt: ph.createdAt,
      updatedAt: ph.createdAt,
    }));
  await insert(personPhoto, photoRows);
  for (const row of photoRows) if (row.status === 'active') await db.execute(sql`UPDATE person SET photo_id = ${row.id}::uuid WHERE id = ${row.personId}::uuid`);
  await insert(lineage, f.lineages);
  await insert(teachingRelationship, f.relationships);
  await insert(trainingPeriod, f.trainingPeriods);
  await insert(relationshipEvent, f.relationshipEvents);
  await insert(place, f.places);
  // M11: every city of the GeoNames extract (src/server/geo), beside the demo cities above, which
  // keep their ids (the extract only adds their alternate names).
  await loadPlaces(db, readExtract(), PLACES_LOADED_AT);
  counts.place = (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM place`)).rows[0]!.n;
  await insert(school, f.schools);
  await insert(schoolPrivateLocation, f.schoolPrivateLocations);
  await insert(schoolInstructor, f.schoolInstructors);
  // M16: the demo schools' generated logos and room photos (seed-photos.ts).
  const schoolIds = new Map(f.schools.map((sc) => [sc.slug, sc.id]));
  await insert(
    schoolPhoto,
    photos
      .filter((ph) => (ph.role === 'logo' || ph.role === 'room') && schoolIds.has(ph.slug))
      .map((ph) => ({
        id: ph.id,
        schoolId: schoolIds.get(ph.slug)!,
        kind: ph.role as 'logo' | 'room',
        storageKey: ph.storageKey,
        sha256: ph.sha256,
        originalSha256: ph.originalSha256,
        width: ph.side,
        height: ph.side,
        fullWidth: ph.fullWidth,
        fullHeight: ph.fullHeight,
        sizeBytes: ph.sizeBytes,
        caption: ph.caption,
        position: ph.position,
        status: 'active' as const,
        uploadedByUserId: null,
        removedByUserId: null,
        removedAt: null,
        removalReason: null,
        createdAt: ph.createdAt,
        updatedAt: ph.createdAt,
      })),
  );
  await insert(organization, f.organizations);
  await insert(organizationMembership, f.organizationMemberships);
  await insert(organizationAdmin, f.organizationAdmins);
  await insert(reviewCase, f.reviewCases);
  await insert(reviewNote, f.reviewNotes);
  await insert(invitation, f.invitations);
  await insert(entitlementGrant, f.entitlementGrants);
  // M17: the demo events, their generated posters (seed-photos.ts), instructors and the notice.
  const posters = new Map(photos.filter((ph) => ph.role === 'poster').map((ph) => [ph.slug, ph]));
  await insert(
    event,
    f.events.map((e) => {
      const poster = posters.get(e.slug);
      return poster
        ? { ...e, posterStorageKey: poster.storageKey, posterSha256: poster.sha256, posterWidth: poster.fullWidth, posterHeight: poster.fullHeight, posterSizeBytes: poster.sizeBytes }
        : e;
    }),
  );
  await insert(eventInstructor, f.eventInstructors);
  await insert(notification, f.notifications);
  // M18: the demo account's notice e-mail choice.
  await insert(notificationPreference, f.notificationPreferences);
  // M19: the demo passports; a certificate only with its generated files (seed-certificates.ts), in the
  // order of DEMO_CERTIFICATES.
  await insert(passportRank, f.passportRanks);
  await insert(passportExam, f.passportExams);
  await insert(passportSkill, f.passportSkills);
  await insert(
    passportCertificate,
    f.passportCertificates.flatMap((c, i) => {
      const file = certificates[i];
      return file ? [{ ...c, storageKey: file.storageKey, sha256: file.sha256, width: file.width, height: file.height, sizeBytes: file.sizeBytes }] : [];
    }),
  );
  await insert(eventAttendance, f.eventAttendances);
  // M21: demo-school-sofia's schedule, its trial lesson requests and its counters.
  await insert(schoolScheduleSlot, f.schoolScheduleSlots);
  await insert(trialInquiry, f.trialInquiries);
  await insert(schoolStatDay, f.schoolStatDays);
  // M22: the demo subscriptions in test mode, dated around the day of the seed (fixtures/billing.ts).
  const billing = demoBilling(f.seed, { premiumStudent: f.accounts[DEMO_PREMIUM_STUDENT], freeSifu: f.accounts['demo-free-sifu-5'] }, seedDay(new Date()));
  await insert(billingCustomer, billing.billingCustomers);
  await insert(billingCheckout, billing.billingCheckouts);
  await insert(billingTestSubscription, billing.billingTestSubscriptions);
  await db.insert(entitlementGrant).values(billing.entitlementGrants);
  counts.entitlement_grant = (counts.entitlement_grant ?? 0) + billing.entitlementGrants.length;
  await insert(billingSubscription, billing.billingSubscriptions);
  await insert(billingInvoice, billing.billingInvoices);
  await insert(billingEvent, billing.billingEvents);
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
  // M14: the demo photos' files first (the photo store, src/server/storage); without a store that
  // can be written (no SeaweedFS running) the people keep their monogram.
  let photos: DemoPhoto[] = [];
  try {
    photos = await writeDemoPhotos();
  } catch (error) {
    creds.skipped.push(`demo photos (the photo store could not be written: ${error instanceof Error ? error.name : 'error'})`);
  }
  // M19: the demo certificates' files, in the private store; without one the passports have none.
  let certificates: DemoCertificateFile[] = [];
  try {
    certificates = await writeDemoCertificates();
  } catch (error) {
    creds.skipped.push(`demo certificates (the private store could not be written: ${error instanceof Error ? error.name : 'error'})`);
  }
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
        counts = await load(client, fixtures, creds, photos, certificates);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      // M11: lineage_membership of every demo lineage, from the public views only, as the worker's
      // lineage.recompute writes it after a change (src/server/jobs/lineage-recompute.ts).
      const membershipDb = drizzle({ client });
      let members = 0;
      for (const l of fixtures.lineages) members += await recomputeLineageMembership(membershipDb as never, l.id);
      counts.lineage_membership = members;
      // Fresh statistics for the planner after a bulk load.
      await client.query(`ANALYZE ${names}`);
      const hash = await contentHash(client, ALL_TABLE_NAMES, HASH_EXCLUDED_COLUMNS);
      return { seed, counts, hash, skipped: creds.skipped };
    },
    'wingchunroots:seed',
  );
}
