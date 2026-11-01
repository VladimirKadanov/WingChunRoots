#!/usr/bin/env bash
# scripts/check-env.sh <web|worker|migrate|compose> — stops a start when a required setting is
# missing or still the example (milestone M12; plan §7.7).
#
#   web, worker, migrate   run by the image's entrypoint (docker/app/entrypoint.sh) before the
#                          process starts, against the container's environment
#   compose                run on the host before `docker compose --profile app up`: the settings
#                          docker-compose.yml needs, from the environment, then from .env
#
# A setting fails when it is missing or empty, when it is the value .env.example gives as the
# example (CHECK_ENV_EXAMPLE, default .env.example beside scripts/), or when it is an obvious
# placeholder (changeme, <...>, your-..., and the like). The message names the settings, never a
# value. Exit status: 0 when every setting is in order, 1 when one is not, 2 on a usage error.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLE="${CHECK_ENV_EXAMPLE:-$ROOT/.env.example}"
DOTENV="${CHECK_ENV_DOTENV:-$ROOT/.env}"

WEB=(DATABASE_URL DB_APP_RW_PASSWORD DB_APP_PUBLIC_RO_PASSWORD APP_URL BETTER_AUTH_SECRET IP_HMAC_KEY MAIL_SEAL_KEY)
WORKER=(DATABASE_URL DB_APP_RW_PASSWORD APP_URL MAIL_SEAL_KEY)
MIGRATE=(DATABASE_URL)
COMPOSE=(POSTGRES_PASSWORD DB_MIGRATOR_PASSWORD DB_APP_RW_PASSWORD DB_APP_PUBLIC_RO_PASSWORD
  BETTER_AUTH_SECRET IP_HMAC_KEY MAIL_SEAL_KEY S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY)
# With an S3 endpoint the evidence store needs its credentials too (src/server/storage).
S3_KEYS=(S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY)

mode="${1:-}"
case "$mode" in
  web) required=("${WEB[@]}") ;;
  worker) required=("${WORKER[@]}") ;;
  migrate) required=("${MIGRATE[@]}") ;;
  compose) required=("${COMPOSE[@]}") ;;
  *)
    echo "usage: scripts/check-env.sh <web|worker|migrate|compose>" >&2
    exit 2
    ;;
esac

# file_value <file> <name>: the last `<name>=value` line, without quotes or a CRLF ending; exit 1
# when the file has no such line.
file_value() {
  [ -f "$1" ] || return 1
  local line
  line="$(grep -E "^$2=" "$1" | tail -n 1)" || return 1
  line="${line#*=}"
  line="${line%$'\r'}"
  line="${line#[\"\']}"
  line="${line%[\"\']}"
  printf '%s' "$line"
}

# value <name>: the environment's value; in compose mode, else the value in .env.
value() {
  if [ -n "${!1+set}" ]; then
    printf '%s' "${!1}"
  elif [ "$mode" = compose ]; then
    file_value "$DOTENV" "$1" || true
  fi
}

is_placeholder() {
  local v
  v="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$v" in
    '<'*'>' | changeme | change-me | change_me | replaceme | replace-me | replace_me | todo | tbd | xxx* | '...' | \
      example | secret | password | your-* | your_* | *changeme* | *replace-me* | *replace_me*) return 0 ;;
  esac
  return 1
}

if [ -n "$(value S3_ENDPOINT)" ] && [ "$mode" != migrate ]; then
  for key in "${S3_KEYS[@]}"; do
    case " ${required[*]} " in *" $key "*) ;; *) required+=("$key") ;; esac
  done
fi

missing=()
example=()
placeholder=()
for name in "${required[@]}"; do
  v="$(value "$name")"
  if [ -z "$v" ]; then
    missing+=("$name")
    continue
  fi
  if e="$(file_value "$EXAMPLE" "$name")" && [ -n "$e" ] && [ "$v" = "$e" ]; then
    example+=("$name")
  elif is_placeholder "$v"; then
    placeholder+=("$name")
  fi
done

if [ "${#missing[@]}" -eq 0 ] && [ "${#example[@]}" -eq 0 ] && [ "${#placeholder[@]}" -eq 0 ]; then
  echo "check-env: $mode: ${#required[@]} required settings are set"
  exit 0
fi
echo "check-env: $mode: refusing to start." >&2
[ "${#missing[@]}" -gt 0 ] && echo "  missing or empty: ${missing[*]}" >&2
[ "${#example[@]}" -gt 0 ] && echo "  still the example value of .env.example: ${example[*]}" >&2
[ "${#placeholder[@]}" -gt 0 ] && echo "  a placeholder, not a real value: ${placeholder[*]}" >&2
echo "  Local values: scripts/init-env.sh writes .env (docs/operations/local-run.md)." >&2
exit 1
