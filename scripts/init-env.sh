#!/usr/bin/env bash
# Creates .env for local development from .env.example (plan §7.7): local-only random
# passwords and keys, default ports, and the database URLs that match docker-compose.yml.
# Never overwrites an existing .env unless --force is given.
#
# Usage: scripts/init-env.sh [--force]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f .env ] && [ "${1:-}" != "--force" ]; then
  echo "init-env: .env already exists; keeping it (use --force to regenerate)." >&2
  exit 0
fi

random_hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }

pg_user=postgres
pg_password="$(random_hex 16)"
pg_port=5432

s3_access_key="wcr$(random_hex 8)"
s3_secret_key="$(random_hex 20)"

# Portable lookup (macOS ships bash 3.2, which has no associative arrays).
value_for() {
  case "$1" in
    NEXT_TELEMETRY_DISABLED) echo 1 ;;
    POSTGRES_USER) echo "$pg_user" ;;
    POSTGRES_PASSWORD) echo "$pg_password" ;;
    POSTGRES_DB) echo wingchunroots ;;
    POSTGRES_PORT) echo "$pg_port" ;;
    DATABASE_URL) echo "postgres://${pg_user}:${pg_password}@127.0.0.1:${pg_port}/wingchunroots" ;;
    TEST_DATABASE_URL) echo "postgres://${pg_user}:${pg_password}@127.0.0.1:${pg_port}/wingchunroots_test" ;;
    MAILPIT_SMTP_PORT) echo 1025 ;;
    MAILPIT_UI_PORT) echo 8025 ;;
    S3_PORT) echo 8333 ;;
    S3_ACCESS_KEY_ID) echo "$s3_access_key" ;;
    S3_SECRET_ACCESS_KEY) echo "$s3_secret_key" ;;
    S3_BUCKET_EVIDENCE) echo wcr-evidence ;;
    S3_BUCKET_MEDIA) echo wcr-media ;;
    E2E_PORT) echo 3100 ;;
    *) return 1 ;;
  esac
}

umask 077
tmp="$(mktemp .env.XXXXXX)"
while IFS= read -r line || [ -n "$line" ]; do
  if [[ "$line" =~ ^([A-Z0-9_]+)=$ ]] && value="$(value_for "${BASH_REMATCH[1]}")"; then
    printf '%s=%s\n' "${BASH_REMATCH[1]}" "$value"
  else
    printf '%s\n' "$line"
  fi
done < .env.example > "$tmp"
mv "$tmp" .env
echo "init-env: wrote .env with local-only values. Next: docker compose up -d --wait" >&2
