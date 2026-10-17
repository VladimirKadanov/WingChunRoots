-- Custom SQL migration (M01): the extensions every later migration relies on (plan §6.2).
-- postgis: geography(Point,4326) columns; pg_trgm: trigram search on person_name_key;
-- unaccent and fuzzystrmatch: name normalisation and matching (M07).
-- postgis is not a trusted extension: a superuser creates it, either here (cloud session, CI and
-- local tests run migrations as a superuser) or beforehand with scripts/db-bootstrap.sql, after
-- which IF NOT EXISTS lets the migrator role run this file. The other three are trusted, so the
-- database owner may create them.
-- SQL compatible with PostgreSQL 16+ and PostGIS 3.4+ (plan §3.2).
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
