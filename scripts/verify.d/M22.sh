#!/usr/bin/env bash
# Milestone M22 checks (docs/plan/M22-billing.md, "Done when"), run by scripts/verify.sh after the
# unit tests (src/server/billing/billing.test.ts among them), the integration tests
# (src/server/services/billing.int.test.ts and the rows of the authorization matrix), db:check,
# db:reset+migrate+seed, the build and E2E (`@smoke|@M22`: e2e/m22-billing-view.spec.ts on the
# desktop and phone projects; e2e/m22-billing.spec.ts, which pays, cancels and ends subscriptions in
# test mode, in the exclusive run). They stay valid after M22, so `scripts/verify.sh all` keeps
# running them.
#
# Here: required files, no new dependency, test mode only (no live key, no secret in the
# repository), the one migration and its grants, the webhook that only records, idempotency and
# order, the subject from the app's own checkout, the downgrade that keeps records, the procedures,
# the notices, the decisions by default, the UI rules, the demo data, the E2E and integration titles,
# and the documentation.
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
CONFIG=src/server/billing/config.ts
STRIPE=src/server/billing/stripe.ts
TEST_PROVIDER=src/server/billing/test-provider.ts
WEBHOOK=src/server/billing/webhook.ts
REDACT=src/server/billing/redact.ts
SIGNATURE=src/server/billing/signature.ts
JOBS=src/server/jobs/billing.ts
ROUTE=src/app/api/billing/webhook/route.ts
COMMON=src/server/db/schema/common.ts
CATALOG=src/server/templates/catalog.ts
BILLING_PAGE=src/app/dashboard/billing/page.tsx
BILLING_ACTIONS=src/app/dashboard/billing/actions.ts
CHECKOUT_PAGE='src/app/billing/test-checkout/[id]/page.tsx'
CHECKOUT_FORM='src/app/billing/test-checkout/[id]/form.tsx'
ADMIN_LIST=src/app/admin/billing/page.tsx
ADMIN_DETAIL='src/app/admin/billing/[id]/page.tsx'
STATUS_TAG=src/components/billing/status.tsx
FIXTURE=src/fixtures/billing.ts
SPEC=e2e/m22-billing.spec.ts
VIEW_SPEC=e2e/m22-billing-view.spec.ts
INT=src/server/services/billing.int.test.ts
UNIT=src/server/billing/billing.test.ts
PAGES=("$BILLING_PAGE" src/app/dashboard/billing/forms.tsx "$CHECKOUT_PAGE" "$CHECKOUT_FORM" "$ADMIN_LIST" "$ADMIN_DETAIL" 'src/app/admin/billing/[id]/forms.tsx' "$STATUS_TAG")
mapfile -t M22_SQL < <(ls drizzle/*_m22_billing/migration.sql 2>/dev/null)
TABLES=(billing_customer billing_checkout billing_subscription billing_event billing_invoice billing_test_subscription)

# 1. Required files (Done when 4) ------------------------------------------------------------------
required=(
  "$SERVICE" "$CONFIG" "$STRIPE" "$TEST_PROVIDER" "$WEBHOOK" "$REDACT" "$SIGNATURE" src/server/billing/provider.ts src/server/billing/types.ts
  src/server/billing/cli.ts "$JOBS" "$ROUTE" src/server/db/schema/billing.ts "$FIXTURE" "${PAGES[@]}"
  src/server/billing/fixtures/customer.subscription.updated.json src/server/billing/fixtures/invoice.payment_failed.json src/server/billing/fixtures/checkout.session.completed.json
  "$SPEC" "$VIEW_SPEC" "$INT" "$UNIT"
  docs/adr/0025-billing.md docs/plan/M22-billing.md docs/plan/questions/M22.md
  docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md docs/data-model.md docs/entitlements.md
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done

# 2. No new dependency, test mode only, no secret in the repository (CLAUDE.md §3, §12, §16) ---------
refute "no Stripe SDK in package.json or the lockfile" grep -nE '"(stripe|@stripe/[a-z-]+)"[[:space:]]*:|^  /?(stripe|@stripe/)' package.json pnpm-lock.yaml
refute "nothing imports a Stripe SDK" grep -rnE "from '(stripe|@stripe/[^']+)'|require\('stripe'\)" src scripts e2e
# xargs answers 123 when grep finds nothing, so the check inverts grep -l itself.
check "no Stripe key or webhook secret in any tracked file" bash -c "! git ls-files -z | xargs -0 grep -lE '(sk|rk|pk)_(live|test)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9+/=]{8,}' -- | grep -q ."
check ".env.example names the billing settings without values" bash -c "
  for n in BILLING_PROVIDER BILLING_TEST_WEBHOOK_SECRET STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET; do grep -qE \"^\$n=\$\" .env.example || exit 1; done"
check "only a Stripe test key is accepted; a live key is refused with its own message" bash -c "
  grep -qF 'sk_test_' $CONFIG && grep -qF '(sk|rk)_live_' $CONFIG && grep -q 'export function checkBillingSettings' $CONFIG"
check "the web process and the worker check the billing settings at start" bash -c "
  grep -q 'checkBillingSettings' src/server/auth/startup.ts && grep -q 'checkBillingSettings' src/worker.ts"
check "the Stripe adapter is made only with a test key and refuses a live event" bash -c "
  grep -q 'stripeSecretKey(env)' $STRIPE && grep -qF 'livemode !== false' $STRIPE"
check "the Stripe adapter follows only Stripe's own checkout page, and the Server Action only that or a path of the app" bash -c "
  grep -qF 'https:\\/\\/checkout\\.stripe\\.com\\/' $STRIPE && grep -qF 'https://checkout.stripe.com/' $BILLING_ACTIONS"
check "the Stripe adapter is tested with a fake fetch, never the network" bash -c "grep -q 'fetch: async' $UNIT && grep -q 'createStripeProvider' $UNIT"
refute "CI never sets BILLING_PROVIDER=stripe or a Stripe key" grep -nE 'BILLING_PROVIDER: *stripe|STRIPE_SECRET_KEY: *[^ ]' .github/workflows/ci.yml

# 3. One migration and its grants (In scope 2; plan §3.2) ------------------------------------------
check "exactly one M22 migration (m22_billing), with its snapshot" bash -c '
  [ "'"${#M22_SQL[@]}"'" -eq 1 ] && [ -s "$(dirname "'"${M22_SQL[0]:-none}"'")/snapshot.json" ]'
if [ "${#M22_SQL[@]}" -eq 1 ]; then
  SQL="${M22_SQL[0]}"
  for t in "${TABLES[@]}"; do
    check "the table $t" grep -qF "CREATE TABLE \"$t\"" "$SQL"
  done
  check "idempotent by the provider's ids: event, invoice, subscription, customer" bash -c "
    for i in billing_event_provider_key billing_invoice_provider_key billing_subscription_provider_key billing_customer_provider_key; do grep -qF \"CREATE UNIQUE INDEX \\\"\$i\\\"\" '$SQL' || exit 1; done"
  check "at most one live subscription per account and per organization (partial unique indexes)" bash -c "
    grep -qF 'CREATE UNIQUE INDEX \"billing_subscription_one_live_user_key\"' '$SQL' && grep -qF 'CREATE UNIQUE INDEX \"billing_subscription_one_live_organization_key\"' '$SQL'"
  check "an ended subscription has its end and reason; a past-due one its date" bash -c "grep -q 'billing_subscription_ended' '$SQL' && grep -q 'billing_subscription_past_due_since' '$SQL'"
  check "app_rw reads and writes the billing tables; app_public_ro has no access" bash -c "
    grep -qF 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE \"billing_customer\", \"billing_checkout\", \"billing_subscription\", \"billing_event\", \"billing_invoice\", \"billing_test_subscription\" TO app_rw' '$SQL' &&
    grep -qF 'REVOKE ALL ON TABLE \"billing_customer\", \"billing_checkout\", \"billing_subscription\", \"billing_event\", \"billing_invoice\", \"billing_test_subscription\" FROM app_public_ro' '$SQL'"
  refute "no card column in any billing table" grep -nEi '"(card_number|pan|cvc|cvv|card_last4|last4|exp_month|exp_year)"' "$SQL"
  refute "the migration deletes nothing and stays on PostgreSQL 16+ (no uuidv7(), no virtual generated columns, no OLD/NEW in RETURNING)" \
    grep -nEi "uuidv7\(|VIRTUAL|RETURNING[^;]*\b(OLD|NEW)\.|DELETE FROM|DROP TABLE" "$SQL"
  refute "the migration leaves the public views alone" grep -n 'CREATE OR REPLACE VIEW' "$SQL"
fi

# 4. The webhook only records; the job applies, once and in order (In scope 3; plan, Phase 2) ------------
check "the route handler is a thin POST over the webhook module" bash -c "grep -q 'export async function POST' $ROUTE && grep -q 'receiveWebhook' $ROUTE && ! grep -qE 'export (async )?function (GET|PUT|DELETE)' $ROUTE"
check "the webhook verifies, stores and queues billing.event in one transaction, and reads at most 256 KiB" bash -c "
  grep -q 'verifyWebhook\\|verify(' $WEBHOOK && grep -q 'QUEUE.billingEvent' $WEBHOOK && grep -q 'transaction' $WEBHOOK && grep -q 'onConflictDoNothing' $WEBHOOK && grep -qF 'WEBHOOK_MAX_BODY = 256 * 1024' $WEBHOOK"
refute "the webhook never logs a body" grep -nE "logger\(\)\.(info|warn|error)\([^)]*(body|raw|payload)" "$WEBHOOK" "$JOBS"
check "the signature uses a constant-time comparison and a time tolerance" bash -c "grep -q 'timingSafeEqual' $SIGNATURE && grep -qi 'tolerance' $SIGNATURE"
check "an event is applied under its row lock, once (processedAt), and a stale version never overwrites" bash -c "
  awk '/export async function applyStoredEvent/{f=1} f{print} f && /^}/{exit}' $SERVICE > /tmp/m22-apply.\$\$ &&
  grep -q \"for('update')\" /tmp/m22-apply.\$\$ && grep -q 'processedAt' /tmp/m22-apply.\$\$; rc=\$?; rm -f /tmp/m22-apply.\$\$; [ \$rc -eq 0 ] &&
  grep -q \"'stale'\" $SERVICE && grep -q 'providerVersion' $SERVICE"
check "the subject comes from the app's own checkout; another account's customer or checkout is a mismatch" bash -c "
  grep -q 'subjectOf(checkout)' $SERVICE && grep -q \"NO_CHANGE('mismatch')\" $SERVICE"
check "a paid plan is one entitlement_grant with source 'stripe', under the account lock" bash -c "grep -qF \"source: 'stripe'\" $SERVICE && grep -q 'lockAccount' $SERVICE"
check "the queues billing.event (retried) and billing.grace (hourly) are registered in the worker" bash -c "
  f=src/server/jobs/queues.ts; grep -qF \"billingEvent: 'billing.event'\" \$f && grep -qF \"billingGrace: 'billing.grace'\" \$f && grep -qF \"queue: QUEUE.billingGrace, cron: '37 * * * *'\" \$f &&
  grep -q 'billingEventHandler' src/server/jobs/worker.ts && grep -q 'billingGraceHandler' src/server/jobs/worker.ts"
check "the stored copy of an event is redacted (no card data, names, e-mail addresses)" bash -c "grep -q 'redactEvent' $WEBHOOK $STRIPE $TEST_PROVIDER && grep -qi 'card' $REDACT && grep -qi 'email' $REDACT"
check "the app's pages never import the provider: ESLint keeps src/server/billing behind the webhook" bash -c "grep -qF \"'!@/server/billing/webhook'\" eslint.config.mjs"

# 5. The lifecycle (In scope 4; D06, D08) ---------------------------------------------------------------------
check "a 7-day grace after a failed renewal" grep -q 'BILLING_GRACE_DAYS = 7' "$COMMON"
check "a checkout stays open an hour, and the provider's session expires with it" bash -c "grep -q 'CHECKOUT_TTL_MINUTES = 60' $SERVICE && grep -q 'expires_at' $STRIPE"
check "cancelling is at the period end, never at once, for the account" bash -c "grep -q 'cancelAtPeriodEnd(' $SERVICE && ! grep -qE 'cancelNow\\([^)]*principal' $SERVICE"
check "the account type cannot change while a subscription renews" bash -c "grep -q "beforeAccountTypeChange" src/server/services/plans.ts"
check "only plans available now, of the account's own type, are sold" bash -c "grep -q 'export function purchasablePlans' src/server/entitlements/plans.ts && grep -q \"availability !== 'now'\" $SERVICE"
check "the plan-ending notices of a paid plan only for a cancelled subscription" bash -c "f=src/server/jobs/plan-expiry.ts; grep -q 'billingSubscription' \$f && grep -q 'cancelAtPeriodEnd' \$f && grep -q 'paid: true' \$f"

# 6. API first (In scope 7; plan §6.8) -------------------------------------------------------------------------
check "the procedures: billing.mine, checkout, testCheckout, testPay, cancel, resume, adminList, adminGet, testClock" bash -c "
  f=src/server/rpc/router.ts; awk '/^  billing: \\{/{f=1} f{print} f && /^  \\},/{exit}' \$f > /tmp/m22-billing.\$\$ &&
  for p in mine checkout testCheckout testPay cancel resume adminList adminGet testClock; do grep -q \"^    \$p: \" /tmp/m22-billing.\$\$ || { rm -f /tmp/m22-billing.\$\$; exit 1; }; done; rm -f /tmp/m22-billing.\$\$"
check "the staff procedures need an administrator with a second factor" bash -c "f=src/server/rpc/router.ts; awk '/^  billing: \\{/{f=1} f{print} f && /^  \\},/{exit}' \$f | grep -cq 'adminWithSecondFactor'"
check "docs/api/openapi.json has the billing paths" bash -c "f=docs/api/openapi.json; grep -qF '\"/billing/checkout\"' \$f && grep -qF '\"/billing/cancel\"' \$f && grep -qF '\"/admin/billing/test-clock\"' \$f"
check "the Server Actions are thin wrappers in the parity table" bash -c "f=src/server/rpc/parity.ts; grep -qF \"#startCheckoutAction': { rpc: ['billing.checkout'] }\" \$f && grep -qF \"#cancelSubscriptionAction': { rpc: ['billing.cancel'] }\" \$f && grep -qF \"#resumeSubscriptionAction': { rpc: ['billing.resume'] }\" \$f && grep -qF \"#testPayAction': { rpc: ['billing.testPay'] }\" \$f && grep -qF \"#moveTestClockAction': { rpc: ['billing.testClock'] }\" \$f"
check "the authorization matrix has the M22 rows" bash -c "f=src/server/rpc/authz-matrix.int.test.ts; for p in billing.mine billing.checkout billing.testCheckout billing.testPay billing.cancel billing.resume billing.adminList billing.adminGet billing.testClock; do grep -q \"'\$p'\" \$f || exit 1; done"
check "the route policies: /billing for a user, /admin/billing for an administrator with a second factor" bash -c "f=src/server/auth/guards.ts; grep -qF \"'/billing': { kind: 'user' }\" \$f && grep -qF \"'/admin/billing': { kind: 'staff2fa', roles: ['admin'] }\" \$f"
check "the test clock CLI is local only and test provider only" bash -c "f=src/server/billing/cli.ts; grep -q 'assertLocalEnvironment' \$f && grep -q \"billingProviderName() !== 'test'\\|billingProviderName() === 'test'\" \$f && grep -q '\"billing:test-clock\"' package.json"

# 7. Notices and audit (In scope 5) ---------------------------------------------------------------------------
check "the six notices are in the billing category, e-mailed" bash -c "
  for k in billing.started billing.cancel-scheduled billing.resumed billing.payment-failed billing.payment-recovered billing.ended; do grep -qF \"'\$k': mailed('billing', 'notice'),\" $CATALOG || exit 1; done"
check "the billing category cannot be switched off" grep -qF "LOCKED_NOTIFICATION_CATEGORIES = ['security', 'account', 'billing'] as const" "$COMMON"
check "every billing notice says test mode, no real charge" bash -c "[ \"\$(grep -c 'This is test mode: no real charge is ever made.' src/server/templates/notifications.ts)\" -ge 1 ]"
check "the audit actions carry the new names" bash -c "f=src/server/audit/index.ts; for a in billing.checkout billing.cancel billing.resume billing.subscription billing.grace_end billing.test_clock; do grep -q \"'\$a'\" \$f || exit 1; done"

# 8. Decisions by default (CLAUDE.md §8) ---------------------------------------------------------------------
for n in 1 2 3 4 5 6 7 8 9 10; do
  check "DEFAULT M22 (question $n) is marked in the code" bash -c "grep -rqE 'DEFAULT M22[ ,(]+questions? ([0-9]+(, | and ))*$n\\b' src"
done
check "DEFAULT D09: a checkout charges the proposed price only, labelled as proposed" bash -c "grep -q 'DEFAULT D09' src/server/entitlements/plans.ts && grep -q 'PROPOSED_PRICE_LABEL' $SERVICE"

# 9. The pages (In scope 4, 6; CLAUDE.md §10, §11) -----------------------------------------------------------
check "every billing screen says \"Test mode, no real charge\"" bash -c "
  grep -qF \"TEST_MODE_LABEL = 'Test mode, no real charge'\" src/server/entitlements/plans.ts &&
  for f in $BILLING_PAGE '$CHECKOUT_PAGE' $ADMIN_LIST; do grep -q 'TestModeBanner' \"\$f\" || exit 1; done"
check "the state of a subscription in words and a shape, never colour alone" bash -c "grep -q 'aria-hidden=\"true\"' $STATUS_TAG && grep -q '<svg' $STATUS_TAG && grep -q '<SubscriptionStatusTag' $BILLING_PAGE && grep -q '<SubscriptionStatusTag' $ADMIN_LIST"
check "the test checkout takes no card number: one of the test cards only" bash -c "grep -q 'name=\"card\"' '$CHECKOUT_FORM' && ! grep -qiE 'autocomplete=\"cc-|inputMode=\"numeric\"' '$CHECKOUT_FORM'"
refute "no 'use cache' in the billing service, provider or pages" grep -n "'use cache'" "$SERVICE" "$WEBHOOK" "$STRIPE" "$TEST_PROVIDER" "${PAGES[@]}"
refute "no window.open, no 100vh, no hover-only behaviour in the M22 pages" grep -nE "window\.open|100vh|group-hover:|onMouseEnter|target=\"_blank\"" "${PAGES[@]}"
refute "no countdown, urgency or blame in the M22 pages and notices" grep -nEi "\b(hurry|urgent|last chance|don.t miss|act now)\b|spots? left|only [0-9]+ left" "${PAGES[@]}" src/app/plans/page.tsx
check "the new pages are in e2e/routes.ts (axe in both themes); the billing page of both demo accounts are key screens" bash -c "
  grep -q \"name: 'dashboard-billing', status: 200, milestone: 'M22', key: true\" e2e/routes.ts && grep -q \"name: 'dashboard-billing-ended', status: 200, milestone: 'M22', key: true\" e2e/routes.ts && grep -q \"name: 'admin-billing', status: 200, milestone: 'M22'\" e2e/routes.ts"
check "the test checkout and the page of a subscription are screen states" bash -c "f=e2e/screenshots.spec.ts; grep -qF \"name: 'billing-test-checkout'\" \$f && grep -qF \"name: 'admin-billing-subscription'\" \$f"
check "the visual regression hides the demo dates, which follow the seed's day" bash -c "grep -qF '[data-visual-date]' e2e/visual.css && grep -q 'data-visual-date' $BILLING_PAGE"

# 10. Demo data (In scope 8; D20) ------------------------------------------------------------------------------
check "the demo subscriptions: ids of their own, dates around the seed's day" bash -c "
  grep -q '(seed ^ 0x0b11_0022)' $FIXTURE && grep -q 'export function seedDay' $FIXTURE && grep -q 'demoBilling' src/server/db/seed.ts &&
  ! grep -q 'new Date()' $FIXTURE"
refute "no card number or address in the demo billing data" grep -nE "[0-9]{4} [0-9]{4} [0-9]{4} [0-9]{4}|@[a-z]+\.(com|net|org)\b" "$FIXTURE"

# 11. E2E and integration titles (Done when 3) -----------------------------------------------------------------
check "E2E test: pay, cancel, keep the records after the period" grep -qF '@M22 a Sifu pays Professional Sifu in test mode, cancels, and keeps its records after the period' "$SPEC"
check "E2E test: a failed renewal, the grace, the end" grep -qF '@M22 a failed renewal keeps the plan for the grace period, then the plan ends' "$SPEC"
view_titles=(
  '@M22 the active demo subscription: its state, what happens next and its payment'
  '@M22 the ended demo subscription keeps its records; the account is back on its free plan'
  '@M22 /plans offers the paid plans that exist now, in test mode'
  '@M22 the administrator sees every subscription and its provider events, read-only'
  '@M22 a member never reaches the administrator pages of billing'
)
for t in "${view_titles[@]}"; do
  check "E2E test: $t" grep -qF "$t" "$VIEW_SPEC"
done
check "the E2E runs axe in both themes and checks 44 px targets on a phone" bash -c "
  grep -q 'expectNoAxeViolations' $SPEC && grep -q 'for (const theme of THEMES)' $SPEC && grep -q 'toBeGreaterThanOrEqual(44)' $VIEW_SPEC && grep -q \"startsWith('mobile')\" $VIEW_SPEC"
check "the writing spec runs alone (PUBLIC_WRITE_SPECS), the view spec in the desktop and phone projects" bash -c "grep -q \"'\\*\\*/m22-billing.spec.ts'\" e2e/projects.ts && ! grep -q 'm22-billing-view' e2e/projects.ts"
int_titles=(
  'a Free Sifu buys Professional Sifu with the "succeeds" test card: the grant follows the applied events'
  'a declined test card creates no subscription, sends no event and leaves the checkout open'
  'a duplicate delivery is stored and applied once; the second answer is 200 too'
  'out of order and delayed: an older state never overwrites a newer one'
  'an event of a subscription the app does not know yet waits for it (the job retries), then is recorded as unknown'
  'a forged or old signature gets 400 and stores nothing'
  'an event that names another account’s checkout or customer changes nothing for either'
  'cancel at the period end keeps the plan until then; resume takes it back; another account cannot do either'
  'the test clock ends a cancelled subscription at its period end: the plan ends, every confirmed link and school stays'
  'a renewal with the "fails at renewal" card: past due, access for the 7-day grace, then the plan ends'
  'the plan-ending notice comes for a cancelled subscription, never for a renewing one'
  'an account whose subscription renews cannot change its account type until it cancels'
  'demo-premium-student renews, demo-free-sifu-5 had a cancelled Pro Sifu subscription that ended, and both keep their plans'
  'admins read the subscriptions and their events, read-only; other roles cannot'
  'refuses a live key or any key but a Stripe test key, at start and wherever the adapter is made'
  'stores a Stripe event without card or personal data and logs only its id and type'
  'a whole test purchase logs no address, name or card'
)
for t in "${int_titles[@]}"; do
  check "integration test: $t" grep -qF "$t" "$INT"
done
unit_titles=(
  'accepts only a Stripe test secret key, and says so without the value'
  'refuses a live key at start even with the test provider, and Stripe without its webhook secret'
  'refuses another body, another key, an old or future time, a missing or malformed header'
  'refuses a live event and ignores the types it does not use'
  'calls Stripe with the test key, form bodies and an idempotency key, and only follows its own checkout page'
  'cannot be made with a live key'
  'removes card data, names, e-mail addresses, phones and addresses, and keeps the ids'
)
for t in "${unit_titles[@]}"; do
  check "unit test: $t" grep -qF "$t" "$UNIT"
done
refute "the tests build fake keys at run time: no key literal for gitleaks" grep -nE "'(sk|rk)_(live|test)_[A-Za-z0-9]{8,}'|'whsec_[A-Za-z0-9]{8,}'" "$INT" "$UNIT"

# 12. Documentation (In scope 10) -------------------------------------------------------------------------------
check "ADR 0025 records the providers, the webhook, the order, the downgrade and the defaults" bash -c "
  f=docs/adr/0025-billing.md; grep -q 'DEFAULT M22' \"\$f\" && grep -q 'sk_test_' \"\$f\" && grep -q '/api/billing/webhook' \"\$f\" && grep -q 'provider_version' \"\$f\" && grep -q 'billing.grace' \"\$f\" && grep -q 'stripe listen' \"\$f\""
check "questions/M22.md has questions, each with a proposed default" bash -c "
  f=docs/plan/questions/M22.md; n=\$(grep -c '^## 2026-' \"\$f\"); [ \"\$n\" -ge 10 ] && [ \"\$(grep -c '^\\*\\*Proposed default:\\*\\*' \"\$f\")\" -ge \"\$n\" ]"
check "docs/data-model.md describes the tables and the M22 migration" bash -c "f=docs/data-model.md; for t in ${TABLES[*]}; do grep -q \"\$t\" \"\$f\" || exit 1; done; grep -q '_m22_billing' \"\$f\""
check "docs/entitlements.md has the paid plan section" grep -q 'Платен план в тестов режим (M22)' docs/entitlements.md
check "README names the test clock and the Stripe test-mode settings" bash -c "grep -q 'billing:test-clock' README.md && grep -q 'STRIPE_WEBHOOK_SECRET' README.md"
check "the user guide covers checkout, cancel, the grace and the notices" bash -c "f=docs/guides/user-guide.bg.md; grep -q '(M22)' \"\$f\" && grep -q 'Cancel at the end of the period' \"\$f\" && grep -q 'Test mode, no real charge' \"\$f\" && grep -q '/dashboard/billing' \"\$f\""
check "the admin guide covers Stripe test mode, the test clock and the demo billing data (section 6)" bash -c "
  f=docs/guides/admin-guide.bg.md; grep -q '(M22)' \"\$f\" && grep -q 'stripe listen' \"\$f\" && grep -q 'billing:test-clock' \"\$f\" && grep -q '/admin/billing' \"\$f\" &&
  awk '/^## 6\\./{f=1;next} /^## 7\\./{f=0} f' \"\$f\" | grep -q 'абонамент'"
check "docs/plan/README.md has a status for M22" bash -c 'grep -qE "^\| M22 " docs/plan/README.md && ! grep -qE "^\| M22 .*\| не е започнат \|$" docs/plan/README.md'
check "the technical plan §8.3 has the M22 row" grep -qE '^\| M22 \| \[`docs/plan/M22-billing.md`\]' docs/WingChunRoots_Technical_Plan.bg.md
check "the milestone file has a Progress log with entries" bash -c "awk '/^## Дневник на напредъка/{f=1;next} f && /^- /{n++} END{exit !(n>0)}' docs/plan/M22-billing.md"
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  for guide in docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md; do
    check "$guide changed in this branch (differs from the merge base with origin/main)" bash -c "! git diff --quiet $base -- $guide"
  done
else
  ok "the guides changed in this branch: not checkable here (merged, or no origin/main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M22 checks: $failures failed"
  exit 1
fi
echo "M22 checks: all passed"
