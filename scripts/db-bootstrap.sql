-- scripts/db-bootstrap.sql — database roles and per-database setup (plan §6.2, milestone M01).
--
-- Run by a superuser, once per environment and once per database (locally for `wingchunroots`
-- and `wingchunroots_test`; in CI and in the cloud session for `wingchunroots_test`). Use the
-- wrapper, which reads the passwords from the environment or .env:
--
--   scripts/db-bootstrap.sh                 # every database in DATABASE_URL / TEST_DATABASE_URL
--   scripts/db-bootstrap.sh --test-database # only TEST_DATABASE_URL
--   scripts/db-bootstrap.sh <superuser-url> # one database
--
-- or psql (15 or newer, for \getenv) directly, with the passwords in the environment and the
-- superuser URL without its password (PGPASSWORD keeps it out of the process list):
--
--   PGPASSWORD=... DB_MIGRATOR_PASSWORD=... DB_APP_RW_PASSWORD=... DB_APP_PUBLIC_RO_PASSWORD=... \
--     psql "<superuser-url-without-password>" -X -v ON_ERROR_STOP=1 -f scripts/db-bootstrap.sql
--
-- Idempotent. The roles are created here, never in a migration: that needs CREATEROLE and would
-- put passwords in the repository. Migrations contain only GRANT and REVOKE. The passwords come
-- from the environment, never from the command line (visible in the process list) or a file in
-- the repository; a password variable that is not set leaves that role's password unchanged.
--
--   migrator       owns the database and every application object; `pnpm db:migrate` runs the
--                  migrations as this role (SET ROLE migrator), whoever connects.
--   app_rw         the services and the worker: DML on the application tables (migrations grant it).
--   app_public_ro  anonymous reads: only v_public_person, v_public_edge and v_public_school.
--
-- SQL compatible with PostgreSQL 16+ and PostGIS 3.4+ (plan §3.2).

\set ON_ERROR_STOP on
SET client_min_messages = warning;
-- Keep the ALTER ROLE ... PASSWORD statements below out of the server log, whatever
-- log_statement and log_min_duration_statement say (superuser-only settings, this session only).
SET log_statement = 'none';
SET log_min_duration_statement = -1;

-- 1. Roles (cluster-wide). Login roles without any special attribute.
SELECT format('CREATE ROLE %I LOGIN', r)
  FROM unnest(ARRAY['migrator', 'app_rw', 'app_public_ro']) AS r
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
\gexec
ALTER ROLE migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
ALTER ROLE app_rw LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
ALTER ROLE app_public_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;

-- 2. Passwords from the environment (only those that are set).
\getenv migrator_password DB_MIGRATOR_PASSWORD
\getenv app_rw_password DB_APP_RW_PASSWORD
\getenv app_public_ro_password DB_APP_PUBLIC_RO_PASSWORD
\if :{?migrator_password}
SELECT format('ALTER ROLE migrator PASSWORD %L', :'migrator_password')
\gexec
\endif
\if :{?app_rw_password}
SELECT format('ALTER ROLE app_rw PASSWORD %L', :'app_rw_password')
\gexec
\endif
\if :{?app_public_ro_password}
SELECT format('ALTER ROLE app_public_ro PASSWORD %L', :'app_public_ro_password')
\gexec
\endif

-- 3. The current database: owned by migrator, so it owns the `public` schema through
--    pg_database_owner and may create objects and trusted extensions there.
SELECT format('ALTER DATABASE %I OWNER TO migrator', current_database())
\gexec
-- Temporary tables only for app_rw: the anonymous read-only role has no use for them, and they
-- would give whoever reaches that role a place to stage work. PUBLIC loses its default TEMP, and
-- app_public_ro loses the TEMPORARY that earlier versions of this script granted.
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO app_rw', current_database())
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO app_public_ro', current_database())
\gexec
SELECT format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC, app_public_ro', current_database())
\gexec

-- 4. PostGIS is not a trusted extension, so the superuser creates it here; the first migration's
--    CREATE EXTENSION IF NOT EXISTS then succeeds as migrator. pg_trgm, unaccent and
--    fuzzystrmatch are trusted: the migration creates them as migrator.
CREATE EXTENSION IF NOT EXISTS postgis;
