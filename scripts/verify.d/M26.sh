#!/usr/bin/env bash
# Milestone M26 checks (docs/plan/M26-archive-editor.md, "Done when"), run by scripts/verify.sh
# after the unit tests, the integration tests (src/server/services/archive-editor.int.test.ts, the
# rows of the authorization matrix and the page guards), db:check, db:reset+migrate+seed, the build
# and E2E (`@smoke|@M26`: e2e/m26-archive-editor.spec.ts in the exclusive run). They stay valid
# after M26, so `scripts/verify.sh all` keeps running them.
#
# Here: required files, the one migration, who may use the editor, the publication and privacy
# rules, the procedures and their actions, the pages, the tests and the documentation.
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

SERVICE=src/server/services/archive-editor.ts
REVIEW=src/server/services/review.ts
ROUTER=src/server/rpc/router.ts
PARITY=src/server/rpc/parity.ts
MATRIX=src/server/rpc/authz-matrix.int.test.ts
GUARDS=src/server/auth/guards.ts
INT=src/server/services/archive-editor.int.test.ts
SPEC=e2e/m26-archive-editor.spec.ts
HOME_PAGE=src/app/admin/archive/page.tsx
LINEAGE_PAGE='src/app/admin/archive/lineages/[slug]/page.tsx'
ACTIONS=src/app/admin/archive/actions.ts
FORMS=src/app/admin/archive/forms.tsx

# 1. Files ------------------------------------------------------------------------------------------
for f in "$SERVICE" "$INT" "$SPEC" "$HOME_PAGE" "$LINEAGE_PAGE" "$ACTIONS" "$FORMS" src/app/admin/archive/error.tsx \
  docs/adr/0034-archive-editor.md docs/plan/M26-archive-editor.md docs/plan/questions/M26.md; do
  check "exists: $f" test -f "$f"
done

# 2. The migration -----------------------------------------------------------------------------------
check "one migration m26_archive_editor adds teaching_relationship.source_note with its length check" bash -c "
  n=\$(ls -d drizzle/*_m26_archive_editor 2>/dev/null | wc -l); [ \"\$n\" -eq 1 ] &&
  grep -q 'ADD COLUMN \"source_note\" text' drizzle/*_m26_archive_editor/migration.sql &&
  grep -q 'teaching_relationship_source_note_length' drizzle/*_m26_archive_editor/migration.sql"
refute "no public view selects source_note" grep -n "source_note" $(grep -l "CREATE.*VIEW" drizzle/*/migration.sql)

# 3. Who --------------------------------------------------------------------------------------------
check "the editor's roles are an archivist and an administrator" grep -qE "ARCHIVE_EDITOR_ROLES: readonly StaffRole\[\] = \['archivist', 'admin'\]" "$SERVICE"
check "the archival edit uses the same roles (owner decision)" grep -q "const ARCHIVE_ROLES: readonly StaffRole\[\] = ARCHIVE_EDITOR_ROLES" "$REVIEW"
check "the pages are guarded for the same roles" grep -qF "'/admin/archive': { kind: 'staff2fa', roles: ['archivist', 'admin'] }" "$GUARDS"
check "every service starts with the role check" bash -c "[ \$(grep -c '= editor(principal)' $SERVICE) -ge 5 ] && [ \$(grep -c '  editor(principal);' $SERVICE) -ge 3 ]"

# 4. The rules of a link ------------------------------------------------------------------------------
check "a link takes the verify lock, the cycle and duplicate checks, and markVerified" bash -c "
  grep -q 'pg_advisory_xact_lock(hashtext(\${VERIFY_LOCK}))' $SERVICE && grep -q 'closesCycle(tx, teacher.id, student.id)' $SERVICE && grep -q 'markVerified(tx, row' $SERVICE"
check "a member's own record is refused at both ends" bash -c "grep -q \"teacher.stewardship === 'self'\" $SERVICE && grep -q \"student.stewardship === 'self'\" $SERVICE"
check "a link is committee_review with its source, and its event carries the idempotency key" bash -c "
  grep -q \"verificationPath: 'committee_review'\" $SERVICE && grep -q 'sourceNote: input.source' $SERVICE && grep -q \"reason: 'archive', key: input.idempotencyKey\" $SERVICE"
check "a link queues lineage.recompute and drops the public cache" bash -c "grep -q 'QUEUE.lineageRecompute' $SERVICE && grep -q \"invalidatePublic(outcome.tags, 'procedure')\" $SERVICE"
check "ending a link revokes it (never deletes)" bash -c "grep -q \"status: 'revoked'\" $SERVICE && ! grep -q 'tx.delete(teachingRelationship)' $SERVICE"
check "a new record is involved_only (DEFAULT D03)" grep -q "visibility: 'involved_only', createdByUserId: p.user.id" "$SERVICE"

# 5. Privacy -----------------------------------------------------------------------------------------
refute "no name, source or biography text is written to an audit row" grep -nE "after: \{[^}]*(input\.source[^.]|input\.primaryName|input\.bio[^ ?])" "$SERVICE"
refute "no logger in the archive editor" grep -nE "console\.|logger\." "$SERVICE"

# 6. API ---------------------------------------------------------------------------------------------
for proc in lineages lineage createLineage updateLineage search createRecord addLink endLink; do
  check "procedure archiveEditor.$proc in the router and the matrix" bash -c "grep -q \"^    $proc: staffWithSecondFactor\" $ROUTER && grep -q \"path: 'archiveEditor.$proc'\" $MATRIX"
done
for action in createLineageAction updateLineageAction createRecordAction addLinkAction endLinkAction; do
  check "Server Action $action is in parity.ts and the matrix" bash -c "grep -q \"src/app/admin/archive/actions.ts#$action\" $PARITY && grep -q \"src/app/admin/archive/actions.ts#$action\" $MATRIX"
done
check "openapi.json has the archive editor's paths" bash -c "grep -q '/archive-editor/links/add' docs/api/openapi.json && grep -q '/archive-editor/lineages/create' docs/api/openapi.json"

# 7. Pages -------------------------------------------------------------------------------------------
check "both pages are in e2e/routes.ts (axe in both themes)" bash -c "grep -qF \"path: '/admin/archive'\" e2e/routes.ts && grep -qF \"path: '/admin/archive/lineages/\" e2e/routes.ts"
check "/admin links to the editor for archivists and administrators" grep -q 'href="/admin/archive"' src/app/admin/page.tsx
check "status is said in words, never only by colour" bash -c "grep -q \"'Not public'\" src/app/admin/archive/parts.tsx && grep -q \"'Ended'\" '$LINEAGE_PAGE' && grep -q 'Not in the explorer yet' '$HOME_PAGE'"
refute "no 100vh, window.open or Radix asChild in the new pages" grep -nE "100vh|window\.open|asChild" "$HOME_PAGE" "$LINEAGE_PAGE" "$FORMS"

# 8. Tests -------------------------------------------------------------------------------------------
check "E2E test: the editor end to end" grep -qF '@M26 an administrator records two historical teachers, a lineage and a verified link with its source' "$SPEC"
check "the E2E spec runs alone (PUBLIC_WRITE_SPECS)" grep -qF "'**/m26-archive-editor.spec.ts'" e2e/projects.ts
int_titles=(
  'an archivist and an administrator with the second factor; a moderator, a member and an unconfirmed session are refused'
  'a historical record kept by the platform, private, with every spelling, found by the staff search; the audit row names no name'
  'records a verified link with its source and years; both records become public; the explorer lists the lineage; a second call with the key changes nothing'
  'a record whose life status is unknown stays hidden, and so does the link, until a death is established'
  'refuses a member’s own record, a cycle, the same person twice, a missing source and years out of range'
  'ends a link entered by mistake: revoked, off the public edges, with its event and reason; never twice'
)
for t in "${int_titles[@]}"; do check "integration test: $t" grep -qF "$t" "$INT"; done
refute "only demo- data and example.test addresses in the M26 tests" grep -nE "@[a-z]+\.(com|net|org)\b" "$INT" "$SPEC"

# 9. Documentation ------------------------------------------------------------------------------------
check "ADR 0034 records the roles, the link rules and the migration" bash -c "f=docs/adr/0034-archive-editor.md; grep -q 'ARCHIVE_EDITOR_ROLES' \"\$f\" && grep -q 'source_note' \"\$f\" && grep -q 'committee_review' \"\$f\" && grep -q 'DEFAULT D03' \"\$f\""
check "questions/M26.md has questions, each with a proposed default" bash -c "
  f=docs/plan/questions/M26.md; n=\$(grep -c '^## 2026-' \"\$f\"); [ \"\$n\" -ge 4 ] && [ \"\$(grep -c '^\\*\\*Proposed default:\\*\\*' \"\$f\")\" -ge \"\$n\" ]"
check "the admin guide has the archive editor" bash -c "f=docs/guides/admin-guide.bg.md; grep -q '(M26)' \"\$f\" && grep -q 'Add the link' \"\$f\" && grep -q 'End this link' \"\$f\" && grep -q 'Use as teacher' \"\$f\""
check "docs/data-model.md describes source_note and the migration" bash -c "grep -q 'source_note' docs/data-model.md && grep -q '_m26_archive_editor' docs/data-model.md"
check "docs/plan/README.md has a status for M26" grep -qE "^\| M26 " docs/plan/README.md
check "the technical plan §8.3 has the M26 row" grep -qE '^\| M26 \| \[`docs/plan/M26-archive-editor.md`\]' docs/WingChunRoots_Technical_Plan.bg.md
check "the milestone file has a Progress log with entries" bash -c "awk '/^## Дневник на напредъка/{f=1;next} f && /^- /{n++} END{exit !(n>0)}' docs/plan/M26-archive-editor.md"

if [ "$failures" -gt 0 ]; then
  echo "M26 checks: $failures failed"
  exit 1
fi
echo "M26 checks: all passed"
