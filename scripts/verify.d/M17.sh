#!/usr/bin/env bash
# Milestone M17 checks (docs/plan/M17-events.md, "Done when"), run by scripts/verify.sh after the
# unit tests (src/lib/event-time.test.ts: the hour across the summer-time changes, the month key;
# src/lib/ics.test.ts: RFC 5545; src/server/entitlements/plans.test.ts: events available now and
# enforced), the integration tests (src/server/services/events.int.test.ts and the event rows of the
# authorization matrix), db:check, db:reset+migrate+seed, the build with the bundle budgets and E2E
# (`@smoke|@M17`: e2e/m17-calendar.spec.ts on the desktop and phone projects; e2e/m17-events.spec.ts
# publishes and removes events, so it runs in the exclusive run after the others, e2e/projects.ts).
# They stay valid after M17, so `scripts/verify.sh all` keeps running them.
#
# Here: required files, the one migration and its public view, the services and their permission
# checks, the procedures and their Server Actions, the decisions by default, the time zone and the
# .ics without a library, the UI rules, the E2E and integration titles, and the documentation.
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

SERVICE=src/server/services/events.ts
DTO=src/server/dto/events.ts
TIME=src/lib/event-time.ts
ICS=src/lib/ics.ts
ICS_ROUTE='src/app/events/[slug]/calendar.ics/route.ts'
POSTER_ROUTE='src/app/api/event-posters/[id]/[hash]/[file]/route.ts'
NOTIFY=src/server/jobs/event-notify.ts
LIST_PAGE=src/app/events/page.tsx
EVENT_PAGE='src/app/events/[slug]/page.tsx'
ROWS=src/components/events/event-list.tsx
DASHBOARD=src/app/dashboard/events/page.tsx
FORM=src/app/dashboard/events/event-form.tsx
NAV=src/components/shell/nav.ts
SPEC=e2e/m17-events.spec.ts
CAL_SPEC=e2e/m17-calendar.spec.ts
INT=src/server/services/events.int.test.ts
mapfile -t M17_SQL < <(ls drizzle/*_m17_events/migration.sql 2>/dev/null)

# 1. Required files (Done when 5) ------------------------------------------------------------------
required=(
  "$SERVICE" "$DTO" "$TIME" "$ICS" "$ICS_ROUTE" "$POSTER_ROUTE" "$NOTIFY" "$LIST_PAGE" "$EVENT_PAGE" "$ROWS"
  "$DASHBOARD" "$FORM" src/app/dashboard/events/new/page.tsx 'src/app/dashboard/events/[id]/page.tsx'
  'src/app/dashboard/events/[id]/poster/page.tsx' src/app/dashboard/events/actions.ts 'src/app/events/[slug]/actions.ts'
  src/server/db/schema/events.ts src/lib/event-time.test.ts src/lib/ics.test.ts "$SPEC" "$CAL_SPEC" "$INT"
  docs/adr/0020-events.md docs/plan/M17-events.md docs/plan/questions/M17.md
  docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md docs/data-model.md docs/entitlements.md
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done

# 2. One migration and the public view (In scope 1, 7; plan §3.2, §6.4) ----------------------------
check "exactly one M17 migration (m17_events), with its snapshot" bash -c '
  [ "'"${#M17_SQL[@]}"'" -eq 1 ] && [ -s "$(dirname "'"${M17_SQL[0]:-none}"'")/snapshot.json" ]'
if [ "${#M17_SQL[@]}" -eq 1 ]; then
  SQL="${M17_SQL[0]}"
  check "the migration creates event and event_instructor" bash -c "grep -q 'CREATE TABLE \"event\"' '$SQL' && grep -q 'CREATE TABLE \"event_instructor\"' '$SQL'"
  check "an event is in a city or online, has one organizer, and links only https" bash -c "
    grep -q 'event_place_or_online' '$SQL' && grep -q 'event_one_organizer' '$SQL' && grep -q 'event_external_url_https' '$SQL'"
  check "app_public_ro reads v_public_event (security_barrier) and no event table" bash -c "
    grep -q 'CREATE VIEW \"v_public_event\" WITH (security_barrier = true)' '$SQL' &&
    grep -q 'GRANT SELECT ON TABLE \"v_public_event\" TO app_rw, app_public_ro;' '$SQL' &&
    ! grep -qE 'GRANT [A-Z, ]+ ON TABLE \"event(_instructor)?\" TO [a-z_, ]*app_public_ro' '$SQL'"
  check "the view shows published and cancelled events, people only through v_public_person, a school only through v_public_school" bash -c "
    grep -q \"WHERE e.\\\"status\\\" IN ('published', 'cancelled')\" '$SQL' && grep -q 'JOIN \"v_public_person\" op' '$SQL' &&
    grep -q 'JOIN \"v_public_person\" p' '$SQL' && grep -q 'JOIN \"v_public_school\" s' '$SQL'"
  refute "the view names no point, account, staff reason or storage key" bash -c "
    awk '/CREATE VIEW \"v_public_event\"/{f=1} f{print} f && /;/{exit}' '$SQL' | grep -nE 'public_point|exact_point|organizer_user_id|created_by_user_id|removal_reason|removed_by|poster_storage_key|ST_'"
  refute "the migration stays on PostgreSQL 16+ (no uuidv7(), no virtual generated columns, no OLD/NEW in RETURNING)" \
    grep -nEi "uuidv7\(|VIRTUAL|RETURNING[^;]*\b(OLD|NEW)\." "$SQL"
fi
check "the privacy test lists v_public_event among the public views" grep -q "'public.v_public_event'" src/server/db/privacy.int.test.ts

# 3. Time zones and calendar files without a library (plan §3.2; Stop and ask) ---------------------
check "the event's time uses the platform's Intl only" bash -c "grep -q 'Intl.DateTimeFormat' $TIME && grep -q 'export function wallTimeToInstant' $TIME && grep -q 'export function monthKey' $TIME"
refute "no time zone or calendar library in package.json" grep -nE '"(luxon|moment|moment-timezone|date-fns-tz|@date-fns/tz|dayjs|spacetime|@js-temporal/polyfill|temporal-polyfill|ical-generator|ics|node-ical|ical\.js|rrule)"' package.json
check "the .ics is RFC 5545: CRLF, UTC times, folded lines, escaped text, a cancelled status" bash -c "
  grep -qF \".join('\\\\r\\\\n')\" $ICS && grep -q 'export function foldLine' $ICS && grep -q 'export function icsText' $ICS &&
  grep -q 'export function icsUtc' $ICS && grep -q \"'CANCELLED'\" $ICS"
check "the .ics route is built from the public page's data and is 404 for an event not listed" bash -c "
  grep -q 'loadEvent' '$ICS_ROUTE' && grep -q \"read.state === 'none'\" '$ICS_ROUTE' && grep -q 'text/calendar' '$ICS_ROUTE'"

# 4. The plan's allowance (In scope 2; DEFAULT M17 question 1, DEFAULT D25) ------------------------
check "events is available now and enforced, with the Professional Sifu limit of 3 a month (owner decision 2026-11-05)" bash -c "
  f=src/server/entitlements/plans.ts; awk '/^    key: .events.,/{on=1} on && /availability: .now.,/{a=1} on && /enforced: true,/{e=1} on && /limit: 3 }/{l=1} on && /^  \\},/{exit} END{exit !(a && e && l)}' \"\$f\""
check "the plan matrix version was bumped and docs/entitlements.md says what changed" bash -c "
  grep -q \"PLAN_MATRIX_VERSION = '2026-11-05.1'\" src/server/entitlements/plans.ts && grep -q '2026-11-04.1' docs/entitlements.md && grep -q '2026-11-05.1' docs/entitlements.md"
check "the count is under the quota lock, in the event's own zone, published events only" bash -c "
  grep -q 'lockQuota' $SERVICE && grep -q 'async function publishedInMonth' $SERVICE && grep -q 'monthKey(f.startsAt, f.timezone)' $SERVICE &&
  grep -q 'DEFAULT M17 (question 1)' $TIME"
check "an organization publishes only with Federation, without a limit (DEFAULT D25)" bash -c "
  grep -q 'async function checkOrganization' $SERVICE && grep -q 'DEFAULT D25' $SERVICE && grep -q 'organizationPlan' $SERVICE"
check "a refusal is ENTITLEMENT_REQUIRED with the decision for a machine; the prompt lists only 'now' benefits" bash -c "
  grep -q \"new ServiceError('ENTITLEMENT_REQUIRED', message\" $SERVICE && grep -q \"upgradeBenefits(decision.plan, decision.grantedBy, 'events')\" $SERVICE"

# 5. Publishing, cancelling, removing (In scope 3; DEFAULT M17 question 2) -------------------------
check "published at once (no review), marked as a default" bash -c "grep -q 'DEFAULT M17 (question 2)' src/server/db/schema/events.ts && grep -q 'DEFAULT M17, question 2' $SERVICE"
check "removal needs staff with a verified second factor and a reason, and is audited" bash -c "
  grep -q 'requireStaff2FA(principal)' $SERVICE && grep -q \"action: 'event.remove'\" $SERVICE"
check "every change is audited (event.*)" bash -c "
  for a in event.create event.update event.cancel event.remove event.poster_upload event.poster_remove; do
    grep -q \"| '\$a'\" src/server/audit/index.ts && grep -q \"action: '\$a'\" $SERVICE || exit 1; done"
check "a cancelled event is marked in words and with a shape, never colour alone" bash -c "
  grep -q 'export function CancelledMark' $ROWS && grep -q '<rect' $ROWS && grep -q 'Cancelled' $ROWS"
check "account deletion removes the Sifu's own events" grep -q 'removeOwnEvents' src/server/services/privacy.ts

# 6. Notices (In scope 4; DEFAULT M17 question 3) --------------------------------------------------
check "the notices are a background job with a singleton key, sent from the same transaction" bash -c "
  grep -q \"eventsNotify: 'events.notify'\" src/server/jobs/queues.ts && grep -q 'enqueue(tx, QUEUE.eventsNotify' $SERVICE && grep -q 'singletonKey' $SERVICE &&
  grep -q 'boss.work(QUEUE.eventsNotify' src/server/jobs/worker.ts"
check "only Premium Students of an established teacher (verified or in arbitration) get them" bash -c "
  grep -q \"=== 'premium_student'\" $NOTIFY && grep -q 'PUBLIC_RELATIONSHIP_STATUSES' $NOTIFY && grep -q 'DEFAULT M17 (question 3)' $NOTIFY && grep -q 'vPublicEvent' $NOTIFY"
check "the notice texts live in src/server/templates" bash -c "grep -q \"name: 'event.published'\" src/server/templates/notifications.ts && grep -q \"name: 'event.cancelled'\" src/server/templates/notifications.ts"
refute "no event title, text or storage key in a log line of the event code" grep -nE "console\.(log|info|warn|error)\([^)]*(title|description|venue|storageKey|posterStorageKey|external)" "$SERVICE" "$NOTIFY" "$LIST_PAGE" "$EVENT_PAGE" "$ICS_ROUTE"

# 7. The procedures and the Server Actions (In scope 5; plan §6.8) ---------------------------------
mkdir -p .verify
check "pnpm api:openapi --check: docs/api/openapi.json matches the router (log: .verify/M17-openapi.log)" bash -c '
  pnpm --silent api:openapi --check > .verify/M17-openapi.log 2>&1'
check "the contract has every events procedure (the poster upload multipart), the poster route and the .ics" node -e "
  const doc = require('./docs/api/openapi.json');
  const ops = Object.values(doc.paths).flatMap((p) => Object.values(p)).map((o) => o.operationId);
  const want = ['events.list', 'events.get', 'events.mine', 'events.editor', 'events.create', 'events.update', 'events.cancel', 'events.remove',
    'events.uploadPoster', 'events.removePoster', 'events.poster', 'events.calendar'];
  for (const id of want) if (!ops.includes(id)) { console.error('missing', id); process.exit(1); }
  if (!doc.paths['/events/poster/upload'].post.requestBody.content['multipart/form-data']) process.exit(1);"
check "the four Server Actions are in the API parity table and in the authorization matrix" bash -c "
  for a in 'src/app/dashboard/events/actions.ts#createEventAction' 'src/app/dashboard/events/actions.ts#updateEventAction' \
    'src/app/dashboard/events/actions.ts#cancelEventAction' 'src/app/events/[slug]/actions.ts#removeEventAction'; do
    grep -qF \"'\$a'\" src/server/rpc/parity.ts && grep -qF \"action: '\$a'\" src/server/rpc/authz-matrix.int.test.ts || exit 1; done"
check "the authorization matrix has the event rows (a removed event, an own event, the poster route)" bash -c "
  f=src/server/rpc/authz-matrix.int.test.ts
  for p in \"path: 'events.list'\" \"path: 'events.get (removed event)'\" \"path: 'events.editor (an event)'\" \"path: 'events.create'\" \"path: 'events.remove'\" \
    \"path: 'events.uploadPoster'\" \"path: 'GET /api/event-posters/{id}/{hash}/{file} (removed event)'\"; do grep -qF \"\$p\" \"\$f\" || exit 1; done"
check "the poster is processed like a gallery photo (no metadata) and served through openEventPoster" bash -c "
  grep -q 'renderGalleryPhoto' $SERVICE && grep -q 'getPhotoStore' $SERVICE && grep -q 'openEventPoster' src/server/photo-http.ts && grep -q \"kind: 'event'\" '$POSTER_ROUTE'"

# 8. Privacy of the public answers (In scope 7; CLAUDE.md §6) --------------------------------------
refute "the public DTOs name no account, staff reason, storage key or point" grep -nE "organizerUserId|createdByUserId|removalReason|removedBy|posterStorageKey|storageKey|public_point|lat:|lng:" "$DTO"
check "the cached reads return public DTOs only, from the public view" bash -c "
  grep -q \"'use cache'\" $SERVICE && grep -q 'return toPublicEventList(' $SERVICE && grep -q 'return toPublicEventPage(' $SERVICE && grep -q 'getPublicDb()' $SERVICE"
check "JSON-LD names the city only (a Place with its locality), never the venue" bash -c "
  grep -q \"'@type': 'Place', name: event.city\" '$EVENT_PAGE' && ! awk '/function jsonLd/{f=1} f{print} f && /^}/{exit}' '$EVENT_PAGE' | grep -q 'venue'"

# 9. The interface (In scope 6; CLAUDE.md §10, §11) ------------------------------------------------
check "Events is the fifth tab, between Schools and Me (DEFAULT M17 question 4)" bash -c "
  grep -q 'DEFAULT M17 (question 4)' $NAV && grep -q \"href: '/events', label: 'Events'\" $NAV &&
  awk '/label: .Schools./{s=NR} /label: .Events./{e=NR} /label: .Me./{m=NR} END{exit !(s && e && m && s < e && e < m)}' $NAV"
check "/events is a plain GET form (works without JavaScript), its state in the address" bash -c "grep -q 'method=\"get\" action=\"/events\"' $LIST_PAGE && grep -q 'role=\"search\"' $LIST_PAGE"
check "the organizer's link opens in the same window" bash -c "grep -q 'rel=\"nofollow noopener\"' '$EVENT_PAGE' && ! grep -q 'target=\"_blank\"' '$EVENT_PAGE'"
refute "no window.open, no 100vh, no hover-only behaviour, no target=_blank in the M17 pages" grep -nE "window\.open|100vh|group-hover:|onMouseEnter|target=\"_blank\"" \
  "$LIST_PAGE" "$EVENT_PAGE" "$ROWS" "$DASHBOARD" "$FORM" src/app/dashboard/events/poster-control.tsx
refute "no urgency in the event copy (left, hurry, only today, countdown)" grep -nEi "\b(hurry|only today|countdown|last chance|don.t miss)\b|\{[a-z.]+\} left" "$DASHBOARD" "$FORM" "$SERVICE"
check "the new pages are in e2e/routes.ts (axe in both themes)" bash -c "
  grep -q \"path: '/events', name: 'events', status: 200, milestone: 'M17'\" e2e/routes.ts &&
  grep -q \"path: '/events/demo-seminar-chum-kiu-sofia', name: 'event', status: 200, milestone: 'M17'\" e2e/routes.ts &&
  grep -q \"name: 'dashboard-events'\" e2e/routes.ts"

# 10. Demo data (In scope 8; D20) ------------------------------------------------------------------
check "the demo events are fictional demo- records on fixed dates; a demo Premium Student" bash -c "
  f=src/fixtures/generate.ts; grep -q \"slug: 'demo-seminar-chum-kiu-sofia'\" \"\$f\" && grep -q \"slug: 'demo-cancelled-exam-session'\" \"\$f\" &&
  grep -q \"slug: 'demo-federation-summer-camp'\" \"\$f\" && grep -q \"slug: 'demo-grading-day-sofia'\" \"\$f\" && grep -q \"DEMO_PREMIUM_STUDENT = 'demo-premium-student'\" \"\$f\" &&
  ! awk '/function demoEvents/{f=1} f{print} f && /^}/{exit}' \"\$f\" | grep -oE \"slug: '[^']+'\" | grep -v \"slug: 'demo-\""

# 11. E2E and integration titles (Done when 3) -----------------------------------------------------
titles=(
  "$CAL_SPEC|@M17 the calendar lists the upcoming events by month and filters them with the keyboard"
  "$CAL_SPEC|@M17 without JavaScript the filter form works as a plain GET form"
  "$CAL_SPEC|@M17 an event page shows its dates in its own zone, links its people, and gives an .ics file and JSON-LD with the city only"
  "$SPEC|@M17 a Professional Sifu publishes three events in a month, the fourth is refused, and a Premium Student is told"
  "$SPEC|@M17 a Free Sifu cannot publish: the upgrade prompt shows only benefits that exist now, and the API refuses"
  "$SPEC|@M17 staff with a verified second factor remove an event with a reason; it is gone and the audit log keeps the reason"
)
for entry in "${titles[@]}"; do
  check "E2E test: ${entry#*|}" grep -qF "${entry#*|}" "${entry%%|*}"
done
check "the E2E runs axe in both themes" bash -c "grep -q 'expectNoAxeViolations' $SPEC && grep -q 'for (const theme of THEMES)' $SPEC && grep -q 'for (const theme of THEMES)' $CAL_SPEC"
check "the writing M17 spec runs in the exclusive run (PUBLIC_WRITE_SPECS); the calendar spec in the desktop and phone projects" bash -c "
  grep -qE \"^export const PUBLIC_WRITE_SPECS = \\[.*'\\*\\*/m17-events\\.spec\\.ts'.*\\] as const;\$\" e2e/projects.ts &&
  ! grep -q 'm17-calendar' e2e/projects.ts"
int_titles=(
  "$INT|three a month; the fourth is refused with ENTITLEMENT_REQUIRED and no upgrade above Professional Sifu"
  "$INT|publications at once never pass the limit together (the quota lock): 3 pass, the 4th is refused"
  "$INT|counts the month in the event’s own zone, not in UTC"
  "$INT|a move to a full month is refused; a change inside the month is not"
  "$INT|an organization publishes only with Federation, then without a limit (DEFAULT D25)"
  "$INT|an instructor or organizer the public cannot see is not shown; no account, reason or storage key"
  "$INT|only Premium Students of the organizer or an instructor, once per person and change"
  "$INT|needs a verified second factor and a reason; audited; 404 everywhere, the poster too"
)
for entry in "${int_titles[@]}"; do
  check "integration test: ${entry#*|}" grep -qF "${entry#*|}" "${entry%%|*}"
done
check "the unit tests cover the summer-time changes and the month key" bash -c "grep -qi 'summer\\|DST\\|skip' src/lib/event-time.test.ts && grep -q 'monthKey' src/lib/event-time.test.ts"

# 12. Documentation (In scope 10) ------------------------------------------------------------------
check "ADR 0020 records the defaults, D25, the zone, the .ics and the not-listed page" bash -c "
  f=docs/adr/0020-events.md; grep -q 'DEFAULT M17' \"\$f\" && grep -q 'D25' \"\$f\" && grep -q 'v_public_event' \"\$f\" && grep -q 'RFC 5545' \"\$f\" && grep -q 'not listed' \"\$f\""
check "questions/M17.md has the four questions and D25, each with a proposed default" bash -c "
  f=docs/plan/questions/M17.md; [ \"\$(grep -c '^## 2026-' \"\$f\")\" -ge 5 ] && [ \"\$(grep -c '^\\*\\*Proposed default:\\*\\*' \"\$f\")\" -ge 5 ]"
check "docs/data-model.md describes event, event_instructor and v_public_event" bash -c "f=docs/data-model.md; grep -q '\`event\`' \"\$f\" && grep -q 'event_instructor' \"\$f\" && grep -q 'v_public_event' \"\$f\""
check "the user guide covers the calendar, publishing and the notices" bash -c "
  f=docs/guides/user-guide.bg.md; grep -q '## Календар на събитията (M17)' \"\$f\" && grep -q 'Add to calendar' \"\$f\" && grep -q 'Publish an event' \"\$f\""
check "the admin guide covers the tables, the allowance, the moderation and the notices" bash -c "
  f=docs/guides/admin-guide.bg.md; grep -q '## 23. Календар на събитията (M17)' \"\$f\" && grep -q 'event.remove' \"\$f\" && grep -q 'events.notify' \"\$f\""
check "docs/plan/README.md has a status for M17" bash -c 'grep -qE "^\| M17 " docs/plan/README.md && ! grep -qE "^\| M17 .*\| не е започнат \|$" docs/plan/README.md'
check "the milestone file has a Progress log with entries" bash -c "awk '/^## Дневник на напредъка/{f=1;next} f && /^- /{n++} END{exit !(n>0)}' docs/plan/M17-events.md"
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  for guide in docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md; do
    check "$guide changed in this branch (differs from the merge base with origin/main)" bash -c "! git diff --quiet $base -- $guide"
  done
else
  ok "the guides changed in this branch: not checkable here (merged, or no origin/main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M17 checks: $failures failed"
  exit 1
fi
echo "M17 checks: all passed"
