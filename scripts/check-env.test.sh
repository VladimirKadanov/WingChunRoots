#!/usr/bin/env bash
# Tests of scripts/check-env.sh (milestone M12, Done when 2; run by scripts/verify.d/M12.sh): a
# missing required setting, an empty one, the example value of .env.example or a placeholder stops
# the start, and the message never shows a value. Every case runs in an empty environment
# (env -i), with throwaway values made here.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT/scripts/check-env.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

passed=0
failed=0
pass() {
  echo "ok   $1"
  passed=$((passed + 1))
}
fail() {
  echo "FAIL $1"
  failed=$((failed + 1))
}

rand() { od -An -N16 -tx1 /dev/urandom | tr -d ' \n'; }
SECRET="$(rand)"
WEB_ENV=(
  "DATABASE_URL=postgres://app@db.invalid:5432/wingchunroots"
  "DB_APP_RW_PASSWORD=$(rand)"
  "DB_APP_PUBLIC_RO_PASSWORD=$(rand)"
  "APP_URL=http://localhost:3000"
  "BETTER_AUTH_SECRET=$SECRET"
  "IP_HMAC_KEY=$(rand)"
  "MAIL_SEAL_KEY=$(rand)"
)
# An example file whose example values are not empty, like a future .env.example could be.
cat > "$TMP/example" <<'EOF'
# comment
APP_URL=http://localhost:3000
IP_HMAC_KEY=00000000000000000000000000000000
MAIL_SEAL_KEY=
EOF
EMPTY_DOTENV="$TMP/no-dotenv"

# run <expected status> <description> <mode> [NAME=value...]: check-env in an empty environment.
run() {
  local expected="$1" description="$2" mode="$3"
  shift 3
  local out status
  out="$(env -i PATH="$PATH" CHECK_ENV_EXAMPLE="${EXAMPLE_FILE:-$ROOT/.env.example}" CHECK_ENV_DOTENV="${DOTENV_FILE:-$EMPTY_DOTENV}" \
    "$@" bash "$CHECK" "$mode" 2>&1)"
  status=$?
  LAST_OUT="$out"
  if [ "$status" -eq "$expected" ]; then pass "$description"; else
    fail "$description (exit $status, expected $expected)"
    printf '%s\n' "$out" | sed 's/^/     /'
  fi
}
without() { # without <NAME> <NAME=value...>: the list without NAME
  local name="$1" item
  shift
  for item in "$@"; do [ "${item%%=*}" = "$name" ] || printf '%s\n' "$item"; done
}
mapfile -t WEB_NO_SECRET < <(without BETTER_AUTH_SECRET "${WEB_ENV[@]}")

run 0 "web: every required setting set" web "${WEB_ENV[@]}"
run 0 "web: the repository's .env.example has no example a real value could equal by accident" web "${WEB_ENV[@]}"

run 1 "web: a missing BETTER_AUTH_SECRET stops the start" web "${WEB_NO_SECRET[@]}"
case "$LAST_OUT" in *"missing or empty: BETTER_AUTH_SECRET"*) pass "the message names the missing setting" ;; *) fail "the message names the missing setting" ;; esac

run 1 "web: an empty BETTER_AUTH_SECRET stops the start" web "${WEB_NO_SECRET[@]}" "BETTER_AUTH_SECRET="

EXAMPLE_FILE="$TMP/example" run 1 "web: a value left as the example of .env.example stops the start" web "${WEB_ENV[@]}" \
  "IP_HMAC_KEY=00000000000000000000000000000000" "APP_URL=http://127.0.0.1:3000"
case "$LAST_OUT" in *"still the example value of .env.example: IP_HMAC_KEY"*) pass "the message names the example setting" ;; *) fail "the message names the example setting" ;; esac
EXAMPLE_FILE="$TMP/example" run 0 "web: a value other than the example passes, and an empty example refuses nothing" web \
  "${WEB_ENV[@]}" "APP_URL=http://127.0.0.1:3000"
EXAMPLE_FILE="$TMP/example" run 1 "web: APP_URL equal to its non-empty example stops the start" web "${WEB_ENV[@]}"

for placeholder in changeme "<your secret>" your-secret-here REPLACE-ME xxxxxxxx; do
  run 1 "web: the placeholder '$placeholder' stops the start" web "${WEB_NO_SECRET[@]}" "BETTER_AUTH_SECRET=$placeholder"
done

run 1 "web: S3_ENDPOINT without the S3 credentials stops the start" web "${WEB_ENV[@]}" "S3_ENDPOINT=http://seaweedfs:8333"
run 0 "web: S3_ENDPOINT with the S3 credentials" web "${WEB_ENV[@]}" "S3_ENDPOINT=http://seaweedfs:8333" \
  "S3_ACCESS_KEY_ID=$(rand)" "S3_SECRET_ACCESS_KEY=$(rand)"

run 0 "worker: its own required settings" worker "DATABASE_URL=postgres://app@db.invalid/wingchunroots" \
  "DB_APP_RW_PASSWORD=$(rand)" "APP_URL=http://localhost:3000" "MAIL_SEAL_KEY=$(rand)"
run 1 "worker: a missing MAIL_SEAL_KEY stops the start" worker "DATABASE_URL=postgres://app@db.invalid/wingchunroots" \
  "DB_APP_RW_PASSWORD=$(rand)" "APP_URL=http://localhost:3000"
run 0 "migrate: DATABASE_URL" migrate "DATABASE_URL=postgres://migrator:$(rand)@db.invalid/wingchunroots"
run 1 "migrate: no DATABASE_URL stops the migration" migrate

# compose: the environment first, then .env.
COMPOSE_VALUES=(
  "POSTGRES_PASSWORD=$(rand)" "DB_MIGRATOR_PASSWORD=$(rand)" "DB_APP_RW_PASSWORD=$(rand)" "DB_APP_PUBLIC_RO_PASSWORD=$(rand)"
  "BETTER_AUTH_SECRET=$SECRET" "IP_HMAC_KEY=$(rand)" "MAIL_SEAL_KEY=$(rand)" "S3_ACCESS_KEY_ID=$(rand)" "S3_SECRET_ACCESS_KEY=$(rand)"
)
printf '%s\r\n' "${COMPOSE_VALUES[@]}" > "$TMP/dotenv"
DOTENV_FILE="$TMP/dotenv" run 0 "compose: every setting from .env (CRLF endings too)" compose
grep -v '^MAIL_SEAL_KEY=' "$TMP/dotenv" > "$TMP/dotenv-missing"
DOTENV_FILE="$TMP/dotenv-missing" run 1 "compose: a setting missing from .env stops the start" compose
DOTENV_FILE="$TMP/dotenv-missing" run 0 "compose: the environment supplies what .env lacks" compose "MAIL_SEAL_KEY=$(rand)"
DOTENV_FILE="$TMP/dotenv" run 1 "compose: an empty value in the environment wins over .env" compose "MAIL_SEAL_KEY="

# Never a value in the output.
out="$(env -i PATH="$PATH" CHECK_ENV_DOTENV="$EMPTY_DOTENV" "${WEB_NO_SECRET[@]}" "BETTER_AUTH_SECRET=changeme-$SECRET" \
  "MAIL_SEAL_KEY=$SECRET" bash "$CHECK" web 2>&1)"
case "$out" in *"$SECRET"* | *changeme*) fail "the output never shows a value" ;; *) pass "the output never shows a value" ;; esac

out="$(env -i PATH="$PATH" bash "$CHECK" nonsense 2>&1)"
[ $? -eq 2 ] && pass "an unknown mode is a usage error (exit 2)" || fail "an unknown mode is a usage error (exit 2)"

echo "check-env.test: $passed passed, $failed failed"
[ "$failed" -eq 0 ]
