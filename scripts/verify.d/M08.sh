#!/usr/bin/env bash
# Milestone M08 checks (docs/plan/M08-entitlements.md, "Done when"), run by scripts/verify.sh after
# the integration tests (quota.int.test.ts: ten concurrent approvals, one success;
# downgrade.int.test.ts: revoking Pro Sifu keeps the eight links; plans.int.test.ts: the services),
# the unit tests (plans.test.ts, requireEntitlement.test.ts, copy.no-fomo.test.ts, api-parity,
# templates), db:check, db:reset+migrate+seed, the build and E2E (`@smoke|@M08`: test plans, the
# upgrade prompt, /plans, the account type, the dashboards, axe on the new pages in both themes).
# They stay valid after M08, so `scripts/verify.sh all` keeps running them (CI, M13).
#
# Here: required files, the pinned table package and no payment package, the plan matrix and the
# rules of plan §5.6 and §6.5 in the code and in the test database, the screens and their routes,
# the screenshots, the E2E titles, the decisions by default, and the documentation (both guides
# changed in this branch).
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
mapfile -t M08_SQL < <(ls drizzle/*_m08_entitlements/migration.sql 2>/dev/null)
mapfile -t PLAN_UI < <(find src/components/plans src/app/plans src/app/dashboard src/app/admin/grants -type f -name '*.tsx' | sort)

KEY_SCREENS=(plans dashboard-sifu dashboard-student dashboard-settings)
STATES=(admin-grants dashboard-sifu-empty upgrade-requested upgrade-open dashboard-admin dashboard-admin-unverified pilot-request-close request-answered)
SIZES=(390x844 1440x900)
THEMES=(dark light)

# 1. Required files (Done when, items 2-4) -------------------------------------------------------
required=(
  src/server/entitlements/plans.ts src/server/entitlements/effective.ts src/server/entitlements/access.ts
  src/server/entitlements/quota.ts
  src/server/entitlements/plans.test.ts src/server/entitlements/requireEntitlement.test.ts
  src/server/entitlements/quota.int.test.ts src/server/entitlements/downgrade.int.test.ts
  src/lib/copy/no-fomo.ts src/lib/copy/copy.no-fomo.test.ts
  src/server/services/plans.ts src/server/services/grants.ts src/server/services/dashboard.ts
  src/server/services/notifications.ts src/server/services/plans.int.test.ts
  src/components/plans/upgrade-prompt.tsx src/server/services/account-lock.ts
  src/app/plans/page.tsx src/app/dashboard/page.tsx src/app/dashboard/notifications.tsx
  src/app/dashboard/settings/page.tsx src/app/admin/grants/page.tsx src/app/admin/grants/grants-table.tsx
  e2e/m08-entitlements.spec.ts e2e/helpers/plans.ts
  src/components/account/load-error.tsx src/app/dashboard/error.tsx src/app/dashboard/settings/error.tsx
  src/app/admin/grants/error.tsx e2e/m08-failures.exclusive.spec.ts src/server/rpc/form.test.ts
  e2e/helpers/next-error.ts e2e/next-error.test.ts e2e/next-error.spec.ts
  docs/entitlements.md docs/adr/0007-entitlements.md scripts/verify.d/M08.sh
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done
check "directory exists and is not empty: src/server/entitlements/" bash -c '[ -n "$(ls -A src/server/entitlements)" ]'
check "directory exists and is not empty: docs/screenshots/M08/" bash -c '[ -d docs/screenshots/M08 ] && [ -n "$(ls -A docs/screenshots/M08)" ]'
check "the M08 migration exists (m08_entitlements)" test "${#M08_SQL[@]}" -eq 1

# 2. Packages ------------------------------------------------------------------------------------
check "TanStack Table 9 is pinned exactly: @tanstack/table-core 9.3.1" node -e "
  const d = require('./package.json').dependencies || {};
  process.exit(d['@tanstack/table-core'] === '9.3.1' ? 0 : 1)"
check "out of scope stays out: no Stripe or other payment package" node -e "
  const p = require('./package.json');
  const d = { ...p.dependencies, ...p.devDependencies };
  process.exit(Object.keys(d).some((n) => /(^|\/|@)(stripe|paddle|braintree|lemonsqueezy|paypal)/i.test(n)) ? 1 : 0)"
check "THIRD_PARTY_NOTICES.md lists @tanstack/table-core (pnpm notices)" grep -q "@tanstack/table-core" THIRD_PARTY_NOTICES.md

# 3. The plan matrix, effectivePlan, requireEntitlement and quotas (In scope 1; plan §6.5) --------
check "plans.ts: five plans, a matrix version, availability now|planned" bash -c '
  f=src/server/entitlements/plans.ts
  grep -q "export const PLAN_MATRIX_VERSION = " "$f" && grep -q "export type Availability = '\''now'\'' | '\''planned'\''" "$f" &&
  for c in free_student premium_student free_sifu pro_sifu federation; do grep -q "code: '\''$c'\''" "$f" || exit 1; done'
check "effectivePlan() and requireEntitlement() are exported (access.ts)" bash -c '
  grep -q "export async function effectivePlan" src/server/entitlements/access.ts &&
  grep -q "export async function requireEntitlement" src/server/entitlements/access.ts'
check "withQuota() takes pg_advisory_xact_lock in the transaction of the write (quota.ts)" bash -c '
  grep -q "export async function withQuota" src/server/entitlements/quota.ts && grep -q "pg_advisory_xact_lock" src/server/entitlements/quota.ts'
check "quota.int.test.ts runs ten concurrent approvals for a Free Sifu with four students" bash -c '
  grep -qi "ten" src/server/entitlements/quota.int.test.ts && grep -q "sifuWith(4" src/server/entitlements/quota.int.test.ts'
check "downgrade.int.test.ts revokes the Pro Sifu test plan of demo-pro-sifu-8 and expects the quota refusal" bash -c '
  f=src/server/entitlements/downgrade.int.test.ts
  grep -q "demo-pro-sifu-8" "$f" && grep -q "code: '\''quota'\''" "$f"'
check "upgrade benefits list only features with availability now" \
  grep -qF "f.availability === 'now' && improves(f, from, to)" src/server/entitlements/plans.ts
check "ESLint lets routes and components read only the plan matrix of src/server/entitlements" bash -c '
  probe="import { requireEntitlement } from \"@/server/entitlements/access\";\nimport { PLANS } from \"@/server/entitlements/plans\";\nexport const x = [requireEntitlement, PLANS];\n"
  for target in src/app/m08-probe.tsx src/components/plans/m08-probe.tsx; do
    out="$(printf "$probe" | node_modules/.bin/eslint --stdin --stdin-filename "$target" 2>&1)"
    [ "$(printf "%s" "$out" | grep -c "no-restricted-imports")" -eq 1 ] || exit 1
  done'

# 4. Account type (In scope 2; DEFAULT D04/D13) ------------------------------------------------
check "account.type_change is audited; the unverified label is \"Instructor (unverified)\"" bash -c '
  grep -q "'\''account.type_change'\''" src/server/services/plans.ts &&
  grep -q "unverified: '\''Instructor (unverified)'\''" src/server/services/plans.ts'
check "/dashboard/settings posts through setAccountTypeAction to account.setType" bash -c '
  grep -q "account.setType" src/app/dashboard/settings/actions.ts && grep -q "setAccountTypeAction" src/app/dashboard/settings/forms.tsx'

# 5. /admin/grants (In scope 3) ----------------------------------------------------------------
check "/admin/grants is guarded by requireStaff2FA for admins (ROUTE_POLICIES)" \
  grep -qF "'/admin/grants': { kind: 'staff2fa', roles: ['admin'] }" src/server/auth/guards.ts
check "grants.list, grants.create and grants.revoke run behind adminWithSecondFactor" bash -c '
  f=src/server/rpc/router.ts
  for p in list create revoke; do grep -Eq "^    $p: adminWithSecondFactor$" "$f" || exit 1; done'
check "grant.create and grant.revoke are audited" bash -c '
  grep -q "'\''grant.create'\''" src/server/services/grants.ts && grep -q "'\''grant.revoke'\''" src/server/services/grants.ts'
check "the Server Actions of /admin/grants wrap grants.create and grants.revoke (API parity table)" bash -c '
  grep -q "createGrantAction.*grants.create" src/server/rpc/parity.ts && grep -q "revokeGrantAction.*grants.revoke" src/server/rpc/parity.ts &&
  grep -q "\.grants\.create(" src/app/admin/grants/actions.ts && grep -q "\.grants\.revoke(" src/app/admin/grants/actions.ts'
check "the grants table is built with TanStack Table 9 (table-core) on the server" bash -c '
  f=src/app/admin/grants/grants-table.tsx
  grep -q "from '\''@tanstack/table-core'\''" "$f" && grep -q "constructTable(" "$f" && ! grep -q "^'\''use client'\''" "$f"'
check "grants.closeRequest runs behind adminWithSecondFactor, is audited and has its Server Action (review round 2)" bash -c '
  grep -Eq "^    closeRequest: adminWithSecondFactor$" src/server/rpc/router.ts &&
  grep -q "'\''pilot_access.close'\''" src/server/services/grants.ts &&
  grep -q "closeRequestAction.*grants.closeRequest" src/server/rpc/parity.ts && grep -q "\.grants\.closeRequest(" src/app/admin/grants/actions.ts'
check "the requester of a pilot request and the open count need the second factor (hasStaff2FA, review round 2)" bash -c '
  grep -q "hasStaff2FA(p, \[.admin.\])" src/server/services/notifications.ts && grep -q "hasStaff2FA(p, \[.admin.\])" src/server/services/dashboard.ts'
check "the in-process oRPC client logs failures like the HTTP handlers (logProcedureFailure, review round 2)" \
  grep -q "interceptors: \[logProcedureFailure\]" src/server/rpc/server.ts
check "after its safe line, the in-process client throws a bare 500 without the cause (final check, security-1)" bash -c '
  f=src/server/rpc/failure-log.ts
  grep -q "throw internalServerError();" "$f" && grep -q "new ORPCError(.INTERNAL_SERVER_ERROR., { message: .Internal server error. })" "$f"'
check "/dashboard, /dashboard/settings and /admin/grants catch their reads and show the error state with a retry link (requirements-2)" bash -c '
  for f in src/app/dashboard/page.tsx src/app/dashboard/settings/page.tsx src/app/admin/grants/page.tsx; do
    grep -q "await pageRead(" "$f" && grep -q "<LoadError " "$f" && grep -q "retryHref=" "$f" || exit 1
  done
  for f in src/app/dashboard/error.tsx src/app/dashboard/settings/error.tsx src/app/admin/grants/error.tsx; do
    grep -q "retry={retry}" "$f" || exit 1
  done'
check "/account (M02) reads the unread count M08 added through pageRead() and renders without it when that read fails (polish, note 1)" bash -c '
  f=src/app/account/page.tsx
  grep -q "pageRead(client.notifications.list())" "$f" && grep -q "notifications?.unread ?? 0" "$f" &&
  ! grep -qE "[^(]client\.notifications\.list\(\)[^)]" "$f"'
check "scripts/verify.sh runs the specs that lock a table in a run of their own, after the others (PW_EXCLUSIVE)" bash -c '
  grep -q "PW_EXCLUSIVE=1 pnpm e2e --pass-with-no-tests" scripts/verify.sh && grep -q "exclusive: process.env.PW_EXCLUSIVE\|PW_EXCLUSIVE === '\''1'\''" playwright.config.ts &&
  ! grep -q "dependencies:" e2e/projects.ts'
check "every grant field is checked in the schema, so one parse reports every field (final check, screens-2)" bash -c '
  f=src/server/services/grants.ts
  grep -q "check(z.email({ error: GRANT_FIELD_ERRORS.email }))" "$f" && grep -q "min(1, { error: GRANT_FIELD_ERRORS.reason })" "$f" && grep -q "{ when: () => true }" "$f"'
check "an answered pilot access request says so in the notification and on /admin/grants (final check, screens-4)" bash -c '
  grep -q "The request has already been answered." src/server/templates/notifications.ts &&
  grep -q "answered" src/server/services/notifications.ts && grep -q "REQUEST_ANSWERED_TEXT" src/app/admin/grants/forms.tsx'
check "a removed profile (deleted_at) is anonymous in the dashboards and waits for nobody (final check, security-2)" bash -c '
  f=src/server/services/dashboard.ts
  grep -q "REMOVED_PROFILE_NAME = '\''A removed profile'\''" "$f" && grep -q "isNull(person.deletedAt)" "$f"'
# A number or a number word right next to "student(s)" ("up to five approved students", "the
# five-student limit", "5 students") or after a student limit ("a student limit of 5"), in the copy
# of the plan screens and in the plan matrix with its summaries (polish, note 2: plans.ts had
# escaped the first version of this check). Not "one": that is how a count of one reads ("One student
# request waits below"), never a limit.
NUMBER_WORD="[0-9]+|[Tt]wo|[Tt]hree|[Ff]our|[Ff]ive|[Ss]ix|[Ss]even|[Ee]ight|[Nn]ine|[Tt]en"
FREE_SIFU_LIMIT_WORDS="(^|[^0-9A-Za-z_\$])($NUMBER_WORD)(-| )((approved|verified|established|confirmed) )?[Ss]tudents?([^A-Za-z]|$)|[Ss]tudents? (limit|cap|quota) (of )?($NUMBER_WORD)([^0-9A-Za-z]|$)"
refute "the Free Sifu limit is not written out in the UI copy or the plan matrix: FREE_SIFU_STUDENT_LIMIT (final check, code-3; polish, note 2)" \
  grep_code "$FREE_SIFU_LIMIT_WORDS" "${PLAN_UI[@]}" src/server/entitlements/plans.ts src/server/services/plans.ts src/server/services/dashboard.ts src/server/templates/notifications.ts
check "the plan summaries name the Free Sifu limit through FREE_SIFU_STUDENT_LIMIT, marked DEFAULT D06 (polish, note 2)" bash -c '
  f=src/server/entitlements/plans.ts
  [ "$(grep -c "summary: \`.*\${FREE_SIFU_STUDENT_LIMIT}" "$f")" -eq 2 ] &&
  [ "$(grep -B1 "summary: \`.*\${FREE_SIFU_STUDENT_LIMIT}" "$f" | grep -c "// DEFAULT D06")" -eq 2 ]'
refute "the M08 Server Actions never rethrow a procedure error (formStateFromFailure after unstable_rethrow)" \
  grep_code "^\s*throw error;" src/app/admin/grants/actions.ts src/app/dashboard/settings/actions.ts src/app/dashboard/actions.ts
refute "revoking a plan never changes a relationship (no teaching_relationship write in grants.ts)" \
  grep_code "update\(teachingRelationship\)|delete\(teachingRelationship\)|UPDATE teaching_relationship|DELETE FROM teaching_relationship" src/server/services/grants.ts

# 6. The upgrade prompt (In scope 4; plan §5.6) --------------------------------------------------
check "the prompt has \"Proposed price (not final)\", \"Request pilot access\" and \"Not now\"" bash -c '
  grep -q "Proposed price (not final)" src/server/services/plans.ts &&
  grep -q "Request pilot access" src/components/plans/upgrade-prompt.tsx && grep -q ">\s*Not now\s*<\|Not now$" src/components/plans/upgrade-prompt.tsx'
check "\"Not now\" is a GET form that closes the prompt without JavaScript (final check, screens-1)" bash -c '
  f=src/components/plans/upgrade-prompt.tsx
  grep -q "<form action={notNowAction} method=\"get\">" "$f" && grep -q "name={UPGRADE_CLOSED_PARAM.name}" "$f" &&
  grep -q "notNowAction=\"/dashboard\"" src/app/dashboard/page.tsx'
check "\"Request pilot access\" and \"Not now\" share one button style (equally prominent)" bash -c '
  f=src/components/plans/upgrade-prompt.tsx
  [ "$(grep -c "className={actionClass}" "$f")" -eq 2 ]'
check "requestPilotAccess notifies the admins, is audited, is rate limited and never charges" bash -c '
  f=src/server/services/plans.ts
  grep -q "'\''pilot-access.requested'\''" "$f" && grep -q "'\''pilot_access.request'\''" "$f" &&
  grep -q "PILOT_REQUESTS_PER_WINDOW" "$f" && grep -q "TOO_MANY_REQUESTS" "$f" && grep -q "charged: false as const" "$f"'
refute "nothing is ticked in advance in the plan screens (no defaultChecked={true} or checked attribute)" \
  grep_code 'defaultChecked[[:space:]]*(=\{true\}|/?>|$)|[[:space:]]checked[[:space:]]*(=|/?>|$)' "${PLAN_UI[@]}"
refute "no countdown, timer or progress in the plan screens" \
  grep_code 'setInterval|role="timer"|<progress|<meter|[Cc]ountdown' "${PLAN_UI[@]}"
check "copy.no-fomo.test.ts proves its matcher on known-bad strings and scans the copy folders" bash -c '
  f=src/lib/copy/copy.no-fomo.test.ts
  grep -q "Only today" "$f" && grep -q "Hurry" "$f" && grep -q "Last chance" "$f" &&
  for d in src/app src/components src/server/templates; do grep -q "'\''$d'\''" "$f" || exit 1; done'
check "the no-FOMO scan reads an element without text of its own as a value, a <br /> as a space (M08 polish 2, note 2)" bash -c '
  f=src/lib/copy/copy.no-fomo.test.ts
  grep -q "if (ts.isJsxSelfClosingElement(child)) return emptyElement(child.tagName);" "$f" &&
  grep -qF "<p><Num n={n} /> days left</p>" "$f" && grep -qF "<p><Num n={n} /> <Unit /> left</p>" "$f" &&
  grep -qF "<p>{n} {unit}<br />left</p>" "$f"'

# 7. /plans (In scope 5) -------------------------------------------------------------------------
check "/plans shows Federation feature by feature, every value planned (final check, requirements-4)" bash -c '
  f=src/app/plans/page.tsx
  grep -q "data-testid=\"federation-features\"" "$f" && grep -q "<FederationFeatures catalog={catalog} plan={federation} />" "$f"'
check "/plans states the banner and marks planned features" bash -c '
  grep -q "Proposed prices — not final. Payments are not available during the pilot." src/server/services/plans.ts &&
  grep -q "Planned — not available yet" src/server/services/plans.ts && grep -q "plannedLabel" src/app/plans/page.tsx'
refute "/plans is static: it reads no session, cookies or headers" \
  grep_code "next/headers|guardRoute|cookies\(|headers\(|serverClient" src/app/plans/page.tsx

# 8. /dashboard (In scope 6) ---------------------------------------------------------------------
check "the dashboard has My teachers, My requests, Student requests and My schools, with empty states" bash -c '
  f=src/app/dashboard/page.tsx
  for t in "My teachers" "My requests" "Student requests" "My schools"; do grep -q "title=\"$t\"" "$f" || exit 1; done
  for t in empty-teachers empty-requests empty-student-requests empty-schools; do grep -q "testId=\"$t\"" "$f" || exit 1; done'
check "notifications: unread count and mark-as-read with useOptimistic and a form action (works without JavaScript)" bash -c '
  f=src/app/dashboard/notifications.tsx
  grep -q "useOptimistic" "$f" && grep -q "action={markReadAction}" "$f" && grep -q "unread-count" "$f"'

# 9. Mutations are oRPC procedures; Server Actions wrap them (plan §6.8) --------------------------
check "the M08 procedures exist: account.setType, plans.*, grants.*, notifications.*, dashboard.overview" bash -c '
  f=src/server/rpc/router.ts
  for p in "/account/type" "/plans/mine" "/plans/request-pilot-access" "/admin/grants/create" "/admin/grants/revoke" "/notifications/mark-read" "/dashboard"; do
    grep -q "path: '\''$p'\''" "$f" || exit 1
  done'
check "every M08 Server Action is in the API parity table" bash -c '
  for a in markReadAction requestPilotAccessAction setAccountTypeAction createGrantAction revokeGrantAction; do grep -q "#$a'\''" src/server/rpc/parity.ts || exit 1; done'

# 10. The migration and the test database --------------------------------------------------------
refute "the M08 migration is PostgreSQL 16 SQL (no uuidv7(), no virtual columns, no OLD/NEW in RETURNING)" \
  grep_code 'uuidv7\(|VIRTUAL|RETURNING[^;]*(OLD|NEW)\.' "${M08_SQL[@]}"
check "the M08 migration grants pilot_access_request to app_rw and revokes it from app_public_ro" bash -c '
  f='"${M08_SQL[0]:-/dev/null}"'
  grep -q "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE \"pilot_access_request\" TO app_rw" "$f" &&
  grep -q "REVOKE ALL ON TABLE \"pilot_access_request\" FROM app_public_ro" "$f"'

if [ -n "${TEST_DATABASE_URL:-}" ]; then
  facts="$(psql_url "$TEST_DATABASE_URL" -X -q -At -F ' ' -c "
    SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auth_user' AND column_name = 'account_type'),
           (SELECT count(*) FROM pg_constraint WHERE conname = 'auth_user_account_type_check'),
           (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('pilot_access_request_one_open_key', 'notification_user_id_unread_idx')),
           has_table_privilege('app_rw', 'public.pilot_access_request', 'SELECT, INSERT, UPDATE, DELETE'),
           has_table_privilege('app_public_ro', 'public.pilot_access_request', 'SELECT, INSERT, UPDATE, DELETE'),
           (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'
             AND table_name ~ '(payment|charge|invoice|subscription|checkout|billing)')" 2>/dev/null)"
  check "auth_user.account_type with its CHECK; the one-open-request and unread indexes exist" test "$(echo "$facts" | cut -d' ' -f1-3)" = "1 1 2"
  check "app_rw reads and writes pilot_access_request; app_public_ro has no privilege on it" test "$(echo "$facts" | cut -d' ' -f4-5)" = "t f"
  check "there is no payment, charge, invoice, subscription or billing table (no charge in the pilot)" test "$(echo "$facts" | cut -d' ' -f6)" = "0"
  seeded="$(psql_url "$TEST_DATABASE_URL" -X -q -At -F ' ' -c "
    SELECT (SELECT count(*) FROM entitlement_grant g JOIN auth_user u ON u.id = g.subject_user_id
             WHERE u.email = 'demo-pro-sifu-8@example.test' AND g.plan_code = 'pro_sifu' AND g.source = 'test_grant' AND g.revoked_at IS NULL),
           (SELECT count(*) FROM auth_user WHERE email IN ('demo-free-sifu-5@example.test', 'demo-pro-sifu-8@example.test') AND account_type = 'sifu')" 2>/dev/null)"
  check "db:seed: demo-pro-sifu-8 holds a Pro Sifu test plan; demo-free-sifu-5 and demo-pro-sifu-8 are Sifu accounts" test "$seeded" = "1 2"
else
  bad "TEST_DATABASE_URL is not set: cannot check the M08 tables, privileges and seeded plans"
fi

# 11. Screens, routes and the quality bar (Done when 3, 4) -----------------------------------------
for path in /plans /dashboard /dashboard/settings /admin/grants; do
  check "route $path is in e2e/routes.ts (axe in both themes)" grep -q "path: '$path'" e2e/routes.ts
done
for screen in "${KEY_SCREENS[@]}"; do
  check "$screen is a key screen (visual regression and screenshots)" grep -qE "name: '$screen'.*key: true" e2e/routes.ts
done
for screen in "${KEY_SCREENS[@]}" "${STATES[@]}"; do
  for size in "${SIZES[@]}"; do
    for theme in "${THEMES[@]}"; do
      check "screenshot: docs/screenshots/M08/$screen-$size-$theme.png" test -s "docs/screenshots/M08/$screen-$size-$theme.png"
    done
  done
done
refute "no 100vh in the M08 screens (dvh/svh only)" grep_code '100vh|h-screen' "${PLAN_UI[@]}"

# 12. E2E titles (Done when 3) ------------------------------------------------------------------
titles=(
  '@M08 admin grants a Pro Sifu test plan with a reason; the grant and an audit row appear'
  '@M08 a non-admin and a staff session without a verified second factor cannot open /admin/grants'
  '@M08 the upgrade prompt shows the current allowance, real benefits, a "Proposed price (not final)" label and an equally prominent "Not now"'
  '@M08 the upgrade prompt lists only features available in the current release'
  '@M08 /plans labels planned features as not yet available and states that prices are proposals and payments are unavailable'
  '@M08 "Request pilot access" notifies admins and creates no charge'
  '@M08 switching the account type to Sifu sets the Free Sifu plan, shows "Instructor (unverified)" and is audited'
  '@M08 student and Sifu dashboards render empty states with a next action'
  '@M08 the dashboards and the upgrade prompt work at 390x844 with no horizontal scroll'
  # Review round 2.
  '@M08 an admin session without the second factor sees no requester and no open count; verifying it comes back to the request'
  '@M08 a database failure under the grant form says so calmly, changes nothing and logs no e-mail address'
  '@M08 "Request pilot access" on a prompt left open after the account became a Student says why, with and without JavaScript'
  '@M08 in forced colours the chosen account type stays visible; a verified Sifu is not told they show as unverified'
  '@M08 an admin closes a pilot access request with a reason; the account is told and can ask again, with and without JavaScript'
  # Final check.
  '@M08 without JavaScript, "Not now" closes the upgrade prompt and puts the focus on its line'
  '@M08 an empty "Give a test plan" lists every missing answer at once, with and without JavaScript'
)
for title in "${titles[@]}"; do
  check "E2E test: $title" grep -qF "$title" e2e/m08-entitlements.spec.ts
done
exclusive_titles=(
  '@M08 a failed read of /dashboard shows the error state in the app shell; "Try again" brings the dashboard back, with and without JavaScript'
  '@M08 a failed read of /admin/grants shows the error state and keeps the searched e-mail address out of the server log'
  '@M08 a page that awaits a failed read without a catch logs one safe line: no SQL parameters, no account id'
  '@M08 /account renders in full when its unread count cannot be read: the app shell, its navigation and its own content, without the count'
)
for title in "${exclusive_titles[@]}"; do
  check "E2E test (exclusive run): $title" grep -qF "$title" e2e/m08-failures.exclusive.spec.ts
done
# Polish 2, note 1: Next.js writes the heading of its error page with a typographic apostrophe and,
# without JavaScript, sends only its empty root; the /account test checks for both.
check "the /account test checks for Next.js's error page by its root and its heading, with either apostrophe (polish 2, note 1)" bash -c '
  grep -q "await expectNoNextErrorPage(p);" e2e/m08-failures.exclusive.spec.ts &&
  grep -qF "export const NEXT_ERROR_ROOT = '\''html#__next_error__'\'';" e2e/helpers/next-error.ts &&
  grep -qF "This page couldn['\''’]t load" e2e/helpers/next-error.ts'
check "E2E test: @M08 the check for Next.js's error page fails on the error page of this build" \
  grep -qF "@M08 the check for Next.js's error page fails on the error page of this build and passes on a page of the app" e2e/next-error.spec.ts

# 13. Decisions by default and documentation (In scope 8; docs/plan/RULES.md) -----------------
for d in D04 D06 D07 D08 D09 D13; do
  check "DEFAULT $d is marked in the code" grep -rqE "DEFAULT [^:]*$d" src
done
check "docs/entitlements.md describes the matrix, effectivePlan, requireEntitlement, the quota lock, grants and the prompt" bash -c '
  f=docs/entitlements.md
  for w in PLAN_MATRIX_VERSION "effectivePlan()" "requireEntitlement()" pg_advisory_xact_lock /admin/grants "Request pilot access" "Proposed price (not final)" "Planned — not available yet" copy.no-fomo.test.ts; do
    grep -qF "$w" "$f" || exit 1
  done'
check "docs/adr/0007-entitlements.md records TanStack Table 9 (table-core 9.3.1, MIT) and the defaults" bash -c '
  f=docs/adr/0007-entitlements.md
  grep -q "Статус" "$f" && grep -q "@tanstack/table-core" "$f" && grep -q "9.3.1" "$f" && grep -q "MIT" "$f" && grep -q "nuqs" "$f" &&
  for d in D04 D06 D07 D08 D09; do grep -q "DEFAULT $d" "$f" || exit 1; done'
check "docs/data-model.md describes account_type and pilot_access_request" bash -c '
  grep -q "account_type" docs/data-model.md && grep -q "pilot_access_request" docs/data-model.md'
check "the user guide covers the dashboard, the account type, the plans and the upgrade prompt" bash -c '
  f=docs/guides/user-guide.bg.md
  grep -q "### Таблото (Dashboard)" "$f" && grep -q "### Вид на акаунта: Student или Sifu" "$f" && grep -q "### Плановете" "$f" &&
  grep -q "### Подканата за по-висок план" "$f" && grep -q "Instructor (unverified)" "$f"'
check "the admin guide covers giving and revoking test plans in /admin/grants" bash -c '
  f=docs/guides/admin-guide.bg.md
  grep -q "Тестови планове (\`/admin/grants\`, M08)" "$f" && grep -q "### Даване на план" "$f" && grep -q "### Таблицата и отнемането" "$f" &&
  grep -q "grant.revoke" "$f"'
check "docs/plan/README.md has a status for M08" bash -c '! grep -qE "^\| M08 .*\| не е започнат \|$" docs/plan/README.md'
# docs/plan/RULES.md and Done when, item 4: both guides change in the milestone's branch. Checkable
# while the branch is not merged and origin/main is known (not in a shallow CI checkout).
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  for guide in docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md; do
    check "$guide changed in this branch (differs from the merge base with origin/main)" \
      bash -c "! git diff --quiet $base -- $guide"
  done
else
  ok "the guides changed in this branch: not checkable here (merged, or no origin/main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M08 checks: $failures failed"
  exit 1
fi
echo "M08 checks: all passed"
