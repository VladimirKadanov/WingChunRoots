#!/usr/bin/env bash
# Milestone M24 checks (docs/plan/M24-organization-tools.md, "Done when"), run by scripts/verify.sh
# after the unit tests (src/server/services/organization-import.test.ts among them), the integration
# tests (src/server/services/organization-tools.int.test.ts and the organizationTools rows of the
# authorization matrix), db:check, db:reset+migrate+seed, the build with the bundle budgets and E2E
# (`@smoke|@M24`: e2e/m24-organization-tools.spec.ts on the desktop and phone projects). They stay
# valid after M24, so `scripts/verify.sh all` keeps running them.
#
# Here: required files, no new dependency, the one migration and its grants, the import that never
# verifies, matches or contacts anyone, the claims that are never relationships, aggregates and a
# heatmap without a school's point, the separation rules, the procedures, the decisions by default,
# the UI rules, the E2E and integration titles, and the documentation.
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

IMPORT=src/server/services/organization-import.ts
CSV=src/server/services/organization-import-csv.ts
INSIGHTS=src/server/services/organization-insights.ts
SEPARATION=src/server/services/organization-separation.ts
CORE=src/server/services/organization-separation-core.ts
SCHEMA=src/server/db/schema/organization-tools.ts
ACTIONS=src/app/dashboard/organization/tools-actions.ts
MAP=src/components/map/heatmap-map.tsx
HEAT_VIEW='src/app/dashboard/organization/[id]/heatmap/heatmap-view.tsx'
SPEC=e2e/m24-organization-tools.spec.ts
INT=src/server/services/organization-tools.int.test.ts
UNIT=src/server/services/organization-import.test.ts
PAGES=(
  'src/app/dashboard/organization/[id]/import/page.tsx' 'src/app/dashboard/organization/[id]/import/[importId]/page.tsx'
  'src/app/dashboard/organization/[id]/analytics/page.tsx' 'src/app/dashboard/organization/[id]/heatmap/page.tsx' "$HEAT_VIEW"
  src/app/dashboard/organization/tools-forms.tsx src/app/dashboard/organization/tools-parts.tsx "$MAP"
)
mapfile -t M24_SQL < <(ls drizzle/*_m24_organization_tools/migration.sql 2>/dev/null)
TABLES=(organization_import organization_import_row organization_member_record organization_teacher_claim)

# 1. Required files (Done when 3, 5) -------------------------------------------------------------
required=(
  "$IMPORT" "$CSV" "$INSIGHTS" "$SEPARATION" "$CORE" "$SCHEMA" "$ACTIONS" src/app/dashboard/organization/tools-form-ids.ts "${PAGES[@]}"
  "$SPEC" "$INT" "$UNIT"
  docs/adr/0027-organization-tools.md docs/plan/M24-organization-tools.md docs/plan/questions/M24.md
  docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md docs/data-model.md
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done

# 2. No new dependency (CLAUDE.md §3) --------------------------------------------------------------
refute "no spreadsheet or CSV library in package.json" grep -nE '"(xlsx|exceljs|papaparse|csv-parse|csv-parser|fast-csv|sheetjs)"[[:space:]]*:' package.json
refute "nothing imports a spreadsheet or CSV library" grep -rnE "from '(xlsx|exceljs|papaparse|csv-parse[^']*|csv-parser|fast-csv)'" src scripts e2e

# 3. One migration and its grants (In scope 1; plan §3.2) ------------------------------------------
check "exactly one M24 migration (m24_organization_tools), with its snapshot" bash -c '
  [ "'"${#M24_SQL[@]}"'" -eq 1 ] && [ -s "$(dirname "'"${M24_SQL[0]:-none}"'")/snapshot.json" ]'
if [ "${#M24_SQL[@]}" -eq 1 ]; then
  SQL="${M24_SQL[0]}"
  for t in "${TABLES[@]}"; do
    check "the table $t" grep -qF "CREATE TABLE \"$t\"" "$SQL"
  done
  check "app_rw reads and writes the M24 tables; app_public_ro has no access" bash -c "
    grep -qF 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE \"organization_import\", \"organization_import_row\", \"organization_member_record\", \"organization_teacher_claim\" TO app_rw' '$SQL' &&
    grep -qF 'REVOKE ALL ON TABLE \"organization_import\", \"organization_import_row\", \"organization_member_record\", \"organization_teacher_claim\" FROM app_public_ro' '$SQL'"
  check "one open claim per organization, student and teacher (partial unique index)" grep -qF 'CREATE UNIQUE INDEX "organization_teacher_claim_open_key"' "$SQL"
  refute "no e-mail column in any M24 table" grep -nEi '"[a-z_]*email[a-z_]*"' "$SQL"
  refute "the migration deletes nothing and stays on PostgreSQL 16+ (no uuidv7(), no virtual generated columns, no OLD/NEW in RETURNING)" \
    grep -nEi "uuidv7\(|VIRTUAL|RETURNING[^;]*\b(OLD|NEW)\.|DELETE FROM|DROP TABLE" "$SQL"
  refute "the migration leaves the public views alone" grep -n 'CREATE OR REPLACE VIEW' "$SQL"
fi

# 4. The import: preview first, no verification, no matching, nobody contacted (In scope 2, 3) ----------
check "the limits: 500 rows, 256 KB, 10 previews a day, 24 hours" bash -c "
  grep -qF 'ORGANIZATION_IMPORT_MAX_ROWS = 500' $SCHEMA && grep -qF 'ORGANIZATION_IMPORT_MAX_BYTES = 256 * 1024' $SCHEMA &&
  grep -qF 'ORGANIZATION_IMPORTS_PER_DAY = 10' $SCHEMA && grep -qF 'ORGANIZATION_IMPORT_PREVIEW_HOURS = 24' $SCHEMA"
check "the template has the columns of specification §9.1" grep -qF "TEMPLATE_COLUMNS = ['First_Name', 'Last_Name', 'Email', 'Chinese_Name', 'Start_Year', 'Current_Rank', 'Sifu_Database_ID', 'School_City']" "$CSV"
check "a file that is not UTF-8 is refused (fatal decoder)" grep -qF 'fatal: true' "$CSV"
# code(): the matching lines that are not comments.
code() { grep -HnE "$@" | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)'; }
refute "the import service never writes a teaching relationship (code, not comments)" code "teachingRelationship|teaching_relationship" "$IMPORT" "$CORE"
check "an imported person is unclaimed, involved_only and has no account" bash -c "
  awk '/export async function commitImport/{f=1} f{print} f && /^}/{exit}' $IMPORT > /tmp/m24-commit.\$\$ &&
  grep -qF \"stewardship: 'unclaimed'\" /tmp/m24-commit.\$\$ && grep -qF \"visibility: 'involved_only'\" /tmp/m24-commit.\$\$ &&
  ! grep -q 'claimedByUserId' /tmp/m24-commit.\$\$; rc=\$?; rm -f /tmp/m24-commit.\$\$; [ \$rc -eq 0 ]"
check "the import refuses a name of a current member and never compares people outside the organization" bash -c "grep -q 'memberNameKeys' $IMPORT && grep -q 'v_public_person' $IMPORT"
refute "the import never sends mail or invitations" grep -nE "queueEmail|inviteTeacher|invitation" "$IMPORT" "$CSV"
check "the Email column is never kept" bash -c "grep -q 'Email' $CSV && ! grep -qE 'email[A-Za-z]*:' $SCHEMA"
check "the rows' fields are cleared when an import ends, and expired previews by retention.purge" bash -c "
  grep -q 'SET data = NULL' $IMPORT && grep -q 'expireOrganizationImports' src/server/services/retention.ts && grep -q 'expireOrganizationImports' src/server/jobs/worker.ts"
refute "the M24 services log no names or file contents" grep -nE "logger\(\)\.(info|warn|error)\(" "$IMPORT" "$CSV" "$INSIGHTS" "$SEPARATION" "$CORE"
check "the Server Action hands the file to the procedure, which checks it" grep -q 'organizationTools.importPreview' "$ACTIONS"

# 5. Analytics and the heatmap (In scope 4, 5; CLAUDE.md §6) ----------------------------------------------
check "a 1° grid and a minimum of 3 schools per drawn square" bash -c "grep -qF 'HEATMAP_CELL_DEGREES = 1' $INSIGHTS && grep -qF 'HEATMAP_MIN_SCHOOLS = 3' $INSIGHTS"
refute "the heatmap and the analytics never read a school's own point (code, not comments)" code "public_point|publicPoint|school_private_location|schoolPrivateLocation|exact_point" "$INSIGHTS"
check "the heatmap counts at the city's centre" grep -q 'centroid' "$INSIGHTS"
check "analytics and the heatmap need the approval and Federation (DEFAULT D08)" bash -c "[ \"\$(grep -c 'requireAdministration' $INSIGHTS)\" -ge 2 ]"
check "MapLibre is loaded only on request (React.lazy) and only in src/components/map" bash -c "grep -q \"lazy(() => import('@/components/map/heatmap-map'))\" '$HEAT_VIEW' && ! grep -rqE \"from '(maplibre-gl|@vis.gl/react-maplibre)\" src/app"
check "the heatmap's density is written as a number in each square, not colour alone" grep -q '{c.count}' "$MAP"

# 6. Separation (In scope 6; specification §10.3) ----------------------------------------------------------
check "separation removes the organization's record and withdraws its open claims (reason separation)" bash -c "
  grep -q 'organizationMemberRecord' $CORE && grep -qF \"'separation'\" $CORE"
check "both ways of ending a membership apply the same rules" bash -c "grep -q 'separateMembership' $SEPARATION && grep -q 'separateMembership' src/server/services/organizations.ts"
check "leaving needs no plan" bash -c "awk '/export async function leaveOrganization/{f=1} f{print} f && /^}/{exit}' $SEPARATION | grep -q 'requireAdministration'; [ \$? -eq 1 ]"
check "the notices organization.member_left and organization.membership_ended, dashboard only" bash -c "
  f=src/server/templates/catalog.ts; grep -qF \"'organization.member_left': dashboardOnly('organizations')\" \$f && grep -qF \"'organization.membership_ended': dashboardOnly('organizations')\" \$f"
check "the rules are shown on the member's and the organization's dashboards" bash -c "
  grep -q 'separation-rules' src/app/dashboard/organization/page.tsx && grep -q 'organization-separation-rules' 'src/app/dashboard/organization/[id]/page.tsx'"
check "the audit actions carry the new names" bash -c "f=src/server/audit/index.ts; for a in organization.import_preview organization.import_commit organization.import_discard organization.claim_withdraw organization.member_leave; do grep -q \"'\$a'\" \$f || exit 1; done"

# 7. API first (In scope 8; plan §6.8) ---------------------------------------------------------------------
check "the procedures: organizationTools.imports, importGet, importPreview, importCommit, importDiscard, claims, withdrawClaim, analytics, heatmap, memberships, leave" bash -c "
  f=src/server/rpc/router.ts; awk '/^  organizationTools: \\{/{f=1} f{print} f && /^  \\},/{exit}' \$f > /tmp/m24-tools.\$\$ &&
  for p in imports importGet importPreview importCommit importDiscard claims withdrawClaim analytics heatmap memberships leave; do grep -q \"^    \$p: \" /tmp/m24-tools.\$\$ || { rm -f /tmp/m24-tools.\$\$; exit 1; }; done; rm -f /tmp/m24-tools.\$\$"
check "docs/api/openapi.json has the organization tools paths" bash -c "f=docs/api/openapi.json; grep -qF '\"/organizations/imports/preview\"' \$f && grep -qF '\"/organizations/mine/{organizationId}/heatmap\"' \$f && grep -qF '\"/organizations/memberships/leave\"' \$f"
check "the Server Actions are thin wrappers in the parity table" bash -c "f=src/server/rpc/parity.ts;
  grep -qF \"#previewImportAction': { rpc: ['organizationTools.importPreview'] }\" \$f && grep -qF \"#commitImportAction': { rpc: ['organizationTools.importCommit'] }\" \$f &&
  grep -qF \"#discardImportAction': { rpc: ['organizationTools.importDiscard'] }\" \$f && grep -qF \"#withdrawClaimAction': { rpc: ['organizationTools.withdrawClaim'] }\" \$f &&
  grep -qF \"#leaveOrganizationAction': { rpc: ['organizationTools.leave'] }\" \$f"
check "the authorization matrix has the M24 rows (another organization's admin: 404)" bash -c "f=src/server/rpc/authz-matrix.int.test.ts;
  for p in imports claims analytics heatmap importGet importCommit importDiscard; do grep -qF \"'\$p'\" \$f || exit 1; done;
  for p in organizationTools.importPreview organizationTools.withdrawClaim organizationTools.memberships organizationTools.leave; do grep -qF \"'\$p'\" \$f || exit 1; done;
  grep -qF 'path: \`organizationTools.\${name}\`' \$f"
refute "no 'use cache' in the M24 services or pages" grep -n "'use cache'" "$IMPORT" "$CSV" "$INSIGHTS" "$SEPARATION" "$CORE" "${PAGES[@]}"

# 8. Decisions by default (CLAUDE.md §8) ---------------------------------------------------------------------
for n in 1 2 3 4 5 6 7 8 9 10; do
  check "DEFAULT M24 (question $n) is marked in the code" bash -c "grep -rqE 'DEFAULT M24[ ,(]+questions? ([0-9]+(, | and ))*$n\\b' src"
done
check "DEFAULT D12: no organization action writes a teaching relationship (marked)" grep -q 'DEFAULT D12' "$IMPORT"

# 9. The pages (In scope 7; CLAUDE.md §10, §11) -----------------------------------------------------------
refute "no window.open, no 100vh, no hover-only behaviour in the M24 pages" grep -nE "window\.open|100vh|group-hover:|onMouseEnter|target=\"_blank\"" "${PAGES[@]}"
refute "no countdown, urgency or blame in the M24 pages" grep -nEi "\b(hurry|urgent|last chance|don.t miss|act now)\b|spots? left|only [0-9]+ left" "${PAGES[@]}"
check "a row's outcome is in words and a mark, never colour alone" grep -q 'row.statusLabel' 'src/app/dashboard/organization/[id]/import/[importId]/page.tsx'
check "names are rendered with lang and translate=no" bash -c "f='src/app/dashboard/organization/[id]/import/[importId]/page.tsx'; grep -q 'lang=\"und-Latn\" translate=\"no\"' \"\$f\" && grep -q 'lang=\"zh-Hant\" translate=\"no\"' \"\$f\""
check "the new screens are screen states" bash -c "f=e2e/screenshots.spec.ts; grep -qF 'name: \`organization-\${tool}\`' \$f && grep -qF \"name: 'organization-import-preview'\" \$f"

# 10. E2E and integration titles (Done when 3) -----------------------------------------------------------------
check "E2E describe is tagged @M24" grep -qF "test.describe('@M24 organization tools'" "$SPEC"
e2e_titles=(
  'a checked file is imported only on confirmation, as private records and claims'
  'a preview can be discarded and imports nothing'
  'analytics are counts, and the heatmap never shows a school’s point'
  'a member leaves on their own; the organization keeps no record of them'
  'an account that administers no organization gets "not found" for every tool'
)
for t in "${e2e_titles[@]}"; do
  check "E2E test: $t" grep -qF "$t" "$SPEC"
done
check "the E2E runs axe in both themes and checks 44 px targets on a phone" bash -c "
  grep -q 'expectNoAxeViolations' $SPEC && grep -q 'for (const theme of THEMES)' $SPEC && grep -q 'toBeGreaterThanOrEqual(44)' $SPEC && grep -q \"startsWith('mobile')\" $SPEC"
check "the E2E changes no public page, so it runs in the desktop and phone projects" bash -c "! grep -q 'm24-organization-tools' e2e/projects.ts"
int_titles=(
  'previews per-row errors, then imports private unclaimed records with claims that are never relationships'
  'refuses a broken file, needs Federation, and allows ten previews a day'
  'an expired preview cannot be committed and keeps no names; discard clears a preview too'
  "another organization's admin, a member and staff get 404 for its imports, claims, analytics and heatmap"
  'counts the own records and public states only, and is gone with the plan'
  "at their cities' centres, never a school's own point"
  'a member leaves alone: the history and every relationship stay, the organization’s fields and claims go, the admins are told'
  'the organization ends a membership: the member’s account is told, the record and relationships stay'
)
for t in "${int_titles[@]}"; do
  check "integration test: $t" grep -qF "$t" "$INT"
done
unit_titles=(
  'reads quoted fields with separators, doubled quotes and line breaks, CRLF and LF'
  'reads the template with a byte-order mark, in any case of the header, and never keeps the Email column'
  'refuses an empty file, a file without First_Name, a repeated column, no rows, too many rows, too many bytes and text that is not UTF-8'
  'names the column of every problem'
)
for t in "${unit_titles[@]}"; do
  check "unit test: $t" grep -qF "$t" "$UNIT"
done
refute "only fictional names in the M24 tests (D20): every person name starts with Demo" grep -nE "^(First_Name|[A-Z][a-z]+),[A-Z][a-z]+ " "$SPEC" "$INT" "$UNIT"

# 11. Documentation (In scope 10) -------------------------------------------------------------------------------
check "ADR 0027 records the import, the claims, the heatmap, separation and the defaults" bash -c "
  f=docs/adr/0027-organization-tools.md; grep -q 'DEFAULT M24' \"\$f\" && grep -q 'organization_teacher_claim' \"\$f\" && grep -q 'HEATMAP_MIN_SCHOOLS' \"\$f\" && grep -q 'separateMembership\\|separation' \"\$f\" && grep -q 'organizationTools' \"\$f\""
check "questions/M24.md has questions, each with a proposed default" bash -c "
  f=docs/plan/questions/M24.md; n=\$(grep -c '^## 2026-' \"\$f\"); [ \"\$n\" -ge 10 ] && [ \"\$(grep -c '^\\*\\*Proposed default:\\*\\*' \"\$f\")\" -ge \"\$n\" ]"
check "docs/data-model.md describes the tables and the M24 migration" bash -c "f=docs/data-model.md; for t in ${TABLES[*]}; do grep -q \"\$t\" \"\$f\" || exit 1; done; grep -q '_m24_organization_tools' \"\$f\""
check "the user guide covers the import, the claims, analytics, the heatmap and leaving" bash -c "f=docs/guides/user-guide.bg.md; grep -q '(M24' \"\$f\" && grep -q 'Check the file' \"\$f\" && grep -q 'Claimed by the organization, not verified' \"\$f\" && grep -q 'School heatmap' \"\$f\" && grep -q 'Your memberships' \"\$f\""
check "the admin guide covers the import limits, retention, the heatmap and separation" bash -c "
  f=docs/guides/admin-guide.bg.md; grep -q '(M24)' \"\$f\" && grep -q 'expireOrganizationImports\\|retention.purge' \"\$f\" && grep -q 'organizationTools.heatmap' \"\$f\" && grep -q 'separateMembership' \"\$f\""
check "docs/plan/README.md has a status for M24" bash -c 'grep -qE "^\| M24 " docs/plan/README.md && ! grep -qE "^\| M24 .*\| не е започнат \|$" docs/plan/README.md'
check "the technical plan §8.3 has the M24 row" grep -qE '^\| M24 \| \[`docs/plan/M24-organization-tools.md`\]' docs/WingChunRoots_Technical_Plan.bg.md
check "the milestone file has a Progress log with entries" bash -c "awk '/^## Дневник на напредъка/{f=1;next} f && /^- /{n++} END{exit !(n>0)}' docs/plan/M24-organization-tools.md"
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  for guide in docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md; do
    check "$guide changed in this branch (differs from the merge base with origin/main)" bash -c "! git diff --quiet $base -- $guide"
  done
else
  ok "the guides changed in this branch: not checkable here (merged, or no origin/main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M24 checks: $failures failed"
  exit 1
fi
echo "M24 checks: all passed"
