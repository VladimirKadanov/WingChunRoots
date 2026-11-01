#!/bin/sh
# Entrypoint of the application image (milestone M12; Dockerfile): checks the settings of the
# command with scripts/check-env.sh, then replaces itself with the process, so that it receives
# the container's signals (Compose runs it under an init: `init: true`).
#
#   web      the Next.js standalone server on $PORT (3000)
#   worker   the pg-boss worker
#   migrate  the migrations and the pg-boss schema (DATABASE_URL as migrator), then exits
set -eu

command="${1:-web}"
case "$command" in
  web | worker | migrate) ;;
  *)
    echo "usage: <web|worker|migrate> (got: $command)" >&2
    exit 2
    ;;
esac

/app/scripts/check-env.sh "$command"

case "$command" in
  web)
    cd /app/web
    exec node server.js
    ;;
  worker)
    cd /app/ops
    exec node --import tsx src/worker.ts
    ;;
  migrate)
    cd /app/ops
    exec node --import tsx src/server/db/cli.ts migrate
    ;;
esac
