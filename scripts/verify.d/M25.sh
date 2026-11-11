#!/usr/bin/env bash
# Milestone M25 checks (docs/plan/M25-governance.md, "Done when"), run by scripts/verify.sh after the
# unit tests, the integration tests (src/server/services/governance.int.test.ts and the rows of the
# authorization matrix), db:check, db:reset+migrate+seed, the build and E2E (`@smoke|@M25`:
# e2e/m25-governance-view.spec.ts on the desktop and phone projects; e2e/m25-governance.spec.ts,
# which sends requests, reports, appeals and proposals, in the exclusive run). They stay valid after
# M25, so `scripts/verify.sh all` keeps running them.
#
# Here: required files, no new dependency, the one migration and its grants (the change history is
# append-only), inactivity that never transfers or marks deceased by itself, the deciders, one
# appeal per decision, the rate limits, the procedures and Server Actions, the notices, the
# decisions by default, the UI rules, the E2E and integration titles, and the documentation.
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

SUCCESSION=src/server/services/succession.ts
DISPUTES=src/server/services/disputes.ts
STEWARDSHIP=src/server/services/stewardship.ts
DECIDE=src/server/services/governance-review.ts
CORE=src/server/services/review-core.ts
SCHEMA=src/server/db/schema/governance.ts
COMMON=src/server/db/schema/common.ts
CATALOG=src/server/templates/catalog.ts
ROUTER=src/server/rpc/router.ts
PARITY=src/server/rpc/parity.ts
MATRIX=src/server/rpc/authz-matrix.int.test.ts
INT=src/server/services/governance.int.test.ts
SPEC=e2e/m25-governance.spec.ts
VIEW_SPEC=e2e/m25-governance-view.spec.ts
PAGES=(src/app/dashboard/succession/page.tsx src/app/dashboard/succession/forms.tsx 'src/app/people/[slug]/dispute/page.tsx' 'src/app/people/[slug]/dispute/dispute-form.tsx'
  'src/app/people/[slug]/record/page.tsx' 'src/app/people/[slug]/record/propose-form.tsx' 'src/app/dashboard/cases/[id]/appeal-form.tsx')
ACTIONS=(src/app/dashboard/succession/actions.ts 'src/app/people/[slug]/dispute/actions.ts' 'src/app/people/[slug]/record/actions.ts' 'src/app/dashboard/cases/[id]/actions.ts')
mapfile -t M25_SQL < <(ls drizzle/*_m25_governance/migration.sql 2>/dev/null)
TABLES=(succession_nomination succession_request lineage_report decision_appeal record_proposal record_revision)

# 1. Required files (Done when 4) ------------------------------------------------------------------
required=(
  "$SUCCESSION" "$DISPUTES" "$STEWARDSHIP" "$DECIDE" "$SCHEMA" "${PAGES[@]}" "${ACTIONS[@]}" "$SPEC" "$VIEW_SPEC" "$INT"
  docs/adr/0028-governance.md docs/plan/M25-governance.md docs/plan/questions/M25.md
  docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md docs/data-model.md docs/entitlements.md
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done

# 2. No new dependency (CLAUDE.md §3) --------------------------------------------------------------
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" && [ "$base" != "$(git rev-parse HEAD)" ]; then
  check "package.json gains no dependency in this branch" bash -c "! git diff $base -- package.json | grep -qE '^\+[[:space:]]+\"[@a-z0-9/._-]+\": \"[0-9]'"
else
  ok "no new dependency: not checkable here (merged, or no origin/main in this checkout)"
fi

# 3. One migration and its grants (PostgreSQL 16+) -------------------------------------------------
check "exactly one M25 migration (m25_governance), with its snapshot" bash -c '
  [ "'"${#M25_SQL[@]}"'" -eq 1 ] && [ -s "$(dirname "'"${M25_SQL[0]:-none}"'")/snapshot.json" ]'
if [ "${#M25_SQL[@]}" -eq 1 ]; then
  SQL="${M25_SQL[0]}"
  for t in "${TABLES[@]}"; do
    check "the table $t" grep -qF "CREATE TABLE \"$t\"" "$SQL"
  done
  check "auth_user.last_active_at, backfilled from the sessions" bash -c "grep -qF '\"last_active_at\"' '$SQL' && grep -qF 'UPDATE \"auth_user\" u SET \"last_active_at\"' '$SQL'"
  check "one live nomination, one pending request, one open report, one pending proposal, one appeal per decision" bash -c "
    for i in succession_nomination_one_live_key succession_request_one_pending_key lineage_report_one_open_key record_proposal_one_pending_key decision_appeal_one_per_decision_key; do grep -qF \"\\\"\$i\\\"\" '$SQL' || exit 1; done"
  check "the change history is append-only for app_rw (SELECT and INSERT only)" bash -c "
    grep -qF 'GRANT SELECT, INSERT ON TABLE \"record_revision\" TO app_rw' '$SQL' && grep -qF 'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE \"record_revision\" FROM app_rw' '$SQL'"
  check "app_public_ro has no access to the governance tables" grep -qF 'REVOKE ALL ON TABLE "succession_nomination", "succession_request", "lineage_report", "decision_appeal", "record_proposal", "record_revision" FROM app_public_ro' "$SQL"
  refute "the migration stays on PostgreSQL 16+ and deletes nothing" grep -nEi "uuidv7\(|VIRTUAL|RETURNING[^;]*\b(OLD|NEW)\.|DELETE FROM|DROP TABLE" "$SQL"
  refute "the migration leaves the public views alone" grep -n 'CREATE OR REPLACE VIEW' "$SQL"
fi
check "the new review case kinds and the reopen action" bash -c "
  for k in succession_request lineage_report decision_appeal record_proposal; do grep -q \"'\$k'\" $COMMON || exit 1; done; grep -q \"'reopen'\" $COMMON"

# 4. Succession: inactivity never transfers or marks deceased by itself (In scope 1) -----------------
check "more than 180 days of inactivity, never fewer" bash -c "grep -q 'SUCCESSION_INACTIVITY_DAYS = 180' $COMMON && grep -q '> SUCCESSION_INACTIVITY_DAYS' $SUCCESSION"
check "a succession request needs evidence (linkFilesToCase)" bash -c "awk '/export async function requestSuccession/{f=1} f{print} f && /^}/{exit}' $SUCCESSION | grep -q 'linkFilesToCase'"
check "no succession code writes a life status (the service and the succession decision)" bash -c "
  ! grep -nE 'lifeStatus:|life_status *=|lifeStatus *=' $SUCCESSION && ! awk '/^async function decideSuccession/{f=1} f{print} f && /^}/{exit}' $DECIDE | grep -nE 'lifeStatus:|life_status|person\\)\\.set'"
check "the approval checks the inactivity again and records lifeStatusChanged: false" bash -c "grep -q 'stillInactive' $DECIDE && grep -q 'lifeStatusChanged: false' $DECIDE"
check "only an administrator decides a succession request; only an archivist a proposal" bash -c "
  grep -qF \"succession_request: ['admin']\" $CORE && grep -qF \"record_proposal: ['archivist']\" $CORE && grep -qF \"lineage_report: ['moderator', 'admin']\" $CORE"
check "the integration test proves inactivity never transfers and never marks deceased" bash -c "grep -qF 'inactivity alone never marks anyone deceased' $INT && grep -qF 'keeps the record, its life status and its history' $INT"

# 5. Disputes and appeals (In scope 2) --------------------------------------------------------------
check "a lineage report changes no status: the case has no relationship and the report is audited with the same status" bash -c "
  awk '/export async function reportLineage/{f=1} f{print} f && /^}/{exit}' $DISPUTES > /tmp/m25-report.\$\$ &&
  grep -q \"kind: 'lineage_report', status: 'open', openedByUserId\" /tmp/m25-report.\$\$ && ! grep -q 'teachingRelationship).set' /tmp/m25-report.\$\$; rc=\$?; rm -f /tmp/m25-report.\$\$; [ \$rc -eq 0 ]"
check "an appeal is never decided by the one who decided" bash -c "grep -q 'originalDeciderUserId === p.user.id' $DECIDE && grep -q 'decidedBeforeAppeal' src/server/services/review.ts"
check "the appeal window and the rate limit" bash -c "grep -q 'APPEAL_WINDOW_DAYS = 30' $COMMON && grep -q 'GOVERNANCE_DAILY_LIMIT = 5' $COMMON"
check "the rate limit is used by reports, appeals, requests and proposals" bash -c "for f in $DISPUTES $SUCCESSION $STEWARDSHIP; do grep -q 'GOVERNANCE_DAILY_LIMIT' \$f || exit 1; done"

# 6. Stewardship (In scope 3) ------------------------------------------------------------------------
check "every archival edit and every approved proposal writes record_revision" bash -c "grep -q 'recordRevisionRow' src/server/services/review.ts && grep -q 'recordRevisionRow' $DECIDE"
check "the public change history names no actor and no reason" bash -c "grep -q 'reason: staff ? r.reason : null' $STEWARDSHIP && ! awk '/export async function recordHistory/{f=1} f{print} f && /^}/{exit}' $STEWARDSHIP | grep -q 'actorUserId'"
check "a record kept by its own person takes no proposal" grep -q "stewardship === 'self'" "$STEWARDSHIP"

# 7. API first (plan §6.8) ----------------------------------------------------------------------------
check "the procedures: succession.*, disputes.*, appeals.create, records.*" bash -c "
  for p in successionMine nominateSuccessor answerNomination revokeNomination requestSuccession reportableRelationships reportLineage appealDecision recordHistory proposeOptions proposeRecordChange; do grep -q \"\$p(\" $ROUTER || exit 1; done"
check "docs/api/openapi.json has the governance paths" bash -c "f=docs/api/openapi.json; for p in /succession /succession/nominate /succession/answer /succession/revoke /succession/request /disputes/report /appeals /records/propose; do grep -qF \"\\\"\$p\\\"\" \$f || exit 1; done"
check "the Server Actions are thin wrappers in the parity table" bash -c "
  for a in nominateSuccessorAction answerNominationAction revokeNominationAction requestSuccessionAction reportLineageAction appealDecisionAction proposeRecordAction; do grep -q \"#\$a'\" $PARITY || exit 1; done"
check "the authorization matrix has the M25 rows and forms" bash -c "
  for p in succession.mine succession.nominate succession.answer succession.revoke succession.request disputes.relationships disputes.report appeals.create records.history records.proposeOptions records.propose; do grep -q \"path: '\$p'\" $MATRIX || exit 1; done
  for a in nominateSuccessorAction requestSuccessionAction reportLineageAction appealDecisionAction proposeRecordAction; do grep -q \"#\$a'\" $MATRIX || exit 1; done"

# 8. Notices and audit -------------------------------------------------------------------------------
check "the notices are in the catalog: succession in teaching and account, decisions in review" bash -c "
  grep -qF \"'succession.nominated': mailed('teaching', 'notice')\" $CATALOG && grep -qF \"'succession.requested': mailed('account', 'notice')\" $CATALOG &&
  for k in dispute.decided appeal.decided proposal.decided; do grep -qF \"'\$k': mailed('review', 'notice')\" $CATALOG || exit 1; done"
check "the audit actions carry the new names" bash -c "f=src/server/audit/index.ts; for a in succession.nominate succession.request succession.transfer dispute.report dispute.decide appeal.create appeal.decide record.propose; do grep -q \"'\$a'\" \$f || exit 1; done"
refute "governance logs carry no note, name or e-mail" grep -nE "logger\(\)\.(info|warn|error)\(" "$SUCCESSION" "$DISPUTES" "$STEWARDSHIP" "$DECIDE"

# 9. Decisions by default (CLAUDE.md §8) ------------------------------------------------------------
for n in 1 2 3 4 5 6 7 8 9 10 11; do
  check "DEFAULT M25 (question $n) is marked in the code" bash -c "grep -rqE 'DEFAULT M25[ ,(]+questions? $n\\b' src"
done
check "the plan matrix: successor is available now, enforced" bash -c "grep -q \"PLAN_MATRIX_VERSION = '2026-11-11.1'\" src/server/entitlements/plans.ts && grep -q '2026-11-11.1' docs/entitlements.md"

# 10. The pages (CLAUDE.md §10, §11) ----------------------------------------------------------------
refute "no 'use cache' in the governance services or pages" grep -n "'use cache'" "$SUCCESSION" "$DISPUTES" "$STEWARDSHIP" "$DECIDE" "${PAGES[@]}"
refute "no window.open, no 100vh, no hover-only behaviour in the M25 pages" grep -nE "window\.open|100vh|group-hover:|onMouseEnter|target=\"_blank\"" "${PAGES[@]}"
refute "no countdown, urgency or blame in the M25 pages and notices" grep -nEi "\b(hurry|urgent|last chance|don.t miss|act now)\b|spots? left|only [0-9]+ left" "${PAGES[@]}"
check "statuses are said in words (data-status with a label)" bash -c "grep -q 'Status: ' src/app/dashboard/succession/page.tsx && grep -q 'Under review by the moderators' 'src/app/people/[slug]/dispute/page.tsx'"
check "the new pages are in e2e/routes.ts; /dashboard/succession is a key screen" bash -c "
  f=e2e/routes.ts; grep -q \"name: 'dashboard-succession', status: 200, milestone: 'M25', key: true\" \$f && grep -q \"name: 'lineage-dispute'\" \$f && grep -q \"name: 'record-history'\" \$f && grep -q \"name: 'record-propose'\" \$f"
check "the received nomination is a screen state" grep -qF "name: 'succession-received'" e2e/screenshots.spec.ts

# 11. E2E and integration titles (Done when 3) --------------------------------------------------------
titles=(
  '@M25 a successor is named, accepts, and takes over the administration only after inactivity, evidence and an administrator'
  '@M25 a lineage report that is not upheld changes nothing; its one appeal is decided by someone else'
  '@M25 a correction of a shared archival record is proposed, approved by an archivist and kept in its history'
)
for t in "${titles[@]}"; do check "E2E test: $t" grep -qF "$t" "$SPEC"; done
view_titles=(
  '@M25 a Professional Sifu sees whom they can name as digital successor, and nothing moves by itself'
  '@M25 a Free Sifu is told once what the digital successor needs'
  '@M25 a lineage error is reported with evidence; an empty report is refused and changes nothing'
  '@M25 a shared archival record shows its change history and takes proposals, never edits'
)
for t in "${view_titles[@]}"; do check "E2E test: $t" grep -qF "$t" "$VIEW_SPEC"; done
check "the E2E runs axe in both themes and checks 44 px targets on a phone" bash -c "
  grep -q 'expectNoAxeViolations' $SPEC && grep -q 'for (const theme of THEMES)' $VIEW_SPEC && grep -q 'toBeGreaterThanOrEqual(44)' $VIEW_SPEC && grep -q \"startsWith('mobile')\" $VIEW_SPEC"
check "the writing spec runs alone (PUBLIC_WRITE_SPECS), the view spec in the desktop and phone projects" bash -c "grep -q \"'\\*\\*/m25-governance.spec.ts'\" e2e/projects.ts && ! grep -q 'm25-governance-view' e2e/projects.ts"
int_titles=(
  'only a verified student on Premium Student or Professional Sifu can be nominated, by an owner whose plan allows it'
  'only the nominee answers, only the owner revokes; a revocation closes a waiting request and its case'
  'inactivity within 180 days is refused; a request needs evidence; inactivity alone never marks anyone deceased'
  'an owner who comes back before the decision stops an inactivity transfer'
  'a report changes nothing by itself, needs evidence, and the reported people are no parties of it'
  'not upheld changes nothing; upheld sets the relationship in arbitration'
  'one appeal per decision, by a party, never decided by the member of staff who decided'
  'a proposal changes nothing until an archivist approves it; the change is kept in the history'
  'no school or organization edits a shared record alone, and an organizational split leaves its history as it was'
  'the change history is append-only for the application role'
)
for t in "${int_titles[@]}"; do check "integration test: $t" grep -qF "$t" "$INT"; done

# 12. Demo data (D20) --------------------------------------------------------------------------------
refute "only demo- slugs and example.test addresses in the M25 tests" grep -nE "@[a-z]+\.(com|net|org)\b" "$INT" "$SPEC" "$VIEW_SPEC"

# 13. Documentation ----------------------------------------------------------------------------------
check "ADR 0028 records succession, disputes, appeals, stewardship and the defaults" bash -c "
  f=docs/adr/0028-governance.md; grep -q 'DEFAULT M25' \"\$f\" && grep -q 'record_revision' \"\$f\" && grep -q 'succession_request' \"\$f\" && grep -q 'decision_appeal' \"\$f\" && grep -q '180' \"\$f\""
check "questions/M25.md has questions, each with a proposed default" bash -c "
  f=docs/plan/questions/M25.md; n=\$(grep -c '^## 2026-' \"\$f\"); [ \"\$n\" -ge 11 ] && [ \"\$(grep -c '^\\*\\*Proposed default:\\*\\*' \"\$f\")\" -ge \"\$n\" ]"
check "docs/data-model.md describes the tables and the M25 migration" bash -c "f=docs/data-model.md; for t in ${TABLES[*]}; do grep -q \"\$t\" \"\$f\" || exit 1; done; grep -q '_m25_governance' \"\$f\" && grep -q 'last_active_at' \"\$f\""
check "the user guide covers the successor, reports, appeals and proposals" bash -c "f=docs/guides/user-guide.bg.md; grep -q '(M25)' \"\$f\" && grep -q '/dashboard/succession' \"\$f\" && grep -q 'Report a lineage error' \"\$f\" && grep -q 'Send the appeal' \"\$f\" && grep -q 'Propose a correction' \"\$f\""
check "the admin guide covers the four new kinds of case" bash -c "f=docs/guides/admin-guide.bg.md; grep -q '(M25)' \"\$f\" && grep -q 'Approve the succession' \"\$f\" && grep -q 'Uphold: open arbitration' \"\$f\" && grep -q 'Reject the appeal' \"\$f\" && grep -q 'Apply the change' \"\$f\""
check "docs/plan/README.md has a status for M25" bash -c 'grep -qE "^\| M25 " docs/plan/README.md && ! grep -qE "^\| M25 .*\| не е започнат \|$" docs/plan/README.md'
check "the technical plan §8.3 has the M25 row" grep -qE '^\| M25 \| \[`docs/plan/M25-governance.md`\]' docs/WingChunRoots_Technical_Plan.bg.md
check "the milestone file has a Progress log with entries" bash -c "awk '/^## Дневник на напредъка/{f=1;next} f && /^- /{n++} END{exit !(n>0)}' docs/plan/M25-governance.md"
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  for guide in docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md; do
    check "$guide changed in this branch (differs from the merge base with origin/main)" bash -c "! git diff --quiet $base -- $guide"
  done
else
  ok "the guides changed in this branch: not checkable here (merged, or no origin/main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M25 checks: $failures failed"
  exit 1
fi
echo "M25 checks: all passed"
