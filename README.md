# WingChunRoots

WingChunRoots is a web platform that documents Wing Chun teaching lineages. At its core is a network of teacher–student relationships in which one student can have several teachers, each relationship verified independently. Around it sit a school finder with a map and a training passport for exams, certificates and seminars.

## Status

Phase 1 is in progress and runs **locally only**: Docker Compose on a developer machine, Claude Code cloud sessions and GitHub Actions. Hosting and deployment are a deferred decision (plan §3.3). The application arrives milestone by milestone, one pull request per milestone; the index and status are in [`docs/plan/README.md`](docs/plan/README.md).

## Languages

- **The UI is English only, permanently.** No UI translation is planned.
- **People's names** are always stored in Latin script and optionally in their original script, including Chinese characters, with Jyutping and pinyin. Search finds a person by any of these spellings.
- **Documentation in `docs/` is in Bulgarian**, for the Bulgarian user and administrator. Code, comments, commit messages and pull request descriptions are in English.

## Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24 LTS (`.nvmrc`); 22.12 or newer works | `nvm install` reads `.nvmrc` |
| pnpm | 12.14.0 (exact, from `packageManager`) | `npm install --global pnpm@12.14.0` (no Corepack) |
| Docker | Docker Desktop (Windows, macOS) or Docker Engine with the Compose plugin (Linux) | about 8 GB of memory for Docker |
| PostgreSQL client | `psql` 16 or newer (at least 15) | used by `scripts/db-env-check.sh`, `scripts/db-bootstrap.sh`, `scripts/verify.sh` and `pnpm test:int`; `scripts/db-bootstrap.sql` needs `\getenv` (psql 15+). Ubuntu 24.04 ships psql 16; Ubuntu 22.04 ships psql 14, which is too old |

## Getting started

### Windows (Docker Desktop with WSL2) — the owner's setup

Work inside WSL2, with the repository **in the WSL2 filesystem** (for example `~/src/wingchunroots`), not under `C:\` or `/mnt/c`: the Linux filesystem is many times faster for `pnpm install` and `next build`, and file permissions behave correctly. Run every `pnpm`, `docker compose` and `scripts/` command from the WSL2 shell, never from PowerShell or cmd: the scripts are bash, and Node, pnpm and the repository live inside WSL2.

1. Install [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) with the WSL2 backend. In *Settings → Resources → WSL integration*, enable your Ubuntu distribution. Give Docker about 8 GB of memory.
2. Open the Ubuntu (WSL2) terminal and install the tools. Use **Ubuntu 24.04** (`lsb_release -rs`): its `postgresql-client` is psql 16. Ubuntu 22.04 installs psql 14, and the scripts stop with `psql 14 is too old`; install `postgresql-client-16` from the [PostgreSQL apt repository](https://www.postgresql.org/download/linux/ubuntu/) there, or add an Ubuntu 24.04 distribution (`wsl --install -d Ubuntu-24.04`).

   ```bash
   sudo apt-get update && sudo apt-get install -y git postgresql-client
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash   # then reopen the terminal
   nvm install 24
   npm install --global pnpm@12.14.0
   ```

3. Clone and start:

   ```bash
   mkdir -p ~/src && cd ~/src
   git clone https://github.com/VladimirKadanov/wingchunroots.git
   cd wingchunroots
   nvm use                       # Node from .nvmrc
   scripts/init-env.sh           # .env with local-only passwords and keys
   docker compose up -d --wait   # PostgreSQL 18 + PostGIS 3.6, Mailpit, SeaweedFS
   scripts/db-bootstrap.sh       # database roles and owner, once per database
   pnpm install
   pnpm db:migrate && pnpm db:seed   # schema and fictional demo data
   pnpm exec playwright install --with-deps chromium   # browsers for E2E tests on your machine
   pnpm dev                      # http://localhost:3000
   pnpm worker:dev               # in a second terminal: background jobs and e-mail
   ```

4. Check everything: `scripts/verify.sh M02` (the last line must be `VERIFY M02: PASS`).

If your `.env` was created before M01, M01b or M02, run `scripts/init-env.sh` once more: it keeps the file and only adds what is missing, the three database role passwords (`DB_MIGRATOR_PASSWORD`, `DB_APP_RW_PASSWORD`, `DB_APP_PUBLIC_RO_PASSWORD`), `MAIL_TRANSPORT=smtp` and, from M02, the account settings (`APP_URL`, `BETTER_AUTH_SECRET`, `IP_HMAC_KEY`, `MAIL_SEAL_KEY`, `E2E_PASSWORD`, `E2E_TOTP_SECRET`). `TRUSTED_PROXIES` stays empty locally: it names the reverse proxies of a future deployment. After new role passwords, run `scripts/db-bootstrap.sh`.

#### E-mail

Every e-mail goes through the worker (`pnpm worker`, or `pnpm worker:dev`, which restarts on changes): the application queues it in the same database transaction as the change that causes it, and the worker sends it. Nothing leaves your machine in Phase 1:

- `MAIL_TRANSPORT=smtp` (what `scripts/init-env.sh` writes): the worker sends to Mailpit from Docker Compose; read the mail at <http://localhost:8025>. `SMTP_URL` may only name that local Mailpit (a loopback address, `localhost` or `mailpit`); any other host stops the worker at start. `scripts/verify.sh` checks that Mailpit answers and starts it when it does not (`docker compose up -d --wait mailpit`).
- `MAIL_TRANSPORT=file` (the default when the variable is unset; cloud sessions): each message is written to `.mail/` (git-ignored) as `.eml` plus `.json`.

To check the setup: `pnpm mail:check demo@wingchunroots.test`, with the worker running; the message appears in Mailpit (or in `.mail/`). The other settings, `SMTP_URL`, `MAIL_FILE_DIR`, `MAIL_FROM` and `MAILPIT_URL`, are described in `.env.example`.

#### Accounts (M02)

Sign-up, e-mail confirmation, sign-in, password reset and TOTP two-factor authentication run on Better Auth with the session in a cookie or in `Authorization: Bearer` ([ADR 0004](docs/adr/0004-auth.md)). The confirmation and reset e-mails arrive in Mailpit (or `.mail/`) while the worker runs.

- **First administrator** of a local environment: sign up at `/sign-up`, confirm the address, turn on two-factor authentication at `/account/security`, then run `pnpm admin:create --email <address>` and sign in again with the authenticator code. The command refuses `NODE_ENV=production` and a database that is not on this machine, and prints no secrets.
- **Demo accounts** (`pnpm db:seed`, never with `NODE_ENV=production`): `<slug>@example.test` for `demo-pending`, `demo-root-a`, `demo-hub-a`, `demo-free-sifu-5`, `demo-pro-sifu-8` and `demo-two-lineages`, and `demo-admin`, `demo-archivist` and `demo-moderator` with TOTP. The password is `E2E_PASSWORD` and the staff TOTP secret `E2E_TOTP_SECRET` from `.env`: throwaway values that `scripts/init-env.sh` generates for this machine only. E2E tests sign in with `signInAs(page, slugOrRole)` from `e2e/helpers/auth.ts`.
- **Staff** (`admin`, `moderator`, `archivist`) must have TOTP on, and a staff page opens only in a session that passed the second factor.

Tips: open the project with VS Code's *WSL* extension (`code .` from the WSL2 terminal). Line endings are always LF (`.gitattributes`), so Windows Git settings cannot introduce CRLF changes. The services listen only on `127.0.0.1`: Mailpit is at <http://localhost:8025>, the S3 endpoint at <http://localhost:8333>.

### Linux

Install Docker Engine with the Compose plugin, Node 24 (for example with nvm), `npm install --global pnpm@12.14.0` and the PostgreSQL client, psql 15 or newer (`sudo apt-get install -y postgresql-client` on Ubuntu 24.04 or Debian 12; older releases need `postgresql-client-16` from the PostgreSQL apt repository). Then follow step 3 above.

### macOS

Install Docker Desktop, Node 24 (nvm or Homebrew), `npm install --global pnpm@12.14.0` and the PostgreSQL client (`brew install libpq && brew link --force libpq`). Then follow step 3 above. The `postgis/postgis` image is published for `linux/amd64` only, so on Apple Silicon it runs under emulation (Rosetta); expect a slower first start.

### Claude Code cloud session

Nothing to do: the SessionStart hook in `.claude/settings.json` runs `scripts/cloud-setup.sh`, which installs PostgreSQL 16 + PostGIS 3.4 from the Ubuntu archive (cloud sessions have no Docker daemon and cannot reach apt.postgresql.org), creates the UTF-8 test database, bootstraps the database roles with throwaway passwords, installs the pinned pnpm and the dependencies, and exports `TEST_DATABASE_URL`, the role passwords, `MAIL_TRANSPORT=file` (no Mailpit without Docker), the account settings of M02 (`BETTER_AUTH_SECRET`, `IP_HMAC_KEY`, `MAIL_SEAL_KEY`, `E2E_PASSWORD`, `E2E_TOTP_SECRET`: random throwaway values kept in `~/.local/state/wingchunroots/cloud-secrets.env`, outside the repository) (and `PW_CHROMIUM_EXECUTABLE` when the pinned Playwright expects a different Chromium build than the preinstalled one). To run it by hand:

```bash
scripts/cloud-setup.sh
eval "$(scripts/cloud-setup.sh --print-env)"
scripts/verify.sh M02
```

The script is for cloud sessions only (`CLAUDE_CODE_REMOTE=true`). On your own machine it stops with exit code 2, because it would install a native PostgreSQL on port 5432 next to Docker Compose; use `scripts/init-env.sh` and `docker compose up -d --wait` there.

Browsers are never installed in a cloud session; mobile WebKit runs only in CI.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Development server on <http://localhost:3000> |
| `pnpm worker` / `pnpm worker:dev` | The job worker (pg-boss, as `app_rw`): sends e-mail and runs scheduled jobs; `worker:dev` restarts on changes |
| `pnpm mail:check <address> [--name <Latin name>]` | Queues a test e-mail; the running worker delivers it to Mailpit or `.mail/` |
| `pnpm lint` | ESLint, including module boundaries and forbidden packages |
| `pnpm typecheck` | Route types (`next typegen`) and `tsc --noEmit` |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:int` | Integration tests against PostGIS: `TEST_DATABASE_URL`, or Testcontainers when it is not set (needs Docker) |
| `scripts/db-bootstrap.sh` | Roles `migrator`, `app_rw`, `app_public_ro` with the passwords from `.env`, database owner and PostGIS; once per database (idempotent) |
| `pnpm db:migrate` / `pnpm db:seed` | Apply the migrations and the pg-boss schema step / load the fictional demo data and, from M02, the demo accounts (`DATABASE_URL`, or `TEST_DATABASE_URL` when it is not set; never with `NODE_ENV=production`) |
| `pnpm db:reset` | Drop every application object; only a local database or `TEST_DATABASE_URL`, never with `NODE_ENV=production` |
| `pnpm db:check` | `drizzle-kit check`, no schema change without a migration, and all migrations applied to a new empty database |
| `pnpm admin:create --email <address>` | Local only: makes an existing account with a confirmed address and TOTP on an admin, ends its sessions and writes `role.change` to the audit log; prints no secrets |
| `pnpm db:generate` | A new migration from a change in `src/server/db/schema/` |
| `pnpm fixtures:generate` | Rewrite `fixtures/lineage-600.json` from the fixture generator |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm build:e2e` | The build for `pnpm e2e` and `pnpm screenshots`: a production build with the test fault switch (`WCR_E2E_BUILD=1`, M04). Never deploy it |
| `node scripts/check-bundle-budget.mjs` | After `pnpm build`: initial JavaScript per route, gzip, against its budget (170 kB; `/styleguide` 250 kB) |
| `pnpm tokens:build` | Regenerate `src/design/generated/tokens.css` and `tokens.json` from `src/design/tokens.ts` |
| `pnpm notices` | Regenerate `THIRD_PARTY_NOTICES.md` and the `/legal/licenses` data from `pnpm licenses list --prod`, the shipped build output of `tailwindcss` and `licenses/addenda/` (optional packages such as `sharp`) |
| `node scripts/lighthouse.mjs --url=<url> [--chrome-path=<chrome>]` | Lighthouse 13 in the mobile profile against a running server: three runs, median LCP and CLS against `lighthouserc.json` |
| `pnpm screenshots` | Full-page screenshots of the key screens into `docs/screenshots/<milestone>/` (run `pnpm build:e2e` first) |
| `scripts/visual-baselines.sh accept <artifact-dir\|job-log>` | Take the visual regression baselines from a CI run (see the admin guide) |
| `pnpm e2e` | Playwright E2E tests against `next start` on port 3100 and `pnpm worker` (run `pnpm build:e2e` first; it stops at once after a plain `pnpm build`; server log in `test-results/server.log`). The visual regression (`@visual`) runs only in CI; Lighthouse for `/` runs in `scripts/verify.sh M00b` |
| `scripts/db-env-check.sh` | Checks the test database: PostgreSQL ≥ 16, PostGIS ≥ 3.4, UTF-8 locale, the ICU collation `und-x-icu` (name order, M04) |
| `scripts/verify.sh <Mxx\|all>` | The milestone check: one line per step, full log in `.verify/<Mxx>.log` |
| `docker compose up -d --wait` / `docker compose down` | Start / stop the local services (data stays in named volumes) |

## Repository layout

| Path | Contents |
|---|---|
| `src/app` | Next.js App Router routes: the home page, `/styleguide`, `/legal/licenses` |
| `src/design` | Design tokens (`tokens.ts`), the generator and its output in `generated/`, fonts, the theme script |
| `src/components` | `ui/` (shadcn/ui on Base UI), `ink/` (link strokes, seals, legend), `shell/` (app shell), `home/` |
| `src/server/db` | Drizzle schema, role connections, db scripts and integration tests (`*.int.test.ts`) |
| `src/worker.ts`, `src/server/jobs` | The worker process, queues, the outbox helper and the pg-boss schema step |
| `src/server/mail`, `src/server/templates` | The `Mailer` with its SMTP and file transports; e-mail templates (React Email) and notification texts, English only |
| `src/server/services` | Business logic (from M01b: the retention job) |
| `src/fixtures`, `fixtures/` | Deterministic fictional demo data and its export `lineage-600.json` |
| `drizzle/` | Migrations (drizzle-kit 1.0 format) |
| `e2e/` | Playwright tests (`@smoke`, `@M00` … tags), the project matrix and helpers (`e2e/helpers/mailbox.ts` reads Mailpit or `.mail/`) |
| `scripts/` | `verify.sh` and `verify.d/`, `cloud-setup.sh`, `db-env-check.sh`, `db-bootstrap.sh`/`.sql`, `init-env.sh` |
| `docker-compose.yml`, `docker/` | Local services, pinned by image digest |
| `.github/workflows/ci.yml` | CI; the required check is `ci` |
| `CLAUDE.md`, `AGENTS.md` | Working rules for Claude Code and Next.js agent notes |
| `docs/` | Plan, specification and decisions (Bulgarian) |

## Documents

| File | Contents |
|---|---|
| [`docs/WingChunRoots_Technical_Plan.bg.md`](docs/WingChunRoots_Technical_Plan.bg.md) | Technical plan for Phase 1: stack, architecture, milestones and verification. The newest document; it includes the owner's corrections of 16 October 2026 and wins on any conflict. |
| [`docs/plan/`](docs/plan/README.md) | One file per milestone (M00–M13), the shared rules (`RULES.md`) and questions to the owner |
| [`docs/adr/0001-stack.md`](docs/adr/0001-stack.md) | Stack decisions, pnpm settings and the build-script allow list |
| [`docs/adr/0002-data-model.md`](docs/adr/0002-data-model.md) | Data model decisions: Drizzle 1.0 RC, database roles, privacy in the database, fixtures |
| [`docs/adr/0003-jobs-and-mail.md`](docs/adr/0003-jobs-and-mail.md) | Background jobs (pg-boss without DDL rights) and e-mail: outbox, Mailer, retries, templates |
| [`docs/adr/0006-design-system.md`](docs/adr/0006-design-system.md) | The design system: tokens, contrast, fonts, themes, components, budgets, visual regression, and every deviation from the plan and the prototype |
| [`docs/design/direction.md`](docs/design/direction.md) | The design direction (Ink Register, chosen by the owner) and the four prototypes in `docs/design/prototypes/` |
| [`docs/data-model.md`](docs/data-model.md) | The data model: tables, public views, roles and grants, personal data and retention |
| [`docs/guides/user-guide.bg.md`](docs/guides/user-guide.bg.md) | User guide (Bulgarian): the site, navigation, themes and the home page |
| [`docs/guides/admin-guide.bg.md`](docs/guides/admin-guide.bg.md) | Administrator guide (Bulgarian): running locally on Windows with Docker Desktop and WSL2, stopping, updating, the worker and e-mail, visual baselines |
| [`docs/WingChunRoots_Project_Specification.bg.md`](docs/WingChunRoots_Project_Specification.bg.md) | Project specification (Bulgarian translation) |
| [`docs/WingChunRoots_Project_Specification.en.md`](docs/WingChunRoots_Project_Specification.en.md) | Project specification (English original) |
| [`docs/WingChunRoots_Execution_Plan.bg.md`](docs/WingChunRoots_Execution_Plan.bg.md) | Execution plan (Bulgarian translation) |
| [`docs/WingChunRoots_Execution_Plan.en.md`](docs/WingChunRoots_Execution_Plan.en.md) | Execution plan (English original) |
| [`docs/source/WingChunRoots_Documentation.md`](docs/source/WingChunRoots_Documentation.md) | The original short summary in Bulgarian, kept for reference |

The specification and the execution plan predate the owner's corrections of 16 October 2026, so the technical plan wins where they differ (for example, the UI is English only and hosting is deferred).
