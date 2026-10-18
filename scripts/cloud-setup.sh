#!/usr/bin/env bash
# Prepares a Claude Code cloud session for WingChunRoots (plan §7.6, milestone M00).
#
# Cloud sessions have Node 22, no Docker daemon, and the network proxy blocks
# apt.postgresql.org (PGDG). This script therefore:
#   1. installs PostgreSQL 16 + PostGIS 3.4 from the Ubuntu archive;
#   2. starts the cluster and creates a UTF-8 test database (C.UTF-8 locale:
#      with LC_CTYPE=C pg_trgm extracts no trigrams from Cyrillic or Chinese);
#   3. installs the exact pnpm pinned in package.json "packageManager" (npm i -g,
#      never Corepack) and runs `pnpm install --frozen-lockfile`;
#   4. never installs browsers: if the pinned Playwright expects a different
#      Chromium build than the preinstalled one, it sets PW_CHROMIUM_EXECUTABLE;
#   5. exports TEST_DATABASE_URL, the role passwords DB_MIGRATOR_PASSWORD, DB_APP_RW_PASSWORD
#      and DB_APP_PUBLIC_RO_PASSWORD, the account settings BETTER_AUTH_SECRET, IP_HMAC_KEY,
#      MAIL_SEAL_KEY, E2E_PASSWORD and E2E_TOTP_SECRET (M02), NEXT_TELEMETRY_DISABLED and PW_CHROMIUM_EXECUTABLE
#      to $CLAUDE_ENV_FILE (SessionStart hook) and prints them as `export` lines;
#   6. bootstraps the roles migrator, app_rw and app_public_ro and the test database with
#      scripts/db-bootstrap.sh (from M01; plan §6.2).
#
# Idempotent and non-interactive. Only for Claude Code cloud sessions (CLAUDE_CODE_REMOTE=true):
# on a developer machine it would install a native PostgreSQL on port 5432 next to Docker
# Compose and reset the local postgres password, so it refuses to run there. Usage:
#   scripts/cloud-setup.sh            # set everything up, print the exports
#   eval "$(scripts/cloud-setup.sh --print-env)"   # only print the exports
#   scripts/cloud-setup.sh --force    # set up outside a cloud session anyway
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ] && [ "${1:-}" != "--print-env" ] && [ "${1:-}" != "--force" ]; then
  echo "cloud-setup: only for Claude Code cloud sessions; locally use scripts/init-env.sh and" >&2
  echo "  docker compose up -d --wait (pass --force to override)" >&2
  exit 2
fi

PG_MAJOR=16
PG_CLUSTER=main
DB_NAME="${WCR_TEST_DB_NAME:-wingchunroots_test}"
DB_PORT="${WCR_TEST_DB_PORT:-5432}"
DB_USER=postgres
# Local, throwaway credentials for a database that only listens on 127.0.0.1 inside the sandbox.
DB_PASSWORD="${WCR_TEST_DB_PASSWORD:-postgres}"
TEST_DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${DB_PORT}/${DB_NAME}"
# Throwaway role passwords for the same sandbox-only database (scripts/db-bootstrap.sql).
DB_MIGRATOR_PASSWORD="${DB_MIGRATOR_PASSWORD:-migrator-local}"
DB_APP_RW_PASSWORD="${DB_APP_RW_PASSWORD:-app-rw-local}"
DB_APP_PUBLIC_RO_PASSWORD="${DB_APP_PUBLIC_RO_PASSWORD:-app-public-ro-local}"
export DB_MIGRATOR_PASSWORD DB_APP_RW_PASSWORD DB_APP_PUBLIC_RO_PASSWORD

log() { printf '[cloud-setup] %s\n' "$*" >&2; }

# Throwaway account settings of this sandbox (M02): random, generated once and kept outside the
# repository, so that every shell of the session sees the same values (the seeded TOTP secrets are
# encrypted with BETTER_AUTH_SECRET). Never real secrets: the sandbox has no real users or services.
CLOUD_SECRETS_FILE="${XDG_STATE_HOME:-$HOME/.local/state}/wingchunroots/cloud-secrets.env"
random_hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
new_secret() {
  case "$1" in
    E2E_PASSWORD) echo "wcr-$(random_hex 12)" ;;
    # The TOTP secret string Better Auth stores (hex, like the tests' own accounts).
    E2E_TOTP_SECRET) random_hex 20 ;;
    *) random_hex 32 ;;
  esac
}
cloud_secret() {
  if [ ! -s "$CLOUD_SECRETS_FILE" ]; then
    local tmp name
    mkdir -p "$(dirname "$CLOUD_SECRETS_FILE")"
    tmp="$(mktemp "${CLOUD_SECRETS_FILE}.XXXXXX")"
    for name in BETTER_AUTH_SECRET IP_HMAC_KEY MAIL_SEAL_KEY E2E_PASSWORD E2E_TOTP_SECRET; do
      echo "${name}=$(new_secret "$name")"
    done > "$tmp"
    chmod 600 "$tmp"
    # No clobber: when two sessions race, the first file wins and both read it below.
    mv -n "$tmp" "$CLOUD_SECRETS_FILE"
    rm -f "$tmp"
  fi
  # A setting added after the file was written (MAIL_SEAL_KEY in M02 fix round 1) is appended.
  if ! grep -q "^$1=" "$CLOUD_SECRETS_FILE"; then
    echo "$1=$(new_secret "$1")" >> "$CLOUD_SECRETS_FILE"
  fi
  sed -n "s/^$1=//p" "$CLOUD_SECRETS_FILE"
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

as_postgres() {
  if [ "$(id -u)" -eq 0 ]; then runuser -u postgres -- "$@"; else sudo -u postgres "$@"; fi
}

chromium_executable() {
  "$ROOT/scripts/pw-chromium.sh"
}

print_base_env() {
  echo "export TEST_DATABASE_URL='${TEST_DATABASE_URL}'"
  echo "export DB_MIGRATOR_PASSWORD='${DB_MIGRATOR_PASSWORD}'"
  echo "export DB_APP_RW_PASSWORD='${DB_APP_RW_PASSWORD}'"
  echo "export DB_APP_PUBLIC_RO_PASSWORD='${DB_APP_PUBLIC_RO_PASSWORD}'"
  echo "export NEXT_TELEMETRY_DISABLED=1"
  # No Docker here, so no Mailpit: the worker writes e-mail to files (M01b).
  echo "export MAIL_TRANSPORT=file"
  local name
  for name in BETTER_AUTH_SECRET IP_HMAC_KEY MAIL_SEAL_KEY E2E_PASSWORD E2E_TOTP_SECRET; do
    echo "export ${name}='${!name:-$(cloud_secret "$name")}'"
  done
}

# Needs node_modules (it asks the pinned Playwright which Chromium build it expects).
print_browser_env() {
  local chromium
  chromium="$(chromium_executable)"
  if [ -n "$chromium" ]; then
    echo "export PW_CHROMIUM_EXECUTABLE='${chromium}'"
  fi
}

print_env() {
  print_base_env
  print_browser_env
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
# Roles, database owner and PostGIS (idempotent; the passwords reach psql through the environment).
if [ -x "$ROOT/scripts/db-bootstrap.sh" ]; then
  log "bootstrapping roles and ${DB_NAME} (scripts/db-bootstrap.sh)"
  TEST_DATABASE_URL="$TEST_DATABASE_URL" "$ROOT/scripts/db-bootstrap.sh" --test-database >/dev/null
fi

# 3. The exact pnpm from package.json, then the dependencies.
pnpm_version="$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '').split('+')[0]")"
if [ "$(pnpm --version 2>/dev/null || true)" != "$pnpm_version" ]; then
  log "installing pnpm@${pnpm_version}"
  npm install --global --silent "pnpm@${pnpm_version}" >/dev/null
  hash -r
fi
# The database variables reach the session even when the install below fails.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  print_base_env >> "$CLAUDE_ENV_FILE"
fi
log "pnpm install --frozen-lockfile"
if ! pnpm install --frozen-lockfile --reporter=silent >/dev/null; then
  log "pnpm install --frozen-lockfile failed: pnpm-lock.yaml does not match package.json,"
  log "or a package is blocked by pnpm-workspace.yaml (minimumReleaseAge, trustPolicy, allowBuilds)."
  log "Run 'pnpm install --frozen-lockfile' to see the error; never weaken those settings to pass."
  exit 1
fi

# 4 + 5. Browser environment for the session.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  print_browser_env >> "$CLAUDE_ENV_FILE"
fi
log "ready: PostgreSQL $(as_postgres psql -At -p "$DB_PORT" -d postgres -c 'SHOW server_version'), pnpm $(pnpm --version), TEST_DATABASE_URL and role passwords set"
print_env
