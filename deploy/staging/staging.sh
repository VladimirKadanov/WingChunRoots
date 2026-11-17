#!/usr/bin/env bash
# The password-protected staging server (docs/operations/staging.md, ADR 0033). Run as `deploy`
# from the repository on the server, after deploy/staging/setup-server.sh:
#
#   deploy/staging/staging.sh init [<server-ip>]   once: .env, the site password, the address
#   deploy/staging/staging.sh deploy [<commit>]    run a version (default: the newest main)
#   deploy/staging/staging.sh seed-demo            stage 1: demo data and every kind of account
#   deploy/staging/staging.sh clean-start          stage 2: delete everything, start an empty database
#   deploy/staging/staging.sh make-admin <e-mail>  an account that signed up and turned on TOTP becomes admin
#   deploy/staging/staging.sh password             change the site password
#   deploy/staging/staging.sh backup               archive now (database + files), then the off-site copy
#   deploy/staging/staging.sh install-cron         a nightly archive at 02:30 (server time)
#   deploy/staging/staging.sh demo-logins          how to sign in with the demo accounts
#   deploy/staging/staging.sh status | logs [<service>]
#
# It never prints a secret: passwords and keys stay in .env and .staging/ (both git-ignored, 0600).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
ROOT="$(pwd)"
IMAGE_REPO="${WCR_IMAGE_REPO:-ghcr.io/vladimirkadanov/wingchunroots}"
CADDY_IMAGE="$(sed -nE 's/^[[:space:]]*image:[[:space:]]*(caddy:[^[:space:]]+).*/\1/p' deploy/staging/compose.staging.yml)"
COMPOSE=(docker compose -f docker-compose.yml -f deploy/staging/compose.staging.yml --profile app)

log() { printf 'staging: %s\n' "$*"; }
die() { printf 'staging: error: %s\n' "$*" >&2; exit 1; }
dc() { "${COMPOSE[@]}" "$@"; }

get_env() { [ -f .env ] && sed -n "s/^$1=//p" .env | tail -n 1 || true; }
set_env() {
  local key="$1" value="$2"
  case "$value" in *'|'* | *$'\n'*) die "unsupported character in the value of $key" ;; esac
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

need_env() { [ -f .env ] || die "no .env yet: run deploy/staging/staging.sh init first"; }
backup_dir() { local d; d="$(get_env BACKUP_DIR)"; printf '%s' "${d:-backups}"; }

wait_healthy() {
  local i
  for i in $(seq 1 90); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$(get_env APP_PORT | grep . || echo 3000)/healthz"; then
      log "the app answers /healthz"
      return 0
    fi
    sleep 2
  done
  dc ps -a
  dc logs --no-color --tail 80 migrate web worker
  die "the app did not become healthy in 3 minutes (logs above)"
}

write_password() {
  local user pass pass2 hash
  read -rp "Site user name [wcr]: " user
  user="${user:-wcr}"
  [[ "$user" =~ ^[A-Za-z0-9._-]+$ ]] || die "the user name may use letters, digits, . _ - only"
  read -rsp "Site password (12+ characters): " pass; echo
  read -rsp "Again: " pass2; echo
  [ "$pass" = "$pass2" ] || die "the passwords differ"
  [ "${#pass}" -ge 12 ] || die "use at least 12 characters"
  # Read from stdin, so the password is never on a command line.
  hash="$(printf '%s\n' "$pass" | docker run --rm -i "$CADDY_IMAGE" caddy hash-password --algorithm bcrypt 2>/dev/null | tail -n 1)"
  [[ "$hash" == '$2'* ]] || die "caddy hash-password did not return a bcrypt hash"
  install -d -m 0700 .staging
  umask 077
  printf 'basic_auth {\n\t%s %s\n}\n' "$user" "$hash" > .staging/auth.caddy
  log "site password saved (.staging/auth.caddy holds only its bcrypt hash)"
}

cmd_init() {
  command -v docker >/dev/null || die "Docker is missing: run deploy/staging/setup-server.sh as root first"
  docker info >/dev/null 2>&1 || die "this user cannot use Docker (log out and in again after setup-server.sh)"
  [ "$(node -v)" = "v$(tr -d ' \nv' < .nvmrc)" ] || die "Node $(cat .nvmrc) is needed (setup-server.sh installs it)"
  local ip="${1:-}" host
  if [ -z "$ip" ]; then
    ip="$(hostname -I | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' \
      | grep -Ev '^(10|127|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\.' | head -n 1 || true)"
  fi
  [[ "$ip" =~ ^[0-9]+(\.[0-9]+){3}$ ]] || die "give the server's public IPv4 address: staging.sh init <ip>"
  host="${ip//./-}.sslip.io"

  if [ ! -f .env ]; then
    scripts/init-env.sh >/dev/null
    log ".env created with new random passwords and keys"
  fi
  chmod 600 .env
  set_env STAGING_HOST "$host"
  set_env APP_URL "https://${host}"
  set_env MAIL_TRANSPORT smtp
  install -d "$(backup_dir)/erasures"

  if [ ! -s .staging/auth.caddy ]; then write_password; fi

  if [ -z "$(get_env BACKUP_AGE_RECIPIENT)" ]; then
    log "archives are encrypted with age when BACKUP_AGE_RECIPIENT is set. Create the key on your PC"
    log "(age-keygen -o wcr-age-key.txt; keep that file in your password manager, never on the server)."
    read -rp "Public key (age1..., empty to skip for now): " recipient
    if [ -n "$recipient" ]; then
      [[ "$recipient" =~ ^age1[0-9a-z]+$ ]] || die "that is not an age public key"
      set_env BACKUP_AGE_RECIPIENT "$recipient"
    fi
  fi

  log "installing the dependencies of the operator commands"
  pnpm install --frozen-lockfile --silent
  log "done. The site will be https://${host} and the mailbox https://mail.${host}"
  log "next: deploy/staging/staging.sh deploy"
}

cmd_deploy() {
  need_env
  [ -s .staging/auth.caddy ] || die "no site password yet: run deploy/staging/staging.sh init"
  local ref="${1:-origin/main}" sha
  git fetch -q origin
  sha="$(git rev-parse --verify "${ref}^{commit}" 2>/dev/null)" || die "unknown commit: $ref"
  git -c advice.detachedHead=false checkout -q "$sha"
  log "version ${sha:0:12}"
  pnpm install --frozen-lockfile --silent
  set_env WCR_IMAGE "${IMAGE_REPO}:sha-${sha}"
  if ! docker pull -q "${IMAGE_REPO}:sha-${sha}" >/dev/null; then
    die "image ${IMAGE_REPO}:sha-${sha} not found: the 'staging image' workflow builds it on GitHub for every commit on main (about 10 minutes), or run it by hand for another commit"
  fi
  dc pull -q --ignore-buildable 2>/dev/null || dc pull -q
  dc up -d --remove-orphans
  wait_healthy
  log "running https://$(get_env STAGING_HOST)"
}

cmd_seed_demo() {
  need_env
  set_env WCR_DEMO_SIGN_IN 1
  log "loading the demo data (refused if the database holds anything that is not demo data)"
  pnpm -s db:seed
  dc up -d --force-recreate web worker
  wait_healthy
  cmd_demo_logins
}

cmd_demo_logins() {
  need_env
  cat <<EOF
staging: the demo accounts (all fictional, addresses demo-...@example.test):
staging:   the table is in docs/guides/admin-guide.bg.md, section 6, "Demo accounts"
staging:   password of every demo account: the value of E2E_PASSWORD in .env
staging:     grep '^E2E_PASSWORD=' .env
staging:   demo-admin, demo-archivist and demo-moderator also ask for an authenticator code;
staging:   add this key to the authenticator app ("enter a setup key", time based, 6 digits):
staging:     deploy/staging/staging.sh totp-key
EOF
}

cmd_totp_key() {
  need_env
  E2E_TOTP_SECRET="$(get_env E2E_TOTP_SECRET)" pnpm -s exec tsx -e \
    "import { base32Encode } from './src/server/auth/otp.ts'; console.log(base32Encode(new TextEncoder().encode(process.env.E2E_TOTP_SECRET)))"
}

cmd_clean_start() {
  need_env
  local confirm stamp dir aside
  cat <<EOF
staging: this DELETES every account, person, school, photo and e-mail on this server and starts an
staging: empty database. A last archive is taken first and kept aside in $(backup_dir)/before-clean-<time>/.
EOF
  read -rp "Type DELETE EVERYTHING to continue: " confirm
  [ "$confirm" = "DELETE EVERYTHING" ] || die "nothing changed"

  dir="$(backup_dir)"
  log "last archive of the old data"
  scripts/backup-local.sh --objects || log "warning: the last archive reported a problem (see above); continuing"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  aside="${dir}/before-clean-${stamp}"
  mkdir -p "$aside"
  # Old archives would restore the demo data; the erasure ledger belongs to the old accounts.
  find "$dir" -mindepth 1 -maxdepth 1 ! -name 'before-clean-*' ! -name 'backup.log' -exec mv -t "$aside" {} +
  install -d "${dir}/erasures"

  set_env WCR_DEMO_SIGN_IN ""
  dc down --remove-orphans
  local project volume
  project="$(sed -n 's/^name: *//p' docker-compose.yml)"
  for volume in postgres-data seaweedfs-data; do
    docker volume rm "${project}_${volume}" >/dev/null 2>&1 && log "deleted volume ${project}_${volume}" || true
  done
  dc up -d --remove-orphans
  wait_healthy
  log "loading the city list (the only reference data an empty database needs)"
  pnpm -s geo:load
  cat <<EOF
staging: done: the database is empty. For each of the two administrators:
staging:   1. sign up on https://$(get_env STAGING_HOST)/sign-up with their real e-mail address;
staging:   2. open the confirmation e-mail in https://mail.$(get_env STAGING_HOST) and follow the link;
staging:   3. sign in and turn on two-factor authentication in Account > Security;
staging:   4. here: deploy/staging/staging.sh make-admin <their e-mail>
staging: then run deploy/staging/staging.sh backup once and check that the nightly archive is set up.
EOF
}

cmd_make_admin() {
  need_env
  [ -n "${1:-}" ] || die "usage: staging.sh make-admin <e-mail>"
  pnpm -s admin:create --email "$1"
}

cmd_password() {
  need_env
  write_password
  dc up -d --force-recreate caddy
}

cmd_backup() {
  need_env
  local dir target port
  dir="$(backup_dir)"
  scripts/backup-local.sh --objects
  target="$(get_env STAGING_OFFSITE)"
  [ -n "$target" ] || return 0
  if [ -z "$(get_env BACKUP_AGE_RECIPIENT)" ]; then
    log "warning: STAGING_OFFSITE is set but BACKUP_AGE_RECIPIENT is not, so nothing is copied off the server (the archives are not encrypted)"
    return 0
  fi
  port="$(get_env STAGING_OFFSITE_PORT)"
  # Only the encrypted files, their checksums and the erasure ledger (ids and times, no personal data).
  rsync -a --delete --prune-empty-dirs -e "ssh -p ${port:-22} -o BatchMode=yes" \
    --exclude='before-clean-*/' --include='*/' --include='*.age' --include='*.age.sha256' \
    --include='*.age.lineage' --include='erasures/***' --exclude='*' \
    "${dir}/" "$target/"
  log "off-site copy updated: ${target}"
}

cmd_install_cron() {
  need_env
  local line="30 2 * * * cd ${ROOT} && PATH=/usr/local/bin:/usr/bin:/bin deploy/staging/staging.sh backup >> $(backup_dir)/backup.log 2>&1"
  ( crontab -l 2>/dev/null | grep -v 'deploy/staging/staging.sh backup' || true; echo "$line" ) | crontab -
  log "nightly archive at 02:30 server time; the log is $(backup_dir)/backup.log"
}

cmd_status() {
  need_env
  dc ps
  echo
  free -h
  df -h / | tail -n 1
  echo
  curl -fsS "http://127.0.0.1:3000/healthz" && echo || log "the app does not answer /healthz"
  log "version: $(get_env WCR_IMAGE)"
  log "demo sign-in: $( [ "$(get_env WCR_DEMO_SIGN_IN)" = 1 ] && echo on || echo off)"
}

command="${1:-}"
shift || true
case "$command" in
  init) cmd_init "$@" ;;
  deploy) cmd_deploy "$@" ;;
  seed-demo) cmd_seed_demo ;;
  demo-logins) cmd_demo_logins ;;
  totp-key) cmd_totp_key ;;
  clean-start) cmd_clean_start ;;
  make-admin) cmd_make_admin "$@" ;;
  password) cmd_password ;;
  backup) cmd_backup ;;
  install-cron) cmd_install_cron ;;
  status) cmd_status ;;
  logs) need_env; dc logs --no-color --tail 200 "$@" ;;
  *) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
