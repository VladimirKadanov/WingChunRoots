#!/usr/bin/env bash
# Milestone M00 checks (docs/plan/M00-foundation.md, "Done when"), run by scripts/verify.sh.
# They stay valid after M00, so `scripts/verify.sh all` keeps running them (CI, M13).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

PLAN="docs/WingChunRoots_Technical_Plan.bg.md"
ADR="docs/adr/0001-stack.md"
MILESTONES=(M00 M00b M01 M01b M02 M03 M04 M05 M06 M07 M08 M09 M10a M10b M11 M12 M13)
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

# 1. Required files (Done when, item 2) ------------------------------------------------
required=(
  CLAUDE.md AGENTS.md README.md .env.example .nvmrc .gitattributes .gitignore
  package.json pnpm-lock.yaml pnpm-workspace.yaml next.config.ts tsconfig.json
  eslint.config.mjs vitest.config.mts playwright.config.ts e2e/smoke.spec.ts
  docker-compose.yml .claude/settings.json .claude/hooks/session-start.sh
  .github/workflows/ci.yml renovate.json
  scripts/verify.sh scripts/verify.d/M00.sh scripts/cloud-setup.sh scripts/db-env-check.sh
  scripts/init-env.sh scripts/pw-chromium.sh
  "$ADR" docs/plan/README.md docs/plan/RULES.md docs/plan/deferred-hosting.md
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done
check "directory exists: docs/plan/questions/" test -d docs/plan/questions
for f in scripts/verify.sh scripts/verify.d/M00.sh scripts/cloud-setup.sh scripts/db-env-check.sh \
  scripts/init-env.sh scripts/pw-chromium.sh .claude/hooks/session-start.sh; do
  check "executable: $f" test -x "$f"
done

# 2. Seventeen milestone files that follow the template of plan §8.3 --------------------
template=(
  "## Цел (Objective)"
  "## Прочети първо (Read first)"
  "## Зависимости (Dependencies)"
  "## Обхват (In scope)"
  "## Извън обхват (Out of scope)"
  "## Ограничения (Constraints)"
  "## Критерии за готовност (Done when)"
  "## Кога да спре и да попита (Stop and ask)"
  "## Ред за /goal"
  "## Дневник на напредъка (Progress log)"
)
expected_headings="$(printf '%s\n' "${template[@]}")"
for m in "${MILESTONES[@]}"; do
  files=(docs/plan/"$m"-*.md)
  if [ "${#files[@]}" -ne 1 ] || [ ! -f "${files[0]}" ]; then
    bad "exactly one milestone file docs/plan/$m-*.md"
    continue
  fi
  f="${files[0]}"
  if head -n 1 "$f" | grep -q "^# $m — " && [ "$(grep '^## ' "$f")" = "$expected_headings" ]; then
    ok "milestone file follows the template: $f"
  else
    bad "milestone file follows the template (title '# $m — …' and the ten headings of plan §8.3): $f"
  fi
  check "docs/plan/README.md lists $m" grep -q "($(basename "$f"))" docs/plan/README.md
done
check "plan §8 keeps only the map: no milestone sections left in $PLAN" \
  bash -c "! grep -Eq '^(### M[0-9]{2}[ab]? — |#### Цел \(Objective\))' '$PLAN'"
check "plan §8.3 links every milestone file" \
  bash -c "for f in docs/plan/M*-*.md docs/plan/deferred-hosting.md; do grep -q \"(plan/\$(basename \"\$f\"))\" '$PLAN' || exit 1; done"

# 3. docs/plan/RULES.md is plan §8.2 verbatim -------------------------------------------
plan_rules="$(awk '/^### 8\.2 /{on=1; next} /^### 8\.3 /{on=0} on' "$PLAN" | sed -e '/./,$!d')"
rules_body="$(tail -n +2 docs/plan/RULES.md | sed -e '/./,$!d')"
if [ -n "$plan_rules" ] && [ "$plan_rules" = "$rules_body" ]; then
  ok "docs/plan/RULES.md matches plan §8.2"
else
  bad "docs/plan/RULES.md matches plan §8.2"
  diff <(printf '%s\n' "$plan_rules") <(printf '%s\n' "$rules_body") | head -n 20
fi

# 4. pnpm settings of plan §3.2 (an unsupported setting must be recorded in the ADR) -----
for setting in "minimumReleaseAge: 1440" "minimumReleaseAgeStrict: true" \
  "minimumReleaseAgeExcludePrune: true" "strictDepBuilds: true" "blockExoticSubdeps: true" \
  "trustPolicy: no-downgrade"; do
  key="${setting%%:*}"
  if grep -Eq "^${setting}\$" pnpm-workspace.yaml; then
    ok "pnpm-workspace.yaml: $setting"
  elif grep -q "$key" "$ADR"; then
    ok "pnpm-workspace.yaml: $key missing, reason recorded in $ADR"
  else
    bad "pnpm-workspace.yaml: $setting (or a recorded reason in $ADR)"
  fi
done
check "pnpm-workspace.yaml: allowBuilds map present" grep -q '^allowBuilds:' pnpm-workspace.yaml
# Every allowBuilds entry is an explicit true/false and is explained in the ADR.
allow_ok=1
while IFS= read -r entry; do
  pkg="${entry%%:*}"
  grep -q "\`$pkg\`" "$ADR" || allow_ok=0
done < <(awk '/^allowBuilds:/{on=1; next} /^[^ ]/{on=0} on && NF' pnpm-workspace.yaml | sed 's/^ *//')
if [ "$allow_ok" -eq 1 ] && ! awk '/^allowBuilds:/{on=1; next} /^[^ ]/{on=0} on && NF' pnpm-workspace.yaml | grep -Evq ':[[:space:]]*(true|false)[[:space:]]*$'; then
  ok "allowBuilds: explicit true/false for every package, each explained in $ADR"
else
  bad "allowBuilds: explicit true/false for every package, each explained in $ADR"
fi
check "packageManager pins an exact pnpm version" \
  node -e "process.exit(/^pnpm@\d+\.\d+\.\d+$/.test(require('./package.json').packageManager) ? 0 : 1)"
check "every dependency in package.json has an exact version" node -e "
  const p = require('./package.json');
  const all = { ...p.dependencies, ...p.devDependencies };
  const loose = Object.entries(all).filter(([, v]) => !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v));
  if (loose.length) { console.error(loose); process.exit(1); }"

# 5. Node versions -----------------------------------------------------------------------
check ".nvmrc points to Node 24" grep -Eq '^v?24(\.[0-9]+){0,2}[[:space:]]*$' .nvmrc
check "package.json engines.node is >=22.12" \
  node -e "process.exit(require('./package.json').engines.node === '>=22.12' ? 0 : 1)"

# 6. Images pinned by digest, actions pinned by commit SHA -------------------------------
images="$(grep -Eh '^[[:space:]]*image:' docker-compose.yml .github/workflows/*.yml | sed 's/^[[:space:]]*image:[[:space:]]*//')"
if [ -n "$images" ] && ! printf '%s\n' "$images" | grep -Evq '@sha256:[0-9a-f]{64}[[:space:]]*$'; then
  ok "every image in docker-compose.yml and the workflows is pinned by @sha256 digest"
else
  bad "every image in docker-compose.yml and the workflows is pinned by @sha256 digest"
  printf '%s\n' "$images" | grep -Ev '@sha256:[0-9a-f]{64}[[:space:]]*$'
fi
for img in "postgis/postgis:18-3.6@" "axllent/mailpit:v1.31" "chrislusf/seaweedfs:"; do
  check "docker-compose.yml uses $img" grep -q "$img" docker-compose.yml
done
# Any other image reference in a workflow (for example `docker run <image>`), wherever it appears.
refs="$(grep -hv '^[[:space:]]*#' .github/workflows/*.yml \
  | grep -Eo '[a-z0-9][a-z0-9.-]*/[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9][A-Za-z0-9._-]*(@sha256:[0-9a-f]{64})?' || true)"
if [ -n "$refs" ] && ! printf '%s\n' "$refs" | grep -Evq '@sha256:[0-9a-f]{64}$'; then
  ok "every image referenced in the workflows is pinned by @sha256 digest ($(printf '%s\n' "$refs" | wc -l | tr -d ' ') found)"
else
  bad "every image referenced in the workflows is pinned by @sha256 digest"
  printf '%s\n' "$refs" | grep -Ev '@sha256:[0-9a-f]{64}$'
fi
uses="$(grep -Eh '^[[:space:]-]*uses:' .github/workflows/*.yml | sed -E 's/^[[:space:]-]*uses:[[:space:]]*//; s/[[:space:]]*#.*$//')"
if [ -n "$uses" ] && ! printf '%s\n' "$uses" | grep -Evq '@[0-9a-f]{40}$'; then
  ok "every GitHub Action is pinned by commit SHA"
else
  bad "every GitHub Action is pinned by commit SHA"
fi

# 7. CI workflow contents (In scope, item 7) ----------------------------------------------
ci=.github/workflows/ci.yml
check "ci.yml has a job named 'ci'" grep -Eq '^  ci:$' "$ci"
check "ci.yml installs with --frozen-lockfile" grep -q 'pnpm install --frozen-lockfile' "$ci"
check "ci.yml runs scripts/verify.sh all" grep -q 'scripts/verify.sh all' "$ci"
check "ci.yml runs PostGIS 18 as a service container" grep -q 'postgis/postgis:18-3.6@sha256:' "$ci"
check "ci.yml installs Chromium and WebKit for Playwright" grep -Eq 'playwright install --with-deps chromium webkit' "$ci"
check "ci.yml runs gitleaks" grep -q 'gitleaks' "$ci"
check "ci.yml runs pnpm audit --prod --audit-level=high" grep -q 'pnpm audit --prod --audit-level=high' "$ci"
check "ci.yml has a light Node 22 job" grep -Eq 'node-version: "?22' "$ci"
check "ci.yml uploads the verify log" grep -q '\.verify/' "$ci"
check "renovate.json is valid JSON with minimumReleaseAge and digest pinning" node -e "
  const r = require('./renovate.json');
  const s = JSON.stringify(r);
  if (!/minimumReleaseAge/.test(s) || !/pinDigests|docker:pinDigests/.test(s) || !r.vulnerabilityAlerts) process.exit(1);"

# 8. Cloud session: SessionStart hook and setup script (In scope, item 5) ----------------
check ".claude/settings.json registers the SessionStart hook" node -e "
  const s = require('./.claude/settings.json');
  const cmds = (s.hooks?.SessionStart ?? []).flatMap((m) => m.hooks ?? []).map((h) => h.command);
  process.exit(cmds.some((c) => c.includes('.claude/hooks/session-start.sh')) ? 0 : 1);"
check "the hook runs only in cloud sessions and calls scripts/cloud-setup.sh" \
  bash -c "grep -q 'CLAUDE_CODE_REMOTE' .claude/hooks/session-start.sh && grep -q 'scripts/cloud-setup.sh' .claude/hooks/session-start.sh"
check "cloud-setup installs PostgreSQL 16 + PostGIS from the Ubuntu archive" \
  grep -q 'postgresql-16 postgresql-16-postgis-3 postgresql-contrib' scripts/cloud-setup.sh
check "cloud-setup creates the test database from template0 with UTF8 and C.UTF-8" \
  grep -q 'createdb .*-T template0 -E UTF8 --locale=C.UTF-8' scripts/cloud-setup.sh
check "cloud-setup installs pnpm from packageManager with npm (no Corepack)" \
  bash -c "grep -q 'packageManager' scripts/cloud-setup.sh && grep -q 'npm install --global' scripts/cloud-setup.sh && ! grep -q 'corepack enable' scripts/cloud-setup.sh"
check "no script runs 'playwright install' outside CI" \
  bash -c "! grep -hE '^[^#]*playwright install' scripts/*.sh .claude/hooks/*.sh"
check "cloud-setup exports TEST_DATABASE_URL" grep -q 'TEST_DATABASE_URL' scripts/cloud-setup.sh

# 9. Playwright, tests and telemetry -------------------------------------------------------
check "e2e/smoke.spec.ts has the @smoke home page test" \
  grep -q "'@smoke home page responds with 200 and has no axe violations'" e2e/smoke.spec.ts
check "mobile-webkit runs only in CI; Chromium can come from PW_CHROMIUM_EXECUTABLE" \
  bash -c "grep -q 'mobile-webkit' e2e/projects.ts && grep -q 'PW_CHROMIUM_EXECUTABLE' playwright.config.ts && grep -q \"process.env.CI === 'true'\" playwright.config.ts"
check "next.config.ts enables cacheComponents, partialPrefetching and reactCompiler" \
  bash -c "grep -q 'cacheComponents: true' next.config.ts && grep -q 'partialPrefetching: true' next.config.ts && grep -q 'reactCompiler: true' next.config.ts"
check "Next.js agent feedback is off" grep -q 'agentFeedback: false' next.config.ts
check "Next.js telemetry is off in dev, build and start" node -e "
  const s = require('./package.json').scripts;
  process.exit(['dev', 'build', 'start'].every((k) => s[k].includes('NEXT_TELEMETRY_DISABLED=1')) ? 0 : 1);"
check "no next/font/google import" bash -c "! grep -rq 'next/font/google' src"

# 10. Forbidden packages (plan §7.3, item 14) ----------------------------------------------
forbidden='"(vaul|cytoscape-svg|mapbox-gl|reactflow|next-intl|i18next|react-i18next|next-i18next|react-intl)"|"@antv/|"@cosmograph/|"@lingui/|"@inlang/paraglide'
check "package.json has no forbidden package" bash -c "! grep -Eq '$forbidden' package.json"
check "pnpm-lock.yaml has no forbidden package" \
  bash -c "! grep -Eq '^  .?(vaul|cytoscape-svg|mapbox-gl|reactflow|next-intl|i18next|react-i18next|next-i18next|react-intl)@|^  .?@(antv|cosmograph|lingui)/|^  .?@inlang/paraglide' pnpm-lock.yaml"

# 11. Repository conventions -----------------------------------------------------------------
check ".gitattributes forces LF line endings" grep -Eq '^\* text=auto eol=lf$' .gitattributes
check ".env.example lists names only (no values)" \
  bash -c "! grep -Ev '^(#.*|[A-Z][A-Z0-9_]*=|[[:space:]]*)$' .env.example"
check ".env is git-ignored" bash -c "git check-ignore -q .env"
check "CLAUDE.md imports AGENTS.md" grep -q '^@AGENTS.md' CLAUDE.md
for phrase in "English" "next-intl" "asChild" "DEFAULT Dxx" "scripts/verify.sh" "docs/plan/RULES.md" \
  "PostgreSQL 16" "src/server/services" "oRPC" "NEXT_TELEMETRY_DISABLED" "agentFeedback" "§5.8" "§3.3" "demo-"; do
  check "CLAUDE.md covers: $phrase" grep -q -- "$phrase" CLAUDE.md
done
check "README.md covers Windows with Docker Desktop and WSL2" bash -c "grep -q 'WSL2' README.md && grep -q 'Docker Desktop' README.md"
check "README.md covers the cloud session" grep -q 'cloud-setup.sh' README.md
check "$ADR records the allowBuilds map, pnpm settings and the telemetry default" \
  bash -c "grep -q 'allowBuilds' '$ADR' && grep -q 'minimumReleaseAgeStrict' '$ADR' && grep -q 'NEXT_TELEMETRY_DISABLED' '$ADR'"

if [ "$failures" -gt 0 ]; then
  echo "M00 checks: $failures failed"
  exit 1
fi
echo "M00 checks: all passed"
