#!/usr/bin/env bash
# Milestone M05 checks (docs/plan/M05-explorer-views.md, "Done when"), run by scripts/verify.sh after
# the unit tests (generation.test.ts: the generation label of plan §4.4; state.test.ts: the URL
# state, the three views and the large fan-out rule), the build (with the bundle budget) and E2E
# (`@smoke|@M05`: e2e/m05-explorer.spec.ts). They stay valid after M05, so `scripts/verify.sh all`
# keeps running them (CI, M13).
#
# Here: required files, the pinned graph library and the other new packages, ELK only in the
# worker of the explorer (in the source and in the built chunks), the client island and its URL
# state, the edges of plan §4.6 in the code, the legend, the attribution, the routes and the visual
# regression, the screenshots and the design review, the JavaScript budget of /explore in the build
# script, in an ADR and measured on the build, the E2E titles and the documentation (the user guide
# changed in this branch).
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
VIEWS=(person generations lineage)

# 1. Required files (Done when 3) ----------------------------------------------------------------------
required=(
  src/app/explore/page.tsx
  src/components/lineage/useLayoutWorker.ts src/components/lineage/generation.ts src/components/lineage/generation.test.ts
  src/components/lineage/explorer/explorer.tsx src/components/lineage/explorer/canvas.tsx
  src/components/lineage/explorer/state.ts src/components/lineage/explorer/state.test.ts
  src/lib/rpc-client/index.ts src/server/services/explore-start.ts src/server/dto/explore.ts
  e2e/m05-explorer.spec.ts e2e/helpers/explorer.ts
  docs/design/reviews/M05.md docs/adr/0009-explorer.md scripts/verify.d/M05.sh
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done
check "directory exists and is not empty: src/components/lineage/" bash -c '[ -n "$(ls -A src/components/lineage)" ]'
check "directory exists and is not empty: docs/screenshots/M05/" bash -c '[ -d docs/screenshots/M05 ] && [ -n "$(ls -A docs/screenshots/M05)" ]'

# 2. The libraries (In scope 1; Constraints: the graph library is not changed) ------------------------
check "@xyflow/react is pinned at 12.12.0, TanStack Query 5.104.3, nuqs 2.10.2, oRPC client 1.15.7 (plan §3.1)" node -e "
  const d = require('./package.json').dependencies || {};
  process.exit(d['@xyflow/react'] === '12.12.0' && d['@tanstack/react-query'] === '5.104.3' && d.nuqs === '2.10.2' &&
    d['@orpc/client'] === '1.15.7' && d['@orpc/tanstack-query'] === '1.15.7' ? 0 : 1)"
refute "no other graph renderer (Cytoscape, Sigma, dagre) is a dependency" \
  node -e "const p = require('./package.json'); const all = { ...p.dependencies, ...p.devDependencies };
    const found = Object.keys(all).filter((n) => /^(cytoscape|sigma|@react-sigma|dagre|@dagrejs|d3-dag)/.test(n));
    if (found.length) { console.log(found.join(' ')); process.exit(0); } process.exit(1)"
check "the new packages are in the third-party notices" bash -c '
  for p in "@xyflow/react" "@tanstack/react-query" "nuqs" "@orpc/client" "@orpc/tanstack-query"; do grep -q "$p" THIRD_PARTY_NOTICES.md || exit 1; done'

# 3. ELK only in the explorer's worker (In scope 1; plan §4.1) -----------------------------------------
check "useLayoutWorker creates the M03 worker exactly as plan §4.1 says and warms it up" bash -c '
  f=src/components/lineage/useLayoutWorker.ts
  grep -qF "new Worker(new URL('\''../../lib/lineage-layout/layout.worker.ts'\'', import.meta.url), { type: '\''module'\'' })" "$f" &&
  grep -q "WARMUP_GRAPH" "$f"'
refute "nothing else creates a worker or imports elkjs in src/app or src/components" \
  bash -c 'grep -rnE "new Worker\(|from .elkjs" src/app src/components | grep -v "^src/components/lineage/useLayoutWorker.ts:"'
# ESLint's no-restricted-imports does not see import() expressions.
refute "no import() of elkjs or of the layout modules that load it (layout, layout.worker, worker-handler) in src/app or src/components" \
  grep -rnE "import\(\s*['\"\`](elkjs|[^'\"\`]*lineage-layout/(layout|layout\.worker|worker-handler)(\.ts)?['\"\`])" src/app src/components
# The build (M05 review, graph-14): the chunk with ELK is named only by the layout worker's chunk list, never
# by a page or by a chunk a page loads (a lazy import() or next/dynamic included); and the
# JavaScript budget of every route, /explore's own included (In scope 11). After the build step of
# scripts/verify.sh.
if [ -f .next/build-manifest.json ]; then
  check_verbose "in the build, ELK loads only in the layout worker, and every route is within its JavaScript budget (scripts/check-bundle-budget.mjs)" \
    node scripts/check-bundle-budget.mjs
else
  bad "the build: no build output (.next/build-manifest.json); run pnpm build:e2e first"
fi
# One import() of the canvas for next/dynamic and for the early request when the explorer mounts.
check "React Flow loads with next/dynamic (ssr: false), only in the explorer" bash -c '
  f=src/components/lineage/explorer/explorer.tsx
  grep -q "const loadCanvas = () => import('\''./canvas'\'');" "$f" && grep -q "dynamic(() => loadCanvas(), { ssr: false" "$f" &&
  [ "$(grep -rlE "from .@xyflow/react" src | sort | tr "\n" " ")" = "src/components/lineage/explorer/canvas.tsx " ]'

# 4. The client island (In scope 1–9) -------------------------------------------------------------------
check "the URL state is focus, up, down, lineage, show and view (nuqs)" bash -c '
  f=src/components/lineage/explorer/explorer.tsx
  grep -q "useQueryStates(parsers)" "$f" && for k in focus up down lineage show view; do grep -qE "^  $k: " "$f" || exit 1; done'
check "the data come from TanStack Query with the oRPC client" bash -c '
  f=src/components/lineage/explorer/explorer.tsx
  grep -q "useQuery(" "$f" && grep -q "orpc.lineage.ego.queryOptions(" "$f" && grep -q "orpc.lineage.subtree.queryOptions(" "$f" &&
  grep -q "createORPCClient" src/lib/rpc-client/index.ts && grep -q "createTanstackQueryUtils(rpcClient)" src/lib/rpc-client/index.ts'
check "three views: person, generations, lineage (plan §4.3)" bash -c '
  grep -q "export type ViewKind = '\''person'\'' | '\''generations'\'' | '\''lineage'\''" src/components/lineage/explorer/state.ts'
check "fixed node sizes per level of detail, switched by zoom, and onlyRenderVisibleElements (plan §4.5, §4.8)" bash -c '
  f=src/components/lineage/explorer/canvas.tsx
  grep -q "onlyRenderVisibleElements" "$f" && grep -q "export const DETAIL_ZOOM = { full: 0.75, compact: 0.4 } as const;" "$f" &&
  grep -q "s.transform\[2\] >= DETAIL_ZOOM.full" "$f" && grep -q "s.transform\[2\] >= DETAIL_ZOOM.compact" "$f" && grep -q "data.boxes\[lod\]" "$f"'
check "nodes show the name with lang, the generation label, the status in words with its seal, and the \"2 teachers\" chip" bash -c '
  f=src/components/lineage/explorer/canvas.tsx
  grep -q "lang=\"und-Latn\" translate=\"no\"" "$f" && grep -q "data.generation" "$f" && grep -q "data.status.label" "$f" && grep -q "{data.teachers} teachers" "$f"'
check "edges follow plan §4.6: orthogonal ELK routes, the cross-lineage Bézier curve labelled \"Teacher in {lineage}\", historical hidden by default, a double stroke for arbitration" bash -c '
  grep -q "path.type === '\''bezier'\''" src/components/lineage/explorer/canvas.tsx &&
  grep -q "<StrokePaths" src/components/lineage/explorer/canvas.tsx && grep -q "style.stroke === '\''double'\''" src/components/ink/link-stroke.tsx &&
  grep -q "Teacher in \${lineageName}" src/components/lineage/explorer/explorer.tsx &&
  grep -q "const byDefault = (e: LineageEdgeDto) => showHistorical || !isHistoricalRelation(e.periods);" src/components/lineage/explorer/explorer.tsx &&
  grep -q "hidden: !byDefault(edge)" src/components/lineage/explorer/explorer.tsx'
refute "no edge or node is faded with opacity (plan §4.7: solid tones only)" grep -nE "opacity-[0-9]|opacity: 0\.|opacity=\"0\." src/components/lineage/explorer/canvas.tsx src/components/ink/link-stroke.tsx
check "the legend is the shared one (icon, stroke sample, text) inside the explorer frame" bash -c '
  grep -q "<Legend kinds={drawnKinds" src/components/lineage/explorer/explorer.tsx && grep -q "LinkStroke" src/components/ink/legend.tsx && grep -q "<Seal" src/components/ink/legend.tsx'
check "Graph / List: <Activity> keeps the graph while the M04 list view is shown" bash -c '
  grep -q "<Activity mode={params.view === '\''graph'\''" src/components/lineage/explorer/explorer.tsx && grep -q "LineageListPage" src/app/explore/page.tsx'
check "a selected node opens a panel with \"Open profile\"" grep -q "Open profile" src/components/lineage/explorer/explorer.tsx
check "a shape-matched skeleton while the layout runs (plan §5.6)" bash -c '
  grep -q "data-testid=\"explorer-skeleton\"" src/components/lineage/explorer/explorer.tsx && grep -q "computeRanks" src/components/lineage/explorer/explorer.tsx'
refute "the React Flow attribution stays (DEFAULT, plan §10.2 row 9)" grep -rnE "hideAttribution" src
check "the generation label follows plan §4.4 (D22)" bash -c '
  grep -q "Generation \${label.generation} from \${label.rootName}" src/components/lineage/generation.ts &&
  grep -q "below \${label.anchorName} in this view" src/components/lineage/generation.ts'
check "the layout animates with the motion tokens and not under reduced motion; the frame uses dvh and the safe areas" bash -c '
  grep -q "explorer-canvas .react-flow__node" src/app/globals.css && grep -q "var(--duration-slow)" src/app/globals.css &&
  grep -q "100dvh" src/app/explore/page.tsx && grep -q "safe-area-inset" src/components/lineage/explorer/explorer.tsx'
refute "no 100vh in the explorer" grep -rn "100vh" src/app/explore src/components/lineage/explorer
check "the person pages link the graph to /explore?focus=<id>" grep -qF 'href: `/explore?focus=${profile.id}`' src/components/lineage/person-header.tsx

# 5. Routes, visual regression, screenshots and the design review (In scope 10) ------------------------
check "e2e/routes.ts lists /explore (axe in both themes, visual regression, screenshots)" grep -qE "path: '/explore', name: 'explore-start'.*milestone: 'M05', key: true" e2e/routes.ts
check "the three views are in the visual regression (@visual) and the screenshots" bash -c '
  grep -q "explore-\${view.name}-\${size.name}-\${theme}.png" e2e/visual.spec.ts && grep -q "name: \`explore-\${view.name}\`" e2e/screenshots.spec.ts'
for view in "${VIEWS[@]}"; do
  for size in "${SIZES[@]}"; do
    for theme in "${THEMES[@]}"; do
      check "screenshot: docs/screenshots/M05/explore-$view-$size-$theme.png" test -s "docs/screenshots/M05/explore-$view-$size-$theme.png"
    done
  done
done
check "the design review covers the three views at both sizes in both themes against direction.md" bash -c '
  f=docs/design/reviews/M05.md
  for w in 390x844 1440x900 dark light person generations lineage direction.md; do grep -q "$w" "$f" || exit 1; done'

# 6. Budgets (In scope 11) ------------------------------------------------------------------------------
check "/explore has its own JavaScript budget in scripts/check-bundle-budget.mjs, recorded in ADR 0009 (ELK is not in it)" bash -c '
  grep -qE "'\''/explore'\'': [0-9]+ \* KB" scripts/check-bundle-budget.mjs && grep -q "/explore" docs/adr/0009-explorer.md &&
  grep -qi "elk" docs/adr/0009-explorer.md && grep -q "INP" docs/adr/0009-explorer.md'

# 7. E2E titles (Done when 2) ----------------------------------------------------------------------------
titles=(
  '@M05 ego view of demo-two-lineages shows two incoming teacher edges'
  '@M05 cross-lineage teacher edge is curved, long-dashed and labelled with the lineage'
  '@M05 demo-converging shows two same-lineage incoming edges, routed orthogonally, with the student placed horizontally between both teachers and a "2 teachers" chip'
  '@M05 historical relationships are hidden by default and shown with show=historical'
  '@M05 all nodes of one generation share the same y position'
  '@M05 the label reads "Generation N from {root}" only when the view root is the lineage root and every edge on the path is verified, and "N generations below {name} in this view" otherwise'
  '@M05 reload keeps focus, depth and view from the URL'
  '@M05 profile page does not request the ELK worker; the explorer page does'
  '@M05 the explorer shows a shape-matched loading skeleton while the layout runs'
  '@M05 legend shows an icon, a stroke sample and text for every status in view'
  '@M05 Graph/List toggle switches views and back without losing the focus person'
  '@M05 at 390x844 the explorer fills the dynamic viewport height and keeps its controls inside the safe areas'
  '@M05 selecting a node responds with INP under 200 ms at 4x CPU throttling'
  '@M05 no axe violations on /explore in dark and light themes'
)
for t in "${titles[@]}"; do
  check "E2E test: $t" grep -qF -- "$t" e2e/m05-explorer.spec.ts
done
refute "no skipped or focused M05 test" grep -nE "\b(test|it|describe)\.(skip|only|fixme|todo)\(" e2e/m05-explorer.spec.ts src/components/lineage/generation.test.ts src/components/lineage/explorer/state.test.ts

# 8. Documentation (In scope 12; docs/plan/RULES.md) -------------------------------------------------------
check "the user guide describes the explorer, its three views, the legend and Graph / List" bash -c '
  f=docs/guides/user-guide.bg.md
  grep -q "/explore" "$f" && grep -q "Generations" "$f" && grep -q "Lineage" "$f" && grep -qi "легенда" "$f" && grep -q "Graph" "$f" && grep -q "List" "$f"'
check "docs/plan/README.md has a status for M05" bash -c '! grep -qE "^\| M05 .*\| не е започнат \|$" docs/plan/README.md'
# Against origin/main, or the local main of a checkout that is not fetched (the owner pushes).
main_ref=""
for ref in origin/main main; do
  if git rev-parse --verify -q "$ref" >/dev/null 2>&1; then main_ref="$ref"; break; fi
done
if [ -n "$main_ref" ] && base="$(git merge-base HEAD "$main_ref" 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD "$main_ref" 2>/dev/null; then
  check "docs/guides/user-guide.bg.md changed in this branch (differs from the merge base with $main_ref)" \
    bash -c "! git diff --quiet $base -- docs/guides/user-guide.bg.md"
else
  ok "the user guide changed in this branch: not checkable here (merged into main, or no main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M05 checks: $failures failed"
  exit 1
fi
echo "M05 checks: all passed"
