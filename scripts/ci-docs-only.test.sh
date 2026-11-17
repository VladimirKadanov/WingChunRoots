#!/usr/bin/env bash
# Tests of scripts/ci-docs-only.sh (run by scripts/verify.d/M00.sh).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 2
fail=0
expect() { # expect <0|1> <paths...>
  local want="$1"; shift
  printf '%s\n' "$@" | scripts/ci-docs-only.sh; local got=$?
  if [ "$got" != "$want" ]; then echo "FAIL ci-docs-only: [$*] gave $got, expected $want"; fail=1; fi
}
expect 0 docs/guides/admin-guide.bg.md
expect 0 docs/adr/0036-ci-split.md README.md docs/plan/README.md
expect 1 docs/api/openapi.json
expect 1 content/legal/terms.en.md
expect 1 docs/guides/admin-guide.bg.md src/app/page.tsx
expect 1 .github/workflows/ci.yml
expect 1 ""
[ "$fail" = 0 ] && echo "ok   scripts/ci-docs-only.sh"
exit "$fail"
