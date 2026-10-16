-- Runs once, when the Docker Compose volume is initialised (docker-entrypoint-initdb.d).
-- A separate, disposable database for TEST_DATABASE_URL (scripts/verify.sh, integration
-- tests, pnpm db:reset). UTF-8 with a UTF-8 locale: with LC_CTYPE=C pg_trgm extracts no
-- trigrams from Cyrillic or Chinese names (plan §11, risk 16).
CREATE DATABASE wingchunroots_test TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C.UTF-8';
