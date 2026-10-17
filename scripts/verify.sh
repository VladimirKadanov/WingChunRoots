#!/usr/bin/env bash
# scripts/verify.sh <Mxx|all> — the verification contract of every milestone (plan §7.5).
# Created in M00. It may grow, but it is never weakened (docs/plan/RULES.md).
#
#   scripts/verify.sh M00   # environment, lint, typecheck, unit, build, E2E "@smoke|@M00",
#                           # then scripts/verify.d/M00.sh
#   scripts/verify.sh all   # every step, the whole E2E suite and every scripts/verify.d/*.sh
#                           # (CI and M13)
#
# The screen shows one line per step, "STEP <name>: ok (<s>s)". On failure it shows the last
# 80 lines of the failed step and ends with "VERIFY <target>: FAIL at <step>" (exit 1).
# On success the last line is exactly "VERIFY <target>: PASS" (exit 0).
# The full log goes to .verify/<target>.log (git-ignored; CI uploads it as an artifact).
#
# Database: TEST_DATABASE_URL from the environment (cloud session: scripts/cloud-setup.sh;
# CI: the PostGIS service container) or, failing that, from .env (scripts/init-env.sh).
# Locally, when that database does not answer and Docker is available, the Compose
# `postgres` service is started. From M01 the role passwords DB_MIGRATOR_PASSWORD,
# DB_APP_RW_PASSWORD and DB_APP_PUBLIC_RO_PASSWORD come from the same places, and every run
# bootstraps the test database (scripts/db-bootstrap.sh, idempotent) before the database steps.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

MILESTONES=(M00 M00b M01 M01b M02 M03 M04 M05 M06 M07 M08 M09 M10a M10b M11 M12 M13)
MIN_NODE="22.12.0"

usage() {
  echo "usage: scripts/verify.sh <milestone|all>   (milestones: ${MILESTONES[*]})" >&2
  exit 2
}

is_milestone() {
  local m
  for m in "${MILESTONES[@]}"; do [ "$m" = "$1" ] && return 0; done
  return 1
}

target="${1:-}"
[ -n "$target" ] || usage
if [ "$target" != "all" ] && ! is_milestone "$target"; then
  echo "verify: unknown milestone '$target'" >&2
  usage
fi

# Milestone checks to run, in milestone order.
checks=()
if [ "$target" = "all" ]; then
  for m in "${MILESTONES[@]}"; do
    [ -f "scripts/verify.d/$m.sh" ] && checks+=("$m")
  done
  e2e_args=()
else
  checks=("$target")
  # \b keeps @M00 from also selecting @M00b (and @M01 from @M01b).
  e2e_args=(--grep "@smoke\\b|@$target\\b")
fi

# A step introduced by milestone X runs once X has landed (scripts/verify.d/X.sh exists)
# or when X itself is being verified.
introduced() {
  [ -f "scripts/verify.d/$1.sh" ] || [ "$target" = "$1" ]
}

# --- environment shared by all steps ------------------------------------------------
export NEXT_TELEMETRY_DISABLED=1

# Variables the environment does not set are taken from .env (scripts/init-env.sh), if any.
from_dotenv() {
  local name="$1"
  [ -n "${!name:-}" ] || [ ! -f .env ] && return 0
  local value
  value="$(sed -n "s/^${name}=//p" .env | tail -n 1 | sed -e "s/^['\"]//" -e "s/['\"]$//")"
  [ -n "$value" ] && export "$name=$value"
  return 0
}
DB_PASSWORD_VARS=(DB_MIGRATOR_PASSWORD DB_APP_RW_PASSWORD DB_APP_PUBLIC_RO_PASSWORD)
for name in TEST_DATABASE_URL E2E_PORT PW_CHROMIUM_EXECUTABLE "${DB_PASSWORD_VARS[@]}"; do
  from_dotenv "$name"
done

# Cloud session: the SessionStart hook normally exports these; recover when it did not.
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  if [ -z "${TEST_DATABASE_URL:-}" ]; then
    eval "$(scripts/cloud-setup.sh --print-env 2>/dev/null | grep '^export TEST_DATABASE_URL=')"
  fi
  for name in "${DB_PASSWORD_VARS[@]}"; do
    if [ -z "${!name:-}" ]; then
      eval "$(scripts/cloud-setup.sh --print-env 2>/dev/null | grep "^export ${name}=")"
    fi
  done
  if [ -z "${PW_CHROMIUM_EXECUTABLE:-}" ]; then
    PW_CHROMIUM_EXECUTABLE="$(scripts/pw-chromium.sh 2>/dev/null || true)"
    [ -n "$PW_CHROMIUM_EXECUTABLE" ] && export PW_CHROMIUM_EXECUTABLE
  fi
fi
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-}"

LOG_DIR=".verify"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$target.log"
STEP_OUT="$LOG_DIR/.$target.step"
{
  echo "verify $target — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)$(git diff --quiet HEAD 2>/dev/null || echo ' (with uncommitted changes)')"
} > "$LOG"

step() {
  local name="$1"
  shift
  local started=$SECONDS
  printf '\n===== STEP %s: %s\n' "$name" "$*" >> "$LOG"
  # stdin is /dev/null: a step that would prompt fails fast instead of hanging.
  ("$@") < /dev/null > "$STEP_OUT" 2>&1
  local rc=$?
  cat "$STEP_OUT" >> "$LOG"
  local took=$((SECONDS - started))
  if [ "$rc" -eq 0 ]; then
    printf '===== STEP %s: ok (%ss)\n' "$name" "$took" >> "$LOG"
    echo "STEP $name: ok (${took}s)"
    return 0
  fi
  printf '===== STEP %s: FAILED (exit %s, %ss)\n' "$name" "$rc" "$took" >> "$LOG"
  echo "STEP $name: FAILED (exit $rc, ${took}s)"
  echo "----- last 80 lines of step $name (full log: $LOG) -----"
  tail -n 80 "$STEP_OUT"
  rm -f "$STEP_OUT"
  echo "VERIFY $target: FAIL at $name"
  exit 1
}

# --- step implementations ------------------------------------------------------------
check_env() {
  local node_version pnpm_wanted pnpm_version
  node_version="$(node -p 'process.versions.node')" || { echo "node not found"; return 1; }
  echo "node $node_version (engines: >=$MIN_NODE; .nvmrc: $(head -n 1 .nvmrc))"
  if ! printf '%s\n%s\n' "$MIN_NODE" "$node_version" | sort -V -C; then
    echo "Node $node_version is older than $MIN_NODE"
    return 1
  fi

  pnpm_wanted="$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '').split('+')[0]")"
  pnpm_version="$(pnpm --version 2>/dev/null)" || { echo "pnpm not found (npm install --global pnpm@$pnpm_wanted)"; return 1; }
  echo "pnpm $pnpm_version (packageManager: pnpm@$pnpm_wanted)"
  if [ "$pnpm_version" != "$pnpm_wanted" ]; then
    echo "pnpm $pnpm_version does not match packageManager pnpm@$pnpm_wanted: npm install --global pnpm@$pnpm_wanted"
    return 1
  fi

  if ! command -v psql >/dev/null 2>&1; then
    echo "psql not found: install the PostgreSQL client (Ubuntu/WSL2: sudo apt-get install -y postgresql-client)"
    return 1
  fi
  psql --version

  if [ -z "$TEST_DATABASE_URL" ]; then
    echo "TEST_DATABASE_URL is not set."
    echo "  cloud session: scripts/cloud-setup.sh (the SessionStart hook runs it)"
    echo "  local:         scripts/init-env.sh, then docker compose up -d --wait"
    return 1
  fi
  echo "TEST_DATABASE_URL: set (database '$(db_name)')"
  echo "PW_CHROMIUM_EXECUTABLE: ${PW_CHROMIUM_EXECUTABLE:-<not set: the browsers installed by Playwright>}"
  echo "CI: ${CI:-<not set>}"
}

db_name() {
  local rest="${TEST_DATABASE_URL##*/}"
  echo "${rest%%\?*}"
}

db_answers() {
  psql "$TEST_DATABASE_URL" -X -q -At -c 'SELECT 1' >/dev/null 2>&1
}

check_db() {
  if db_answers; then
    psql "$TEST_DATABASE_URL" -X -q -At -c 'SELECT version()'
    return 0
  fi
  if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
    echo "The test database does not answer; running scripts/cloud-setup.sh (idempotent)."
    scripts/cloud-setup.sh >/dev/null || return 1
  elif [ -z "${CI:-}" ] && [ -f docker-compose.yml ] && command -v docker >/dev/null 2>&1 \
    && docker info >/dev/null 2>&1; then
    echo "The test database does not answer; starting the Docker Compose postgres service."
    docker compose up -d --wait postgres || return 1
    local i
    for i in $(seq 1 30); do
      db_answers && break
      sleep 1
    done
  fi
  if db_answers; then
    psql "$TEST_DATABASE_URL" -X -q -At -c 'SELECT version()'
    return 0
  fi
  echo "Cannot connect to TEST_DATABASE_URL (database '$(db_name)')."
  echo "  cloud session: scripts/cloud-setup.sh"
  echo "  local:         docker compose up -d --wait (and scripts/init-env.sh once)"
  echo "If the server answers but rejects the password: the Compose volume keeps the password of"
  echo "its first start. Use the old .env, or recreate the volume (deletes local data):"
  echo "  docker compose down -v && docker compose up -d --wait"
  return 1
}

run_e2e() {
  pnpm e2e "$@"
}

run_checks() {
  local m="$1"
  if [ ! -f "scripts/verify.d/$m.sh" ]; then
    echo "scripts/verify.d/$m.sh is missing: every milestone adds its own checks (plan §7.5)."
    return 1
  fi
  bash "scripts/verify.d/$m.sh"
}

# Always the test database: DATABASE_URL from the environment wins over .env in the db:*
# scripts, so the development database is never reset here.
reset_migrate_seed() {
  export DATABASE_URL="$TEST_DATABASE_URL"
  pnpm db:reset && pnpm db:migrate && pnpm db:seed
}

# --- the contract, in order (plan §7.5) ----------------------------------------------
step env check_env
step install pnpm install --frozen-lockfile
step db check_db
step db-env-check scripts/db-env-check.sh
if introduced M01; then
  step db-bootstrap scripts/db-bootstrap.sh "$TEST_DATABASE_URL"
fi
step lint pnpm lint
step typecheck pnpm typecheck
step test pnpm test
if introduced M01; then
  step test:int pnpm test:int
  step db:check pnpm db:check
  step db:reset+migrate+seed reset_migrate_seed
fi
step build pnpm build
step e2e run_e2e ${e2e_args[@]+"${e2e_args[@]}"}
for m in ${checks[@]+"${checks[@]}"}; do
  step "checks:$m" run_checks "$m"
done

rm -f "$STEP_OUT"
echo "VERIFY $target: PASS"
