#!/usr/bin/env bash
# Milestone M13 checks (docs/plan/M13-pilot-acceptance.md, "Done when"), run by scripts/verify.sh
# after every step of `scripts/verify.sh all` (M13 runs the same steps and every scripts/verify.d/*.sh):
# the unit tests (e2e/projects.test.ts: the pilot run), the integration tests (the authorization
# matrix, src/server/rpc/authz-matrix.int.test.ts), the build and the three E2E runs, the last of
# them the `@pilot` suite (e2e/pilot.spec.ts) on desktop-chromium, mobile-chromium and, in CI,
# mobile-webkit.
#
# Here: pnpm perf:api with every p95 under 300 ms (DEFAULT D24); pnpm perf:web, Lighthouse in the
# mobile profile on every main route of plan §5.5 against `next start` of this build; the pilot
# run's wiring; the home page's ways in; the files, titles and screenshots; the Bulgarian documents.
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
# check_verbose: as check, and shows the command's last lines when it fails.
check_verbose() {
  local description="$1"
  shift
  local out
  if out="$("$@" 2>&1)"; then
    ok "$description"
  else
    bad "$description"
    printf '%s\n' "$out" | tail -n 25 | sed 's/^/     /'
  fi
}

SIZES=(390x844 1440x900)
THEMES=(dark light)

# 1. Required files (Done when 4) -----------------------------------------------------------------
required=(
  e2e/pilot.spec.ts e2e/m13-vitals.spec.ts src/server/rpc/authz-matrix.int.test.ts
  scripts/perf-api.ts scripts/lib/perf-api-run.ts scripts/lib/perf-graph.ts scripts/lib/next-cache-hook.ts scripts/lib/next-cache-stub.ts
  scripts/lighthouse-routes.ts scripts/lib/lighthouse-routes-run.ts scripts/lighthouse.mjs
  src/components/home/home-search.tsx
  docs/perf/api.md docs/perf/web-vitals.md docs/phase1-readiness.md
  docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done

# 2. The @pilot suite and its run (In scope 2; Done when 1, 2, 3) ------------------------------------
titles=(
  "@pilot register → onboarding → find a teacher with the palette → request → the teacher approves → the relationship shows in the profile, list view and explorer (opened focused from the palette) → find a school within 50 km in the teacher\\'s lineage"
  "@pilot an unrelated user cannot approve a claim or open evidence"
  "@pilot a teacher with students in two active lineages sees and manages both"
  "@pilot a teacher with two active verified teachers in different lineages appears in both lineage views, approves one student in each lineage, and their school is returned by the lineage filter of both roots"
  "@pilot leak scan: an anonymous crawl of all public routes, the sitemap, Open Graph and JSON-LD finds no private fields, pending edges, involved-only persons, city-only coordinates or evidence keys"
)
for title in "${titles[@]}"; do
  check "e2e/pilot.spec.ts › ${title//\\\'/\'}" grep -qF "test('$title'" e2e/pilot.spec.ts
done
check "the pilot run: PILOT_SPEC on desktop-chromium, mobile-chromium and (CI) mobile-webkit, left out of the other runs" bash -c '
  grep -q "export const PILOT_SPEC = '\''\*\*/pilot.spec.ts'\''" e2e/projects.ts &&
  grep -q "pilot ? { testMatch: PILOT_SPEC }" e2e/projects.ts && grep -q "EXCLUSIVE_SPECS, PILOT_SPEC\]" e2e/projects.ts &&
  grep -q "process.env.PW_PILOT === '\''1'\''" playwright.config.ts && grep -q "runPaths(pilot ? '\''pilot'\'' : exclusive)" playwright.config.ts'
check "scripts/verify.sh runs the pilot last, after the ordinary and the exclusive runs" bash -c '
  awk "/^run_e2e\\(\\) \\{/,/^\\}/" scripts/verify.sh > /tmp/m13-run-e2e.$$ &&
  grep -q "pnpm e2e \"\$@\" || return 1" /tmp/m13-run-e2e.$$ &&
  grep -q "PW_EXCLUSIVE=1 pnpm e2e --pass-with-no-tests \"\$@\" || return 1" /tmp/m13-run-e2e.$$ &&
  tail -n 4 /tmp/m13-run-e2e.$$ | grep -q "PW_PILOT=1 pnpm e2e$"; rc=$?; rm -f /tmp/m13-run-e2e.$$; exit $rc'
check "scripts/verify.sh M13 includes everything of all (every check and the whole E2E suite)" \
  grep -q 'if \[ "$target" = "all" \] || \[ "$target" = "M13" \]; then' scripts/verify.sh
check "the leak scan reads the sitemap, Open Graph, JSON-LD, the city-only private points, the evidence key and the pilot server log" bash -c '
  f=e2e/pilot.spec.ts
  grep -q "sitemap.xml" "$f" && grep -q "og:" "$f" && grep -q "application\\\\/ld+json" "$f" && grep -q "school_private_location" "$f" &&
  grep -q "storage_key" "$f" && grep -q "runPaths('\''pilot'\'').serverLog" "$f"'

# 3. The authorization matrix (In scope 3) ----------------------------------------------------------
check "the matrix covers every procedure, every role, over /api/rpc and through the Server Actions" bash -c '
  f=src/server/rpc/authz-matrix.int.test.ts
  grep -q "/api/rpc" "$f" && grep -q "SERVER_ACTION_TARGETS" "$f" &&
  for role in anonymous member owner party moderator archivist admin adminNo2fa; do grep -q "$role" "$f" || exit 1; done'

# 4. The home page (In scope 1) -----------------------------------------------------------------------
check "the home page: mission, verification, search, the explorer, the finder, sign in and sign up" bash -c '
  f=src/app/page.tsx
  grep -q "<HomeSearch />" "$f" && grep -q "href=\"/explore\"" "$f" && grep -q "href=\"/schools\"" "$f" &&
  grep -q "href=\"/sign-up\"" "$f" && grep -q "href=\"/sign-in\"" "$f" && grep -q "how-heading" "$f" &&
  grep -q "openSearch" src/components/home/home-search.tsx'
check "the home route is an M13 key screen" grep -qE "path: '/', name: 'home', status: 200, milestone: 'M13', key: true" e2e/routes.ts

# 5. pnpm perf:api (In scope 4; Done when 1; DEFAULT D24) ------------------------------------------
check "package.json has perf:api and perf:web" node -e "
  const s = require('./package.json').scripts;
  process.exit(s['perf:api'] === 'tsx scripts/perf-api.ts' && s['perf:web'] === 'tsx scripts/lighthouse-routes.ts' ? 0 : 1)"
check "the p95 ceiling is 300 ms (DEFAULT D24)" grep -q "export const P95_CEILING_MS = 300;" scripts/lib/perf-api-run.ts
check "docs/perf/api.md has the perf:api section with p95 values" bash -c '
  grep -qF "<!-- perf:api: generated by pnpm perf:api (scripts/perf-api.ts) -->" docs/perf/api.md && grep -q "p95" docs/perf/api.md'
mkdir -p .verify
if pnpm --silent perf:api --stdout > .verify/M13-perf-api.log 2>&1; then
  ok "pnpm perf:api: every p95 of lineage.ego and schools.search under 300 ms"
else
  bad "pnpm perf:api: every p95 of lineage.ego and schools.search under 300 ms"
  tail -n 25 .verify/M13-perf-api.log | sed 's/^/     /'
fi
grep -E '^\| `(lineage\.ego|schools\.search)`' .verify/M13-perf-api.log | sed 's/^/     /'

# 6. pnpm perf:web: Lighthouse on every main route (In scope 5; Done when 3) -----------------------
check "docs/perf/web-vitals.md has the Lighthouse section, the INP of the key interactions and the JavaScript budget" bash -c '
  f=docs/perf/web-vitals.md
  grep -qF "<!-- perf:web: generated by pnpm perf:web (scripts/lighthouse-routes.ts) -->" "$f" &&
  grep -q "INP" "$f" && grep -q "check-bundle-budget" "$f" && grep -q "4×" "$f"'
check "the INP test of the palette is tagged @M13 and measured at 4x CPU" bash -c '
  grep -qF "@M13 opening the search palette responds with INP under 200 ms at 4x CPU throttling" e2e/m13-vitals.spec.ts &&
  grep -q "setCPUThrottlingRate'\'', { rate: 4 }" e2e/helpers/explorer-checks.ts'
check "every screen of plan §5.5 has a route in pnpm perf:web" bash -c '
  f=scripts/lib/lighthouse-routes-run.ts
  for p in "'\''/'\''" /styleguide /sign-up /sign-in /reset-password /verify-email /account/security /account/privacy "'\''/admin'\''" /admin/system \
    /onboarding /people/demo-two-lineages /people/demo-two-lineages/lineage "'\''/explore'\''" "/explore?focus=" /dashboard/profile "'\''/dashboard'\''" /plans \
    /dashboard/teachers/new /dashboard/students/requests /dashboard/teachers/historical /admin/review /invite/ /admin/grants "'\''/schools'\''" \
    /schools/demo-school-sofia /dashboard/schools /legal/terms /legal/privacy /legal/licenses; do
    grep -qF "path: $p" "$f" || grep -qF "path: '\''$p" "$f" || { echo "missing $p"; exit 1; }
  done'

# Lighthouse against `next start` on its own port, as scripts/verify.d/M00b.sh does for `/`.
perf_web() {
  local port="${LHCI_ROUTES_PORT:-3103}" chrome="${PW_CHROMIUM_EXECUTABLE:-}"
  if [ -z "$chrome" ]; then
    chrome="$(node -e "process.stdout.write(require('@playwright/test').chromium.executablePath())" 2>/dev/null)"
  fi
  if [ ! -x "$chrome" ]; then
    echo "no Chromium for Lighthouse at '$chrome' (set PW_CHROMIUM_EXECUTABLE or run pnpm exec playwright install chromium)"
    return 1
  fi
  if [ ! -f .next/BUILD_ID ]; then
    echo "no build output: pnpm build:e2e"
    return 1
  fi
  if [ -z "${TEST_DATABASE_URL:-}" ]; then
    echo "TEST_DATABASE_URL is not set: the routes are measured on the seeded test database"
    return 1
  fi
  # This build must be measured, not a server that already answers on the port.
  if node -e "fetch('http://127.0.0.1:$port/').then(() => process.exit(0), () => process.exit(1))" 2>/dev/null; then
    echo "port $port is already in use; set LHCI_ROUTES_PORT to a free port"
    return 1
  fi
  local log=.verify/M13-perf-web-server.log starter=() pid i ready=0 rc=1
  command -v setsid >/dev/null 2>&1 && starter=(setsid)
  DATABASE_URL="$TEST_DATABASE_URL" APP_URL="http://127.0.0.1:$port" "${starter[@]}" pnpm --silent exec next start --hostname 127.0.0.1 --port "$port" > "$log" 2>&1 &
  pid=$!
  for i in $(seq 1 120); do
    kill -0 "$pid" 2>/dev/null || break
    if node -e "fetch('http://127.0.0.1:$port/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" 2>/dev/null; then
      ready=1
      break
    fi
    sleep 0.5
  done
  if [ "$ready" -eq 1 ] && kill -0 "$pid" 2>/dev/null; then
    DATABASE_URL="$TEST_DATABASE_URL" pnpm --silent perf:web --base="http://127.0.0.1:$port" --chrome-path="$chrome" --stdout 2>&1 | tee .verify/M13-perf-web.log
    rc=${PIPESTATUS[0]}
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "next start exited while Lighthouse ran; see $log"
      rc=1
    fi
  else
    echo "next start did not answer on port $port; see $log:"
    tail -n 5 "$log"
  fi
  if [ "${#starter[@]}" -gt 0 ]; then kill -- "-$pid" 2>/dev/null; else kill "$pid" 2>/dev/null; fi
  wait "$pid" 2>/dev/null
  return "$rc"
}
check_verbose "pnpm perf:web: LCP <= 2.5 s and CLS <= 0.1 on every main route in the mobile profile (lighthouserc.json)" perf_web
[ -f .verify/M13-perf-web.log ] && grep -E '^(ok  |FAIL|Lighthouse )' .verify/M13-perf-web.log | sed 's/^/     /'

# 7. Final screenshots (In scope 6) -------------------------------------------------------------------
check "SCREENSHOTS_FINAL writes the final set into its own folder" bash -c '
  grep -q "const final = process.env.SCREENSHOTS_FINAL;" e2e/screenshots.spec.ts && grep -q "FINAL_STATES" e2e/screenshots.spec.ts'
mapfile -t KEY_SCREENS < <(node -e "
  const src = require('fs').readFileSync('e2e/routes.ts', 'utf8');
  for (const m of src.matchAll(/name: '([^']+)'[^}]*key: true/g)) console.log(m[1]);")
FINAL_STATES=(explore-person explore-generations explore-lineage explore-list palette-cjk schools-map schools-map-selected)
check "the key screens were read from e2e/routes.ts" test "${#KEY_SCREENS[@]}" -ge 25
for screen in "${KEY_SCREENS[@]}" "${FINAL_STATES[@]}"; do
  for size in "${SIZES[@]}"; do
    for theme in "${THEMES[@]}"; do
      check "screenshot: docs/screenshots/M13/$screen-$size-$theme.png" test -s "docs/screenshots/M13/$screen-$size-$theme.png"
    done
  done
done

# 8. Documents (In scope 7, 8; Done when 4) ---------------------------------------------------------
check "docs/phase1-readiness.md: every condition of plan §2.2 with evidence; Phase 1 accepted with M13; hosting deferred" bash -c '
  f=docs/phase1-readiness.md
  grep -q "Фаза 1 се приема с M13" "$f" && grep -q "§3.3" "$f" && grep -q "Подготвено" "$f" && grep -q "Реализирано" "$f" && grep -q "Тествано" "$f" &&
  grep -q "регистрира" "$f" && grep -q "две активни линии" "$f" && grep -q "чужди доказателства" "$f" && grep -q "authz-matrix.int.test.ts" "$f" &&
  grep -q "архивите извън машината" "$f"'
check "the user guide describes every step of the pilot path" bash -c '
  f=docs/guides/user-guide.bg.md
  grep -q "^## Пилотният път стъпка по стъпка (M13)" "$f" && grep -q "Start here" "$f" &&
  for s in "Create an account" "Confirm my address" "Save my profile" "Find your teacher" "Send the request" "Approve" "Ctrl+Enter" "Within 50 km" "Mark training as ended" "Lineage"; do
    grep -q "$s" "$f" || { echo "missing $s"; exit 1; }
  done'
check "the admin guide describes verify.sh M13, the pilot run, the matrix, perf:api and perf:web" bash -c '
  f=docs/guides/admin-guide.bg.md
  grep -q "^## 19. Приемане на пилота (M13)" "$f" && grep -q "PW_PILOT=1" "$f" && grep -q "authz-matrix.int.test.ts" "$f" &&
  grep -q "pnpm perf:api" "$f" && grep -q "pnpm perf:web" "$f" && grep -q "scripts/verify.sh M13" "$f"'
check "docs/plan/README.md has a status for M13" bash -c '! grep -qE "^\| M13 .*\| не е започнат \|$" docs/plan/README.md'
check "the M13 Progress log has entries" bash -c 'sed -n "/^## Дневник на напредъка/,\$p" docs/plan/M13-pilot-acceptance.md | grep -qE "^- 2026-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2} — "'
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  for g in docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md; do
    check "$g changed in this branch (differs from the merge base with origin/main)" bash -c "! git diff --quiet $base -- $g"
  done
else
  ok "the guides changed in this branch: not checkable here (merged, or no origin/main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M13 checks: $failures failed"
  exit 1
fi
echo "M13 checks: all passed"
