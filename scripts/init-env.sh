#!/usr/bin/env bash
# Creates .env for local development from .env.example (plan §7.7): local-only random
# passwords and keys, default ports, and the database URLs that match docker-compose.yml.
# Never overwrites an existing .env unless --force is given; it only appends the role passwords
# (M01), MAIL_TRANSPORT (M01b) and the account settings (M02) when an older .env lacks them.
#
# Usage: scripts/init-env.sh [--force]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f .env ] && [ "${1:-}" = "--force" ]; then
  echo "init-env: --force: regenerating .env with NEW passwords and keys." >&2
  echo "  An existing Compose volume keeps the passwords of its first start, so the new .env" >&2
  echo "  will not match it. Recreate the volumes (deletes local data):" >&2
  echo "    docker compose down -v && docker compose up -d --wait" >&2
fi

random_hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
# $1 base32 characters (RFC 4648 alphabet), 5 random bits each: 256 is a multiple of 32.
random_base32() {
  local alphabet=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567 b
  for b in $(od -An -N"$1" -tu1 /dev/urandom); do printf '%s' "${alphabet:$((b % 32)):1}"; done
}

pg_user=postgres
pg_password="$(random_hex 16)"
pg_port=5432

db_migrator_password="$(random_hex 16)"
db_app_rw_password="$(random_hex 16)"
db_app_public_ro_password="$(random_hex 16)"

s3_access_key="wcr$(random_hex 8)"
s3_secret_key="$(random_hex 20)"

# Accounts (M02): the Better Auth secret, the ip_hmac key and the test-only credentials of the
# seeded demo accounts. The TOTP secret is base32 (32 characters = 160 bits, RFC 4226).
better_auth_secret="$(random_hex 32)"
ip_hmac_key="$(random_hex 32)"
e2e_password="wcr-$(random_hex 12)"
e2e_totp_secret="$(random_base32 32)"

# Portable lookup (macOS ships bash 3.2, which has no associative arrays).
value_for() {
  case "$1" in
    NEXT_TELEMETRY_DISABLED) echo 1 ;;
    POSTGRES_USER) echo "$pg_user" ;;
    POSTGRES_PASSWORD) echo "$pg_password" ;;
    POSTGRES_PORT) echo "$pg_port" ;;
    DATABASE_URL) echo "postgres://${pg_user}:${pg_password}@127.0.0.1:${pg_port}/wingchunroots" ;;
    TEST_DATABASE_URL) echo "postgres://${pg_user}:${pg_password}@127.0.0.1:${pg_port}/wingchunroots_test" ;;
    DB_MIGRATOR_PASSWORD) echo "$db_migrator_password" ;;
    DB_APP_RW_PASSWORD) echo "$db_app_rw_password" ;;
    DB_APP_PUBLIC_RO_PASSWORD) echo "$db_app_public_ro_password" ;;
    MAILPIT_SMTP_PORT) echo 1025 ;;
    MAILPIT_UI_PORT) echo 8025 ;;
    MAIL_TRANSPORT) echo smtp ;;
    S3_PORT) echo 8333 ;;
    S3_ACCESS_KEY_ID) echo "$s3_access_key" ;;
    S3_SECRET_ACCESS_KEY) echo "$s3_secret_key" ;;
    S3_BUCKET_EVIDENCE) echo wcr-evidence ;;
    S3_BUCKET_MEDIA) echo wcr-media ;;
    E2E_PORT) echo 3100 ;;
    APP_URL) echo http://localhost:3000 ;;
    BETTER_AUTH_SECRET) echo "$better_auth_secret" ;;
    IP_HMAC_KEY) echo "$ip_hmac_key" ;;
    E2E_PASSWORD) echo "$e2e_password" ;;
    E2E_TOTP_SECRET) echo "$e2e_totp_secret" ;;
    *) return 1 ;;
  esac
}

umask 077

# An existing .env is kept. Variables added to .env.example since it was written, and whose
# value depends on nothing else in it (the database role passwords of M01, the mail transport of
# M01b, the account settings of M02), are appended.
if [ -f .env ] && [ "${1:-}" != "--force" ]; then
  added=()
  for name in DB_MIGRATOR_PASSWORD DB_APP_RW_PASSWORD DB_APP_PUBLIC_RO_PASSWORD MAIL_TRANSPORT \
    APP_URL BETTER_AUTH_SECRET IP_HMAC_KEY E2E_PASSWORD E2E_TOTP_SECRET; do
    if grep -q "^${name}=$" .env.example && ! grep -q "^${name}=" .env; then
      # Keep the last existing line intact when the file does not end with a newline.
      [ -z "$(tail -c 1 .env)" ] || echo >> .env
      printf '%s=%s\n' "$name" "$(value_for "$name")" >> .env
      added+=("$name")
    fi
  done
  if [ "${#added[@]}" -gt 0 ]; then
    echo "init-env: .env already exists; added ${added[*]} (a new role password needs scripts/db-bootstrap.sh)." >&2
  else
    echo "init-env: .env already exists; keeping it (use --force to regenerate)." >&2
  fi
  exit 0
fi

tmp="$(mktemp .env.XXXXXX)"
while IFS= read -r line || [ -n "$line" ]; do
  if [[ "$line" =~ ^([A-Z0-9_]+)=$ ]] && value="$(value_for "${BASH_REMATCH[1]}")"; then
    printf '%s=%s\n' "${BASH_REMATCH[1]}" "$value"
  else
    printf '%s\n' "$line"
  fi
done < .env.example > "$tmp"
mv "$tmp" .env
echo "init-env: wrote .env with local-only values. Next: docker compose up -d --wait," >&2
echo "  then scripts/db-bootstrap.sh (database roles), pnpm db:migrate and pnpm db:seed" >&2
