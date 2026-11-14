#!/usr/bin/env bash
# scripts/backup-local.sh — a local archive of the database (milestone M12; plan §3.1 "Архиви",
# docs/operations/backup-and-restore.md).
#
#   scripts/backup-local.sh                    # the database of DATABASE_URL (else TEST_DATABASE_URL)
#   scripts/backup-local.sh --test-database    # the database of TEST_DATABASE_URL
#   scripts/backup-local.sh --objects          # also copy every stored file (with either)
#
# Writes into BACKUP_DIR (default backups/, git-ignored), readable by the owner only:
#
#   <database>-<YYYYMMDDTHHMMSSZ>.dump          pg_dump -Fc of the whole database
#   <database>-<YYYYMMDDTHHMMSSZ>.dump.sha256   its SHA-256 (`sha256sum -c` reads it)
#   <database>-<YYYYMMDDTHHMMSSZ>.dump.lineage  the ancestor paths of the verified lineage at the
#                                              time of the dump (scripts/ops/lineage-digest.sql),
#                                              which scripts/restore-drill.sh checks
#   objects/<database>-<YYYYMMDDTHHMMSSZ>/      with --objects: every object the database points at,
#                                              each in its own store (SeaweedFS or the private
#                                              folders) and under its own key: evidence files,
#                                              passport certificates, profile and gallery photos,
#                                              school photos and logos, event posters
#                                              (scripts/lib/object-families.ts lists the families)
#
# Optional encryption: when BACKUP_AGE_RECIPIENT (an age public key, `age1…`, or several separated by
# spaces) is set and `age` is on PATH, the dump is written as <database>-<stamp>.dump.age (its
# .sha256 and .lineage files carry that name) and the object copy as objects/<database>-<stamp>.tar.age;
# no plaintext copy of either is kept. Without `age`, or without a recipient, the archive is plain
# (age is never required; with a recipient and no age, a warning says the archive is NOT encrypted).
# The private key never belongs on this machine: scripts/restore-drill.sh reads it from
# BACKUP_AGE_IDENTITY only when you give it.
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
      sed -n '2,34p' "$0"
      exit 0
      ;;
    *)
      echo "backup: unknown argument $arg (see --help)" >&2
      exit 2
      ;;
  esac
done

for name in DATABASE_URL TEST_DATABASE_URL BACKUP_DIR BACKUP_KEEP PG_CONTAINER BACKUP_AGE_RECIPIENT; do
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

# Optional encryption with age (https://age-encryption.org): only when a recipient is given AND age is there.
age_args=()
if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  if command -v age >/dev/null 2>&1; then
    # One -r per recipient (word splitting is the list separator); the public key is not a secret.
    # shellcheck disable=SC2086
    for recipient in $BACKUP_AGE_RECIPIENT; do age_args+=(-r "$recipient"); done
  else
    # DEFAULT review-2026-11: a recipient without age gives a plain archive and a loud warning, not a
    # failed backup (age is never required; docs/plan/questions/review-2026-11-safety-net.md, Q1).
    echo "backup: warning: BACKUP_AGE_RECIPIENT is set but age is not on PATH: this archive is NOT encrypted" >&2
  fi
fi
encrypt=0
[ "${#age_args[@]}" -gt 0 ] && encrypt=1

pg_target "$url"
pg_check_versions
database="$PG_URL_DB"
case "$database" in *[!A-Za-z0-9_-]*) echo "backup: the database name has characters a file name cannot carry" >&2; exit 2 ;; esac

umask 077
dir="${BACKUP_DIR:-backups}"
mkdir -p "$dir"
# The folder of the erasure ledger (src/server/erasure-ledger.ts), made here by the host user so that the
# Compose web service, which mounts it read-write, does not leave Docker to create it as root.
mkdir -p "$dir/erasures"
# The folder may be listed (the Compose web service reads the names and sizes for /admin/system,
# perhaps as another user id); every archive and evidence copy in it is the owner's alone (0600/0700).
chmod 755 "$dir" 2>/dev/null || true

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
while [ -e "$dir/$database-$stamp.dump" ] || [ -e "$dir/$database-$stamp.dump.age" ]; do
  sleep 1
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
done
name="$database-$stamp.dump"
file="$dir/$name"
partial="$file.partial"
objects_partial=""
# The plain copy of the objects while an encrypted archive is being made: removed on any exit that
# comes before it was encrypted (a full disk, a bad recipient key), so no plaintext copy stays behind.
objects_plain=""
cleanup() {
  rm -f "$partial" "$file.age.partial"
  [ -z "$objects_partial" ] || rm -f "$objects_partial"
  [ -z "$objects_plain" ] || rm -rf "$objects_plain"
}
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
if [ "$encrypt" -eq 1 ]; then
  # The plain dump never leaves $partial: it is encrypted to the .age file and removed.
  age "${age_args[@]}" -o "$file.age.partial" "$partial"
  rm -f "$partial"
  mv "$file.age.partial" "$file.age"
  name="$name.age"
  file="$file.age"
else
  mv "$partial" "$file"
fi
hash="$(sha256_of "$file")"
printf '%s  %s\n' "$hash" "$name" > "$file.sha256"
if [ -n "$lineage_digest" ]; then
  printf '%s\n' "$lineage_digest" > "$file.lineage"
else
  echo "backup: warning: the lineage kept changing during the dump; no .lineage file (the drill skips that comparison)"
fi
size="$(wc -c < "$file" | tr -d ' ')"
elapsed=$(($(date +%s) - started))
encrypted_note=""
[ "$encrypt" -eq 1 ] && encrypted_note=", encrypted with age"
echo "backup: wrote $file ($size bytes, $toc_data tables$encrypted_note) in ${elapsed}s; $(pg_describe)"
echo "backup: sha256 $hash"
[ -n "$lineage_digest" ] && echo "backup: lineage ${lineage_digest%% *} ancestor paths recorded"

objects_status=0
if [ "$objects" -eq 1 ]; then
  # Every object the database points at, from the store that holds it (scripts/lib/object-families.ts):
  # evidence files, passport certificates, profile and gallery photos, school photos and logos,
  # event posters. The list comes from the database, the files from the stores; a row whose object
  # is missing in its store fails the backup (the exit status says so, after the files are secured
  # and the retention below has run).
  out="$dir/objects/$database-$stamp"
  mkdir -p "$out"
  [ "$encrypt" -eq 0 ] || objects_plain="$out"
  objects_sql="$(pnpm -s exec tsx scripts/ops/evidence-objects.ts sql)"
  pg_tool psql -X -q -t -A -v ON_ERROR_STOP=1 -c "$objects_sql" |
    pnpm -s exec tsx scripts/ops/evidence-objects.ts copy --out "$out" || objects_status=$?
  if [ "$encrypt" -eq 1 ]; then
    # Even a copy with missing objects is encrypted first, so no plaintext copy stays behind.
    objects_partial="$out.tar.age.partial"
    tar -C "$out" -cf - . | age "${age_args[@]}" -o "$objects_partial"
    mv "$objects_partial" "$out.tar.age"
    objects_partial=""
    rm -rf "$out"
    objects_plain=""
    echo "backup: wrote $out.tar.age (the object copy, encrypted with age)"
  fi
fi

# Retention: the newest $keep dumps of this database; older ones go with their files.
mapfile -t dumps < <(find "$dir" -maxdepth 1 -type f \( -name "$database-*.dump" -o -name "$database-*.dump.age" \) -print | sed 's|.*/||' |
  grep -E "^$database-[0-9]{8}T[0-9]{6}Z\\.dump(\\.age)?\$" | sort -r)
removed=0
for old in "${dumps[@]:$keep}"; do
  rm -f "$dir/$old" "$dir/$old.sha256" "$dir/$old.lineage"
  stem="${old%.age}"
  stem="${stem%.dump}"
  rm -rf "${dir:?}/objects/$stem" "${dir:?}/objects/$stem.tar.age"
  removed=$((removed + 1))
done
kept=$((${#dumps[@]} - removed))
if [ "$removed" -gt 0 ]; then
  echo "backup: $kept of at most $keep archives of $database kept; removed $removed older"
else
  echo "backup: $kept of at most $keep archives of $database kept"
fi
if [ "$objects_status" -ne 0 ]; then
  echo "backup: the object copy failed or is incomplete (see above); the dump itself was written" >&2
  exit 1
fi
