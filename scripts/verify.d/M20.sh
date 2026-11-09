#!/usr/bin/env bash
# Milestone M20 checks (docs/plan/M20-school-activity.md, "Done when"), run by scripts/verify.sh
# after the unit tests (src/server/services/school-activity.test.ts: the dates of the stages and the
# words of the notices), the integration tests (src/server/services/school-activity.int.test.ts and
# the rows of the authorization matrix), db:check, db:reset+migrate+seed, the build and E2E
# (`@smoke|@M20`: e2e/m20-school-activity-view.spec.ts on the desktop and phone projects;
# e2e/m20-school-activity.spec.ts, which hides and shows a school, in the exclusive run). They stay
# valid after M20, so `scripts/verify.sh all` keeps running them.
#
# Here: required files, the one migration and the public view, the job and its idempotency, the
# privacy rules, restore, the procedures, the decisions by default, the UI rules, the demo data,
# the E2E and integration titles, and the documentation.
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

SERVICE=src/server/services/school-activity.ts
SCHOOLS=src/server/services/schools.ts
JOB=src/server/jobs/school-activity.ts
QUEUES=src/server/jobs/queues.ts
TEMPLATES=src/server/templates/notifications.ts
CATALOG=src/server/templates/catalog.ts
STATE=src/components/schools/activity-state.tsx
OWN_LIST=src/app/dashboard/schools/page.tsx
OWN_PAGE='src/app/dashboard/schools/[id]/page.tsx'
ADMIN_PAGE=src/app/admin/schools/page.tsx
SPEC=e2e/m20-school-activity.spec.ts
VIEW_SPEC=e2e/m20-school-activity-view.spec.ts
INT=src/server/services/school-activity.int.test.ts
UNIT=src/server/services/school-activity.test.ts
mapfile -t M20_SQL < <(ls drizzle/*_m20_school_activity/migration.sql 2>/dev/null)

# 1. Required files (Done when 5) ------------------------------------------------------------------
required=(
  "$SERVICE" "$JOB" "$STATE" "$ADMIN_PAGE" src/components/account/load-errors/admin-schools.ts "$SPEC" "$VIEW_SPEC" "$INT" "$UNIT"
  docs/adr/0023-school-activity.md docs/plan/M20-school-activity.md docs/plan/questions/M20.md
  docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md docs/data-model.md docs/schools-and-map.md
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done

# 2. One migration and the public view (In scope 1; plan §3.2) -------------------------------------
check "exactly one M20 migration (m20_school_activity), with its snapshot" bash -c '
  [ "'"${#M20_SQL[@]}"'" -eq 1 ] && [ -s "$(dirname "'"${M20_SQL[0]:-none}"'")/snapshot.json" ]'
if [ "${#M20_SQL[@]}" -eq 1 ]; then
  SQL="${M20_SQL[0]}"
  check "the stage and its two timestamps are columns of school, current by default" bash -c "
    grep -q 'ADD COLUMN \"activity_stage\" text DEFAULT '\"'current'\"' NOT NULL' '$SQL' &&
    grep -q 'ADD COLUMN \"activity_awaiting_since\" timestamp with time zone' '$SQL' && grep -q 'ADD COLUMN \"activity_hidden_at\" timestamp with time zone' '$SQL'"
  check "each stage carries exactly its timestamps (CHECK), and the stages are a closed list" bash -c "
    grep -q 'school_activity_stage_times' '$SQL' && grep -qF \"CHECK (\\\"activity_stage\\\" IN ('current', 'awaiting_confirmation', 'hidden'))\" '$SQL'"
  check "a partial index for the daily job over the listed schools of an account" grep -qF 'CREATE INDEX "school_activity_check_idx" ON "school" ("activity_stage","last_activity_at") WHERE "status" = '"'active'"' AND "deleted_at" IS NULL AND "created_by_user_id" IS NOT NULL' "$SQL"
  check "v_public_school (security_barrier) leaves out a hidden school" bash -c "
    awk '/CREATE OR REPLACE VIEW \"v_public_school\"/{f=1} f{print} f && /;/{exit}' '$SQL' > /tmp/m20-view.\$\$ &&
    grep -q 'security_barrier = true' /tmp/m20-view.\$\$ && grep -qF \"s.\\\"activity_stage\\\" <> 'hidden'\" /tmp/m20-view.\$\$; rc=\$?; rm -f /tmp/m20-view.\$\$; exit \$rc"
  refute "the migration deletes nothing and stays on PostgreSQL 16+ (no uuidv7(), no virtual generated columns, no OLD/NEW in RETURNING)" \
    grep -nEi "uuidv7\(|VIRTUAL|RETURNING[^;]*\b(OLD|NEW)\.|DELETE FROM|DROP TABLE" "$SQL"
fi

# 2b. The schema matches -----------------------------------------------------------------------------
check "the thresholds: 90 days, 105 days, 14 days between the request and the hiding" bash -c "
  f=src/server/db/schema/common.ts; grep -q 'SCHOOL_AWAITING_DAYS = 90' \$f && grep -q 'SCHOOL_HIDDEN_DAYS = 105' \$f && grep -q 'SCHOOL_CONFIRM_GRACE_DAYS = SCHOOL_HIDDEN_DAYS - SCHOOL_AWAITING_DAYS - 1' \$f"

# 3. The daily job (In scope 2; DEFAULT D17) ---------------------------------------------------------
check "schools.activity is a queue with a daily schedule at 05:23 UTC, registered in the worker" bash -c "
  grep -q \"schoolsActivity: 'schools.activity'\" $QUEUES && grep -qF \"{ queue: QUEUE.schoolsActivity, cron: '23 5 * * *' }\" $QUEUES &&
  grep -q 'schoolActivityHandler' src/server/jobs/worker.ts"
check "ages come from the database clock; each school moves in its own transaction with a conditional UPDATE" bash -c "
  grep -qF ': sql\`now()\`' $SERVICE && grep -q 'db.transaction' $SERVICE && grep -q 'RETURNING' $SERVICE"
check "a notice key per school, stage and period without activity" bash -c "
  grep -qF 'school.activity-awaiting:\${row.id}:' $SERVICE && grep -qF 'school.activity-hidden:\${row.id}:' $SERVICE"
check "hiding waits SCHOOL_CONFIRM_GRACE_DAYS after the request" grep -q 'SCHOOL_CONFIRM_GRACE_DAYS' "$SERVICE"
check "the organization admins are told (accepted links, active organizations)" bash -c "grep -q 'organization_school' $SERVICE && grep -q \"'accepted'\" $SERVICE"
check "after hiding the job drops the schools cache through the internal route, which expires it at once" bash -c "
  grep -q 'SCHOOLS_TAG' $SERVICE && grep -q 'SCHOOLS_TAG' src/server/revalidate.ts && grep -qF 'revalidateTag(tag, { expire: 0 })' src/app/api/internal/revalidate/route.ts"
check "the audit actions of the job" bash -c "grep -q \"'school.activity_awaiting'\" src/server/audit/index.ts && grep -q \"'school.activity_hidden'\" src/server/audit/index.ts"
check "the notices are in the schools category, e-mailed and opt-out" bash -c "
  grep -qF \"'school.activity-awaiting': mailed('schools', 'notice'),\" $CATALOG && grep -qF \"'school.activity-hidden': mailed('schools', 'notice'),\" $CATALOG"

# 4. Privacy (CLAUDE.md §6, §11) -----------------------------------------------------------------------
refute "the job and its service log counts and ids only (no name, point or e-mail)" grep -nE "logger\(\)\.(info|warn|error)\([^)]*(name|point|email|lat|lng)" "$SERVICE" "$JOB"
refute "no 'use cache' in the activity service or the owner's and staff's pages" grep -n "'use cache'" "$SERVICE" "$ADMIN_PAGE" "$OWN_PAGE" "$OWN_LIST"
refute "no exact point in the staff list" grep -nE "exact_point|exactPoint|public_point|publicPoint|contact_email|contactEmail" "$ADMIN_PAGE"
refute "no countdown, urgency or blame in the notices and the pages" grep -nEi "\b(hurry|urgent|last chance|don.t miss|immediately)\b|days? left|only [0-9]+ days" "$TEMPLATES" "$OWN_PAGE" "$OWN_LIST" "$ADMIN_PAGE"
refute "hiding is never done with CSS" grep -nE "activity[^\n]*(hidden\b.*className|display: ?none)" "$OWN_LIST" "$ADMIN_PAGE"

# 5. Restore (In scope 4; DEFAULT D17, D18) -------------------------------------------------------------
check "confirm, submit and a real edit reset the stage (ACTIVITY_RESET)" bash -c "[ \"\$(grep -c '\\.\\.\\.ACTIVITY_RESET' $SCHOOLS)\" -ge 3 ]"
check "the pin state knows a school hidden by the check" grep -q "'activity_hidden'" "$SCHOOLS"
for d in D17 D18; do
  check "DEFAULT $d is marked in the code" bash -c "grep -rq 'DEFAULT $d' $SERVICE $SCHOOLS"
done

# 6. API first (In scope 7; plan §6.8) -------------------------------------------------------------------
check "schools.adminList is a procedure for staff with a second factor" bash -c "awk '/^  schools: \\{/{f=1} f && /^    adminList: staffWithSecondFactor/{found=1} f && /^  \\},/{exit} END{exit !found}' src/server/rpc/router.ts"
check "docs/api/openapi.json has /admin/schools and the activity of the owner's views" bash -c "grep -qF '\"/admin/schools\"' docs/api/openapi.json && grep -q 'awaiting_confirmation' docs/api/openapi.json"
check "the confirmation stays a thin Server Action in the parity table" grep -qF "'src/app/dashboard/schools/actions.ts#confirmSchoolAction': { rpc: ['schools.confirm'] }" src/server/rpc/parity.ts
check "the authorization matrix has the M20 rows" bash -c "f=src/server/rpc/authz-matrix.int.test.ts; grep -q \"'schools.adminList'\" \$f && grep -q 'hidden by the activity check' \$f"
check "/admin/schools is a staff route with a second factor" grep -qF "'/admin/schools': { kind: 'staff2fa', roles: ['moderator', 'admin'] }" src/server/auth/guards.ts

# 7. The pages (In scope 5, 6; CLAUDE.md §10) ------------------------------------------------------------
check "the stage in words and a mark, never colour alone" bash -c "grep -q 'export function ActivityMark' $STATE && grep -q 'aria-hidden=\"true\"' $STATE && grep -q '<ActivityState' $OWN_LIST && grep -q '<ActivityState' $OWN_PAGE && grep -q '<ActivityState' $ADMIN_PAGE"
check "the owner's page: the date and one primary \"This listing is current\"; the note for a Free Sifu" bash -c "
  grep -q 'Hidden from the map since' '$OWN_PAGE' && grep -q 'Awaiting confirmation since' '$OWN_PAGE' && grep -q 'label=\"This listing is current\"' '$OWN_PAGE' &&
  grep -qF \"variant={activity.stage === 'current' ? 'secondary' : 'primary'}\" '$OWN_PAGE' && grep -q 'A public pin also needs Professional Sifu' '$OWN_PAGE'"
check "the staff page: a filter by stage with links and aria-current, and a link from /admin" bash -c "
  grep -q 'aria-current' $ADMIN_PAGE && grep -q 'stage=' $ADMIN_PAGE && grep -q 'admin-schools-link' src/app/admin/page.tsx"
check "44 px targets on the new controls" bash -c "grep -q 'min-h-11' $ADMIN_PAGE && grep -q 'min-h-11' $OWN_LIST"
refute "no window.open, no 100vh, no hover-only behaviour in the M20 pages" grep -nE "window\.open|100vh|group-hover:|onMouseEnter|target=\"_blank\"" "$ADMIN_PAGE" "$STATE" "$OWN_PAGE" "$OWN_LIST"
check "the pages are in e2e/routes.ts (axe in both themes); the owner's list and the staff page are key screens" bash -c "
  grep -q \"path: '/dashboard/schools', name: 'dashboard-schools-activity', status: 200, milestone: 'M20', key: true\" e2e/routes.ts &&
  grep -q \"path: '/admin/schools', name: 'admin-schools', status: 200, milestone: 'M20', key: true\" e2e/routes.ts &&
  grep -q \"name: 'admin-schools-hidden'\" e2e/routes.ts"
check "the owner's pages of the demo schools are screen states" grep -q 'name: `dashboard-school-${stage}`' e2e/screenshots.spec.ts

# 8. Demo data (In scope 8; D20) -------------------------------------------------------------------------
check "the demo schools: fixed dates, ids of their own, fictional" bash -c "
  f=src/fixtures/generate.ts; grep -q \"awaiting: 'demo-school-awaiting-birmingham'\" \$f && grep -q \"hidden: 'demo-school-hidden-munich'\" \$f && grep -q '(seed ^ 0x0e7e_0020)' \$f &&
  awk '/^function demoSchoolActivity/{f=1} f{print} f && /^}/{exit}' \$f > /tmp/m20-demo.\$\$ &&
  grep -q 'FICTIONAL_MARK' /tmp/m20-demo.\$\$ && grep -q 'school.activity-hidden' /tmp/m20-demo.\$\$ && ! grep -q 'new Date()' /tmp/m20-demo.\$\$; rc=\$?; rm -f /tmp/m20-demo.\$\$; exit \$rc"

# 9. E2E and integration titles (Done when 3) --------------------------------------------------------------
check "E2E test: the owner sees \"Hidden from the map\", confirms and the pin comes back" grep -qF '@M20 the owner sees "Hidden from the map", confirms with "This listing is current" and the pin comes back' "$SPEC"
view_titles=(
  '@M20 the seeded awaiting school stays public, the hidden one is off every public answer'
  '@M20 the owner sees each stage in words, a mark and its date, with "This listing is current"; 44 px targets on a phone'
  '@M20 the staff page lists the stages and filters them by keyboard'
)
for t in "${view_titles[@]}"; do
  check "E2E test: $t" grep -qF "$t" "$VIEW_SPEC"
done
check "the E2E runs axe in both themes and checks 44 px targets on a phone" bash -c "
  grep -q 'expectNoAxeViolations' $SPEC && grep -q 'for (const theme of THEMES)' $SPEC && grep -q 'toBeGreaterThanOrEqual(44)' $VIEW_SPEC && grep -q \"startsWith('mobile')\" $VIEW_SPEC"
check "the writing spec runs alone (PUBLIC_WRITE_SPECS), the view spec in the desktop and phone projects" bash -c "grep -q \"'\\*\\*/m20-school-activity.spec.ts'\" e2e/projects.ts && ! grep -q 'm20-school-activity-view' e2e/projects.ts"
int_titles=(
  'day 89 stays current; day 90 awaits confirmation'
  'day 104 stays awaiting; day 105 hides the pin and the listing and keeps the school'
  'a run that missed days asks first and hides only after the grace period'
  'reruns, a retried job and two runs at once change nothing more'
  'a confirmation that commits while the job runs wins'
  'ages come from the database clock'
  'the admins of an organization the school accepted are told on day 90'
  '"This listing is current" shows a hidden school again with Professional Sifu'
  "without the entitlement: a Free Sifu's confirmation is recorded and unlocks no pin"
  'signing in never counts as activity'
  'the finder, the map, the page, search, the sitemap and app_public_ro do not have it'
)
for t in "${int_titles[@]}"; do
  check "integration test: $t" grep -qF "$t" "$INT"
done
check "the unit test of the dates and the notices" bash -c "grep -qF 'never hides less than 14 days after a late request' $UNIT && grep -qF 'carries no countdown, urgency or blame' $UNIT"

# 10. Documentation (In scope 10) ---------------------------------------------------------------------------
check "ADR 0023 records the stage, the job, restore and the defaults" bash -c "
  f=docs/adr/0023-school-activity.md; grep -q 'D17' \"\$f\" && grep -q 'D18' \"\$f\" && grep -q 'v_public_school' \"\$f\" && grep -q 'schools.activity' \"\$f\" && grep -q 'activity_stage' \"\$f\""
check "questions/M20.md has questions, each with a proposed default" bash -c "
  f=docs/plan/questions/M20.md; n=\$(grep -c '^## 2026-' \"\$f\"); [ \"\$n\" -ge 5 ] && [ \"\$(grep -c '^\\*\\*Proposed default:\\*\\*' \"\$f\")\" -ge \"\$n\" ]"
check "docs/data-model.md describes the stage, the view and the M20 migration" bash -c "f=docs/data-model.md; grep -q 'activity_stage' \"\$f\" && grep -q '_m20_school_activity' \"\$f\""
check "docs/schools-and-map.md has the activity check" bash -c "grep -q 'Проверка за активност (M20)' docs/schools-and-map.md && grep -q 'This listing is current' docs/schools-and-map.md"
check "the user guide covers the activity check" bash -c "f=docs/guides/user-guide.bg.md; grep -q '(M20)' \"\$f\" && grep -q 'This listing is current' \"\$f\" && grep -q 'Hidden from the map since' \"\$f\""
check "the admin guide covers the job, the staff page and the demo schools" bash -c "
  f=docs/guides/admin-guide.bg.md; grep -q '(M20)' \"\$f\" && grep -q '/admin/schools' \"\$f\" && grep -q '05:23 UTC' \"\$f\" && grep -q 'demo-school-hidden-munich' \"\$f\""
check "docs/plan/README.md has a status for M20" bash -c 'grep -qE "^\| M20 " docs/plan/README.md && ! grep -qE "^\| M20 .*\| не е започнат \|$" docs/plan/README.md'
check "the technical plan §8.3 has the M20 row" grep -qE '^\| M20 \| \[`docs/plan/M20-school-activity.md`\]' docs/WingChunRoots_Technical_Plan.bg.md
check "the milestone file has a Progress log with entries" bash -c "awk '/^## Дневник на напредъка/{f=1;next} f && /^- /{n++} END{exit !(n>0)}' docs/plan/M20-school-activity.md"
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  for guide in docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md; do
    check "$guide changed in this branch (differs from the merge base with origin/main)" bash -c "! git diff --quiet $base -- $guide"
  done
else
  ok "the guides changed in this branch: not checkable here (merged, or no origin/main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M20 checks: $failures failed"
  exit 1
fi
echo "M20 checks: all passed"
