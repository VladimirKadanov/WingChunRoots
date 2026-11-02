#!/usr/bin/env bash
# Milestone M14 checks (docs/plan/M14-profile-photos.md, "Done when"), run by scripts/verify.sh after
# the unit tests (src/server/storage/photo.test.ts: metadata and GPS stripped, orientation, no
# enlargement, the types by their magic bytes, the pixel bomb; src/server/storage/photo-store.test.ts:
# the photo store is never the evidence store; src/server/rpc/handler.test.ts: 411/413 before the
# body is read, 413 past the limit while a body without a length is read), the integration tests (src/server/services/photos.int.test.ts and the photo rows of
# the authorization matrix), db:check, db:reset+migrate+seed, the build with the bundle budgets and
# E2E (`@smoke|@M14`; the M14 spec adds a photo to a seeded demo person, so it runs in the exclusive
# run after the others, e2e/projects.ts). They stay valid after M14, so `scripts/verify.sh all`
# keeps running them.
#
# Here: required files, the one migration and the public view, the store and the route, the
# procedures and their Server Action, the decisions by default, the UI rules, the E2E and
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

SERVICE=src/server/services/photos.ts
REFS=src/server/services/photo-refs.ts
PROCESS=src/server/storage/photo.ts
STORE=src/server/storage/index.ts
HTTP=src/server/photo-http.ts
ROUTE='src/app/api/photos/[id]/[hash]/[file]/route.ts'
AVATAR=src/components/lineage/person-avatar.tsx
CONTROL=src/components/lineage/photo-control.tsx
SPEC=e2e/m14-photos.spec.ts
INT=src/server/services/photos.int.test.ts
mapfile -t M14_SQL < <(ls drizzle/*_m14_profile_photos/migration.sql 2>/dev/null)

# 1. Required files (Done when 5) ------------------------------------------------------------------
required=(
  "$SERVICE" "$REFS" "$PROCESS" "$STORE" "$HTTP" "$ROUTE" "$AVATAR" "$CONTROL" src/components/lineage/monogram.ts
  src/server/db/seed-photos.ts src/server/storage/photo.test.ts src/server/storage/photo-store.test.ts
  "$SPEC" "$INT" docs/adr/0016-profile-photos.md docs/plan/M14-profile-photos.md
  docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done

# 2. One migration and the public view (In scope 1) ------------------------------------------------
check "exactly one M14 migration (m14_profile_photos), with its snapshot" bash -c '
  [ "'"${#M14_SQL[@]}"'" -eq 1 ] && [ -s "$(dirname "'"${M14_SQL[0]:-none}"'")/snapshot.json" ]'
if [ "${#M14_SQL[@]}" -eq 1 ]; then
  SQL="${M14_SQL[0]}"
  check "the migration creates person_photo and person.photo_id" bash -c "grep -q 'CREATE TABLE \"person_photo\"' '$SQL' && grep -q '\"photo_id\" uuid' '$SQL'"
  check "app_public_ro has no right on person_photo" grep -q 'REVOKE ALL ON TABLE "person_photo" FROM app_public_ro;' "$SQL"
  check "v_public_person gives photo_id and photo_sha256 of the active photo the person points to" bash -c "
    grep -q 'CREATE OR REPLACE VIEW \"v_public_person\"' '$SQL' && grep -q 'AS \"photo_id\"' '$SQL' && grep -q 'AS \"photo_sha256\"' '$SQL' &&
    grep -q \"ph.\\\"status\\\" = 'active'\" '$SQL'"
  refute "the migration stays on PostgreSQL 16+ (no uuidv7(), no virtual generated columns, no OLD/NEW in RETURNING)" \
    grep -nEi "uuidv7\(|VIRTUAL|RETURNING[^;]*\b(OLD|NEW)\." "$SQL"
fi
check "one active photo per person and a random storage key (schema)" bash -c "
  f=src/server/db/schema/persons.ts; grep -q 'person_photo_one_active' \"\$f\" && grep -q \"photos/\\[0-9a-f\\]{48}\" \"\$f\""

# 3. The store, the processing and the route (In scope 2, 3) ---------------------------------------
check "the photo store is its own (MEDIA_STORAGE, MEDIA_STORAGE_DIR, S3_BUCKET_MEDIA) and refuses the evidence bucket and folder" bash -c "
  f=$STORE; grep -q 'MEDIA_STORAGE' \"\$f\" && grep -q 'S3_BUCKET_MEDIA must differ from S3_BUCKET_EVIDENCE' \"\$f\" && grep -q 'export function getPhotoStore' \"\$f\""
check "the services use the photo store, never the evidence store" bash -c "
  grep -q 'getPhotoStore' $SERVICE && ! grep -q 'getEvidenceStore' $SERVICE src/server/db/seed-photos.ts $HTTP"
check "the image is sniffed, decoded under the pixel limit, turned upright and re-encoded as WebP at 96 and 512 px" bash -c "
  grep -q 'sniffMime' $PROCESS && grep -q 'limitInputPixels: MAX_IMAGE_PIXELS' $PROCESS && grep -q '.rotate()' $PROCESS &&
  grep -q '.webp(' $PROCESS && grep -q 'PHOTO_SIZES = \[96, 512\] as const' src/server/db/schema/common.ts"
check "only src/server/storage imports sharp" bash -c "! grep -rlE \"from 'sharp'\" src --include=*.ts --include=*.tsx | grep -v '^src/server/storage/'"
check "the route serves only through openPhoto, with the hash in the address, an ETag, nosniff and a sandbox CSP" bash -c "
  grep -q 'handlePhotoRequest' '$ROUTE' && grep -q 'openPhoto' $HTTP && grep -q 'etag' $HTTP && grep -q 'nosniff' $HTTP &&
  grep -q \"sandbox\" $HTTP && grep -q \"private, no-store\" $HTTP && grep -q \"PUBLIC_PHOTO_CACHE = 'public, no-cache'\" $HTTP"
check "a hidden person's photo is public only through v_public_person (app_public_ro)" bash -c "
  grep -q 'FROM v_public_person' $REFS && grep -q 'publicPhotoRefs(getPublicDb()' $SERVICE"
check "a multipart body is refused by its Content-Length before it is read (411, 413)" bash -c "
  f=src/server/rpc/handler.ts; grep -q 'export function bodyRefusal' \"\$f\" && grep -q 'LENGTH_REQUIRED' \"\$f\" && grep -q 'MULTIPART_MAX_BYTES' \"\$f\""
check "every API body is counted as it is read and stopped with 413 past its limit (boundedRequest)" bash -c "
  f=src/server/rpc/handler.ts; grep -q 'export async function boundedRequest' \"\$f\" && grep -q 'await boundedRequest(request)' \"\$f\" && grep -q 'JSON_MAX_BYTES' \"\$f\""

# 4. The procedures and the Server Action (In scope 3, 6; plan §6.8) -------------------------------
mkdir -p .verify
check "pnpm api:openapi --check: docs/api/openapi.json matches the router (log: .verify/M14-openapi.log)" bash -c '
  pnpm --silent api:openapi --check > .verify/M14-openapi.log 2>&1'
check "the contract has photos.get, photos.upload (multipart) and photos.remove, and documents the image route" node -e "
  const doc = require('./docs/api/openapi.json');
  const ops = Object.values(doc.paths).flatMap((p) => Object.values(p)).map((o) => o.operationId);
  for (const id of ['photos.get', 'photos.upload', 'photos.remove', 'photos.image']) if (!ops.includes(id)) process.exit(1);
  const up = doc.paths['/photos/upload'].post.requestBody.content;
  if (!up['multipart/form-data']) process.exit(1);"
check "removePhotoAction is in the API parity table with photos.remove and in the authorization matrix" bash -c "
  grep -qF \"'src/app/admin/review/actions.ts#removePhotoAction': { rpc: ['photos.remove'] }\" src/server/rpc/parity.ts &&
  grep -qF \"action: 'src/app/admin/review/actions.ts#removePhotoAction'\" src/server/rpc/authz-matrix.int.test.ts"
check "the authorization matrix has the photo rows (get, upload, remove, the route; hidden persons)" bash -c "
  f=src/server/rpc/authz-matrix.int.test.ts
  for p in \"path: 'photos.get'\" \"path: 'photos.upload'\" \"path: 'photos.remove'\" \"path: 'GET /api/photos/{id}/{hash}/{file} (hidden person)'\"; do grep -qF \"\$p\" \"\$f\" || exit 1; done"
check "upload and removal are audited (photo.upload, photo.remove)" bash -c "
  grep -q \"| 'photo.upload'\" src/server/audit/index.ts && grep -q \"| 'photo.remove'\" src/server/audit/index.ts && grep -q \"action: 'photo.upload'\" $SERVICE && grep -q \"action: 'photo.remove'\" $SERVICE"
check "staff removal needs a reason" grep -q 'removalReason' "$SERVICE"
check "the report form says the photo can be reported" grep -q 'for example the profile photo' 'src/app/people/[slug]/report/report-form.tsx'

# 5. Decisions by default (In scope 4; CLAUDE.md §8) -----------------------------------------------
check "DEFAULT D07 is marked at the size limit, the quota and the plan catalogue" bash -c "
  grep -q 'DEFAULT D07' src/server/db/schema/common.ts && grep -q 'DEFAULT D07' $SERVICE && grep -q 'DEFAULT D07' src/server/entitlements/plans.ts"
check "the photo counts as 1 against 'photos'; a replacement adds nothing" bash -c "
  f=src/server/entitlements/access.ts; grep -q \"if (key === 'photos') return activePhotos(db, subject);\" \"\$f\" && grep -q \"if (key === 'photos') return (await activePhotos(db, subject, unit)) > 0;\" \"\$f\""
check "the demo photos are generated (D20), on demo- people only" bash -c "
  f=src/server/db/seed-photos.ts; grep -q 'demoPortrait' \"\$f\" && ! grep -oE \"'[a-z0-9-]+'\" <(grep 'DEMO_PHOTO_SLUGS =' \"\$f\") | grep -v \"^'demo-\""

# 6. The interface (In scope 5; CLAUDE.md §10) -----------------------------------------------------
check "the thumbnail has alt, width, height and lazy loading, and a monogram without a photo" bash -c "
  grep -q \"alt={decorative ? '' : name}\" $AVATAR && grep -q 'width={px}' $AVATAR && grep -q 'height={px}' $AVATAR &&
  grep -q \"loading={size === 'lg' ? 'eager' : 'lazy'}\" $AVATAR && grep -q 'data-person-monogram' $AVATAR"
check "thumbnails on the explorer card, the panel, the relation lists, the search palette and the school page" bash -c "
  for f in src/components/lineage/explorer/canvas.tsx src/components/lineage/explorer/panel.tsx src/components/lineage/explorer/students-list.tsx \
    src/components/lineage/relation-list.tsx src/components/ui/search-palette.tsx 'src/app/schools/[slug]/page.tsx' src/components/lineage/person-header.tsx; do
    grep -q 'PersonAvatar' \"\$f\" || exit 1; done"
check "the owner's controls: a real file input, Add/Change/Remove photo, a status in words, 44 px targets" bash -c "
  grep -q 'type=\"file\"' $CONTROL && grep -q \"'Change photo' : 'Add photo'\" $CONTROL && grep -q 'Remove photo' $CONTROL &&
  grep -q 'role=\"status\"' $CONTROL && grep -q \"accept={PHOTO_ACCEPT}\" $CONTROL && ! grep -q \"size: 'sm'\" $CONTROL"
check "the controls show only on the owner's own profile" grep -qF "profile.isOwn && !profile.limited ? <PhotoControl" 'src/app/people/[slug]/page.tsx'
refute "no window.open, no 100vh in the M14 components" grep -nE "window\.open|100vh" "$AVATAR" "$CONTROL"

# 7. E2E and integration titles (Done when 3) ------------------------------------------------------
titles=(
  '@M14 the owner adds a photo with the keyboard, sees it on the profile, the explorer card and a list row, and removes it'
  '@M14 a file that is not an image is refused in words, and nothing changes'
  '@M14 a visitor sees no photo controls on someone else'
)
for title in "${titles[@]}"; do
  check "E2E test: $title" grep -qF "$title" "$SPEC"
done
check "the E2E runs axe in both themes on the profile with the photo" bash -c "grep -q 'expectNoAxeViolations' $SPEC && grep -q 'for (const theme of THEMES)' $SPEC"
check "the M14 spec runs in the exclusive run, after the others (PUBLIC_WRITE_SPECS)" \
  grep -qE "^export const PUBLIC_WRITE_SPECS = \[.*'\*\*/m14-photos\.spec\.ts'.*\] as const;$" e2e/projects.ts
int_titles=(
  'stores a square WebP at 96 and 512 px in the photo store, sets the person, audits, and leaves the evidence store alone'
  'replacing the photo marks the old one replaced, deletes its files and still counts one photo (DEFAULT D07)'
  "a hidden person's photo is 404 to everyone but the owner and staff with 2FA, and in no public DTO"
  'staff without 2FA: SECOND_FACTOR_REQUIRED; staff need a reason, which is audited'
)
for title in "${int_titles[@]}"; do
  check "integration test: $title" grep -qF "$title" "$INT"
done
check "the M13 leak scan includes the hidden person's photo and the photo storage keys" bash -c "
  grep -q \"'hidden person photo'\" e2e/pilot.spec.ts && grep -q \"'photo storage key'\" e2e/pilot.spec.ts"

# 8. Documentation (In scope 9) --------------------------------------------------------------------
check "ADR 0016 records the store, the view, the route and its cache, D07 and the demo images" bash -c "
  f=docs/adr/0016-profile-photos.md; grep -q 'MEDIA_STORAGE' \"\$f\" && grep -q 'v_public_person' \"\$f\" && grep -q '/api/photos/' \"\$f\" &&
  grep -q 'public, no-cache' \"\$f\" && grep -q 'DEFAULT D07' \"\$f\" && grep -q 'D20' \"\$f\""
check "docs/data-model.md describes person_photo and the photo columns of v_public_person" bash -c "
  f=docs/data-model.md; grep -q 'person_photo' \"\$f\" && grep -q 'photo_sha256' \"\$f\""
check ".env.example names MEDIA_STORAGE and MEDIA_STORAGE_DIR (names only)" bash -c "grep -qx 'MEDIA_STORAGE=' .env.example && grep -qx 'MEDIA_STORAGE_DIR=' .env.example"
check "the user guide covers adding, changing, removing and reporting a photo" bash -c "
  f=docs/guides/user-guide.bg.md; grep -q '## Снимка на профила (M14)' \"\$f\" && grep -q 'Add photo' \"\$f\" && grep -q 'Remove photo' \"\$f\""
check "the admin guide covers the store, the route, D07, the moderator removal and the demo photos" bash -c "
  f=docs/guides/admin-guide.bg.md; grep -q '## 20. Снимки на профила (M14)' \"\$f\" && grep -q 'MEDIA_STORAGE_DIR' \"\$f\" && grep -q 'photo.remove' \"\$f\""
check "docs/plan/README.md has a status for M14" bash -c '! grep -qE "^\| M14 .*\| не е започнат \|$" docs/plan/README.md'
check "the milestone file has a Progress log with entries" bash -c "awk '/^## Дневник на напредъка/{f=1;next} f && /^- /{n++} END{exit !(n>0)}' docs/plan/M14-profile-photos.md"
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
  echo "M14 checks: $failures failed"
  exit 1
fi
echo "M14 checks: all passed"
