#!/usr/bin/env bash
# Milestone M10a checks (docs/plan/M10a-evidence-review.md, "Done when"), run by scripts/verify.sh
# after the unit tests (src/server/storage/object-store.test.ts: the shared contract on the
# filesystem driver, and on the S3 driver where S3_ENDPOINT is set; api-parity.test.ts), the
# integration tests (evidence.int.test.ts: EXIF and GPS removed, sha256 and original_sha256, the
# 20-file cap, a Content-Length over 20 MB refused before the body is read, the download headers,
# the access matrix and evidence.view; review.int.test.ts: the claim, the decisions, the roles and
# the archival edit), db:check, db:reset+migrate+seed, the build and E2E (`@smoke|@M10a`; the M10a
# spec makes links public, so it runs in the exclusive run after the others, e2e/projects.ts).
# They stay valid after M10a, so `scripts/verify.sh all` keeps running them (CI, M13).
#
# Here: required files, the procedures and their Server Actions, the storage rules (private, random
# keys, no presigned address, local endpoints only), the upload and download rules, the review
# queue's guards and records, the migration and the test database, SeaweedFS in CI, the screens and
# screenshots, the E2E titles, the decisions by default and the documentation (both guides changed
# in this branch).
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

mapfile -t M10A_SQL < <(ls drizzle/*_m10a_evidence_review/migration.sql 2>/dev/null)
mapfile -t M10A_UI < <(find src/app/admin/review src/app/dashboard/teachers/historical src/components/evidence -type f -name '*.tsx' | sort)
mapfile -t SRC_CODE < <(find src -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.ts' ! -name '*.contract.ts' | sort)
EVIDENCE=src/server/services/evidence.ts
REVIEW=src/server/services/review.ts
HISTORICAL=src/server/services/historical.ts
HTTP=src/server/evidence-http.ts
SPEC=e2e/m10a-evidence.spec.ts

KEY_SCREENS=(teachers-historical review-queue review-record)
STATES=(teachers-historical-files teachers-historical-refused teachers-claim-waiting review-case)
SIZES=(390x844 1440x900)
THEMES=(dark light)

# 1. Required files (Done when 2-4) ---------------------------------------------------------------
required=(
  src/server/storage/index.ts src/server/storage/types.ts src/server/storage/fs.ts src/server/storage/s3.ts
  src/server/storage/sanitize.ts src/server/storage/object-store.contract.ts src/server/storage/object-store.test.ts
  src/server/storage/test-images.ts
  "$EVIDENCE" "$REVIEW" "$HISTORICAL" "$HTTP" src/server/services/evidence.int.test.ts src/server/services/review.int.test.ts
  src/app/api/evidence/upload/route.ts 'src/app/api/evidence/[id]/route.ts'
  src/app/admin/review/page.tsx 'src/app/admin/review/[id]/page.tsx' src/app/admin/review/records/page.tsx
  'src/app/admin/review/records/[slug]/page.tsx' src/app/admin/review/actions.ts src/app/admin/review/forms.tsx
  src/app/admin/review/review-table.tsx
  src/app/dashboard/teachers/historical/page.tsx src/app/dashboard/teachers/historical/claim-form.tsx
  src/app/dashboard/teachers/historical/actions.ts src/components/evidence/uploader.tsx src/lib/file-size.ts
  src/server/templates/review.ts src/server/templates/email/review-decided.tsx
  "$SPEC" e2e/helpers/evidence.ts
  docs/evidence-and-review.md docs/adr/0012-evidence-and-review.md docs/plan/questions/M10a.md scripts/verify.d/M10a.sh
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done
check "directory exists and is not empty: docs/screenshots/M10a/" bash -c '[ -d docs/screenshots/M10a ] && [ -n "$(ls -A docs/screenshots/M10a)" ]'
check "the M10a migration exists (m10a_evidence_review)" test "${#M10A_SQL[@]}" -eq 1

# 2. The procedures and their Server Actions (In scope 4, 5; plan §6.8) -----------------------------
check "pnpm api:openapi --check: docs/api/openapi.json matches the router (log: .verify/M10a-openapi.log)" bash -c '
  mkdir -p .verify && pnpm --silent api:openapi --check > .verify/M10a-openapi.log 2>&1'
check "the contract has every M10a procedure and both binary routes" node -e "
  const p = require('./docs/api/openapi.json').paths || {};
  const posts = ['/relationships/request-historical', '/evidence/discard', '/review/assign', '/review/decide', '/review/note', '/archive/update', '/evidence/upload'];
  const gets = ['/review', '/review/{id}', '/archive/{slug}', '/evidence/{id}'];
  process.exit(posts.every((k) => p[k]?.post) && gets.every((k) => p[k]?.get) ? 0 : 1)"
check "every M10a Server Action is in the API parity table with its procedure" bash -c '
  f=src/server/rpc/parity.ts
  grep -q "historical/actions.ts#requestHistoricalAction'\'': { rpc: \['\''relationships.requestHistorical'\''\] }" "$f" &&
  grep -q "historical/actions.ts#discardEvidenceAction'\'': { rpc: \['\''evidence.discard'\''\] }" "$f" &&
  grep -q "review/actions.ts#assignCaseAction'\'': { rpc: \['\''review.assign'\''\] }" "$f" &&
  grep -q "review/actions.ts#decideCaseAction'\'': { rpc: \['\''review.decide'\''\] }" "$f" &&
  grep -q "review/actions.ts#addNoteAction'\'': { rpc: \['\''review.note'\''\] }" "$f" &&
  grep -q "review/actions.ts#archiveUpdateAction'\'': { rpc: \['\''archive.update'\''\] }" "$f"'
check "the review and archive procedures sit behind staffWithSecondFactor (list, get, assign, decide, note; archive get, update)" bash -c '
  n=$(grep -cE "^    (list|get|assign|decide|note|update): staffWithSecondFactor$" src/server/rpc/router.ts); [ "$n" -ge 7 ]'
check "/admin/review needs a staff session that proved the second factor (ROUTE_POLICIES)" \
  grep -qF "'/admin/review': { kind: 'staff2fa' }," src/server/auth/guards.ts
refute "the M10a pages and components never import src/server/db, and services only for their types" \
  bash -c "grep -rnE \"from ['\\\"]@/server/(services|db|storage)\" src/app/admin/review src/app/dashboard/teachers/historical src/components/evidence | grep -vE ':import type [^;]+ from .@/server/services/'"
refute "the M10a Server Actions import nothing from src/server/services, db or storage (they call the procedures)" \
  grep -nE "from ['\"]@/server/(services|db|storage)" src/app/admin/review/actions.ts src/app/dashboard/teachers/historical/actions.ts
check "the evidence routes are thin: they hand the request to src/server/evidence-http.ts" bash -c '
  grep -q "handleEvidenceUpload(request)" src/app/api/evidence/upload/route.ts &&
  grep -q "handleEvidenceDownload(" "src/app/api/evidence/[id]/route.ts"'

# 3. Storage (In scope 2; DEFAULT D13; Constraints: no presigned GET) --------------------------------
refute "no presigned or signed-query address anywhere in src (aws4fetch signQuery, X-Amz-Signature, getSignedUrl)" \
  grep_code 'presign[A-Za-z]*\(|getSignedUrl|signQuery|X-Amz-Signature|X-Amz-Expires' "${SRC_CODE[@]}"
check "storage keys are random: evidence/ + 24 random bytes in hex" \
  grep -qF "return \`\${prefix}/\${randomBytes(24).toString('hex')}\`;" src/server/storage/types.ts
check "the filesystem driver is the default without S3_ENDPOINT, in .storage/evidence, and refuses a folder in public/" bash -c '
  f=src/server/storage/index.ts
  grep -qF "export const DEFAULT_EVIDENCE_DIR = path.join('\''.storage'\'', '\''evidence'\'');" "$f" &&
  grep -q "EVIDENCE_STORAGE_DIR must not be inside public/" "$f" && grep -qx "/.storage/" .gitignore'
check "the S3 driver accepts only a local endpoint in Phase 1 (loopback, localhost, seaweedfs)" bash -c '
  f=src/server/storage/index.ts
  grep -qF "return host === '\''localhost'\'' || host === '\''seaweedfs'\'' || host === '\''::1'\''" "$f" &&
  grep -q "S3_ENDPOINT must point at the local SeaweedFS in Phase 1" "$f"'
check "the files are private on disk: 0600 files in 0700 folders" bash -c '
  grep -q "0o600" src/server/storage/fs.ts && grep -q "0o700" src/server/storage/fs.ts'
check "both drivers run the one contract test (filesystem everywhere, S3 where S3_ENDPOINT is set)" bash -c '
  f=src/server/storage/object-store.test.ts
  [ "$(grep -c "objectStoreContract(" "$f")" -ge 2 ] && grep -q "S3_ENDPOINT" "$f"'
check "only src/server/storage imports sharp and aws4fetch (eslint.config.mjs)" \
  grep -qF "group: ['aws4fetch', 'aws4fetch/*', 'sharp', 'sharp/*']," eslint.config.mjs
check "sharp and aws4fetch are pinned exactly; sharp has its explicit allowBuilds entry and its reason in ADR 0001" bash -c '
  grep -qE "^    \"sharp\": \"[0-9]+\.[0-9]+\.[0-9]+\",$" package.json && grep -qE "^    \"aws4fetch\": \"[0-9]+\.[0-9]+\.[0-9]+\",$" package.json &&
  grep -qx "  sharp: false" pnpm-workspace.yaml && grep -q "sharp" docs/adr/0001-stack.md && grep -q "aws4fetch" docs/adr/0001-stack.md'
check ".env.example lists the S3 settings with no value" bash -c '
  for n in S3_ENDPOINT S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_BUCKET_EVIDENCE; do grep -qx "$n=" .env.example || exit 1; done'

# 4. Upload and download (In scope 2, 3) ------------------------------------------------------------
check "the upload checks Content-Length (411, 413) before it reads the body" bash -c '
  body="$(awk "/^export async function uploadEvidence\\(/{on=1} on{print} on&&/^}/{exit}" '"$EVIDENCE"')"
  len=$(printf "%s\n" "$body" | grep -n "LENGTH_REQUIRED" | head -1 | cut -d: -f1)
  big=$(printf "%s\n" "$body" | grep -n "input.declaredLength > EVIDENCE_MAX_BYTES" | head -1 | cut -d: -f1)
  read=$(printf "%s\n" "$body" | grep -n "await readBody(" | head -1 | cut -d: -f1)
  [ -n "$len" ] && [ -n "$big" ] && [ -n "$read" ] && [ "$len" -lt "$read" ] && [ "$big" -lt "$read" ]'
check "the type comes from the magic bytes (JPEG, PNG, WebP, PDF), and the column allows only those four" bash -c '
  grep -q "export function sniffMime(head: Uint8Array): EvidenceMime | null" src/server/storage/sanitize.ts &&
  grep -qF "CHECK (\"mime\" IN ('\''image/jpeg'\'', '\''image/png'\'', '\''image/webp'\'', '\''application/pdf'\''))" '"${M10A_SQL[*]:-/dev/null}"''
check "images are re-encoded upright with sharp under a pixel limit" \
  grep -qF ".rotate();" src/server/storage/sanitize.ts
refute "nothing keeps image metadata (withMetadata, keepExif, keepMetadata, keepIccProfile)" \
  grep_code 'withMetadata|keepExif|keepMetadata|keepIccProfile|withExif' "${SRC_CODE[@]}"
check "sha256 is the stored object's hash and original_sha256 the upload's" \
  grep -qF "return { mime, stored, sha256: sha256(stored), originalSha256: sha256(bytes) };" "$EVIDENCE"
check "a download is an attachment with Cache-Control: no-store and X-Content-Type-Options: nosniff" bash -c '
  f='"$HTTP"'
  grep -qF "'\''cache-control'\'': '\''no-store'\''" "$f" && grep -qF "'\''x-content-type-options'\'': '\''nosniff'\''" "$f" &&
  grep -qF "'\''content-disposition'\'': \`attachment; filename=" "$f"'
check "every download writes evidence.view to the audit log" bash -c '
  grep -q "action: '\''evidence.view'\''" '"$EVIDENCE"' && grep -q "'\''evidence.view'\''" src/server/audit/index.ts'
check "src/proxy.ts never runs for /api, so the upload body is never buffered (proxyClientMaxBodySize)" bash -c '
  ! grep -qE "matcher:.*api" src/proxy.ts && ! grep -q "proxyClientMaxBodySize" next.config.ts'
check "integration tests: EXIF and GPS removed, both hashes, the 20-file cap, 413 before reading, the download headers, the access matrix" bash -c '
  f=src/server/services/evidence.int.test.ts
  grep -q "without its EXIF block and GPS position; sha256 is the stored object" "$f" &&
  grep -q "a claim holds at most 20 files" "$f" &&
  grep -q "refuses a Content-Length over 20 MB (413) through POST /api/evidence/upload before a byte of the body is read" "$f" &&
  grep -q "Cache-Control: no-store and X-Content-Type-Options: nosniff" "$f" &&
  grep -q "404 for everyone else; every download writes evidence.view" "$f"'

# 5. The historical claim, the queue and the archival edit (In scope 1, 4, 5) -------------------------
check "a claim's new teacher record and its link are involved_only, committee_review, under_review (DEFAULT D03)" bash -c '
  f='"$HISTORICAL"'
  grep -q "// DEFAULT D03: the record of a teacher named in a claim is involved_only until the claim is verified." "$f" &&
  grep -q "committee_review" "$f" && grep -q "under_review" "$f" && grep -q "historical_claim" "$f"'
check "verify takes the global verify lock, then the relationship, then the case" bash -c '
  f='"$REVIEW"'
  grep -q "VERIFY_LOCK" "$f" && grep -q "markVerified" "$f" && grep -q "recordEvent" "$f"'
check "decisions and assignments are audited and recorded: relationship.verify, relationship.reject, review.resolve, review.assign, review.needs_info, review.note" bash -c '
  for a in relationship.verify relationship.reject review.resolve review.assign review.needs_info review.note; do
    grep -q "action: '\''$a'\''" '"$REVIEW"' || exit 1; grep -q "'\''$a'\''" src/server/audit/index.ts || exit 1
  done'
check "the archival edit is for archivists only and audits person.update with reason and evidence_ids" bash -c '
  f='"$REVIEW"'
  grep -q "action: '\''person.update'\''" "$f" && grep -q "evidenceIds" "$f" && grep -q "the archival edit: an archivist only" "$f"'
check "a decided claim queues lineage.recompute and drops the public cache" bash -c '
  grep -q "enqueue(tx, QUEUE.lineageRecompute" '"$REVIEW"' && grep -q "invalidatePublic(" '"$REVIEW"''
check "deletion requests stay out of the queue (DEFAULT, question 2 in docs/plan/questions/M10a.md)" \
  grep -qF "export const QUEUE_KINDS = REVIEW_CASE_KINDS.filter((k) => k !== 'deletion_request')" "$REVIEW"
check "the queue table is TanStack Table (@tanstack/table-core)" grep -q "@tanstack/table-core" src/app/admin/review/review-table.tsx

# 6. The migration and the test database --------------------------------------------------------------
refute "the M10a migration is PostgreSQL 16 SQL (no uuidv7(), no virtual columns, no OLD/NEW in RETURNING)" \
  grep_code 'uuidv7\(|VIRTUAL|RETURNING[^;]*(OLD|NEW)\.' "${M10A_SQL[@]}"
if [ -n "${TEST_DATABASE_URL:-}" ]; then
  facts="$(psql_url "$TEST_DATABASE_URL" -X -q -At -F ' ' -c "
    SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
             AND ((table_name = 'evidence_file' AND column_name IN ('original_name', 'retention_until', 'original_sha256'))
               OR (table_name = 'review_note' AND column_name = 'idempotency_key'))),
           (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
             AND indexname IN ('review_case_one_open_per_relationship_key', 'review_note_idempotency_key') AND indexdef LIKE '%UNIQUE%'),
           (SELECT count(*) FROM pg_constraint WHERE conname = 'evidence_file_mime_check'),
           has_table_privilege('app_public_ro', 'public.evidence_file', 'SELECT') OR has_table_privilege('app_public_ro', 'public.evidence_link', 'SELECT')
             OR has_table_privilege('app_public_ro', 'public.review_case', 'SELECT') OR has_table_privilege('app_public_ro', 'public.review_note', 'SELECT')" 2>/dev/null)"
  check "the M10a columns exist: evidence_file.original_name (with retention_until, original_sha256), review_note.idempotency_key" test "$(echo "$facts" | cut -d' ' -f1)" = "4"
  check "the unique indexes exist: one open case of a kind per relationship, one note per author and key" test "$(echo "$facts" | cut -d' ' -f2)" = "2"
  check "evidence_file.mime has its check of the four types" test "$(echo "$facts" | cut -d' ' -f3)" = "1"
  check "app_public_ro cannot read evidence_file, evidence_link, review_case or review_note" test "$(echo "$facts" | cut -d' ' -f4)" = "f"
else
  bad "TEST_DATABASE_URL is not set: cannot check the M10a columns, indexes and grants"
fi

# 7. SeaweedFS in CI (the caller's default: the S3 driver runs in CI) --------------------------------
check "CI starts SeaweedFS with the image and digest of docker-compose.yml" bash -c '
  image="$(grep -oE "chrislusf/seaweedfs:[0-9.]+@sha256:[0-9a-f]{64}" docker-compose.yml | head -1)"
  [ -n "$image" ] && grep -qF "$image" .github/workflows/ci.yml'
check "CI sets S3_ENDPOINT to the local SeaweedFS and the evidence bucket, and waits for /healthz" bash -c '
  f=.github/workflows/ci.yml
  grep -qE "^      S3_ENDPOINT: http://127\.0\.0\.1:8333$" "$f" && grep -qE "^      S3_BUCKET_EVIDENCE: " "$f" &&
  grep -q "http://127.0.0.1:8333/healthz" "$f"'

# 8. Screens, routes and screenshots (Done when 4) ---------------------------------------------------
for path in /dashboard/teachers/historical /admin/review /admin/review/records/demo-root-c; do
  check "route $path is in e2e/routes.ts (axe in both themes)" grep -q "path: '$path'" e2e/routes.ts
done
for screen in "${KEY_SCREENS[@]}"; do
  check "$screen is a key screen (visual regression and screenshots)" grep -qE "name: '$screen'.*milestone: 'M10a', key: true" e2e/routes.ts
done
for state in "${STATES[@]}"; do
  check "screen state $state is in e2e/screenshots.spec.ts" grep -q "name: '$state'" e2e/screenshots.spec.ts
done
for screen in "${KEY_SCREENS[@]}" "${STATES[@]}"; do
  for size in "${SIZES[@]}"; do
    for theme in "${THEMES[@]}"; do
      check "screenshot: docs/screenshots/M10a/$screen-$size-$theme.png" test -s "docs/screenshots/M10a/$screen-$size-$theme.png"
    done
  done
done
refute "no 100vh in the M10a screens (dvh/svh only)" grep_code '100vh|h-screen' "${M10A_UI[@]}"
refute "no window.open in the M10a screens" grep_code 'window\.open' "${M10A_UI[@]}"
check "the evidence field is a plain file input with the four types (drag and drop only an addition)" bash -c '
  f=src/components/evidence/uploader.tsx
  grep -qF "export const EVIDENCE_ACCEPT = '\''image/jpeg,image/png,image/webp,application/pdf'\'';" "$f" &&
  grep -q "type=\"file\"" "$f" && grep -q "multiple" "$f"'

# 9. E2E titles (Done when 2) -------------------------------------------------------------------------
titles=(
  '@M10a a student claims a fictional historical teacher with a PDF; an archivist verifies it in /admin/review; the edge becomes public'
  '@M10a a historical teacher record created by a student is absent from anonymous HTML, API, search and sitemap until verified'
  '@M10a evidence download: the uploader is allowed; an unrelated user and an anonymous visitor get 404; every download writes evidence.view'
  "@M10a a 15 MB PDF is stored intact: the stored object's SHA-256 equals the client-side SHA-256"
  '@M10a upload refuses a renamed executable and a file over 20 MB'
  '@M10a at 390x844 evidence is attached through the plain file input without drag and drop'
  '@M10a a signed-in non-staff user on /admin/review sees the explicit denied state'
  '@M10a an archival edit of demo-root-c requires a reason and records actor, role and linked evidence in audit_log; a moderator without the archivist role cannot edit'
  '@M10a storage keys and evidence URLs never appear in public HTML or API responses'
)
for title in "${titles[@]}"; do
  check "E2E test: $title" grep -qF "$title" "$SPEC"
done
check "the M10a spec runs in the exclusive run, after the others (PUBLIC_WRITE_SPECS)" bash -c '
  grep -qE "^export const PUBLIC_WRITE_SPECS = \[.*'\''\*\*/m10a-evidence\.spec\.ts'\''.*\] as const;$" e2e/projects.ts &&
  grep -qF "export const EXCLUSIVE_SPECS: string[] = [EXCLUSIVE_SPEC, ...PUBLIC_WRITE_SPECS];" e2e/projects.ts &&
  grep -q "PW_EXCLUSIVE=1 pnpm e2e --pass-with-no-tests" scripts/verify.sh'
refute "the E2E fixtures are fictional: every person address in the M10a spec is a demo- slug or a generated one" \
  bash -c "grep -nE '/people/[a-z0-9]' $SPEC e2e/helpers/evidence.ts | grep -vE '/people/demo-'"

# 10. Decisions by default and documentation (In scope 6, 7; Stop and ask) --------------------------
check "DEFAULT D13 is marked in the storage module" grep -q "DEFAULT D13" src/server/storage/index.ts
check "DEFAULT D25 is marked at the limits (20 MB, 20 files per case)" grep -q "DEFAULT D25: evidence files are at most 20 MB each, and at most 20 files per case" src/server/db/schema/common.ts
check "docs/evidence-and-review.md records D03, D13 and D25 and the proxyClientMaxBodySize note" bash -c '
  f=docs/evidence-and-review.md
  grep -q "D03" "$f" && grep -q "D13" "$f" && grep -q "D25" "$f" && grep -q "proxyClientMaxBodySize" "$f" && grep -q "retention_until" "$f"'
check "docs/adr/0012-evidence-and-review.md records the store, the dependencies, the upload, the download, the queue and the defaults" bash -c '
  f=docs/adr/0012-evidence-and-review.md
  grep -q "ObjectStore" "$f" && grep -q "sharp" "$f" && grep -q "aws4fetch" "$f" && grep -q "nosniff" "$f" &&
  grep -q "review.decide" "$f" && grep -q "DEFAULT D03" "$f" && grep -q "D13" "$f" && grep -q "D25" "$f"'
check "docs/plan/questions/M10a.md records the retention question (GDPR) with its default" bash -c '
  f=docs/plan/questions/M10a.md
  grep -q "How long is evidence kept (GDPR)?" "$f" && grep -q "Proposed default:" "$f" && grep -q "retention_until" "$f"'
check "docs/data-model.md describes original_name, the review_note key and the retention of evidence" bash -c '
  f=docs/data-model.md
  grep -q "original_name" "$f" && grep -q "review_note" "$f" && grep -q "questions/M10a.md" "$f"'
check "the user guide covers the historical claim and the evidence upload" bash -c '
  f=docs/guides/user-guide.bg.md
  grep -q "## Исторически учител и доказателства (M10a)" "$f" && grep -q "/dashboard/teachers/historical" "$f" && grep -q "Add files" "$f"'
check "the admin guide covers the store, the queue, the decisions and the archival edit" bash -c '
  f=docs/guides/admin-guide.bg.md
  grep -q "## 15. Доказателства, опашка за преглед и архивна редакция (M10a)" "$f" && grep -q "S3_ENDPOINT" "$f" &&
  grep -q "### Опашката \`/admin/review\`" "$f" && grep -q "### Архивната редакция" "$f"'
check "docs/plan/README.md has a status for M10a" bash -c '! grep -qE "^\| M10a .*\| не е започнат \|$" docs/plan/README.md'
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
  echo "M10a checks: $failures failed"
  exit 1
fi
echo "M10a checks: all passed"
