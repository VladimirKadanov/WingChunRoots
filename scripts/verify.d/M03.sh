#!/usr/bin/env bash
# Milestone M03 checks (docs/plan/M03-lineage-layout.md, "Done when"), run by scripts/verify.sh
# after lint, typecheck, the unit tests (including layout.perf.test.ts and the ESLint
# boundary test), build and E2E. They stay valid after M03, so `scripts/verify.sh all` keeps
# running them (CI, M13).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

MOD="src/lib/lineage-layout"
ADR="docs/adr/0005-graph-layout.md"
BENCH="docs/perf/layout-bench.md"
ADDENDUM="licenses/addenda/elkjs.md"
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

# 1. Files of the milestone (In scope 1, 2, 6-8; Done when 4) ------------------------------
required=(
  "$MOD/types.ts" "$MOD/ranks.ts" "$MOD/elk-graph.ts" "$MOD/scene.ts" "$MOD/layout.ts"
  "$MOD/layout.worker.ts" "$MOD/presets.ts" "$MOD/testing/synthetic.ts"
  "$MOD/layout.perf.test.ts" "$MOD/boundary.test.ts" "$MOD/ranks.test.ts" "$MOD/layout.test.ts"
  "$MOD/elk-graph.test.ts" "$MOD/synthetic.test.ts" "$MOD/worker.test.ts"
  scripts/bench-layout.ts "$ADDENDUM" "$BENCH" "$ADR"
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done

# 2. elkjs 0.12.0, bundled entry only, worker entry point (In scope 2; plan §4.1, §4.14) ----
check "package.json pins elkjs 0.12.0 exactly as a runtime dependency" \
  node -e "process.exit(require('./package.json').dependencies.elkjs === '0.12.0' ? 0 : 1)"
check "pnpm-lock.yaml resolves elkjs@0.12.0" grep -q '^  elkjs@0.12.0:' pnpm-lock.yaml
check "layout.worker.ts starts with /// <reference lib=\"webworker\" />" \
  bash -c "head -n 1 '$MOD/layout.worker.ts' | grep -qx '/// <reference lib=\"webworker\" />'"
check "layout.worker.ts imports elkjs/lib/elk.bundled.js" \
  grep -q "^import ELK from 'elkjs/lib/elk.bundled.js';" "$MOD/layout.worker.ts"
check "layout.ts imports elkjs/lib/elk.bundled.js" \
  grep -q "^import ELK from 'elkjs/lib/elk.bundled.js';" "$MOD/layout.ts"
check "no module file loads elk-worker.min.js, elk-api.js or lib/main.js" \
  bash -c "! grep -rEn --exclude='*.test.ts' \"(from|import\\(|require\\()[[:space:]]*'elkjs(/lib/(elk-worker|elk-api|main)[^']*)?'\" '$MOD' scripts/bench-layout.ts"
check "only *.worker.ts in the module references worker globals (self, postMessage)" \
  bash -c "! grep -rEln '(^|[^.A-Za-z_])(self|postMessage)[[:space:]]*[.(]' '$MOD' --include='*.ts' | grep -v -e '\\.worker\\.ts\$' -e '\\.test\\.ts\$'"
check "no React, Next.js or src/server import in the module" \
  bash -c "! grep -rEn \"from '(react|react-dom|next|@xyflow/[^']*|@/server[^']*)(/[^']*)?'\" '$MOD' --include='*.ts' | grep -v '\\.test\\.ts:'"

# 3. ELK settings of plan §4.4-§4.5 -----------------------------------------------------------
check "presets: INTERACTIVE layering in the explorer set" \
  grep -q "'elk.layered.layering.strategy': 'INTERACTIVE'" "$MOD/presets.ts"
check "presets: pseudo y-coordinate rank × 200" grep -q '^export const RANK_PSEUDO_Y = 200;' "$MOD/presets.ts"
check "presets: semiInteractive in the expand set" \
  grep -q "'elk.layered.crossingMinimization.semiInteractive': 'true'" "$MOD/presets.ts"
check "presets: the chosen node placement is recorded" \
  grep -Eq "^export const CHOSEN_NODE_PLACEMENT: NodePlacement = '(NETWORK_SIMPLEX|BRANDES_KOEPF)';" "$MOD/presets.ts"
check "elk.layered.priority.direction is never set" \
  bash -c "! grep -rEn \"['\\\"](org\\.eclipse\\.)?elk\\.layered\\.priority\\.direction['\\\"]\" '$MOD' --include='*.ts'"
check "the focus spine sets elk.layered.priority.straightness" \
  grep -q "'elk.layered.priority.straightness'" "$MOD/elk-graph.ts"
check "edges to a teacher from another lineage are kept out of ELK" \
  grep -q "edge.kind === 'crossLineage' ? crossLineageEdges : elkEdges" "$MOD/elk-graph.ts"

# 4. The tests of "Done when" item 2 and 3 are present (they run in the test step) ----------
declare -A tests=(
  ["rank(student) > rank(teacher) for every edge"]="keeps rank(student) > rank(teacher) for every edge"
  ["same rank, same y; y follows the rank"]="ranksWithSeveralY(scene)).toEqual([])"
  ["every person is exactly one node"]="Every person is exactly one node"
  ["byte-for-byte determinism for each preset and placement"]="gives byte-for-byte identical output for the same input"
  ["deterministic synthetic generator"]="is deterministic: the same seed gives the same graph, byte for byte"
  ["cut-off teacher one row above its highest student"]="puts a cut-off teacher exactly one row above its highest student"
  ["view around demo-shared-ancestor"]="keeps the rank rule around demo-shared-ancestor"
  ["focus spine without bend points (chosen algorithm)"]="keeps the focus spine free of bend points in the ego view of"
  ["Bézier curves for edges to another lineage, not routed by ELK"]="draws edges to a teacher from another lineage as Bézier curves, not routed by ELK"
  ["cycle gives a typed error"]="rejects a cyclic input with LineageCycleError"
  ["lint boundary: react fails, layout.worker.ts passes"]="fails lint for a temporary file in the folder that imports react"
  ["semiInteractive keeps the order in the row"]="keeps the order of the existing people in each row"
)
for name in "${!tests[@]}"; do
  check "test present: $name" grep -rqF -- "${tests[$name]}" "$MOD" --include='*.test.ts'
done
check "boundary test also lints layout.worker.ts" grep -q "passes lint for layout.worker.ts" "$MOD/boundary.test.ts"
check "layout.perf.test.ts: ego view ≤ 1000 ms" grep -q '^const EGO_VIEW_BUDGET_MS = 1000;$' "$MOD/layout.perf.test.ts"
check "layout.perf.test.ts: 500-person view ≤ 2500 ms" grep -q '^const VIEW_500_BUDGET_MS = 2500;$' "$MOD/layout.perf.test.ts"
check "layout.perf.test.ts covers the ego view of every person" \
  grep -q 'for (const node of dataset.graph.nodes)' "$MOD/layout.perf.test.ts"

# 5. Default decisions are marked (docs/plan/RULES.md) ----------------------------------------
check "DEFAULT D22 marked in ranks.ts" grep -q 'DEFAULT D22' "$MOD/ranks.ts"
check "DEFAULT D05 marked in graph.ts" grep -q 'DEFAULT D05' "$MOD/graph.ts"
check "DEFAULT D20 marked in the synthetic generator" grep -q 'DEFAULT D20' "$MOD/testing/synthetic.ts"
check "DEFAULT D24 marked in the performance guard" grep -q 'DEFAULT D24' "$MOD/layout.perf.test.ts"
check "synthetic data is fictional: demo- slugs and 'Demo' names only" \
  bash -c "grep -q \"slug: p.slug ?? \\\`demo-person-\" '$MOD/testing/synthetic.ts' && ! grep -En \"displayName: '[^D]\" '$MOD/testing/synthetic.ts'"

# 6. pnpm bench:layout runs and writes the tables (In scope 6) -------------------------------
BENCH_OUT=".verify/layout-bench.md"
mkdir -p .verify
if pnpm --silent bench:layout --out "$BENCH_OUT" >/dev/null 2>.verify/layout-bench.err; then
  ok "pnpm bench:layout runs (output in $BENCH_OUT)"
else
  bad "pnpm bench:layout runs"
  tail -n 30 .verify/layout-bench.err
fi
bench_has_rows() { # bench_has_rows <file>
  local file="$1" view
  for view in ego:demo-root-a ego:demo-root-b ego:demo-shared-ancestor ego:demo-two-lineages \
    ego:demo-converging ego:demo-hub-a lineage:demo-root-a around:demo-shared-ancestor view-500; do
    # | `view` | people | edges | rows | cut-off | rows = ranks | cold | warm | bends | size |
    grep -Eq "^\| \`$view\` \| [0-9]+ \| [0-9]+ / [0-9]+ \| [0-9]+ \| [0-9]+ \| да \| [0-9]+ \| [0-9]+ \| 0 / [0-9]+ \| [0-9]+ × [0-9]+ \|$" "$file" || return 1
  done
  grep -Eq '^\| NETWORK_SIMPLEX \| 0 от 6 \| 0 от [0-9]+ \| 0 \|' "$file" || return 1
  grep -Eq '^\| BRANDES_KOEPF \| [0-9]+ от 6 \| [0-9]+ от [0-9]+ \| [0-9]+ \|' "$file" || return 1
  grep -Eq '^\| `expand` \(`semiInteractive`\) \| [0-9]+ \| [0-9]+ \| [0-9]+ \| [0-9]+ \|$' "$file" || return 1
  grep -q '<!-- generated by scripts/bench-layout.ts' "$file" || return 1
  grep -q 'elkjs 0.12.0' "$file" || return 1
}
check "fresh benchmark: every view, rows = ranks, a straight spine with the chosen algorithm" bench_has_rows "$BENCH_OUT"
check "$BENCH (committed) holds real measurements for every view and both algorithms" bench_has_rows "$BENCH"

# 7. ADR 0005 in Bulgarian (In scope 5, 7) ----------------------------------------------------
check "$ADR is in Bulgarian" grep -q 'Решение' "$ADR"
for phrase in NETWORK_SIMPLEX BRANDES_KOEPF semiInteractive INTERACTIVE d3-dag '§4.13' 'Резерви' 'hiddenCounts'; do
  check "$ADR covers: $phrase" grep -q -- "$phrase" "$ADR"
done
chosen="$(sed -n "s/^export const CHOSEN_NODE_PLACEMENT: NodePlacement = '\([A-Z_]*\)';/\1/p" "$MOD/presets.ts")"
check "$ADR records the chosen node placement ($chosen)" grep -q "Разполагане: \`$chosen\`" "$ADR"

# 8. EPL-2.0 addendum for elkjs (In scope 8; plan §4.14) ---------------------------------------
check "$ADDENDUM names elkjs 0.12.0 and links its source code" \
  bash -c "grep -q 'elkjs 0.12.0' '$ADDENDUM' && grep -q 'https://github.com/kieler/elkjs/tree/0.12.0' '$ADDENDUM' && grep -q 'https://registry.npmjs.org/elkjs/-/elkjs-0.12.0.tgz' '$ADDENDUM'"
check "$ADDENDUM ends with the full EPL-2.0 text shipped with elkjs" \
  bash -c "n=\$(wc -l < node_modules/elkjs/LICENSE.md); diff <(tail -n \"\$n\" '$ADDENDUM') node_modules/elkjs/LICENSE.md"
if [ -f THIRD_PARTY_NOTICES.md ]; then
  # The generator of M00b includes every file of licenses/addenda/ (whichever merges first).
  check "THIRD_PARTY_NOTICES.md includes the elkjs addendum" grep -q 'elkjs 0.12.0' THIRD_PARTY_NOTICES.md
fi

# 9. Milestone bookkeeping ---------------------------------------------------------------------
check "docs/plan/README.md: the M03 row is no longer 'не е започнат'" \
  bash -c "grep -E '^\| M03 \|' docs/plan/README.md | grep -vq 'не е започнат'"
check "the M03 Progress log has at least one entry" \
  bash -c "sed -n '/^## Дневник на напредъка/,\$p' docs/plan/M03-lineage-layout.md | grep -Eq '^- 20[0-9]{2}-[0-9]{2}-[0-9]{2} '"

if [ "$failures" -gt 0 ]; then
  echo "M03 checks: $failures failed"
  exit 1
fi
echo "M03 checks: all passed"
