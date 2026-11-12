#!/usr/bin/env bash
# Milestone M23 checks (docs/plan/M23-federation-billing.md, "Done when"), run by scripts/verify.sh
# after the unit tests (src/server/services/federation-billing.test.ts, src/server/billing/billing.test.ts
# and src/server/templates/catalog.test.ts among them), the integration tests
# (src/server/services/federation-billing.int.test.ts and the rows of the authorization matrix),
# db:check, db:reset+migrate+seed, the build and E2E (`@smoke|@M23`:
# e2e/m23-federation-billing-view.spec.ts on the desktop and phone projects;
# e2e/m23-federation-billing.spec.ts, which creates federations, trials and subscriptions, in the
# exclusive run). They stay valid after M23, so `scripts/verify.sh all` keeps running them.
#
# Here: required files, no new dependency and test mode only, the one migration and its grants, who
# buys Federation and what is sold, the plan changes, the trial and its daily run, downstream
# independence, the procedures and the contract, the notices, the decisions by default, the E2E and
# integration titles, and the documentation.
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

SERVICE=src/server/services/billing.ts
TRIALS=src/server/services/federation-trials.ts
PLANS=src/server/entitlements/plans.ts
TEST_PROVIDER=src/server/billing/test-provider.ts
STRIPE=src/server/billing/stripe.ts
COMMON=src/server/db/schema/common.ts
CATALOG=src/server/templates/catalog.ts
TEMPLATES=src/server/templates/notifications.ts
ROUTER=src/server/rpc/router.ts
PARITY=src/server/rpc/parity.ts
ORG_PAGE='src/app/dashboard/organization/[id]/billing/page.tsx'
ADMIN_PAGE='src/app/admin/organizations/[id]/page.tsx'
CHECKOUT_PAGE='src/app/billing/test-checkout/[id]/page.tsx'
SPEC=e2e/m23-federation-billing.spec.ts
VIEW_SPEC=e2e/m23-federation-billing-view.spec.ts
INT=src/server/services/federation-billing.int.test.ts
UNIT=src/server/services/federation-billing.test.ts
mapfile -t M23_SQL < <(ls drizzle/*_m23_federation_billing/migration.sql 2>/dev/null)

# 1. Required files (Done when 4) ------------------------------------------------------------------
required=(
  "$SERVICE" "$TRIALS" "$PLANS" "$TEST_PROVIDER" "$STRIPE" "$CATALOG" "$TEMPLATES" "$ROUTER" "$PARITY"
  "$ORG_PAGE" 'src/app/dashboard/organization/[id]/billing/error.tsx' "$ADMIN_PAGE" "$CHECKOUT_PAGE"
  src/app/dashboard/billing/changes.tsx src/app/dashboard/billing/forms.tsx src/app/admin/organizations/forms.tsx
  "$SPEC" "$VIEW_SPEC" "$INT" "$UNIT"
  docs/adr/0026-federation-billing.md docs/plan/M23-federation-billing.md docs/plan/questions/M23.md docs/plan/deferred-minors.md
  docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md docs/data-model.md docs/entitlements.md
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done

# 2. No new dependency, test mode only, no secret in the repository (CLAUDE.md §3, §12, §16) ---------
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  check "package.json and the lockfile are unchanged in this branch (no new dependency)" git diff --quiet "$base" -- package.json pnpm-lock.yaml
else
  ok "no new dependency: not checkable here (merged, or no origin/main in this checkout)"
fi
refute "nothing imports a Stripe SDK" grep -rnE "from '(stripe|@stripe/[^']+)'|require\('stripe'\)" src scripts e2e
refute "the M23 tests build fake keys at run time: no key literal for gitleaks" grep -nE "'(sk|rk)_(live|test)_[A-Za-z0-9]{8,}'|'whsec_[A-Za-z0-9]{8,}'" "$INT" "$UNIT" src/server/billing/billing.test.ts

# 3. One migration and its grants (In scope 6; PostgreSQL 16+) ---------------------------------------
check "exactly one m23_federation_billing migration" test "${#M23_SQL[@]}" -eq 1
if [ "${#M23_SQL[@]}" -eq 1 ]; then
  sql="${M23_SQL[0]}"
  check "the migration creates federation_trial with one trial per organization" bash -c "grep -q 'CREATE TABLE \"federation_trial\"' '$sql' && grep -q 'CREATE UNIQUE INDEX \"federation_trial_organization_key\"' '$sql'"
  check "the migration adds the scheduled change and the trial end" bash -c "grep -q 'scheduled_plan_code' '$sql' && grep -q 'scheduled_interval' '$sql' && grep -q 'scheduled_amount_cents' '$sql' && grep -q 'trial_ends_at' '$sql'"
  check "the migration checks the trial's months (6 or 12) and status" bash -c "grep -q '\"months\" IN (6, 12)' '$sql' && grep -q \"'active', 'converted', 'ended', 'revoked'\" '$sql'"
  check "app_rw gets the rights on federation_trial; app_public_ro none" bash -c "grep -q 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE \"federation_trial\" TO app_rw' '$sql' && grep -q 'REVOKE ALL ON TABLE \"federation_trial\" FROM app_public_ro' '$sql'"
  refute "the migration uses no SQL newer than PostgreSQL 16 (uuidv7(), virtual columns, OLD/NEW in RETURNING)" grep -nEi 'uuidv7\(|VIRTUAL|RETURNING[^;]*\b(OLD|NEW)\.' "$sql"
fi
check "the seed resets federation_trial with the other tables" grep -q 'federationTrial' src/server/db/seed.ts

# 4. Who buys Federation and what is sold (DEFAULT M23, question 1) --------------------------------
check "Federation stays planned in the matrix; it is sold to an organization for what it gives now" bash -c "
  grep -q \"ORGANIZATION_PURCHASABLE_PLANS: readonly PlanCode\[\] = \['federation'\]\" $PLANS && grep -q 'export const FEDERATION_BENEFITS_NOW' $PLANS &&
  awk '/^  federation: \{/{f=1} f && /availability:/{print; exit}' $PLANS | grep -q \"'planned'\""
check "only an owner of an approved federation starts a checkout (403 for another admin, 404 for anyone else)" bash -c "
  grep -q \"role !== 'owner'\" $SERVICE && grep -q \"org.kind !== 'federation'\" $SERVICE && grep -q \"org.status !== 'active'\" $SERVICE &&
  grep -q 'Only an owner of the organization can change its plan.' $SERVICE"
check "the checkout locks the organization's row" bash -c "grep -i -A8 'the organization.s row, locked' $SERVICE | grep -q \".for('update')\""
check "/plans keeps Federation planned and sells nothing itself" bash -c "f=src/app/plans/page.tsx; ! grep -q 'choose-federation' \$f && grep -q 'href=\"/dashboard/organization\"' \$f"
check "the test checkout goes back to the subject's billing page" bash -c "grep -q 'checkout.backHref' '$CHECKOUT_PAGE' && grep -q 'backHref: billingPageOf(row)' $SERVICE"

# 5. Plan changes (DEFAULT M23, question 2) ---------------------------------------------------------
check "an upgrade is now with proration, a downgrade at the period end" bash -c "
  grep -q 'export function changeTiming' $SERVICE && grep -q 'export function prorate' $TEST_PROVIDER && grep -q \"proration_behavior: 'always_invoice'\" $STRIPE"
check "the Stripe adapter refuses a change at the period end instead of guessing" grep -q "change.when !== 'now'" "$STRIPE"
check "both providers take back a scheduled change" bash -c "grep -q 'cancelScheduledChange' $TEST_PROVIDER && grep -q 'cancelScheduledChange' $STRIPE"

# 6. The trial and its daily run (DEFAULT M23, questions 3-5) ---------------------------------------
check "trial defaults: 6 or 12 months, 12 by default, notices 14 and 7 days before" bash -c "
  grep -q 'FEDERATION_TRIAL_MONTHS = \[6, 12\]' $COMMON && grep -q 'FEDERATION_TRIAL_DEFAULT_MONTHS = 12' $COMMON && grep -q 'FEDERATION_TRIAL_NOTICE_DAYS = \[14, 7\]' $COMMON"
check "only an administrator with the second factor starts or ends a trial" bash -c "[ \"\$(grep -c \"requireStaff2FA(principal, \['admin'\])\" $TRIALS)\" -ge 3 ]"
check "the daily job plans.expiry runs the trials" grep -q 'runFederationTrials' src/server/jobs/plan-expiry.ts
check "an expired trial is ended without a charge: no provider call in the trial service" bash -c "! grep -qE 'billingProvider\(|createCheckout|testPay' $TRIALS"
check "a checkout during a trial charges nothing before it ends" bash -c "grep -q 'trialEndsAt' $SERVICE && grep -q 'trial_end' $STRIPE && grep -q 'amount: 0' $TEST_PROVIDER"

# 7. Downstream independence (DEFAULT M23, question 6; specification §10.3) -------------------------
refute "the trial service never touches an account's grant" grep -nE 'subjectUserId|effectivePlan' "$TRIALS"
check "the organization page says member schools and students keep their own plans" grep -q 'Member schools and students keep their own plans' "$ORG_PAGE"

# 8. Procedures, the contract and the Server Actions (In scope 5; CLAUDE.md §15) ---------------------
for p in '/billing/organizations/{organizationId}' '/billing/change-plan' '/billing/cancel-change' '/admin/organizations/{organizationId}/trial' '/admin/organizations/trial/start' '/admin/organizations/trial/end'; do
  check "procedure $p in the router and in docs/api/openapi.json" bash -c "grep -qF \"path: '$p'\" $ROUTER && grep -qF '\"$p\"' docs/api/openapi.json"
done
check "the Server Actions wrap the procedures (parity)" bash -c "
  grep -q 'changePlanAction' $PARITY && grep -q 'cancelChangeAction' $PARITY && grep -q 'startTrialAction' $PARITY && grep -q 'endTrialAction' $PARITY"
check "the authorization matrix has the M23 rows" bash -c "f=src/server/rpc/authz-matrix.int.test.ts; for p in billing.organization billing.changePlan billing.cancelChange federationTrials.adminGet federationTrials.start federationTrials.end; do grep -q \"path: '\$p'\" \$f || exit 1; done"

# 9. Notices (DEFAULT M23, question 5) -------------------------------------------------------------
check "the trial notices are plan notices; the change notices billing notices" bash -c "
  grep -q \"'federation.trial-started': mailed('plan', 'notice')\" $CATALOG && grep -q \"'federation.trial-ending': mailed('plan', 'notice')\" $CATALOG &&
  grep -q \"'federation.trial-ended': mailed('plan', 'notice')\" $CATALOG && grep -q \"'billing.plan-changed': mailed('billing', 'notice')\" $CATALOG &&
  grep -q \"'billing.change-scheduled': mailed('billing', 'notice')\" $CATALOG"
check "an organization's notices give each admin an e-mail of its own" grep -q 'sharedKey' src/server/services/notify.ts

# 10. Decisions by default (CLAUDE.md §8) ----------------------------------------------------------
for n in 1 2 3 4 5 6; do
  check "DEFAULT M23 (question $n) is marked in the code" bash -c "grep -rqE 'DEFAULT M23[ ,(]+question $n\b' src"
done
check "questions/M23.md has six questions, each with a proposed default" bash -c "
  f=docs/plan/questions/M23.md; n=\$(grep -c '^## 2026-11-11 — M23 — ' \"\$f\"); [ \"\$n\" -ge 6 ] && [ \"\$(grep -c '^\\*\\*Proposed default:\\*\\*' \"\$f\")\" -ge \"\$n\" ]"

# 11. E2E and integration titles (Done when 3) -----------------------------------------------------
spec_titles=(
  '@M23 an administrator starts a trial without a card; the owner continues yearly and nothing is charged before it ends'
  '@M23 monthly to yearly now, monthly again at the period end and taken back; a co-admin only reads'
  '@M23 downstream independence: a member student keeps Premium Student when the trial ends early and when the subscription ends'
)
for t in "${spec_titles[@]}"; do
  check "E2E test: $t" grep -qF "$t" "$SPEC"
done
view_titles=(
  '@M23 the owner of the demo federation: its plan, what it gives now and the monthly and yearly offers'
  '@M23 an admin who is not an owner reads the page without a form; another account gets 404'
  '@M23 the administrator’s page of the demo federation says why no trial can start'
  '@M23 /plans points the owner of an approved federation to the billing page, and sells nothing itself'
)
for t in "${view_titles[@]}"; do
  check "E2E test: $t" grep -qF "$t" "$VIEW_SPEC"
done
check "the E2E runs axe in both themes and checks 44 px targets on a phone" bash -c "
  grep -q 'expectNoAxeViolations' $SPEC && grep -q 'for (const theme of THEMES)' $SPEC && grep -q 'toBeGreaterThanOrEqual(44)' $VIEW_SPEC && grep -q \"startsWith('mobile')\" $VIEW_SPEC"
check "the writing spec runs alone (PUBLIC_WRITE_SPECS), the view spec in the desktop and phone projects" bash -c "grep -q \"'\\*\\*/m23-federation-billing.spec.ts'\" e2e/projects.ts && ! grep -q 'm23-federation-billing-view' e2e/projects.ts"
check "the organization billing page and the trial section are screen states" bash -c "f=e2e/screenshots.spec.ts; grep -qF 'organization-billing-\${who}' \$f && grep -qF \"name: 'admin-organization-trial'\" \$f"
int_titles=(
  'the owner of an approved federation subscribes monthly ($99) with the test card; the plan follows the applied events'
  'yearly costs $990 and is billed once a year'
  'refuses another admin, a non-admin, an association, an organization not yet approved, an individual purchase and another account’s checkout'
  'monthly to yearly takes effect now with the unused part credited; yearly to monthly waits for the period end and can be taken back'
  'an administrator starts a 12-month trial with no card; the admins are told; one trial per organization'
  'a reminder 14 days and 7 days before the end, each once; then the trial simply ends: no charge, nothing deleted'
  'subscribing during the trial: nothing is charged until the trial ends, then the chosen price'
  'a cancelled federation subscription that ends leaves the member school’s Professional Sifu and the student’s Premium Student as they are'
  'a federation subscription that lapses after a failed renewal and its grace leaves the members’ plans as they are'
  'an expired or ended federation trial leaves the members’ plans as they are'
)
for t in "${int_titles[@]}"; do
  check "integration test: $t" grep -qF "$t" "$INT"
done

# 12. Documentation (In scope 8) -------------------------------------------------------------------
check "ADR 0026 records the buyer, the changes, the trial and downstream independence" bash -c "
  f=docs/adr/0026-federation-billing.md; grep -q 'DEFAULT M23' \"\$f\" && grep -q 'federation_trial' \"\$f\" && grep -q 'always_invoice' \"\$f\" && grep -q '§10.3' \"\$f\" && grep -q 'runFederationTrials' \"\$f\""
check "docs/data-model.md describes federation_trial and the M23 migration" bash -c "f=docs/data-model.md; grep -q 'federation_trial' \"\$f\" && grep -q 'scheduled_plan_code' \"\$f\" && grep -q '_m23_federation_billing' \"\$f\""
check "docs/entitlements.md has the Federation section" grep -q '(M23)' docs/entitlements.md
check "the user guide covers Federation billing and the trial" bash -c "f=docs/guides/user-guide.bg.md; grep -q '(M23)' \"\$f\" && grep -q 'Choose yearly billing' \"\$f\" && grep -q 'Trial running' \"\$f\""
check "the admin guide covers the trial form and the daily run" bash -c "f=docs/guides/admin-guide.bg.md; grep -q '(M23)' \"\$f\" && grep -q 'Start the trial' \"\$f\" && grep -q 'runFederationTrials' \"\$f\""
check "the deferred note on guardians and minors is linked from docs/plan/README.md" grep -q '(deferred-minors.md)' docs/plan/README.md
check "docs/plan/README.md has a status for M23" bash -c 'grep -qE "^\| M23 " docs/plan/README.md && ! grep -qE "^\| M23 .*\| не е започнат \|$" docs/plan/README.md'
check "the technical plan §8.3 has the M23 row" grep -qE '^\| M23 \| \[`docs/plan/M23-federation-billing.md`\]' docs/WingChunRoots_Technical_Plan.bg.md
check "the milestone file has a Progress log with entries" bash -c "awk '/^## Дневник на напредъка/{f=1;next} f && /^- /{n++} END{exit !(n>0)}' docs/plan/M23-federation-billing.md"
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  for guide in docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md; do
    check "$guide changed in this branch (differs from the merge base with origin/main)" bash -c "! git diff --quiet $base -- $guide"
  done
else
  ok "the guides changed in this branch: not checkable here (merged, or no origin/main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M23 checks: $failures failed"
  exit 1
fi
echo "M23 checks: all passed"
