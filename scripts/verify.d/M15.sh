#!/usr/bin/env bash
# Milestone M15 checks (docs/plan/M15-organizations.md, "Done when"), run by scripts/verify.sh after
# the unit tests (src/server/dto/organizations.test.ts: the public DTOs drop every private field;
# src/server/services/organizations.test.ts: the input and the plans an organization can get), the
# integration tests (src/server/services/organizations.int.test.ts and the organization rows of the
# authorization matrix), db:check, db:reset+migrate+seed, the build with the bundle budgets and E2E
# (`@smoke|@M15`; the M15 spec approves organizations, so it runs in the exclusive run after the
# others, e2e/projects.ts). They stay valid after M15, so `scripts/verify.sh all` keeps running them.
#
# Here: required files, the one migration and the public view, the separate records (D12), the
# review kind, the procedures and their Server Actions, the plan (D08, D09), the decisions by
# default, the UI rules, the E2E and integration titles, and the documentation.
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

SERVICE=src/server/services/organizations.ts
REVIEW=src/server/services/organization-review.ts
GRANTS=src/server/services/organization-grants.ts
DTO=src/server/dto/organizations.ts
SCHEMA=src/server/db/schema/organizations.ts
SPEC=e2e/m15-organizations.spec.ts
INT=src/server/services/organizations.int.test.ts
MATRIX=src/server/rpc/authz-matrix.int.test.ts
PUBLIC_PAGE='src/app/organizations/[slug]/page.tsx'
MANAGE='src/app/dashboard/organization/[id]/page.tsx'
mapfile -t M15_SQL < <(ls drizzle/*_m15_organizations/migration.sql 2>/dev/null)

# 1. Required files (Done when 5) ------------------------------------------------------------------
required=(
  "$SERVICE" "$REVIEW" "$GRANTS" "$DTO" "$SCHEMA" "$SPEC" "$INT" "$PUBLIC_PAGE" "$MANAGE"
  src/app/organizations/page.tsx src/app/dashboard/organization/page.tsx src/app/dashboard/organization/apply/page.tsx
  src/app/dashboard/organization/actions.ts src/app/dashboard/organization/forms.tsx src/app/dashboard/schools/organization-links.tsx
  src/app/admin/organizations/page.tsx 'src/app/admin/organizations/[id]/page.tsx' src/app/admin/organizations/actions.ts
  src/app/admin/review/organization.tsx src/server/dto/organizations.test.ts src/server/services/organizations.test.ts
  docs/adr/0018-organizations.md docs/plan/M15-organizations.md docs/plan/questions/M15.md
  docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done

# 2. One migration and the public view (In scope 1) ------------------------------------------------
check "exactly one M15 migration (m15_organizations), with its snapshot" bash -c '
  [ "'"${#M15_SQL[@]}"'" -eq 1 ] && [ -s "$(dirname "'"${M15_SQL[0]:-none}"'")/snapshot.json" ]'
if [ "${#M15_SQL[@]}" -eq 1 ]; then
  SQL="${M15_SQL[0]}"
  check "the migration creates organization_admin and organization_school and links review_case to an organization" bash -c "
    grep -q 'CREATE TABLE \"organization_admin\"' '$SQL' && grep -q 'CREATE TABLE \"organization_school\"' '$SQL' && grep -q '\"organization_id\" uuid' '$SQL'"
  check "app_public_ro has no right on the organization tables" bash -c "
    grep -q 'REVOKE ALL ON TABLE' '$SQL' && grep -q 'FROM app_public_ro;' '$SQL' && for t in organization organization_admin organization_membership organization_school; do grep -q \"\\\"\$t\\\"\" '$SQL' || exit 1; done"
  check "v_public_organization lists approved, undeleted organizations only, behind a security barrier" bash -c "
    grep -q 'CREATE VIEW \"v_public_organization\" WITH (security_barrier = true)' '$SQL' && grep -q \"o.\\\"status\\\" = 'active'\" '$SQL' && grep -q 'o.\"deleted_at\" IS NULL' '$SQL' &&
    grep -q 'GRANT SELECT ON TABLE \"v_public_organization\" TO app_rw, app_public_ro;' '$SQL'"
  refute "the public view has no leader, applicant, estimate or admin column" bash -c "sed -n '/^CREATE VIEW \"v_public_organization\"/,/;/p' '$SQL' | grep -E 'leader|created_by|schools_estimate|approved_by'"
  refute "the migration stays on PostgreSQL 16+ (no uuidv7(), no virtual generated columns, no OLD/NEW in RETURNING)" \
    grep -nEi "uuidv7\(|VIRTUAL|RETURNING[^;]*\b(OLD|NEW)\." "$SQL"
fi
check "one active admin row per account, one open link per school, one open case per organization (schema)" bash -c "
  grep -q 'organization_admin_one_active_key' $SCHEMA && grep -q 'organization_school_one_open_key' $SCHEMA &&
  grep -q 'review_case_one_open_per_organization_key' src/server/db/schema/evidence.ts"

# 3. Separate records and the review (In scope 2, 3; DEFAULT D12, D04) -----------------------------
check "DEFAULT D12: admins (accounts), memberships (people) and teaching relationships are separate records" bash -c "
  grep -q 'DEFAULT D12' $SCHEMA && grep -q 'export const organizationAdmin' $SCHEMA && grep -q 'export const organizationMembership' $SCHEMA"
# Code lines only: the comments name what the services never do.
code_only() { grep -hvE '^[[:space:]]*(//|\*|/\*)' "$@"; }
refute "no organization service writes a teaching relationship or a person's visibility" \
  bash -c "$(declare -f code_only); code_only $SERVICE $REVIEW $GRANTS | grep -nE 'teachingRelationship|teaching_relationship|relationshipEvent|update\(person\)|visibility:'"
check "organization_application is a review kind decided by an archivist or an administrator" bash -c "
  grep -q \"'organization_application'\" src/server/db/schema/common.ts &&
  grep -qF \"organization_application: ['archivist', 'admin']\" src/server/services/review-core.ts"
check "the applicant and the organization's admins are parties to its case (nobody reviews their own)" bash -c "
  grep -q 'organizationId' src/server/services/review-core.ts && grep -q 'organizationAdmin' src/server/services/review-core.ts"
check "an approval needs the version of the application on the card (CONFLICT when it changed)" bash -c "
  grep -q 'organizationVersion' $REVIEW && grep -q 'organizationVersion' src/server/services/review.ts &&
  grep -q 'name=\"organizationVersion\"' src/app/admin/review/forms.tsx"
check "DEFAULT D04: approval, plan and verification are shown apart" bash -c "
  grep -q 'DEFAULT D04' $REVIEW && grep -q 'DEFAULT D04' '$MANAGE' && grep -q 'organization-plan' '$MANAGE' && grep -q 'organization-approval' '$MANAGE'"
check "the supporting document is private evidence of the case (DEFAULT D13/D25)" bash -c "
  grep -q 'DEFAULT D13/D25' $SERVICE && grep -q 'linkOptionalFilesToCase' $SERVICE && grep -q \"'organization_application'\" src/server/services/evidence.ts"

# 4. The public page (In scope 4; DEFAULT D03; plan §6.4) ------------------------------------------
check "the public reads use v_public_organization, v_public_person and v_public_school only, through the DTO" bash -c "
  grep -q 'FROM v_public_organization' $SERVICE && grep -q 'JOIN v_public_person' $SERVICE && grep -q 'JOIN v_public_school' $SERVICE &&
  grep -q 'toPublicOrganizationPage' $SERVICE && grep -q 'toPublicOrganizationList' $SERVICE"
refute "the public DTO names no leader, applicant, admin, plan, document or point" \
  bash -c "$(declare -f code_only); code_only $DTO | grep -nE 'leader(Name|Title)|createdBy|admins|plan|evidence|lat|lng|point'"
refute "the public page reads no private field" grep -nE "leaderName|leaderTitle|schoolsEstimate|\.plan\b|admins" "$PUBLIC_PAGE"
check "names on the public page carry lang and translate=no (NameText)" grep -q 'NameText' "$PUBLIC_PAGE"
check "the public page says that approval is not a verification" grep -q 'That is not a verification of its members' "$PUBLIC_PAGE"

# 5. The procedures and the Server Actions (In scope 8; plan §6.8) ---------------------------------
mkdir -p .verify
check "pnpm api:openapi --check: docs/api/openapi.json matches the router (log: .verify/M15-openapi.log)" bash -c '
  pnpm --silent api:openapi --check > .verify/M15-openapi.log 2>&1'
check "the contract has every organizations.* procedure" node -e "
  const doc = require('./docs/api/openapi.json');
  const ops = Object.values(doc.paths).flatMap((p) => Object.values(p)).map((o) => o.operationId);
  const want = ['list','mine','options','schoolLinks','manage','get','apply','update','addAdmin','removeAdmin','addMember','endMember','requestSchool','answerSchoolLink','endSchoolLink','adminList','adminGet','grant','revokeGrant'];
  for (const id of want) if (!ops.includes('organizations.' + id)) { console.error(id); process.exit(1); }"
check "every M15 Server Action is in the API parity table" bash -c "
  for a in applyOrganizationAction updateOrganizationAction addOrganizationAdminAction removeOrganizationAdminAction addOrganizationMemberAction \
    endOrganizationMemberAction requestOrganizationSchoolAction endOrganizationSchoolAction answerOrganizationLinkAction endOrganizationLinkAction \
    grantOrganizationPlanAction revokeOrganizationPlanAction; do grep -q \"#\$a'\" src/server/rpc/parity.ts || exit 1; done"
check "the authorization matrix has a row for every organizations.* procedure, with another organization's admin" bash -c "
  for p in list mine options schoolLinks manage get apply update addAdmin removeAdmin addMember endMember requestSchool answerSchoolLink endSchoolLink adminList adminGet grant revokeGrant; do
    grep -qF \"path: 'organizations.\$p'\" $MATRIX || exit 1; done && grep -q 'otherOrganizationAdmin' $MATRIX"
refute "the M15 Server Actions import no service or database module" grep -nE "from '@/server/(services|db)" src/app/dashboard/organization/actions.ts src/app/admin/organizations/actions.ts
check "every organization action is audited" bash -c "
  for a in apply update approve reject admin_add admin_remove member_add member_end school_request school_answer school_end; do
    grep -q \"'organization.\$a'\" src/server/audit/index.ts || exit 1; done"
check "the organization notifications are templates of src/server/templates" bash -c "
  for t in organization.reviewed organization.admin_added organization.school_requested organization.school_answered; do grep -q \"'\$t'\" src/server/templates/notifications.ts || exit 1; done"
check "an admin of an organization the account does not administer is 404 (managed)" bash -c "
  grep -q 'async function managed' $SERVICE && grep -q \"if (!role) throw notFound();\" $SERVICE"

# 6. The plan (In scope 7; DEFAULT D08, D09) -------------------------------------------------------
check "DEFAULT D09: Federation is given to organizations through its own list; GRANTABLE_PLANS is unchanged" bash -c "
  f=src/server/entitlements/plans.ts; grep -qF \"export const ORGANIZATION_GRANTABLE_PLANS: readonly PlanCode[] = ['federation'];\" \"\$f\" &&
  ! grep -E '^export const GRANTABLE_PLANS' \"\$f\" | grep -q federation"
check "DEFAULT D08: administration needs approval and an active Federation grant; revoking keeps the rest" bash -c "
  grep -q 'async function requireAdministration' $SERVICE && grep -q 'DEFAULT D08' $SERVICE && grep -q 'DEFAULT D08' $GRANTS"
check "an organization is an entitlement subject" grep -q "kind: 'organization'" src/server/entitlements/access.ts
check "only an administrator with a verified second factor gives or revokes the plan" bash -c "
  grep -q \"requireStaff2FA(principal, \\['admin'\\])\" $GRANTS && grep -qF \"'/admin/organizations': { kind: 'staff2fa', roles: ['admin'] }\" src/server/auth/guards.ts"

# 7. The interface (In scope 5, 6; CLAUDE.md §10) --------------------------------------------------
check "the edit rules: a pending organization edits only its application; an approved one keeps name, kind and country" bash -c "
  grep -qF \"const REVIEWED_FIELDS = ['name', 'kind', 'countryCode'] as const;\" $SERVICE && grep -q 'editApplication' '$MANAGE'"
check "the school's account answers a link on /dashboard/schools (Accept, Refuse, End link)" bash -c "
  f=src/app/dashboard/schools/organization-links.tsx; grep -q 'Accept' \"\$f\" && grep -q 'Refuse' \"\$f\" && grep -q 'End link' \"\$f\" && grep -q 'id=\"organizations\"' src/app/dashboard/schools/page.tsx"
check "the case card shows the organization" grep -q 'OrganizationSection' 'src/app/admin/review/[id]/page.tsx'
refute "no window.open, no 100vh, no asChild in the M15 screens" grep -rnE "window\.open|100vh|asChild" src/app/organizations src/app/dashboard/organization src/app/admin/organizations src/app/admin/review/organization.tsx src/app/dashboard/schools/organization-links.tsx
refute "no size 'sm' buttons in the M15 forms (44 px targets on phones)" grep -nE "size: 'sm'" src/app/dashboard/organization/forms.tsx src/app/admin/organizations/forms.tsx src/app/dashboard/schools/organization-links.tsx
check "the new pages are in e2e/routes.ts for axe in both themes" bash -c "
  for p in \"path: '/organizations'\" \"path: '/organizations/demo-federation-north'\" \"path: '/dashboard/organization'\" \"path: '/dashboard/organization/apply'\" \"path: '/admin/organizations'\"; do
    grep -qF \"\$p\" e2e/routes.ts || exit 1; done"

# 8. Demo data (D20) -------------------------------------------------------------------------------
refute "the seeded organizations are demo- records only" bash -c "grep -oE \"slug: '[a-z0-9-]+', name: '[^']+', kind: '(federation|association|school_group)'\" src/fixtures/generate.ts | grep -v \"slug: 'demo-\""

# 9. E2E and integration titles (Done when 3, 4) ---------------------------------------------------
titles=(
  '@M15 an account applies with the keyboard, an archivist approves, and the public page shows only public data'
  '@M15 another organization’s admin gets “not found”, in the page and through the API'
  '@M15 an administrator gives Federation, the owner lists a public member, and revoking keeps the member public'
)
for title in "${titles[@]}"; do
  check "E2E test: $title" grep -qF "$title" "$SPEC"
done
check "the E2E runs axe in both themes" bash -c "grep -q 'expectNoAxeViolations' $SPEC && grep -q 'for (const theme of THEMES)' $SPEC"
check "the M15 spec runs in the exclusive run, after the others (PUBLIC_WRITE_SPECS)" \
  grep -qE "^export const PUBLIC_WRITE_SPECS = \[.*'\*\*/m15-organizations\.spec\.ts'.*\] as const;$" e2e/projects.ts
int_titles=(
  'opens a case, an archivist approves it, and the page lists only public data'
  'refuses an approval from a card older than the application (CONFLICT), and a moderator’s approval (FORBIDDEN)'
  'a pending organization edits every field of its application; an approved one keeps its name, kind and country'
  'answers 404 for every read and write of another organization'
  'lists only public people; needs Federation; revoking keeps the members, links, page and user grants'
  'accept, refuse and end leave the school row as it was, and the page names only the city'
  'app_public_ro reads v_public_organization only, and a pending organization is not in it'
)
for title in "${int_titles[@]}"; do
  check "integration test: $title" grep -qF "$title" "$INT"
done

# 10. Documentation (In scope 10) ------------------------------------------------------------------
check "ADR 0018 records the separate records, the review, the edit rule, the public view and the plan" bash -c "
  f=docs/adr/0018-organizations.md; grep -q 'DEFAULT D12' \"\$f\" && grep -q 'organization_application' \"\$f\" && grep -q 'v_public_organization' \"\$f\" &&
  grep -q 'ORGANIZATION_GRANTABLE_PLANS' \"\$f\" && grep -q 'DEFAULT D08, D09' \"\$f\" && grep -q 'Чакаща организация редактира само своята кандидатура' \"\$f\""
check "docs/data-model.md describes organization_admin, organization_school and v_public_organization" bash -c "
  f=docs/data-model.md; grep -q 'organization_admin' \"\$f\" && grep -q 'organization_school' \"\$f\" && grep -q 'v_public_organization' \"\$f\""
check "the user guide covers applying, the dashboard, members, schools and the school's answer" bash -c "
  f=docs/guides/user-guide.bg.md; grep -q '## Организации (M15)' \"\$f\" && grep -q 'Apply for an organization' \"\$f\" && grep -q 'Add member' \"\$f\" && grep -q 'Accept' \"\$f\""
check "the admin guide covers the review, the plan and the rights" bash -c "
  f=docs/guides/admin-guide.bg.md; grep -q '## 21. Организации (M15)' \"\$f\" && grep -q 'Give Federation' \"\$f\" && grep -q 'organization.approve\\|\`approve\`' \"\$f\""
check "docs/plan/README.md has a status for M15" bash -c '! grep -qE "^\| M15 .*\| не е започнат \|$" docs/plan/README.md'
check "the milestone file has a Progress log with entries" bash -c "awk '/^## Дневник на напредъка/{f=1;next} f && /^- /{n++} END{exit !(n>0)}' docs/plan/M15-organizations.md"
# Done when, item 5: both guides change in the milestone's branch. Checkable while the branch is not
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
  echo "M15 checks: $failures failed"
  exit 1
fi
echo "M15 checks: all passed"
