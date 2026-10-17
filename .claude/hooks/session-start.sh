#!/usr/bin/env bash
# SessionStart hook (plan §7.6, milestone M00). Runs only in Claude Code cloud sessions:
# installs PostgreSQL 16 + PostGIS 3.4 from the Ubuntu archive, creates the UTF-8 test
# database, installs the pinned pnpm and the dependencies, and exports TEST_DATABASE_URL
# (and PW_CHROMIUM_EXECUTABLE when needed) through $CLAUDE_ENV_FILE.
# Synchronous on purpose: tests must not start before the database is ready.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

exec "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/scripts/cloud-setup.sh"
