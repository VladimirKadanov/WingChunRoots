#!/usr/bin/env bash
# Milestone M02 checks (docs/plan/M02-accounts.md, "Done when"), run by scripts/verify.sh after the
# integration tests (auth, guards: the role x route matrix, the second factor of staff sessions,
# role changes, cookie and bearer sessions; account, admin:create), the unit tests (templates,
# api-parity, legal documents), db:check, db:reset+migrate+seed, the build and E2E
# (`@smoke|@M02`: sign-up, e-mail confirmation, reset, consents, staff TOTP, onboarding, axe).
# They stay valid after M02, so `scripts/verify.sh all` keeps running them (CI, M13).
#
# Here: required files, pinned packages, the rules of plan §3.2 in the code and in the test
# database, the consent and onboarding rules, the screens and their routes, the screenshots, the
# test-only secrets, and the documentation (both guides changed in this branch).
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
mapfile -t SRC_FILES < <(find src -type f \( -name '*.ts' -o -name '*.tsx' \) | sort)
mapfile -t UI_FILES < <(find src/app src/components -type f \( -name '*.ts' -o -name '*.tsx' \) | sort)
mapfile -t M02_SQL < <(ls drizzle/*_auth_accounts/migration.sql drizzle/*_auth_roles_sessions/migration.sql 2>/dev/null)

KEY_SCREENS=(sign-up sign-in onboarding)
SIZES=(390x844 1440x900)
THEMES=(dark light)

# 1. Required files (Done when, items 2-4 and 6) ------------------------------------------------
required=(
  src/server/auth/config.ts src/server/auth/guards.ts src/server/auth/hooks.ts
  src/server/auth/session.ts src/server/auth/principal.ts src/server/auth/web.ts
  src/server/auth/cli.ts src/server/auth/admin-create.ts
  src/server/auth/guards.int.test.ts src/server/auth/auth.int.test.ts
  src/server/rpc/router.ts src/server/rpc/handler.ts src/server/rpc/api-parity.test.ts
  src/server/services/account.ts src/server/services/consent.ts src/server/services/roles.ts
  src/server/templates/email/verify-email.tsx src/server/templates/email/reset-password.tsx
  src/server/templates/templates.test.ts src/server/db/schema/auth.ts
  "src/app/api/auth/[...all]/route.ts" "src/app/api/rpc/[[...rest]]/route.ts" "src/app/api/v1/[[...rest]]/route.ts"
  e2e/helpers/auth.ts e2e/m02-auth.spec.ts
  content/legal/terms.en.md content/legal/privacy.en.md
  docs/adr/0004-auth.md scripts/verify.d/M02.sh
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done
check "directory exists and is not empty: src/server/auth/" bash -c '[ -n "$(ls -A src/server/auth)" ]'
check "directory exists and is not empty: docs/screenshots/M02/" bash -c '[ -d docs/screenshots/M02 ] && [ -n "$(ls -A docs/screenshots/M02)" ]'
check "the two M02 migrations exist (auth_accounts, auth_roles_sessions)" test "${#M02_SQL[@]}" -eq 2

# 2. Packages and commands -----------------------------------------------------------------------
check "better-auth 1.7.10, oRPC (server and openapi, same version), zod and uqr are pinned exactly" node -e "
  const p = require('./package.json');
  const d = p.dependencies || {};
  const exact = (n) => /^\d+\.\d+\.\d+$/.test(d[n] || '');
  process.exit(d['better-auth'] === '1.7.10' && ['@orpc/server', '@orpc/openapi', 'zod', 'uqr'].every(exact)
    && d['@orpc/server'] === d['@orpc/openapi'] ? 0 : 1)"
check "TOTP codes in tests come from src/server/auth/otp.ts (node:crypto), not a second OTP library" bash -c '
  [ -f src/server/auth/otp.ts ] && [ -f src/server/auth/otp.test.ts ] &&
  ! grep -rqE "from .@better-auth/utils" src e2e scripts --include=*.ts --include=*.tsx &&
  node -e "const p=require(\"./package.json\");process.exit(((p.devDependencies||{})[\"@better-auth/utils\"]||(p.dependencies||{})[\"@better-auth/utils\"])?1:0)"'
check "out of scope stays out: no @better-auth/expo, passkeys, magic links or social sign-in" node -e "
  const p = require('./package.json');
  const d = { ...p.dependencies, ...p.devDependencies };
  process.exit(Object.keys(d).some((n) => /^@better-auth\/(expo|passkey|sso)$/.test(n)) ? 1 : 0)"
refute "no social providers, passkey or magic-link plugins in src/" grep_code "socialProviders|passkey\(|magicLink\(" "${SRC_FILES[@]}"
check "package.json has admin:create on src/server/auth/cli.ts" node -e "
  process.exit(/src\/server\/auth\/cli\.ts/.test(require('./package.json').scripts['admin:create'] || '') ? 0 : 1)"
check "README.md and CLAUDE.md list pnpm admin:create" bash -c 'grep -q "admin:create" README.md && grep -q "admin:create" CLAUDE.md'

# 3. Better Auth (In scope 1) ----------------------------------------------------------------------
check "Better Auth: Drizzle adapter, auth_* model names, UUIDv7 ids from the app" bash -c '
  f=src/server/auth/config.ts
  grep -q "drizzleAdapter" "$f" && grep -q "generateId: () => uuidv7()" "$f" &&
  for m in auth_user auth_session auth_account auth_verification auth_two_factor; do grep -q "modelName: '\''$m'\''" "$f" || exit 1; done'
check "Better Auth: e-mail and password with required verification, reset, rate limiting on" bash -c '
  f=src/server/auth/config.ts
  grep -q "requireEmailVerification: true" "$f" && grep -q "sendResetPassword" "$f" &&
  grep -q "revokeSessionsOnPasswordReset: true" "$f" && grep -qE "rateLimit: \{[[:space:]]*$" "$f" && grep -q "enabled: true" "$f"'
check "Better Auth: plugins twoFactor, admin and bearer (signed tokens), telemetry off" bash -c '
  f=src/server/auth/config.ts
  grep -q "twoFactor({" "$f" && grep -q "admin({" "$f" && grep -q "bearer({ requireSignature: true })" "$f" &&
  grep -q "telemetry: { enabled: false }" "$f"'
check "the admin plugin's HTTP endpoints (set-role, impersonation) are disabled" bash -c '
  f=src/server/auth/config.ts
  grep -q "'\''/admin/set-role'\''" "$f" && grep -q "'\''/admin/impersonate-user'\''" "$f" && grep -q "disabledPaths: DISABLED_AUTH_PATHS" "$f"'
check "ESLint keeps better-auth inside src/server/auth and @orpc/* inside src/server/rpc" bash -c '
  for target in src/app/m02-probe.ts src/components/m02-probe.tsx src/server/services/m02-probe.ts; do
    out="$(printf "import { betterAuth } from \"better-auth\";\nimport { os } from \"@orpc/server\";\nexport const x = [betterAuth, os];\n" \
      | node_modules/.bin/eslint --stdin --stdin-filename "$target" 2>&1)"
    [ "$(printf "%s" "$out" | grep -c "no-restricted-imports")" -eq 2 ] || exit 1
  done'
# Fix round 1: the later blocks for src/components/ui, shell, home, ink and account replaced the
# rule of the src/app + src/components block and dropped its database, jobs and mail bans.
check "ESLint keeps every folder of src/app and src/components away from the database, jobs, mail and @better-auth/*" bash -c '
  for target in src/app/m02-probe.ts src/components/ui/m02-probe.tsx src/components/shell/m02-probe.tsx \
      src/components/home/m02-probe.tsx src/components/ink/m02-probe.tsx src/components/account/m02-probe.tsx; do
    out="$(printf "import { getDb } from \"@/server/db\";\nimport { queueEmail } from \"@/server/jobs/outbox\";\nimport { createMailer } from \"@/server/mail/mailer\";\nimport { createOTP } from \"@better-auth/utils/otp\";\nexport const x = [getDb, queueEmail, createMailer, createOTP];\n" \
      | node_modules/.bin/eslint --stdin --stdin-filename "$target" 2>&1)"
    [ "$(printf "%s" "$out" | grep -c "no-restricted-imports")" -eq 4 ] || exit 1
  done'
check "ESLint lets only tests import src/server/auth/test-support.ts" bash -c '
  probe="import { setTestAuthEnv } from \"./test-support\";\nexport const x = setTestAuthEnv;\n"
  out="$(printf "$probe" | node_modules/.bin/eslint --stdin --stdin-filename src/server/auth/m02-probe.ts 2>&1)"
  printf "%s" "$out" | grep -q "import/no-restricted-paths" || exit 1
  printf "$probe" | node_modules/.bin/eslint --stdin --stdin-filename src/server/auth/m02-probe.int.test.ts'

# 4. Staff and the second factor (In scope 2; plan §3.2) ------------------------------------------
check "guards.ts exports requireUser, requireRole and requireStaff2FA" bash -c '
  f=src/server/auth/guards.ts
  grep -q "export function requireUser" "$f" && grep -q "export function requireRole" "$f" && grep -q "export function requireStaff2FA" "$f"'
check "requireStaff2FA checks the session's second factor (two_factor_verified_at), not only the account flag" bash -c '
  f=src/server/auth/guards.ts
  grep -A10 "export function requireStaff2FA" "$f" | grep -q "hasVerifiedSecondFactor(p)" &&
  grep -A2 "export function hasVerifiedSecondFactor" "$f" | grep -q "principal.session.twoFactorVerifiedAt !== null"'
check "the session has the additional field twoFactorVerifiedAt (input: false), set by hooks.after" bash -c '
  grep -q "twoFactorVerifiedAt: { type: '\''date'\'', required: false, input: false }" src/server/auth/config.ts &&
  grep -q "/two-factor/verify-totp" src/server/auth/hooks.ts && grep -q "/two-factor/verify-backup-code" src/server/auth/hooks.ts &&
  grep -q "twoFactorVerifiedAt" src/server/auth/hooks.ts'
check "hooks.before drops trustDevice and refuses /two-factor/disable for staff" bash -c '
  grep -q "trustDevice" src/server/auth/hooks.ts && grep -q "/two-factor/disable" src/server/auth/hooks.ts'
check "migration: CHECK auth_user_staff_needs_2fa and the trigger auth_user_end_sessions on role and 2FA" bash -c '
  cat '"${M02_SQL[*]}"' | grep -q "auth_user_staff_needs_2fa" &&
  cat '"${M02_SQL[*]}"' | grep -q "AFTER UPDATE OF \"role\", \"two_factor_enabled\" ON \"auth_user\""'
check "auth_session.ip_address holds only an ip_hmac (CHECK auth_session_ip_hmac_format)" \
  bash -c 'cat '"${M02_SQL[*]}"' | grep -q "auth_session_ip_hmac_format"'
refute "the M02 migrations are PostgreSQL 16 SQL (no uuidv7(), no virtual columns, no OLD/NEW in RETURNING)" \
  grep_code 'uuidv7\(|VIRTUAL|RETURNING[^;]*(OLD|NEW)\.' "${M02_SQL[@]}"
check "audit: role.change, consent.grant and auth.2fa.enable are written" bash -c '
  grep -rq "'\''role.change'\''" src/server/services/roles.ts && grep -rq "'\''consent.grant'\''" src/server/services/consent.ts &&
  grep -rq "'\''auth.2fa.enable'\''" src/server/auth/hooks.ts'

if [ -n "${TEST_DATABASE_URL:-}" ]; then
  facts="$(psql_url "$TEST_DATABASE_URL" -X -q -At -F ' ' -c "
    SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN
              ('auth_user', 'auth_session', 'auth_account', 'auth_verification', 'auth_two_factor')),
           (SELECT count(*) FROM pg_trigger WHERE tgname = 'auth_user_end_sessions' AND NOT tgisinternal),
           (SELECT bool_or(has_table_privilege('app_public_ro', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE'))
              FROM unnest(ARRAY['auth_user', 'auth_session', 'auth_account', 'auth_verification', 'auth_two_factor']) t),
           (SELECT bool_and(has_table_privilege('app_rw', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE'))
              FROM unnest(ARRAY['auth_user', 'auth_session', 'auth_account', 'auth_verification', 'auth_two_factor']) t),
           (SELECT count(*) FROM pg_constraint c JOIN pg_class r ON r.oid = c.confrelid
             WHERE c.contype = 'f' AND r.relname = 'auth_user'),
           (SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
             WHERE c.contype = 'f' AND t.relname = 'audit_log' AND c.confrelid = 'auth_user'::regclass)" 2>/dev/null)"
  check "the test database has the five auth_* tables and the session trigger" test "$(echo "$facts" | cut -d' ' -f1-2)" = "5 1"
  check "app_public_ro has no privilege on auth_*; app_rw reads and writes them" test "$(echo "$facts" | cut -d' ' -f3-4)" = "f t"
  check "the *_user_id columns of M01 reference auth_user (at least 20 foreign keys), audit_log does not" bash -c "
    set -- $facts; [ \"\$5\" -ge 20 ] && [ \"\$6\" -eq 0 ]"
  seeded="$(psql_url "$TEST_DATABASE_URL" -X -q -At -F ' ' -c "
    SELECT (SELECT count(*) FROM auth_user u JOIN person p ON p.claimed_by_user_id = u.id
             WHERE u.email IN ('demo-pending@example.test', 'demo-root-a@example.test', 'demo-hub-a@example.test',
                               'demo-free-sifu-5@example.test', 'demo-pro-sifu-8@example.test', 'demo-two-lineages@example.test')
               AND u.email = p.slug || '@example.test' AND u.role = 'user' AND u.email_verified),
           (SELECT count(*) FROM auth_user
             WHERE (email, role) IN (('demo-admin@example.test', 'admin'), ('demo-archivist@example.test', 'archivist'),
                                     ('demo-moderator@example.test', 'moderator'))
               AND two_factor_enabled AND email_verified),
           (SELECT count(*) FROM auth_user WHERE email NOT LIKE 'demo-%@example.test'),
           (SELECT count(DISTINCT c.user_id) FROM consent_record c JOIN auth_user u ON u.id = c.user_id
             WHERE c.kind = 'age_18_plus' AND c.action = 'granted'
               AND u.email IN ('demo-pending@example.test', 'demo-root-a@example.test', 'demo-hub-a@example.test',
                               'demo-free-sifu-5@example.test', 'demo-pro-sifu-8@example.test', 'demo-two-lineages@example.test',
                               'demo-admin@example.test', 'demo-archivist@example.test', 'demo-moderator@example.test'))" 2>/dev/null)"
  check "db:seed: the six person accounts linked to their demo persons and the three staff accounts with TOTP (In scope 9)" \
    test "$(echo "$seeded" | cut -d' ' -f1-3)" = "6 3 0"
  check "db:seed: every seeded account confirmed it is 18 or older (DEFAULT D10)" \
    test "$(echo "$seeded" | cut -d' ' -f4)" = "9"
else
  bad "TEST_DATABASE_URL is not set: cannot check the auth tables, privileges and seeded accounts"
fi

# 5. API-first (In scope 3; plan §6.8) ------------------------------------------------------------
check "oRPC: RPCHandler under /api/rpc and OpenAPIHandler under /api/v1, CSRF origin check, no-store" bash -c '
  f=src/server/rpc/handler.ts
  grep -q "new RPCHandler(router)" "$f" && grep -q "new OpenAPIHandler(router)" "$f" &&
  grep -q "export function csrfRefusal" "$f" && grep -q "private, no-store" "$f"'
check "the procedures account.onboard and consent.record exist and take the cookie or bearer session" bash -c '
  f=src/server/rpc/router.ts
  grep -Eq "onboard: (base|signedIn)$" "$f" && grep -Eq "record: (base|signedIn)$" "$f" &&
  grep -q "requireUser(context.principal)" "$f" &&
  grep -q "principalFromHeaders" src/server/rpc/context.ts'
check "the session comes from the cookie or Authorization: Bearer (one principal for both)" bash -c '
  grep -qi "bearer" src/server/auth/session.ts'
check "the Server Actions are listed in the API parity table (api-parity.test.ts)" bash -c '
  n_actions="$(grep -l "^'\''use server'\''" src/app/*/actions.ts src/app/*/*/actions.ts 2>/dev/null | wc -l)"
  [ "$n_actions" -ge 6 ] && grep -q "SERVER_ACTION_TARGETS" src/server/rpc/api-parity.test.ts'

# 6. Sign-up, consents and onboarding (In scope 4, 5; D10, D16, D23) -------------------------------
check "the four sign-up ticks are terms, privacy_ack, authenticity_declaration and age_18_plus" bash -c '
  grep -q "SIGN_UP_CONSENTS = \[.terms., .privacy_ack., .authenticity_declaration., .age_18_plus.\]" src/server/legal/documents.ts &&
  grep -q "REQUIRED_SIGN_UP_CONSENTS = \[.terms., .authenticity_declaration., .age_18_plus.\]" src/server/legal/documents.ts'
check "sign-up is refused without the required ticks (hooks.before, CONSENT_REQUIRED)" bash -c '
  grep -q "/sign-up/email" src/server/auth/hooks.ts && grep -q "CONSENT_REQUIRED" src/server/services/consent.ts'
mapfile -t ACCOUNT_UI < <(find src/app/sign-up src/app/onboarding src/components/account -type f -name '*.tsx' | sort)
refute "no tick is pre-set: no defaultChecked={true} or checked attribute in the sign-up and onboarding screens" \
  grep_code 'defaultChecked[[:space:]]*(=\{true\}|/?>|$)|[[:space:]]checked[[:space:]]*(=|/?>|$)' "${ACCOUNT_UI[@]}"
refute "no birth date is asked on sign-up or onboarding (DEFAULT D16)" \
  grep_code 'birthDate|birth_date|name="[^"]*[Bb]irth|type="date"' src/app/sign-up/sign-up-form.tsx src/app/sign-up/actions.ts \
  src/app/onboarding/onboarding-form.tsx src/app/onboarding/actions.ts src/server/services/account.ts
check "the legal drafts say \"Draft — pending legal review\" (DEFAULT D23)" bash -c '
  grep -q "Draft — pending legal review" content/legal/terms.en.md && grep -q "Draft — pending legal review" content/legal/privacy.en.md'
check "terms: the pilot is for adults only; privacy: names OpenFreeMap and describes ip_hmac" bash -c '
  grep -qi "18" content/legal/terms.en.md && grep -qi "adult" content/legal/terms.en.md &&
  grep -q "OpenFreeMap" content/legal/privacy.en.md && grep -q "ip_hmac" content/legal/privacy.en.md'
check "consents are stored with the document version" bash -c '
  grep -q "documentVersion" src/server/services/consent.ts && grep -q "version:" src/server/legal/documents.ts'
check "onboarding creates a self-stewarded person, involved_only unless shown publicly" bash -c '
  f=src/server/services/account.ts
  grep -q "stewardship: '\''self'\''" "$f" && grep -q "claimedByUserId" "$f" && grep -q "'\''involved_only'\''" "$f" && grep -q "showPublicly" "$f"'
check "onboarding stores the Latin name as und-Latn, Jyutping as yue-Latn, pinyin as zh-Latn-pinyin" bash -c '
  f=src/server/services/account.ts
  grep -q "lang: '\''und-Latn'\''" "$f" && grep -q "lang: '\''yue-Latn'\''" "$f" && grep -q "lang: '\''zh-Latn-pinyin'\''" "$f"'
check "the Chinese scripts are offered with their BCP 47 tags (zh-Hant, zh-Hans)" bash -c '
  grep -q "lang: '\''zh-Hant'\''" src/server/services/names.ts && grep -q "lang: '\''zh-Hans'\''" src/server/services/names.ts'

# 7. Screens, routes and the quality bar (In scope 7) ---------------------------------------------
for page in sign-up sign-in verify-email reset-password account/security onboarding admin; do
  check "screen exists: src/app/$page/page.tsx" test -s "src/app/$page/page.tsx"
  check "route /$page is in e2e/routes.ts" grep -q "path: '/$page'" e2e/routes.ts
done
for screen in "${KEY_SCREENS[@]}"; do
  check "/$screen is a key screen (visual regression and screenshots)" grep -qE "name: '$screen'.*key: true" e2e/routes.ts
  for size in "${SIZES[@]}"; do
    for theme in "${THEMES[@]}"; do
      check "screenshot: docs/screenshots/M02/$screen-$size-$theme.png" test -s "docs/screenshots/M02/$screen-$size-$theme.png"
    done
  done
done
check "/admin is guarded by requireStaff2FA (ROUTE_POLICIES) and shows the failed e-mail deliveries" bash -c '
  grep -q "'\''/admin'\'': { kind: '\''staff2fa'\'' }" src/server/auth/guards.ts && grep -qi "failed e-mail deliveries" src/app/admin/page.tsx'
check "fields carry autocomplete: email, current-password, new-password, one-time-code" bash -c '
  for v in email current-password new-password one-time-code; do grep -rq "autoComplete=\"$v\"" src/app src/components || exit 1; done'
refute "pasting is never blocked (no onPaste handlers; WCAG 3.3.8)" grep_code 'onPaste' "${UI_FILES[@]}"
mapfile -t CACHED < <(grep -rl "'use cache'" src 2>/dev/null)
if [ "${#CACHED[@]}" -gt 0 ]; then
  refute "no session, cookies, headers or auth inside 'use cache' files" \
    grep_code "next/headers|server/auth|principalFromHeaders|cookies\(|headers\(" "${CACHED[@]}"
else
  ok "no session, cookies, headers or auth inside 'use cache' files (no cached file)"
fi
check "no proxy.ts or middleware.ts in Phase 1 (CLAUDE.md §13)" bash -c '
  [ ! -e src/proxy.ts ] && [ ! -e proxy.ts ] && [ ! -e src/middleware.ts ] && [ ! -e middleware.ts ]'

# 8. E2E and integration tests (Done when, items 2-4) ---------------------------------------------
titles=(
  '@M02 sign up, confirm the email from the outbox and sign in'
  '@M02 password reset through the emailed link'
  '@M02 consent and adult checkboxes start unticked and are stored with the document version'
  '@M02 sign-up is refused unless "I am 18 or older", terms and the authenticity declaration are ticked'
  '@M02 role cannot be set through the sign-up request'
  '@M02 a staff session without a verified second factor is redirected from /admin to /account/security'
  '@M02 a seeded staff account signs in with the test TOTP and opens /admin'
  '@M02 onboarding creates a person linked to the account'
  '@M02 onboarding requires a Latin-script primary name and stores an optional Chinese name with its lang'
  '@M02 sign-up and onboarding complete at 390x844'
  '@M02 no axe violations on sign-up, sign-in and onboarding'
)
for title in "${titles[@]}"; do
  check "E2E test: $title" grep -qF "$title" e2e/m02-auth.spec.ts
done
check "e2e/helpers/auth.ts exports signInAs(slugOrRole)" grep -q "export async function signInAs" e2e/helpers/auth.ts
check "guards.int.test.ts: role x route matrix, refused without two_factor_verified_at, trustDevice, 2FA before a staff role, role change ends sessions, cookie and bearer" bash -c '
  f=src/server/auth/guards.int.test.ts
  grep -q "role × route matrix" "$f" && grep -q "without two_factor_verified_at is refused on /admin (403 decision)" "$f" &&
  grep -q "trustDevice is ignored for staff" "$f" && grep -q "a staff role is not given to an account without 2FA" "$f" &&
  grep -q "a role change ends every session" "$f" && grep -q "accepts a cookie session and a bearer session and refuses a request without one" "$f"'
check "templates.test.ts covers verify-email and reset-password" bash -c '
  grep -q "verify-email" src/server/templates/templates.test.ts && grep -q "reset-password" src/server/templates/templates.test.ts'

# 9. Test-only secrets (Constraints) --------------------------------------------------------------
for name in APP_URL BETTER_AUTH_SECRET IP_HMAC_KEY MAIL_SEAL_KEY TRUSTED_PROXIES E2E_PASSWORD E2E_TOTP_SECRET; do
  check ".env.example names $name without a value" grep -qE "^$name=$" .env.example
done
check "scripts/init-env.sh and scripts/cloud-setup.sh generate the account secrets (never in the repository)" bash -c '
  for n in BETTER_AUTH_SECRET IP_HMAC_KEY MAIL_SEAL_KEY E2E_PASSWORD E2E_TOTP_SECRET; do
    grep -q "$n" scripts/init-env.sh && grep -q "$n" scripts/cloud-setup.sh || exit 1
  done'
check "CI generates the account secrets per run and masks them" bash -c '
  grep -q "::add-mask::" .github/workflows/ci.yml && grep -q "E2E_TOTP_SECRET=" .github/workflows/ci.yml && grep -q "MAIL_SEAL_KEY=" .github/workflows/ci.yml'
check "db:seed and admin:create refuse NODE_ENV=production" bash -c '
  grep -q "assertNotProduction('\''db:seed'\'')" src/server/db/seed.ts && grep -q "assertNotProduction('\''admin:create'\''" src/server/auth/admin-create.ts'
check "admin:create refuses a database that is not on this machine" grep -q "isLocalHost(targetDatabaseUrl(env))" src/server/auth/admin-create.ts

# 10. Decisions by default and documentation (In scope 11, 12; docs/plan/RULES.md) ----------------
for d in D04 D10 D16 D23; do
  check "DEFAULT $d is marked in the code" grep -rqE "DEFAULT $d" src
done
check "docs/adr/0004-auth.md has a status, a decision, the dependencies, the CSRF choice and uuid ids" bash -c '
  f=docs/adr/0004-auth.md
  grep -q "Статус" "$f" && grep -q "Решение" "$f" && grep -q "allowBuilds" "$f" && grep -q "CSRF" "$f" && grep -q "uuid" "$f" &&
  grep -q "better-auth" "$f" && grep -q "MIT" "$f"'
check "docs/data-model.md describes the auth tables, two_factor_verified_at and the session trigger" bash -c '
  f=docs/data-model.md
  grep -q "auth_user" "$f" && grep -q "auth_session" "$f" && grep -q "two_factor_verified_at" "$f" && grep -q "auth_user_end_sessions" "$f"'
check "the user guide covers sign-up, e-mail confirmation, sign-in, password reset and onboarding with a Chinese name" bash -c '
  f=docs/guides/user-guide.bg.md
  grep -q "### Регистрация" "$f" && grep -q "### Потвърждаване на имейла" "$f" && grep -q "### Вход" "$f" &&
  grep -q "### Нова парола" "$f" && grep -q "### Първоначален профил" "$f" && grep -q "китайско име" "$f"'
check "the admin guide covers pnpm admin:create, the mandatory staff TOTP and the e-mails in Mailpit" bash -c '
  f=docs/guides/admin-guide.bg.md
  grep -q "pnpm admin:create" "$f" && grep -q "Задължителният TOTP" "$f" && grep -q "### Писмата за акаунта" "$f" && grep -qi "mailpit" "$f"'
check "docs/plan/README.md has a status for M02" bash -c '! grep -qE "^\| M02 .*\| не е започнат \|$" docs/plan/README.md'
# docs/plan/RULES.md and Done when, item 5: both guides change in the milestone's branch. Checkable
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
  echo "M02 checks: $failures failed"
  exit 1
fi
echo "M02 checks: all passed"
