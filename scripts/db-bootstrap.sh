#!/usr/bin/env bash
# Runs scripts/db-bootstrap.sql (roles migrator, app_rw and app_public_ro; database owner;
# PostGIS) as a superuser, with the role passwords from the environment or .env (plan §6.2).
#
# Usage:
#   scripts/db-bootstrap.sh                   # each distinct database of DATABASE_URL and TEST_DATABASE_URL
#   scripts/db-bootstrap.sh <superuser-url>…  # the given databases
#
# Needs DB_MIGRATOR_PASSWORD, DB_APP_RW_PASSWORD and DB_APP_PUBLIC_RO_PASSWORD (scripts/init-env.sh
# generates local values; scripts/cloud-setup.sh and CI set throwaway ones). Idempotent: run it
# once per environment, and again after creating a database. Never prints the passwords.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

from_dotenv() {
  local name="$1"
  [ -n "${!name:-}" ] || [ ! -f .env ] && return 0
  local value
  value="$(sed -n "s/^${name}=//p" .env | tail -n 1 | sed -e "s/^['\"]//" -e "s/['\"]$//")"
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
  echo "db-bootstrap: psql not found (Ubuntu/WSL2: sudo apt-get install -y postgresql-client)" >&2
  exit 1
fi

urls=("$@")
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
  # The SQL reads the passwords with \getenv (psql 15+): never on the command line.
  DB_MIGRATOR_PASSWORD="$DB_MIGRATOR_PASSWORD" DB_APP_RW_PASSWORD="$DB_APP_RW_PASSWORD" \
    DB_APP_PUBLIC_RO_PASSWORD="$DB_APP_PUBLIC_RO_PASSWORD" \
    psql "$url" -X -q -v ON_ERROR_STOP=1 -f scripts/db-bootstrap.sql >/dev/null
  echo "db-bootstrap: database '${db}': roles migrator, app_rw, app_public_ro ready; owner migrator; postgis present"
done
