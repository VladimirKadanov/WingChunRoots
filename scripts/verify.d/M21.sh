#!/usr/bin/env bash
# Milestone M21 checks (docs/plan/M21-trial-lessons.md, "Done when"), run by scripts/verify.sh
# after the unit tests (src/lib/bots.test.ts among them), the integration tests
# (src/server/services/trial-lessons.int.test.ts and the rows of the authorization matrix),
# db:check, db:reset+migrate+seed, the build and E2E (`@smoke|@M21`:
# e2e/m21-trial-lessons-view.spec.ts on the desktop and phone projects; e2e/m21-trial-lessons.spec.ts,
# which lists a school and sends, answers and counts a request, in the exclusive run). They stay
# valid after M21, so `scripts/verify.sh all` keeps running them.
#
# Here: required files, the one migration and its grants, the limits, the privacy rules, the
# statistics and their gate, retention, the procedures, the decisions by default, the UI rules, the
# demo data, the E2E and integration titles, and the documentation.
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

TRIAL=src/server/services/trial-lessons.ts
SCHEDULE=src/server/services/school-schedule.ts
STATS=src/server/services/school-stats.ts
RETENTION=src/server/services/retention.ts
COMMON=src/server/db/schema/common.ts
CATALOG=src/server/templates/catalog.ts
BEACON_ROUTE=src/app/api/school-stats/route.ts
BEACON=src/lib/school-beacon.ts
BOTS=src/lib/bots.ts
PUBLIC_PAGE='src/app/schools/[slug]/page.tsx'
TRIAL_PAGE='src/app/schools/[slug]/trial/page.tsx'
TRIAL_FORM='src/app/schools/[slug]/trial/trial-form.tsx'
OWN_LIST=src/app/dashboard/trial-lessons/page.tsx
INBOX='src/app/dashboard/schools/[id]/inquiries/page.tsx'
SCHEDULE_PAGE='src/app/dashboard/schools/[id]/schedule/page.tsx'
STATS_PAGE='src/app/dashboard/schools/[id]/stats/page.tsx'
SCHEDULE_VIEW=src/components/schools/school-schedule.tsx
STATUS_TAG=src/components/schools/trial-status.tsx
SPEC=e2e/m21-trial-lessons.spec.ts
VIEW_SPEC=e2e/m21-trial-lessons-view.spec.ts
INT=src/server/services/trial-lessons.int.test.ts
PAGES=("$PUBLIC_PAGE" "$TRIAL_PAGE" "$TRIAL_FORM" "$OWN_LIST" "$INBOX" "$SCHEDULE_PAGE" "$STATS_PAGE" "$SCHEDULE_VIEW" "$STATUS_TAG")
mapfile -t M21_SQL < <(ls drizzle/*_m21_trial_lessons/migration.sql 2>/dev/null)

# 1. Required files (Done when 4) ------------------------------------------------------------------
required=(
  "$TRIAL" "$SCHEDULE" "$STATS" "$BEACON_ROUTE" "$BEACON" "$BOTS" src/lib/bots.test.ts src/server/db/schema/trial-lessons.ts
  "${PAGES[@]}" src/components/account/load-errors/trial-lessons.ts "$SPEC" "$VIEW_SPEC" "$INT"
  docs/adr/0024-trial-lessons.md docs/plan/M21-trial-lessons.md docs/plan/questions/M21.md
  docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md docs/data-model.md docs/schools-and-map.md docs/entitlements.md
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done

# 2. One migration and its grants (In scope 1-3; plan §3.2) -----------------------------------------
check "exactly one M21 migration (m21_trial_lessons), with its snapshot" bash -c '
  [ "'"${#M21_SQL[@]}"'" -eq 1 ] && [ -s "$(dirname "'"${M21_SQL[0]:-none}"'")/snapshot.json" ]'
if [ "${#M21_SQL[@]}" -eq 1 ]; then
  SQL="${M21_SQL[0]}"
  check "the fees and the first-trial flag are columns of school, the fees at most 500 characters" bash -c "
    grep -q 'ADD COLUMN \"fees_text\" text' '$SQL' && grep -q 'ADD COLUMN \"first_trial_free\" boolean DEFAULT false NOT NULL' '$SQL' && grep -q 'school_fees_text_length' '$SQL'"
  check "the three tables: school_schedule_slot, trial_inquiry, school_stat_day" bash -c "
    grep -q 'CREATE TABLE \"school_schedule_slot\"' '$SQL' && grep -q 'CREATE TABLE \"trial_inquiry\"' '$SQL' && grep -q 'CREATE TABLE \"school_stat_day\"' '$SQL'"
  check "a slot is an ISO weekday and an end after its start" bash -c "grep -qF 'CHECK (\"weekday\" BETWEEN 1 AND 7)' '$SQL' && grep -qF 'CHECK (\"ends_at\" > \"starts_at\")' '$SQL'"
  check "the request states are a closed list, closed_at is empty exactly while open, the message at most 1000 characters" bash -c "
    grep -qF \"CHECK (\\\"status\\\" IN ('open', 'answered', 'declined', 'closed'))\" '$SQL' && grep -qF 'CHECK ((\"status\" = '\"'open'\"') = (\"closed_at\" IS NULL))' '$SQL' &&
    grep -qF 'char_length(\"message\") BETWEEN 1 AND 1000' '$SQL'"
  check "one open request per sender and school (partial unique index)" grep -qF "CREATE UNIQUE INDEX \"trial_inquiry_one_open_key\" ON \"trial_inquiry\" (\"school_id\",\"sender_user_id\") WHERE \"status\" = 'open'" "$SQL"
  check "the counters hold numbers only: no visitor, address, cookie or account column" bash -c "
    awk '/CREATE TABLE \"school_stat_day\"/{f=1} f{print} f && /^\\);/{exit}' '$SQL' > /tmp/m21-stat.\$\$ &&
    grep -q 'page_views' /tmp/m21-stat.\$\$ && ! grep -Eqi 'user_id|visitor|ip|cookie|agent|hash|fingerprint' /tmp/m21-stat.\$\$; rc=\$?; rm -f /tmp/m21-stat.\$\$; exit \$rc"
  check "app_rw reads and writes the tables; app_public_ro has no access" bash -c "
    grep -qF 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE \"school_schedule_slot\", \"trial_inquiry\", \"school_stat_day\" TO app_rw' '$SQL' &&
    grep -qF 'REVOKE ALL ON TABLE \"school_schedule_slot\", \"trial_inquiry\", \"school_stat_day\" FROM app_public_ro' '$SQL'"
  refute "the migration deletes nothing and stays on PostgreSQL 16+ (no uuidv7(), no virtual generated columns, no OLD/NEW in RETURNING)" \
    grep -nEi "uuidv7\(|VIRTUAL|RETURNING[^;]*\b(OLD|NEW)\.|DELETE FROM|DROP TABLE" "$SQL"
  refute "the migration leaves the public views alone" grep -n 'CREATE OR REPLACE VIEW' "$SQL"
fi

# 3. The limits (In scope 1, 2) ---------------------------------------------------------------------
check "the limits: 30 rows, 60-character labels, 500-character fees, 1000-character messages, 5 a day, 365 and 400 days, 12 weeks" bash -c "
  f=$COMMON; grep -q 'SCHOOL_SCHEDULE_MAX = 30' \$f && grep -q 'SCHOOL_SCHEDULE_LABEL_MAX = 60' \$f && grep -q 'SCHOOL_FEES_MAX = 500' \$f &&
  grep -q 'TRIAL_MESSAGE_MAX = 1000' \$f && grep -q 'TRIAL_DAILY_LIMIT = 5' \$f && grep -q 'TRIAL_INQUIRY_RETENTION_DAYS = 365' \$f &&
  grep -q 'SCHOOL_STATS_RETENTION_DAYS = 400' \$f && grep -q 'SCHOOL_STATS_WEEKS = 12' \$f"
check "a request is checked under an advisory lock for its sender, inside a transaction" bash -c "grep -q 'pg_advisory_xact_lock' $TRIAL && grep -q 'db.transaction' $TRIAL"
check "only at a school v_public_school shows" bash -c "grep -q 'v_public_school' $TRIAL && grep -q 'v_public_school' $STATS"
check "the refusals by name: unconfirmed, no_profile, own_school, open, limit" bash -c "
  for s in unconfirmed no_profile own_school open limit; do grep -q \"'\$s'\" $TRIAL || exit 1; done"

# 4. Privacy (CLAUDE.md §6; Constraints) -------------------------------------------------------------
refute "the services log no name, contact or message of a sender" grep -nE "logger\(\)\.(info|warn|error)\([^)]*(senderName|sender_name|contact|message|email|phone)" "$TRIAL" "$STATS" "$SCHEDULE" "$RETENTION" "$BEACON_ROUTE"
refute "no 'use cache' in the trial and stats services or the private pages" grep -n "'use cache'" "$TRIAL" "$STATS" "$TRIAL_PAGE" "$OWN_LIST" "$INBOX" "$SCHEDULE_PAGE" "$STATS_PAGE"
refute "the public DTO of a school carries nothing of a request" grep -nE "senderName|contactValue|preferredTimes|trialInquir" src/server/dto/schools.ts
refute "the beacon route logs nothing" grep -nE "logger|console\." "$BEACON_ROUTE"
check "the beacon route answers 204 only and reads at most 512 bytes" bash -c "grep -q 'status: 204' $BEACON_ROUTE && grep -q 'MAX_BODY = 512' $BEACON_ROUTE && ! grep -qE 'status: (200|400|403|404|500)' $BEACON_ROUTE"
check "the beacon sends through navigator.sendBeacon, with a keepalive fetch as fallback" bash -c "grep -q 'navigator.sendBeacon' $BEACON && grep -q 'keepalive: true' $BEACON"
check "headless browsers and crawlers count as bots" bash -c "grep -q 'headless' $BOTS && grep -q 'crawl' $BOTS"
check "the notices are in the schools category, e-mailed and opt-out" bash -c "
  for k in school.trial-requested school.trial-answered school.trial-declined; do grep -qF \"'\$k': mailed('schools', 'notice'),\" $CATALOG || exit 1; done"
check "the audit actions carry the new names" bash -c "f=src/server/audit/index.ts; for a in school.schedule_update trial.request trial.answer trial.decline trial.close; do grep -q \"'\$a'\" \$f || exit 1; done"

# 5. The schedule edit (In scope 1; DEFAULT D17) --------------------------------------------------------
check "a schedule edit is listing activity and drops the public cache of the schools" bash -c "grep -q 'ACTIVITY_RESET' $SCHEDULE && grep -q 'SCHOOLS_TAG' $SCHEDULE"
check "the public page DTO carries the schedule, the zone and the fees" bash -c "f=src/server/dto/schools.ts; grep -q 'schedule: z.array(schoolScheduleSlotSchema)' \$f && grep -q 'firstTrialFree: z.boolean()' \$f"

# 6. The statistics and their gate (In scope 3; plan §5.6; CLAUDE.md §11) --------------------------------
check "the statistics need school_business, now available; PLAN_MATRIX_VERSION 2026-11-10.1" bash -c "
  f=src/server/entitlements/plans.ts; grep -q \"PLAN_MATRIX_VERSION = '2026-11-10.1'\" \$f && grep -q \"requireEntitlement(.*'school_business'\" $STATS &&
  awk '/key: .school_business./{f=1} f && /availability: .now./{found=1} f && /^  \\},/{exit} END{exit !found}' \$f"
check "counting is an INSERT … ON CONFLICT DO UPDATE on the day" bash -c "grep -q 'onConflictDoUpdate\\|ON CONFLICT' $STATS"
check "the stats page: a hidden chart, a table in a focusable region, paging, the upgrade prompt" bash -c "
  f='$STATS_PAGE'; grep -q 'aria-hidden=\"true\"' \"\$f\" && grep -q 'role=\"region\"' \"\$f\" && grep -q 'tabIndex={0}' \"\$f\" && grep -q 'stats-earlier' \"\$f\" && grep -q 'stats-later' \"\$f\" && grep -q 'UpgradePrompt' \"\$f\""

# 7. Retention (In scope 2, 3) ---------------------------------------------------------------------------
check "purgeOldTrialData runs in retention.purge, in batches with SKIP LOCKED" bash -c "grep -q 'purgeOldTrialData' src/server/jobs/worker.ts && awk '/export async function purgeOldTrialData/{f=1} f{print}' $RETENTION | grep -q 'SKIP LOCKED'"

# 8. API first (In scope 4; plan §6.8) -------------------------------------------------------------------
check "the procedures: schools.schedule, updateSchedule, stats, track; trial.options, request, mine, inbox, answer, decline, close" bash -c "
  f=src/server/rpc/router.ts; awk '/^  trial: \\{/{f=1} f{print} f && /^  \\},/{exit}' \$f > /tmp/m21-trial.\$\$ &&
  for p in options request mine inbox answer decline close; do grep -q \"^    \$p: \" /tmp/m21-trial.\$\$ || { rm -f /tmp/m21-trial.\$\$; exit 1; }; done; rm -f /tmp/m21-trial.\$\$;
  for p in schedule updateSchedule stats track; do grep -q \"^    \$p: \" \$f || exit 1; done"
check "docs/api/openapi.json has the trial lesson and schedule paths" bash -c "f=docs/api/openapi.json; grep -qF '\"/trial-lessons/request\"' \$f && grep -qF '\"/schools/schedule/update\"' \$f && grep -qF '\"/schools/track\"' \$f"
check "the Server Actions are thin wrappers in the parity table" bash -c "f=src/server/rpc/parity.ts; grep -qF \"#requestTrialAction': { rpc: ['trial.request'] }\" \$f && grep -qF \"#decideTrialAction': { rpc: ['trial.answer', 'trial.decline', 'trial.close'] }\" \$f && grep -qF \"#updateScheduleAction': { rpc: ['schools.updateSchedule'] }\" \$f"
check "the authorization matrix has the M21 rows" bash -c "f=src/server/rpc/authz-matrix.int.test.ts; for p in trial.options trial.request trial.mine trial.inbox trial.answer trial.decline trial.close schools.schedule schools.updateSchedule schools.stats schools.track; do grep -q \"'\$p'\" \$f || exit 1; done"
for n in 1 2 3 4 5 6 7; do
  check "DEFAULT M21 (question $n) is marked in the code" bash -c "grep -rqE 'DEFAULT M21[ ,(]+questions? ([0-9]+(, | and ))*$n\\b' src"
done

# 9. The pages (In scope 1-3; CLAUDE.md §10) ---------------------------------------------------------------
check "the state of a request in words and a mark, never colour alone" bash -c "grep -q 'aria-hidden=\"true\"' $STATUS_TAG && grep -q '<TrialStatusTag' $OWN_LIST && grep -q '<TrialStatusTag' '$INBOX'"
check "without a session: \"Sign in to request a trial lesson\", back to the form" bash -c "grep -q 'Sign in to request a trial lesson' $SCHEDULE_VIEW && grep -q 'sign-in?next=' $SCHEDULE_VIEW"
check "the form says what the school will see" grep -q 'trial-privacy-notice' "$TRIAL_FORM"
check "the schedule names its time zone" grep -q 'timezone' "$SCHEDULE_VIEW"
refute "no window.open, no 100vh, no hover-only behaviour in the M21 pages" grep -nE "window\.open|100vh|group-hover:|onMouseEnter|target=\"_blank\"" "${PAGES[@]}"
refute "no countdown, urgency or blame in the M21 pages" grep -nEi "\b(hurry|urgent|last chance|don.t miss)\b|spots? left|only [0-9]+ left" "${PAGES[@]}"
check "the new pages are in e2e/routes.ts (axe in both themes); the form and the sender's list are key screens" bash -c "
  grep -q \"name: 'school-trial', status: 200, milestone: 'M21', key: true\" e2e/routes.ts && grep -q \"name: 'dashboard-trial-lessons', status: 200, milestone: 'M21', key: true\" e2e/routes.ts"
check "the owner's inbox, schedule and statistics are screen states" bash -c "f=e2e/screenshots.spec.ts; grep -qF \"(['inquiries', 'schedule', 'stats'] as const)\" \$f && grep -qF 'name: \`dashboard-school-\${screen}\`' \$f"

# 10. Demo data (In scope 5; D20) ---------------------------------------------------------------------------
check "the demo schedule, requests and counters: ids of their own, fixed dates" bash -c "
  f=src/fixtures/generate.ts; grep -q '(seed ^ 0x0e7e_0021)' \$f &&
  awk '/^function demoTrialLessons/{f=1} f{print} f && /^}/{exit}' \$f > /tmp/m21-demo.\$\$ &&
  grep -q 'Date.UTC(2026, 10, 8)' /tmp/m21-demo.\$\$ && ! grep -q 'new Date()' /tmp/m21-demo.\$\$; rc=\$?; rm -f /tmp/m21-demo.\$\$; exit \$rc"

# 11. E2E and integration titles (Done when 3) --------------------------------------------------------------
check "E2E test: a student requests, the owner answers, the student sees the reply" grep -qF '@M21 a student requests a trial lesson, the owner answers, the student sees the reply' "$SPEC"
check "E2E test: a Free Sifu's statistics show the upgrade prompt and no numbers" grep -qF '@M21 a Free Sifu sets a schedule without a plan, and the statistics show the upgrade prompt and no numbers' "$SPEC"
view_titles=(
  '@M21 the public page shows the schedule and fees, and the trial action by viewer'
  '@M21 the request form, with what the school will see; 44 px targets on a phone'
  '@M21 the senders see their own requests, with the state in words and the answer'
  "@M21 the owner's inbox, schedule and statistics of demo-school-sofia; 44 px targets on a phone"
)
for t in "${view_titles[@]}"; do
  check "E2E test: $t" grep -qF "$t" "$VIEW_SPEC"
done
check "the E2E runs axe in both themes and checks 44 px targets on a phone" bash -c "
  grep -q 'expectNoAxeViolations' $SPEC && grep -q 'for (const theme of THEMES)' $SPEC && grep -q 'toBeGreaterThanOrEqual(44)' $VIEW_SPEC && grep -q \"startsWith('mobile')\" $VIEW_SPEC"
check "the writing spec runs alone (PUBLIC_WRITE_SPECS), the view spec in the desktop and phone projects" bash -c "grep -q \"'\\*\\*/m21-trial-lessons.spec.ts'\" e2e/projects.ts && ! grep -q 'm21-trial-lessons-view' e2e/projects.ts"
int_titles=(
  'a confirmed adult with a profile sends one to a public school'
  'never at the own school, never without the sign-up confirmations or a profile, never at a school that is not public'
  'one open request per sender and school: a second waits until the first is answered'
  'a day, across schools'
  'the listing account and the admins of a linked organization see the inbox; the sender, others and staff get 404'
  'the sender is told of an answer (with the reply) and a decline (with the reason), never of a close'
  'the edit is listing activity and audited'
  'counts a visitor, never the listing account, staff, a bot or a school that is not public'
  'on Free Sifu no numbers and the upgrade offer'
  'deletes requests a year after they closed and counters older than 400 days, and nothing else'
  'demo-school-sofia has a schedule, fees, one open and one answered request, and weeks of counters'
)
for t in "${int_titles[@]}"; do
  check "integration test: $t" grep -qF "$t" "$INT"
done

# 12. Documentation (In scope 7) ---------------------------------------------------------------------------
check "ADR 0024 records the data, the procedures, the statistics and the defaults" bash -c "
  f=docs/adr/0024-trial-lessons.md; grep -q 'DEFAULT M21' \"\$f\" && grep -q 'trial_inquiry_one_open_key' \"\$f\" && grep -q 'school_business' \"\$f\" && grep -q 'purgeOldTrialData' \"\$f\" && grep -q 'school_stat_day' \"\$f\""
check "questions/M21.md has questions, each with a proposed default" bash -c "
  f=docs/plan/questions/M21.md; n=\$(grep -c '^## 2026-' \"\$f\"); [ \"\$n\" -ge 7 ] && [ \"\$(grep -c '^\\*\\*Proposed default:\\*\\*' \"\$f\")\" -ge \"\$n\" ]"
check "docs/data-model.md describes the tables and the M21 migration" bash -c "f=docs/data-model.md; grep -q 'trial_inquiry' \"\$f\" && grep -q 'school_stat_day' \"\$f\" && grep -q '_m21_trial_lessons' \"\$f\""
check "docs/schools-and-map.md has the M21 section" grep -q '(M21)' docs/schools-and-map.md
check "docs/entitlements.md has the new matrix version" grep -q '2026-11-10.1' docs/entitlements.md
check "the user guide covers the schedule and the trial requests" bash -c "f=docs/guides/user-guide.bg.md; grep -q '(M21)' \"\$f\" && grep -q 'Request a trial lesson' \"\$f\" && grep -q '/dashboard/trial-lessons' \"\$f\""
check "the admin guide covers retention, the statistics and the demo data" bash -c "
  f=docs/guides/admin-guide.bg.md; grep -q '(M21)' \"\$f\" && grep -q 'retention.purge' \"\$f\" && grep -q 'demo-school-sofia' \"\$f\""
check "docs/plan/README.md has a status for M21" bash -c 'grep -qE "^\| M21 " docs/plan/README.md && ! grep -qE "^\| M21 .*\| не е започнат \|$" docs/plan/README.md'
check "the technical plan §8.3 has the M21 row" grep -qE '^\| M21 \| \[`docs/plan/M21-trial-lessons.md`\]' docs/WingChunRoots_Technical_Plan.bg.md
check "the milestone file has a Progress log with entries" bash -c "awk '/^## Дневник на напредъка/{f=1;next} f && /^- /{n++} END{exit !(n>0)}' docs/plan/M21-trial-lessons.md"
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  for guide in docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md; do
    check "$guide changed in this branch (differs from the merge base with origin/main)" bash -c "! git diff --quiet $base -- $guide"
  done
else
  ok "the guides changed in this branch: not checkable here (merged, or no origin/main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M21 checks: $failures failed"
  exit 1
fi
echo "M21 checks: all passed"
