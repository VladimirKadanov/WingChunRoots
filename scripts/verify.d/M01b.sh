#!/usr/bin/env bash
# Milestone M01b checks (docs/plan/M01b-jobs-mail.md, "Done when"), run by scripts/verify.sh after
# the integration tests (outbox, pgboss, mailbox), the unit tests (templates), db:check,
# db:reset+migrate+seed and E2E. They stay valid after M01b, so `scripts/verify.sh all` keeps
# running them (CI, M13).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2
# shellcheck source=../lib/psql.sh
. scripts/lib/psql.sh

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

# grep_code <pattern> <file...>: like grep -niE, but ignores comments (SQL `--`, TypeScript `//`),
# so a comment that explains a rule does not break it. Prints file:line:text; exit 1 when nothing matches.
grep_code() {
  local pattern="$1"
  shift
  local f found=1
  for f in "$@"; do
    if sed -E -e 's/--.*$//' -e 's#(^|[[:space:]])//.*$##' "$f" | grep -niE "$pattern" | sed "s|^|$f:|"; then
      found=0
    fi
  done
  return "$found"
}

# 1. Required files (Done when, items 2-4) ---------------------------------------------------
required=(
  src/worker.ts src/server/jobs/boss.ts src/server/jobs/outbox.ts src/server/jobs/schema.ts
  src/server/jobs/worker.ts src/server/jobs/queues.ts src/server/mail/mailer.ts
  src/server/mail/transports.ts src/server/templates/notifications.ts
  src/server/templates/email/index.ts e2e/helpers/mailbox.ts e2e/mail.spec.ts
  docs/adr/0003-jobs-and-mail.md scripts/verify.d/M01b.sh
  src/server/jobs/outbox.int.test.ts src/server/jobs/pgboss.int.test.ts
  src/server/jobs/mailbox.int.test.ts src/server/templates/templates.test.ts
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done
for d in src/server/jobs src/server/mail src/server/templates src/server/templates/email; do
  check "directory exists: $d/" test -d "$d"
done

# 2. Packages and commands -------------------------------------------------------------------
check "pg-boss 12.38, nodemailer, react-email and @react-email/render are pinned exactly" node -e "
  const p = require('./package.json');
  const d = { ...p.dependencies, ...p.devDependencies };
  const exact = (n) => /^\d+\.\d+\.\d+$/.test(d[n] || '');
  process.exit(/^12\.38\.\d+$/.test(d['pg-boss'] || '') && ['nodemailer', 'react-email', '@react-email/render'].every(exact) ? 0 : 1)"
check "package.json has worker, worker:dev and mail:check, all on src/ entry points" node -e "
  const s = require('./package.json').scripts;
  process.exit(/src\/worker\.ts/.test(s.worker || '') && /watch src\/worker\.ts/.test(s['worker:dev'] || '') && /src\/server\/jobs\/cli\.ts/.test(s['mail:check'] || '') ? 0 : 1)"

# 3. pg-boss without DDL rights (In scope 1, Constraints) -------------------------------------
check "pg-boss runs with migrate: false and createSchema: false" bash -c '
  grep -qE "migrate: false" src/server/jobs/boss.ts && grep -qE "createSchema: false" src/server/jobs/boss.ts'
check "the schema step uses pg-boss's construction and migration plans" bash -c '
  grep -q getConstructionPlans src/server/jobs/schema.ts && grep -q getMigrationPlans src/server/jobs/schema.ts'
check "db:migrate runs the pg-boss step as migrator" bash -c '
  grep -q "migratePgBossSchema" src/server/db/admin.ts && grep -q "SET ROLE migrator" src/server/db/admin.ts'
refute "the pg-boss grants give no CREATE and nothing to app_public_ro" \
  grep_code 'GRANT[^;]*CREATE|app_public_ro' src/server/jobs/schema.ts
check "the worker connects as app_rw" bash -c "
  grep -qF \"roleUrl(targetDatabaseUrl(env), 'app_rw', rolePassword('app_rw', env))\" src/server/jobs/boss.ts &&
  grep -qE 'connectionString: appRwUrl\\(\\)' src/worker.ts"
refute "the worker and the jobs runtime never use the migrator role or the superuser URL" \
  grep_code "migrator|DB_MIGRATOR|withClient|from '\.\./db/admin'|from '\./server/db/admin'" \
  src/worker.ts src/server/jobs/boss.ts src/server/jobs/worker.ts src/server/jobs/outbox.ts src/server/jobs/queues.ts
if [ -n "${TEST_DATABASE_URL:-}" ]; then
  expected="$(node -p "require('pg-boss/package.json').pgboss.schema" 2>/dev/null)"
  facts="$(psql_url "$TEST_DATABASE_URL" -X -q -At -F ' ' -c "
    SELECT (SELECT version FROM pgboss.version),
           pg_get_userbyid(n.nspowner),
           has_database_privilege('app_rw', current_database(), 'CREATE'),
           has_schema_privilege('app_rw', 'pgboss', 'CREATE'),
           has_schema_privilege('app_rw', 'pgboss', 'USAGE'),
           has_table_privilege('app_rw', 'pgboss.job', 'SELECT, INSERT, UPDATE, DELETE'),
           has_schema_privilege('app_public_ro', 'pgboss', 'USAGE')
      FROM pg_namespace n WHERE n.nspname = 'pgboss'" 2>/dev/null)"
  check "the test database has pg-boss schema version $expected, owned by migrator" \
    test "$(echo "$facts" | cut -d' ' -f1-2)" = "$expected migrator"
  check "app_rw: no CREATE on the database or pgboss; USAGE and DML on pgboss; app_public_ro: nothing" \
    test "$(echo "$facts" | cut -d' ' -f3-)" = "f f t t f"
else
  bad "TEST_DATABASE_URL is not set: cannot check the pgboss schema and its privileges"
fi

# 4. Mail and templates (In scope 3) ----------------------------------------------------------
check "the Mailer has the SMTP and the file transport" bash -c '
  grep -q "createSmtpTransport" src/server/mail/transports.ts && grep -q "createFileTransport" src/server/mail/transports.ts'
check "Mailer.send takes template, to, data and idempotencyKey" bash -c '
  grep -qE "template" src/server/mail/types.ts && grep -qE "idempotencyKey" src/server/mail/types.ts'
check "email_delivery records attempts" grep -q "attempts" src/server/db/schema/records.ts
check "names in e-mail carry lang and translate=\"no\"" bash -c '
  grep -q "lang={" src/server/templates/email/components.tsx && grep -q "translate=\"no\"" src/server/templates/email/components.tsx'
check "ESLint keeps nodemailer, pg-boss and react-email inside their modules" bash -c '
  probe="import nodemailer from \"nodemailer\";\nimport { PgBoss } from \"pg-boss\";\nimport { Html } from \"react-email\";\nexport const x = [nodemailer, PgBoss, Html];\n"
  out="$(printf "$probe" | node_modules/.bin/eslint --stdin --stdin-filename src/server/services/m01b-probe.ts 2>&1)"
  [ "$(printf "%s" "$out" | grep -c "no-restricted-imports")" -eq 3 ] || exit 1
  printf "import nodemailer from \"nodemailer\";\nexport const x = nodemailer;\n" \
    | node_modules/.bin/eslint --stdin --stdin-filename src/server/mail/m01b-probe.ts'
# The rule must fire: a crash or a config error of ESLint also exits non-zero, so the exit status
# alone proves nothing.
check "ESLint keeps routes and components away from jobs and mail" bash -c '
  for target in src/app/m01b-probe.ts src/components/m01b-probe.tsx; do
    out="$(printf "import { queueEmail } from \"@/server/jobs/outbox\";\nimport { createMailer } from \"@/server/mail/mailer\";\nexport const x = [queueEmail, createMailer];\n" \
      | node_modules/.bin/eslint --stdin --stdin-filename "$target" 2>&1)"
    [ "$(printf "%s" "$out" | grep -c "no-restricted-imports")" -eq 2 ] || exit 1
  done'

# 5. Test helpers, E2E, CI and settings (In scope 4) ------------------------------------------
check "e2e/helpers/mailbox.ts reads the Mailpit API and the file transport" bash -c '
  grep -q "/api/v1/" e2e/helpers/mailbox.ts && grep -q "export function mailpitMailbox" e2e/helpers/mailbox.ts &&
  grep -q "export function fileMailbox" e2e/helpers/mailbox.ts'
check "playwright.config.ts starts pnpm worker and logs the server to test-results/server.log" bash -c '
  grep -q "pnpm worker" playwright.config.ts && grep -q "test-results/server.log" playwright.config.ts'
check "an E2E test is tagged @M01b" grep -q "@M01b" e2e/mail.spec.ts
check "CI runs Mailpit with the image digest of docker-compose.yml and MAIL_TRANSPORT=smtp" bash -c '
  image="$(grep -oE "axllent/mailpit:[^[:space:]]+@sha256:[0-9a-f]{64}" docker-compose.yml)"
  [ -n "$image" ] && grep -qF "$image" .github/workflows/ci.yml && grep -qE "MAIL_TRANSPORT: smtp" .github/workflows/ci.yml'
for name in MAIL_TRANSPORT SMTP_URL MAIL_FILE_DIR MAIL_FROM MAILPIT_URL; do
  check ".env.example names $name without a value" grep -qE "^$name=$" .env.example
done
check "the file transport's directory .mail/ is git-ignored" git check-ignore -q .mail/x.eml
check "scripts/verify.sh checks (and locally starts) Mailpit when MAIL_TRANSPORT=smtp" bash -c '
  grep -q "step mail check_mail" scripts/verify.sh && grep -q "docker compose up -d --wait mailpit" scripts/verify.sh &&
  grep -q "readyz" scripts/verify.sh'
check "SMTP_URL may only name the local Mailpit in Phase 1 (plan §3.3)" bash -c '
  grep -q "isLocalMailpitHost(hostname)" src/server/mail/config.ts'
check "idempotency keys refuse \"@\" (they outlive the address)" bash -c '
  grep -qF "x21-\\x3f\\x41-" src/server/mail/mailer.ts'
check "cloud sessions use the file transport" grep -q "MAIL_TRANSPORT=file" scripts/cloud-setup.sh

# 6. Documentation (In scope 5) ---------------------------------------------------------------
check "docs/adr/0003-jobs-and-mail.md has a status and a decision" bash -c '
  grep -q "Статус" docs/adr/0003-jobs-and-mail.md && grep -q "Решение" docs/adr/0003-jobs-and-mail.md'
check "docs/data-model.md describes the pgboss schema and the delivery attempts" bash -c '
  grep -q "pgboss" docs/data-model.md && grep -q "attempts" docs/data-model.md'
check "README.md explains pnpm worker and the mail transports" bash -c '
  grep -q "pnpm worker" README.md && grep -q "MAIL_TRANSPORT" README.md'

# docs/guides/ arrives with M00b. Once the admin guide exists, it covers what M01b gives the
# administrator (docs/plan/M01b-jobs-mail.md, "Follow-up"; docs/plan/RULES.md).
if [ -f docs/guides/admin-guide.bg.md ]; then
  check "docs/guides/admin-guide.bg.md covers pnpm worker, MAIL_TRANSPORT and Mailpit, mail:check and retention.purge" bash -c '
    f=docs/guides/admin-guide.bg.md
    grep -q "pnpm worker" "$f" && grep -q "MAIL_TRANSPORT" "$f" && grep -qi "mailpit" "$f" && grep -q "mail:check" "$f" && grep -q "retention.purge" "$f"'
else
  ok "docs/guides/admin-guide.bg.md does not exist yet (M00b); docs/plan/M01b-jobs-mail.md lists what it must cover"
fi
check "docs/plan/M01b-jobs-mail.md lists what the admin guide must cover" grep -q "Последваща работа" docs/plan/M01b-jobs-mail.md

if [ "$failures" -gt 0 ]; then
  echo "M01b checks: $failures failed"
  exit 1
fi
echo "M01b checks: all passed"
