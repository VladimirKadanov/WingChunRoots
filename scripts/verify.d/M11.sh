#!/usr/bin/env bash
# Milestone M11 checks (docs/plan/M11-schools-map.md, "Done when"), run by scripts/verify.sh after
# the unit tests (src/server/geo/geonames.test.ts: the extract's reader and writer;
# src/lib/school-finder.test.ts: the finder's address; scripts/check-bundle-budget.test.ts: LAZY_ONLY;
# src/components/map/boundary.test.ts: only src/components/map imports MapLibre), the integration
# tests (src/server/services/schools.int.test.ts: 49 km in and 51 km out, whole kilometres, EXPLAIN
# with the GiST index on the geography column, app_public_ro cannot read school_private_location,
# the lineage filter, the listing review and the pin rule, last_activity_at on sign-in), db:check,
# db:reset+migrate+seed, the build with the bundle budgets (and LAZY_ONLY: no page but /schools
# loads MapLibre with its first JavaScript) and E2E (`@smoke|@M11`; the M11 spec makes a school
# public, so it runs in the exclusive run after the others, e2e/projects.ts). They stay valid after
# M11, so `scripts/verify.sh all` keeps running them (CI, M13).
#
# Here: required files, the one migration, the procedures and their Server Actions, the location
# privacy rules (plan §6.4), the map (dependencies, boundary, lazy loading, styles, the phone sheet,
# the address), the screens and screenshots, the E2E and integration titles, the decisions by
# default and the documentation (both guides changed in this branch, the design review).
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

# png_is <file> <width>: a PNG file (its signature) whose image is <width> pixels wide (IHDR).
png_is() {
  [ -s "$1" ] || return 1
  [ "$(head -c 8 "$1" | od -An -tx1 | tr -d ' \n')" = "89504e470d0a1a0a" ] || return 1
  [ "$((16#$(head -c 20 "$1" | tail -c 4 | od -An -tx1 | tr -d ' \n')))" -eq "$2" ]
}

mapfile -t M11_SQL < <(ls drizzle/*_m11_schools_map/migration.sql 2>/dev/null)
mapfile -t M11_UI < <(find src/app/schools src/app/dashboard/schools src/components/schools src/components/map -type f -name '*.tsx' | sort)
mapfile -t PUBLIC_SCHOOL_CODE < <(find src/app/schools src/app/sitemap.ts src/components/schools src/components/map src/server/dto/schools.ts -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.ts' | sort)
SCHOOLS=src/server/services/schools.ts
REVIEW=src/server/services/school-review.ts
FINDER=src/components/schools/finder.tsx
MAP=src/components/map/school-map.tsx
SPEC=e2e/m11-schools.spec.ts
INT=src/server/services/schools.int.test.ts

KEY_SCREENS=(schools-list schools-empty school school-city-only school-not-listed dashboard-schools dashboard-school-new)
STATES=(schools-map schools-map-selected dashboard-school-upgrade dashboard-school-sent review-listing)
SIZES=(390x844 1440x900)
THEMES=(dark light)

# 1. Required files (Done when 1, 4) --------------------------------------------------------------
required=(
  src/server/geo/geonames.ts src/server/geo/geonames.test.ts src/server/geo/places.ts src/server/geo/extract-file.ts
  src/server/geo/cli.ts src/server/geo/map-styles.ts src/server/geo/data/geonames-places.tsv scripts/geonames-extract.ts
  "$SCHOOLS" "$REVIEW" "$INT" src/server/dto/schools.ts src/server/db/schema/schools.ts
  src/app/schools/page.tsx 'src/app/schools/[slug]/page.tsx' 'src/app/schools/[slug]/opengraph-image.tsx' src/app/sitemap.ts
  src/app/dashboard/schools/page.tsx src/app/dashboard/schools/new/page.tsx 'src/app/dashboard/schools/[id]/page.tsx'
  'src/app/dashboard/schools/[id]/edit/page.tsx' src/app/dashboard/schools/actions.ts src/app/dashboard/schools/school-form.tsx
  src/app/admin/review/listing.tsx
  "$FINDER" src/components/schools/school-list.tsx src/components/schools/marks.tsx
  "$MAP" src/components/map/pin-picker.tsx src/components/map/maplibre.ts src/components/map/map-controls.css
  src/components/map/use-theme.ts src/components/map/boundary.test.ts src/lib/school-finder.ts src/lib/school-finder.test.ts
  public/map-styles/light.json public/map-styles/dark.json
  "$SPEC" e2e/helpers/schools.ts
  licenses/addenda/geonames.md licenses/addenda/openstreetmap.md
  docs/schools-and-map.md docs/adr/0014-schools-map.md docs/plan/questions/M11.md docs/design/reviews/M11.md
  scripts/verify.d/M11.sh
)
for f in "${required[@]}"; do
  check "file exists: $f" test -s "$f"
done
check "directory exists and is not empty: docs/screenshots/M11/" bash -c '[ -d docs/screenshots/M11 ] && [ -n "$(ls -A docs/screenshots/M11)" ]'

# 2. One migration (the caller's rule: the schema change in one new Drizzle migration) ---------------
check "the M11 migration exists (m11_schools_map), with its snapshot" bash -c '
  [ "$(ls -d drizzle/*_m11_schools_map 2>/dev/null | wc -l)" -eq 1 ] && ls drizzle/*_m11_schools_map/snapshot.json'
refute "the M11 migration is PostgreSQL 16 SQL (no uuidv7(), no virtual columns, no OLD/NEW in RETURNING)" \
  grep_code 'uuidv7\(|VIRTUAL|RETURNING[^;]*(OLD|NEW)\.' "${M11_SQL[@]}"
# The rule is about the M11 branch: once its migration is on origin/main (M11 merged), a later
# milestone's branch adds its own migrations or none, and the rule no longer applies (M13).
m11_on_main() {
  local folder
  folder="$(ls -d drizzle/*_m11_schools_map 2>/dev/null | head -n 1)"
  [ -n "$folder" ] && git cat-file -e "origin/main:$folder/migration.sql" 2>/dev/null
}
if m11_on_main; then
  ok "one new migration in the M11 branch: M11 is merged into origin/main (checked in its own branch)"
elif git rev-parse --verify -q origin/main >/dev/null 2>&1 && base="$(git merge-base HEAD origin/main 2>/dev/null)" \
  && [ "$base" != "$(git rev-parse HEAD)" ] && ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  check "this branch adds exactly one migration folder (the M11 one)" bash -c "
    added=\$(git diff --name-only --diff-filter=A $base -- drizzle | grep -E '/migration\.sql\$')
    [ \"\$(printf '%s\n' \"\$added\" | grep -c .)\" -eq 1 ] && printf '%s\n' \"\$added\" | grep -q '_m11_schools_map/'"
else
  ok "one new migration in this branch: not checkable here (merged, or no origin/main in this checkout)"
fi
check "the school statuses are draft, pending_review, active, hidden, archived" \
  grep -qF "CHECK (\"status\" IN ('draft', 'pending_review', 'active', 'hidden', 'archived'))" "${M11_SQL[@]:-/dev/null}"
check "v_public_school keeps the city centroid for city_only and the pin rule (an active pro_sifu grant)" bash -c '
  f='"${M11_SQL[*]:-/dev/null}"'
  grep -qF "CASE s.\"location_privacy\" WHEN '\''exact'\'' THEN s.\"public_point\" ELSE pl.\"centroid\" END AS \"public_point\"" "$f" &&
  grep -qF "g.\"plan_code\" = '\''pro_sifu'\''" "$f" && grep -q "g.\"revoked_at\" IS NULL" "$f" &&
  grep -qF "s.\"created_by_user_id\" IS NULL" "$f"'
if [ -n "${TEST_DATABASE_URL:-}" ]; then
  facts="$(psql_url "$TEST_DATABASE_URL" -X -q -At -F ' ' -c "
    SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
             AND ((table_name = 'place' AND column_name IN ('alternate_names', 'search_text'))
               OR (table_name = 'school' AND column_name IN ('contact_email', 'contact_phone', 'forms_taught')))),
           (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
             AND ((indexname = 'review_case_one_open_per_school_key' AND indexdef LIKE '%UNIQUE%')
               OR (indexname = 'place_search_text_trgm_idx' AND indexdef LIKE '%gin_trgm_ops%'))),
           (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'school' AND indexdef LIKE '%USING gist (public_point)%'),
           has_table_privilege('app_public_ro', 'public.school_private_location', 'SELECT')
             OR has_table_privilege('app_public_ro', 'public.school', 'SELECT') OR has_table_privilege('app_public_ro', 'public.place', 'SELECT'),
           has_table_privilege('app_public_ro', 'public.v_public_school', 'SELECT'),
           (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.school'::regclass AND attname = 'public_point')" 2>/dev/null)"
  check "the M11 columns exist: place.alternate_names, place.search_text, school.contact_email, contact_phone, forms_taught" test "$(echo "$facts" | cut -d' ' -f1)" = "5"
  check "the indexes exist: one open listing case per school (unique), the trigram index of place.search_text" test "$(echo "$facts" | cut -d' ' -f2)" = "2"
  check "school.public_point has its GiST index" test "$(echo "$facts" | cut -d' ' -f3)" -ge 1
  check "app_public_ro cannot read school_private_location, school or place (only the public views)" test "$(echo "$facts" | cut -d' ' -f4)" = "f"
  check "app_public_ro reads v_public_school" test "$(echo "$facts" | cut -d' ' -f5)" = "t"
  check "school.public_point is geography(Point,4326)" test "$(echo "$facts" | cut -d' ' -f6-)" = "geography(Point,4326)"
else
  bad "TEST_DATABASE_URL is not set: cannot check the M11 columns, indexes and grants"
fi

# 3. The procedures and their Server Actions (In scope 2, 4; plan §6.8) -----------------------------
check "pnpm api:openapi --check: docs/api/openapi.json matches the router (log: .verify/M11-openapi.log)" bash -c '
  mkdir -p .verify && pnpm --silent api:openapi --check > .verify/M11-openapi.log 2>&1'
check "the contract has every M11 procedure (search, inViewport, get, sitemap, mine, edit, options, create, update, submit, confirm, places)" node -e "
  const p = require('./docs/api/openapi.json').paths || {};
  const posts = ['/schools/search', '/schools/in-viewport', '/schools/create', '/schools/update', '/schools/submit', '/schools/confirm'];
  const gets = ['/schools/{slug}', '/sitemap/schools', '/schools/mine', '/schools/mine/{id}', '/schools/mine/new', '/places/search'];
  process.exit(posts.every((k) => p[k]?.post) && gets.every((k) => p[k]?.get) ? 0 : 1)"
check "every M11 Server Action is in the API parity table with its procedure" bash -c '
  f=src/server/rpc/parity.ts
  for a in create update submit confirm; do
    A="$(printf "%s" "${a:0:1}" | tr a-z A-Z)${a:1}"
    grep -q "src/app/dashboard/schools/actions.ts#${a}SchoolAction'\'': { rpc: \['\''schools.$a'\''\] }" "$f" || exit 1
  done'
check "the owner procedures need a session (create, update, submit, confirm: signedIn)" bash -c '
  n=$(grep -cE "^    (create|update|submit|confirm): signedIn$" src/server/rpc/router.ts); [ "$n" -ge 4 ]'
check "schools.search takes a centre, a radius in km and a lineage root (plan §6.3)" bash -c '
  body="$(awk "/^export const schoolSearchInput = z.object\\(\\{/{on=1} on{print} on&&/^}/{exit}" '"$SCHOOLS"')"
  printf "%s\n" "$body" | grep -q "center:" && printf "%s\n" "$body" | grep -q "radiusKm:" && printf "%s\n" "$body" | grep -q "lineageRootId:"'
refute "the M11 pages and components never import src/server/db, and services only for their types" \
  bash -c "grep -rnE --exclude='*.test.ts' \"from ['\\\"]@/server/(services|db)\" src/app/schools src/app/dashboard/schools src/components/schools src/components/map src/app/admin/review/listing.tsx | grep -vE ':import type [^;]+ from .@/server/services/'"
refute "the M11 Server Actions import nothing from src/server/services or db (they call the procedures)" \
  grep -nE "from ['\"]@/server/(services|db)" src/app/dashboard/schools/actions.ts
check "a listing is decided in the M10a queue (review.decide) by a moderator or an administrator" bash -c '
  grep -q "school_listing" '"$REVIEW"' && grep -q "LISTING_DECIDE_ROLES" '"$REVIEW"''
check "school changes are audited: school.create, school.update, school.submit, school.confirm, school.publish, school.return" bash -c '
  for a in school.create school.update school.submit school.confirm school.publish school.return; do
    grep -rq "'\''$a'\''" src/server/audit/index.ts || exit 1
  done'

# 4. Location privacy (In scope 4, 8; plan §6.4; Constraints) ----------------------------------------
check "the radius is ST_DWithin on the geography column with a geography centre (plan §6.3)" bash -c '
  grep -qF "ST_DWithin(s.public_point, ST_SetSRID(ST_MakePoint(\${center.lng}::float8, \${center.lat}::float8), 4326)::geography, \${radiusM}::float8)" '"$SCHOOLS"''
refute "no radius or distance on a geometry cast (ST_DWithin/ST_Distance with ::geometry)" \
  grep_code 'ST_(DWithin|Distance)\([^)]*::geometry' "$SCHOOLS"
check "distances are whole kilometres" grep -qF "round(ST_Distance(v.public_point, \${c}) / 1000)::int AS distance_km" "$SCHOOLS"
check "every public read goes through v_public_school (PIN_COLUMNS from v)" grep -q "FROM v_public_school v" "$SCHOOLS"
check "the viewport's boxes follow parallels: segmentized before the geography cast, compared with the edges themselves" bash -c '
  grep -qF "ST_Segmentize(ST_MakeEnvelope(" '"$SCHOOLS"' && grep -qF "BETWEEN \${b.south}::float8 AND \${b.north}::float8" '"$SCHOOLS"''
check "a listing decision carries the version of the listing the reviewer saw (review.decide schoolVersion, the case card)" bash -c '
  grep -q "schoolVersion: z.string()" src/server/services/review.ts && grep -q "input.schoolVersion !== listing.version" '"$REVIEW"' &&
  grep -qF "name=\"schoolVersion\"" src/app/admin/review/forms.tsx'
refute "no public school code names the private table or its columns (school_private_location, exact_point, address_line)" \
  grep_code 'school_private_location|exactPoint|exact_point|addressLine|address_line' "${PUBLIC_SCHOOL_CODE[@]}"
check "JSON-LD gives geo only for an exact location" grep -qF "...(school.precision === 'exact' ? { geo: { '@type': 'GeoCoordinates'" 'src/app/schools/[slug]/page.tsx'
refute "the schools services log nothing (no console.*): no point, address or contact in a log" \
  grep_code 'console\.(log|info|warn|error|debug)' "$SCHOOLS" "$REVIEW" src/server/geo/places.ts
check "the cached reads use cacheLife and the schools tag" bash -c '
  grep -q "cacheLife(" '"$SCHOOLS"' && grep -q "schools" src/server/cache-tags.ts'
refute "no exact coordinates of a demo city-only school in the screenshots list or the routes" \
  bash -c "grep -nE '[0-9]{1,3}\.[0-9]{4,}' e2e/routes.ts"

# 5. The map (In scope 6; plan §5.3, §5.8) -----------------------------------------------------------
check "maplibre-gl 6.14.0 and @vis.gl/react-maplibre 8.1.3 are pinned exactly, with their reason in ADR 0001 and ADR 0014" bash -c '
  grep -qx "    \"maplibre-gl\": \"6.14.0\"," package.json && grep -qx "    \"@vis.gl/react-maplibre\": \"8.1.3\"," package.json &&
  grep -q "maplibre-gl" docs/adr/0001-stack.md && grep -q "maplibre-gl" docs/adr/0014-schools-map.md'
check "only src/components/map imports MapLibre (eslint.config.mjs)" \
  grep -qF "group: ['maplibre-gl', 'maplibre-gl/*', '@vis.gl/react-maplibre', '@vis.gl/react-maplibre/*']," eslint.config.mjs
check "the map island and the sheet load after the page (next/dynamic, ssr: false)" bash -c '
  grep -qF "const SchoolMap = dynamic(() => import('\''@/components/map/school-map'\''), {" '"$FINDER"' && grep -q "ssr: false" '"$FINDER"''
check "no page but /schools loads MapLibre with its first JavaScript (LAZY_ONLY) and /schools has its 170 kB budget" bash -c '
  f=scripts/check-bundle-budget.mjs
  grep -qF "export const LAZY_ONLY = [{ name: '\''MapLibre'\'', signature: '\''maplibregl-canvas-container'\'' }];" "$f" &&
  grep -qF "'\''/schools'\'': 170 * KB," "$f"'
check "the /schools budget and its measured size are in ADR 0014" bash -c '
  f=docs/adr/0014-schools-map.md; grep -q "/schools" "$f" && grep -q "170 kB" "$f" && grep -qE "159,6|159\.6" "$f"'
check "the OpenFreeMap styles are in the configuration, the local test styles in public/map-styles" bash -c '
  f=src/server/geo/map-styles.ts
  grep -q "https://tiles.openfreemap.org/styles/positron" "$f" && grep -q "https://tiles.openfreemap.org/styles/dark" "$f" &&
  grep -q "/map-styles/light.json" "$f" && grep -q "/map-styles/dark.json" "$f"'
refute "the local test styles load nothing from outside (no http address in public/map-styles)" \
  grep -nE 'https?://' public/map-styles/light.json public/map-styles/dark.json
check "the attribution control is on (both map islands)" bash -c '
  grep -q "<AttributionControl" '"$MAP"' && grep -q "<AttributionControl" src/components/map/pin-picker.tsx'
check "the phone sheet has the snap points [0.15, 0.5, 0.92]" grep -qF "const SNAP_POINTS = [0.15, 0.5, 0.92];" "$FINDER"
check "the map keeps the selected pin above the sheet (padding.bottom = the sheet over the map)" bash -c '
  grep -q "paddingBottom={over}" '"$FINDER"' && grep -q "data-padding-bottom={paddingBottom}" '"$MAP"''
check "the view goes to the address with replaceState (lat, lng, z, radius, lineage, view)" bash -c '
  grep -q "window.history.replaceState(" '"$FINDER"' &&
  for k in lat lng z radius lineage view; do grep -q "'\''$k'\''" src/lib/school-finder.ts || exit 1; done'
check "markers differ by shape and text (exact pin, hollow ring with \"Private club, by invitation\")" bash -c '
  grep -q "ExactPinMark" src/components/schools/marks.tsx && grep -q "CityRingMark" src/components/schools/marks.tsx &&
  grep -rq "Private club, by invitation" src/components/schools'
check "without WebGL 2 the finder shows the same list (map-fallback)" grep -q 'data-testid="map-fallback"' "$FINDER"
check "the map controls follow the theme and have 44 px targets on touch screens" bash -c '
  f=src/components/map/map-controls.css
  grep -q "@media (pointer: coarse)" "$f" && grep -q "width: 44px" "$f" && grep -q "data-map-theme" "$f"'
# The draft /legal/privacy shows (src/server/legal/documents.ts), in its section on recipients.
check "the privacy policy draft names OpenFreeMap as a recipient" bash -c '
  f=content/legal/privacy.en.md
  grep -qF "file: '\''$f'\''," src/server/legal/documents.ts &&
  awk "/^## [0-9]+\\. Who receives it/{on=1; next} /^## /{on=0} on" "$f" | grep -q "^- \*\*OpenFreeMap\*\*"'
check "the map styles point to the privacy policy draft that names OpenFreeMap" grep -qF "(content/legal/privacy.en.md)" src/server/geo/map-styles.ts

# 6. Screens, routes and screenshots (In scope 7, 9; Done when 1) ------------------------------------
for path in "/schools?view=list" /schools/demo-school-sofia /schools/demo-school-city-only /dashboard/schools /dashboard/schools/new; do
  check "route $path is in e2e/routes.ts (axe in both themes)" grep -qF "path: '$path'" e2e/routes.ts
done
for screen in "${KEY_SCREENS[@]}"; do
  check "$screen is a key screen (visual regression and screenshots)" grep -qE "name: '$screen'.*milestone: 'M11'.*key: true" e2e/routes.ts
done
check "the map screens are in the visual regression with the canvas masked, and in the screenshots" bash -c '
  grep -q "for (const screen of SCHOOL_MAP_SCREENS)" e2e/visual.spec.ts && grep -q "canvas.maplibregl-canvas" e2e/visual.spec.ts &&
  grep -q "...SCHOOL_MAP_SCREENS.map((screen) => ({ ...screen, milestone: '\''M11'\'' }))," e2e/screenshots.spec.ts'
for state in dashboard-school-upgrade dashboard-school-sent review-listing; do
  check "screen state $state is in e2e/screenshots.spec.ts" grep -q "name: '$state'" e2e/screenshots.spec.ts
done
# A real screenshot, not a placeholder: a PNG as wide as its size (390x844 at 2x, as e2e/screenshots.spec.ts takes it).
for screen in "${KEY_SCREENS[@]}" "${STATES[@]}"; do
  for size in "${SIZES[@]}"; do
    width=$([ "$size" = 390x844 ] && echo 780 || echo 1440)
    for theme in "${THEMES[@]}"; do
      check "screenshot: docs/screenshots/M11/$screen-$size-$theme.png (a PNG $width px wide)" png_is "docs/screenshots/M11/$screen-$size-$theme.png" "$width"
    done
  done
done
refute "no 100vh in the M11 screens (dvh/svh only)" grep_code '100vh|h-screen' "${M11_UI[@]}"
refute "no window.open in the M11 screens" grep_code 'window\.open' "${M11_UI[@]}"
check "Schools is a built destination in the navigation" bash -c '! grep -nA3 "/schools" src/components/shell/nav.ts | grep -q "built: false"'

# 7. E2E and integration titles (Done when 2, 3) -----------------------------------------------------
titles=(
  '@M11 the radius filter returns schools within 50 km and excludes one outside'
  '@M11 the lineage filter returns only schools whose instructors descend from the chosen fictional root'
  '@M11 a school whose instructor is demo-two-lineages is returned for both lineage roots'
  '@M11 demo-school-city-only: the exact coordinates appear in no API response, page, sitemap, Open Graph image, JSON-LD or test-results/server.log'
  '@M11 a Free Sifu sees an upgrade prompt instead of publishing a pin; a Pro Sifu test plan publishes after listing review'
  '@M11 revoking the Pro Sifu test grant hides the pin and keeps the school'
  '@M11 pages other than /schools load no map code or map style'
  '@M11 with WebGL unavailable the list view shows the same schools'
  '@M11 at 390x844 selecting a pin opens the sheet and the pin stays visible above it'
  "@M11 the school page links to the instructor's profile, list view and explorer"
  '@M11 the map switches between the dark and light styles together with the theme'
  '@M11 no axe violations on the /schools list view and a school page in dark and light themes'
)
for title in "${titles[@]}"; do
  check "E2E test: $title" grep -qF "$title" "$SPEC"
done
check "the M11 spec runs in the exclusive run, after the others (PUBLIC_WRITE_SPECS)" bash -c '
  grep -qE "^export const PUBLIC_WRITE_SPECS = \[.*'\''\*\*/m11-schools\.spec\.ts'\''.*\] as const;$" e2e/projects.ts &&
  grep -qF "export const EXCLUSIVE_SPECS: string[] = [EXCLUSIVE_SPEC, ...PUBLIC_WRITE_SPECS];" e2e/projects.ts'
int_titles=(
  'a whole-world box returns every public school, also with MapLibre longitudes beyond ±180'
  'a continental box follows its parallels: a school just inside the southern edge is in, one just north of the box is out'
  'a box across the antimeridian, in either form, holds the schools on both sides of 180° and nothing else'
  'refuses null, empty or boolean coordinates with 400 instead of reading them as 0 or 1'
  'hiding the middle person queues lineage.recompute; after the job the school leaves the root filter, and showing them again brings it back'
  'a decision on a listing changed after the reviewer opened it is refused; an approval needs the version it was made from'
  'a listed school edited in what it is, where, its website or instructors stays listed and opens a review; returning it to draft takes it off the map'
  'pnpm account:delete carries out the request of a Sifu with a draft and a listed school: both archived, nothing public or private left on them'
  'leaves the public school page and the lineage filter when the link is revoked or withdrawn, and comes back while it is confirmed'
  'returns a school 49 km away and not one 51 km away, with whole kilometres'
  'rounds every distance to a whole kilometre'
  "EXPLAIN of the service's radius query uses the GiST index on school.public_point (geography)"
  'cannot read school_private_location'
  'returns only schools whose instructors descend from the chosen fictional root'
  'a Pro Sifu publishes after the listing review; revoking the grant hides the pin and keeps the school'
  'does not change on sign-in; an edit and a confirmation move it'
)
for title in "${int_titles[@]}"; do
  check "integration test: $title" grep -qF "$title" "$INT"
done
refute "the E2E fixtures are fictional: every person and school page in the M11 spec is a demo- slug or a generated one" \
  bash -c "grep -nE '/(people|schools)/[a-z0-9]' $SPEC e2e/helpers/schools.ts | grep -vE '/(people|schools)/demo-' | grep -vE '/schools/(search|in-viewport|create|update|submit|confirm|mine|new)\\b'"

# 8. Decisions by default and documentation (In scope 1, 3, 10; Stop and ask) ------------------------
check "DEFAULT D08/D18, D17 and D12 are marked in the schools service" bash -c '
  f='"$SCHOOLS"'; grep -q "DEFAULT D08/D18" "$f" && grep -q "DEFAULT D17" "$f" && grep -q "DEFAULT D12" "$f"'
check "DEFAULT D08/D18 is marked at the view, DEFAULT D17 at the column" bash -c '
  grep -q "DEFAULT D08/D18" '"${M11_SQL[*]:-/dev/null}"' && grep -q "DEFAULT D17" src/server/db/schema/schools.ts'
check "the extract's countries are marked DEFAULT (M11 In scope 1) and the map styles DEFAULT (no D number)" bash -c '
  grep -q "DEFAULT, M11 In scope 1" src/server/geo/geonames.ts && grep -q "DEFAULT (no D number" src/server/geo/map-styles.ts'
check "the GeoNames extract names its source and has the six countries" bash -c '
  f=src/server/geo/data/geonames-places.tsv
  head -5 "$f" | grep -qi "source" && for c in BG GR DE GB US HK; do grep -qP "\t$c\t" "$f" || exit 1; done'
check "the addenda give the GeoNames (CC BY 4.0) and OpenStreetMap (ODbL) attribution, in the notices of /legal/licenses" bash -c '
  grep -q "CC BY 4.0" licenses/addenda/geonames.md && grep -q "ODbL" licenses/addenda/openstreetmap.md &&
  grep -q "GeoNames" src/app/legal/licenses/notices.json && grep -q "OpenStreetMap" src/app/legal/licenses/notices.json &&
  grep -q "GeoNames" THIRD_PARTY_NOTICES.md && grep -q "OpenStreetMap" THIRD_PARTY_NOTICES.md'
check "docs/schools-and-map.md records the defaults, the privacy rules and the API" bash -c '
  f=docs/schools-and-map.md
  grep -q "DEFAULT D08/D18" "$f" && grep -q "DEFAULT D17" "$f" && grep -q "DEFAULT D12" "$f" && grep -q "ST_DWithin" "$f" &&
  grep -q "schools.search" "$f" && grep -q "school_private_location" "$f"'
check "docs/plan/questions/M11.md records the GeoNames and OpenFreeMap questions with their defaults" bash -c '
  f=docs/plan/questions/M11.md
  grep -q "Where the committed GeoNames extract comes from" "$f" && grep -q "OpenFreeMap could not be reached" "$f" &&
  [ "$(grep -c "^\*\*Proposed default:\*\*" "$f")" -ge 2 ]'
check "docs/data-model.md describes the M11 columns, statuses and the pin rule of v_public_school" bash -c '
  f=docs/data-model.md
  grep -q "alternate_names" "$f" && grep -q "pending_review" "$f" && grep -q "forms_taught" "$f" && grep -q "_m11_schools_map" "$f"'
check "docs/design/reviews/M11.md reviews the screenshots against direction.md" bash -c '
  f=docs/design/reviews/M11.md; grep -q "docs/screenshots/M11" "$f" && grep -q "direction.md" "$f" && grep -q "390x844" "$f" && grep -q "1440x900" "$f"'
for screen in "${KEY_SCREENS[@]}" "${STATES[@]}"; do
  check "docs/design/reviews/M11.md names the screen $screen (its screenshots $screen-*)" grep -qF "\`$screen-" docs/design/reviews/M11.md
done
check "the user guide covers the finder, the map, the school page and listing a school" bash -c '
  f=docs/guides/user-guide.bg.md
  grep -q "## Школи и карта (M11)" "$f" && grep -q "### Страницата на школа" "$f" && grep -q "### Обявяване на школа" "$f" && grep -q "/schools" "$f"'
check "the admin guide covers the listing review and the pin" bash -c '
  f=docs/guides/admin-guide.bg.md
  grep -q "## 17. Школи, карта и прегледът на обявите (M11)" "$f" && grep -q "geo:load" "$f" && grep -q "MAP_STYLES" "$f"'
check "docs/plan/README.md has a status for M11" bash -c '! grep -qE "^\| M11 .*\| не е започнат \|$" docs/plan/README.md'
# Done when, item 1: both guides change in the milestone's branch. Checkable while the branch is not
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
  echo "M11 checks: $failures failed"
  exit 1
fi
echo "M11 checks: all passed"
