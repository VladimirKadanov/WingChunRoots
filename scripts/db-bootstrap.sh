#!/usr/bin/env bash
# Runs scripts/db-bootstrap.sql (roles migrator, app_rw and app_public_ro; database owner;
# PostGIS) as a superuser, with the role passwords from the environment or .env (plan §6.2).
#
# Usage:
#   scripts/db-bootstrap.sh                   # each distinct database of DATABASE_URL and TEST_DATABASE_URL
#   scripts/db-bootstrap.sh --test-database   # only the database of TEST_DATABASE_URL
#   scripts/db-bootstrap.sh <superuser-url>…  # the given databases
#
# Scripts use --test-database rather than passing the URL: an argument is visible to every local
# user in the process list (ps, /proc/<pid>/cmdline), and step() of scripts/verify.sh logs it.
#
# Needs DB_MIGRATOR_PASSWORD, DB_APP_RW_PASSWORD and DB_APP_PUBLIC_RO_PASSWORD (scripts/init-env.sh
# generates local values; scripts/cloud-setup.sh and CI set throwaway ones) and psql 15 or newer.
# Idempotent: run it once per environment, and again after creating a database. Never prints the
# passwords and never puts one on a command line.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/lib/psql.sh
. scripts/lib/psql.sh

from_dotenv() {
  local name="$1"
  [ -n "${!name:-}" ] || [ ! -f .env ] && return 0
  local value
  value="$(dotenv_value "$name")"
  [ -n "$value" ] && export "$name=$value"
  return 0
}
for name in DATABASE_URL TEST_DATABASE_URL DB_MIGRATOR_PASSWORD DB_APP_RW_PASSWORD DB_APP_PUBLIC_RO_PASSWORD; do
  from_dotenv "$name"
done

missing=()
for name in DB_MIGRATOR_PASSWORD DB_APP_RW_PASSWORD DB_APP_PUBLIC_RO_PASSWORD; do
  [ -n "${!name:-}" ] || missing+=("$name")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "db-bootstrap: ${missing[*]} not set (local: scripts/init-env.sh; cloud: scripts/cloud-setup.sh)" >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "db-bootstrap: psql not found (Ubuntu 24.04/WSL2: sudo apt-get install -y postgresql-client)" >&2
  exit 1
fi
psql_check_version || exit 1

urls=()
if [ "${1:-}" = "--test-database" ]; then
  if [ "$#" -ne 1 ] || [ -z "${TEST_DATABASE_URL:-}" ]; then
    echo "db-bootstrap: --test-database takes no other argument and needs TEST_DATABASE_URL" >&2
    exit 1
  fi
  urls=("$TEST_DATABASE_URL")
else
  urls=("$@")
fi
if [ "${#urls[@]}" -eq 0 ]; then
  for u in "${DATABASE_URL:-}" "${TEST_DATABASE_URL:-}"; do
    [ -n "$u" ] || continue
    dup=0
    for seen in ${urls[@]+"${urls[@]}"}; do [ "$seen" = "$u" ] && dup=1; done
    [ "$dup" -eq 0 ] && urls+=("$u")
  done
fi
if [ "${#urls[@]}" -eq 0 ]; then
  echo "db-bootstrap: no database URL (pass one, or set DATABASE_URL / TEST_DATABASE_URL)" >&2
  exit 1
fi

for url in "${urls[@]}"; do
  db="${url##*/}"
  db="${db%%\?*}"
  # The SQL reads the role passwords with \getenv (psql 15+), and psql_url passes the superuser
  # password through PGPASSWORD: no password ever appears on the command line.
  DB_MIGRATOR_PASSWORD="$DB_MIGRATOR_PASSWORD" DB_APP_RW_PASSWORD="$DB_APP_RW_PASSWORD" \
    DB_APP_PUBLIC_RO_PASSWORD="$DB_APP_PUBLIC_RO_PASSWORD" \
    psql_url "$url" -X -q -v ON_ERROR_STOP=1 -f scripts/db-bootstrap.sql >/dev/null
  echo "db-bootstrap: database '${db}': roles migrator, app_rw, app_public_ro ready; owner migrator; postgis present"
done
