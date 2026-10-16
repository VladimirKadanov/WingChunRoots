#!/usr/bin/env bash
# Prepares a Claude Code cloud session for WingChunRoots (plan §7.6, milestone M00).
#
# Cloud sessions have Node 22, no Docker daemon, and the network proxy blocks
# apt.postgresql.org (PGDG). This script therefore:
#   1. installs PostgreSQL 16 + PostGIS 3.4 from the Ubuntu archive;
#   2. starts the cluster and creates a UTF-8 test database (C.UTF-8 locale:
#      with LC_CTYPE=C pg_trgm extracts no trigrams from Cyrillic or Chinese);
#   3. installs the exact pnpm pinned in package.json "packageManager" (npm i -g,
#      never Corepack) and runs `pnpm install`;
#   4. never installs browsers: if the pinned Playwright expects a different
#      Chromium build than the preinstalled one, it sets PW_CHROMIUM_EXECUTABLE;
#   5. exports TEST_DATABASE_URL, NEXT_TELEMETRY_DISABLED and PW_CHROMIUM_EXECUTABLE
#      to $CLAUDE_ENV_FILE (SessionStart hook) and prints them as `export` lines.
#
# Idempotent and non-interactive. Usage:
#   scripts/cloud-setup.sh            # set everything up, print the exports
#   eval "$(scripts/cloud-setup.sh --print-env)"   # only print the exports
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PG_MAJOR=16
PG_CLUSTER=main
DB_NAME="${WCR_TEST_DB_NAME:-wingchunroots_test}"
DB_PORT="${WCR_TEST_DB_PORT:-5432}"
DB_USER=postgres
# Local, throwaway credentials for a database that only listens on 127.0.0.1 inside the sandbox.
DB_PASSWORD="${WCR_TEST_DB_PASSWORD:-postgres}"
TEST_DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${DB_PORT}/${DB_NAME}"

log() { printf '[cloud-setup] %s\n' "$*" >&2; }

as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

as_postgres() {
  if [ "$(id -u)" -eq 0 ]; then runuser -u postgres -- "$@"; else sudo -u postgres "$@"; fi
}

chromium_executable() {
  # Prints the Chromium Playwright should use, or nothing when the pinned build is present.
  local expected candidate
  expected="$(node -e "process.stdout.write(require('@playwright/test').chromium.executablePath())" 2>/dev/null || true)"
  if [ -n "$expected" ] && [ -x "$expected" ]; then
    return 0
  fi
  candidate="$(ls -d "${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"/chromium-*/chrome-linux*/chrome 2>/dev/null | sort -V | tail -n 1 || true)"
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    printf '%s' "$candidate"
  fi
}

print_env() {
  echo "export TEST_DATABASE_URL='${TEST_DATABASE_URL}'"
  echo "export NEXT_TELEMETRY_DISABLED=1"
  local chromium
  chromium="$(chromium_executable)"
  if [ -n "$chromium" ]; then
    echo "export PW_CHROMIUM_EXECUTABLE='${chromium}'"
  fi
}

if [ "${1:-}" = "--print-env" ]; then
  print_env
  exit 0
fi

# 1. PostgreSQL 16 + PostGIS 3.4 from the Ubuntu archive (no Docker, no PGDG).
packages=(postgresql-16 postgresql-16-postgis-3 postgresql-contrib)
missing=()
for pkg in "${packages[@]}"; do
  dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
done
if [ "${#missing[@]}" -gt 0 ]; then
  log "installing ${missing[*]} from the Ubuntu archive"
  as_root apt-get update -qq
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${packages[@]}" >/dev/null
fi

# 2. Cluster, superuser password for TCP connections, UTF-8 test database.
if ! pg_lsclusters -h 2>/dev/null | awk -v v="$PG_MAJOR" -v c="$PG_CLUSTER" '$1==v && $2==c {found=1} END {exit !found}'; then
  log "creating cluster ${PG_MAJOR}/${PG_CLUSTER}"
  as_root pg_createcluster "$PG_MAJOR" "$PG_CLUSTER" --port="$DB_PORT" --encoding=UTF8 --locale=C.UTF-8 >/dev/null
fi
if ! pg_lsclusters -h | awk -v v="$PG_MAJOR" -v c="$PG_CLUSTER" '$1==v && $2==c && $4=="online" {found=1} END {exit !found}'; then
  log "starting cluster ${PG_MAJOR}/${PG_CLUSTER}"
  as_root pg_ctlcluster "$PG_MAJOR" "$PG_CLUSTER" start
fi
for _ in $(seq 1 30); do
  pg_isready -q -h 127.0.0.1 -p "$DB_PORT" && break
  sleep 1
done
pg_isready -q -h 127.0.0.1 -p "$DB_PORT" || { log "PostgreSQL did not become ready on port ${DB_PORT}"; exit 1; }

as_postgres psql -q -v ON_ERROR_STOP=1 -p "$DB_PORT" -d postgres \
  -c "ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}'" >/dev/null
if [ "$(as_postgres psql -At -p "$DB_PORT" -d postgres -c "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'")" != "1" ]; then
  log "creating database ${DB_NAME} (UTF8, C.UTF-8)"
  as_postgres createdb -p "$DB_PORT" -T template0 -E UTF8 --locale=C.UTF-8 "$DB_NAME"
fi

# 3. The exact pnpm from package.json, then the dependencies.
pnpm_version="$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '').split('+')[0]")"
if [ "$(pnpm --version 2>/dev/null || true)" != "$pnpm_version" ]; then
  log "installing pnpm@${pnpm_version}"
  npm install --global --silent "pnpm@${pnpm_version}" >/dev/null
  hash -r
fi
log "pnpm install"
pnpm install --reporter=silent >/dev/null

# 4 + 5. Environment for the session.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  print_env >> "$CLAUDE_ENV_FILE"
fi
log "ready: PostgreSQL $(as_postgres psql -At -p "$DB_PORT" -d postgres -c 'SHOW server_version'), pnpm $(pnpm --version), TEST_DATABASE_URL set"
print_env
