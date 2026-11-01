#!/usr/bin/env bash
# scripts/restore-drill.sh — the restore drill (milestone M12; plan §3.1 "Архиви", §10.1 D24;
# docs/operations/backup-and-restore.md): restores a local archive into a throwaway database,
# times it and checks the copy.
#
#   scripts/restore-drill.sh                     # the newest archive of DATABASE_URL's database
#   scripts/restore-drill.sh --test-database     # the newest archive of TEST_DATABASE_URL's database
#   scripts/restore-drill.sh [--test-database] <file.dump>
#
# Where the copy goes (DRILL_TARGET):
#   container  a temporary container of the PostgreSQL image of the Compose `postgres` service
#              (postgis/postgis:18-3.6 by digest), removed afterwards. The default locally, when
#              the Compose `postgres` service runs.
#   server     a temporary database on the server of the URL, dropped afterwards. The default in
#              the cloud session (PostgreSQL 16, tools on PATH) and in CI (PG_CONTAINER: the
#              PostgreSQL 18 service container, tools inside it).
#
# Checks of the restored copy:
#   1. the archive's SHA-256 is the one in <file>.sha256;
#   2. the restore (CREATE DATABASE + pg_restore --exit-on-error) takes at most RESTORE_RTO_SECONDS
#      (default 14400 s = 4 h; DEFAULT D24: the RTO of the pilot is up to 4 hours);
#   3. amcheck: every B-tree index (bt_index_check with heapallindexed) and every table (verify_heapam);
#   4. the rows of every table are the rows in the archive (its COPY sections);
#   5. every foreign key of the archive is there and validated, and no row points nowhere;
#   6. among the verified edges, no person is their own teacher and there is no cycle;
#   7. the ancestor paths are those recorded at the time of the dump (<file>.lineage);
#   8. a sample of evidence objects has the SHA-256 in evidence_file.sha256 (the archive's copy in
#      objects/ when there is one, else the evidence store);
#   9. the Better Auth tables are there.
#
# Prints the restore time and ends with "RESTORE DRILL: PASS ..." or exits 1. Never prints a URL,
# a password, a name or a storage key.
set -Eeuo pipefail
trap 'echo "restore-drill: failed at line $LINENO" >&2' ERR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/lib/psql.sh
. scripts/lib/psql.sh
# shellcheck source=scripts/lib/pg-run.sh
. scripts/lib/pg-run.sh

# DEFAULT D24: the RTO of the local pilot is up to 4 hours (plan §10.1).
RTO_DEFAULT_SECONDS=14400
DEFAULT_DRILL_IMAGE="postgis/postgis:18-3.6@sha256:60f6ad1d21ea86a67d47780b9a0d1e1d200500f62b19293fa834d0dea80b8677"
AUTH_TABLES=(auth_user auth_session auth_account auth_verification auth_two_factor auth_throttle)

use_test=0
dump=""
for arg in "$@"; do
  case "$arg" in
    --test-database) use_test=1 ;;
    -h | --help)
      sed -n '2,32p' "$0"
      exit 0
      ;;
    -*)
      echo "restore-drill: unknown option $arg (see --help)" >&2
      exit 2
      ;;
    *) dump="$arg" ;;
  esac
done

for name in DATABASE_URL TEST_DATABASE_URL BACKUP_DIR PG_CONTAINER DRILL_TARGET DRILL_IMAGE RESTORE_RTO_SECONDS DRILL_EVIDENCE_SAMPLE; do
  if [ -z "${!name:-}" ] && [ -f .env ]; then
    value="$(dotenv_value "$name")"
    if [ -n "$value" ]; then export "$name=$value"; fi
  fi
done

if [ "$use_test" -eq 1 ]; then
  url="${TEST_DATABASE_URL:-}"
  [ -n "$url" ] || { echo "restore-drill: --test-database needs TEST_DATABASE_URL" >&2; exit 1; }
else
  url="${DATABASE_URL:-${TEST_DATABASE_URL:-}}"
  [ -n "$url" ] || { echo "restore-drill: neither DATABASE_URL nor TEST_DATABASE_URL is set (local: scripts/init-env.sh)" >&2; exit 1; }
fi
rto="${RESTORE_RTO_SECONDS:-$RTO_DEFAULT_SECONDS}"
sample="${DRILL_EVIDENCE_SAMPLE:-20}"
case "$rto$sample" in *[!0-9]*) echo "restore-drill: RESTORE_RTO_SECONDS and DRILL_EVIDENCE_SAMPLE must be whole numbers" >&2; exit 2 ;; esac

pg_target "$url"
source_db="$PG_URL_DB"
dir="${BACKUP_DIR:-backups}"
if [ -z "$dump" ]; then
  dump="$(find "$dir" -maxdepth 1 -type f -name "$source_db-*.dump" -print 2>/dev/null |
    grep -E "/$source_db-[0-9]{8}T[0-9]{6}Z\\.dump\$" | sort | tail -n 1 || true)"
  [ -n "$dump" ] || { echo "restore-drill: no archive of $source_db in $dir (scripts/backup-local.sh makes one)" >&2; exit 1; }
fi
[ -f "$dump" ] || { echo "restore-drill: $dump does not exist" >&2; exit 1; }
base="$(basename "$dump")"
objects_dir="$(dirname "$dump")/objects/${base%.dump}"

fail() {
  echo "restore-drill: FAIL $1" >&2
  exit 1
}
now_ms() { node -e 'process.stdout.write(String(Date.now()))'; }

# 1. The checksum ------------------------------------------------------------------------------
[ -f "$dump.sha256" ] || fail "no $base.sha256 beside the archive"
expected_hash="$(cut -d ' ' -f 1 < "$dump.sha256" | tr -d '\r\n')"
actual_hash="$(sha256_of "$dump")"
[ "$expected_hash" = "$actual_hash" ] || fail "the SHA-256 of $base is not the one in $base.sha256"
echo "restore-drill: $base, SHA-256 matches"

# The target ------------------------------------------------------------------------------------
target="${DRILL_TARGET:-}"
if [ -z "$target" ]; then
  if [ "$PG_MODE" = container ] && [ -z "${PG_CONTAINER:-}" ]; then target=container; else target=server; fi
fi
drill_db="wcr_drill_$(date -u +%Y%m%d%H%M%S)_$RANDOM"
drill_container=""
dump_path=""

cleanup() {
  set +e
  if [ -n "$drill_container" ]; then
    docker rm -f "$drill_container" >/dev/null 2>&1
  else
    [ -n "$dump_path" ] && [ "$dump_path" != "$dump" ] && pg_remove_copy "$dump_path"
    pg_tool_on "$source_db" psql -X -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$drill_db\" WITH (FORCE)" >/dev/null 2>&1
  fi
}
trap cleanup EXIT

case "$target" in
  container)
    command -v docker >/dev/null 2>&1 || fail "DRILL_TARGET=container needs Docker"
    image="${DRILL_IMAGE:-}"
    if [ -z "$image" ] && [ -n "$PG_CONTAINER_ID" ]; then
      image="$(docker inspect --format '{{.Config.Image}}' "$PG_CONTAINER_ID" 2>/dev/null || true)"
    fi
    image="${image:-$DEFAULT_DRILL_IMAGE}"
    drill_container="wcr-restore-drill-$$-$RANDOM"
    # The source's superuser owns the extensions in the archive: the same name in the container.
    drill_user="${PG_URL_USER:-postgres}"
    platform=()
    [ "$image" = "$DEFAULT_DRILL_IMAGE" ] && platform=(--platform linux/amd64)
    drill_password="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(18).toString("hex"))')"
    POSTGRES_PASSWORD="$drill_password" POSTGRES_USER="$drill_user" docker run -d --rm --name "$drill_container" ${platform[@]+"${platform[@]}"} \
      --shm-size 256m -e POSTGRES_PASSWORD -e POSTGRES_USER -e POSTGRES_DB=postgres \
      -e "POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C.UTF-8" "$image" >/dev/null
    ready=0
    for _ in $(seq 1 120); do
      if docker exec "$drill_container" pg_isready -h 127.0.0.1 -U "$drill_user" -d postgres >/dev/null 2>&1; then
        ready=1
        break
      fi
      sleep 1
    done
    [ "$ready" -eq 1 ] || fail "the temporary database container did not start"
    PG_MODE=container
    PG_CONTAINER_ID="$drill_container"
    PG_URL_USER="$drill_user"
    PG_URL_PASSWORD="$drill_password"
    admin_db=postgres
    ;;
  server) admin_db="$source_db" ;;
  *) fail "DRILL_TARGET must be container or server" ;;
esac
pg_check_versions
echo "restore-drill: restoring into a temporary database ($target; $(pg_describe))"

on_drill() { pg_tool_on "$drill_db" psql -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }

# The roles the archive grants to and names as owners (a new server has none of them).
pg_tool_on "$admin_db" psql -X -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
SELECT format('CREATE ROLE %I NOLOGIN', r)
  FROM unnest(ARRAY['migrator', 'app_rw', 'app_public_ro']) AS r
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
\gexec
SQL

dump_path="$(pg_copy_in "$dump" "$drill_db.dump")"

# 2. The restore, timed ------------------------------------------------------------------------
started="$(now_ms)"
pg_tool_on "$admin_db" psql -X -q -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"$drill_db\" TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C.UTF-8'" >/dev/null
if ! pg_tool_on "$drill_db" pg_restore --exit-on-error --no-password -d "$drill_db" "$dump_path" > "${TMPDIR:-/tmp}/wcr-drill-$$.log" 2>&1; then
  tail -n 20 "${TMPDIR:-/tmp}/wcr-drill-$$.log" | sed 's/^/     /' >&2
  rm -f "${TMPDIR:-/tmp}/wcr-drill-$$.log"
  fail "pg_restore stopped with an error"
fi
rm -f "${TMPDIR:-/tmp}/wcr-drill-$$.log"
finished="$(now_ms)"
duration_ms=$((finished - started))
duration_s="$(node -e 'process.stdout.write((Number(process.argv[1]) / 1000).toFixed(1))' "$duration_ms")"
echo "restore-drill: restore took ${duration_s}s (RTO ${rto}s, DEFAULT D24)"
[ "$duration_ms" -le $((rto * 1000)) ] || fail "the restore took ${duration_s}s, over the RTO of ${rto}s"

# 3. amcheck -------------------------------------------------------------------------------------
amcheck="$(on_drill <<'SQL'
CREATE EXTENSION IF NOT EXISTS amcheck;
WITH idx AS (
  SELECT c.oid
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_am am ON am.oid = c.relam
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE am.amname = 'btree' AND c.relkind = 'i' AND c.relpersistence = 'p' AND i.indisready AND i.indisvalid
     AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_toast'
), checked AS (
  SELECT count(*) AS n FROM (SELECT bt_index_check(index => oid, heapallindexed => true) FROM idx) s
), heap AS (
  SELECT c.oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'm') AND c.relpersistence = 'p'
     AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_toast'
)
SELECT (SELECT n FROM checked) || ' ' || (SELECT count(*) FROM heap) || ' '
       || (SELECT count(*) FROM heap h CROSS JOIN LATERAL verify_heapam(h.oid) v);
SQL
)"
read -r indexes tables corrupt <<< "$amcheck"
[ "${corrupt:-1}" = 0 ] || fail "amcheck found $corrupt corrupt tuple(s)"
echo "restore-drill: amcheck: $indexes B-tree indexes and $tables tables, no corruption"

# 4. Rows: every table holds the rows of its COPY section in the archive --------------------------
expected_rows="$(pg_tool_on "$drill_db" pg_restore --data-only -f - "$dump_path" | awk '
  /^COPY [^ ]+ .*FROM stdin;$/ { table = $2; n = 0; inside = 1; next }
  inside && $0 == "\\." { print table "\t" n; inside = 0; next }
  inside { n++ }')"
[ -n "$expected_rows" ] || fail "the archive has no table data"
values=""
total_rows=0
while IFS=$'\t' read -r table n; do
  [[ "$table" =~ ^[A-Za-z0-9_.\"]+$ ]] || fail "unexpected table name in the archive"
  values+="${values:+,}('${table}', ${n})"
  total_rows=$((total_rows + n))
done <<< "$expected_rows"
mismatches="$(on_drill <<SQL
WITH expected (name, rows) AS (VALUES $values),
own AS (
  SELECT name, rows FROM expected e
   WHERE NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_class'::regclass AND d.objid = e.name::regclass AND d.deptype = 'e')
)
SELECT name || ': archive ' || rows || ', restored ' || actual
  FROM (SELECT name, rows,
               (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM ONLY %s', name::regclass), false, true, '')))[1]::text::bigint AS actual
          FROM own) t
 WHERE actual <> rows;
SQL
)"
[ -z "$mismatches" ] || { printf '%s\n' "$mismatches" | head -n 20 | sed 's/^/     /' >&2; fail "row counts differ from the archive"; }
table_count="$(printf '%s\n' "$expected_rows" | wc -l | tr -d ' ')"
echo "restore-drill: rows: $table_count tables, $total_rows rows, as in the archive"

# 5. Foreign keys ----------------------------------------------------------------------------------
toc_fks="$(pg_tool_on "$drill_db" pg_restore --list "$dump_path" | grep -c ' FK CONSTRAINT ' || true)"
fk_state="$(on_drill <<'SQL'
SELECT count(*) || ' ' || count(*) FILTER (WHERE NOT c.convalidated)
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
 WHERE c.contype = 'f' AND c.conparentid = 0
   AND n.nspname NOT IN ('pg_catalog', 'information_schema')
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_constraint'::regclass AND d.objid = c.oid AND d.deptype = 'e');
SQL
)"
read -r fks unvalidated <<< "$fk_state"
[ "$fks" = "$toc_fks" ] || fail "the archive has $toc_fks foreign keys, the restored copy $fks"
[ "$unvalidated" = 0 ] || fail "$unvalidated foreign key(s) not validated"
on_drill >/dev/null <<'SQL' || fail "rows that point nowhere (see above)"
DO $$
DECLARE
  r record;
  orphans bigint;
  bad text := '';
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS child, c.confrelid::regclass AS parent,
           (SELECT string_agg(format('c.%I', a.attname), ', ' ORDER BY k.ord)
              FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS child_cols,
           (SELECT string_agg(format('p.%I', a.attname), ', ' ORDER BY k.ord)
              FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS parent_cols
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE c.contype = 'f' AND c.conparentid = 0 AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  LOOP
    EXECUTE format('SELECT count(*) FROM %s c WHERE ROW(%s) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %s p WHERE ROW(%s) = ROW(%s))',
                   r.child, r.child_cols, r.parent, r.parent_cols, r.child_cols)
      INTO orphans;
    IF orphans > 0 THEN
      bad := bad || format(' %s (%s rows)', r.conname, orphans);
    END IF;
  END LOOP;
  IF bad <> '' THEN
    RAISE EXCEPTION 'rows that point nowhere:%', bad;
  END IF;
END
$$;
SQL
echo "restore-drill: foreign keys: $fks, all validated, no row points nowhere"

# 6. The verified edges: no self-link, no cycle ----------------------------------------------------
edges="$(on_drill <<'SQL'
WITH RECURSIVE edge AS (
  SELECT DISTINCT teacher_person_id AS teacher, student_person_id AS student
    FROM teaching_relationship WHERE status IN ('verified', 'in_arbitration')
), walk (ancestor, person) AS (
  SELECT teacher, student FROM edge
  UNION
  SELECT w.ancestor, e.student FROM walk w JOIN edge e ON e.teacher = w.person
)
SELECT (SELECT count(*) FROM edge) || ' '
       || (SELECT count(*) FROM edge WHERE teacher = student) || ' '
       || (SELECT count(*) FROM walk WHERE ancestor = person);
SQL
)"
read -r edge_count self_links cycles <<< "$edges"
[ "$self_links" = 0 ] || fail "$self_links verified edge(s) link a person to themselves"
[ "$cycles" = 0 ] || fail "the verified edges hold a cycle ($cycles people are their own ancestor)"
echo "restore-drill: lineage: $edge_count verified edges, no self-link, no cycle"

# 7. The ancestor paths at the time of the dump ----------------------------------------------------
restored_lineage="$(on_drill -f - < scripts/ops/lineage-digest.sql | tr -d '\r')"
if [ -f "$dump.lineage" ]; then
  recorded_lineage="$(tr -d '\r\n' < "$dump.lineage")"
  [ "$recorded_lineage" = "$restored_lineage" ] || fail "the ancestor paths differ from those recorded at the dump"
  lineage_note="${restored_lineage%% *} ancestor paths as recorded"
else
  lineage_note="${restored_lineage%% *} ancestor paths (no .lineage file to compare)"
fi
echo "restore-drill: ancestor paths: $lineage_note"

# 8. A sample of the evidence objects -------------------------------------------------------------
evidence_rows="$(on_drill -c "SELECT id || '|' || storage_key || '|' || sha256 FROM evidence_file WHERE deleted_at IS NULL ORDER BY random() LIMIT $sample")"
if [ -z "$evidence_rows" ]; then
  evidence_note="no evidence files to check"
else
  verify_args=()
  [ -d "$objects_dir" ] && verify_args=(--objects "$objects_dir")
  evidence_out="$(printf '%s\n' "$evidence_rows" | pnpm -s exec tsx scripts/ops/evidence-objects.ts verify ${verify_args[@]+"${verify_args[@]}"} 2>&1)" ||
    { printf '%s\n' "$evidence_out" | sed 's/^/     /' >&2; fail "evidence objects do not match evidence_file.sha256"; }
  evidence_note="$(printf '%s\n' "$evidence_out" | sed -n 's/^evidence sample: //p' | head -n 1)"
fi
echo "restore-drill: evidence: $evidence_note"

# 9. The Better Auth tables -----------------------------------------------------------------------
missing=()
for table in "${AUTH_TABLES[@]}"; do
  present="$(on_drill -c "SELECT to_regclass('public.$table') IS NOT NULL")"
  [ "$present" = t ] || missing+=("$table")
done
[ "${#missing[@]}" -eq 0 ] || fail "Better Auth tables missing: ${missing[*]}"
echo "restore-drill: Better Auth tables: ${#AUTH_TABLES[@]} present"

echo "RESTORE DRILL: PASS — $base restored in ${duration_s}s (RTO ${rto}s, DEFAULT D24); $table_count tables, $total_rows rows, $fks foreign keys, $edge_count verified edges"
