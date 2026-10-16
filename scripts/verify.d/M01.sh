#!/usr/bin/env bash
# Milestone M01 checks (docs/plan/M01-data-model.md, "Done when"), run by scripts/verify.sh after
# the integration tests, db:check and db:reset+migrate+seed. They stay valid after M01, so
# `scripts/verify.sh all` keeps running them (CI, M13).
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

# 1. Required files (Done when, item 4) ---------------------------------------------------
required=(
  drizzle.config.ts src/server/db/ids.ts scripts/db-bootstrap.sql scripts/db-bootstrap.sh
  src/fixtures/generate.ts fixtures/lineage-600.json docs/data-model.md docs/adr/0002-data-model.md
  scripts/verify.d/M01.sh src/server/db/schema/index.ts src/server/db/schema/geography.ts
  src/server/db/index.ts src/server/db/testing.ts vitest.int.config.mts
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done
check "directory exists: src/server/db/schema/" test -d src/server/db/schema
migrations=(drizzle/*/migration.sql)
if [ -e "${migrations[0]}" ]; then
  ok "drizzle/ has ${#migrations[@]} migration(s)"
else
  bad "drizzle/ has at least one migration"
  migrations=()
fi
int_tests=(src/server/db/*.int.test.ts)
if [ -e "${int_tests[0]}" ]; then ok "integration tests: ${#int_tests[@]} file(s) in src/server/db/*.int.test.ts"; else bad "integration tests in src/server/db/*.int.test.ts"; fi
check "scripts/db-bootstrap.sh is executable" test -x scripts/db-bootstrap.sh

# 2. Migrations: PostgreSQL 16+ SQL, no roles or secrets (Done when 3; In scope 3, 6) -----------
if [ "${#migrations[@]}" -gt 0 ]; then
  refute "migrations never call uuidv7()" grep_code 'uuidv7[[:space:]]*\(' "${migrations[@]}"
  refute "migrations create or alter no role and set no password (only GRANT and REVOKE)" \
    grep_code '(CREATE|ALTER|DROP)[[:space:]]+(ROLE|USER)|PASSWORD' "${migrations[@]}"
  refute "migrations use no virtual generated column (PostgreSQL 18)" grep_code '\)[[:space:]]*VIRTUAL' "${migrations[@]}"
  refute "migrations use no OLD/NEW in RETURNING (PostgreSQL 18)" grep_code 'RETURNING[^;]*\b(OLD|NEW)\.' "${migrations[@]}"
  check "the extensions postgis, pg_trgm, unaccent and fuzzystrmatch are created by a migration" bash -c '
    for e in postgis pg_trgm unaccent fuzzystrmatch; do
      grep -qiE "CREATE EXTENSION IF NOT EXISTS \"?$e\"?" drizzle/*/migration.sql || exit 1
    done'
  check "three geography(Point,4326) columns with a GiST index each" bash -c '
    test "$(grep -ohE "geography\(Point,4326\)" drizzle/*/migration.sql | wc -l)" -ge 3 &&
    for c in centroid public_point exact_point; do
      grep -qE "USING gist \(\"$c\"\)" drizzle/*/migration.sql || exit 1
    done'
  check "covering indexes on teaching_relationship (student and teacher)" bash -c '
    grep -qE "\(\"student_person_id\"\) INCLUDE \(\"teacher_person_id\", \"status\", \"lineage_id\"\)" drizzle/*/migration.sql &&
    grep -qE "\(\"teacher_person_id\"\) INCLUDE \(\"student_person_id\", \"status\", \"lineage_id\"\)" drizzle/*/migration.sql'
  check "audit_log: REVOKE UPDATE, DELETE from app_rw and a trigger that refuses changes" bash -c '
    grep -qE "REVOKE UPDATE, DELETE.*\"audit_log\".* FROM app_rw" drizzle/*/migration.sql &&
    grep -qE "CREATE TRIGGER .* ON \"audit_log\"" drizzle/*/migration.sql'
  # Every statement that grants to app_public_ro is one of these two exact lines, so a later
  # GRANT cannot slip a private table in next to the views (privacy.int.test.ts checks the
  # resulting privileges in the database as well).
  check "app_public_ro gets only the three public views" bash -c '
    test "$(grep -hE "TO [^;]*app_public_ro" drizzle/*/migration.sql |
      grep -vxF -e "GRANT USAGE ON SCHEMA public TO app_rw, app_public_ro;" \
        -e "GRANT SELECT ON TABLE \"v_public_person\", \"v_public_edge\", \"v_public_school\" TO app_rw, app_public_ro;" |
      wc -l)" -eq 0'
fi
refute "src/server/db never calls the uuidv7() SQL function" grep -rnE "sql\`[^\`]*uuidv7\(" src/server/db

# 3. Configuration and secrets ----------------------------------------------------------------
refute "drizzle.config.ts has no credentials" grep -nE 'dbCredentials|postgres(ql)?://' drizzle.config.ts
refute "scripts/db-bootstrap.sql contains no password literal (passwords come from \\getenv)" \
  grep -niE "PASSWORD[[:space:]]+'" scripts/db-bootstrap.sql
check "scripts/db-bootstrap.sql reads the three passwords with \\getenv" bash -c '
  for v in DB_MIGRATOR_PASSWORD DB_APP_RW_PASSWORD DB_APP_PUBLIC_RO_PASSWORD; do
    grep -qE "^\\\\getenv [a-z_]+ $v$" scripts/db-bootstrap.sql || exit 1
  done'
check ".env.example lists the role password variables without values" bash -c '
  for v in DB_MIGRATOR_PASSWORD DB_APP_RW_PASSWORD DB_APP_PUBLIC_RO_PASSWORD; do
    grep -qE "^$v=$" .env.example || exit 1
  done'
check "drizzle-orm and drizzle-kit are pinned to the same exact 1.0 RC" node -e "
  const p = require('./package.json');
  const o = p.dependencies['drizzle-orm'], k = p.devDependencies['drizzle-kit'];
  process.exit(/^1\.0\.0-rc\.\d+$/.test(o) && o === k ? 0 : 1)"
check "package.json has test:int and db:migrate, db:seed, db:reset, db:check" node -e "
  const s = require('./package.json').scripts;
  process.exit(['test:int', 'db:migrate', 'db:seed', 'db:reset', 'db:check'].every((n) => s[n]) ? 0 : 1)"
check "the Testcontainers image is the PostGIS digest of docker-compose.yml and CI" bash -c '
  image="$(grep -oE "postgis/postgis:[^'"'"'\" ]+@sha256:[0-9a-f]{64}" src/server/db/testing.ts | head -n 1)"
  [ -n "$image" ] && grep -qF "$image" docker-compose.yml && grep -qF "$image" .github/workflows/ci.yml'
check "scripts/verify.sh runs db:reset+migrate+seed against TEST_DATABASE_URL" \
  grep -qE 'DATABASE_URL="\$TEST_DATABASE_URL"' scripts/verify.sh
check "scripts/verify.sh bootstraps the test database" grep -qE 'step db-bootstrap ' scripts/verify.sh
check "scripts/cloud-setup.sh bootstraps the roles (SessionStart hook)" grep -q 'db-bootstrap.sh' scripts/cloud-setup.sh
check "vitest.config.mts keeps integration tests out of pnpm test" grep -qF "'src/**/*.int.test.ts'" vitest.config.mts

# 4. Fixtures (In scope 10; D20) -------------------------------------------------------------
check "fixtures/lineage-600.json is up to date (pnpm fixtures:generate)" pnpm -s exec tsx src/fixtures/cli.ts --check
check "fixtures/lineage-600.json has the plan §6.3 keys and only demo- anchors" node -e "
  const j = require('./fixtures/lineage-600.json');
  const keys = ['focusId', 'dataVersion', 'nodes', 'edges', 'hiddenCounts'];
  const okKeys = keys.every((k) => k in j);
  const okAnchors = Object.keys(j.anchors).length > 0 && Object.keys(j.anchors).every((s) => s.startsWith('demo-'));
  const okSize = j.nodes.length >= 500 && j.edges.length >= j.nodes.length - 3;
  process.exit(okKeys && okAnchors && okSize ? 0 : 1)"
refute "the fixture generator never uses Math.random or the clock" \
  grep_code 'Math\.random|Date\.now\(|new Date\(\)' src/fixtures/generate.ts src/fixtures/random.ts src/fixtures/names.ts src/fixtures/geonames-cities.ts

# 5. Decisions by default and documentation (In scope 11) ------------------------------------
for d in D03 D05 D12 D13 D20 D22; do
  check "DEFAULT $d is marked in code or docs" bash -c "grep -rqE 'DEFAULT $d\\b' src drizzle docs/data-model.md docs/adr/0002-data-model.md"
done
check "docs/data-model.md covers ip_hmac as personal data with a retention period" bash -c '
  grep -q "ip_hmac" docs/data-model.md && grep -qi "лични данни" docs/data-model.md && grep -qi "срок" docs/data-model.md'
check "docs/data-model.md names every table of the schema" node -e "
  const fs = require('fs');
  const dir = 'src/server/db/schema';
  const doc = fs.readFileSync('docs/data-model.md', 'utf8');
  const tables = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .flatMap((f) => [...fs.readFileSync(dir + '/' + f, 'utf8').matchAll(/pgTable\\(\\s*'([a-z_]+)'/g)].map((m) => m[1]));
  const missing = tables.filter((t) => !doc.includes('\`' + t + '\`'));
  if (tables.length < 20 || missing.length) { console.error(tables.length, missing); process.exit(1); }"
check "docs/adr/0002-data-model.md has a status and a decision" bash -c '
  grep -q "Статус" docs/adr/0002-data-model.md && grep -q "Решение" docs/adr/0002-data-model.md'

if [ "$failures" -gt 0 ]; then
  echo "M01 checks: $failures failed"
  exit 1
fi
echo "M01 checks: all passed"
