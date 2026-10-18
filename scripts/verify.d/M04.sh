#!/usr/bin/env bash
# Milestone M04 checks (docs/plan/M04-lineage-api.md, "Done when"), run by scripts/verify.sh after
# the integration tests (lineage.int.test.ts: the node sets of ego, ancestors, subtree and paths on
# the fixture's anchors, statement_timeout, the caps, privacy for anonymous and involved viewers,
# the cache tags, the same answer over /api/v1 and /api/rpc), the unit tests (faults.test.ts: the
# switch and its refusal at start-up), db:reset+migrate+seed, the build and E2E (`@smoke|@M04`).
# They stay valid after M04, so `scripts/verify.sh all` keeps running them (CI, M13).
#
# Here: required files, the commands, the OpenAPI contract, the caps and the timeout in the code,
# the privacy rules of plan §6.2 and §6.4 in the code, the pages and their routes, the fault switch
# (including a start-up probe of the built server), the tests, the measurement, the screenshots,
# the decisions by default and the documentation (both guides changed in this branch).
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

# grep_code <pattern> <file...>: grep -nE that ignores comments (SQL `--`, TypeScript `//` and
# `/* */` lines), so a comment that states a rule does not break it. Prints file:line:text; exit 1
# when nothing matches.
grep_code() {
  local pattern="$1"
  shift
  local f found=1
  for f in "$@"; do
    if sed -E -e 's/--.*$//' -e 's#(^|[[:space:]])//.*$##' -e 's#^[[:space:]]*/?\*.*$##' "$f" | grep -nE "$pattern" | sed "s|^|$f:|"; then
      found=0
    fi
  done
  return "$found"
}

PUBLIC_READS=(src/server/services/lineage-graph.ts src/server/services/lineage-public.ts src/server/services/lineage.ts)
mapfile -t PEOPLE_UI < <(find "src/app/people" src/components/lineage -type f \( -name '*.ts' -o -name '*.tsx' \) | sort)
mapfile -t LINEAGE_SERVER < <(ls src/server/services/lineage*.ts src/server/dto/public.ts | grep -v '\.test\.ts$')
SCREENS=(person person-lineage person-error person-own-pending)
SIZES=(390x844 1440x900)
THEMES=(dark light)

# 1. Required files (Done when, item 4) ------------------------------------------------------------
required=(
  src/server/rpc/router.ts src/server/rpc/openapi.ts src/server/rpc/openapi-cli.ts
  src/server/services/lineage.ts src/server/services/lineage-graph.ts src/server/services/lineage-public.ts
  src/server/services/lineage-viewer.ts src/server/services/lineage.int.test.ts
  src/server/dto/public.ts src/server/cache.ts src/server/faults.ts src/server/faults.test.ts
  "src/app/people/[slug]/page.tsx" "src/app/people/[slug]/lineage/page.tsx" "src/app/people/[slug]/data.ts"
  src/components/lineage/status-legend.tsx src/components/lineage/states.tsx src/components/lineage/lineage-boundary.tsx
  src/components/lineage/descendants-outline.tsx src/components/lineage/person-not-found.tsx
  e2e/m04-lineage.spec.ts scripts/perf-queries.ts
  docs/api/openapi.json docs/api/lineage.md docs/perf/api.md scripts/verify.d/M04.sh
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done
check "directory exists and is not empty: src/server/rpc/" bash -c '[ -n "$(ls -A src/server/rpc)" ]'
check "directory exists and is not empty: docs/screenshots/M04/" bash -c '[ -d docs/screenshots/M04 ] && [ -n "$(ls -A docs/screenshots/M04)" ]'

# 2. Commands ----------------------------------------------------------------------------------------
check "package.json has api:openapi (src/server/rpc/openapi-cli.ts) and perf:queries (scripts/perf-queries.ts)" node -e "
  const s = require('./package.json').scripts || {};
  process.exit(/src\/server\/rpc\/openapi-cli\.ts/.test(s['api:openapi'] || '') && /scripts\/perf-queries\.ts/.test(s['perf:queries'] || '') ? 0 : 1)"

# 3. The API and its contract (In scope 1; plan §6.8) -------------------------------------------------
check "pnpm api:openapi --check: docs/api/openapi.json matches the router (log: .verify/M04-openapi.log)" bash -c '
  mkdir -p .verify && pnpm --silent api:openapi --check > .verify/M04-openapi.log 2>&1'
check "the contract has the six lineage and people paths, each a GET" node -e "
  const doc = require('./docs/api/openapi.json');
  const want = ['/lineage/ego', '/lineage/ancestors', '/lineage/subtree', '/lineage/paths', '/people/{slug}', '/people/{slug}/students'];
  process.exit(want.every((p) => doc.paths && doc.paths[p] && doc.paths[p].get) ? 0 : 1)"
check "the router exposes lineage.ego, ancestors, subtree, paths and people.get, students" bash -c '
  f=src/server/rpc/router.ts
  for h in lineageEgo lineageAncestors lineageSubtree lineagePaths personProfile personStudents; do grep -q "handler(.*$h(" "$f" || exit 1; done'
check "CI runs pnpm api:openapi --check" grep -q "pnpm api:openapi --check" .github/workflows/ci.yml

# 4. Caps, timeout and bounded input (In scope 1; plan §6.3) ------------------------------------------
check "every lineage read sets SET LOCAL statement_timeout = '2s' in its transaction" bash -c '
  grep -q "SET LOCAL statement_timeout = '\''2s'\''" src/server/services/lineage-graph.ts &&
  grep -q "readTransaction" src/server/services/lineage-public.ts && grep -q "readTransaction" src/server/services/lineage.ts'
check "the node cap is 500 and the rest goes to hiddenCounts" bash -c '
  grep -qE "export const NODE_CAP = 500;" src/server/services/lineage-graph.ts && grep -q "hiddenCounts" src/server/dto/public.ts'
check "every numeric input is bounded (ego up/down/fanoutLimit, subtree depth, paths limit, students page)" bash -c '
  f=src/server/services/lineage.ts
  grep -qE "up: bounded\(0, MAX_UP" "$f" && grep -qE "down: bounded\(0, MAX_DOWN" "$f" && grep -qE "fanoutLimit: bounded\(1, MAX_FANOUT" "$f" &&
  grep -qE "depth: bounded\(1, MAX_SUBTREE_DEPTH" "$f" && grep -qE "limit: bounded\(1, MAX_PATHS" "$f" && grep -qE "page: bounded\(1, 1000" "$f" &&
  grep -q "\.max(max" "$f"'

# 5. Privacy (In scope 2, 3; plan §6.2, §6.4) ---------------------------------------------------------
refute "the public lineage reads name no table, only v_public_person and v_public_edge" \
  grep_code "\b(FROM|JOIN)[[:space:]]+\"?(person|person_name|person_bio|teaching_relationship|training_period|lineage|place|school[a-z_]*|auth_[a-z_]+|evidence[a-z_]*|audit_log)\"?([[:space:]]|\)|$)" "${PUBLIC_READS[@]}"
check "the cached and public reads use app_public_ro (getPublicDb); only lineage-viewer.ts reads with app_rw" bash -c '
  grep -q "getPublicDb" src/server/services/lineage-public.ts && ! grep -qE "\bgetDb\b" src/server/services/lineage-public.ts \
    src/server/services/lineage-graph.ts src/server/services/lineage.ts && grep -qE "\bgetDb\b" src/server/services/lineage-viewer.ts'
check "the participant's own involved_only relationships come from the separate source, marked (DEFAULT D03)" bash -c '
  grep -q "export async function loadViewer" src/server/services/lineage-viewer.ts &&
  grep -q "visibility: '\''involved_only'\'' as const" src/server/services/lineage-graph.ts &&
  grep -q "isPersonalised(viewer)" src/server/services/lineage.ts'
check "every 'use cache' function in the lineage service tags its entry and returns a public DTO" bash -c '
  f=src/server/services/lineage-public.ts
  n=$(grep -c "^  '\''use cache'\'';" "$f"); [ "$n" -ge 6 ] &&
  [ "$(grep -c "tagCacheEntry(" "$f")" -ge "$n" ] && grep -q "toPublicGraph" "$f" && grep -q "toPublicPaths" "$f" &&
  grep -q "toPublicProfile" "$f" && grep -q "toPublicStudents" "$f"'
refute "no 'use cache' anywhere else in the lineage service, DTOs or person pages" \
  grep_code "^[[:space:]]*['\"]use cache['\"]" src/server/services/lineage.ts src/server/services/lineage-graph.ts src/server/services/lineage-viewer.ts src/server/dto/public.ts "${PEOPLE_UI[@]}"
refute "the cached reads never touch the session, cookies, headers or roles" \
  grep_code "next/headers|cookies\(|headers\(|[Pp]rincipal|[Ss]ession|\brole" src/server/services/lineage-public.ts
check "cache tags are person:<id> and lineage:<id>" bash -c '
  grep -q "\`person:\${personId}\`" src/server/cache.ts && grep -q "\`lineage:\${id}\`" src/server/cache.ts'
refute "no school location, point or coordinate in the lineage service, DTOs or person pages" \
  grep_code "public_point|private_location|latitude|longitude|ST_[A-Za-z]+\(|\blat\b|\blng\b|coordinates" "${LINEAGE_SERVER[@]}" "${PEOPLE_UI[@]}"
check "a hidden and a missing person get the same NOT_FOUND (one helper, one message)" bash -c '
  f=src/server/services/lineage.ts
  [ "$(grep -c "new ServiceError('\''NOT_FOUND'\''" "$f")" -eq 1 ] && grep -q "function notFound()" "$f"'
check "counts (childCount, hiddenCounts, profile counts) are read from v_public_edge only" bash -c '
  f=src/server/services/lineage-graph.ts
  awk "/^async function publicCounts/,/^}/" "$f" | grep -q "v_public_edge" &&
  ! awk "/^async function publicCounts/,/^}/" "$f" | grep -qE "extra|teaching_relationship"'

# 6. Pages, routes and the quality bar (In scope 4-6) -------------------------------------------------
refute "the person pages never import src/server/db" grep -nE "from ['\"](@/server/db|.*server/db)" "${PEOPLE_UI[@]}"
refute "no role=tree anywhere in the app (the outline is nested lists with details and summary)" \
  grep -rnE "role=[\"'{]+tree" src/app src/components
check "the descendants outline uses <details> and <summary>, open for the first two levels" bash -c '
  f=src/components/lineage/descendants-outline.tsx
  grep -q "<details" "$f" && grep -q "<summary" "$f" && grep -q "const OPEN_LEVELS = 2;" "$f" && grep -q "also a student of" "$f"'
check "names render with lang and translate=\"no\"" grep -q 'lang={name.lang} translate="no"' src/components/account/person-names.tsx
check "the profile has a catchError boundary with Retry; the list view a server-rendered Retry link" bash -c '
  grep -q "catchError" src/components/lineage/lineage-boundary.tsx && grep -q "Retry" src/components/lineage/lineage-boundary.tsx &&
  grep -q "LineageBoundary" "src/app/people/[slug]/page.tsx" && grep -q "SectionError" "src/app/people/[slug]/lineage/page.tsx"'
check "the status legend is shared and names each state in words (not by colour alone)" bash -c '
  grep -q "StatusLegend" "src/app/people/[slug]/page.tsx" && grep -q "StatusLegend" "src/app/people/[slug]/lineage/page.tsx" &&
  grep -q "words.label" src/components/lineage/status-legend.tsx'
check "the not-on-record page is not indexed (noindex, nofollow)" grep -qE "robots: \{ index: false, follow: false \}" src/components/lineage/person-not-found.tsx
for screen in person person-lineage; do
  check "/$screen is a key M04 route (visual regression, axe, screenshots)" grep -qE "name: '$screen'.*milestone: 'M04', key: true" e2e/routes.ts
done
check "the not-on-record page is an M04 route" grep -qE "path: '/people/demo-claim-only-teacher'.*milestone: 'M04'" e2e/routes.ts
for screen in "${SCREENS[@]}"; do
  for size in "${SIZES[@]}"; do
    for theme in "${THEMES[@]}"; do
      check "screenshot: docs/screenshots/M04/$screen-$size-$theme.png" test -s "docs/screenshots/M04/$screen-$size-$theme.png"
    done
  done
done

# 7. The fault switch (In scope 6, Constraints) --------------------------------------------------------
check "the switch is honoured only with a loopback APP_URL and checked at start-up" bash -c '
  grep -q "hasLoopbackAppUrl" src/server/faults.ts && grep -q "checkTestFaults(env)" src/server/auth/startup.ts &&
  grep -qE "^WCR_TEST_FAULTS=$" .env.example && grep -q "WCR_TEST_FAULTS: '\''lineage-once'\''" playwright.config.ts'
# The built server is started with the switch and a public https APP_URL (values in the environment
# win over .env; https, so that the APP_URL check itself passes) and must exit with a non-zero status
# within 30 s, naming the switch. 124 is `timeout` stopping a server that kept running.
fault_startup_probe() {
  [ -f .next/BUILD_ID ] || return 1
  local port=$((${E2E_PORT:-3100} + 41)) log=.verify/M04-startup.log status
  mkdir -p .verify
  APP_URL=https://wingchunroots.example WCR_TEST_FAULTS=lineage-once \
    timeout 30 node_modules/.bin/next start --hostname 127.0.0.1 --port "$port" > "$log" 2>&1
  status=$?
  [ "$status" -ne 0 ] && [ "$status" -ne 124 ] &&
    grep -q "WingChunRoots cannot start: WCR_TEST_FAULTS is a test switch and is refused unless APP_URL is a loopback host" "$log"
}
check "a server with WCR_TEST_FAULTS and a public APP_URL exits at start with a non-zero status (log: .verify/M04-startup.log)" fault_startup_probe

# 8. E2E and integration tests (Done when, items 2 and 3) ---------------------------------------------
titles=(
  '@M04 profile of demo-two-lineages lists two teachers from different lineages with status text'
  '@M04 list view shows the routes of descent with JavaScript disabled'
  '@M04 with JavaScript disabled the descendants outline uses details and summary and contains no role=tree'
  '@M04 anonymous viewer never receives pending or under-review edges (HTML and API)'
  '@M04 the involved student sees their own pending request marked "Pending"'
  '@M04 lineage.ego on demo-hub-a caps students and reports hiddenCounts'
  '@M04 a pending request to demo-hub-a does not change its hiddenCounts or descendant count for an anonymous viewer'
  '@M04 a person with two teachers appears under both in the outline, marked "also a student of"'
  '@M04 when the lineage service fails once, the profile shows the catchError state with Retry, and Retry recovers'
  '@M04 profile and list view at 390x844 have no horizontal scroll'
  '@M04 no axe violations on the profile and list view in dark and light themes'
)
for t in "${titles[@]}"; do
  check "E2E test: $t" grep -qF "test('$t'" e2e/m04-lineage.spec.ts
done
refute "no skipped or focused M04 E2E test" grep -nE "test\.(skip|only|fixme)\(" e2e/m04-lineage.spec.ts
check "integration tests cover statement_timeout, the caps, demo-claim-only-teacher, the cache tags and /api/v1 = /api/rpc" bash -c '
  f=src/server/services/lineage.int.test.ts
  grep -q "statement_timeout" "$f" && grep -q "demo-claim-only-teacher" "$f" && grep -q "hiddenCounts" "$f" &&
  grep -q "/api/v1" "$f" && grep -q "/api/rpc" "$f" && grep -q "person:" "$f" && grep -q "fanoutLimit" "$f"'
refute "no skipped or focused lineage integration test" grep -nE "\b(it|test|describe)\.(skip|only|todo)\(" src/server/services/lineage.int.test.ts src/server/faults.test.ts

# 9. The measurement (In scope 7) ---------------------------------------------------------------------
check "docs/perf/api.md has the PostgreSQL version, uuid keys and every lineage procedure" bash -c '
  f=docs/perf/api.md
  grep -qE "PostgreSQL 1[6-9]\.[0-9]+" "$f" && grep -q "uuid" "$f" &&
  for p in lineage.ego lineage.ancestors lineage.subtree lineage.paths; do grep -q "\`$p\`" "$f" || exit 1; done'
check "docs/perf/api.md measured a graph of about 100,000 relationships" bash -c '
  grep -qE "(9[0-9]|1[01][0-9]),[0-9]{3} връзки" docs/perf/api.md'
check "perf:queries uses only fictional demo- people" bash -c '
  grep -q "demo-perf-" scripts/perf-queries.ts && grep -q "createTestDatabase" scripts/perf-queries.ts'

# 10. Decisions by default and documentation (In scope 8, 9; docs/plan/RULES.md) ----------------------
for d in D03 D05 D22; do
  check "DEFAULT $d is marked in the M04 code" bash -c "grep -qE 'DEFAULT $d' ${LINEAGE_SERVER[*]} src/components/lineage/*.ts*"
done
check "docs/api/lineage.md links openapi.json and covers privacy, cache tags, staff, the fault switch and the 200 page" bash -c '
  f=docs/api/lineage.md
  grep -q "](openapi.json)" "$f" && grep -q "app_public_ro" "$f" && grep -q "person:<id>" "$f" && grep -q "lineage:<rootId>" "$f" &&
  grep -q "Персоналът" "$f" && grep -q "WCR_TEST_FAULTS" "$f" && grep -q "статус 200" "$f" && grep -q "statement_timeout" "$f"'
check "docs/data-model.md describes the M04 view columns and migration" bash -c '
  f=docs/data-model.md
  grep -q "city_name" "$f" && grep -q "lineage_root_person_id" "$f" && grep -q "public_views_lineage_city" "$f"'
check "the user guide covers the profile and the list view" bash -c '
  f=docs/guides/user-guide.bg.md
  grep -q "## Профил на личност" "$f" && grep -q "## Списъчен изглед на родословието" "$f" && grep -q "Not on the record" "$f" &&
  grep -q "also a student of" "$f" && grep -q "Pending" "$f"'
check "the admin guide covers the API contract, the fault switch and pnpm perf:queries" bash -c '
  f=docs/guides/admin-guide.bg.md
  grep -q "pnpm api:openapi" "$f" && grep -q "WCR_TEST_FAULTS" "$f" && grep -q "pnpm perf:queries" "$f"'
check "docs/plan/README.md has a status for M04" bash -c '! grep -qE "^\| M04 .*\| не е започнат \|$" docs/plan/README.md'
# docs/plan/RULES.md and Done when, item 4: the guides change in the milestone's branch. Checkable
# while the branch is not merged and origin/main is known (not in a shallow CI checkout).
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  for guide in docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md; do
    check "$guide changed in this branch (differs from the merge base with origin/main)" \
      bash -c "! git diff --quiet $base -- $guide"
  done
else
  ok "the guides changed in this branch: not checkable here (merged, or no origin/main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M04 checks: $failures failed"
  exit 1
fi
echo "M04 checks: all passed"
