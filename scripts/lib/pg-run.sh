# scripts/lib/pg-run.sh — runs the PostgreSQL client tools (psql, pg_dump, pg_restore) of the
# same major version as the server, for scripts/backup-local.sh and scripts/restore-drill.sh
# (milestone M12; sourced, never run on its own).
#
# pg_dump refuses a server newer than itself (pg_dump 16 against PostgreSQL 18), and pg_restore
# cannot read an archive made by a newer pg_dump. So the tools run where the server's own are:
#
#   container mode  inside the database container, through `docker exec` (local Docker Compose
#                   and CI): PG_CONTAINER names the container (CI: the service container's id);
#                   without it, the running Compose `postgres` service is used when there is one.
#   host mode       the tools on PATH (the cloud session: PostgreSQL 16 client and server).
#
#   pg_target <url>            reads the URL into PG_URL_* (the password never reaches a command
#                              line: libpq takes it from PGPASSWORD) and picks the mode
#   pg_tool <tool> [args...]   runs psql, pg_dump or pg_restore against the target database
#   pg_tool_on <db> <tool> ... the same against another database of the same server
#   pg_copy_in <file> <name>   container mode: copies a file into the container, prints its path
#   pg_check_versions          fails unless the tools' major version is the server's
#
# Inside a container the server is reached on 127.0.0.1 at PG_CONTAINER_PORT (default 5432), with
# the URL's user and password: the host port of the URL (POSTGRES_PORT) is only the host's mapping.

PG_MODE=""
PG_CONTAINER_ID=""

# pg_target <url>: sets PG_URL_HOST, PG_URL_PORT, PG_URL_USER, PG_URL_PASSWORD, PG_URL_DB and the mode.
pg_target() {
  local url="$1" parts
  parts="$(WCR_PG_URL="$url" node -e '
    const u = new URL(process.env.WCR_PG_URL);
    const d = (s) => decodeURIComponent(s);
    const host = u.searchParams.get("host") || u.hostname.replace(/^\[|\]$/g, "") || "localhost";
    process.stdout.write([host, u.port || "5432", d(u.username), d(u.password), d(u.pathname.replace(/^\//, ""))].join("\n") + "\n");
  ')" || {
    echo "pg-run: the database URL cannot be read" >&2
    return 2
  }
  {
    IFS= read -r PG_URL_HOST
    IFS= read -r PG_URL_PORT
    IFS= read -r PG_URL_USER
    IFS= read -r PG_URL_PASSWORD
    IFS= read -r PG_URL_DB
  } <<< "$parts"
  if [ -z "$PG_URL_DB" ]; then
    echo "pg-run: the database URL names no database" >&2
    return 2
  fi
  pg_pick_mode
}

pg_pick_mode() {
  if [ -n "${PG_CONTAINER:-}" ]; then
    PG_MODE=container
    PG_CONTAINER_ID="$PG_CONTAINER"
    return 0
  fi
  if command -v docker >/dev/null 2>&1; then
    local id
    id="$(docker compose ps -q postgres 2>/dev/null | head -n 1 || true)"
    if [ -n "$id" ]; then
      PG_MODE=container
      PG_CONTAINER_ID="$id"
      return 0
    fi
  fi
  PG_MODE=host
}

# pg_tool_on <database> <tool> [args...]
pg_tool_on() {
  local database="$1" tool="$2"
  shift 2
  case "$tool" in psql | pg_dump | pg_restore) ;; *)
    echo "pg-run: unknown tool $tool" >&2
    return 2
    ;;
  esac
  if [ "$PG_MODE" = container ]; then
    # `-e NAME` without a value copies the variable from this process: nothing on a command line.
    PGHOST=127.0.0.1 PGPORT="${PG_CONTAINER_PORT:-5432}" PGUSER="$PG_URL_USER" PGPASSWORD="$PG_URL_PASSWORD" \
      PGDATABASE="$database" PGCONNECT_TIMEOUT=10 \
      docker exec -i -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGCONNECT_TIMEOUT \
      "$PG_CONTAINER_ID" "$tool" "$@"
  else
    PGHOST="$PG_URL_HOST" PGPORT="$PG_URL_PORT" PGUSER="$PG_URL_USER" PGPASSWORD="$PG_URL_PASSWORD" \
      PGDATABASE="$database" PGCONNECT_TIMEOUT=10 "$tool" "$@"
  fi
}

pg_tool() {
  pg_tool_on "$PG_URL_DB" "$@"
}

# pg_copy_in <file> <name>: the file inside the container (container mode), or the file itself.
pg_copy_in() {
  local file="$1" name="$2"
  if [ "$PG_MODE" = container ]; then
    docker cp -q "$file" "$PG_CONTAINER_ID:/tmp/$name" >/dev/null || return 1
    echo "/tmp/$name"
  else
    echo "$file"
  fi
}

# pg_remove_copy <path>: removes what pg_copy_in put into the container.
pg_remove_copy() {
  [ "$PG_MODE" = container ] || return 0
  docker exec "$PG_CONTAINER_ID" rm -f "$1" >/dev/null 2>&1 || true
}

pg_tool_major() {
  local out
  if [ "$PG_MODE" = container ]; then
    out="$(docker exec "$PG_CONTAINER_ID" "$1" --version 2>/dev/null)"
  else
    out="$("$1" --version 2>/dev/null)"
  fi
  echo "$out" | sed -nE 's/^[^0-9]*([0-9]+).*/\1/p' | head -n 1
}

pg_server_major() {
  local num
  num="$(pg_tool psql -X -q -t -A -c 'SHOW server_version_num' 2>/dev/null | tr -d '[:space:]')"
  [ -n "$num" ] && echo $((num / 10000))
}

pg_check_versions() {
  local server tool major
  if [ "$PG_MODE" = host ]; then
    for tool in psql pg_dump pg_restore; do
      command -v "$tool" >/dev/null 2>&1 || {
        echo "pg-run: $tool not found on PATH, and no database container (set PG_CONTAINER or start docker compose)" >&2
        return 1
      }
    done
  fi
  server="$(pg_server_major)"
  if [ -z "$server" ]; then
    echo "pg-run: the database does not answer ($PG_MODE mode)" >&2
    return 1
  fi
  for tool in pg_dump pg_restore; do
    major="$(pg_tool_major "$tool")"
    if [ "$major" != "$server" ]; then
      echo "pg-run: $tool ${major:-?} does not match the server (PostgreSQL $server)." >&2
      echo "  Locally and in CI the tools run inside the database container: start docker compose, or set PG_CONTAINER." >&2
      return 1
    fi
  done
  PG_SERVER_MAJOR="$server"
}

pg_describe() {
  if [ "$PG_MODE" = container ]; then
    echo "PostgreSQL ${PG_SERVER_MAJOR:-?}, tools inside the database container"
  else
    echo "PostgreSQL ${PG_SERVER_MAJOR:-?}, tools on the host"
  fi
}

# sha256_of <file>: the lower-case hex SHA-256 (sha256sum, shasum, or Node).
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    WCR_FILE="$1" node -e '
      const h = require("node:crypto").createHash("sha256");
      require("node:fs").createReadStream(process.env.WCR_FILE).on("data", (c) => h.update(c)).on("end", () => console.log(h.digest("hex")));'
  fi
}
