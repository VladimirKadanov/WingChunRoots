#!/usr/bin/env bash
# Milestone M16 checks (docs/plan/M16-galleries.md, "Done when"), run by scripts/verify.sh after the
# unit tests (src/server/storage/gallery-photo.test.ts: no EXIF, GPS, XMP or IPTC in any rendition,
# the whole photo never enlarged, the logo contained; src/server/entitlements/plans.test.ts: photos
# available now and enforced), the integration tests (src/server/services/gallery.int.test.ts,
# src/server/services/school-photos.int.test.ts and the gallery rows of the authorization matrix),
# db:check, db:reset+migrate+seed, the build with the bundle budgets and E2E (`@smoke|@M16`:
# e2e/m16-gallery-viewer.spec.ts on the desktop and phone projects; e2e/m16-galleries.spec.ts writes
# public pages, so it runs in the exclusive run after the others, e2e/projects.ts). They stay valid
# after M16, so `scripts/verify.sh all` keeps running them.
#
# Here: required files, the one migration, the services and their permission checks, the
# procedures and their Server Actions, the decisions by default, the card's square photo, the UI
# rules, the E2E and integration titles, and the documentation.
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

GALLERY=src/server/services/gallery.ts
SCHOOL=src/server/services/school-photos.ts
PROCESS=src/server/storage/photo.ts
HTTP=src/server/photo-http.ts
ROUTE='src/app/api/school-photos/[id]/[hash]/[file]/route.ts'
GRID=src/components/gallery/gallery-grid.tsx
VIEWER=src/components/gallery/gallery-viewer.tsx
MANAGER=src/components/gallery/gallery-manager.tsx
SCHOOL_MANAGER=src/components/gallery/school-photos-manager.tsx
AVATAR=src/components/lineage/person-avatar.tsx
CANVAS=src/components/lineage/explorer/canvas.tsx
SPEC=e2e/m16-galleries.spec.ts
VIEWER_SPEC=e2e/m16-gallery-viewer.spec.ts
INT=src/server/services/gallery.int.test.ts
SCHOOL_INT=src/server/services/school-photos.int.test.ts
mapfile -t M16_SQL < <(ls drizzle/*_m16_galleries/migration.sql 2>/dev/null)

# 1. Required files (Done when 5) ------------------------------------------------------------------
required=(
  "$GALLERY" "$SCHOOL" "$PROCESS" "$HTTP" "$ROUTE" "$GRID" "$VIEWER" "$MANAGER" "$SCHOOL_MANAGER"
  src/server/dto/gallery.ts src/app/dashboard/photos/page.tsx 'src/app/dashboard/schools/[id]/photos/page.tsx'
  src/server/storage/gallery-photo.test.ts "$SPEC" "$VIEWER_SPEC" "$INT" "$SCHOOL_INT"
  docs/adr/0019-galleries.md docs/plan/M16-galleries.md docs/plan/questions/M16.md
  docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done

# 2. One migration (In scope 1; plan §3.2) ---------------------------------------------------------
check "exactly one M16 migration (m16_galleries), with its snapshot" bash -c '
  [ "'"${#M16_SQL[@]}"'" -eq 1 ] && [ -s "$(dirname "'"${M16_SQL[0]:-none}"'")/snapshot.json" ]'
if [ "${#M16_SQL[@]}" -eq 1 ]; then
  SQL="${M16_SQL[0]}"
  check "the migration creates school_photo and the gallery columns of person_photo" bash -c "
    grep -q 'CREATE TABLE \"school_photo\"' '$SQL' && grep -q '\"caption\" text' '$SQL' && grep -q '\"position\" integer' '$SQL' && grep -q '\"full_width\" integer' '$SQL'"
  check "app_public_ro has no right on school_photo; app_rw reads, inserts and updates it" bash -c "
    grep -q 'REVOKE ALL ON TABLE \"school_photo\" FROM app_public_ro;' '$SQL' && grep -q 'GRANT SELECT, INSERT, UPDATE ON TABLE \"school_photo\" TO app_rw;' '$SQL'"
  check "one active logo per school (partial unique index)" grep -q 'school_photo_one_logo_key' "$SQL"
  refute "the migration stays on PostgreSQL 16+ (no uuidv7(), no virtual generated columns, no OLD/NEW in RETURNING)" \
    grep -nEi "uuidv7\(|VIRTUAL|RETURNING[^;]*\b(OLD|NEW)\." "$SQL"
fi
check "the gallery statuses: one active profile photo and the gallery photos (schema)" bash -c "
  f=src/server/db/schema/common.ts; grep -q \"GALLERY_PHOTO_STATUSES = \\['active', 'gallery'\\] as const\" \"\$f\" && grep -q 'person_photo_one_active' src/server/db/schema/persons.ts"

# 3. Processing and serving (In scope 2; plan §6.4) ------------------------------------------------
check "the whole photo and the logo are encoded again as WebP; never enlarged" bash -c "
  grep -q 'export async function renderGalleryPhoto' $PROCESS && grep -q 'export async function renderSchoolLogo' $PROCESS &&
  grep -q 'Math.min(1, PHOTO_FULL_MAX_SIDE / Math.max(width, height))' $PROCESS"
check "only src/server/storage imports sharp" bash -c "! grep -rlE \"from 'sharp'\" src --include=*.ts --include=*.tsx | grep -v '^src/server/storage/'"
refute "no rendition keeps metadata (no withMetadata/keepExif/keepMetadata in the photo pipeline)" grep -nE "withMetadata|keepExif|keepMetadata|withExif" "$PROCESS"
check "the school route serves only through openSchoolPhoto; a school's photos are public only while v_public_school shows it" bash -c "
  grep -q \"kind: 'school'\" '$ROUTE' && grep -q 'openSchoolPhoto' $HTTP && grep -q 'FROM v_public_school' $SCHOOL"
check "the gallery is public only when v_public_person shows the person" bash -c "grep -q 'isPublicPerson(getPublicDb()' $GALLERY"
check "the services use the photo store, never the evidence store" bash -c "
  grep -q 'getPhotoStore' $GALLERY && grep -q 'getPhotoStore' $SCHOOL && ! grep -q 'getEvidenceStore' $GALLERY $SCHOOL $HTTP"

# 4. The procedures and the Server Actions (In scope 5; plan §6.8) ---------------------------------
mkdir -p .verify
check "pnpm api:openapi --check: docs/api/openapi.json matches the router (log: .verify/M16-openapi.log)" bash -c '
  pnpm --silent api:openapi --check > .verify/M16-openapi.log 2>&1'
check "the contract has every gallery and school photo procedure (uploads multipart) and documents the school image route" node -e "
  const doc = require('./docs/api/openapi.json');
  const ops = Object.values(doc.paths).flatMap((p) => Object.values(p)).map((o) => o.operationId);
  const want = ['gallery.mine', 'gallery.get', 'gallery.add', 'gallery.remove', 'gallery.update', 'gallery.reorder', 'gallery.setProfile',
    'schoolPhotos.get', 'schoolPhotos.upload', 'schoolPhotos.remove', 'schoolPhotos.update', 'schoolPhotos.reorder', 'schoolPhotos.image'];
  for (const id of want) if (!ops.includes(id)) { console.error('missing', id); process.exit(1); }
  if (!doc.paths['/gallery/add'].post.requestBody.content['multipart/form-data']) process.exit(1);
  if (!doc.paths['/schools/photos/upload'].post.requestBody.content['multipart/form-data']) process.exit(1);"
check "the two moderation actions are in the API parity table and in the authorization matrix" bash -c "
  grep -qF \"'src/app/admin/review/actions.ts#removeGalleryPhotoAction': { rpc: ['gallery.remove'] }\" src/server/rpc/parity.ts &&
  grep -qF \"'src/app/admin/review/actions.ts#removeSchoolPhotoAction': { rpc: ['schoolPhotos.remove'] }\" src/server/rpc/parity.ts &&
  grep -qF \"action: 'src/app/admin/review/actions.ts#removeGalleryPhotoAction'\" src/server/rpc/authz-matrix.int.test.ts &&
  grep -qF \"action: 'src/app/admin/review/actions.ts#removeSchoolPhotoAction'\" src/server/rpc/authz-matrix.int.test.ts"
check "the authorization matrix has the gallery and school photo rows (hidden person, school not public)" bash -c "
  f=src/server/rpc/authz-matrix.int.test.ts
  for p in \"path: 'gallery.mine'\" \"path: 'gallery.add'\" \"path: 'gallery.get (hidden person)'\" \"path: 'gallery.reorder'\" \"path: 'gallery.setProfile'\" \
    \"path: 'schoolPhotos.upload'\" \"path: 'schoolPhotos.reorder'\" \"path: 'GET /api/school-photos/{id}/{hash}/{file} (school not public)'\"; do grep -qF \"\$p\" \"\$f\" || exit 1; done"
check "every change is audited (gallery.*, school_photo.*)" bash -c "
  for a in gallery.add gallery.remove gallery.update gallery.reorder gallery.profile school_photo.upload school_photo.remove school_photo.update school_photo.reorder; do
    grep -q \"| '\$a'\" src/server/audit/index.ts || exit 1; done
  grep -q \"action: 'gallery.remove'\" $GALLERY && grep -q \"action: 'school_photo.remove'\" $SCHOOL"
check "staff removal needs a reason; staff need a verified second factor" bash -c "
  grep -q 'Say why the photo is removed' $GALLERY && grep -q 'Say why the photo is removed' $SCHOOL && grep -q 'hasStaff2FA' $GALLERY && grep -q 'hasStaff2FA' $SCHOOL"
check "only the account that listed a school changes its photos" bash -c "grep -q 'createdBy !== p.user.id' $SCHOOL && grep -q 'created_by_user_id' $SCHOOL"

# 5. Decisions by default (In scope 3, 4; CLAUDE.md §8) --------------------------------------------
check "photos is available now and enforced (DEFAULT D07)" bash -c "
  f=src/server/entitlements/plans.ts; awk '/^    key: .photos.,/{on=1} on && /availability: .now.,/{a=1} on && /enforced: true,/{e=1} on && /^  \\},/{exit} END{exit !(a && e)}' \"\$f\""
check "every gallery photo counts against 'photos'; replacing the profile photo adds nothing (access.ts)" bash -c "
  f=src/server/entitlements/access.ts; grep -q \"if (key === 'photos') return activePhotos(db, subject);\" \"\$f\" && grep -q 'GALLERY_PHOTO_STATUSES' \"\$f\""
check "DEFAULT D13: evidence never counts against the gallery (marked in access.ts and the services)" bash -c "
  grep -q 'D13' src/server/entitlements/access.ts && grep -q 'DEFAULT D13' $SCHOOL"
check "the room gallery's limit is a default with its question (SCHOOL_ROOM_PHOTOS_MAX, questions/M16.md)" bash -c "
  grep -q 'DEFAULT D07 (M16)' src/server/db/schema/common.ts && grep -q 'SCHOOL_ROOM_PHOTOS_MAX = 12' src/server/db/schema/common.ts &&
  grep -q 'How many room photos a school' docs/plan/questions/M16.md"
check "the upgrade prompt only at the real limit (ENTITLEMENT_REQUIRED, offer only when the quota is used up)" bash -c "
  grep -q \"decision.code === 'quota'\" $GALLERY && grep -q \"'ENTITLEMENT_REQUIRED', GALLERY_FULL_MESSAGE\" $GALLERY"
check "the demo gallery and school photos are generated (D20), on demo- records only" bash -c "
  f=src/server/db/seed-photos.ts; grep -q 'demoRoom\\|demoLogo' \"\$f\" $PROCESS &&
  ! grep -A4 -E 'DEMO_(GALLERY|SCHOOL_PHOTOS)' \"\$f\" | grep -oE \"slug: '[^']+'\" | grep -v \"slug: 'demo-\""

# 6. The card's square photo (In scope 8; owner decision 2026-11-03) -------------------------------
check "the full card is 264x64 (the 200 px of text and the 64 px square) in the layout constants" \
  grep -q '  full: { width: 264, height: 64 },' src/lib/lineage-layout/presets.ts
check "the explorer's full card draws the square photo or monogram on its leading edge" bash -c "
  grep -q 'size=\"card\"' $CANVAS && grep -q \"card: { px: 64, text: 'text-xl', square: true }\" $AVATAR && grep -q 'items-stretch' $CANVAS"
check "the two columns at 390 px are recorded as a question with a default" grep -q 'Two full cards side by side on a 390 px phone' docs/plan/questions/M16.md
check "the skeleton slot is as wide as the full card" grep -q 'w-\[264px\]' src/components/lineage/explorer/explorer.tsx

# 7. The interface (In scope 6; CLAUDE.md §10) -----------------------------------------------------
check "the viewer is a dialog in the page: arrow keys only inside it, Previous/Next buttons, a swipe; loaded on first use" bash -c "
  grep -q \"from '@/components/ui/dialog'\" $VIEWER && grep -q \"'ArrowRight'\" $VIEWER && grep -q 'onKeyDown' $VIEWER &&
  grep -q 'Previous' $VIEWER && grep -q 'Next' $VIEWER && grep -q 'onPointerUp' $VIEWER && grep -q \"lazy(loadViewer)\" $GRID"
check "the grid links to the whole photo (works without JavaScript) and every image has its alt text" bash -c "
  grep -q 'href={photo.full}' $GRID && grep -q 'export function photoAlt' $GRID && grep -q 'photo.caption ??' $GRID && grep -q 'alt={photoAlt(' $VIEWER"
check "the managers: real file inputs, Move up/Move down (no drag and drop), a status in words" bash -c "
  for f in $MANAGER $SCHOOL_MANAGER; do grep -q 'type=\"file\"' \"\$f\" && grep -q 'Move up' \"\$f\" && grep -q 'Move down' \"\$f\" || exit 1; done
  grep -q 'Use as profile photo' $MANAGER && ! grep -qE 'draggable|onDrag' $MANAGER $SCHOOL_MANAGER"
refute "no window.open, no 100vh, no hover-only behaviour in the M16 components" grep -nE "window\.open|100vh|group-hover:|onMouseEnter" "$GRID" "$VIEWER" "$MANAGER" "$SCHOOL_MANAGER"
check "the profile shows its Photos section; the school page its logo and Photos" bash -c "
  grep -q 'data-testid=\"profile-gallery\"' 'src/app/people/[slug]/page.tsx' && grep -q 'data-testid=\"school-logo\"' 'src/app/schools/[slug]/page.tsx' &&
  grep -q 'data-testid=\"school-gallery\"' 'src/app/schools/[slug]/page.tsx'"
check "the new pages are in e2e/routes.ts (axe in both themes)" bash -c "grep -q \"path: '/dashboard/photos', name: 'dashboard-photos'\" e2e/routes.ts"

# 8. E2E and integration titles (Done when 3) ------------------------------------------------------
titles=(
  "$VIEWER_SPEC|@M16 the profile gallery opens in its viewer with the keyboard: Enter, the arrow keys, Esc, and the focus back on the photo"
  "$VIEWER_SPEC|@M16 by touch on a phone (a click on the desktop): a tap opens the viewer, Previous and Next move, the photo fits the screen"
  "$SPEC|@M16 an owner adds a photo with the keyboard, captions it, meets the Free Student limit, and removes it"
  "$SPEC|@M16 a Sifu adds a logo and a room photo to their school; the public page shows them and no rendition carries a GPS position"
)
for entry in "${titles[@]}"; do
  check "E2E test: ${entry#*|}" grep -qF "${entry#*|}" "${entry%%|*}"
done
check "the E2E runs axe in both themes" bash -c "grep -q 'expectNoAxeViolations' $SPEC && grep -q 'for (const theme of THEMES)' $SPEC && grep -q 'for (const theme of THEMES)' $VIEWER_SPEC"
check "the writing M16 spec runs in the exclusive run (PUBLIC_WRITE_SPECS); the viewer spec in the desktop and phone projects" bash -c "
  grep -qE \"^export const PUBLIC_WRITE_SPECS = \\[.*'\\*\\*/m16-galleries\\.spec\\.ts'.*\\] as const;\$\" e2e/projects.ts &&
  ! grep -q 'm16-gallery-viewer' e2e/projects.ts"
int_titles=(
  "$INT|the first photo becomes the profile photo; at the Free Student limit the next one is refused with the upgrade prompt"
  "$INT|with a higher plan from an admin grant the gallery grows; every photo counts and evidence never does (DEFAULT D13)"
  "$INT|strips the EXIF block and GPS position from every rendition, the whole photo too, and keeps its proportions"
  "$INT|a hidden person's gallery is 404 to everyone but the owner and staff with 2FA, and its photos are never public"
  "$SCHOOL_INT|strips the GPS position and camera of every rendition; neither it nor the exact point is in the page"
  "$SCHOOL_INT|a school that is not public: its photos are 404 to everyone but the listing account and staff with 2FA"
)
for entry in "${int_titles[@]}"; do
  check "integration test: ${entry#*|}" grep -qF "${entry#*|}" "${entry%%|*}"
done
check "the unit test strips metadata from the whole photo too" grep -q 'full' src/server/storage/gallery-photo.test.ts

# 9. Documentation (In scope 11) -------------------------------------------------------------------
check "ADR 0019 records D07, D13, the school gallery, the location rule and the card's size" bash -c "
  f=docs/adr/0019-galleries.md; grep -q 'DEFAULT D07' \"\$f\" && grep -q 'D13' \"\$f\" && grep -q 'school_photo' \"\$f\" && grep -q 'GPS' \"\$f\" && grep -q '264×64' \"\$f\""
check "docs/data-model.md describes school_photo and the gallery columns" bash -c "f=docs/data-model.md; grep -q 'school_photo' \"\$f\" && grep -q 'full_width' \"\$f\""
check "docs/entitlements.md records photos as available now" grep -q 'photos' docs/entitlements.md
check "the user guide covers the gallery, its limit, the viewer and the school's photos" bash -c "
  f=docs/guides/user-guide.bg.md; grep -q '## Галерия на профила (M16)' \"\$f\" && grep -q 'Use as profile photo' \"\$f\" && grep -q 'Add a room photo' \"\$f\""
check "the admin guide covers the tables, D07/D13, the moderation and the card" bash -c "
  f=docs/guides/admin-guide.bg.md; grep -q '## 22. Галерии на профила и на школата (M16)' \"\$f\" && grep -q 'gallery.remove' \"\$f\" && grep -q 'school_photo.remove' \"\$f\""
check "docs/plan/README.md has a status for M16" bash -c '! grep -qE "^\| M16 .*\| не е започнат \|$" docs/plan/README.md'
check "the milestone file has a Progress log with entries" bash -c "awk '/^## Дневник на напредъка/{f=1;next} f && /^- /{n++} END{exit !(n>0)}' docs/plan/M16-galleries.md"
if git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  for guide in docs/guides/user-guide.bg.md docs/guides/admin-guide.bg.md; do
    check "$guide changed in this branch (differs from the merge base with origin/main)" bash -c "! git diff --quiet $base -- $guide"
  done
else
  ok "the guides changed in this branch: not checkable here (merged, or no origin/main in this checkout)"
fi

if [ "$failures" -gt 0 ]; then
  echo "M16 checks: $failures failed"
  exit 1
fi
echo "M16 checks: all passed"
