#!/usr/bin/env bash
# Milestone M12 checks (docs/plan/M12-local-ops.md, "Done when"), run by scripts/verify.sh after the
# unit tests (src/server/log/logger.redaction.test.ts: pino drops e-mail addresses, names, IP
# addresses and coordinates; src/server/backups.test.ts), the integration tests
# (src/server/services/system.int.test.ts, src/server/jobs/stats.int.test.ts), the build and E2E
# (`@smoke|@M12`: e2e/ops.spec.ts). They stay valid after M12, so `scripts/verify.sh all` keeps
# running them (CI, M13).
#
# Here: scripts/check-env.test.sh; a local archive of TEST_DATABASE_URL and the timed restore drill
# (scripts/backup-local.sh, scripts/restore-drill.sh; the drill's result line, with the restore
# time, also appears in verify's step summary); the image, the Compose profile `app` and the CI
# jobs; /healthz, logging and /admin/system; backups/ outside git; the screenshots, the E2E titles,
# the decisions by default and the Bulgarian documents.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

failures=0
ok() { echo "ok   $1"; }
bad() {
  echo "FAIL $1"
  failures=$((failures + 1))
}
check() { # check "<description>" <command...>
  local description="$1"
  shift
  if "$@" >/dev/null 2>&1; then ok "$description"; else bad "$description"; fi
}
# refute "<description>" <command...>: passes when the command finds nothing (exit status 1).
refute() {
  local description="$1"
  shift
  local out
  out="$("$@" 2>&1)"
  local rc=$?
  if [ "$rc" -eq 1 ]; then
    ok "$description"
  else
    bad "$description"
    [ -n "$out" ] && printf '%s\n' "$out" | head -n 10 | sed 's/^/     /'
  fi
}

SIZES=(390x844 1440x900)
THEMES=(dark light)
DRILL_DIR=".verify/backups"

# 1. Required files (Done when 4) -----------------------------------------------------------------
required=(
  Dockerfile .dockerignore docker/app/entrypoint.sh docker-compose.yml
  scripts/check-env.sh scripts/check-env.test.sh scripts/backup-local.sh scripts/restore-drill.sh
  scripts/lib/pg-run.sh scripts/ops/lineage-digest.sql scripts/ops/evidence-objects.ts
  .github/workflows/restore-drill.yml
  docs/operations/local-run.md docs/operations/backup-and-restore.md docs/operations/incident.md
  docs/guides/admin-guide.bg.md docs/adr/0015-local-ops.md
  src/server/log/index.ts src/server/log/redact.ts src/server/log/request-error.ts src/server/log/logger.redaction.test.ts
  src/app/healthz/route.ts src/app/admin/system/page.tsx src/server/services/system.ts src/server/jobs/stats.ts src/server/backups.ts
  src/server/services/system.int.test.ts e2e/ops.spec.ts
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done
for f in Dockerfile docker/app/entrypoint.sh scripts/check-env.sh scripts/check-env.test.sh scripts/backup-local.sh scripts/restore-drill.sh; do
  [ "$f" = Dockerfile ] && continue
  check "executable: $f" test -x "$f"
done

# 2. scripts/check-env.test.sh (Done when 2) -------------------------------------------------------
if out="$(bash scripts/check-env.test.sh 2>&1)"; then
  ok "scripts/check-env.test.sh: $(printf '%s\n' "$out" | tail -n 1)"
else
  bad "scripts/check-env.test.sh"
  printf '%s\n' "$out" | grep -E '^FAIL|passed' | head -n 20 | sed 's/^/     /'
fi

# 3. The archive and the restore drill against TEST_DATABASE_URL (Done when 1) ---------------------
# A fictional evidence object first, so that the hash sample has one; then the archive with the
# evidence copies, and the drill, which prints the restore time and fails over the RTO (DEFAULT D24).
if [ -z "${TEST_DATABASE_URL:-}" ]; then
  bad "the backup and the restore drill need TEST_DATABASE_URL"
else
  rm -rf "$DRILL_DIR"
  drill_log=".verify/M12-drill.log"
  if pnpm -s exec tsx scripts/ops/evidence-objects.ts fixture --test-database > "$drill_log" 2>&1 &&
    BACKUP_DIR="$DRILL_DIR" scripts/backup-local.sh --test-database --objects >> "$drill_log" 2>&1 &&
    BACKUP_DIR="$DRILL_DIR" scripts/restore-drill.sh --test-database >> "$drill_log" 2>&1; then
    sed 's/^/     /' "$drill_log"
    result="$(grep -E '^RESTORE DRILL: PASS' "$drill_log" | tail -n 1)"
    if [ -n "$result" ] && grep -qE '^restore-drill: restore took [0-9.]+s \(RTO [0-9]+s, DEFAULT D24\)$' "$drill_log"; then
      ok "backup-local.sh and restore-drill.sh against TEST_DATABASE_URL, restore time printed"
      # verify.sh shows this line in its step summary.
      echo "$result"
    else
      bad "the restore drill printed no result line with its restore time"
    fi
    dump="$(find "$DRILL_DIR" -maxdepth 1 -name '*.dump' | head -n 1)"
    check "the archive has its .sha256 and .lineage files and is readable by its owner only" bash -c "
      [ -s '$dump.sha256' ] && [ -s '$dump.lineage' ] &&
      [ \"\$(stat -c %a '$dump' 2>/dev/null || stat -f %Lp '$dump')\" = 600 ]"
  else
    bad "backup-local.sh and restore-drill.sh against TEST_DATABASE_URL"
    sed 's/^/     /' "$drill_log" | tail -n 40
  fi
fi
check "the drill's RTO is 4 hours by default (DEFAULT D24)" bash -c '
  grep -qx "RTO_DEFAULT_SECONDS=14400" scripts/restore-drill.sh && grep -q "DEFAULT D24" scripts/restore-drill.sh'
check "the drill checks amcheck, rows, foreign keys, cycles, self-links, ancestor paths, evidence hashes, the Better Auth tables and the private tables" bash -c '
  f=scripts/restore-drill.sh
  grep -q "bt_index_check(index => oid, heapallindexed => true)" "$f" && grep -q "verify_heapam" "$f" &&
  grep -q "restored copy" "$f" && grep -q "FK CONSTRAINT" "$f" && grep -q "convalidated" "$f" &&
  grep -q "WHERE teacher = student" "$f" && grep -q "WHERE ancestor = person" "$f" && grep -q "lineage-digest.sql" "$f" &&
  grep -q "evidence-objects.ts verify" "$f" &&
  grep -q "AUTH_TABLES=(auth_user auth_session auth_account auth_verification auth_two_factor auth_throttle)" "$f" &&
  grep -q "PRIVATE_TABLES=(evidence_file evidence_link invitation person_claim content_report review_case review_event review_note school_private_location audit_log)" "$f"'
check "the drill restores into a temporary database or container, from the pinned PostGIS 18 image" bash -c '
  grep -q "DEFAULT_DRILL_IMAGE=\"postgis/postgis:18-3.6@sha256:[0-9a-f]\{64\}\"" scripts/restore-drill.sh &&
  grep -q "DROP DATABASE IF EXISTS" scripts/restore-drill.sh && grep -q "docker rm -f" scripts/restore-drill.sh'
check "pg_dump and pg_restore run at the server's major version (inside the container locally and in CI)" bash -c '
  f=scripts/lib/pg-run.sh
  grep -q "PG_CONTAINER" "$f" && grep -q "docker exec -i -e PGHOST" "$f" && grep -q "does not match the server" "$f"'
check "backup-local.sh: pg_dump -Fc, a dated name, a SHA-256 file, 14 kept, optional evidence copies" bash -c '
  f=scripts/backup-local.sh
  grep -q "pg_dump --format=custom" "$f" && grep -q "date -u +%Y%m%dT%H%M%SZ" "$f" && grep -q "\.sha256" "$f" &&
  grep -q "BACKUP_KEEP:-14" "$f" && grep -q "evidence-objects.ts copy" "$f" && grep -q "umask 077" "$f"'
check "the drill keeps its pg_restore log private (umask 077, mktemp, removed on exit) and prints no DETAIL or CONTEXT" bash -c '
  f=scripts/restore-drill.sh
  grep -q "umask 077 && mktemp" "$f" && grep -q "rm -f \"\$restore_log\"" "$f" &&
  grep -qF "(DETAIL|CONTEXT|HINT|LINE [0-9]+|Command was):" "$f" && ! grep -qF "wcr-drill-\$\$" "$f"'
check "backups/ is outside git (only its .gitkeep is tracked)" bash -c '
  git check-ignore -q backups/wingchunroots-20261101T020000Z.dump && git check-ignore -q backups/objects/x/evidence/y &&
  [ -z "$(git ls-files backups | grep -vx backups/.gitkeep)" ]'

# 4. The image and the Compose profile app (In scope 1) -------------------------------------------
check "Dockerfile: node:26.12.1-trixie-slim by digest, standalone web, non-root user, entrypoint with check-env" bash -c '
  f=Dockerfile
  grep -qE "^ARG NODE_IMAGE=node:26\.12\.1-trixie-slim@sha256:[0-9a-f]{64}$" "$f" &&
  [ "$(grep -c "^FROM \${NODE_IMAGE} AS " "$f")" -ge 2 ] &&
  [ -z "$(grep "^FROM " "$f" | grep -v "^FROM \${NODE_IMAGE} AS " | grep -vE "^FROM (base|deps) AS ")" ] &&
  grep -q "/src/.next/standalone ./web" "$f" && grep -qx "USER node" "$f" &&
  grep -q "ENTRYPOINT \[\"/app/entrypoint.sh\"\]" "$f" && grep -q "npm install --global pnpm@12.14.0" "$f"'
check "the entrypoint runs check-env.sh, then web, worker or migrate" bash -c '
  f=docker/app/entrypoint.sh
  grep -q "/app/scripts/check-env.sh \"\$command\"" "$f" && grep -q "exec node server.js" "$f" &&
  grep -q "exec node --import tsx src/worker.ts" "$f" && grep -q "exec node --import tsx src/server/db/cli.ts migrate" "$f"'
check ".dockerignore keeps every .env but .env.example, the archives and evidence out of the build" bash -c '
  f=.dockerignore
  grep -qx ".env\*" "$f" && grep -qx "!.env.example" "$f" && grep -qx "backups/" "$f" && grep -qx ".storage/" "$f" && grep -qx ".mail/" "$f"'
check "check-env.sh refuses missing settings and the example values of .env.example, without printing a value" bash -c '
  f=scripts/check-env.sh
  grep -q "still the example value of .env.example" "$f" && grep -q "missing or empty" "$f" && grep -q "never a" "$f"'
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  compose_env="$(mktemp)"
  for n in POSTGRES_PASSWORD S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY DB_MIGRATOR_PASSWORD DB_APP_RW_PASSWORD DB_APP_PUBLIC_RO_PASSWORD \
    BETTER_AUTH_SECRET IP_HMAC_KEY MAIL_SEAL_KEY; do echo "$n=compose-config-check"; done > "$compose_env"
  services="$(docker compose --env-file "$compose_env" --profile app config --services 2>/dev/null | sort | tr '\n' ' ')"
  plain="$(docker compose --env-file "$compose_env" config --services 2>/dev/null | sort | tr '\n' ' ')"
  rm -f "$compose_env"
  check "docker compose --profile app: postgres, mailpit, seaweedfs, db-bootstrap, migrate, web, worker" \
    test "$services" = "db-bootstrap mailpit migrate postgres seaweedfs web worker "
  check "docker compose without the profile starts only the three services" test "$plain" = "mailpit postgres seaweedfs "
else
  ok "docker compose config: not checkable here (no docker CLI); CI's image job starts the profile"
fi
check "the profile app: one web replica on 127.0.0.1:3000 with a /healthz healthcheck, migrate as migrator, backups read-only" bash -c '
  f=docker-compose.yml
  grep -q "^x-app: &app" "$f" && grep -q "profiles: \[app\]" "$f" && grep -q "command: \[\"migrate\"\]" "$f" &&
  grep -q "command: \[\"web\"\]" "$f" && grep -q "command: \[\"worker\"\]" "$f" &&
  grep -q "DATABASE_URL: postgres://migrator@postgres:5432/wingchunroots" "$f" && ! grep -q "migrator:\${" "$f" &&
  sed -n "/^  migrate:/,/^  web:/p" "$f" | grep -q "DB_MIGRATOR_PASSWORD: \${DB_MIGRATOR_PASSWORD:?" &&
  grep -q "migratorUrl(targetDatabaseUrl())" src/server/db/cli.ts && grep -q "condition: service_completed_successfully" "$f" &&
  grep -q "\"127.0.0.1:\${APP_PORT:-3000}:3000\"" "$f" && grep -q "/healthz" "$f" &&
  grep -q "source: \${BACKUP_DIR:-./backups}" "$f" && grep -A2 "source: \${BACKUP_DIR:-./backups}" "$f" | grep -q "target: /backups" &&
  grep -A3 "source: \${BACKUP_DIR:-./backups}" "$f" | grep -q "read_only: true" &&
  ! grep -qE "^\s+replicas:" "$f" && ! grep -qE "^\s+scale:" "$f"'

# 5. CI (In scope 3, 4) ---------------------------------------------------------------------------
check "ci.yml: the image job builds and starts the profile app, checks /healthz and runs @smoke against it" bash -c '
  f=.github/workflows/ci.yml
  grep -q "^  image:" "$f" && grep -q "docker compose --profile app up -d --build" "$f" &&
  grep -q "http://127.0.0.1:3000/healthz" "$f" && grep -q "E2E_BASE_URL: http://127.0.0.1:3000" "$f" &&
  grep -q "pnpm e2e --grep .@smoke" "$f" && grep -q "scripts/check-env.sh compose" "$f"'
check "the required ci job waits on the image job" bash -c '
  f=.github/workflows/ci.yml
  grep -qx "    needs: \[verify, security, image\]" "$f" && grep -q "test \"\$IMAGE\" = success" "$f"'
check "the verify job runs the drill's tools in the PostgreSQL 18 service container" \
  grep -q 'PG_CONTAINER: ${{ job.services.postgres.id }}' .github/workflows/ci.yml
check "restore-drill.yml: weekly, on pull requests touching the scripts or drizzle/, PostgreSQL 18 by digest" bash -c '
  f=.github/workflows/restore-drill.yml
  grep -q "cron:" "$f" && grep -q "scripts/backup-local.sh" "$f" && grep -q "scripts/restore-drill.sh" "$f" &&
  grep -q "drizzle/\*\*" "$f" && grep -qE "postgis/postgis:18-3\.6@sha256:[0-9a-f]{64}" "$f" &&
  grep -q "scripts/restore-drill.sh --test-database" "$f" && grep -q "PG_CONTAINER: \${{ job.services.postgres.id }}" "$f"'
refute "neither the image job nor restore-drill.yml uses a secret" bash -c '
  grep -n "secrets\." .github/workflows/restore-drill.yml
  awk "/^  image:/{on=1;next} /^  [a-z]+:$/{on=0} on" .github/workflows/ci.yml | grep -n "secrets\."'

# 6. Observability (In scope 2) ------------------------------------------------------------------
check "/healthz answers only {\"ok\":true} or {\"ok\":false} with no-store" bash -c '
  grep -q "body: '\''{\"ok\":true}'\''" src/server/services/system.ts && grep -q "body: '\''{\"ok\":false}'\''" src/server/services/system.ts &&
  grep -q "cache-control'\'': '\''no-store'\''" src/app/healthz/route.ts && grep -q "await connection()" src/app/healthz/route.ts'
check "/healthz checks the database and the queue schema" bash -c '
  grep -q "SELECT 1 AS ok" src/server/services/system.ts && grep -q "queueSchemaReady(getDb())" src/server/services/system.ts'
refute "the proxy's matcher never includes healthz, api or _next" grep -nE "matcher:.*(healthz|api|_next)" src/proxy.ts
check "pino is pinned exactly, in the ADR and the notices, and only src/server/log imports it" bash -c '
  grep -qE "^    \"pino\": \"[0-9]+\.[0-9]+\.[0-9]+\",$" package.json && grep -q "pino" docs/adr/0015-local-ops.md &&
  grep -qF "| [pino](https://getpino.io/) |" THIRD_PARTY_NOTICES.md'
check "ESLint keeps pino inside src/server/log" bash -c '
  grep -A1 -F "module: '\''src/server/log'\''," eslint.config.mjs | grep -qF "group: ['\''pino'\'', '\''pino/*'\'']"'
refute "no external error service: no Sentry package or import" bash -c 'grep -nE "\"@sentry/|from .@sentry/" package.json $(git ls-files "src/*.ts" "src/*.tsx")'
check "reportError has an empty provider by default" bash -c '
  grep -q "export const noErrorProvider" src/server/log/index.ts && grep -q "export async function reportError" src/server/log/index.ts'
check "every log line carries the request id; caught server errors are reported without the visited path" bash -c '
  grep -q "export function requestLogger(requestId: string)" src/server/log/index.ts &&
  grep -q "requestLogger(options.context.meta.requestId)" src/server/rpc/failure-log.ts &&
  grep -q "export const onRequestError" src/instrumentation.ts && grep -q "route: context.routePath" src/server/log/request-error.ts'
check "logger.redaction.test.ts covers e-mail, names, IP addresses and coordinates" bash -c '
  f=src/server/log/logger.redaction.test.ts
  grep -qi "e-mail\|email" "$f" && grep -qi "name" "$f" && grep -qi "ip" "$f" && grep -qi "coordinates" "$f"'
check "/admin/system: staff with a verified second factor, through system.status (GET /admin/system)" bash -c '
  grep -q "requireStaff2FA(principal)" src/server/services/system.ts &&
  grep -A4 "^    status: staffWithSecondFactor\$" src/server/rpc/router.ts | tr -d "\n " | grep -qF ".route({method:'\''GET'\'',path:'\''/admin/system'\''," &&
  grep -q "guardRoute(PATH)" src/app/admin/system/page.tsx && grep -qF "'\''/admin'\'': { kind: '\''staff2fa'\'' }" src/server/auth/guards.ts &&
  grep -q "\"/admin/system\"" docs/api/openapi.json'
check "/admin/system shows status as text with a shape, never by colour alone" bash -c '
  grep -q "Needs attention" src/app/admin/system/page.tsx && grep -q "<AlertIcon" src/app/admin/system/page.tsx'
check "the route list has /admin/system for axe in both themes" grep -qF "{ path: '/admin/system', name: 'admin-system', status: 200, milestone: 'M12', signInAs: 'admin' }" e2e/routes.ts

# 7. Screenshots and E2E (Done when 2, 4) ----------------------------------------------------------
check "directory exists and is not empty: docs/screenshots/M12/" bash -c '[ -d docs/screenshots/M12 ] && [ -n "$(ls -A docs/screenshots/M12)" ]'
for size in "${SIZES[@]}"; do
  for theme in "${THEMES[@]}"; do
    check "screenshot: docs/screenshots/M12/admin-system-$size-$theme.png" test -s "docs/screenshots/M12/admin-system-$size-$theme.png"
  done
done
titles=(
  '@M12 /healthz returns only {"ok":true}'
  '@M12 /admin/system shows queue depth and the last backup time to verified staff only'
)
for title in "${titles[@]}"; do
  check "E2E test: $title" grep -qF "$title" e2e/ops.spec.ts
done
check "Playwright runs against a running server with E2E_BASE_URL (the image job)" bash -c '
  grep -q "E2E_BASE_URL" playwright.config.ts && grep -q "E2E_BASE_URL" e2e/helpers/auth.ts'

# 8. Decisions by default and documentation (In scope 5) -----------------------------------------
check "DEFAULT D24 is marked in the drill and the documents" bash -c '
  grep -q "DEFAULT D24" scripts/restore-drill.sh && grep -q "DEFAULT D24" docs/operations/backup-and-restore.md &&
  grep -q "DEFAULT D24" docs/operations/incident.md'
check "docs/operations/local-run.md: Windows (Docker Desktop, WSL2), Linux and macOS; update; stop" bash -c '
  f=docs/operations/local-run.md
  grep -q "WSL2" "$f" && grep -q "Docker Desktop" "$f" && grep -q "Linux" "$f" && grep -q "macOS" "$f" &&
  grep -q "docker compose --profile app up --build" "$f" && grep -q "scripts/check-env.sh compose" "$f" &&
  grep -qE "[Оо]бновяване" "$f" && grep -qE "[Сс]пиране" "$f"'
check "docs/operations/backup-and-restore.md: the archive, the drill, RPO, RTO of 4 hours and hosting" bash -c '
  f=docs/operations/backup-and-restore.md
  grep -q "scripts/backup-local.sh" "$f" && grep -q "scripts/restore-drill.sh" "$f" && grep -q "RPO" "$f" &&
  grep -q "RTO" "$f" && grep -q "4 часа" "$f" && grep -q "хостинг" "$f"'
check "docs/operations/incident.md: the support response time in the pilot and the steps for a data leak" bash -c '
  f=docs/operations/incident.md
  grep -qE "[Сс]рок за отговор" "$f" && grep -qE "[Ии]зтичане на данни" "$f"'
check "the admin guide covers the production-like run, the archive, the restore and /admin/system" bash -c '
  f=docs/guides/admin-guide.bg.md
  grep -q "(M12)" "$f" && grep -q "docker compose --profile app up --build" "$f" && grep -q "scripts/backup-local.sh" "$f" &&
  grep -q "scripts/restore-drill.sh" "$f" && grep -q "/admin/system" "$f"'
check "docs/adr/0015-local-ops.md records the image, pino, the logging policy and the drill" bash -c '
  f=docs/adr/0015-local-ops.md
  grep -q "pino" "$f" && grep -q "standalone" "$f" && grep -q "tsx" "$f" && grep -q "restore-drill" "$f" && grep -q "D24" "$f"'
check "docs/plan/README.md has a status for M12" bash -c '! grep -qE "^\| M12 .*\| не е започнат \|$" docs/plan/README.md'
# The admin guide changes in the milestone's branch. Checkable while the branch is not merged and
# origin/main is known (not in a shallow CI checkout).
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  check "docs/guides/admin-guide.bg.md changed in this branch (differs from the merge base with origin/main)" \
    bash -c "! git diff --quiet $base -- docs/guides/admin-guide.bg.md"
else
  ok "the admin guide changed in this branch: not checkable here (merged, or no origin/main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M12 checks: $failures failed"
  exit 1
fi
echo "M12 checks: all passed"
