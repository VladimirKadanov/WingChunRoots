-- Runs once, when the Docker Compose volume is initialised (docker-entrypoint-initdb.d).
-- The development database for DATABASE_URL (from M01). Created empty from template0, not
-- through POSTGRES_DB, because the postgis/postgis image preloads PostGIS extensions into
-- POSTGRES_DB: migrations must create every extension they need themselves, as they do in
-- the test database here, in CI and in the cloud session. UTF-8 with a UTF-8 locale: with
-- LC_CTYPE=C pg_trgm extracts no trigrams from Cyrillic or Chinese names (plan §11, risk 16).
CREATE DATABASE wingchunroots TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C.UTF-8';
