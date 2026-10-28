#!/usr/bin/env bash
# Milestone M06 checks (docs/plan/M06-explorer-a11y.md, "Done when"), run by scripts/verify.sh after
# the unit tests (nav, announce, shortcuts, routes, expand, viewport, controls-layout), the
# integration tests (lineage-expand.int.test.ts), the build (with the bundle budget) and E2E
# (`@smoke|@M06`: e2e/m06-explorer-a11y.spec.ts). They stay valid after M06, so
# `scripts/verify.sh all` keeps running them (CI, M13).
#
# Here: required files, React Flow's own keyboard off and one tab stop, single-key shortcuts only on
# the graph, the screen-reader texts, the route highlight without opacity, the phone's bottom
# sheet, the expansion through the oRPC client, no API drift, touch and motion, the budget, the
# screenshots, the visual states and the design review, the E2E titles, the documentation, and the
# earlier milestones' checks left untouched.
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
STATES=(explore-selection explore-expanded explore-more-list explore-shortcuts explore-keyboard)
X=src/components/lineage/explorer

# 1. Required files (Done when 3) ----------------------------------------------------------------------
required=(
  # F: the seams, the view maths and the stubs the packages filled
  "$X/viewport.ts" "$X/viewport.test.ts" "$X/panel.tsx" e2e/helpers/explorer-a11y.ts
  # A: keyboard and screen readers
  "$X/keys.tsx" "$X/nav.ts" "$X/nav.test.ts" "$X/announce.ts" "$X/announce.test.ts" "$X/shortcuts.ts" "$X/shortcuts.test.ts"
  "$X/shortcut-help.tsx" "$X/teacher-chooser.tsx" e2e/helpers/m06-keys.ts
  # C: expansion, summary node, students list, server contract
  "$X/expand.ts" "$X/expand-engine.ts" "$X/expand-state.ts" "$X/expand.test.ts" "$X/node-controls.tsx" "$X/summary-node.tsx"
  "$X/students-list.tsx" src/server/services/lineage-expand.int.test.ts e2e/helpers/m06-expand.ts
  # B: selection, routes, panel and bottom sheet
  "$X/routes.ts" "$X/routes.test.ts" "$X/route-list.ts" e2e/helpers/m06-panel.ts
  # D: touch, motion, the buttons over the canvas, docs
  "$X/controls-layout.ts" "$X/controls-layout.test.ts" e2e/helpers/m06-touch.ts docs/a11y/explorer.md docs/perf/explorer.md
  # I: the screen states, the review, the ADR, this script
  e2e/m06-explorer-a11y.spec.ts e2e/helpers/m06-states.ts docs/design/reviews/M06.md docs/adr/0010-explorer-a11y.md scripts/verify.d/M06.sh
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done
check "directory exists and is not empty: docs/screenshots/M06/" bash -c '[ -d docs/screenshots/M06 ] && [ -n "$(ls -A docs/screenshots/M06)" ]'

# 2. React Flow's keyboard off, one tab stop (In scope 1) ------------------------------------------------
check "canvas.tsx turns React Flow's own keyboard, focusable edges, dragging and connecting off" bash -c '
  f=src/components/lineage/explorer/canvas.tsx
  for p in disableKeyboardA11y "edgesFocusable={false}" "nodesDraggable={false}" "nodesConnectable={false}" \
    "panActivationKeyCode={null}" "selectionKeyCode={null}" "multiSelectionKeyCode={null}"; do grep -qF -- "$p" "$f" || exit 1; done'
check "one tab stop (roving tabindex: the active node 0, every other -1) and the relationships as each node's aria-describedby" bash -c '
  grep -qF "n.id === active ? 0 : -1" src/components/lineage/explorer/canvas.tsx &&
  grep -qF "tabIndex: -1, '\''aria-describedby'\'': relationsId(" src/components/lineage/explorer/explorer.tsx'
check "still only canvas.tsx imports @xyflow/react" bash -c '
  [ "$(grep -rlE "from .@xyflow/react" src | sort | tr "\n" " ")" = "src/components/lineage/explorer/canvas.tsx " ]'

# 3. Single-key shortcuts only on the graph (In scope 1, WCAG 2.1.4) --------------------------------------
refute "no keydown listener on the document or window in the explorer (the graph's wrapper has the one handler)" \
  grep -rnE "addEventListener\(\s*['\"]keydown" src/components/lineage/explorer
check "the graph's wrapper has data-graph-keys with onKeyDown" grep -qE "data-graph-keys=\"\" onKeyDown=" src/components/lineage/explorer/canvas.tsx
check "shortcuts.ts lists Tab, the four arrows, Enter, Space, +, -, 0, /, ? and Escape" bash -c '
  f=src/components/lineage/explorer/shortcuts.ts
  for k in "'\''Tab'\''" "'\''ArrowUp'\''" "'\''ArrowDown'\''" "'\''ArrowLeft'\''" "'\''ArrowRight'\''" "'\''Enter'\''" "'\''Space'\''" \
    "'\''+'\''" "'\''-'\''" "'\''0'\''" "'\''/'\''" "'\''?'\''" "'\''Escape'\''"; do grep -qF -- "keys: [$k" "$f" || exit 1; done'
check "/ in the graph opens the search palette (keys.tsx calls openSearch)" grep -q "openSearch" src/components/lineage/explorer/keys.tsx

# 4. Screen readers (In scope 2) ------------------------------------------------------------------------------
check "the canvas has a polite live region" grep -qF 'aria-live="polite"' src/components/lineage/explorer/canvas.tsx
check "announce.ts builds the generation label with generationText (DEFAULT D22)" bash -c '
  grep -q "generationText" src/components/lineage/explorer/announce.ts && grep -q "DEFAULT D22" src/components/lineage/explorer/announce.ts'

# 5. The route highlight (In scope 3) -------------------------------------------------------------------------
check "routes.ts has litOf and litFlow and orders the routes by DEFAULT D05" bash -c '
  f=src/components/lineage/explorer/routes.ts
  grep -q "export function litOf" "$f" && grep -q "export function litFlow" "$f" && grep -q "DEFAULT D05" "$f"'
check "the canvas sets data-highlighting and data-lit" bash -c '
  grep -q "data-highlighting" src/components/lineage/explorer/canvas.tsx && grep -q "data-lit" src/components/lineage/explorer/canvas.tsx'
# The M06 blocks of globals.css, from each opening marker to its end marker; the route highlight
# block (B) alone; and CSS without its comments (the rules alone: the blocks' comments name the
# tokens and "opacity" in words).
m06_css() { awk '/^\/\* M06 (keyboard \(A\)|route highlight \(B\)|touch and motion \(D\))/,/^\/\* end M06 /' src/app/globals.css; }
m06_highlight_css() { awk '/^\/\* M06 route highlight \(B\)/,/^\/\* end M06 route highlight \(B\)/' src/app/globals.css; }
css_rules() {
  awk '{
    line = $0; out = ""
    while (length(line) > 0) {
      if (inside) { i = index(line, "*/"); if (i == 0) line = ""; else { line = substr(line, i + 2); inside = 0 } }
      else { i = index(line, "/*"); if (i == 0) { out = out line; line = "" } else { out = out substr(line, 1, i - 1); line = substr(line, i + 2); inside = 1 } }
    }
    print out
  }'
}
# Its own block's rules, not the tokens main already has elsewhere in globals.css: rules for the lit
# routes ([data-edge][data-lit], not only :not([data-lit])), and everything off them in the solid
# dim tones.
check "the route highlight block (B) lights the routes by data-lit and dims the rest with the solid dim tokens (plan §4.7)" bash -c "
  $(declare -f m06_highlight_css css_rules)
  rules=\$(m06_highlight_css | css_rules)
  for p in '[^(]\\[data-lit\\]' ':not\\(\\[data-lit\\]\\)' 'var\\(--dim-stroke\\)' 'var\\(--dim-text\\)'; do
    printf '%s\n' \"\$rules\" | grep -qE -- \"\$p\" || exit 1
  done"
# Fails on a match in any of the files or the blocks (each grep's own status, not the last one's);
# a grep that cannot read its files fails it too.
refute "no opacity in the explorer's M06 files and CSS blocks (solid tones only, plan §4.7)" bash -c "
  $(declare -f m06_css css_rules)
  grep -nE 'opacity-[0-9[]|opacity:[[:space:]]*0?\\.[0-9]|opacity=[\"{]*0?\\.[0-9]' src/components/lineage/explorer/canvas.tsx src/components/lineage/explorer/panel.tsx \
    src/components/lineage/explorer/summary-node.tsx src/components/lineage/explorer/node-controls.tsx src/components/ink/link-stroke.tsx
  tsx=\$?
  m06_css | css_rules | grep -nE 'opacity[[:space:]]*:'
  css=\$?
  if [ \$tsx -eq 2 ] || [ \$css -eq 2 ]; then exit 2; fi
  if [ \$tsx -eq 1 ] && [ \$css -eq 1 ]; then exit 1; fi
  exit 0"

# 6. The phone's bottom sheet (In scope 3, 5) -------------------------------------------------------------------
check "panel.tsx: a non-modal Drawer with snap points 0.15, 0.5 and 0.92, Focus this lineage, Show ended training, the routes" bash -c '
  f=src/components/lineage/explorer/panel.tsx
  grep -q "<Drawer" "$f" && grep -qF "modal={false}" "$f" && grep -qF "[0.15, 0.5, 0.92]" "$f" && grep -q "Focus this lineage" "$f" &&
  grep -q "Show ended training" "$f" && grep -qF "Route {k + 1} of" "$f"'
check "\"Open profile\" stays in explorer.tsx and is passed to the panel" bash -c '
  grep -q "Open profile" src/components/lineage/explorer/explorer.tsx && grep -q "openProfile" src/components/lineage/explorer/panel.tsx'
check "the sheet keeps its scrolling to itself and clears the bottom safe area" bash -c '
  grep -q "overscroll" src/components/lineage/explorer/panel.tsx src/components/ui/drawer.tsx &&
  grep -q "safe-area-inset-bottom" src/components/lineage/explorer/panel.tsx src/components/ui/drawer.tsx'
refute "no asChild, 100vh or window.open in the explorer and the Drawer" grep -rnE "asChild|100vh|window\.open" src/components/lineage/explorer src/components/ui/drawer.tsx

# 7. The expansion (In scope 4) ---------------------------------------------------------------------------------
check "expand.ts merges by lineage.ego (DEFAULT D03) and lays out with the expand preset and the previous positions" bash -c '
  f=src/components/lineage/explorer/expand.ts
  grep -q "DEFAULT D03" "$f" && grep -qF "preset: '\''expand'\''" "$f" && grep -q "previousPositions" "$f" && grep -q "orpc.lineage.ego.queryOptions(" "$f"'
check "one press draws up to 12 students (FANOUT_SHOWN = 12, M05 question 1)" grep -qF "export const FANOUT_SHOWN = 12;" src/components/lineage/explorer/state.ts
check "the summary node reads \"and N more\"" grep -qF 'and ${more' src/components/lineage/explorer/summary-node.tsx
# The panel's chunk does not take the oRPC client and TanStack Query: the island gives it the reader
# (expand.ts provideStudents), and students-list.tsx reads through it (ADR 0010).
check "the students list reads people.students through the oRPC client and the explorer's query client" bash -c '
  grep -qF "orpc.people.students.queryOptions(" src/components/lineage/explorer/expand.ts &&
  grep -q "readStudents(" src/components/lineage/explorer/students-list.tsx'
refute "no fetch() in the explorer (API-first through the oRPC client)" bash -c 'grep -rnE "(^|[^a-zA-Z.])fetch\(" src/components/lineage/explorer'

# 8. No API drift (section c) -----------------------------------------------------------------------------------
check_verbose "the OpenAPI contract is up to date (pnpm api:openapi --check)" pnpm --silent api:openapi --check
check "lineage-expand.int.test.ts covers the five cases of the plan's section c" bash -c '
  f=src/server/services/lineage-expand.int.test.ts
  for n in 1 2 3 4 5; do grep -qE "it\(.$n\. " "$f" || exit 1; done'

# 9. Touch and motion (In scope 5, 6) ---------------------------------------------------------------------------
refute "no MiniMap" grep -rn "MiniMap" src
check "touch-action: none is on React Flow's element only (the explorer-canvas class), not on the canvas container" bash -c "
  $(declare -f m06_css)
  m06_css | grep -A1 '^\\.explorer-canvas {' | grep -q 'touch-action: none' &&
  grep -qF 'className=\"explorer-canvas\"' src/components/lineage/explorer/canvas.tsx &&
  ! grep -rqE '\\[touch-action:none\\]|touch-none' src/components/lineage/explorer/explorer.tsx"
# M06's own motion: the transitions of its CSS blocks, stopped by the global reduced-motion rule
# (M00b) because they take the motion tokens, and the view's moves (key moves, Center on selection,
# the anchor of an expansion), which take moveFor's duration: none under reduced motion.
check "the M06 motion stops under prefers-reduced-motion: the M06 CSS blocks take only motion tokens (zeroed by the global rule) and every view move in the explorer takes moveFor's duration" bash -c "
  $(declare -f m06_css css_rules)
  css_rules < src/app/globals.css | awk '
    /@media \\(prefers-reduced-motion: reduce\\)/ { on = 1 }
    on && /transition-duration: 0\\.01ms !important/ { t = 1 }
    on && /animation-duration: 0\\.01ms !important/ { a = 1 }
    END { exit !(t && a) }' || exit 1
  ! m06_css | css_rules | grep -qE '(^|[^-[:alnum:]])[0-9]*\\.?[0-9]+m?s([^[:alnum:]-]|\$)' || exit 1
  c=src/components/lineage/explorer/canvas.tsx
  grep -qF \"matchMedia('(prefers-reduced-motion: reduce)')\" \$c && grep -qF 'duration: reduced ? 0 : duration' \$c || exit 1
  grep -rqE 'duration:[[:space:]]*([1-9]|0\\.[0-9]*[1-9])' src/components/lineage/explorer --include=*.tsx --include=*.ts --exclude=*.test.ts
  [ \$? -eq 1 ]"
check "Zoom in, Zoom out and Fit the whole view in the group named Zoom; Center on selection and Keyboard shortcuts outside it" bash -c '
  f=src/components/lineage/explorer/canvas.tsx
  for w in "Zoom in" "Zoom out" "Fit the whole view" "Center on selection" "Keyboard shortcuts"; do grep -q "\"$w\"" "$f" || exit 1; done
  grep -qF "aria-label=\"Zoom\"" "$f" && grep -qF "aria-label=\"Canvas tools\"" "$f"'
check "the legend stays visible (not inside a <details>, plan §4.6)" bash -c '
  grep -q "<Legend kinds={drawnKinds" src/components/lineage/explorer/explorer.tsx && ! grep -q "<details" src/components/lineage/explorer/explorer.tsx'

# 10. Budget ----------------------------------------------------------------------------------------------------
if [ -f .next/build-manifest.json ]; then
  check_verbose "every route is within its JavaScript budget, /explore's included (scripts/check-bundle-budget.mjs)" \
    node scripts/check-bundle-budget.mjs
else
  bad "the build: no build output (.next/build-manifest.json); run pnpm build:e2e first"
fi
check "ADR 0010 records /explore and the lazy chunks (canvas, panel, help, expansion engine) and the INP numbers" bash -c '
  f=docs/adr/0010-explorer-a11y.md
  grep -q "/explore" "$f" && grep -q "Платното" "$f" && grep -q "Панелът" "$f" && grep -q "Помощта" "$f" && grep -q "Двигателят на разгъването" "$f" &&
  grep -q "INP" "$f" && ! grep -q "__EXPLORE_KB__" "$f"'

# 11. Screenshots, visual regression and the design review (In scope 8) --------------------------------------------
for state in "${STATES[@]}"; do
  for size in "${SIZES[@]}"; do
    for theme in "${THEMES[@]}"; do
      check "screenshot: docs/screenshots/M06/$state-$size-$theme.png" test -s "docs/screenshots/M06/$state-$size-$theme.png"
    done
  done
done
check "the five states are named in e2e/helpers/m06-states.ts and taken by e2e/screenshots.spec.ts with milestone 'M06'" bash -c '
  for s in '"${STATES[*]}"'; do grep -qF "name: '\''$s'\''" e2e/helpers/m06-states.ts || exit 1; done
  grep -qF "...EXPLORER_STATES.map((state) => ({ ...state, milestone: '\''M06'\'' }))" e2e/screenshots.spec.ts'
check "e2e/visual.spec.ts has the EXPLORER_STATES loop with explore-selection and explore-expanded" bash -c '
  f=e2e/visual.spec.ts
  grep -q "EXPLORER_STATES" "$f" && grep -q "explore-selection" "$f" && grep -q "explore-expanded" "$f"'
check "the design review covers every state at both sizes in both themes against direction.md" bash -c '
  f=docs/design/reviews/M06.md
  for w in '"${STATES[*]}"' 390x844 1440x900 dark light direction.md; do grep -q "$w" "$f" || exit 1; done'

# 12. E2E titles (Done when 2) ---------------------------------------------------------------------------------------
titles=(
  '@M06 keyboard only: Tab into the graph, ArrowUp moves to a teacher, the announcement includes name and status, Enter opens the profile'
  '@M06 exactly one element inside .react-flow has tabindex="0"'
  '@M06 ArrowDown reaches a student node that started off-screen'
  '@M06 Space on demo-two-lineages highlights both routes of descent and the panel lists them'
  '@M06 "+N students" on demo-hub-a adds nodes and keeps the focused node in view'
  '@M06 a teacher with more than 12 students shows an "and N more" node that opens a paginated list'
  '@M06 at 390x844 a tap opens the bottom sheet with Open profile; zoom and fit buttons work'
  '@M06 on mobile every explorer control is at least 44x44 CSS px'
  '@M06 single-key shortcuts do nothing when focus is outside the graph'
  '@M06 prefers-reduced-motion disables layout animation'
  '@M06 "?" opens the shortcut help dialog listing every key'
  '@M06 no axe violations on /explore at desktop and mobile sizes in dark and light themes'
)
for t in "${titles[@]}"; do
  check "E2E test: $t" grep -qF -- "$t" e2e/m06-explorer-a11y.spec.ts
done
m06_tests=(e2e/m06-explorer-a11y.spec.ts e2e/helpers/explorer-a11y.ts e2e/helpers/m06-keys.ts e2e/helpers/m06-expand.ts
  e2e/helpers/m06-panel.ts e2e/helpers/m06-touch.ts e2e/helpers/m06-states.ts
  "$X/viewport.test.ts" "$X/nav.test.ts" "$X/announce.test.ts" "$X/shortcuts.test.ts" "$X/expand.test.ts" "$X/routes.test.ts"
  "$X/controls-layout.test.ts" src/server/services/lineage-expand.int.test.ts)
refute "no skipped or focused M06 test" grep -nE "\b(test|it|describe)\.(skip|only|fixme|todo)\(" "${m06_tests[@]}"
refute "no axe rule switched off in the M06 spec and its helpers" grep -nE "disableRules|\.exclude\(" e2e/m06-explorer-a11y.spec.ts e2e/helpers/explorer-a11y.ts \
  e2e/helpers/m06-keys.ts e2e/helpers/m06-expand.ts e2e/helpers/m06-panel.ts e2e/helpers/m06-touch.ts e2e/helpers/m06-states.ts

# 13. Documentation (In scope 7, 9) -----------------------------------------------------------------------------------
check "docs/a11y/explorer.md is the NVDA and VoiceOver checklist" bash -c 'grep -q "NVDA" docs/a11y/explorer.md && grep -q "VoiceOver" docs/a11y/explorer.md'
check "docs/perf/explorer.md has the warm and cold layout rows and DEFAULT D24" bash -c '
  f=docs/perf/explorer.md; grep -qi "топла" "$f" && grep -qi "студена" "$f" && grep -q "DEFAULT D24" "$f"'
check "the user guide has the keys, the screen reader, the bottom sheet and the expansion" bash -c '
  f=docs/guides/user-guide.bg.md
  grep -q "ArrowUp\|↑" "$f" && grep -qi "екранен четец" "$f" && grep -q "долния панел" "$f" && grep -q "+N" "$f"'
check "docs/plan/README.md has a status for M06" bash -c '! grep -qE "^\| M06 .*\| не е започнат \|$" docs/plan/README.md'
check "docs/plan/questions/M06.md is absent or has no open question" bash -c '
  f=docs/plan/questions/M06.md; [ ! -e "$f" ] || ! grep -qiE "^(status|състояние):? *open" "$f"'
# Against origin/main, or the local main of a checkout that is not fetched (the owner pushes).
main_ref=""
for ref in origin/main main; do
  if git rev-parse --verify -q "$ref" >/dev/null 2>&1; then main_ref="$ref"; break; fi
done
if [ -n "$main_ref" ] && base="$(git merge-base HEAD "$main_ref" 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD "$main_ref" 2>/dev/null; then
  check "docs/guides/user-guide.bg.md changed in this branch (differs from the merge base with $main_ref)" \
    bash -c "! git diff --quiet $base -- docs/guides/user-guide.bg.md"
  # 14. The earlier milestones' checks are not edited to pass (plan section g, item 14).
  check "scripts/verify.d/M05.sh, M07.sh and M00b.sh are unchanged against the merge base with $main_ref" \
    git diff --quiet "$base" -- scripts/verify.d/M05.sh scripts/verify.d/M07.sh scripts/verify.d/M00b.sh
else
  ok "the user guide changed and the earlier checks are untouched in this branch: not checkable here (merged into main, or no main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M06 checks: $failures failed"
  exit 1
fi
echo "M06 checks: all passed"
