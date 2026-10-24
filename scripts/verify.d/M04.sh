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
SCREENS=(person person-lineage person-error person-own-pending person-profile-error person-not-on-record person-hub)
SIZES=(390x844 1440x900)
THEMES=(dark light)

# 1. Required files (Done when, item 4) ------------------------------------------------------------
required=(
  src/server/rpc/router.ts src/server/rpc/openapi.ts src/server/rpc/openapi-cli.ts
  src/server/services/lineage.ts src/server/services/lineage-graph.ts src/server/services/lineage-public.ts
  src/server/services/lineage-viewer.ts src/server/services/lineage.int.test.ts
  src/server/dto/public.ts src/server/cache.ts src/server/faults.ts src/server/faults.test.ts
  "src/app/people/[slug]/page.tsx" "src/app/people/[slug]/lineage/page.tsx" "src/app/people/[slug]/data.ts"
  src/components/lineage/key.tsx src/components/lineage/states.tsx src/components/lineage/lineage-boundary.tsx
  src/components/lineage/descendants-outline.tsx src/components/lineage/person-not-found.tsx
  src/components/lineage/person-layout.tsx src/components/lineage/status.test.ts
  src/proxy.ts src/proxy.test.ts src/lib/not-on-record.ts "src/app/people/[slug]/error.tsx" src/app/global-error.tsx
  e2e/m04-lineage.spec.ts scripts/perf-queries.ts
  docs/api/openapi.json docs/api/lineage.md docs/perf/api.md scripts/verify.d/M04.sh
  docs/adr/0008-person-pages-404.md docs/plan/questions/M04.md
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
check "the key is the shared ink Legend and names each state in words (not by colour alone)" bash -c '
  grep -q "LineageKey" "src/app/people/[slug]/page.tsx" && grep -q "LineageKey" "src/app/people/[slug]/lineage/page.tsx" &&
  grep -q "<Legend " src/components/lineage/key.tsx && grep -q "words.label" src/components/ink/legend.tsx &&
  [ ! -e src/components/lineage/status-legend.tsx ]'
check "the not-on-record page is not indexed (noindex, nofollow)" grep -qE "robots: \{ index: false, follow: false \}" src/components/lineage/person-not-found.tsx
for screen in person person-lineage; do
  check "/$screen is a key M04 route (visual regression, axe, screenshots)" grep -qE "name: '$screen'.*milestone: 'M04', key: true" e2e/routes.ts
done
# The owner's decision of 2026-10-19 (docs/plan/questions/M04.md, option 1; ADR 0008): a hidden,
# missing or malformed person address answers 404 through src/proxy.ts, with the same status and
# the same HTML for all three, with and without JavaScript. The M02 check allows no other proxy and
# no middleware file.
owner_proxy() {
  [ -f src/proxy.ts ] || return 1
  # One matcher, exactly the two person paths (whitespace aside).
  [ "$(grep -oE 'matcher *:' src/proxy.ts | wc -l)" -eq 1 ] || return 1
  [ "$(tr -d '\n' < src/proxy.ts | grep -oE 'matcher: *\[[^]]*\]' | tr -d ' ')" = "matcher:['/people/:slug','/people/:slug/lineage']" ] || return 1
  grep -qF "expect(config.matcher).toEqual(['/people/:slug', '/people/:slug/lineage']);" src/proxy.test.ts || return 1
  # It asks the lineage service and rewrites to the person 404; the not-found page renders it, never indexed.
  grep -q 'personPageVisible' src/proxy.ts && grep -qF 'NextResponse.rewrite(new URL(NOT_ON_RECORD_PATH, request.url)' src/proxy.ts &&
    grep -qF "if ((await headers()).get(NOT_ON_RECORD_HEADER) === 'person') return <PersonNotFound />;" src/app/not-found.tsx &&
    grep -qE 'robots: \{ index: false, follow: false \}' src/app/not-found.tsx
}
check "src/proxy.ts has exactly the matchers ['/people/:slug', '/people/:slug/lineage'] and rewrites to the person 404, never indexed (ADR 0008)" owner_proxy
# Review round 2, recheck-7: the check gives up after a short deadline and never hides a page then.
check "the proxy's person check has a deadline of at most 500 ms, and passes the request through when it fails or runs out (recheck-7)" bash -c '
  budget=$(grep -oE "^export const PERSON_CHECK_BUDGET_MS = [0-9_]+;" src/server/services/lineage.ts | grep -oE "[0-9_]+;" | tr -d "_;") &&
  [ -n "$budget" ] && [ "$budget" -le 500 ] &&
  grep -q "readDeadline(budgetMs)" src/server/services/lineage.ts &&
  grep -q "loadViewer(principal, deadline)" <(awk "/^export async function personPageVisible/,/^}/" src/server/services/lineage.ts) &&
  grep -q "withinDeadline(check, PERSON_CHECK_BUDGET_MS)" src/proxy.ts &&
  [ "$(grep -c "return NextResponse.next();" src/proxy.ts)" -eq 2 ] &&
  grep -q "a check that never answers (a stalled database) lets the page through after the budget" src/proxy.test.ts &&
  grep -q "a stalled database stops the check after its budget" src/server/services/lineage.int.test.ts &&
  grep -q "the signed-in leg (the session.s own relationships) stops after the same" src/server/services/lineage.int.test.ts'
# Final check, privacy-security-1: 2 s for the whole procedure, a cached read on a miss included.
check "every cached read of a procedure is raced against the procedure deadline (withinBudget), with an int test behind staggered locks" bash -c '
  [ "$(grep -c "await withinBudget(deadline, () => cached" src/server/services/lineage.ts)" -eq 6 ] &&
  ! grep -nE "await cached(Ego|Ancestors|Subtree|Paths|Profile|Students)\(" src/server/services/lineage.ts &&
  grep -q "^export function withinBudget" src/server/services/lineage-graph.ts &&
  grep -q "2 s for the whole procedure, a cached read included" src/server/services/lineage.int.test.ts'
# The routes table, the screenshot state and the E2E privacy test expect the 404.
owner_404_tests() {
  local e2e=e2e/m04-lineage.spec.ts line
  grep -qE "path: '/people/demo-claim-only-teacher'.*status: 404, milestone: 'M04'" e2e/routes.ts || return 1
  awk "/name: 'person-not-on-record'/,/^  \},/" e2e/screenshots.spec.ts | grep -qF 'expect(response?.status()).toBe(404);' || return 1
  for line in \
    'await pageOf(request, `/people/demo-claim-only-teacher${suffix}`),' \
    'await pageOf(request, `/people/demo-no-such-person${suffix}`),' \
    'await pageOf(request, `/people/BAD_slug${suffix}`),' \
    'expect(missingPage.status, `/people/demo-no-such-person${suffix}`).toBe(404);' \
    'expect(missingPage.html).toMatch(/<meta name="robots" content="noindex, nofollow"\s*\/?>/);' \
    'expect(hiddenPage, `/people/demo-claim-only-teacher${suffix}`).toEqual(missingPage);' \
    'expect(malformedPage, `/people/BAD_slug${suffix}`).toEqual(missingPage);' \
    "const notOnRecord = ['/people/demo-claim-only-teacher', '/people/demo-no-such-person', '/people/BAD_slug'];" \
    'expect(underReview).toEqual(await pageOf(request, '"'"'/people/demo-no-such-person/lineage'"'"'));' \
    'await withoutJavaScript(browser, async (noScript) => {' \
    'expect(response?.status(), path).toBe(404);' \
    'expect(new Set(seen).size).toBe(1);' \
    "expect(response?.status()).toBe(path.endsWith('teacher') ? 404 : 200);"; do
    grep -qF -- "$line" "$e2e" || { echo "     missing in $e2e: $line"; return 1; }
  done
  # No person address is expected to answer 200 with "Not on the record" any more.
  ! grep -qE "path: '/people/demo-claim-only-teacher'.*status: 200" e2e/routes.ts &&
    ! grep -qE "withSortedHead|(hiddenPage|missingPage|malformedPage|underReview)\.status.*toBe\(200\)" "$e2e"
}
check "the routes table, the screenshot and the E2E test expect 404 and the same HTML for a hidden, missing and malformed address, with and without JavaScript" owner_404_tests
check "docs/plan/questions/M04.md has the owner's answer (option 1, ch0k0, 2026-10-19)" bash -c '
  f=docs/plan/questions/M04.md
  grep -qF "**Answer:** Option 1, a proxy for the two person paths only (ch0k0, 2026-10-19, decision card in the project thread)." "$f" &&
  ! grep -q "(filled in by the owner)" "$f" && grep -q "Статус | Прието" docs/adr/0008-person-pages-404.md'
for screen in "${SCREENS[@]}"; do
  for size in "${SIZES[@]}"; do
    for theme in "${THEMES[@]}"; do
      check "screenshot: docs/screenshots/M04/$screen-$size-$theme.png" test -s "docs/screenshots/M04/$screen-$size-$theme.png"
    done
  done
done

# 7. The fault switch (In scope 6, Constraints) --------------------------------------------------------
check "the switch is compiled in only with WCR_E2E_BUILD=1, honoured only with a loopback APP_URL and checked at start-up" bash -c '
  grep -q "hasLoopbackAppUrl" src/server/faults.ts && grep -q "checkTestFaults(env)" src/server/auth/startup.ts &&
  grep -q "WCR_E2E_BUILD: process.env.WCR_E2E_BUILD" next.config.ts &&
  node -e "process.exit(/WCR_E2E_BUILD=1 next build/.test(require(\"./package.json\").scripts[\"build:e2e\"] || \"\") ? 0 : 1)" &&
  grep -q "step build pnpm build:e2e" scripts/verify.sh &&
  grep -qE "^WCR_TEST_FAULTS=$" .env.example && grep -q "WCR_TEST_FAULTS: '\''lineage-once,person-once'\''" playwright.config.ts'
# What only the switch puts in a server bundle: its cookie name, its store and its error message.
# Source maps (*.map) are left out: they carry the original text of every module for stack traces,
# not code that runs.
FAULT_MARKERS='wcr-test-fault|__wcrUsedFaultTokens|Test fault: '
check "the E2E build (.next, scripts/verify.sh step build) has the switch, so the check below can see it" \
  bash -c "[ -f .next/BUILD_ID ] && grep -rqE --exclude='*.map' '$FAULT_MARKERS' .next/server"
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
# A deployable build (`pnpm build`, without WCR_E2E_BUILD) in a directory of its own
# (next.config.ts distDir), so the E2E build in .next stays: none of the markers may be in its
# server bundle, and started with the switch on a loopback APP_URL it must refuse to start.
# next build rewrites next-env.d.ts and the include list of tsconfig.json for its distDir, so both
# files are put back afterwards.
deployable_build_probe() {
  local dir=.verify/next-deploy log=.verify/M04-deployable-build.log port=$((${E2E_PORT:-3100} + 42)) status saved
  mkdir -p .verify
  rm -rf "$dir"
  saved="$(mktemp -d)"
  cp tsconfig.json "$saved/tsconfig.json"
  [ -f next-env.d.ts ] && cp next-env.d.ts "$saved/next-env.d.ts"
  WCR_DIST_DIR="$dir" WCR_E2E_BUILD= pnpm --silent build > "$log" 2>&1
  status=$?
  cp "$saved/tsconfig.json" tsconfig.json
  [ -f "$saved/next-env.d.ts" ] && cp "$saved/next-env.d.ts" next-env.d.ts
  rm -rf "$saved"
  if [ "$status" -ne 0 ] || [ ! -f "$dir/BUILD_ID" ]; then
    echo "     the deployable build failed (log: $log)"
    return 1
  fi
  if grep -rlE --exclude='*.map' "$FAULT_MARKERS" "$dir/server" >> "$log" 2>&1; then
    echo "     the fault switch is in the deployable build: $(grep -rlE --exclude='*.map' "$FAULT_MARKERS" "$dir/server" | head -n 3 | tr '\n' ' ')"
    return 1
  fi
  WCR_DIST_DIR="$dir" APP_URL="http://127.0.0.1:$port" WCR_TEST_FAULTS=lineage-once \
    timeout 30 node_modules/.bin/next start --hostname 127.0.0.1 --port "$port" >> "$log" 2>&1
  status=$?
  rm -rf "$dir"
  [ "$status" -ne 0 ] && [ "$status" -ne 124 ] &&
    grep -q "WingChunRoots cannot start: WCR_TEST_FAULTS is set, but this build has no test switch" "$log"
}
if deployable_build_probe; then
  ok "a deployable build has no fault switch in its server bundle and refuses to start with WCR_TEST_FAULTS (log: .verify/M04-deployable-build.log)"
else
  bad "a deployable build has no fault switch in its server bundle and refuses to start with WCR_TEST_FAULTS (log: .verify/M04-deployable-build.log)"
fi

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
  # Review round 1: pages without JavaScript, both faults, founders, rows, phones, axe in more states.
  '@M04 with JavaScript disabled the profile shows its teachers and students'
  '@M04 a founder is named only as recorded (DEFAULT D22), on the profile and on a route'
  '@M04 a student row reads the same on the profile and in the list view, without a cross-lineage mark'
  '@M04 with JavaScript disabled a failed lineage read shows the error with a Retry link that reloads'
  '@M04 when the profile read fails once, the page shows its own error state, and Retry recovers'
  '@M04 at 390x844 the first teacher is on the first screen of the profile'
  '@M04 no axe violations on the profile and list view at 390x844'
  '@M04 no axe violations on the private record and the own request, signed in'
  # Review round 2 and the final check: text at 200%, the hub on a phone, routes, touch targets, the
  # proxy with a session (cookie and bearer).
  '@M04 profile and list view at 390x844 have no horizontal scroll with text at 200%'
  '@M04 at 320x640 with text at 200% the profile and list view of two people have no horizontal scroll'
  '@M04 at 320x640 with text at 200% the descendants outlines of the three roots have no horizontal scroll'
  '@M04 signed in, the own request in the outline keeps to the screen at 320, 360 and 375 px with text at 200%'
  '@M04 at 390x844 the hub list view keeps to its height, with 44 px targets'
  '@M04 at 390x844 an "also a student of" note leaves the whole name target to the name'
  '@M04 a route counts the generations its gutter numbers, reads without "·", and its marks are in the key'
  '@M04 signed in, with a cookie or a bearer token, a hidden person still answers 404 like a missing one'
)
for t in "${titles[@]}"; do
  check "E2E test: $t" grep -qF "test('$t'" e2e/m04-lineage.spec.ts
done
refute "no skipped or focused M04 E2E test" grep -nE "test\.(skip|only|fixme)\(" e2e/m04-lineage.spec.ts
# Final check, requirements-2: the E2E run above went through src/proxy.ts with and without a
# session. A check that failed for any reason but running out of its 500 ms (the proxy's own
# timeout, or the database's statement_timeout 57014 when it fires first) lets the page answer
# with 200 instead of 404, so the run fails on it. The proxy logs only the code (CLAUDE.md §6).
proxy_log_clean() {
  local log=test-results/server.log
  [ -s "$log" ] || { echo "no $log: run the E2E tests first (scripts/verify.sh runs them before these checks)"; return 1; }
  # The line this check reads must still be the one the proxy writes.
  grep -qF '[proxy] the person check failed (${code}); the page answers for itself' src/proxy.ts || return 1
  ! grep -F '[proxy] the person check failed (' "$log" | grep -vE '\[proxy\] the person check failed \((timeout|57014)\);'
}
check "the E2E server log has no failed person check in src/proxy.ts other than its deadline (test-results/server.log)" proxy_log_clean
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
check "docs/api/lineage.md links openapi.json and covers privacy, cache tags, staff, the fault switch, the not-on-record page (noindex) and the API's 404" bash -c '
  f=docs/api/lineage.md
  grep -q "](openapi.json)" "$f" && grep -q "app_public_ro" "$f" && grep -q "person:<id>" "$f" && grep -q "lineage:<rootId>" "$f" &&
  grep -q "Персоналът" "$f" && grep -q "WCR_TEST_FAULTS" "$f" && grep -q "статус 404" "$f" && grep -q "0008-person-pages-404.md" "$f" &&
  grep -q "Not on the record" "$f" && grep -q "noindex, nofollow" "$f" && grep -q "statement_timeout" "$f"'
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
# The final check's documentation findings, so a later edit cannot bring the old claims back.
check "the docs state the real read bound: 2 s per procedure with the cached read (withinBudget), a page in two stages (final check, privacy-security-1)" bash -c '
  grep -q "withinBudget" docs/api/lineage.md && grep -q "Страниците четат на два етапа" docs/api/lineage.md &&
  grep -q "после разделите едновременно" docs/adr/0008-person-pages-404.md && grep -q "Колко чака страницата" docs/guides/admin-guide.bg.md'
check "docs/api/lineage.md: hiddenCounts may be higher for the participant; counts never include a pending request (final check, privacy-security-2)" bash -c '
  f=docs/api/lineage.md
  ! grep -q "и за анонимен посетител, и за самия участник" "$f" && grep -q "„публични хора, които не са показани“" "$f"'
check "docs/api/lineage.md: the content is in the same HTML response; the status and shell leave first (final check, requirements-3)" bash -c '
  f=docs/api/lineage.md
  ! grep -q "преди да изпратят първия байт" "$f" && grep -q "Съдържанието е в същия HTML отговор" "$f"'
check "the admin guide diagnoses a failing person check with pg_isready and pg_stat_activity, never pnpm db:check (final check, requirements-4)" bash -c '
  f=docs/guides/admin-guide.bg.md
  ! grep -qF "проверете \`pnpm db:check" "$f" && grep -q "pg_isready" "$f" && grep -q "pg_stat_activity" "$f" &&
  grep -qF "Не пускайте \`pnpm db:check\` срещу работна база" "$f"'
check "docs/plan/questions/M04.md opens with the owner's answer, not with open defaults (final check, requirements-5)" bash -c '
  f=docs/plan/questions/M04.md
  ! grep -q "which the owner can still change" "$f" && grep -q "the branch ships the answer" "$f"'
check "the proxy header, ADR 0008, the API doc and the admin guide say Next.js's /_next/data form passes through the proxy (final check, code-2)" bash -c '
  ! grep -q "api, healthz and _next never reach" src/proxy.ts &&
  for f in src/proxy.ts src/proxy.test.ts docs/adr/0008-person-pages-404.md docs/api/lineage.md docs/guides/admin-guide.bg.md; do
    grep -q "_next/data" "$f" || { echo "no _next/data in $f"; exit 1; }
  done'
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
