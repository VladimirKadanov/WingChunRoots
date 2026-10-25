#!/usr/bin/env bash
# Milestone M07 checks (docs/plan/M07-names-search.md, "Done when"), run by scripts/verify.sh after
# the unit tests (src/server/search/keys.test.ts: the Streamlined System, pinyin and Jyutping keys
# of demo-cjk-name, Traditional and Simplified folding, tone marks, NFC; api-parity.test.ts), the
# integration tests (search.int.test.ts: the key job, search of public records only, the profile,
# consents, deletion requests), db:check, db:reset+migrate+seed, the build and E2E (`@smoke|@M07`).
# They stay valid after M07, so `scripts/verify.sh all` keeps running them (CI, M13).
#
# Here: required files, the dependencies, the module boundary of the transliteration libraries,
# the procedures and their Server Actions, the privacy rules of the search (public views only, the
# public DTO, no generated key in an answer, no name in a log or an audit row), the job, the
# screens and their routes, the screenshots and the design review, the E2E titles, the decisions by
# default and the documentation (docs/search.md, both guides changed in this branch).
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

# grep_code <pattern> <file...>: grep -nE that ignores comments (SQL `--`, TypeScript `//` and
# `/* */` lines), so a comment that states a rule does not break it.
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

SIZES=(390x844 1440x900)
THEMES=(dark light)

# 1. Required files (Done when 4) --------------------------------------------------------------------
required=(
  src/server/search/keys.ts src/server/search/keys.test.ts src/server/search/aliases.ts src/server/search/bg-streamlined.ts
  src/server/search/store.ts src/server/search/query.ts
  src/server/services/search.ts src/server/services/profile.ts src/server/services/privacy.ts src/server/services/search.int.test.ts
  src/server/dto/search.ts src/server/jobs/search-keys.ts src/lib/profile-form.ts
  src/components/ui/search-palette.tsx src/components/shell/search-trigger.tsx
  src/app/dashboard/profile/page.tsx src/app/dashboard/profile/profile-editor.tsx src/app/dashboard/profile/actions.ts
  src/app/account/privacy/page.tsx src/app/account/privacy/forms.tsx src/app/account/privacy/actions.ts
  e2e/m07-search.spec.ts e2e/helpers/search.ts
  docs/search.md docs/design/reviews/M07.md docs/plan/questions/M07.md scripts/verify.d/M07.sh
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done
check "directory exists and is not empty: src/server/search/" bash -c '[ -n "$(ls -A src/server/search)" ]'
check "directory exists and is not empty: docs/screenshots/M07/" bash -c '[ -d docs/screenshots/M07 ] && [ -n "$(ls -A docs/screenshots/M07)" ]'

# 2. Dependencies (In scope 2; CLAUDE.md §3) ------------------------------------------------------------
check "the transliteration libraries and TanStack Form are pinned exactly (transliteration 2.6, pinyin-pro 3.29, to-jyutping 3.1, opencc-js 1.4)" node -e "
  const d = require('./package.json').dependencies || {};
  const want = { transliteration: /^2\.6\.\d+$/, 'pinyin-pro': /^3\.29\.\d+$/, 'to-jyutping': /^3\.1\.\d+$/, 'opencc-js': /^1\.4\.\d+$/, '@tanstack/react-form': /^\d+\.\d+\.\d+$/ };
  process.exit(Object.entries(want).every(([name, re]) => re.test(d[name] || '')) ? 0 : 1)"
check "the lockfile has them" bash -c '
  for p in "transliteration@2.6" "pinyin-pro@3.29" "to-jyutping@3.1" "opencc-js@1.4" "@tanstack/react-form@"; do grep -qE "^  '\''?$p" pnpm-lock.yaml || exit 1; done'
check "none of them has an install script, so none needs an allowBuilds entry (CLAUDE.md §3)" node -e "
  const lock = require('fs').readFileSync('pnpm-lock.yaml', 'utf8');
  const names = ['transliteration', 'pinyin-pro', 'to-jyutping', 'opencc-js', '@tanstack/react-form', '@tanstack/form-core'];
  const blocks = lock.split(/\n(?=  \S)/).filter((b) => names.some((n) => b.startsWith('  ' + n + '@') || b.startsWith('  \'' + n + '@')));
  process.exit(blocks.length >= names.length && blocks.every((b) => !/requiresBuild: true/.test(b)) ? 0 : 1)"
check "the new packages are listed in the third-party notices" bash -c '
  for p in transliteration pinyin-pro to-jyutping opencc-js "@tanstack/react-form"; do grep -q "$p" THIRD_PARTY_NOTICES.md || exit 1; done'
check "only src/server/search imports the transliteration libraries (ESLint module boundary)" bash -c '
  grep -q "module: '\''src/server/search'\''" eslint.config.mjs && grep -q "'\''pinyin-pro'\''" eslint.config.mjs && grep -q "'\''opencc-js'\''" eslint.config.mjs'
refute "no other module imports them" bash -c '
  grep -rnE "from '\''(transliteration|pinyin-pro|to-jyutping|opencc-js)" src --include=*.ts --include=*.tsx | grep -v "^src/server/search/"'

# 3. The procedures and their Server Actions (In scope 1, 3, 5, 7; plan §6.8) ---------------------------
check "pnpm api:openapi --check: docs/api/openapi.json matches the router (log: .verify/M07-openapi.log)" bash -c '
  mkdir -p .verify && pnpm --silent api:openapi --check > .verify/M07-openapi.log 2>&1'
check "the contract has /search (POST: the query never in a URL), /profile (GET), /profile/update, /consent/withdraw, /account/privacy (GET), /account/request-deletion" node -e "
  const p = require('./docs/api/openapi.json').paths || {};
  process.exit(p['/search']?.post && !p['/search']?.get && p['/profile']?.get && p['/profile/update']?.post && p['/consent/withdraw']?.post &&
    p['/account/privacy']?.get && p['/account/request-deletion']?.post ? 0 : 1)"
check "the router serves search.query, profile.update, consent.withdraw and account.requestDeletion through the services" bash -c '
  f=src/server/rpc/router.ts
  grep -q "searchQuery(context.principal, input, context.meta)" "$f" && grep -q "profileUpdate(context.principal, input, context.meta)" "$f" &&
  grep -q "consentWithdraw(context.principal, input, context.meta)" "$f" && grep -q "requestAccountDeletion(context.principal, input, context.meta)" "$f"'
check "the Server Actions wrap them (src/server/rpc/parity.ts)" bash -c '
  f=src/server/rpc/parity.ts
  grep -q "saveProfileAction'\'': { rpc: \['\''profile.update'\''\] }" "$f" && grep -q "withdrawConsentAction'\'': { rpc: \['\''consent.withdraw'\''\] }" "$f" &&
  grep -q "requestDeletionAction'\'': { rpc: \['\''account.requestDeletion'\''\] }" "$f"'
refute "the M07 pages and components never import src/server/db" \
  grep -rnE "from ['\"](@/server/db|.*server/db)" src/app/dashboard/profile src/app/account/privacy src/components/ui/search-palette.tsx src/components/shell/search-trigger.tsx

# 4. Privacy of the search and the profile (plan §6.2, §6.4, §6.6) ---------------------------------------
check "people come only through v_public_person, schools through v_public_school, lineages through v_public_edge" bash -c '
  f=src/server/search/query.ts
  grep -q "JOIN v_public_person p ON p.id = h.person_id" "$f" && grep -q "JOIN v_public_school s" "$f" && grep -q "FROM v_public_edge e" "$f"'
refute "the search names no private table (only person_name_key and person_name besides the public views)" \
  grep_code "\b(FROM|JOIN)[[:space:]]+\"?(person|person_bio|teaching_relationship|training_period|lineage|place|school[a-z_]*|auth_[a-z_]+|evidence[a-z_]*|audit_log|consent_record)\"?([[:space:]]|\)|$)" src/server/search/query.ts
check "the search answer passes the public DTO, which has no key, source or account field" bash -c '
  grep -q "return toPublicSearchResult(result);" src/server/services/search.ts &&
  ! grep -qE "^\s+(key|keyKind|source|claimedByUserId|email|birthDate)\b" src/server/dto/search.ts'
check "a match shows the stored person_name value (n.value), never the key" bash -c '
  grep -q "n.value AS name_value" src/server/search/query.ts && ! grep -qE "k\.key AS" src/server/search/query.ts'
check "the search transaction is read-only" grep -q "SET TRANSACTION READ ONLY" src/server/search/query.ts
check "the keys come only through v_public_person_key (a view of the keys of public people, for app_rw only)" bash -c '
  f=$(ls drizzle/*_m07_public_person_key/migration.sql) &&
  grep -q "CREATE VIEW \"v_public_person_key\" AS" "$f" && grep -q "FROM \"v_public_person\" p WHERE p.\"id\" = k.\"person_id\"" "$f" &&
  grep -q "GRANT SELECT ON TABLE \"v_public_person_key\" TO app_rw;" "$f" && ! grep -qE "TO [^;]*app_public_ro" "$f" &&
  grep -q "JOIN v_public_person_key k" src/server/search/query.ts && ! grep -qE "(FROM|JOIN) person_name_key" src/server/search/query.ts'
check "search is limited per client (ip_hmac) and the palette sends the query in the body, never the URL" bash -c '
  grep -q "SEARCHES_PER_WINDOW = 40" src/server/services/search.ts && grep -q "TOO_MANY_REQUESTS" src/server/services/search.ts &&
  grep -q "method: '\''POST'\''" src/components/ui/search-palette.tsx && grep -q "body: JSON.stringify({ q: trimmed })" src/components/ui/search-palette.tsx'
check "the recent searches are cleared on sign-out" grep -qF "writeRecentSearches([])" src/components/account/sign-out-form.tsx
refute "no name, key or query in a log line of the search, the store, the job or the profile" \
  grep_code "console\.(log|info|warn|error)\(" src/server/search/keys.ts src/server/search/store.ts src/server/search/query.ts src/server/services/search.ts src/server/services/profile.ts src/server/services/privacy.ts
check "the job logs counts only" grep -q 'wrote ${result.keys} key(s) for ${result.persons} person(s)' src/server/jobs/worker.ts
check "person.update audits kinds, scripts and choices, never the names or the biography" bash -c '
  f=src/server/services/profile.ts
  grep -q "action: '\''person.update'\''" "$f" && grep -q "never a name or the biography" "$f" &&
  awk "/action: '\''person.update'\''/,/ipHmac: meta.ipHmac/" "$f" | grep -q "shape(names)" &&
  ! awk "/action: '\''person.update'\''/,/ipHmac: meta.ipHmac/" "$f" | grep -qE "value: n\.value|body: bioBody"'
check "consent.withdraw and account.deletion_request are audit actions" bash -c '
  grep -q "'\''consent.withdraw'\''" src/server/audit/index.ts && grep -q "'\''account.deletion_request'\''" src/server/audit/index.ts &&
  grep -q "action: '\''consent.withdraw'\''" src/server/services/consent.ts && grep -q "action: '\''account.deletion_request'\''" src/server/services/privacy.ts'
check "the profile editor edits only the own person: 403 for another, checked in the service" bash -c '
  f=src/server/services/profile.ts
  grep -q "eq(person.claimedByUserId, p.user.id)" "$f" && grep -q "ServiceError('\''FORBIDDEN'\'', NOT_YOURS_MESSAGE)" "$f"'
check "a Latin-script primary name is required, in the service and in the database" bash -c '
  grep -q "MISSING_PRIMARY_MESSAGE" src/server/services/profile.ts && grep -q "person_name_primary_is_latin" src/server/db/schema/persons.ts'
check "the profile change drops the public cache (invalidatePublic) from the procedure and the Server Action" bash -c '
  grep -q "invalidatePublic(outcome.tags, '\''procedure'\'')" src/server/services/profile.ts &&
  grep -q "invalidatePublic(\[personTag(result.profile.personId)\], '\''server-action'\'')" src/app/dashboard/profile/actions.ts'
check "the names are stored in NFC (cleanName) and their search keys are written in the same transaction" bash -c '
  grep -q "normalize('\''NFC'\'')" src/server/services/names.ts && grep -q "await writePersonKeys(tx, own.id)" src/server/services/profile.ts &&
  grep -q "await writePersonKeys(tx, personId)" src/server/services/account.ts'

# 5. Keys and the job (In scope 2) -----------------------------------------------------------------------
check "keys.ts uses the Streamlined System, transliteration, pinyin-pro, to-jyutping and opencc-js" bash -c '
  f=src/server/search/keys.ts
  grep -q "bgStreamlined" "$f" && grep -q "from '\''transliteration'\''" "$f" && grep -q "from '\''pinyin-pro'\''" "$f" &&
  grep -q "from '\''to-jyutping'\''" "$f" && grep -q "from '\''opencc-js/t2cn'\''" "$f"'
check "the hand-kept aliases are rows with a source" bash -c '
  grep -q "source: HK_SURNAMES" src/server/search/aliases.ts && grep -q "source: string;" src/server/search/aliases.ts'
check "person_name_key has a source column and the alias kind (migration)" bash -c '
  grep -q "ADD COLUMN \"source\"" drizzle/*_m07_search_keys/migration.sql && grep -q "'\''alias'\''" drizzle/*_m07_search_keys/migration.sql'
check "a pg-boss job writes the keys of existing records; db:seed queues it; pnpm search:rebuild exists" bash -c '
  grep -q "searchKeysRebuild: '\''search.keys.rebuild'\''" src/server/jobs/queues.ts &&
  grep -q "boss.work(QUEUE.searchKeysRebuild" src/server/jobs/worker.ts &&
  grep -q "queueSearchKeysRebuild()" src/server/db/cli.ts &&
  node -e "process.exit(/search-rebuild/.test(require(\"./package.json\").scripts[\"search:rebuild\"] || \"\") ? 0 : 1)"'
check "app_public_ro still reads only its three views (no grant for the keys)" bash -c '
  ! grep -hE "TO [^;]*app_public_ro" drizzle/*_m07_search_keys/migration.sql'
unit_titles=(
  '"Тестов" gives testov'
  'generates pinyin and Jyutping keys from the characters'
  'gives the Traditional and the Simplified spelling the same key'
  'removes tone marks and diacritics'
  'keeps a Cyrillic and a Chinese name exactly, in NFC'
)
for t in "${unit_titles[@]}"; do
  check "keys.test.ts: $t" grep -qF "it('$t'" src/server/search/keys.test.ts
done
refute "no skipped or focused M07 unit or integration test" \
  grep -nE "\b(it|test|describe)\.(skip|only|todo)\(" src/server/search/keys.test.ts src/server/services/search.int.test.ts

# 6. The palette and the screens (In scope 4, 8; plan §5.6, §5.8) -----------------------------------------
check "the palette is Base UI Autocomplete in a Dialog, searches after 200 ms, aborts stale requests and skips IME composition" bash -c '
  f=src/components/ui/search-palette.tsx
  grep -q "from '\''@base-ui/react/autocomplete'\''" "$f" && grep -q "from '\''@base-ui/react/dialog'\''" "$f" &&
  grep -q "SEARCH_DEBOUNCE_MS = 200" "$f" && grep -q "controller.current?.abort()" "$f" &&
  grep -q "onCompositionStart" "$f" && grep -q "onCompositionEnd" "$f" && grep -q "isComposing" "$f"'
check "Ctrl/⌘+K opens it; Ctrl/⌘+Enter goes to /explore?focus=<id>; recent searches in localStorage with try/catch and Clear" bash -c '
  grep -q "event.ctrlKey || event.metaKey" src/components/shell/search-trigger.tsx &&
  grep -q "/explore?focus=\${hit.id}" src/components/ui/search-palette.tsx &&
  grep -q "localStorage" src/components/ui/search-palette.tsx && grep -q "catch {" src/components/ui/search-palette.tsx &&
  grep -q "Clear<span className=\"sr-only\"> recent searches</span>" src/components/ui/search-palette.tsx'
refute "no page-wide \"/\" shortcut (WCAG 2.1.4)" grep -nE "key === '/'|key == '/'|'Slash'" src/components/shell/search-trigger.tsx src/components/ui/search-palette.tsx src/app/layout.tsx
check "on a phone the palette fills the screen with dvh and safe areas" bash -c '
  f=src/components/ui/search-palette.tsx; grep -q "h-dvh" "$f" && grep -q "env(safe-area-inset-bottom" "$f" && ! grep -q "100vh" "$f"'
check "the shell has the visible search field and loads the palette on first use" bash -c '
  grep -q "<SearchField variant=\"bar\" />" src/components/shell/app-shell.tsx && grep -q "<SearchField variant=\"rail\" />" src/components/shell/app-shell.tsx &&
  grep -q "lazy(loadPalette)" src/components/shell/search-trigger.tsx'
check "the profile editor uses TanStack Form and the Zod rules of src/lib/profile-form.ts" bash -c '
  grep -q "from '\''@tanstack/react-form'\''" src/app/dashboard/profile/profile-editor.tsx && grep -q "profileFormErrors" src/app/dashboard/profile/profile-editor.tsx &&
  grep -q "from '\''zod'\''" src/lib/profile-form.ts'
check "\"Show my profile publicly\" is never ticked in advance, follows the profile and is required in the API (DEFAULT D03)" bash -c '
  grep -q "showPublicly: profile.visibility === '\''public'\''" src/app/dashboard/profile/page.tsx && grep -q "showPublicly: z.boolean({" src/server/services/profile.ts'
for route in "'/dashboard/profile'.*name: 'profile'.*milestone: 'M07', key: true" "'/account/privacy'.*name: 'account-privacy'.*milestone: 'M07', key: true"; do
  check "e2e/routes.ts: $route (axe in both themes, visual regression, screenshots)" grep -qE "path: $route" e2e/routes.ts
done
check "the palette is in the visual regression (@visual)" grep -q "palette-\${size.name}-\${theme}.png" e2e/visual.spec.ts
for screen in profile account-privacy palette; do
  for size in "${SIZES[@]}"; do
    for theme in "${THEMES[@]}"; do
      check "screenshot: docs/screenshots/M07/$screen-$size-$theme.png" test -s "docs/screenshots/M07/$screen-$size-$theme.png"
    done
  done
done
check "the design review covers both sizes, both themes and the three screens" bash -c '
  f=docs/design/reviews/M07.md
  for w in 390x844 1440x900 dark light profile account-privacy palette direction.md; do grep -q "$w" "$f" || exit 1; done'

# 7. E2E titles (Done when 3) ----------------------------------------------------------------------------
titles=(
  '@M07 Ctrl+K opens the palette and the query "Тестов" finds demo-latin-name'
  '@M07 a Jyutping query finds demo-cjk-name and shows its stored name'
  '@M07 a match on a generated Jyutping key shows the stored primary name, not the generated romanization'
  '@M07 Simplified and Traditional spellings find the same person'
  '@M07 a toneless pinyin query finds demo-cjk-name'
  '@M07 a query filtered by country returns only people and schools in that country'
  '@M07 no query is sent during IME composition and one is sent after compositionend'
  '@M07 search results contain only public persons and no private fields'
  '@M07 pressing "/" with focus outside the graph does not open the palette'
  "@M07 a user edits their own names in three scripts; editing another person's profile is refused"
  '@M07 saving a profile without a Latin-script primary name is refused with a clear message'
  '@M07 Ctrl+Enter navigates to /explore?focus=<id> of the selected person'
  '@M07 withdrawing a consent records consent.withdraw'
  '@M07 a deletion request creates a review case and notifies admins'
  '@M07 at 390x844 the palette opens full screen and a result can be chosen by touch'
  '@M07 no axe violations with the palette open in dark and light themes'
)
for t in "${titles[@]}"; do
  check "E2E test: $t" grep -qF -- "$t" e2e/m07-search.spec.ts
done
refute "no skipped or focused M07 E2E test" grep -nE "test\.(skip|only|fixme)\(" e2e/m07-search.spec.ts

# 8. Decisions by default and documentation (In scope 5, 6, 9; docs/plan/RULES.md) -----------------------
check "the deletion retention is a DEFAULT, recorded as a question" bash -c '
  grep -q "DEFAULT (not a D-number; docs/plan/questions/M07.md" src/server/services/privacy.ts &&
  grep -q "What an account deletion keeps" docs/plan/questions/M07.md'
check "DEFAULT D03 is marked where the owner hides a public profile" grep -q "DEFAULT D03" src/server/services/profile.ts
check "docs/search.md has the thresholds and the known limits (short Chinese names)" bash -c '
  f=docs/search.md
  grep -q "0,3" "$f" && grep -q "0,5" "$f" && grep -q "200 ms" "$f" && grep -q "pg_trgm" "$f" && grep -qi "кратк" "$f" && grep -q "search.keys.rebuild" "$f"'
check "the user guide covers names (Chinese characters, Jyutping, pinyin), search, the public profile, withdrawing a consent and deletion" bash -c '
  f=docs/guides/user-guide.bg.md
  grep -q "Jyutping" "$f" && grep -q "пинин" "$f" && grep -q "Ctrl+K" "$f" && grep -q "Show my profile publicly" "$f" &&
  grep -q "/account/privacy" "$f" && grep -q "Request account deletion" "$f"'
check "the admin guide covers handling a deletion request and pnpm search:rebuild" bash -c '
  f=docs/guides/admin-guide.bg.md
  grep -q "deletion_request" "$f" && grep -q "pnpm search:rebuild" "$f" && grep -q "/admin#deletion-requests" "$f"'
check "docs/plan/README.md has a status for M07" bash -c '! grep -qE "^\| M07 .*\| не е започнат \|$" docs/plan/README.md'
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
  echo "M07 checks: $failures failed"
  exit 1
fi
echo "M07 checks: all passed"
