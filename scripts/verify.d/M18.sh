#!/usr/bin/env bash
# Milestone M18 checks (docs/plan/M18-notices.md, "Done when"), run by scripts/verify.sh after the
# unit tests (src/server/templates/catalog.test.ts: the catalog, the channels and that only notify()
# writes a notice; src/server/services/unsubscribe.test.ts: the token; templates.test.ts: every
# e-mail with its unsubscribe link), the integration tests (src/server/services/notifications.int.test.ts
# and the notification rows of the authorization matrix), db:check, db:reset+migrate+seed, the build
# and E2E (`@smoke|@M18`: e2e/m18-notices.spec.ts on the desktop and phone projects; it writes only
# accounts of its own). They stay valid after M18, so `scripts/verify.sh all` keeps running them.
#
# Here: required files, the one migration, notify() as the only sender, the catalog's rules, the
# unsubscribe link and its headers, the jobs, the procedures and their Server Actions, the decisions
# by default, the UI rules, the demo data, the E2E and integration titles, and the documentation.
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

NOTIFY=src/server/services/notify.ts
CATALOG=src/server/templates/catalog.ts
TEXTS=src/server/templates/notifications.ts
NOTICE_MAIL=src/server/templates/email/notice.tsx
TOKEN=src/server/services/unsubscribe.ts
SERVICE=src/server/services/notifications.ts
LIMITS=src/server/services/limit-notices.ts
SECURITY=src/server/services/security-notices.ts
EXPIRY=src/server/jobs/plan-expiry.ts
PAGE=src/app/dashboard/notifications/page.tsx
LIST=src/app/dashboard/notifications.tsx
UNSUB_PAGE=src/app/unsubscribe/page.tsx
ONE_CLICK=src/app/unsubscribe/one-click/route.ts
SETTINGS_FORM=src/app/dashboard/settings/forms.tsx
SPEC=e2e/m18-notices.spec.ts
INT=src/server/services/notifications.int.test.ts
mapfile -t M18_SQL < <(ls drizzle/*_m18_notices/migration.sql 2>/dev/null)

# 1. Required files (Done when 5) ------------------------------------------------------------------
required=(
  "$NOTIFY" "$CATALOG" "$TEXTS" "$NOTICE_MAIL" "$TOKEN" "$SERVICE" "$LIMITS" "$SECURITY" "$EXPIRY"
  "$PAGE" "$LIST" "$UNSUB_PAGE" "$ONE_CLICK" src/app/unsubscribe/actions.ts "$SETTINGS_FORM"
  src/server/templates/catalog.test.ts src/server/services/unsubscribe.test.ts "$SPEC" "$INT"
  docs/adr/0021-notices.md docs/plan/M18-notices.md docs/plan/questions/M18.md
  docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md docs/data-model.md
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done

# 2. One migration (In scope 3; plan §3.2) ---------------------------------------------------------
check "exactly one M18 migration (m18_notices), with its snapshot" bash -c '
  [ "'"${#M18_SQL[@]}"'" -eq 1 ] && [ -s "$(dirname "'"${M18_SQL[0]:-none}"'")/snapshot.json" ]'
if [ "${#M18_SQL[@]}" -eq 1 ]; then
  SQL="${M18_SQL[0]}"
  check "the migration creates notification_preference; security and account can never be off" bash -c "
    grep -q 'CREATE TABLE \"notification_preference\"' '$SQL' && grep -q 'notification_preference_locked_categories' '$SQL' &&
    grep -qF \"CHECK (\\\"email\\\" OR \\\"category\\\" NOT IN ('security', 'account'))\" '$SQL'"
  check "one notice per account and key (notification_dedupe_key)" grep -q 'CREATE UNIQUE INDEX "notification_dedupe_key" ON "notification" ("user_id","dedupe_key") WHERE "dedupe_key" IS NOT NULL' "$SQL"
  check "app_rw reads and writes the new table, app_public_ro never" bash -c "
    grep -q 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE \"notification_preference\" TO app_rw;' '$SQL' &&
    grep -q 'REVOKE ALL ON TABLE \"notification_preference\" FROM app_public_ro;' '$SQL'"
  refute "the migration stays on PostgreSQL 16+ (no uuidv7(), no virtual generated columns, no OLD/NEW in RETURNING)" \
    grep -nEi "uuidv7\(|VIRTUAL|RETURNING[^;]*\b(OLD|NEW)\." "$SQL"
fi

# 3. notify() is the one sender (In scope 2) -------------------------------------------------------
refute "no code but notify() inserts a notice" bash -c "
  grep -rnE '\\.insert\\(\\s*notification\\s*\\)|INSERT INTO notification\\b' src --include='*.ts' --include='*.tsx' | grep -v '\\.test\\.tsx\\?:' | grep -v '^$NOTIFY:'"
check "notify() writes once per key, skips blocked and deleted accounts, queues the e-mail in the caller's transaction" bash -c "
  grep -q 'onConflictDoNothing()' $NOTIFY && grep -q 'eq(authUser.banned, false)' $NOTIFY && grep -q 'await queueEmail(' $NOTIFY &&
  grep -q 'export async function notify(' $NOTIFY && grep -q 'tx: Transaction' $NOTIFY"
check "the hourly e-mail budget is counted under an advisory lock (DEFAULT M18, question 7)" bash -c "
  grep -q 'NOTICE_EMAIL_HOURLY_CAP = 20' $NOTIFY && grep -q 'pg_advisory_xact_lock' $NOTIFY && grep -q 'DEFAULT M18 (question 7)' $NOTIFY"
check "notify() logs the kind and the account id only" bash -c "grep -qF 'logger().info(\`[notify] \${kind} to account \${userId}: \${what}\`)' $NOTIFY"
check "the existing senders go through notify()" bash -c "
  for f in relationships schools organizations review-kinds invitations grants plans events photos school-photos; do
    grep -q \"from './notify'\" src/server/services/\$f.ts || exit 1
  done; grep -q 'notifyEach(' src/server/jobs/event-notify.ts"

# 4. The catalog (In scope 1, 3, 9; DEFAULT M18 questions 1, 2, 4) ------------------------------------
check "the catalog has an entry for every notification template (satisfies Record)" grep -q 'satisfies Record<NotificationTemplateName, CatalogEntry>' "$CATALOG"
if [ -f scripts/verify.d/M22.sh ]; then
  # M22 (docs/adr/0025-billing.md) adds exactly one category, billing, after the eight of M18.
  check "the eight categories, and billing from M22" grep -qF "export const NOTIFICATION_CATEGORIES = ['security', 'account', 'plan', 'teaching', 'review', 'schools', 'organizations', 'events', 'billing'] as const;" src/server/db/schema/common.ts
else
  check "the eight categories" grep -qF "export const NOTIFICATION_CATEGORIES = ['security', 'account', 'plan', 'teaching', 'review', 'schools', 'organizations', 'events'] as const;" src/server/db/schema/common.ts
fi
check "security and account cannot be switched off; events is off by default" bash -c "
  awk '/^  security: \\{/{s=1} s && /optOut: false/{a=1} /^  account: \\{/{t=1} t && /optOut: false/{b=1} /^  events: \\{/{e=1} e && /emailDefault: false/{c=1} END{exit !(a && b && c)}' $CATALOG"
check "the limit notice is dashboard-only; the new kinds are e-mailed with the notice e-mail" bash -c "
  grep -qF \"'limit.reached': dashboardOnly('plan'),\" $CATALOG && grep -qF \"'plan.expiring': mailed('plan', 'notice'),\" $CATALOG &&
  grep -qF \"'security.password-changed': mailed('security', 'notice'),\" $CATALOG && grep -qF \"'content.removed': mailed('account', 'notice'),\" $CATALOG &&
  grep -qF \"'relationship.ended': mailed('teaching', 'notice'),\" $CATALOG && grep -qF \"'school.reviewed': mailed('schools', 'notice'),\" $CATALOG"
for q in 1 2 3 4 5 6 7; do
  check "DEFAULT M18 question $q is marked in the code" bash -c "grep -rqE 'DEFAULT M18,? \\(?question $q' src"
done

# 5. Unsubscribing (In scope 4; RFC 8058) ----------------------------------------------------------
check "the token is an HMAC over account, category and version, compared in constant time" bash -c "
  grep -q \"createHmac('sha256'\" $TOKEN && grep -q 'timingSafeEqual' $TOKEN && grep -q 'wcr-unsubscribe:' $TOKEN"
check "every e-mail that can be switched off has List-Unsubscribe and List-Unsubscribe-Post" bash -c "
  f=src/server/mail/mailer.ts; grep -qF \"'List-Unsubscribe': \\\`<\\\${input.unsubscribe.oneClickUrl}>\\\`\" \$f && grep -qF \"'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'\" \$f"
check "the link travels sealed in the job" bash -c "grep -q 'payload.unsubscribe = seal(' src/server/jobs/outbox.ts && grep -q 'export function jobUnsubscribe' src/server/jobs/outbox.ts"
check "the footer of every template shows the link (EmailLayout)" bash -c "grep -q 'Unsubscribe from {link.category} e-mails' src/server/templates/email/components.tsx && grep -q 'unsubscribe={unsubscribe}' src/server/templates/email/account-link.tsx && grep -q 'unsubscribe={unsubscribe}' src/server/templates/email/relationship-link.tsx"
check "the page needs no sign-in, changes nothing until the press, and is not indexed; the one-click is a POST" bash -c "
  grep -q 'serverClient(await headers(), null)' $UNSUB_PAGE && grep -q \"referrer: 'strict-origin'\" $UNSUB_PAGE && grep -q 'robots: { index: false }' $UNSUB_PAGE &&
  grep -q 'export async function POST' $ONE_CLICK"
check "a preference change moves the version, so older links stop working" grep -q 'version = notification_preference.version + 1' "$SERVICE"

# 6. Jobs and retention (In scope 5, 7; DEFAULT M18 questions 3, 7) ---------------------------------
check "plans.expiry runs daily, once per grant and step" bash -c "
  grep -q \"plansExpiry: 'plans.expiry'\" src/server/jobs/queues.ts && grep -q 'planExpiryHandler' src/server/jobs/worker.ts &&
  grep -qF 'key: \`\${step}:\${grant.id}\`' $EXPIRY && grep -q 'PLAN_EXPIRY_NOTICE_DAYS = 7' $EXPIRY && grep -q 'isNull(entitlementGrant.revokedAt)' $EXPIRY"
check "read notices are deleted after 180 days, unread after 365, by retention.purge" bash -c "
  f=src/server/services/retention.ts; grep -q 'READ_NOTIFICATION_RETENTION_DAYS = 180' \$f && grep -q 'UNREAD_NOTIFICATION_RETENTION_DAYS = 365' \$f &&
  grep -q 'purgeOldNotifications(db)' src/server/jobs/worker.ts"
check "the limit notice: quota refusals only, one per feature and month, in its own transaction" bash -c "
  grep -q \"decision.code !== 'quota'\" $LIMITS && grep -qF 'key: \`limit.reached:\${feature}:\${month}\`' $LIMITS && grep -q 'getDb().transaction' $LIMITS"
check "the limit notice is wired to students, photos and events" bash -c "
  grep -q \"tellLimitReached(p.user.id, 'approve_students', error)\" src/server/services/relationships.ts &&
  grep -q \"withLimitNotice(p.user.id, 'photos'\" src/server/services/photos.ts && grep -q \"withLimitNotice(p.user.id, 'photos'\" src/server/services/gallery.ts &&
  grep -q \"withLimitNotice(p.user.id, 'events'\" src/server/services/events.ts"
check "security notices on password, two-factor and backup codes, and moderation notices with the reason" bash -c "
  grep -q \"sendSecurityNotice(user.id, 'security.password-changed')\" src/server/auth/accounts.ts &&
  grep -q \"'/two-factor/disable': 'security.two-factor-disabled'\" src/server/auth/hooks.ts && grep -q \"'/two-factor/generate-backup-codes': 'security.backup-codes'\" src/server/auth/hooks.ts &&
  grep -q \"'security.two-factor-enabled'\" src/server/auth/hooks.ts && grep -q \"'content.removed', { content: 'event', reason\" src/server/services/events.ts"
refute "no IP address, place or device in the security notices" bash -c "awk '/Lifecycle notices \\(M18/{f=1} f' $TEXTS | grep -nEi 'ipHmac|ip address:|user.?agent|\\bdevice:'"
refute "no countdown or urgency in the notice copy (left, hurry, only today, countdown)" grep -nEi "\b(hurry|only today|last chance|don.t miss)\b|days? left|\{[a-z.]+\} left" "$TEXTS" "$NOTICE_MAIL" "$PAGE" "$UNSUB_PAGE"

# 7. API first (In scope 8; plan §6.8) -------------------------------------------------------------
for proc in "markAllRead: signedIn" "preferences: signedIn" "setPreference: signedIn" "unsubscribeInfo: base" "unsubscribe: base"; do
  check "notifications.${proc%%:*} is a procedure (${proc#*: })" grep -q "    $proc\$" src/server/rpc/router.ts
done
for path in /notifications/mark-all-read /notifications/preferences /notifications/preferences/set /notifications/unsubscribe; do
  check "docs/api/openapi.json has $path" grep -q "\"$path\"" docs/api/openapi.json
done
check "the Server Actions are in the parity table" bash -c "
  f=src/server/rpc/parity.ts; grep -qF \"'src/app/dashboard/actions.ts#markReadAction': { rpc: ['notifications.markRead', 'notifications.markAllRead'] },\" \$f &&
  grep -qF \"'src/app/dashboard/settings/actions.ts#setNotificationEmailsAction': { rpc: ['notifications.preferences', 'notifications.setPreference'] },\" \$f &&
  grep -qF \"'src/app/unsubscribe/actions.ts#unsubscribeAction': { rpc: ['notifications.unsubscribe'] },\" \$f"
check "the authorization matrix has the notification rows and actions" bash -c "
  f=src/server/rpc/authz-matrix.int.test.ts; grep -q \"path: 'notifications.markAllRead'\" \$f && grep -q \"path: 'notifications.setPreference'\" \$f &&
  grep -q \"'notifications.unsubscribeInfo', 'notifications.unsubscribe'\" \$f && grep -q 'setNotificationEmailsAction' \$f && grep -q 'unsubscribeAction' \$f"

# 8. The pages (In scope 6; CLAUDE.md §10) ---------------------------------------------------------
check "/dashboard/notifications: categories as links with aria-current and a mark, pages, Mark all as read of a category" bash -c "
  grep -q \"aria-current={current ? 'page' : undefined}\" $PAGE && grep -q 'min-h-11 min-w-11' $PAGE && grep -q 'rel=\"next\"' $PAGE &&
  grep -q 'name=\"category\"' $LIST && grep -q 'Mark all as read' $LIST && grep -q 'New' $LIST"
refute "no window.open, no 100vh, no hover-only behaviour in the M18 pages" grep -nE "window\.open|100vh|group-hover:|onMouseEnter|target=\"_blank\"" "$PAGE" "$UNSUB_PAGE" "$SETTINGS_FORM"
check "the pages are in e2e/routes.ts (axe in both themes); /dashboard/notifications is a key screen" bash -c "
  grep -q \"path: '/dashboard/notifications', name: 'dashboard-notifications', status: 200, milestone: 'M18', key: true\" e2e/routes.ts &&
  grep -q \"name: 'dashboard-notifications-empty'\" e2e/routes.ts && grep -q \"path: '/unsubscribe', name: 'unsubscribe-stale'\" e2e/routes.ts"
check "the settings list security and account as always e-mailed, never as a choice" bash -c "grep -q 'data-testid=\"locked-categories\"' $SETTINGS_FORM && grep -q 'if (category.locked) continue;' src/app/dashboard/settings/actions.ts"

# 9. Demo data (In scope 11; D20) ------------------------------------------------------------------
check "the demo notices are fictional, on fixed dates, on an account no test signs in as" bash -c "
  f=src/fixtures/generate.ts; grep -q \"DEMO_NOTICE_ACCOUNT = 'demo-two-lineages'\" \$f && grep -q 'const NOTICES_AT = new Date(Date.UTC(2026, 9, 24));' \$f &&
  awk '/^function demoNotices/{f=1} f{print} f && /^}/{exit}' \$f > /tmp/m18-demo.\$\$ &&
  grep -q \"'plan.expiring'\" /tmp/m18-demo.\$\$ && grep -q \"'limit.reached'\" /tmp/m18-demo.\$\$ && grep -q \"'content.removed'\" /tmp/m18-demo.\$\$ &&
  grep -q \"category: 'plan', email: false\" /tmp/m18-demo.\$\$ && ! grep -q 'new Date()' /tmp/m18-demo.\$\$; rc=\$?; rm -f /tmp/m18-demo.\$\$; exit \$rc"
check "db:seed loads notification_preference" grep -q 'await insert(notificationPreference, f.notificationPreferences);' src/server/db/seed.ts

# 10. E2E and integration titles (Done when 3) -----------------------------------------------------
titles=(
  '@M18 a password reset brings the "password changed" e-mail and notice, without an unsubscribe link'
  '@M18 a category switched off in the settings stops its e-mail; the notice still comes'
  '@M18 the e-mail’s unsubscribe link switches its category off without signing in'
  '@M18 /dashboard/notifications by keyboard: categories, pages and "Mark all as read"'
)
for t in "${titles[@]}"; do
  check "E2E test: $t" grep -qF "$t" "$SPEC"
done
check "the E2E runs axe in both themes and checks 44 px targets on a phone" bash -c "grep -q 'expectNoAxeViolations' $SPEC && grep -q 'for (const theme of THEMES)' $SPEC && grep -q 'toBeGreaterThanOrEqual(44)' $SPEC"
check "the M18 spec runs in the desktop and phone projects (not among the exclusive specs)" bash -c "! grep -q 'm18-notices' e2e/projects.ts"
int_titles=(
  'writes the dashboard notice and queues its e-mail once per key'
  'follows the account’s choice per category, and the default without one'
  'never lets security or account e-mails be switched off'
  'a blocked or deleted account gets nothing; an expired block lets it through'
  'the e-mail’s link switches its category off with one press, once; any earlier link stops working'
  'the e-mail carries the footer link and the List-Unsubscribe headers (RFC 8058)'
  'one notice 7 days before and one at the end, per grant, however often the job runs'
  'one per feature and month, only for a used-up allowance, never e-mailed'
  'deletes read notices after 180 days and unread ones after 365'
)
for t in "${int_titles[@]}"; do
  check "integration test: $t" grep -qF "$t" "$INT"
done
check "the catalog unit test checks that only notify() writes a notice" grep -qF "no code but notify() writes a notice (In scope 2)" src/server/templates/catalog.test.ts

# 11. Documentation (In scope 13) ------------------------------------------------------------------
check "ADR 0021 records the catalog, notify(), the preferences, the unsubscribe link and the defaults" bash -c "
  f=docs/adr/0021-notices.md; grep -q 'DEFAULT M18' \"\$f\" && grep -q 'notify()' \"\$f\" && grep -q 'RFC 8058' \"\$f\" && grep -q 'notification_preference' \"\$f\" && grep -q 'plans.expiry' \"\$f\""
check "questions/M18.md has seven questions, each with a proposed default" bash -c "
  f=docs/plan/questions/M18.md; [ \"\$(grep -c '^## 2026-' \"\$f\")\" -ge 7 ] && [ \"\$(grep -c '^\\*\\*Proposed default:\\*\\*' \"\$f\")\" -ge 7 ]"
check "docs/data-model.md describes notification_preference, dedupe_key and the M18 migration" bash -c "f=docs/data-model.md; grep -q 'notification_preference' \"\$f\" && grep -q 'dedupe_key' \"\$f\" && grep -q '_m18_notices' \"\$f\""
check "the user guide covers the notifications page, the e-mail settings and unsubscribing" bash -c "
  f=docs/guides/user-guide.bg.md; grep -q '### Всички известия и имейлите (M18)' \"\$f\" && grep -q 'Mark all as read' \"\$f\" && grep -q 'Unsubscribe from' \"\$f\""
check "the admin guide covers the data, the e-mails, the jobs and the moderation notices" bash -c "
  f=docs/guides/admin-guide.bg.md; grep -q '## 24. Известия за жизнения цикъл (M18)' \"\$f\" && grep -q 'plans.expiry' \"\$f\" && grep -q 'List-Unsubscribe' \"\$f\" && grep -q 'content.removed' \"\$f\""
check "docs/plan/README.md has a status for M18" bash -c 'grep -qE "^\| M18 " docs/plan/README.md && ! grep -qE "^\| M18 .*\| не е започнат \|$" docs/plan/README.md'
check "the milestone file has a Progress log with entries" bash -c "awk '/^## Дневник на напредъка/{f=1;next} f && /^- /{n++} END{exit !(n>0)}' docs/plan/M18-notices.md"
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  for guide in docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md; do
    check "$guide changed in this branch (differs from the merge base with origin/main)" bash -c "! git diff --quiet $base -- $guide"
  done
else
  ok "the guides changed in this branch: not checkable here (merged, or no origin/main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M18 checks: $failures failed"
  exit 1
fi
echo "M18 checks: all passed"
