#!/usr/bin/env bash
# Milestone M10b checks (docs/plan/M10b-claims-reports.md, "Done when"), run by scripts/verify.sh
# after the unit tests (api-parity.test.ts, templates.test.ts: the invitation, claim, instructor and
# arbitration e-mails and notices), the integration tests (claims.int.test.ts: the token stored as
# a hash, its expiry and single use; awaiting_claim → pending_teacher only after an approved
# person_claim; a relationship_event and an audit row for every transition; instructors, reports
# and arbitration), db:check, db:reset+migrate+seed, the build and E2E (`@smoke|@M10b`; the M10b
# spec makes links public, so it runs in the exclusive run after the others, e2e/projects.ts).
# They stay valid after M10b, so `scripts/verify.sh all` keeps running them (CI, M13).
#
# Here: required files, the procedures and their Server Actions, the invitation token, the claim
# transition and the evidence rule, instructor verification, reports, arbitration, the migration
# and the test database, the screens and screenshots, the E2E and integration test titles, the
# decisions by default and the documentation (both guides changed in this branch).
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

mapfile -t M10B_SQL < <(ls drizzle/*_m10b_claims_reports/migration.sql 2>/dev/null)
M10B_PAGES=(src/app/dashboard/teachers/invite src/app/invite src/app/dashboard/instructor src/app/dashboard/cases 'src/app/people/[slug]/report' src/app/admin/review/arbitrate)
mapfile -t M10B_UI < <(find "${M10B_PAGES[@]}" -type f -name '*.tsx' | sort)
M10B_ACTIONS=(src/app/dashboard/teachers/invite/actions.ts 'src/app/invite/[token]/actions.ts' src/app/dashboard/instructor/actions.ts 'src/app/dashboard/cases/[id]/actions.ts' 'src/app/people/[slug]/report/actions.ts' src/app/admin/review/actions.ts)
INVITATIONS=src/server/services/invitations.ts
KINDS=src/server/services/review-kinds.ts
CORE=src/server/services/review-core.ts
ARBITRATION=src/server/services/arbitration.ts
INSTRUCTOR=src/server/services/instructor.ts
REPORTS=src/server/services/reports.ts
CASES=src/server/services/cases.ts
EVIDENCE=src/server/services/evidence.ts
INT=src/server/services/claims.int.test.ts
SPEC=e2e/m10b-claims.spec.ts

KEY_SCREENS=(teachers-invite instructor report)
STATES=(invite-claim case-claim-sent instructor-request arbitrate)
SIZES=(390x844 1440x900)
THEMES=(dark light)

# 1. Required files (Done when 2-4) ---------------------------------------------------------------
required=(
  "$INVITATIONS" "$KINDS" "$CORE" "$ARBITRATION" "$INSTRUCTOR" "$REPORTS" "$CASES" "$INT"
  src/server/templates/email/invitation.tsx src/server/templates/email/claim-decided.tsx
  src/server/templates/email/instructor-decided.tsx src/server/templates/email/relationship-arbitration.tsx
  src/app/dashboard/teachers/invite/page.tsx src/app/dashboard/teachers/invite/invite-form.tsx
  'src/app/invite/[token]/page.tsx' 'src/app/invite/[token]/accept-form.tsx'
  src/app/dashboard/instructor/page.tsx src/app/dashboard/instructor/request-form.tsx
  src/app/dashboard/cases/page.tsx 'src/app/dashboard/cases/[id]/page.tsx' 'src/app/dashboard/cases/[id]/reply-form.tsx'
  'src/app/people/[slug]/report/page.tsx' 'src/app/people/[slug]/report/report-form.tsx'
  'src/app/admin/review/arbitrate/[id]/page.tsx'
  "${M10B_ACTIONS[@]}"
  "$SPEC" docs/evidence-and-review.md docs/adr/0013-claims-reports-arbitration.md docs/plan/questions/M10b.md scripts/verify.d/M10b.sh
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done
check "directory exists and is not empty: docs/screenshots/M10b/" bash -c '[ -d docs/screenshots/M10b ] && [ -n "$(ls -A docs/screenshots/M10b)" ]'
check "exactly one M10b migration exists (m10b_claims_reports)" test "${#M10B_SQL[@]}" -eq 1

# 2. The procedures and their Server Actions (In scope 7; plan §6.8) --------------------------------
check "pnpm api:openapi --check: docs/api/openapi.json matches the router (log: .verify/M10b-openapi.log)" bash -c '
  mkdir -p .verify && pnpm --silent api:openapi --check > .verify/M10b-openapi.log 2>&1'
check "the contract has every M10b procedure" node -e "
  const p = require('./docs/api/openapi.json').paths || {};
  const posts = ['/relationships/invite', '/invitations/send', '/invitations/view', '/invitations/accept', '/instructor/request', '/reports/create', '/cases/reply', '/review/arbitrate'];
  const gets = ['/instructor', '/reports/mine', '/cases', '/cases/{id}'];
  process.exit(posts.every((k) => p[k]?.post) && gets.every((k) => p[k]?.get) ? 0 : 1)"
check "the invitation token travels in a request body, never in an API address" bash -c '
  ! node -e "const p = require(\"./docs/api/openapi.json\").paths || {}; process.exit(Object.keys(p).some((k) => /token/i.test(k)) ? 0 : 1)"'
check "every M10b Server Action is in the API parity table with its procedure" bash -c '
  f=src/server/rpc/parity.ts
  grep -qF "'\''src/app/admin/review/actions.ts#arbitrateAction'\'': { rpc: ['\''review.arbitrate'\''] }," "$f" &&
  grep -qF "'\''src/app/dashboard/teachers/invite/actions.ts#inviteTeacherAction'\'': { rpc: ['\''relationships.invite'\''] }," "$f" &&
  grep -qF "'\''src/app/dashboard/teachers/invite/actions.ts#sendInvitationAction'\'': { rpc: ['\''invitations.send'\''] }," "$f" &&
  grep -qF "'\''src/app/invite/[token]/actions.ts#acceptInvitationAction'\'': { rpc: ['\''invitations.accept'\''] }," "$f" &&
  grep -qF "'\''src/app/dashboard/instructor/actions.ts#requestInstructorAction'\'': { rpc: ['\''instructor.request'\''] }," "$f" &&
  grep -qF "'\''src/app/dashboard/cases/[id]/actions.ts#replyCaseAction'\'': { rpc: ['\''cases.reply'\''] }," "$f" &&
  grep -qF "'\''src/app/people/[slug]/report/actions.ts#reportProfileAction'\'': { rpc: ['\''reports.create'\''] }," "$f"'
check "review.arbitrate sits behind staffWithSecondFactor; the member procedures behind signedIn" bash -c '
  f=src/server/rpc/router.ts
  grep -qE "^    arbitrate: staffWithSecondFactor$" "$f" &&
  [ "$(grep -cE "^    (invite|send|accept|request|create|reply): signedIn$" "$f")" -ge 6 ]'
refute "the M10b pages and components never import src/server/db or src/server/storage, and services only for their types" \
  bash -c 'grep -rnE "from .@/server/(services|db|storage)" "$@" | grep -vE ":import type [^;]+ from .@/server/services/"' _ "${M10B_PAGES[@]}"
refute "the M10b Server Actions import nothing from src/server/services, db or storage (they call the procedures)" \
  grep -nE "from ['\"]@/server/(services|db|storage)" "${M10B_ACTIONS[@]}"

# 3. The invitation (In scope 1; the brief's defaults) -----------------------------------------------
check "the token is 32 random bytes in base64url, and only its SHA-256 is stored" bash -c '
  f='"$INVITATIONS"'
  grep -qF "const token = randomBytes(32).toString('\''base64url'\'');" "$f" &&
  grep -qF "export const hashToken = (token: string) => createHash('\''sha256'\'').update(token, '\''utf8'\'').digest('\''hex'\'');" "$f" &&
  grep -qF "tokenHash: hashToken(token)," "$f"'
check "an invitation works for 14 days and once (accepted_by_user_id with accepted_at, CHECK in the migration)" bash -c '
  grep -qF "export const INVITATION_DAYS = 14;" '"$INVITATIONS"' &&
  grep -qF "status: '\''accepted'\'', acceptedAt: now, acceptedByUserId: p.user.id" '"$INVITATIONS"' &&
  grep -qF "\"invitation_accepted_has_account\" CHECK" '"${M10B_SQL[*]:-/dev/null}"''
check "the e-mail link is sealed in the outbox (secretFields: url) and points at /invite/<43 characters>" bash -c '
  f=src/server/templates/email/invitation.tsx
  grep -qF "secretFields: ['\''url'\'']," "$f" && grep -qF "const INVITE_PAGE = /^\/invite\/[A-Za-z0-9_-]{43}\$/;" "$f"'
check "the invitation e-mail links only the M02 drafts (terms and privacy notice; DEFAULT D23)" bash -c '
  f=src/server/templates/email/invitation.tsx
  grep -q "/legal/terms" "$f" && grep -q "/legal/privacy" "$f" && grep -q "DEFAULT D23" "$f"'
refute "the invitation service never logs (no console.* in invitations.ts)" grep_code 'console\.' "$INVITATIONS"
check "the invitation page sends no referrer, so the token stays in the link" grep -qF "referrer: 'no-referrer'," 'src/app/invite/[token]/page.tsx'
check "invitations are limited per relationship (3) and per account (10) in 24 hours" bash -c '
  f='"$INVITATIONS"'
  grep -qF "export const INVITATIONS_PER_RELATIONSHIP = 3;" "$f" && grep -qF "export const INVITATIONS_PER_ACCOUNT = 10;" "$f" && grep -qF "export const INVITATION_WINDOW_HOURS = 24;" "$f"'
check "the invited record and its link are unclaimed and involved_only, awaiting_claim (DEFAULT D03)" bash -c '
  f='"$INVITATIONS"'
  grep -q "// DEFAULT D03: the record of a teacher invited by a student is involved_only" "$f" &&
  grep -qF "stewardship: '\''unclaimed'\''," "$f" && grep -qF "status: '\''awaiting_claim'\''," "$f" && grep -qF "visibility: '\''involved_only'\''," "$f"'

# 4. The claim (In scope 2; Constraints) ----------------------------------------------------------
check "awaiting_claim → pending_teacher happens only in the approved person_claim, with a relationship_event and relationship.claimed" bash -c '
  f='"$KINDS"'
  grep -qF "await tx.update(teachingRelationship).set({ status: '\''pending_teacher'\'', statusReason: null, updatedAt: now })" "$f" &&
  grep -qF "from: '\''awaiting_claim'\'', to: '\''pending_teacher'\''" "$f" && grep -qF "action: '\''relationship.claimed'\''," "$f"'
refute "nothing else moves a relationship to pending_teacher from awaiting_claim (invitations.ts, cases.ts)" \
  grep_code "pending_teacher" "$INVITATIONS" "$CASES"
check "the teacher opens a student's relationship evidence only once the record is theirs, never through a claim or a dispute" bash -c '
  f='"$EVIDENCE"'
  grep -qF "JOIN person t ON t.id = r.teacher_person_id AND t.deleted_at IS NULL" "$f" &&
  grep -qF "WHERE l.evidence_file_id = evidence_file.id AND t.claimed_by_user_id = \${userId}::uuid" "$f" &&
  grep -qF "AND (c.id IS NULL OR c.kind = '\''historical_claim'\''))" "$f"'
check "a profile claim is decided by an archivist or an administrator" \
  grep -qF "person_claim: ['archivist', 'admin']," "$CORE"

# 5. Instructor verification (In scope 3; DEFAULT D04/D13) -------------------------------------------
check "instructor verification needs at least one file and writes instructor.request and instructor.verify" bash -c '
  grep -qF "min(1, { error: '\''Attach at least one file of evidence.'\'' })" '"$INSTRUCTOR"' &&
  grep -qF "action: '\''instructor.request'\''," '"$INSTRUCTOR"' && grep -qF "action: '\''instructor.verify'\''," '"$KINDS"' &&
  grep -qF "'\''instructor.verify'\''" src/server/audit/index.ts'
check "the labels are \"Instructor (unverified)\" and \"Approved by an unverified instructor\"" bash -c '
  grep -qF "unverified: '\''Instructor (unverified)'\''," src/server/services/plans.ts &&
  grep -q "Approved by an unverified instructor" src/components/lineage/relation-list.tsx'
check "the views derive instructor_status and approved_by_unverified_instructor (DEFAULT D04/D13)" bash -c '
  f='"${M10B_SQL[*]:-/dev/null}"'
  grep -qF "AS \"instructor_status\"" "$f" && grep -qF "AS \"approved_by_unverified_instructor\"" "$f"'
check "the seeded Sifu accounts are verified instructors" bash -c '
  f=src/fixtures/generate.ts
  grep -qF "const instructorCases: ReviewCaseRow[] = DEMO_SIFU_ACCOUNT_SLUGS.map((slug) => ({" "$f" && grep -qF "resolution: '\''approved'\''," "$f"'
check "DEFAULT D04 and D13 are marked in the instructor service" bash -c 'grep -q "DEFAULT D04/D13" '"$INSTRUCTOR"' && grep -q "DEFAULT D13" '"$INSTRUCTOR"''

# 6. Reports (In scope 4) ----------------------------------------------------------------------------
check "one report per account and profile: the service and a unique index" bash -c '
  grep -qF "content_report_one_per_reporter_key" '"$REPORTS"' &&
  grep -qF "CREATE UNIQUE INDEX \"content_report_one_per_reporter_key\" ON \"content_report\" (\"reporter_user_id\",\"subject_type\",\"subject_id\")" '"${M10B_SQL[*]:-/dev/null}"''
check "the four reasons of Report profile (copyright, spam, inappropriate, misleading)" \
  grep -qF "export const REPORT_REASONS = ['copyright', 'spam', 'inappropriate', 'misleading'] as const;" src/server/db/schema/common.ts
refute "no automatic hiding: the report service never changes a person's visibility" grep_code 'visibility|update\(person\)' "$REPORTS"
check "a report's decision exists and changes only the report and its case (no automatic hiding)" bash -c '
  body="$(awk "/^async function decideReport\\(/{on=1} on{print} on&&/^}/{exit}" "$1")"
  [ -n "$body" ] && printf "%s\n" "$body" | grep -q "update(contentReport)" && ! printf "%s\n" "$body" | grep -qE "visibility|update\\(person\\)"' _ "$KINDS"

# 7. Arbitration (In scope 5; DEFAULT D19) ---------------------------------------------------------
check "a moderator or an administrator with the second factor sets arbitration, with a reason" bash -c '
  f='"$ARBITRATION"'
  grep -qF "const p = requireStaff2FA(principal);" "$f" && grep -qF "relationship_dispute: ['\''moderator'\'', '\''admin'\'']," '"$CORE"' &&
  grep -qF "Write the reason both parties will read." "$f"'
check "the arbitration writes relationship_event, a needs_info dispute case and relationship.arbitration with its reason" bash -c '
  f='"$ARBITRATION"'
  grep -qF "from: '\''verified'\'', to: '\''in_arbitration'\''" "$f" && grep -qF "kind: '\''relationship_dispute'\'', status: '\''needs_info'\''" "$f" &&
  grep -qF "action: '\''relationship.arbitration'\''," "$f" && grep -qF "reason: input.reason," "$f"'
check "both parties get a notification and an e-mail with the reason and the case page link" bash -c '
  f='"$KINDS"'
  grep -qF "template: '\''relationship.arbitration'\'', payload: { relationshipId: row.id, caseId, stage, reason }" "$f" &&
  grep -qF "template: '\''relationship-arbitration'\''," "$f" && grep -qF "url: url(\`/dashboard/cases/\${caseId}\`)," "$f"'
check "public pages say \"Disputed\" in words (DEFAULT D19)" bash -c '
  grep -qF "return { kind: '\''arbitration'\'', label: '\''Disputed'\'' };" src/components/lineage/status.ts &&
  grep -q "label: '\''Disputed'\''" src/design/tokens.ts'
check "DEFAULT D19 is marked in the arbitration service" grep -q "DEFAULT D19" "$ARBITRATION"

# 8. The migration and the test database --------------------------------------------------------------
refute "the M10b migration is PostgreSQL 16 SQL (no uuidv7(), no virtual columns, no OLD/NEW in RETURNING)" \
  grep_code 'uuidv7\(|VIRTUAL|RETURNING[^;]*(OLD|NEW)\.' "${M10B_SQL[@]}"
if [ -n "${TEST_DATABASE_URL:-}" ]; then
  facts="$(psql_url "$TEST_DATABASE_URL" -X -q -At -F ' ' -c "
    SELECT to_regclass('public.review_event') IS NOT NULL,
           (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE '%UNIQUE%'
             AND indexname IN ('content_report_one_per_reporter_key', 'review_case_one_open_instructor_key', 'review_event_idempotency_key', 'invitation_idempotency_key', 'invitation_token_hash_key')),
           (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
             AND ((table_name = 'invitation' AND column_name IN ('accepted_by_user_id', 'idempotency_key'))
               OR (table_name = 'v_public_person' AND column_name = 'instructor_status')
               OR (table_name = 'v_public_edge' AND column_name = 'approved_by_unverified_instructor'))),
           has_table_privilege('app_rw', 'public.review_event', 'INSERT') AND has_table_privilege('app_rw', 'public.review_event', 'SELECT'),
           has_table_privilege('app_rw', 'public.review_event', 'UPDATE') OR has_table_privilege('app_rw', 'public.review_event', 'DELETE'),
           has_table_privilege('app_public_ro', 'public.review_event', 'SELECT') OR has_table_privilege('app_public_ro', 'public.content_report', 'SELECT')
             OR has_table_privilege('app_public_ro', 'public.invitation', 'SELECT')" 2>/dev/null)"
  check "review_event exists" test "$(echo "$facts" | cut -d' ' -f1)" = "t"
  check "the unique indexes exist: one report per account and subject, one open instructor case, the keys and the token hash" test "$(echo "$facts" | cut -d' ' -f2)" = "5"
  check "the M10b columns exist: invitation.accepted_by_user_id and idempotency_key, the two view columns" test "$(echo "$facts" | cut -d' ' -f3)" = "4"
  check "app_rw may read and append review_event" test "$(echo "$facts" | cut -d' ' -f4)" = "t"
  check "app_rw may not update or delete review_event (append-only)" test "$(echo "$facts" | cut -d' ' -f5)" = "f"
  check "app_public_ro cannot read review_event, content_report or invitation" test "$(echo "$facts" | cut -d' ' -f6)" = "f"
else
  bad "TEST_DATABASE_URL is not set: cannot check the M10b tables, indexes, columns and grants"
fi

# 9. Screens, routes and screenshots (Done when 4) ---------------------------------------------------
for path in /dashboard/teachers/invite /dashboard/instructor /dashboard/cases /people/demo-two-lineages/report; do
  check "route $path is in e2e/routes.ts (axe in both themes)" grep -q "path: '$path'" e2e/routes.ts
done
for screen in "${KEY_SCREENS[@]}"; do
  check "$screen is a key screen (visual regression and screenshots)" grep -qE "name: '$screen'.*milestone: 'M10b', key: true" e2e/routes.ts
done
for state in "${STATES[@]}"; do
  check "screen state $state is in e2e/screenshots.spec.ts" grep -q "name: '$state'" e2e/screenshots.spec.ts
done
for screen in "${KEY_SCREENS[@]}" "${STATES[@]}"; do
  for size in "${SIZES[@]}"; do
    for theme in "${THEMES[@]}"; do
      check "screenshot: docs/screenshots/M10b/$screen-$size-$theme.png" test -s "docs/screenshots/M10b/$screen-$size-$theme.png"
    done
  done
done
refute "no 100vh in the M10b screens (dvh/svh only)" grep_code '100vh|h-screen' "${M10B_UI[@]}"
refute "no window.open in the M10b screens" grep_code 'window\.open' "${M10B_UI[@]}"
check "the invitation page runs axe in both themes (e2e/m10b-claims.spec.ts)" grep -qF "await expectNoAxeViolations(invitee.page, \`the invitation page (\${theme})\`);" "$SPEC"

# 10. E2E and integration tests (Done when 2, 3) --------------------------------------------------------
titles=(
  '@M10b a missing teacher gets an invitation, claims the profile after review, then approves the pending request; before approval the edge stays involved_only'
  '@M10b an unclaimed teacher record created by a student is absent from anonymous HTML, API, search and sitemap until verified'
  '@M10b a self-declared Sifu is shown as unverified until an archivist approves instructor evidence'
  '@M10b a moderator sets a relationship to in arbitration with a reason; public pages show "Disputed" and both parties receive a notification with the reason and an evidence-submission link'
  '@M10b "Report profile" opens a review case and the same user cannot report the same profile twice'
)
for title in "${titles[@]}"; do
  check "E2E test: $title" grep -qF "$title" "$SPEC"
done
check "the M10b spec runs in the exclusive run, after the others (PUBLIC_WRITE_SPECS)" bash -c '
  grep -qE "^export const PUBLIC_WRITE_SPECS = \[.*'\''\*\*/m10b-claims\.spec\.ts'\''.*\] as const;$" e2e/projects.ts &&
  grep -qF "export const EXCLUSIVE_SPECS: string[] = [EXCLUSIVE_SPEC, ...PUBLIC_WRITE_SPECS];" e2e/projects.ts &&
  grep -q "PW_EXCLUSIVE=1 pnpm e2e --pass-with-no-tests" scripts/verify.sh'
refute "the E2E fixtures are fictional: every person address in the M10b spec is a demo- slug or a generated one" \
  bash -c "grep -nE '/people/[a-z0-9]' $SPEC | grep -vE '/people/demo-'"
check "integration tests: the token is a hash, expires and works once; the claim; the evidence before approval; every transition recorded" bash -c '
  f='"$INT"'
  grep -q "is stored only as its SHA-256, sealed in the e-mail job, and works for 14 days" "$f" &&
  grep -q "answers an unknown, malformed or revoked token with the same 404, and an expired one as expired" "$f" &&
  grep -q "works once: a second account finds it used" "$f" &&
  grep -q "moves awaiting_claim → pending_teacher only after an approved claim; the invitee opens the evidence only then; every transition is recorded" "$f" &&
  grep -q "keeps the request awaiting_claim when the claim is refused" "$f"'
check "integration tests: instructors, one report per profile, arbitration" bash -c '
  f='"$INT"'
  grep -q "shows a self-declared Sifu as unverified until an archivist approves the evidence (audit instructor.verify)" "$f" &&
  grep -q "opens one review case per account and profile (a unique index), never hides the profile by itself" "$f" &&
  grep -q "is set by a moderator with the second factor and a reason; both parties get the reason and the link; the decision is recorded" "$f"'

# 11. Decisions by default and documentation (In scope 6, 8; Stop and ask) --------------------------
check "DEFAULT D03 is marked where the invited record and its link are made" grep -q "DEFAULT D03" "$INVITATIONS"
check "docs/evidence-and-review.md records the M10b defaults: D03, D04, D19, D23 and the reports" bash -c '
  f=docs/evidence-and-review.md
  grep -q "## Покани, поемане на профил, инструктори, сигнали и арбитраж (M10b)" "$f" &&
  grep -q "\*\*D04/D13\*\*" "$f" && grep -q "\*\*D19\*\*" "$f" && grep -q "\*\*D23\*\*" "$f" && grep -q "Сигнали:" "$f"'
check "docs/adr/0013-claims-reports-arbitration.md records the token, the claim, the instructor, the reports and the arbitration" bash -c '
  f=docs/adr/0013-claims-reports-arbitration.md
  grep -q "randomBytes(32)" "$f" && grep -q "awaiting_claim → pending_teacher" "$f" && grep -q "instructor_status" "$f" &&
  grep -q "content_report_one_per_reporter_key" "$f" && grep -q "review.arbitrate" "$f" && grep -q "Нови пакети няма." "$f"'
check "docs/plan/questions/M10b.md records the legal question of the invitation with its default" bash -c '
  f=docs/plan/questions/M10b.md
  grep -q "The legal text of the invitation e-mail (GDPR Art. 14)" "$f" && grep -q "Proposed default:" "$f"'
check "docs/data-model.md describes review_event, the invitation columns and the view columns" bash -c '
  f=docs/data-model.md
  grep -q "review_event" "$f" && grep -q "accepted_by_user_id" "$f" && grep -q "instructor_status" "$f" && grep -q "approved_by_unverified_instructor" "$f" && grep -q "m10b_claims_reports" "$f"'
check "the user guide covers the invitation, the claim, instructor verification and the report" bash -c '
  f=docs/guides/user-guide.bg.md
  grep -q "## Покана към учител, поемане на профил, проверка на инструктор и сигнали (M10b)" "$f" && grep -q "/dashboard/teachers/invite" "$f" &&
  grep -q "Claim this profile" "$f" && grep -q "Send for verification" "$f" && grep -q "Report profile" "$f"'
check "the admin guide covers the claim review, instructor verification, reports and arbitration" bash -c '
  f=docs/guides/admin-guide.bg.md
  grep -q "## 16. Покани, поемане на профил, проверка на инструктор, сигнали и арбитраж (M10b)" "$f" &&
  grep -q "### Поемането на профил" "$f" && grep -q "### Проверката на инструктор" "$f" && grep -q "### Сигналите" "$f" && grep -q "### Арбитражът (D19)" "$f"'
check "docs/plan/README.md has a status for M10b" bash -c '! grep -qE "^\| M10b .*\| не е започнат \|$" docs/plan/README.md'
# Done when, item 4: both guides change in the milestone's branch. Checkable while the branch is not
# merged and origin/main is known (not in a shallow CI checkout).
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  for guide in docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md; do
    check "$guide changed in this branch (differs from the merge base with origin/main)" bash -c "! git diff --quiet $base -- $guide"
  done
else
  ok "the guides changed in this branch: not checkable here (merged, or no origin/main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M10b checks: $failures failed"
  exit 1
fi
echo "M10b checks: all passed"
