#!/usr/bin/env bash
# Prints the Chromium executable Playwright should use in a Claude cloud session, or
# nothing when the build expected by the pinned Playwright is installed (plan §7.6).
# Cloud sessions ship a preinstalled Chromium under $PLAYWRIGHT_BROWSERS_PATH and must
# never run `playwright install`; when the pinned Playwright expects another build, the
# newest preinstalled Chromium is used through PW_CHROMIUM_EXECUTABLE.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

expected="$(node -e "process.stdout.write(require('@playwright/test').chromium.executablePath())" 2>/dev/null || true)"
if [ -n "$expected" ] && [ -x "$expected" ]; then
  # Headless runs use the matching chromium_headless_shell-<rev> build; both must exist.
  browsers_dir="$(dirname "$(dirname "$(dirname "$expected")")")"
  revision="$(printf '%s\n' "$expected" | sed -n 's|.*/chromium-\([0-9][0-9]*\)/.*|\1|p')"
  if [ -n "$revision" ] && [ -d "$browsers_dir/chromium_headless_shell-$revision" ]; then
    exit 0
  fi
fi
candidate="$(ls -d "${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"/chromium-*/chrome-linux*/chrome 2>/dev/null | sort -V | tail -n 1 || true)"
if [ -n "$candidate" ] && [ -x "$candidate" ]; then
  printf '%s\n' "$candidate"
fi
