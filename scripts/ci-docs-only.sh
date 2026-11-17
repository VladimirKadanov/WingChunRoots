#!/usr/bin/env bash
# scripts/ci-docs-only.sh: reads changed paths (one per line) on stdin and exits 0 when every one
# is documentation that no browser test can see, 1 otherwise (and for an empty list). CI's E2E
# machines skip a pull request that changes only such files (docs/adr/0036-ci-split.md); the checks
# machine, which reads the guides and plans, always runs.
#
# Documentation: anything under docs/ except docs/api/ (the OpenAPI contract), and Markdown files
# outside content/ (content/legal/*.md are rendered as the legal pages).
set -uo pipefail
seen=0
while IFS= read -r path; do
  [ -n "$path" ] || continue
  seen=1
  case "$path" in
    docs/api/*) exit 1 ;;
    docs/*) ;;
    content/*) exit 1 ;;
    *.md) ;;
    *) exit 1 ;;
  esac
done
[ "$seen" = 1 ]
