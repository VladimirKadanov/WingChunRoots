#!/usr/bin/env bash
# scripts/restore-drill.sh — the restore drill (milestone M12; plan §3.1 "Архиви", §10.1 D24;
# docs/operations/backup-and-restore.md): restores a local archive into a throwaway database,
# times it and checks the copy.
#
#   scripts/restore-drill.sh                     # the newest archive of DATABASE_URL's database
#   scripts/restore-drill.sh --test-database     # the newest archive of TEST_DATABASE_URL's database
#   scripts/restore-drill.sh [--test-database] <file.dump | file.dump.age>
#
# An archive made with BACKUP_AGE_RECIPIENT (<name>.dump.age, with objects/<name>.tar.age) is
# decrypted into a private temporary folder first; that needs `age` on PATH and BACKUP_AGE_IDENTITY,
# the path of the age identity (private key) file, which belongs off the server: without it the
# drill stops with FAIL, it never skips the check.
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
#   8. a sample of EVERY object family (evidence files, passport certificates, profile and gallery
#      photos, school photos, event posters; scripts/lib/object-families.ts) has all its objects,
#      and the one the row's SHA-256 describes has that hash: from the archive's copy in objects/
#      when there is one, else from the stores. A row that points at a missing object fails the
#      drill, so an archive made without a family's files cannot report green;
#   9. the Better Auth tables are there;
#  10. the private tables are there: the evidence records (M10a), the invitations, claims, reports
#      and review history (M10b), the exact school locations (M11) and the audit log;
#  11. the erasure replay (review 2026-11, docs/adr/0032-retention-and-withdrawal.md): a fictional
#      account is added to the restored copy, a ledger folder of the drill's own says it was erased
#      after the archive was taken, and `pnpm erasures:replay` (a dry run first, then --apply, then
#      again) must leave it unchanged, remove it, and find nothing more to do.
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
# Check 4 compares the rows of the tables the archive holds; this list proves the private ones are
# in it at all (a table left out of the dump would have no COPY section to compare).
PRIVATE_TABLES=(evidence_file evidence_link invitation person_claim content_report review_case review_event review_note school_private_location audit_log)

use_test=0
dump=""
for arg in "$@"; do
  case "$arg" in
    --test-database) use_test=1 ;;
    -h | --help)
      sed -n '2,46p' "$0"
      exit 0
      ;;
    -*)
      echo "restore-drill: unknown option $arg (see --help)" >&2
      exit 2
      ;;
    *) dump="$arg" ;;
  esac
done

for name in DATABASE_URL TEST_DATABASE_URL BACKUP_DIR PG_CONTAINER DRILL_TARGET DRILL_IMAGE RESTORE_RTO_SECONDS DRILL_EVIDENCE_SAMPLE BACKUP_AGE_IDENTITY DB_APP_RW_PASSWORD; do
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
  dump="$(find "$dir" -maxdepth 1 -type f \( -name "$source_db-*.dump" -o -name "$source_db-*.dump.age" \) -print 2>/dev/null |
    grep -E "/$source_db-[0-9]{8}T[0-9]{6}Z\\.dump(\\.age)?\$" | sort | tail -n 1 || true)"
  [ -n "$dump" ] || { echo "restore-drill: no archive of $source_db in $dir (scripts/backup-local.sh makes one)" >&2; exit 1; }
fi
[ -f "$dump" ] || { echo "restore-drill: $dump does not exist" >&2; exit 1; }
base="$(basename "$dump")"
stem="${base%.age}"
stem="${stem%.dump}"
objects_dir="$(dirname "$dump")/objects/$stem"
objects_archive="$(dirname "$dump")/objects/$stem.tar.age"
encrypted=0
case "$base" in *.age) encrypted=1 ;; esac

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
restore_log=""
restore_file="$dump"
scratch=""
ledger_dir=""
# Where the replay of check 11 reaches the restored copy from this machine, and as which password.
replay_host="$PG_URL_HOST"
replay_port="$PG_URL_PORT"
replay_password="${DB_APP_RW_PASSWORD:-}"

# The error lines of a pg_restore log, without anything that can quote row data: DETAIL, CONTEXT,
# HINT, LINE and "Command was" lines are dropped; quoted literals, key values "(k)=(v)" and a value
# after the last colon are replaced. At most 20 lines of at most 200 characters.
restore_errors() {
  grep -E '(ERROR|FATAL|error):' "$1" \
    | grep -Ev '(DETAIL|CONTEXT|HINT|LINE [0-9]+|Command was):' \
    | sed -E -e "s/'[^']*'/'…'/g" -e 's/\([^)]*\)=\([^)]*\)/(…)=(…)/g' -e 's/: "[^"]*"[[:space:]]*$/: "…"/' \
    | cut -c1-200 | head -n 20 || true
}

cleanup() {
  set +e
  [ -n "$restore_log" ] && rm -f "$restore_log"
  [ -n "$scratch" ] && rm -rf "$scratch"
  [ -n "$ledger_dir" ] && rm -rf "$ledger_dir"
  if [ -n "$drill_container" ]; then
    docker rm -f "$drill_container" >/dev/null 2>&1
  else
    [ -n "$dump_path" ] && [ "$dump_path" != "$restore_file" ] && pg_remove_copy "$dump_path"
    pg_tool_on "$source_db" psql -X -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$drill_db\" WITH (FORCE)" >/dev/null 2>&1
  fi
}
trap cleanup EXIT

# An archive made with BACKUP_AGE_RECIPIENT is decrypted into a private temporary folder (mode 0700,
# removed on exit); nothing of it is printed. The identity (the private key) is the operator's.
if [ "$encrypted" -eq 1 ] || [ -f "$objects_archive" ]; then
  command -v age >/dev/null 2>&1 || fail "the archive is encrypted with age, and age is not on PATH"
  { [ -n "${BACKUP_AGE_IDENTITY:-}" ] && [ -f "$BACKUP_AGE_IDENTITY" ]; } ||
    fail "the archive is encrypted: BACKUP_AGE_IDENTITY must name the age identity file (the private key, kept off the server)"
  scratch="$(umask 077 && mktemp -d "${TMPDIR:-/tmp}/wcr-drill.XXXXXXXXXX")"
fi
if [ "$encrypted" -eq 1 ]; then
  age -d -i "$BACKUP_AGE_IDENTITY" -o "$scratch/$stem.dump" "$dump" || fail "$base could not be decrypted with BACKUP_AGE_IDENTITY"
  restore_file="$scratch/$stem.dump"
  echo "restore-drill: $base decrypted with age"
fi
if [ -f "$objects_archive" ] && [ ! -d "$objects_dir" ]; then
  mkdir -p "$scratch/objects"
  { age -d -i "$BACKUP_AGE_IDENTITY" "$objects_archive" | tar -x -C "$scratch/objects"; } ||
    fail "the object copy $stem.tar.age could not be decrypted and unpacked"
  objects_dir="$scratch/objects"
  echo "restore-drill: the object copy $stem.tar.age decrypted with age"
fi

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
    # The port is published on the loopback only, for check 11: `pnpm erasures:replay` runs on this machine.
    POSTGRES_PASSWORD="$drill_password" POSTGRES_USER="$drill_user" docker run -d --rm --name "$drill_container" ${platform[@]+"${platform[@]}"} \
      -p 127.0.0.1::5432 --shm-size 256m -e POSTGRES_PASSWORD -e POSTGRES_USER -e POSTGRES_DB=postgres \
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
    mapped="$(docker port "$drill_container" 5432/tcp | head -n 1)"
    [ -n "$mapped" ] || fail "the temporary database container has no published port"
    replay_host=127.0.0.1
    replay_port="${mapped##*:}"
    # The roles are NOLOGIN here (below): check 11 gives app_rw a throwaway password in this throwaway container.
    replay_password="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(18).toString("hex"))')"
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

dump_path="$(pg_copy_in "$restore_file" "$drill_db.dump")"

# 2. The restore, timed ------------------------------------------------------------------------
started="$(now_ms)"
pg_tool_on "$admin_db" psql -X -q -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"$drill_db\" TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C.UTF-8'" >/dev/null
# The pg_restore log stays private (mode 0600, removed on exit): its DETAIL and CONTEXT lines can
# quote row data. On failure only its error lines are printed, with quoted values replaced.
restore_log="$(umask 077 && mktemp "${TMPDIR:-/tmp}/wcr-drill.XXXXXXXXXX")"
if ! pg_tool_on "$drill_db" pg_restore --exit-on-error --no-password -d "$drill_db" "$dump_path" > "$restore_log" 2>&1; then
  restore_errors "$restore_log" | sed 's/^/     /' >&2
  fail "pg_restore stopped with an error"
fi
rm -f "$restore_log"
restore_log=""
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

# 8. A sample of every object family ------------------------------------------------------------------
# The rows come from the restored copy (scripts/lib/object-families.ts: evidence files, passport
# certificates, profile and gallery photos, school photos, event posters; $sample random rows of each),
# the objects from the archive's copy in objects/ when there is one, else from the stores. A row whose
# object is missing, or whose hash differs, fails the drill. An archive made without --objects and a
# database with photos is therefore checked against the stores as they are now.
object_sql="$(pnpm -s exec tsx scripts/ops/evidence-objects.ts sql --sample "$sample")"
object_rows="$(on_drill -c "$object_sql")"
if [ -z "$object_rows" ]; then
  objects_note="no rows with files to check"
else
  verify_args=()
  [ -d "$objects_dir" ] && verify_args=(--objects "$objects_dir")
  object_out="$(printf '%s\n' "$object_rows" | pnpm -s exec tsx scripts/ops/evidence-objects.ts verify ${verify_args[@]+"${verify_args[@]}"} 2>&1)" ||
    { printf '%s\n' "$object_out" | sed 's/^/     /' >&2; fail "a row points at a missing object, or an object does not match its SHA-256"; }
  objects_note="$(printf '%s\n' "$object_out" | sed -n 's/^objects: \([a-z_]*\): \([0-9]* of [0-9]*\) .*/\1 \2/p' | paste -sd ',' - | sed 's/,/, /g')"
  if [ -d "$objects_dir" ]; then objects_note="$objects_note (archive copy)"; else objects_note="$objects_note (stores as they are now; the archive has no object copy)"; fi
fi
echo "restore-drill: objects: $objects_note"

# 9. The Better Auth tables -----------------------------------------------------------------------
missing=()
for table in "${AUTH_TABLES[@]}"; do
  present="$(on_drill -c "SELECT to_regclass('public.$table') IS NOT NULL")"
  [ "$present" = t ] || missing+=("$table")
done
[ "${#missing[@]}" -eq 0 ] || fail "Better Auth tables missing: ${missing[*]}"
echo "restore-drill: Better Auth tables: ${#AUTH_TABLES[@]} present"

# 10. The private tables ---------------------------------------------------------------------------
missing=()
for table in "${PRIVATE_TABLES[@]}"; do
  present="$(on_drill -c "SELECT to_regclass('public.$table') IS NOT NULL")"
  [ "$present" = t ] || missing+=("$table")
done
[ "${#missing[@]}" -eq 0 ] || fail "private tables missing: ${missing[*]}"
echo "restore-drill: private tables (evidence, invitations, claims, reports, review history, school locations, audit): ${#PRIVATE_TABLES[@]} present"

# 11. The erasure replay ----------------------------------------------------------------------------
# A backup brings back what was erased after the dump. The ledger (src/server/erasure-ledger.ts) is the
# record outside the database, and `pnpm erasures:replay` repeats it. Here a fictional account is added to
# the restored copy, a ledger folder of the drill's own (never the real one) says it was erased after the
# archive was taken, and the real command runs against the copy as app_rw: a dry run changes nothing,
# --apply removes the account, and a second run finds nothing to do.
[ -n "$replay_password" ] || fail "DB_APP_RW_PASSWORD is not set: the erasure replay connects to the restored copy as app_rw"
if [ "$target" = container ]; then
  printf "ALTER ROLE app_rw WITH LOGIN PASSWORD '%s'\n" "$replay_password" | pg_tool_on "$admin_db" psql -X -q -v ON_ERROR_STOP=1 >/dev/null
fi
ledger_dir="$(umask 077 && mktemp -d "${TMPDIR:-/tmp}/wcr-drill-ledger.XXXXXXXXXX")"
drill_email="demo-drill-erased-$RANDOM$RANDOM@example.test"
drill_account="$(on_drill -c "INSERT INTO auth_user (email, email_verified) VALUES ('$drill_email', true) RETURNING id")" ||
  fail "the fictional account for the erasure replay could not be added to the restored copy"
drill_account="$(printf '%s' "$drill_account" | head -n 1 | tr -d '\r\n')"
[[ "$drill_account" =~ ^[0-9a-f-]{36}$ ]] || fail "the fictional account for the erasure replay has no id"
pnpm -s exec tsx scripts/ops/erasure-ledger-fixture.ts --dir "$ledger_dir" --id "$drill_account" >/dev/null ||
  fail "the drill's ledger folder could not be written"
replay() {
  DATABASE_URL="postgres://app_rw@$replay_host:$replay_port/$drill_db" DB_APP_RW_PASSWORD="$replay_password" \
    ERASURE_LEDGER_DIR="$ledger_dir" pnpm -s erasures:replay "$@" 2>&1
}
account_rows() { on_drill -c "SELECT count(*) FROM auth_user WHERE email = '$drill_email'"; }
dry_out="$(replay)" || { printf '%s\n' "$dry_out" | sed 's/^/     /' >&2; fail "pnpm erasures:replay (dry run) stopped with an error"; }
printf '%s\n' "$dry_out" | grep -q "$drill_account: present, would-erase" || { printf '%s\n' "$dry_out" | sed 's/^/     /' >&2; fail "the dry run does not list the erased account as one to carry out"; }
[ "$(account_rows)" = 1 ] || fail "the dry run of pnpm erasures:replay changed the restored copy"
apply_out="$(replay --apply)" || { printf '%s\n' "$apply_out" | sed 's/^/     /' >&2; fail "pnpm erasures:replay --apply stopped with an error"; }
printf '%s\n' "$apply_out" | grep -q "$drill_account: present, erased" || { printf '%s\n' "$apply_out" | sed 's/^/     /' >&2; fail "pnpm erasures:replay --apply did not carry out the erasure"; }
[ "$(account_rows)" = 0 ] || fail "the account erased after the archive is still in the restored copy after pnpm erasures:replay --apply"
again_out="$(replay --apply)" || { printf '%s\n' "$again_out" | sed 's/^/     /' >&2; fail "a second pnpm erasures:replay --apply stopped with an error"; }
printf '%s\n' "$again_out" | grep -Eq "$drill_account: (absent|already), nothing" || { printf '%s\n' "$again_out" | sed 's/^/     /' >&2; fail "a second pnpm erasures:replay --apply found something more to do"; }
echo "restore-drill: erasure replay: an account erased after the archive is removed from the restored copy (dry run first, then --apply; a second run finds nothing)"

echo "RESTORE DRILL: PASS — $base restored in ${duration_s}s (RTO ${rto}s, DEFAULT D24); $table_count tables, $total_rows rows, $fks foreign keys, $edge_count verified edges"
