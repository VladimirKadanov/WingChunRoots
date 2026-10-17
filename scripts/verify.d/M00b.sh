#!/usr/bin/env bash
# Milestone M00b checks (docs/plan/M00b-design-system.md, "Done when"), run by scripts/verify.sh
# after lint, the unit tests (contrast, token build, fonts, theme), `pnpm build` and E2E
# (`@smoke|@M00b`: axe on every route in both themes, themes, safe areas, touch targets, fonts,
# licences). They stay valid after M00b, so `scripts/verify.sh all` keeps running them (CI, M13).
#
# Here: required files, the generated tokens and notices are current, self-hosted fonts only,
# the JavaScript budget per route, Lighthouse CI (mobile profile) for /, the committed visual
# baselines and screenshots, and the documentation.
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
# check_verbose "<description>" <command...>: like check, and shows the command's output on failure.
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

# grep_code <pattern> <file...>: grep -nE that ignores // and /* */ comment lines, so a comment
# that states a rule does not break it. Prints file:line:text; exit 1 when nothing matches.
grep_code() {
  local pattern="$1"
  shift
  local f found=1
  for f in "$@"; do
    if sed -E -e 's#(^|[[:space:]])//.*$##' -e 's#^[[:space:]]*/?\*.*$##' "$f" | grep -nE "$pattern" | sed "s|^|$f:|"; then
      found=0
    fi
  done
  return "$found"
}
mapfile -t SRC_FILES < <(find src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.mjs' \) | sort)

KEY_SCREENS=(home styleguide)
SIZES=(390x844 1440x900)
THEMES=(dark light)

# 1. Required files (Done when, item 2) ---------------------------------------------------------
required=(
  src/app/globals.css src/design/tokens.ts src/design/generated/tokens.css
  src/design/generated/tokens.json src/design/contrast.test.ts src/design/tokens.build.test.ts
  components.json scripts/check-bundle-budget.mjs e2e/routes.ts e2e/a11y.spec.ts
  e2e/visual.spec.ts e2e/screenshots.spec.ts THIRD_PARTY_NOTICES.md
  docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md docs/adr/0006-design-system.md
  docs/design/direction.md scripts/verify.d/M00b.sh lighthouserc.json
  src/app/legal/licenses/page.tsx src/app/legal/licenses/notices.json
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done
for d in src/components/ui src/app/styleguide licenses/addenda docs/screenshots/M00b docs/design/prototypes; do
  check "directory exists and is not empty: $d/" bash -c "[ -d '$d' ] && [ -n \"\$(ls -A '$d')\" ]"
done
for c in button input dialog drawer menu tabs toast skeleton status-badge; do
  check "component exists: src/components/ui/$c.tsx" test -s "src/components/ui/$c.tsx"
done

# 2. Tokens, notices and components (In scope 2, 5, 8) ------------------------------------------
check_verbose "generated tokens are current (pnpm tokens:build --check)" pnpm --silent tokens:build --check
check_verbose "THIRD_PARTY_NOTICES.md and the licences page data are current (pnpm notices --check)" pnpm --silent notices --check
check "every licence addendum is listed on the licences page" node -e "
  const fs = require('fs');
  const files = fs.readdirSync('licenses/addenda').filter((f) => f.endsWith('.md'));
  const listed = require('./src/app/legal/licenses/notices.json').addenda.map((a) => a.file);
  process.exit(files.length > 0 && files.every((f) => listed.includes('licenses/addenda/' + f)) ? 0 : 1)"
check "components.json: shadcn/ui on Base UI (base style), RSC, aliases to src/components/ui and src/lib/utils" node -e "
  const c = require('./components.json');
  process.exit(c.style.startsWith('base-') && c.rsc === true && c.aliases.ui === '@/components/ui' && c.aliases.utils === '@/lib/utils' && c.tailwind.css === 'src/app/globals.css' ? 0 : 1)"
check "Base UI, Tailwind 4.3.3, the font packages and @lhci/cli are pinned exactly" node -e "
  const p = require('./package.json');
  const d = { ...p.dependencies, ...p.devDependencies };
  const names = ['@base-ui/react', 'tailwindcss', '@tailwindcss/postcss', '@fontsource/gloock', '@fontsource-variable/schibsted-grotesk', '@fontsource/noto-serif-display', '@lhci/cli', 'clsx', 'tailwind-merge', 'class-variance-authority'];
  process.exit(d.tailwindcss === '4.3.3' && names.every((n) => /^\d+\.\d+\.\d+$/.test(d[n] || '')) ? 0 : 1)"
refute "no Radix UI packages or asChild in src/ (Base UI uses render)" grep_code "@radix-ui/|asChild" "${SRC_FILES[@]}"
check "CLAUDE.md keeps the rule: render, not asChild" grep -q "asChild" CLAUDE.md
check "package.json has tokens:build, notices and screenshots" node -e "
  const s = require('./package.json').scripts;
  process.exit(/build-tokens/.test(s['tokens:build'] || '') && /generate-notices/.test(s.notices || '') && /--project screenshots/.test(s.screenshots || '') ? 0 : 1)"

# 3. Fonts: self-hosted only (In scope 4, Constraints) ------------------------------------------
refute "no next/font/google anywhere in src/" grep_code "next/font/google" "${SRC_FILES[@]}"
font_host_dirs=(src)
[ -d public ] && font_host_dirs+=(public)
[ -d .next ] && font_host_dirs+=(.next)
refute "no fonts.googleapis.com or fonts.gstatic.com in ${font_host_dirs[*]}" \
  grep -rIln --exclude-dir=cache -e "fonts.googleapis.com" -e "fonts.gstatic.com" "${font_host_dirs[@]}"
check "the fonts load through next/font/local from @fontsource packages (latin and latin-ext)" bash -c '
  f=src/design/fonts.ts
  grep -q "next/font/local" "$f" && grep -q "@fontsource" "$f" && grep -q "latin-ext" "$f"'

# 4. Theme and shell (In scope 3, 6) -------------------------------------------------------------
check "the root layout sets viewport-fit=cover, both color schemes, theme-color and the theme script" bash -c '
  f=src/app/layout.tsx
  grep -q "viewportFit: '"'"'cover'"'"'" "$f" && grep -q "colorScheme" "$f" && grep -q "theme-color" "$f" && grep -q "THEME_SCRIPT" "$f"'
refute "no 100vh in src/ (dvh or svh)" grep_code "100vh|h-screen|min-h-screen" "${SRC_FILES[@]}"
if [ -f .next/server/app/styleguide.html ]; then
  check "/styleguide is noindex in the built HTML" grep -q 'name="robots" content="noindex' .next/server/app/styleguide.html
else
  bad "/styleguide is noindex in the built HTML (.next/server/app/styleguide.html is missing: pnpm build)"
fi

# 5. Tests named by Done when (item 3) and the route list -----------------------------------------
smoke_titles=(
  "@M00b home page renders in both themes with no axe violations"
  "@M00b the theme follows prefers-color-scheme, the manual choice persists across reloads and the server renders it without a flash"
  "@M00b at 390x844 the app shell respects safe-area insets and has no horizontal scroll"
  "@M00b every interactive element on / and /styleguide is at least 44x44 px on mobile"
  "@M00b fonts are self-hosted (no requests to fonts.googleapis.com or fonts.gstatic.com)"
  "@M00b /legal/licenses lists the third-party licenses"
)
for title in "${smoke_titles[@]}"; do
  check "e2e/smoke.spec.ts › $title" grep -qF "'$title'" e2e/smoke.spec.ts
done
for path in "'/'" "'/styleguide'" "'/legal/licenses'"; do
  check "e2e/routes.ts lists $path" grep -qF "path: $path" e2e/routes.ts
done

# 6. Visual regression baselines and screenshots (In scope 7, 10) --------------------------------
for screen in "${KEY_SCREENS[@]}"; do
  for size in "${SIZES[@]}"; do
    for theme in "${THEMES[@]}"; do
      check "visual baseline: e2e/__screenshots__/visual.spec.ts/$screen-$size-$theme-linux.png" \
        test -s "e2e/__screenshots__/visual.spec.ts/$screen-$size-$theme-linux.png"
      check "screenshot: docs/screenshots/M00b/$screen-$size-$theme.png" test -s "docs/screenshots/M00b/$screen-$size-$theme.png"
    done
  done
done
check "CI runs the visual project (CI=true) and prints failed screenshots for review" bash -c '
  grep -q "visual: ci" playwright.config.ts && grep -q "scripts/visual-baselines.sh print" .github/workflows/ci.yml'

# 7. Budgets (In scope 7): JavaScript per route and Lighthouse CI for / ---------------------------
if [ -f .next/build-manifest.json ]; then
  check_verbose "initial JavaScript per route within budget (scripts/check-bundle-budget.mjs)" node scripts/check-bundle-budget.mjs
else
  bad "initial JavaScript per route: no build output (pnpm build)"
fi

check "lighthouserc.json asserts LCP < 2.5 s and CLS < 0.1 in the mobile profile" node -e "
  const c = require('./lighthouserc.json').ci;
  const a = c.assert.assertions;
  const s = c.collect.settings || {};
  process.exit(a['largest-contentful-paint'][1].maxNumericValue === 2500 && a['cumulative-layout-shift'][1].maxNumericValue === 0.1
    && !s.preset && (s.formFactor || 'mobile') === 'mobile' && c.upload.target === 'filesystem' ? 0 : 1)"

# Lighthouse CI against `next start` on its own port. Chromium: PW_CHROMIUM_EXECUTABLE (cloud
# sessions) or the one the pinned Playwright installed (CI, local).
lighthouse() {
  local port="${LHCI_PORT:-3102}" chrome="${PW_CHROMIUM_EXECUTABLE:-}"
  if [ -z "$chrome" ]; then
    chrome="$(node -e "process.stdout.write(require('@playwright/test').chromium.executablePath())" 2>/dev/null)"
  fi
  if [ ! -x "$chrome" ]; then
    echo "no Chromium for Lighthouse at '$chrome' (set PW_CHROMIUM_EXECUTABLE or run pnpm exec playwright install chromium)"
    return 1
  fi
  if [ ! -f .next/BUILD_ID ]; then
    echo "no build output: pnpm build"
    return 1
  fi
  mkdir -p .verify
  rm -rf .lighthouseci
  local log=.verify/M00b-lighthouse-server.log starter=()
  command -v setsid >/dev/null 2>&1 && starter=(setsid)
  "${starter[@]}" node_modules/.bin/next start --hostname 127.0.0.1 --port "$port" > "$log" 2>&1 &
  local pid=$! i ready=0
  for i in $(seq 1 120); do
    if node -e "fetch('http://127.0.0.1:$port/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" 2>/dev/null; then
      ready=1
      break
    fi
    sleep 0.5
  done
  local rc=1
  if [ "$ready" -eq 1 ]; then
    pnpm exec lhci collect --config=lighthouserc.json --url="http://127.0.0.1:$port/" --chromePath="$chrome" \
      && pnpm exec lhci upload --config=lighthouserc.json >/dev/null \
      && node -e "
        const fs = require('fs');
        const runs = fs.readdirSync('.lighthouseci').filter((f) => /^lhr-.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync('.lighthouseci/' + f, 'utf8')));
        const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
        const lcp = median(runs.map((r) => r.audits['largest-contentful-paint'].numericValue));
        const cls = median(runs.map((r) => r.audits['cumulative-layout-shift'].numericValue));
        const s = runs[0].configSettings;
        console.log('Lighthouse ' + runs[0].lighthouseVersion + ', ' + s.formFactor + ', ' + s.throttlingMethod + ' throttling, ' + runs.length + ' runs: median LCP ' + Math.round(lcp) + ' ms, median CLS ' + cls.toFixed(3));" \
      && pnpm exec lhci assert --config=lighthouserc.json
    rc=$?
  else
    echo "next start did not answer on port $port; see $log"
  fi
  if [ "${#starter[@]}" -gt 0 ]; then kill -- "-$pid" 2>/dev/null; else kill "$pid" 2>/dev/null; fi
  wait "$pid" 2>/dev/null
  return "$rc"
}
check_verbose "Lighthouse CI for / in the mobile profile: LCP < 2.5 s, CLS < 0.1 (lighthouserc.json)" lighthouse
[ -d .lighthouseci ] && ls .lighthouseci/lhr-*.json >/dev/null 2>&1 && node -e "
  const fs = require('fs');
  const runs = fs.readdirSync('.lighthouseci').filter((f) => /^lhr-.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync('.lighthouseci/' + f, 'utf8')));
  const lcp = runs.map((r) => Math.round(r.audits['largest-contentful-paint'].numericValue)).join(', ');
  const cls = runs.map((r) => r.audits['cumulative-layout-shift'].numericValue.toFixed(3)).join(', ');
  console.log('     LCP per run (ms): ' + lcp + '; CLS per run: ' + cls);" 2>/dev/null

# 8. Documentation (In scope 1, 9; docs/plan/RULES.md) ------------------------------------------
check "docs/design/direction.md records the direction and its status" bash -c '
  grep -q "Ink Register" docs/design/direction.md && grep -q "Status:" docs/design/direction.md'
check "docs/adr/0006-design-system.md has a status, a decision and the deviations" bash -c '
  f=docs/adr/0006-design-system.md
  grep -q "Статус" "$f" && grep -q "Решение" "$f" && grep -q "Отклонения" "$f"'
check "README.md links both guides" bash -c '
  grep -q "docs/guides/user-guide.bg.md" README.md && grep -q "docs/guides/admin-guide.bg.md" README.md'
check "the user guide covers the site, the themes and the home page" bash -c '
  f=docs/guides/user-guide.bg.md
  grep -qi "тем" "$f" && grep -qi "начална" "$f" && grep -q "WingChunRoots" "$f"'
check "the admin guide covers running locally on Windows (Docker Desktop, WSL2), stopping and updating" bash -c '
  f=docs/guides/admin-guide.bg.md
  grep -q "Docker Desktop" "$f" && grep -q "WSL2" "$f" && grep -qi "спиране" "$f" && grep -qi "обновяване" "$f"'
# docs/plan/RULES.md: the guides change in the milestone's branch. Checkable while the branch is
# not merged and origin/main is known (not in a shallow CI checkout).
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  check "the guides changed in this branch (docs/guides/ differs from the merge base with origin/main)" \
    bash -c "! git diff --quiet $base -- docs/guides/"
else
  ok "the guides changed in this branch: not checkable here (merged, or no origin/main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M00b checks: $failures failed"
  exit 1
fi
echo "M00b checks: all passed"
