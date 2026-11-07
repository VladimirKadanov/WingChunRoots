#!/usr/bin/env bash
# Milestone M19 checks (docs/plan/M19-passport.md, "Done when"), run by scripts/verify.sh after the
# unit tests (src/lib/passport-time.test.ts: experience by the precision of the dates and the
# timeline; src/server/entitlements/plans.test.ts: the passport feature and its level), the
# integration tests (src/server/services/passport.int.test.ts and the passport rows of the
# authorization matrix), db:check, db:reset+migrate+seed, the build and E2E (`@smoke|@M19`:
# e2e/m19-passport-view.spec.ts on the desktop and phone projects; e2e/m19-passport.spec.ts, which
# makes passports of public people, in the exclusive run). They stay valid after M19, so
# `scripts/verify.sh all` keeps running them.
#
# Here: required files, the one migration and its public view, the privacy rules, the plan's
# passport, the procedures and their Server Actions, the decisions by default, the UI rules, the
# demo data, the E2E and integration titles, and the documentation.
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

SCHEMA=src/server/db/schema/passport.ts
SERVICE=src/server/services/passport.ts
DTO=src/server/dto/passport.ts
TIME=src/lib/passport-time.ts
PLANS=src/server/entitlements/plans.ts
ROUTE=src/app/api/certificates/[id]/[hash]/[file]/route.ts
VIEW=src/components/passport/passport-view.tsx
PROFILE='src/app/people/[slug]/page.tsx'
OWN_PAGE=src/app/dashboard/passport/page.tsx
OWN_CONTROLS=src/app/dashboard/passport/controls.tsx
TEACHER_PAGE=src/app/dashboard/students/page.tsx
TEACHER_FORMS=src/app/dashboard/students/passport-forms.tsx
SPEC=e2e/m19-passport.spec.ts
VIEW_SPEC=e2e/m19-passport-view.spec.ts
INT=src/server/services/passport.int.test.ts
mapfile -t M19_SQL < <(ls drizzle/*_m19_passport/migration.sql 2>/dev/null)

# 1. Required files (Done when 5) ------------------------------------------------------------------
required=(
  "$SCHEMA" "$SERVICE" "$DTO" "$TIME" src/lib/passport-time.test.ts "$ROUTE" "$VIEW" "$OWN_PAGE" "$OWN_CONTROLS"
  src/app/dashboard/passport/actions.ts src/app/dashboard/passport/correction-form.tsx "$TEACHER_PAGE" "$TEACHER_FORMS"
  src/app/dashboard/students/actions.ts 'src/app/people/[slug]/passport-actions.ts' 'src/app/people/[slug]/passport-remove-form.tsx'
  "$SPEC" "$VIEW_SPEC" "$INT" docs/adr/0022-passport.md docs/plan/M19-passport.md docs/plan/questions/M19.md
  docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md docs/data-model.md docs/entitlements.md
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done

# 2. One migration and its public view (In scope 1; plan §3.2) -------------------------------------
check "exactly one M19 migration (m19_passport), with its snapshot" bash -c '
  [ "'"${#M19_SQL[@]}"'" -eq 1 ] && [ -s "$(dirname "'"${M19_SQL[0]:-none}"'")/snapshot.json" ]'
if [ "${#M19_SQL[@]}" -eq 1 ]; then
  SQL="${M19_SQL[0]}"
  check "the migration creates the five passport tables" bash -c "
    for t in passport_rank passport_exam passport_skill passport_certificate event_attendance; do grep -q \"CREATE TABLE \\\"\$t\\\"\" '$SQL' || exit 1; done"
  check "every entry has a visibility and a status (active, withdrawn, removed)" bash -c "
    [ \"\$(grep -c \"\\\"visibility\\\" text DEFAULT\" '$SQL')\" -ge 5 ] && [ \"\$(grep -c \"\\\"status\\\" text DEFAULT 'active'\" '$SQL')\" -ge 5 ]"
  check "a certificate starts private and its key is in certificates/ (DEFAULT M19, questions 4 and 5)" bash -c "
    grep -q \"\\\"visibility\\\" text DEFAULT 'private'\" '$SQL' && grep -qF \"'^certificates/[0-9a-f]{48}\$'\" '$SQL'"
  check "one active attendance per event and person" grep -qF 'CREATE UNIQUE INDEX "event_attendance_active_key" ON "event_attendance" ("event_id","person_id") WHERE "status" = '"'active'" "$SQL"
  check "app_rw reads, writes and never deletes; app_public_ro never reads the tables" bash -c "
    grep -q 'GRANT SELECT, INSERT, UPDATE ON TABLE \"passport_rank\", \"passport_exam\", \"passport_skill\", \"passport_certificate\", \"event_attendance\" TO app_rw;' '$SQL' &&
    grep -q 'REVOKE ALL ON TABLE \"passport_rank\", \"passport_exam\", \"passport_skill\", \"passport_certificate\", \"event_attendance\" FROM app_public_ro;' '$SQL'"
  check "the public view: active and public entries of public people, through the public views only" bash -c "
    awk '/CREATE VIEW \"v_public_passport\"/{f=1} f{print} f && /;\$/{exit}' '$SQL' > /tmp/m19-view.\$\$ &&
    grep -q 'security_barrier' /tmp/m19-view.\$\$ && [ \"\$(grep -c \"status\\\" = 'active' AND [a-z]*.\\\"visibility\\\" = 'public'\" /tmp/m19-view.\$\$)\" -ge 5 ] && grep -q 'v_public_person' /tmp/m19-view.\$\$ &&
    grep -q 'v_public_organization' /tmp/m19-view.\$\$ && grep -q 'v_public_event' /tmp/m19-view.\$\$ &&
    ! grep -qE 'storage_key|removal_reason|correction_note|created_by_user_id' /tmp/m19-view.\$\$; rc=\$?; rm -f /tmp/m19-view.\$\$; exit \$rc"
  check "the public view is granted to app_rw only" bash -c "grep -q 'GRANT SELECT ON TABLE \"v_public_passport\" TO app_rw;' '$SQL' && ! grep -q 'v_public_passport\" TO app_public_ro' '$SQL'"
  refute "the migration stays on PostgreSQL 16+ (no uuidv7(), no virtual generated columns, no OLD/NEW in RETURNING)" \
    grep -nEi "uuidv7\(|VIRTUAL|RETURNING[^;]*\b(OLD|NEW)\." "$SQL"
fi

# 3. Privacy (In scope 5, 8; CLAUDE.md §6) ---------------------------------------------------------
check "passport.get reads the public view only, through the public DTO, never cached" bash -c "
  awk '/^export async function passportGet/{f=1} f{print} f && /^}/{exit}' $SERVICE > /tmp/m19-get.\$\$ &&
  grep -q 'v_public_passport' /tmp/m19-get.\$\$ && grep -q 'toPublicPassport(' /tmp/m19-get.\$\$ && ! grep -qE 'passport_(rank|exam|skill|certificate)\\b|event_attendance' /tmp/m19-get.\$\$; rc=\$?; rm -f /tmp/m19-get.\$\$; exit \$rc"
refute "no 'use cache' in the passport service, its DTO or pages" grep -n "'use cache'" "$SERVICE" "$DTO" "$VIEW" "$OWN_PAGE" "$TEACHER_PAGE"
check "certificates live in the private store and are read through the app, never presigned" bash -c "
  grep -q \"newStorageKey('certificates')\" $SERVICE && grep -q 'store: ObjectStore = getEvidenceStore()' $SERVICE && ! grep -vE '^\\s*(//|\\*)' $SERVICE | grep -qiE 'presign|getSignedUrl' &&
  grep -q \"kind: 'certificate'\" '$ROUTE' && grep -q 'openCertificate' src/server/photo-http.ts"
check "a private certificate is served only to its owner and their teachers, private and not stored" bash -c "
  awk '/^export async function openCertificate/{f=1} f{print} f && /^}/{exit}' $SERVICE > /tmp/m19-open.\$\$ &&
  grep -q \"row.visibility === 'public'\" /tmp/m19-open.\$\$ && grep -q 'relationshipOf(db, own, row.personId)' /tmp/m19-open.\$\$ && grep -q 'isPublic = false' /tmp/m19-open.\$\$;
  rc=\$?; rm -f /tmp/m19-open.\$\$; exit \$rc"
check "certificates are images only, processed as gallery photos (no PDF; DEFAULT M19, question 4)" bash -c "
  grep -q 'renderGalleryPhoto(bytes)' $SERVICE && grep -q 'PASSPORT_CERTIFICATES_MAX = 20' src/server/db/schema/common.ts && ! grep -rqiE 'pdf-lib|pdfjs|pdfkit' package.json"
refute "no name, e-mail or title in the passport logs (ids only)" bash -c "grep -nE 'logger\\(\\)\\.(info|warn|error)\\(' $SERVICE | grep -vE '\\[passport\\] [a-z ]+(\\\$\\{certificateId\\})?[a-z ]*'"
refute "the profile has no Open Graph or JSON-LD of the passport, and the sitemap no passport" grep -nE "passport" src/app/sitemap.ts
check "an examiner the public cannot see is not named (only through v_public_person)" grep -qF 'LEFT JOIN "v_public_person" ep ON ep."id" = x."examiner_person_id"' "${M19_SQL[0]:-none}"

# 4. Who writes, and the plan's passport (In scope 2, 3, 4; DEFAULT M19) ----------------------------
check "the student never records their own; arbitration reads only" bash -c "
  grep -q \"throw new ServiceError('FORBIDDEN', STUDENT_CANNOT_RECORD)\" $SERVICE && grep -q \"throw new ServiceError('FORBIDDEN', ARBITRATION_READ_ONLY)\" $SERVICE"
check "passport is available now and enforced; the full passport is Premium Student, Professional Sifu and Federation" bash -c "
  awk '/^    key: .passport.,/{f=1} f && /availability: .now.,/{a=1} f && /enforced: true,/{b=1} f && /^  \\},/{exit} END{exit !(a && b)}' $PLANS &&
  grep -qF \"FULL_PASSPORT_PLANS: readonly PlanCode[] = ['premium_student', 'pro_sifu', 'federation']\" $PLANS"
check "PLAN_MATRIX_VERSION was raised for M19" grep -qF "PLAN_MATRIX_VERSION = '2026-11-07.1'" "$PLANS"
check "experience only as precise as the dates (whole years with about; months only month to month)" bash -c "
  grep -q \"start.precision !== 'year' && end !== null && end.precision !== 'year'\" $TIME && grep -qF 'about \${plural(years' $TIME"
for q in 1 2 3 4 5 6; do
  check "DEFAULT M19 question $q is marked in the code" bash -c "grep -rqE 'DEFAULT M19,? \\(?question $q' src"
done
check "the new notices go through notify() and the catalog" bash -c "
  grep -qF \"'passport.entry-added': mailed('teaching', 'notice'),\" src/server/templates/catalog.ts &&
  grep -qF \"'passport.correction': mailed('teaching', 'notice'),\" src/server/templates/catalog.ts && grep -q \"await notify(tx, \" $SERVICE"
check "staff removal: a verified second factor, a reason in the audit log, the owner told" bash -c "
  awk '/^export async function removePassportEntry/{f=1} f{print} f && /^}/{exit}' $SERVICE > /tmp/m19-rm.\$\$ &&
  grep -q 'requireStaff2FA(principal)' /tmp/m19-rm.\$\$ && grep -q \"action: 'passport.remove'\" /tmp/m19-rm.\$\$ && grep -q \"'content.removed'\" /tmp/m19-rm.\$\$;
  rc=\$?; rm -f /tmp/m19-rm.\$\$; exit \$rc"

# 5. API first (In scope 6; plan §6.8) -------------------------------------------------------------
for proc in get mine students addRank addExam addSkill updateEntry withdrawEntry setVisibility uploadCertificate removeCertificate markAttendance remove; do
  check "passport.$proc is a procedure" bash -c "awk '/^  passport: \\{/{f=1} f && /^    $proc: /{found=1} f && /^  \\},/{exit} END{exit !found}' src/server/rpc/router.ts"
done
check "passport.remove needs staff with a second factor" bash -c "awk '/^  passport: \\{/{f=1} f && /^    remove: staffWithSecondFactor/{found=1} f && /^  \\},/{exit} END{exit !found}' src/server/rpc/router.ts"
for path in /passport/{slug} /passport/mine /passport/rank/add /passport/exam/add /passport/skill/add /passport/entry/update /passport/entry/withdraw /passport/entry/visibility /passport/certificate/upload /passport/certificate/remove /passport/attendance/mark /passport/remove "/certificates/{id}/{hash}/{file}"; do
  check "docs/api/openapi.json has $path" grep -qF "\"$path\"" docs/api/openapi.json
done
check "the Server Actions are in the parity table" bash -c "
  f=src/server/rpc/parity.ts; for a in setVisibilityAction proposeCorrectionAction addRankAction addExamAction addSkillAction updateEntryAction withdrawEntryAction markAttendanceAction removePassportEntryAction; do grep -q \"#\$a'\" \$f || exit 1; done"
check "the authorization matrix has the passport rows and actions" bash -c "
  f=src/server/rpc/authz-matrix.int.test.ts; grep -q \"path: 'passport.get'\" \$f && grep -q \"path: 'passport.remove'\" \$f && grep -q \"path: 'passport.markAttendance'\" \$f &&
  grep -q \"'GET /api/certificates/{id}/{hash}/{file}'\" \$f && grep -q 'removePassportEntryAction' \$f && grep -q 'proposeCorrectionAction' \$f"

# 6. The pages (In scope 7; CLAUDE.md §10) ---------------------------------------------------------
check "the profile shows the passport section from passport.get; staff remove an entry" bash -c "
  grep -q 'passport.get({ slug: profile.slug })' '$PROFILE' && grep -q '<PassportView' '$PROFILE' && grep -q 'PassportRemoveForm' '$PROFILE' && grep -q 'hasStaff2FA' '$PROFILE'"
check "status in words and a mark: the kind, the skill's progress, the visibility" bash -c "
  grep -q 'export function KindMark' $VIEW && grep -q 'export function ProgressMark' $VIEW && grep -q 'aria-hidden=\"true\"' $VIEW && grep -q 'function VisibilityState' $OWN_PAGE"
check "the timeline is by year, the latest first, with the current rank on top" bash -c "grep -q 'timelineByYear(' $VIEW && grep -q 'passport-current-rank' $VIEW && grep -q 'passport-timeline' $VIEW"
check "44 px targets on the passport controls" bash -c "grep -q 'min-h-11' $VIEW && grep -q 'min-h-11' $OWN_CONTROLS && grep -q 'min-h-11' $TEACHER_PAGE"
refute "no window.open, no 100vh, no hover-only behaviour in the M19 pages" grep -nE "window\.open|100vh|group-hover:|onMouseEnter|target=\"_blank\"" "$VIEW" "$OWN_PAGE" "$OWN_CONTROLS" "$TEACHER_PAGE" "$TEACHER_FORMS"
check "the pages are in e2e/routes.ts (axe in both themes); the profile and the dashboards are key screens" bash -c "
  grep -q \"path: '/people/demo-b-166', name: 'person-passport', status: 200, milestone: 'M19', key: true\" e2e/routes.ts &&
  grep -q \"path: '/dashboard/passport', name: 'dashboard-passport', status: 200, milestone: 'M19', key: true\" e2e/routes.ts &&
  grep -q \"path: '/dashboard/students', name: 'dashboard-students', status: 200, milestone: 'M19', key: true\" e2e/routes.ts &&
  grep -q \"name: 'dashboard-passport-no-profile'\" e2e/routes.ts"
check "the teacher's entry forms are a screen state" grep -q "name: 'dashboard-students-entry'" e2e/screenshots.spec.ts
check "the upgrade prompt only at the real limit, with the benefits of the pilot" bash -c "grep -q 'if (hidden > 0 && higher)' $SERVICE && grep -q \"upgradeBenefits(plan, higher, 'passport')\" $SERVICE"
refute "no urgency or countdown in the passport copy" grep -nEi "\b(hurry|only today|last chance|don.t miss)\b|days? left" "$VIEW" "$OWN_PAGE" "$TEACHER_PAGE" "$TEACHER_FORMS" "$OWN_CONTROLS"

# 7. Demo data (In scope 9; D20) -------------------------------------------------------------------
check "the demo passports: fixed dates, ids of their own, fictional" bash -c "
  f=src/fixtures/generate.ts; grep -q 'const PASSPORT_AT = new Date(Date.UTC(2026, 10, 7));' \$f && grep -q '(seed ^ 0x0e7e_001a)' \$f &&
  awk '/^function demoPassport/{f=1} f{print} f && /^}/{exit}' \$f > /tmp/m19-demo.\$\$ &&
  grep -q \"progress: 'learning'\" /tmp/m19-demo.\$\$ && grep -q 'examinerPersonId: r.examiner' /tmp/m19-demo.\$\$ && grep -q 'eventId: r.pastEvent' /tmp/m19-demo.\$\$ &&
  ! grep -q 'new Date()' /tmp/m19-demo.\$\$; rc=\$?; rm -f /tmp/m19-demo.\$\$; exit \$rc"
check "one private and one public generated certificate, written to the private store" bash -c "
  grep -q \"visibility: 'public'\" src/fixtures/generate.ts && grep -q \"key: 'private', title: 'Demo first aid course certificate', visibility: 'private'\" src/fixtures/generate.ts &&
  grep -q 'export async function writeDemoCertificates(store: ObjectStore = getEvidenceStore())' src/server/db/seed-photos.ts && grep -q 'export async function demoCertificate' src/server/storage/photo.ts"
check "db:seed loads the passports and empties them" bash -c "
  f=src/server/db/seed.ts; grep -q 'await insert(passportRank, f.passportRanks);' \$f && grep -q 'await insert(eventAttendance, f.eventAttendances);' \$f &&
  awk '/^export const RESETTABLE_TABLES/{f=1} f && /passportCertificate,/{found=1} f && /^\\];/{exit} END{exit !found}' \$f"

# 8. E2E and integration titles (Done when 3) ------------------------------------------------------
titles=(
  '@M19 a teacher records a rank and an examination; the student is told and sees them on the profile'
  '@M19 a student cannot record; they hide an entry, propose a correction and upload a private certificate a guest cannot open'
)
for t in "${titles[@]}"; do
  check "E2E test: $t" grep -qF "$t" "$SPEC"
done
view_titles=(
  '@M19 the Free Student shows the basic passport, the Premium Student the full timeline without the private certificate'
  '@M19 the passport pages by keyboard and touch: 44 px targets on a phone'
)
for t in "${view_titles[@]}"; do
  check "E2E test: $t" grep -qF "$t" "$VIEW_SPEC"
done
check "the E2E runs axe in both themes and checks 44 px targets on a phone" bash -c "
  grep -q 'expectNoAxeViolations' $SPEC && grep -q 'for (const theme of THEMES)' $SPEC && grep -q 'toBeGreaterThanOrEqual(44)' $VIEW_SPEC && grep -q \"startsWith('mobile')\" $VIEW_SPEC"
check "the writing spec runs alone (PUBLIC_WRITE_SPECS), the view spec in the desktop and phone projects" bash -c "grep -q \"'\\*\\*/m19-passport.spec.ts'\" e2e/projects.ts && ! grep -q 'm19-passport-view' e2e/projects.ts"
int_titles=(
  'the verified teacher records a rank, an examination and a skill; the student is told once'
  'a student cannot write a rank of their own, nor change one: they propose a correction'
  'a relationship in arbitration reads only; a stranger and a pending teacher get "no such student"'
  'Premium Student shows the full timeline; after a downgrade the basic one, every entry kept'
  'an examiner the public cannot see is not named'
  'a private certificate never leaks: not in the public answer, served only to the owner and their teachers'
  'a moderator with a verified second factor removes an entry with a reason: audited, the owner told'
)
for t in "${int_titles[@]}"; do
  check "integration test: $t" grep -qF "$t" "$INT"
done
check "the unit test of experience and the timeline" bash -c "grep -qF 'a start year gives whole years with \"about\", never months' src/lib/passport-time.test.ts && grep -qF 'the timeline (In scope 7)' src/lib/passport-time.test.ts"

# 9. Documentation (In scope 11) -------------------------------------------------------------------
check "ADR 0022 records the model, who writes, the plan's passport, the certificates and the defaults" bash -c "
  f=docs/adr/0022-passport.md; grep -q 'DEFAULT M19' \"\$f\" && grep -q 'v_public_passport' \"\$f\" && grep -q 'passport_certificate' \"\$f\" && grep -q 'presigned' \"\$f\" && grep -q 'D08' \"\$f\""
check "questions/M19.md has six questions, each with a proposed default" bash -c "
  f=docs/plan/questions/M19.md; [ \"\$(grep -c '^## 2026-' \"\$f\")\" -ge 6 ] && [ \"\$(grep -c '^\\*\\*Proposed default:\\*\\*' \"\$f\")\" -ge 6 ]"
check "docs/data-model.md describes the passport tables, the view and the M19 migration" bash -c "f=docs/data-model.md; grep -q 'passport_rank' \"\$f\" && grep -q 'v_public_passport' \"\$f\" && grep -q '_m19_passport' \"\$f\""
check "docs/entitlements.md has the passport as available now, with the levels and the matrix version" bash -c "f=docs/entitlements.md; grep -q '2026-11-07.1' \"\$f\" && grep -qi 'passport' \"\$f\""
check "the user guide covers the passport" bash -c "f=docs/guides/user-guide.bg.md; grep -q '(M19)' \"\$f\" && grep -q 'Propose a correction' \"\$f\" && grep -q '/dashboard/passport' \"\$f\""
check "the admin guide covers the passport" bash -c "f=docs/guides/admin-guide.bg.md; grep -q '(M19)' \"\$f\" && grep -q 'passport.remove' \"\$f\" && grep -q 'v_public_passport' \"\$f\""
check "docs/plan/README.md has a status for M19" bash -c 'grep -qE "^\| M19 " docs/plan/README.md && ! grep -qE "^\| M19 .*\| не е започнат \|$" docs/plan/README.md'
check "the milestone file has a Progress log with entries" bash -c "awk '/^## Дневник на напредъка/{f=1;next} f && /^- /{n++} END{exit !(n>0)}' docs/plan/M19-passport.md"
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  for guide in docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md; do
    check "$guide changed in this branch (differs from the merge base with origin/main)" bash -c "! git diff --quiet $base -- $guide"
  done
else
  ok "the guides changed in this branch: not checkable here (merged, or no origin/main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M19 checks: $failures failed"
  exit 1
fi
echo "M19 checks: all passed"
