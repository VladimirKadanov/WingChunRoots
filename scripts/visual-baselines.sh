#!/usr/bin/env bash
# scripts/visual-baselines.sh print [dir]
# scripts/visual-baselines.sh accept <artifact-dir | job-log-file>
#
# Baselines of the visual regression (e2e/visual.spec.ts, M00b) come only from CI, whose
# Chromium is exactly the one the pinned Playwright expects, and change only through a commit.
#
#   print   (CI, when the job failed) every screenshot the visual project took that has no
#           matching baseline (…-actual.png under test-results/), as base64 between
#           VISUAL-PNG-BEGIN/END lines, so the PNGs can be rebuilt from the job log when the
#           artifact cannot be downloaded.
#   accept  copies those screenshots over the baselines in e2e/__screenshots__/visual.spec.ts/:
#           from the unzipped `verify-log` artifact of the CI run, or from a saved job log.
#           Review the change (the Playwright report in the artifact shows the diffs), then
#           commit the PNGs. docs/guides/admin-guide.bg.md describes the whole procedure.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINES="$ROOT/e2e/__screenshots__/visual.spec.ts"

usage() {
  sed -n '2,3p' "$0" | sed 's/^# //' >&2
  exit 2
}

print_actuals() {
  local dir="${1:-$ROOT/test-results}" f name count=0
  while IFS= read -r f; do
    name="$(basename "$f" -actual.png)"
    echo "VISUAL-PNG-BEGIN $name $(wc -c < "$f") $(sha256sum "$f" | cut -d' ' -f1)"
    base64 -w 4000 "$f"
    echo "VISUAL-PNG-END $name"
    count=$((count + 1))
  done < <(find "$dir" -path '*-visual/*' -name '*-actual.png' 2>/dev/null | sort)
  echo "visual-baselines: printed $count screenshot(s)"
}

accept() {
  local source="${1:-}" count=0
  [ -n "$source" ] || usage
  mkdir -p "$BASELINES"
  if [ -d "$source" ]; then
    local f
    while IFS= read -r f; do
      cp "$f" "$BASELINES/$(basename "$f" -actual.png)-linux.png"
      count=$((count + 1))
    done < <(find "$source" -path '*-visual/*' -name '*-actual.png' | sort)
  elif [ -f "$source" ]; then
    # GitHub prefixes each log line with a timestamp; the payload is the last field.
    count="$(node - "$source" "$BASELINES" <<'JS'
const fs = require('fs');
const crypto = require('crypto');
const [log, out] = process.argv.slice(2);
let current = null;
let written = 0;
for (const raw of fs.readFileSync(log, 'utf8').split(/\r?\n/)) {
  const line = raw.replace(/^\S*Z\s/, '').trim();
  const begin = /^VISUAL-PNG-BEGIN (\S+) (\d+) ([0-9a-f]{64})$/.exec(line);
  if (begin) { current = { name: begin[1], bytes: Number(begin[2]), sha: begin[3], chunks: [] }; continue; }
  if (current && line === `VISUAL-PNG-END ${current.name}`) {
    const png = Buffer.from(current.chunks.join(''), 'base64');
    const sha = crypto.createHash('sha256').update(png).digest('hex');
    if (png.length !== current.bytes || sha !== current.sha) {
      console.error(`visual-baselines: ${current.name} is damaged in the log (size or SHA-256 differs)`);
      process.exit(1);
    }
    fs.writeFileSync(`${out}/${current.name}-linux.png`, png);
    written += 1;
    current = null;
    continue;
  }
  if (current) current.chunks.push(line);
}
console.log(written);
JS
)"
  else
    echo "visual-baselines: $source is neither a directory nor a file" >&2
    exit 2
  fi
  echo "visual-baselines: accepted $count screenshot(s) into ${BASELINES#"$ROOT"/}; review and commit them"
}

case "${1:-}" in
  print) print_actuals "${2:-}" ;;
  accept) accept "${2:-}" ;;
  *) usage ;;
esac
