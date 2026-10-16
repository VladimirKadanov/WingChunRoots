# scripts/lib/psql.sh — psql helpers shared by the bash scripts (sourced, never run on its own).
#
#   psql_check_version   fails with a hint unless the psql on PATH is 15 or newer
#   psql_url <url> ...   psql against <url>, the password passed through PGPASSWORD
#   dotenv_value <name>  the last value of <name> in .env, without quotes or a CRLF ending

# scripts/db-bootstrap.sql reads the role passwords with \getenv, which psql 15 added.
PSQL_MIN_MAJOR=15

# The major version of the psql client on PATH, or 0 when it cannot be read.
psql_major() {
  local major
  major="$(psql --version 2>/dev/null | sed -nE 's/^[^0-9]*([0-9]+).*/\1/p' | head -n 1)"
  echo "${major:-0}"
}

psql_check_version() {
  local major
  major="$(psql_major)"
  if [ "$major" -lt "$PSQL_MIN_MAJOR" ]; then
    echo "psql $major is too old: scripts/db-bootstrap.sql needs psql $PSQL_MIN_MAJOR or newer (\\getenv)." >&2
    echo "  WSL2/Ubuntu 24.04: sudo apt-get install -y postgresql-client (psql 16)." >&2
    echo "  Ubuntu 22.04 ships psql 14: install postgresql-client-16 from the PostgreSQL apt" >&2
    echo "  repository (https://www.postgresql.org/download/linux/ubuntu/), or move to Ubuntu 24.04." >&2
    echo "  Only to bootstrap a Compose database (pnpm test:int and db:check still need a host psql 15+):" >&2
    echo "    set -a; . ./.env; set +a" >&2
    echo "    docker compose exec -T -e DB_MIGRATOR_PASSWORD -e DB_APP_RW_PASSWORD -e DB_APP_PUBLIC_RO_PASSWORD \\" >&2
    echo "      postgres psql -U \"\$POSTGRES_USER\" -d <database> -X -v ON_ERROR_STOP=1 -f - < scripts/db-bootstrap.sql" >&2
    return 1
  fi
}

# psql_url <url> [psql arguments...]: the password never goes on the command line, where every
# local user can read it (ps, /proc/<pid>/cmdline); libpq takes it from PGPASSWORD instead.
psql_url() {
  local url="$1"
  shift
  local bare password
  bare="$(WCR_PSQL_URL="$url" node -e '
    const u = new URL(process.env.WCR_PSQL_URL);
    u.password = "";
    process.stdout.write(u.toString());')" || return 2
  password="$(WCR_PSQL_URL="$url" node -e '
    process.stdout.write(decodeURIComponent(new URL(process.env.WCR_PSQL_URL).password));')" || return 2
  if [ -n "$password" ]; then
    PGPASSWORD="$password" psql "$bare" "$@"
  else
    psql "$bare" "$@"
  fi
}

# dotenv_value <name>: the last `<name>=value` line of .env, without surrounding quotes and
# without the carriage return a Windows editor leaves (Node's process.loadEnvFile strips it
# too, so the scripts and the application read the same value).
dotenv_value() {
  [ -f .env ] || return 0
  sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '\r' | sed -e "s/^['\"]//" -e "s/['\"]$//"
}
