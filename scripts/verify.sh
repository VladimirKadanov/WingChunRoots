#!/usr/bin/env bash
# scripts/verify.sh <Mxx|all> — the verification contract of every milestone (plan §7.5).
# Created in M00. It may grow, but it is never weakened (docs/plan/RULES.md).
#
#   scripts/verify.sh M00   # environment, lint, typecheck, unit, build, E2E "@smoke|@M00",
#                           # then scripts/verify.d/M00.sh
#   scripts/verify.sh all   # every step, the whole E2E suite and every scripts/verify.d/*.sh
#                           # (CI and M13)
#   scripts/verify.sh M13   # the same as all (pilot acceptance includes everything)
#
# The screen shows one line per step, "STEP <name>: ok (<s>s)". On failure it shows the last
# 80 lines of the failed step and ends with "VERIFY <target>: FAIL at <step>" (exit 1).
# On success the last line is exactly "VERIFY <target>: PASS" (exit 0).
# The full log goes to .verify/<target>.log (git-ignored; CI uploads it as an artifact).
#
# Database: TEST_DATABASE_URL from the environment (cloud session: scripts/cloud-setup.sh;
# CI: the PostGIS service container) or, failing that, from .env (scripts/init-env.sh).
# Locally, when that database does not answer and Docker is available, the Compose
# `postgres` service is started (and `mailpit` with it when MAIL_TRANSPORT=smtp, from M01b).
# From M01b the `mail` step checks that Mailpit answers when MAIL_TRANSPORT=smtp (.env from
# scripts/init-env.sh, CI) and, locally, starts it. From M01 the role passwords DB_MIGRATOR_PASSWORD,
# DB_APP_RW_PASSWORD and DB_APP_PUBLIC_RO_PASSWORD come from the same places, and every run
# bootstraps the test database (scripts/db-bootstrap.sh, idempotent) before the database steps.
# From M02 the account settings BETTER_AUTH_SECRET, IP_HMAC_KEY, MAIL_SEAL_KEY, E2E_PASSWORD and
# E2E_TOTP_SECRET (and optionally APP_URL and TRUSTED_PROXIES) come from the same places; the env
# step refuses to start without them.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2
# shellcheck source=scripts/lib/psql.sh
. scripts/lib/psql.sh

MILESTONES=(M00 M00b M01 M01b M02 M03 M04 M05 M06 M07 M08 M09 M10a M10b M11 M12 M13)
MIN_NODE="26.12.1"

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
# M13 (pilot acceptance, Done when 1) includes everything of `all`: every check and the whole E2E suite.
if [ "$target" = "all" ] || [ "$target" = "M13" ]; then
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
  value="$(dotenv_value "$name")"
  [ -n "$value" ] && export "$name=$value"
  return 0
}
DB_PASSWORD_VARS=(DB_MIGRATOR_PASSWORD DB_APP_RW_PASSWORD DB_APP_PUBLIC_RO_PASSWORD)
MAIL_VARS=(MAIL_TRANSPORT SMTP_URL MAIL_FILE_DIR MAIL_FROM MAILPIT_URL MAILPIT_SMTP_PORT MAILPIT_UI_PORT)
AUTH_SECRET_VARS=(BETTER_AUTH_SECRET IP_HMAC_KEY MAIL_SEAL_KEY E2E_PASSWORD E2E_TOTP_SECRET)
for name in TEST_DATABASE_URL E2E_PORT PW_CHROMIUM_EXECUTABLE PW_WORKERS "${DB_PASSWORD_VARS[@]}" "${MAIL_VARS[@]}" \
  APP_URL TRUSTED_PROXIES "${AUTH_SECRET_VARS[@]}"; do
  from_dotenv "$name"
done

# Cloud session: the SessionStart hook normally exports these; recover when it did not.
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  if [ -z "${TEST_DATABASE_URL:-}" ]; then
    eval "$(scripts/cloud-setup.sh --print-env 2>/dev/null | grep '^export TEST_DATABASE_URL=')"
  fi
  for name in "${DB_PASSWORD_VARS[@]}" "${AUTH_SECRET_VARS[@]}"; do
    if [ -z "${!name:-}" ]; then
      eval "$(scripts/cloud-setup.sh --print-env 2>/dev/null | grep "^export ${name}=")"
    fi
  done
  if [ -z "${PW_CHROMIUM_EXECUTABLE:-}" ]; then
    PW_CHROMIUM_EXECUTABLE="$(scripts/pw-chromium.sh 2>/dev/null || true)"
    [ -n "$PW_CHROMIUM_EXECUTABLE" ] && export PW_CHROMIUM_EXECUTABLE
  fi
  # No Docker, so no Mailpit: the worker writes e-mail to files (M01b).
  export MAIL_TRANSPORT="${MAIL_TRANSPORT:-file}"
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

# A command line as the log shows it: any password in a URL becomes ***. No step passes a
# database URL as an argument (the log is a CI artifact); this is the second line of defence.
redact_urls() {
  printf '%s' "$*" | sed -E 's#(://[^:/@[:space:]]+:)[^@[:space:]]*@#\1***@#g'
}

step() {
  local name="$1"
  shift
  local started=$SECONDS
  printf '\n===== STEP %s: %s\n' "$name" "$(redact_urls "$*")" >> "$LOG"
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
    echo "psql not found: install the PostgreSQL client (Ubuntu 24.04/WSL2: sudo apt-get install -y postgresql-client)"
    return 1
  fi
  psql --version
  if introduced M01; then
    # scripts/db-bootstrap.sql and the integration tests need \getenv (psql 15+).
    psql_check_version 2>&1 || return 1
  fi

  if [ -z "$TEST_DATABASE_URL" ]; then
    echo "TEST_DATABASE_URL is not set."
    echo "  cloud session: scripts/cloud-setup.sh (the SessionStart hook runs it)"
    echo "  local:         scripts/init-env.sh, then docker compose up -d --wait"
    return 1
  fi
  echo "TEST_DATABASE_URL: set (database '$(db_name)')"
  echo "PW_CHROMIUM_EXECUTABLE: ${PW_CHROMIUM_EXECUTABLE:-<not set: the browsers installed by Playwright>}"
  echo "PW_WORKERS: ${PW_WORKERS:-<not set: the Playwright default>}"
  if introduced M01b; then
    echo "MAIL_TRANSPORT: ${MAIL_TRANSPORT:-<not set: file>}"
  fi
  if introduced M02; then
    # The web server, the worker, the seed and the tests must share these values (the seeded
    # TOTP secrets are encrypted with BETTER_AUTH_SECRET). Never printed.
    local name missing=()
    for name in "${AUTH_SECRET_VARS[@]}"; do
      [ -n "${!name:-}" ] || missing+=("$name")
    done
    if [ "${#missing[@]}" -gt 0 ]; then
      echo "Not set: ${missing[*]}."
      echo "  cloud session: eval \"\$(scripts/cloud-setup.sh --print-env)\""
      echo "  local:         scripts/init-env.sh (appends them to an existing .env)"
      return 1
    fi
    echo "${AUTH_SECRET_VARS[*]}: set"
  fi
  echo "CI: ${CI:-<not set>}"
}

db_name() {
  local rest="${TEST_DATABASE_URL##*/}"
  echo "${rest%%\?*}"
}

db_answers() {
  psql_url "$TEST_DATABASE_URL" -X -q -At -c 'SELECT 1' >/dev/null 2>&1
}

# Local Docker: not CI, not a cloud session, a docker-compose.yml and a Docker daemon that answers.
local_docker() {
  [ -z "${CI:-}" ] && [ "${CLAUDE_CODE_REMOTE:-}" != "true" ] && [ -f docker-compose.yml ] \
    && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

# The worker sends over SMTP to Mailpit (M01b): MAIL_TRANSPORT=smtp, which scripts/init-env.sh
# writes to .env and CI sets. The default, file, needs no service.
mail_over_smtp() {
  introduced M01b && [ "${MAIL_TRANSPORT:-file}" = "smtp" ]
}

check_db() {
  if db_answers; then
    psql_url "$TEST_DATABASE_URL" -X -q -At -c 'SELECT version()'
    return 0
  fi
  if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
    echo "The test database does not answer; running scripts/cloud-setup.sh (idempotent)."
    scripts/cloud-setup.sh >/dev/null || return 1
  elif local_docker; then
    local services=(postgres)
    mail_over_smtp && services+=(mailpit)
    echo "The test database does not answer; starting the Docker Compose service(s): ${services[*]}."
    docker compose up -d --wait "${services[@]}" || return 1
    local i
    for i in $(seq 1 30); do
      db_answers && break
      sleep 1
    done
  fi
  if db_answers; then
    psql_url "$TEST_DATABASE_URL" -X -q -At -c 'SELECT version()'
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

# Mailpit's API answers /readyz and its SMTP port accepts a connection (3 s each). The same
# defaults as src/server/mail/config.ts and e2e/helpers/mailbox.ts. No URL is printed: SMTP_URL may
# carry credentials.
mailpit_answers() {
  MAILPIT_API="${MAILPIT_URL:-http://127.0.0.1:${MAILPIT_UI_PORT:-8025}}" \
    MAILPIT_SMTP="${SMTP_URL:-smtp://127.0.0.1:${MAILPIT_SMTP_PORT:-1025}}" node - <<'JS'
const net = require('node:net');
const fail = (what) => { console.log(`Mailpit: ${what}`); process.exit(1); };
(async () => {
  let api;
  try { api = new URL('readyz', process.env.MAILPIT_API.replace(/\/?$/, '/')); } catch { fail('MAILPIT_URL is not a valid URL'); }
  const response = await fetch(api, { signal: AbortSignal.timeout(3000) }).catch(() => undefined);
  if (!response?.ok) fail(`the API at ${api.host} does not answer /readyz${response ? ` (HTTP ${response.status})` : ''}`);
  let smtp;
  try { smtp = new URL(process.env.MAILPIT_SMTP); } catch { fail('SMTP_URL is not a valid URL'); }
  const port = Number(smtp.port || (smtp.protocol === 'smtps:' ? 465 : 25));
  const host = smtp.hostname.replace(/^\[|\]$/g, '');
  await new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 3000 }, () => { socket.destroy(); resolve(); });
    socket.on('timeout', () => { socket.destroy(); fail(`no SMTP connection to ${host}:${port} within 3 s`); });
    socket.on('error', (e) => fail(`no SMTP connection to ${host}:${port} (${e.code || e.message})`));
  });
  console.log(`Mailpit answers: API ${api.host}, SMTP ${host}:${port}`);
})();
JS
}

check_mail() {
  if ! mail_over_smtp; then
    echo "MAIL_TRANSPORT=${MAIL_TRANSPORT:-file}: the worker writes e-mail to files; no Mailpit needed."
    return 0
  fi
  mailpit_answers && return 0
  if local_docker; then
    echo "Starting the Docker Compose mailpit service."
    docker compose up -d --wait mailpit || return 1
    mailpit_answers && return 0
  fi
  echo "Mailpit is not reachable: docker compose up -d --wait mailpit (or set MAIL_TRANSPORT=file)"
  return 1
}

# The web server, the worker (M01b) and the tests use the test database that the steps above
# reset, migrated and seeded, never the development database of .env.
run_e2e() {
  if introduced M01; then
    export DATABASE_URL="$TEST_DATABASE_URL"
  fi
  pnpm e2e "$@" || return 1
  # Then the specs that lock a whole table (M08 final check) and those that make links public (M09;
  # e2e/projects.ts, EXCLUSIVE_SPECS), in a run of their own with the same filter: nothing else may
  # run while a table is locked or while the public graph changes under it.
  PW_EXCLUSIVE=1 pnpm e2e --pass-with-no-tests "$@" || return 1
  # Last, the pilot path of plan §2.2 (M13; e2e/projects.ts, PILOT_SPEC) on the three devices: it
  # makes links public and changes seeded demo accounts, which no earlier spec may see.
  PW_PILOT=1 pnpm e2e --pass-with-no-tests "$@"
}

run_checks() {
  local m="$1"
  if [ ! -f "scripts/verify.d/$m.sh" ]; then
    echo "scripts/verify.d/$m.sh is missing: every milestone adds its own checks (plan §7.5)."
    return 1
  fi
  bash "scripts/verify.d/$m.sh"
}

# No URL as an argument: step() logs its arguments (the log is a CI artifact), and the process
# list shows them to every local user.
bootstrap_test_db() {
  scripts/db-bootstrap.sh --test-database
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
if introduced M01b; then
  step mail check_mail
fi
step db-env-check scripts/db-env-check.sh
if introduced M01; then
  step db-bootstrap bootstrap_test_db
fi
step lint pnpm lint
step typecheck pnpm typecheck
step test pnpm test
if introduced M01; then
  step test:int pnpm test:int
  step db:check pnpm db:check
  step db:reset+migrate+seed reset_migrate_seed
fi
# From M04 the build that E2E runs against is the E2E build: it has the test fault switch, which a
# deployable `pnpm build` does not (src/server/faults.ts; scripts/verify.d/M04.sh checks both).
if introduced M04; then
  step build pnpm build:e2e
else
  step build pnpm build
fi
step e2e run_e2e ${e2e_args[@]+"${e2e_args[@]}"}
for m in ${checks[@]+"${checks[@]}"}; do
  step "checks:$m" run_checks "$m"
done

rm -f "$STEP_OUT"
echo "VERIFY $target: PASS"
