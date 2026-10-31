#!/usr/bin/env bash
# Milestone M09 checks (docs/plan/M09-teacher-requests.md, "Done when"), run by scripts/verify.sh
# after the unit tests (api-parity.test.ts, templates, partial dates, the recompute log), the
# integration tests (relationships.int.test.ts: every transition writes relationship_event and
# audit_log, the authorization matrix; cycle.int.test.ts: three concurrent approvals A→B, B→C, C→A
# give exactly two; revalidate.int.test.ts: the internal route refuses a request without the
# secret; relationships.api.int.test.ts: /api/v1 with a bearer session gives the same result and
# audit as the web form), db:check, db:reset+migrate+seed, the build and E2E (`@smoke|@M09`; the
# M09 spec runs in the exclusive run after the others, e2e/projects.ts).
# They stay valid after M09, so `scripts/verify.sh all` keeps running them (CI, M13).
#
# Here: required files, the procedures and their Server Actions, the order of the approval (plan
# §6.3) and the cycle check on the base table, the internal revalidation, the migration and the
# test database, the screens and their routes, the screenshots, the E2E titles, the decisions by
# default and the documentation (the user guide changed in this branch).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2
# shellcheck source=../lib/psql.sh
. scripts/lib/psql.sh

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

# grep_code <pattern> <file...>: grep -nE that ignores comments (SQL `--`, TypeScript `//` and
# `/* */` lines), so a comment that states a rule does not break it. Prints file:line:text; exit 1
# when nothing matches.
grep_code() {
  local pattern="$1"
  shift
  local f found=1
  for f in "$@"; do
    if sed -E -e 's/--.*$//' -e 's#(^|[[:space:]])//.*$##' -e 's#^[[:space:]]*/?\*.*$##' "$f" | grep -nE "$pattern" | sed "s|^|$f:|"; then
      found=0
    fi
  done
  return "$found"
}

mapfile -t M09_SQL < <(ls drizzle/*_m09_teacher_requests/migration.sql 2>/dev/null)
mapfile -t M09_UI < <(find src/app/dashboard/teachers src/app/dashboard/students src/components/relationships -type f -name '*.tsx' | sort)
SERVICE=src/server/services/relationships.ts

KEY_SCREENS=(teachers teachers-new student-requests)
STATES=(teachers-new-chosen teachers-new-palette student-requests-limit)
SIZES=(390x844 1440x900)
THEMES=(dark light)

# 1. Required files (Done when 2-4) ---------------------------------------------------------------
required=(
  "$SERVICE" src/server/services/relationships.int.test.ts src/server/services/cycle.int.test.ts
  src/server/services/relationships.api.int.test.ts src/server/services/relationships.test-support.ts
  src/server/revalidate.ts src/server/revalidate.int.test.ts src/app/api/internal/revalidate/route.ts
  src/server/jobs/lineage-recompute.ts src/server/jobs/lineage-recompute.test.ts src/server/rpc/api-parity.test.ts
  src/lib/partial-date.ts src/lib/partial-date.test.ts src/server/templates/relationships.ts
  src/server/templates/email/relationship-requested.tsx src/server/templates/email/relationship-approved.tsx
  src/server/templates/email/relationship-rejected.tsx src/server/templates/email/relationship-link.tsx
  src/app/dashboard/teachers/page.tsx src/app/dashboard/teachers/actions.ts src/app/dashboard/teachers/error.tsx
  src/app/dashboard/teachers/new/page.tsx src/app/dashboard/teachers/new/request-form.tsx src/app/dashboard/teachers/new/error.tsx
  src/app/dashboard/students/requests/page.tsx src/app/dashboard/students/requests/actions.ts src/app/dashboard/students/requests/error.tsx
  src/components/relationships/forms.tsx src/components/relationships/parts.tsx
  e2e/m09-requests.spec.ts docs/adr/0011-teacher-requests.md docs/plan/questions/M09.md scripts/verify.d/M09.sh
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done
check "directory exists and is not empty: docs/screenshots/M09/" bash -c '[ -d docs/screenshots/M09 ] && [ -n "$(ls -A docs/screenshots/M09)" ]'
check "the M09 migration exists (m09_teacher_requests)" test "${#M09_SQL[@]}" -eq 1

# 2. The procedures and their Server Actions (In scope 1, 3, 6, 7; plan §6.8) -----------------------
check "pnpm api:openapi --check: docs/api/openapi.json matches the router (log: .verify/M09-openapi.log)" bash -c '
  mkdir -p .verify && pnpm --silent api:openapi --check > .verify/M09-openapi.log 2>&1'
check "the contract has every relationships procedure: request, resubmit, approve, reject, withdraw, end (POST), mine, incoming, options, {id} (GET)" node -e "
  const p = require('./docs/api/openapi.json').paths || {};
  const posts = ['request', 'resubmit', 'approve', 'reject', 'withdraw', 'end'].every((n) => p['/relationships/' + n]?.post);
  const gets = ['mine', 'incoming', 'options', '{id}'].every((n) => p['/relationships/' + n]?.get);
  process.exit(posts && gets ? 0 : 1)"
check "the router serves the mutations through the services with the request meta" bash -c '
  f=src/server/rpc/router.ts
  for fn in requestTeacher resubmitRelationship approveRelationship rejectRelationship withdrawRelationship endRelationship; do
    grep -q "$fn(context.principal, input, context.meta)" "$f" || exit 1
  done'
check "every M09 Server Action is in the API parity table with its procedure" bash -c '
  f=src/server/rpc/parity.ts
  grep -q "teachers/actions.ts#requestTeacherAction'\'': { rpc: \['\''relationships.request'\''\] }" "$f" &&
  grep -q "teachers/actions.ts#resubmitRequestAction'\'': { rpc: \['\''relationships.resubmit'\''\] }" "$f" &&
  grep -q "teachers/actions.ts#withdrawRequestAction'\'': { rpc: \['\''relationships.withdraw'\''\] }" "$f" &&
  grep -q "teachers/actions.ts#endTrainingAction'\'': { rpc: \['\''relationships.end'\''\] }" "$f" &&
  grep -q "requests/actions.ts#approveRequestAction'\'': { rpc: \['\''relationships.approve'\''\] }" "$f" &&
  grep -q "requests/actions.ts#rejectRequestAction'\'': { rpc: \['\''relationships.reject'\''\] }" "$f"'
refute "the M09 pages and components never import src/server/db, and services only for their types" \
  bash -c "grep -rnE \"from ['\\\"]@/server/(services|db)\" src/app/dashboard/teachers src/app/dashboard/students src/components/relationships | grep -vE ':import type [^;]+ from .@/server/services/'"
refute "the M09 Server Actions import nothing from src/server/services or src/server/db (they call the procedures)" \
  grep -nE "from ['\"]@/server/(services|db)" src/app/dashboard/teachers/actions.ts src/app/dashboard/students/requests/actions.ts
check "every mutation takes an idempotency key (plan §5.6): request, resubmit and the action input that reject and end extend" bash -c '
  f='"$SERVICE"'
  for schema in requestInput resubmitInput relationshipActionInput; do
    awk "/^export const $schema = z.object\\(\\{/{on=1} on{print} on&&/^\\}\\);/{exit}" "$f" | grep -q "^  idempotencyKey,$" || exit 1
  done
  grep -q "^export const rejectInput = relationshipActionInput.extend" "$f" && grep -q "^export const endInput = relationshipActionInput.extend" "$f"'

# 3. The approval (In scope 3 and 4; plan §6.3) ------------------------------------------------------
check "the global lock is pg_advisory_xact_lock(hashtext('teaching_relationship.verify'))" bash -c '
  grep -qF "export const VERIFY_LOCK = '\''teaching_relationship.verify'\'';" '"$SERVICE"' &&
  grep -qF "pg_advisory_xact_lock(hashtext(\${VERIFY_LOCK}))" '"$SERVICE"''
check "the approval runs in order: the global lock, withQuota (approve_students), the cycle check, duplicate and self" bash -c '
  body="$(awk "/^export async function approveRelationship\\(/{on=1} on{print} on&&/^}/{exit}" '"$SERVICE"')"
  lock=$(printf "%s\n" "$body" | grep -n "pg_advisory_xact_lock" | head -1 | cut -d: -f1)
  quota=$(printf "%s\n" "$body" | grep -n "withQuota(" | head -1 | cut -d: -f1)
  ent=$(printf "%s\n" "$body" | grep -n "'\''approve_students'\''" | head -1 | cut -d: -f1)
  cycle=$(printf "%s\n" "$body" | grep -n "closesCycle(tx" | head -1 | cut -d: -f1)
  self=$(printf "%s\n" "$body" | grep -n "row.teacherPersonId === row.studentPersonId" | head -1 | cut -d: -f1)
  [ -n "$lock" ] && [ -n "$quota" ] && [ -n "$ent" ] && [ -n "$cycle" ] && [ -n "$self" ] &&
  [ "$lock" -lt "$quota" ] && [ "$quota" -lt "$cycle" ] && [ "$cycle" -lt "$self" ]'
check "the cycle check walks teaching_relationship by verified and in_arbitration" bash -c '
  body="$(awk "/^export async function closesCycle\\(/{on=1} on{print} on&&/^}/{exit}" '"$SERVICE"')"
  printf "%s\n" "$body" | grep -q "JOIN teaching_relationship tr" &&
  printf "%s\n" "$body" | grep -qF "tr.status IN ('\''verified'\'', '\''in_arbitration'\'')"'
refute "the cycle check never reads v_public_edge or v_public_person (Constraints)" \
  bash -c "awk '/^export async function closesCycle\\(/{on=1} on{print} on&&/^}/{exit}' $SERVICE | sed -E 's#//.*\$##' | grep -nE 'v_public_(edge|person)'"
check "approval: verified and public, relationship_event, audit relationship.approve, notifications and e-mails for both sides, lineage.recompute" bash -c '
  f='"$SERVICE"'
  grep -q "status: '\''verified'\'', visibility: '\''public'\''" "$f" && grep -q "action: '\''relationship.approve'\''" "$f" &&
  grep -q "template: '\''relationship.approved'\''" "$f" && grep -q "template: '\''relationship-approved'\''" "$f" &&
  grep -q "enqueue(tx, QUEUE.lineageRecompute" "$f" && grep -q "invalidatePublic(outcome.tags" "$f"'
check "both people become public on approval (UPDATE person ... visibility = public)" \
  grep -q "UPDATE person p SET visibility = 'public'" "$SERVICE"
check "every transition is audited: request, resubmit, approve, reject, withdraw, end" bash -c '
  for a in request resubmit approve reject withdraw end; do grep -q "action: '\''relationship.$a'\''" '"$SERVICE"' || exit 1; done &&
  for a in request resubmit approve reject withdraw end; do grep -q "'\''relationship.$a'\''" src/server/audit/index.ts || exit 1; done'
check "a request is pending_teacher and involved_only (DEFAULT D03)" bash -c '
  f='"$SERVICE"'
  grep -q "// DEFAULT D03: pending requests are involved_only." "$f" && grep -q "status: '\''pending_teacher'\''" "$f" && grep -q "visibility: '\''involved_only'\''" "$f"'
check "the rejection e-mail links to the resubmit form (/dashboard/teachers/new?resubmit=<id>)" bash -c '
  grep -qF "url(\`/dashboard/teachers/new?resubmit=\${row.id}\`)" '"$SERVICE"' &&
  grep -q "url: parseResubmitUrl(object.url)" src/server/templates/email/relationship-rejected.tsx'
check "ending a training keeps the link (no delete of teaching_relationship in the service)" bash -c '
  ! grep -qE "delete\(teachingRelationship\)|DELETE FROM teaching_relationship" '"$SERVICE"''
check "integration tests: events and audit per transition, the matrix, three concurrent approvals give two, the route refuses without the secret, /api/v1 bearer parity" bash -c '
  grep -q "every transition writes relationship_event and audit_log" src/server/services/relationships.int.test.ts &&
  grep -q "the authorization matrix (role × ownership)" src/server/services/relationships.int.test.ts &&
  grep -q "three concurrent approvals forming A→B, B→C, C→A give exactly two successes" src/server/services/cycle.int.test.ts &&
  grep -q "refuses a request without the secret" src/server/revalidate.int.test.ts &&
  grep -q "/api/v1 (bearer)" src/server/services/relationships.api.int.test.ts &&
  grep -qF "headers.set('\''authorization'\'', \`Bearer \${token}\`)" src/server/services/relationships.api.int.test.ts'

# 4. The internal revalidation (In scope 5; plan §6.4) ----------------------------------------------
check "POST /api/internal/revalidate calls revalidateTag(tag, 'max') behind the shared secret" bash -c '
  f=src/app/api/internal/revalidate/route.ts
  grep -q "export function POST" "$f" && grep -q "revalidateTag(tag, '\''max'\'')" "$f" && grep -q "handleRevalidate(request" "$f" &&
  grep -q "if (!hasRevalidateSecret(request, env)) return json(401" src/server/revalidate.ts && grep -q "timingSafeEqual" src/server/revalidate.ts'
check "the worker handles lineage.recompute and calls the internal route after each recompute" bash -c '
  grep -q "boss.work(QUEUE.lineageRecompute, work, lineageRecomputeHandler(db, log))" src/server/jobs/worker.ts &&
  grep -q "await revalidate(tags);" src/server/jobs/lineage-recompute.ts && grep -q "revalidateUrl()" src/server/jobs/lineage-recompute.ts'
check "lineage_membership is recomputed from the public views only" bash -c '
  body="$(awk "/^export async function recomputeLineageMembership\\(/{on=1} on{print} on&&/^}/{exit}" src/server/jobs/lineage-recompute.ts)"
  printf "%s\n" "$body" | grep -q "v_public_edge" && ! printf "%s\n" "$body" | grep -q "teaching_relationship"'
check ".env.example lists INTERNAL_REVALIDATE_SECRET and INTERNAL_APP_URL with no value" bash -c '
  grep -qx "INTERNAL_REVALIDATE_SECRET=" .env.example && grep -qx "INTERNAL_APP_URL=" .env.example'
check "src/proxy.ts still never runs for /api (the internal route included)" bash -c '
  ! grep -qE "matcher:.*api" src/proxy.ts'

# 5. The migration and the test database -------------------------------------------------------------
refute "the M09 migration is PostgreSQL 16 SQL (no uuidv7(), no virtual columns, no OLD/NEW in RETURNING)" \
  grep_code 'uuidv7\(|VIRTUAL|RETURNING[^;]*(OLD|NEW)\.' "${M09_SQL[@]}"
if [ -n "${TEST_DATABASE_URL:-}" ]; then
  facts="$(psql_url "$TEST_DATABASE_URL" -X -q -At -F ' ' -c "
    SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
             AND ((table_name = 'teaching_relationship' AND column_name = 'prefers_display_primary')
               OR (table_name = 'training_period' AND column_name = 'school_id')
               OR (table_name = 'relationship_event' AND column_name = 'idempotency_key'))),
           (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'relationship_event_idempotency_key'
             AND indexdef LIKE '%UNIQUE%'),
           (SELECT count(*) FROM pg_constraint WHERE conname = 'relationship_event_idempotency_key_format'),
           has_table_privilege('app_public_ro', 'public.relationship_event', 'SELECT')" 2>/dev/null)"
  check "the M09 columns exist: prefers_display_primary, training_period.school_id, relationship_event.idempotency_key" test "$(echo "$facts" | cut -d' ' -f1)" = "3"
  check "relationship_event has the unique (actor, idempotency key) index and the key format check" test "$(echo "$facts" | cut -d' ' -f2-3)" = "1 1"
  check "app_public_ro still cannot read relationship_event" test "$(echo "$facts" | cut -d' ' -f4)" = "f"
else
  bad "TEST_DATABASE_URL is not set: cannot check the M09 columns and indexes"
fi

# 6. Screens, routes and screenshots (Done when 4) ---------------------------------------------------
for path in /dashboard/teachers /dashboard/teachers/new /dashboard/students/requests; do
  check "route $path is in e2e/routes.ts (axe in both themes)" grep -q "path: '$path'" e2e/routes.ts
done
for screen in "${KEY_SCREENS[@]}"; do
  check "$screen is a key screen (visual regression and screenshots)" grep -qE "name: '$screen'.*milestone: 'M09', key: true" e2e/routes.ts
done
for state in "${STATES[@]}"; do
  check "screen state $state is in e2e/screenshots.spec.ts" grep -q "name: '$state'" e2e/screenshots.spec.ts
done
for screen in "${KEY_SCREENS[@]}" "${STATES[@]}"; do
  for size in "${SIZES[@]}"; do
    for theme in "${THEMES[@]}"; do
      check "screenshot: docs/screenshots/M09/$screen-$size-$theme.png" test -s "docs/screenshots/M09/$screen-$size-$theme.png"
    done
  done
done
refute "no 100vh in the M09 screens (dvh/svh only)" grep_code '100vh|h-screen' "${M09_UI[@]}"
refute "no window.open in the M09 screens" grep_code 'window\.open' "${M09_UI[@]}"
check "the upgrade prompt stands above the table of waiting requests, only at a real limit (incoming.upgrade)" bash -c '
  f=src/app/dashboard/students/requests/page.tsx
  up=$(grep -n "{incoming.upgrade ? (" "$f" | cut -d: -f1); table=$(grep -n "data-testid=\"student-requests\"" "$f" | cut -d: -f1)
  [ -n "$up" ] && [ -n "$table" ] && [ "$up" -lt "$table" ]'

# 7. E2E titles (Done when 2) -------------------------------------------------------------------------
titles=(
  '@M09 a student requests two teachers in different lineages; each approves separately; both edges become public'
  '@M09 a pending request is visible only to the student, the teacher and reviewers (profile, list view and API)'
  '@M09 a new request creates a teacher dashboard notification and an email with the student, the training start and a queue link'
  "@M09 an unrelated user's approve action is refused with no state change"
  "@M09 demo-free-sifu-5's sixth approval is blocked, the upgrade prompt appears and the request stays pending"
  '@M09 a rejection notifies the student with the neutral reason and a resubmit link; the student corrects and resubmits'
  '@M09 a claim that would create a cycle is refused with a clear message'
  '@M09 double-clicking Approve records one approval and sends one email'
  '@M09 a teacher marks training as ended and the relationship stays visible as historical'
  '@M09 request and approve a teacher at 390x844'
  "@M09 after an approval the teacher's public descendant count updates without waiting for cacheLife"
)
for title in "${titles[@]}"; do
  check "E2E test: $title" grep -qF "$title" e2e/m09-requests.spec.ts
done
check "the M09 spec runs in the exclusive run, after the others (PUBLIC_WRITE_SPECS)" bash -c '
  grep -qF "export const PUBLIC_WRITE_SPECS = ['\''**/m09-requests.spec.ts'\''] as const;" e2e/projects.ts &&
  grep -qF "export const EXCLUSIVE_SPECS: string[] = [EXCLUSIVE_SPEC, ...PUBLIC_WRITE_SPECS];" e2e/projects.ts &&
  grep -q "PW_EXCLUSIVE=1 pnpm e2e --pass-with-no-tests" scripts/verify.sh'

# 8. Decisions by default and documentation (In scope 10; docs/plan/RULES.md) ------------------------
for d in D03 D04 D05 D06; do
  check "DEFAULT $d is marked in the relationship service" grep -qE "DEFAULT [^:]*$d" "$SERVICE"
done
check "docs/adr/0011-teacher-requests.md records the transitions, the approval order, idempotency, the matrix and the defaults" bash -c '
  f=docs/adr/0011-teacher-requests.md
  grep -q "Статус" "$f" && grep -q "teaching_relationship.verify" "$f" && grep -q "idempotencyKey" "$f" && grep -q "v_public_edge" "$f" &&
  grep -q "/api/internal/revalidate" "$f" && for d in D03 D04/D13 D05 D06; do grep -q "DEFAULT $d" "$f" || exit 1; done'
check "docs/plan/questions/M09.md records the stop-and-ask question (the teacher never edits) with its default" bash -c '
  f=docs/plan/questions/M09.md
  grep -q "Does a teacher edit the periods of a request?" "$f" && grep -q "Proposed default:" "$f"'
check "docs/data-model.md describes prefers_display_primary, school_id, idempotency_key and lineage.recompute" bash -c '
  f=docs/data-model.md
  for w in prefers_display_primary school_id idempotency_key lineage.recompute; do grep -q "$w" "$f" || exit 1; done'
check "the user guide covers the request, approval and decline, resubmitting, withdrawing and the end of training, for both sides" bash -c '
  f=docs/guides/user-guide.bg.md
  grep -q "## Учители и ученици: заявки и одобрения (M09)" "$f" && grep -q "### Заявка към учител (ученикът)" "$f" &&
  grep -q "### Отказана заявка: поправете и изпратете отново" "$f" && grep -q "### Заявките на вашите ученици" "$f" &&
  grep -q "### Край на обучението" "$f" && grep -q "Withdraw request" "$f"'
check "the admin guide covers the internal revalidation and its secret" bash -c '
  f=docs/guides/admin-guide.bg.md
  grep -q "## 14. Заявки към учител и одобрения (M09)" "$f" && grep -q "INTERNAL_REVALIDATE_SECRET" "$f" && grep -q "INTERNAL_APP_URL" "$f"'
check "docs/plan/README.md has a status for M09" bash -c '! grep -qE "^\| M09 .*\| не е започнат \|$" docs/plan/README.md'
# Done when, item 4: the guide changes in the milestone's branch. Checkable while the branch is not
# merged and origin/main is known (not in a shallow CI checkout).
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  check "docs/guides/user-guide.bg.md changed in this branch (differs from the merge base with origin/main)" \
    bash -c "! git diff --quiet $base -- docs/guides/user-guide.bg.md"
else
  ok "the user guide changed in this branch: not checkable here (merged, or no origin/main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M09 checks: $failures failed"
  exit 1
fi
echo "M09 checks: all passed"
