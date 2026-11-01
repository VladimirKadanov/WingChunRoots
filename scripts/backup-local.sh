#!/usr/bin/env bash
# scripts/backup-local.sh — a local archive of the database (milestone M12; plan §3.1 "Архиви",
# docs/operations/backup-and-restore.md).
#
#   scripts/backup-local.sh                    # the database of DATABASE_URL (else TEST_DATABASE_URL)
#   scripts/backup-local.sh --test-database    # the database of TEST_DATABASE_URL
#   scripts/backup-local.sh --objects          # also copy the evidence objects (with either)
#
# Writes into BACKUP_DIR (default backups/, git-ignored), readable by the owner only:
#
#   <database>-<YYYYMMDDTHHMMSSZ>.dump          pg_dump -Fc of the whole database
#   <database>-<YYYYMMDDTHHMMSSZ>.dump.sha256   its SHA-256 (`sha256sum -c` reads it)
#   <database>-<YYYYMMDDTHHMMSSZ>.dump.lineage  the ancestor paths of the verified lineage at the
#                                              time of the dump (scripts/ops/lineage-digest.sql),
#                                              which scripts/restore-drill.sh checks
#   objects/<database>-<YYYYMMDDTHHMMSSZ>/      with --objects: every evidence object of the store
#                                              (SeaweedFS or the private folder)
#
# Keeps the newest BACKUP_KEEP (default 14) dumps of that database and removes older ones with
# their files. pg_dump runs where the server's own tools are (scripts/lib/pg-run.sh): inside the
# database container locally and in CI, from PATH in the cloud session. The URL comes from the
# environment or .env and is never printed or put on a command line.
set -Eeuo pipefail
trap 'echo "backup: failed at line $LINENO" >&2' ERR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/lib/psql.sh
. scripts/lib/psql.sh
# shellcheck source=scripts/lib/pg-run.sh
. scripts/lib/pg-run.sh

use_test=0
objects=0
for arg in "$@"; do
  case "$arg" in
    --test-database) use_test=1 ;;
    --objects) objects=1 ;;
    -h | --help)
      sed -n '2,24p' "$0"
      exit 0
      ;;
    *)
      echo "backup: unknown argument $arg (see --help)" >&2
      exit 2
      ;;
  esac
done

for name in DATABASE_URL TEST_DATABASE_URL BACKUP_DIR BACKUP_KEEP PG_CONTAINER; do
  if [ -z "${!name:-}" ] && [ -f .env ]; then
    value="$(dotenv_value "$name")"
    if [ -n "$value" ]; then export "$name=$value"; fi
  fi
done

if [ "$use_test" -eq 1 ]; then
  url="${TEST_DATABASE_URL:-}"
  [ -n "$url" ] || { echo "backup: --test-database needs TEST_DATABASE_URL" >&2; exit 1; }
else
  url="${DATABASE_URL:-${TEST_DATABASE_URL:-}}"
  [ -n "$url" ] || { echo "backup: neither DATABASE_URL nor TEST_DATABASE_URL is set (local: scripts/init-env.sh)" >&2; exit 1; }
fi
keep="${BACKUP_KEEP:-14}"
case "$keep" in '' | *[!0-9]* | 0) echo "backup: BACKUP_KEEP must be a whole number of at least 1" >&2; exit 2 ;; esac

pg_target "$url"
pg_check_versions
database="$PG_URL_DB"
case "$database" in *[!A-Za-z0-9_-]*) echo "backup: the database name has characters a file name cannot carry" >&2; exit 2 ;; esac

umask 077
dir="${BACKUP_DIR:-backups}"
mkdir -p "$dir"
# The folder may be listed (the Compose web service reads the names and sizes for /admin/system,
# perhaps as another user id); every archive and evidence copy in it is the owner's alone (0600/0700).
chmod 755 "$dir" 2>/dev/null || true

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
while [ -e "$dir/$database-$stamp.dump" ]; do
  sleep 1
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
done
name="$database-$stamp.dump"
file="$dir/$name"
partial="$file.partial"
cleanup() { rm -f "$partial"; }
trap cleanup EXIT

lineage() { pg_tool psql -X -q -t -A -v ON_ERROR_STOP=1 -f - < scripts/ops/lineage-digest.sql | tr -d '\r'; }

started=$(date +%s)
lineage_digest=""
for attempt in 1 2; do
  before="$(lineage)"
  pg_tool pg_dump --format=custom --no-password > "$partial"
  after="$(lineage)"
  if [ "$before" = "$after" ]; then
    lineage_digest="$after"
    break
  fi
  [ "$attempt" -eq 1 ] && echo "backup: the lineage changed during the dump; dumping again"
done
# The archive must be readable by pg_restore of the same version, and hold the table data.
toc_data="$(pg_tool pg_restore --list < "$partial" | grep -c ' TABLE DATA ' || true)"
if [ "${toc_data:-0}" -eq 0 ]; then
  echo "backup: the archive has no table data; nothing kept" >&2
  exit 1
fi
mv "$partial" "$file"
hash="$(sha256_of "$file")"
printf '%s  %s\n' "$hash" "$name" > "$file.sha256"
if [ -n "$lineage_digest" ]; then
  printf '%s\n' "$lineage_digest" > "$file.lineage"
else
  echo "backup: warning: the lineage kept changing during the dump; no .lineage file (the drill skips that comparison)"
fi
size="$(wc -c < "$file" | tr -d ' ')"
elapsed=$(($(date +%s) - started))
echo "backup: wrote $file ($size bytes, $toc_data tables) in ${elapsed}s; $(pg_describe)"
echo "backup: sha256 $hash"
[ -n "$lineage_digest" ] && echo "backup: lineage ${lineage_digest%% *} ancestor paths recorded"

if [ "$objects" -eq 1 ]; then
  out="$dir/objects/$database-$stamp"
  mkdir -p "$out"
  pg_tool psql -X -q -t -A -v ON_ERROR_STOP=1 -c 'SELECT storage_key FROM evidence_file WHERE deleted_at IS NULL ORDER BY id' |
    pnpm -s exec tsx scripts/ops/evidence-objects.ts copy --out "$out"
fi

# Retention: the newest $keep dumps of this database; older ones go with their files.
mapfile -t dumps < <(find "$dir" -maxdepth 1 -type f -name "$database-*.dump" -print | sed 's|.*/||' |
  grep -E "^$database-[0-9]{8}T[0-9]{6}Z\\.dump\$" | sort -r)
removed=0
for old in "${dumps[@]:$keep}"; do
  rm -f "$dir/$old" "$dir/$old.sha256" "$dir/$old.lineage"
  rm -rf "${dir:?}/objects/${old%.dump}"
  removed=$((removed + 1))
done
kept=$((${#dumps[@]} - removed))
if [ "$removed" -gt 0 ]; then
  echo "backup: $kept of at most $keep archives of $database kept; removed $removed older"
else
  echo "backup: $kept of at most $keep archives of $database kept"
fi
