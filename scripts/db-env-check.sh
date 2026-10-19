#!/usr/bin/env bash
# Checks the database environment (plan §7.5): PostgreSQL >= 16, PostGIS >= 3.4,
# postgis_full_version(), the contrib extensions the app needs, UTF-8 encoding and
# a UTF-8 aware locale (pg_trgm must produce trigrams for Cyrillic and Chinese), and the ICU
# collation und-x-icu that orders names (M04).
#
# Usage: scripts/db-env-check.sh [database-url]   (default: $TEST_DATABASE_URL)
#
# The URL must point at a disposable database and a role that may CREATE EXTENSION
# (superuser in the cloud session, in CI and in Docker Compose). The extensions are
# created inside a transaction that is rolled back, so the check leaves no trace.
set -euo pipefail
# shellcheck source=scripts/lib/psql.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/psql.sh"

url="${1:-${TEST_DATABASE_URL:-}}"
if [ -z "$url" ]; then
  echo "db-env-check: TEST_DATABASE_URL is not set (cloud session: scripts/cloud-setup.sh; local: see README.md)" >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "db-env-check: psql not found; install the PostgreSQL client (Ubuntu/WSL2: sudo apt-get install -y postgresql-client)" >&2
  exit 1
fi

MIN_PG_NUM=160000
MIN_POSTGIS="3.4"

# psql_url passes the password through PGPASSWORD, never on the command line.
out="$(psql_url "$url" -X -q -At -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SELECT 'server_version_num=' || current_setting('server_version_num');
SELECT 'server_version=' || current_setting('server_version');
SELECT 'server_encoding=' || current_setting('server_encoding');
SELECT 'lc_ctype=' || datctype FROM pg_database WHERE datname = current_database();
SELECT 'locale_provider=' || datlocprovider::text FROM pg_database WHERE datname = current_database();
SELECT 'postgis_lib_version=' || postgis_lib_version();
SELECT 'postgis_full_version=' || postgis_full_version();
SELECT 'trgm_cyrillic=' || coalesce(array_length(show_trgm('Винг Чун'), 1), 0);
SELECT 'trgm_han=' || coalesce(array_length(show_trgm('詠春'), 1), 0);
-- The ICU root collation sorts names (M04: "van Dam" beside "Vega", "Émile" beside "Emma").
SELECT 'icu_und=' || count(*) FROM pg_collation WHERE collname = 'und-x-icu';
SELECT 'available=' || string_agg(name, ',' ORDER BY name)
  FROM pg_available_extensions
  WHERE name IN ('fuzzystrmatch', 'pg_trgm', 'postgis', 'unaccent');
ROLLBACK;
SQL
)"

value() { printf '%s\n' "$out" | sed -n "s/^$1=//p" | head -n 1; }

fail=0
check() { # check <ok?> <message>
  if [ "$1" = "ok" ]; then
    echo "db-env-check: $2: ok"
  else
    echo "db-env-check: $2: FAILED" >&2
    fail=1
  fi
}

pg_num="$(value server_version_num)"
pg_ver="$(value server_version)"
[ "${pg_num:-0}" -ge "$MIN_PG_NUM" ] && r=ok || r=no
check "$r" "PostgreSQL ${pg_ver} >= 16"

postgis_ver="$(value postgis_lib_version)"
if printf '%s\n%s\n' "$MIN_POSTGIS" "${postgis_ver%%[^0-9.]*}" | sort -V -C; then r=ok; else r=no; fi
check "$r" "PostGIS ${postgis_ver} >= ${MIN_POSTGIS}"
echo "db-env-check: postgis_full_version(): $(value postgis_full_version)"

available="$(value available)"
[ "$available" = "fuzzystrmatch,pg_trgm,postgis,unaccent" ] && r=ok || r=no
check "$r" "extensions available (fuzzystrmatch, pg_trgm, postgis, unaccent): ${available}"

encoding="$(value server_encoding)"
ctype="$(value lc_ctype)"
provider="$(value locale_provider)"
[ "$encoding" = "UTF8" ] && r=ok || r=no
check "$r" "server encoding ${encoding} is UTF8"
# libc provider: LC_CTYPE must be a UTF-8 locale. ICU (i) and builtin (b, PostgreSQL 17+)
# providers are Unicode aware; the pg_trgm check below proves the behaviour either way.
case "${provider}:${ctype}" in
  c:*[Uu][Tt][Ff]8* | c:*[Uu][Tt][Ff]-8* | i:* | b:*) r=ok ;;
  *) r=no ;;
esac
check "$r" "database locale (provider ${provider}, LC_CTYPE ${ctype}) is UTF-8 aware"

icu_und="$(value icu_und)"
[ "${icu_und:-0}" -ge 1 ] && r=ok || r=no
check "$r" "ICU collation und-x-icu for name order"

trgm_cyr="$(value trgm_cyrillic)"
trgm_han="$(value trgm_han)"
[ "${trgm_cyr:-0}" -gt 0 ] && [ "${trgm_han:-0}" -gt 0 ] && r=ok || r=no
check "$r" "pg_trgm trigrams for Cyrillic (${trgm_cyr}) and Chinese (${trgm_han})"

if [ "$fail" -ne 0 ]; then
  echo "db-env-check: FAIL" >&2
  exit 1
fi
echo "db-env-check: PASS"
