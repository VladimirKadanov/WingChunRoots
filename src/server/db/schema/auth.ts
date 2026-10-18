// Login accounts (Better Auth 1.7, milestone M02; plan §3.2, §6.2). The tables carry the prefix
// auth_ (Better Auth `modelName`); the property names are Better Auth's field names, so the
// Drizzle adapter maps them without a `fields` table. An account is separate from the archival
// record `person` (DEFAULT D04): a person may have no account, and an account gets a person only at
// onboarding (person.claimed_by_user_id).
//
// Ids are UUIDv7 from the application (Better Auth `advanced.database.generateId` calls
// src/server/db/ids.ts), with gen_random_uuid() as the SQL fallback, like every other table.
// Custom migration *_auth_roles_sessions adds the grants and the triggers that end every session
// of an account when its role changes or when it turns on two-factor authentication.

import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { ACCOUNT_TYPES, idColumn, inList, STAFF_ROLES, timestamps, USER_ROLES } from './common';

export const authUser = pgTable(
  'auth_user',
  {
    id: idColumn(),
    // The account's display name. Empty until onboarding; the names of the person live in
    // person_name (plan §5.3), never here.
    name: text('name').notNull().default(''),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    // Only the server sets it (Better Auth `input: false`): the admin plugin's own role field.
    role: text('role', { enum: USER_ROLES }).notNull().default('user'),
    banned: boolean('banned').notNull().default(false),
    banReason: text('ban_reason'),
    banExpires: timestamp('ban_expires', { withTimezone: true }),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    // IANA time zone for e-mail digests (plan §6.2); null means UTC.
    timezone: text('timezone'),
    // Student or Sifu (M08, plan §6.5): the account's own choice, which sets its free plan
    // (free_student or free_sifu). It verifies nothing (DEFAULT D04). Not a Better Auth field, so
    // sign-up cannot set it; only src/server/services/plans.ts changes it, audited.
    accountType: text('account_type', { enum: ACCOUNT_TYPES }).notNull().default('student'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('auth_user_email_key').on(t.email),
    check('auth_user_role_check', inList(t.role.name, USER_ROLES)),
    // Plan §3.2: admin, moderator and archivist only for an account that has 2FA turned on. The
    // services check it first (src/server/services/roles.ts); this CHECK is the last line.
    check(
      'auth_user_staff_needs_2fa',
      sql`${t.twoFactorEnabled} OR NOT ${inList(t.role.name, STAFF_ROLES)}`,
    ),
    check('auth_user_email_lowercase', sql`${t.email} = lower(${t.email})`),
    // Better Auth's /update-user is switched off and sign-up refuses a name or an image
    // (src/server/auth/hooks.ts); these are the last line: a bounded name, never an image URL
    // (an image would be a link that the app shows, for example a javascript: URL).
    check('auth_user_name_length', sql`char_length(${t.name}) <= 200`),
    check('auth_user_no_image', sql`${t.image} IS NULL`),
    check('auth_user_account_type_check', inList(t.accountType.name, ACCOUNT_TYPES)),
  ],
);

export const authSession = pgTable(
  'auth_session',
  {
    id: idColumn(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull(),
    // ip_hmac = HMAC-SHA-256(IP_HMAC_KEY, IP) in hex, never the address itself (plan §6.4); the
    // column keeps Better Auth's field name.
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    // Admin plugin field. Impersonation is off in M02: its endpoints are in DISABLED_AUTH_PATHS
    // (src/server/auth/config.ts).
    impersonatedBy: uuid('impersonated_by'),
    // Set by hooks.after on /two-factor/verify-totp and /two-factor/verify-backup-code: when this
    // session proved the second factor. requireStaff2FA() checks it (plan §3.2).
    twoFactorVerifiedAt: timestamp('two_factor_verified_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('auth_session_token_key').on(t.token),
    index('auth_session_user_id_idx').on(t.userId),
    index('auth_session_expires_at_idx').on(t.expiresAt),
    check('auth_session_ip_hmac_format', sql`${t.ipAddress} IS NULL OR ${t.ipAddress} ~ '^([0-9a-f]{64})?$'`),
  ],
);

export const authAccount = pgTable(
  'auth_account',
  {
    id: idColumn(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    // scrypt hash with a random salt (Better Auth's `password` field); never the password itself.
    password: text('credential_hash'),
    ...timestamps(),
  },
  (t) => [
    index('auth_account_user_id_idx').on(t.userId),
    uniqueIndex('auth_account_provider_account_key').on(t.providerId, t.accountId),
  ],
);

/**
 * Short-lived values: password reset tokens, the two-factor sign-in challenge, trusted devices.
 * The identifier is stored hashed (Better Auth `verification.storeIdentifier: 'hashed'`).
 */
export const authVerification = pgTable(
  'auth_verification',
  {
    id: idColumn(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    index('auth_verification_identifier_idx').on(t.identifier),
    index('auth_verification_expires_at_idx').on(t.expiresAt),
  ],
);

/** TOTP secret and backup codes, both encrypted with BETTER_AUTH_SECRET (twoFactor plugin). */
export const authTwoFactor = pgTable(
  'auth_two_factor',
  {
    id: idColumn(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('auth_two_factor_user_id_key').on(t.userId),
    check('auth_two_factor_failed_count_check', sql`${t.failedVerificationCount} >= 0`),
  ],
);

/**
 * Counters and one-time markers of the accounts module (src/server/auth/throttle.ts): failed
 * sign-ins per address (a keyed hash of the address, never the address), used TOTP codes (replay)
 * and the like. Not a Better Auth table. A row counts until `expires_at`; the retention job
 * deletes expired rows.
 */
export const authThrottle = pgTable(
  'auth_throttle',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull().default(1),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('auth_throttle_expires_at_idx').on(t.expiresAt),
    check('auth_throttle_key_length', sql`char_length(${t.key}) <= 200`),
    check('auth_throttle_count_check', sql`${t.count} >= 0`),
  ],
);

/** The tables in the shape the Better Auth Drizzle adapter expects: keyed by `modelName`. */
export const AUTH_TABLES = {
  auth_user: authUser,
  auth_session: authSession,
  auth_account: authAccount,
  auth_verification: authVerification,
  auth_two_factor: authTwoFactor,
} as const;
