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
| PostgreSQL client | `psql` 16 or newer | used by `scripts/db-env-check.sh` and `scripts/verify.sh` |

## Getting started

### Windows (Docker Desktop with WSL2) — the owner's setup

Work inside WSL2, with the repository **in the WSL2 filesystem** (for example `~/src/wingchunroots`), not under `C:\` or `/mnt/c`: the Linux filesystem is many times faster for `pnpm install` and `next build`, and file permissions behave correctly. Run every `pnpm`, `docker compose` and `scripts/` command from the WSL2 shell, never from PowerShell or cmd: the scripts are bash, and Node, pnpm and the repository live inside WSL2.

1. Install [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) with the WSL2 backend. In *Settings → Resources → WSL integration*, enable your Ubuntu distribution. Give Docker about 8 GB of memory.
2. Open the Ubuntu (WSL2) terminal and install the tools:

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
   pnpm install
   pnpm exec playwright install --with-deps chromium   # browsers for E2E tests on your machine
   pnpm dev                      # http://localhost:3000
   ```

4. Check everything: `scripts/verify.sh M00` (the last line must be `VERIFY M00: PASS`).

Tips: open the project with VS Code's *WSL* extension (`code .` from the WSL2 terminal). Line endings are always LF (`.gitattributes`), so Windows Git settings cannot introduce CRLF changes. The services listen only on `127.0.0.1`: Mailpit is at <http://localhost:8025>, the S3 endpoint at <http://localhost:8333>.

### Linux

Install Docker Engine with the Compose plugin, Node 24 (for example with nvm), `npm install --global pnpm@12.14.0` and the PostgreSQL client (`sudo apt-get install -y postgresql-client`). Then follow step 3 above.

### macOS

Install Docker Desktop, Node 24 (nvm or Homebrew), `npm install --global pnpm@12.14.0` and the PostgreSQL client (`brew install libpq && brew link --force libpq`). Then follow step 3 above. The `postgis/postgis` image is published for `linux/amd64` only, so on Apple Silicon it runs under emulation (Rosetta); expect a slower first start.

### Claude Code cloud session

Nothing to do: the SessionStart hook in `.claude/settings.json` runs `scripts/cloud-setup.sh`, which installs PostgreSQL 16 + PostGIS 3.4 from the Ubuntu archive (cloud sessions have no Docker daemon and cannot reach apt.postgresql.org), creates the UTF-8 test database, installs the pinned pnpm and the dependencies, and exports `TEST_DATABASE_URL` (and `PW_CHROMIUM_EXECUTABLE` when the pinned Playwright expects a different Chromium build than the preinstalled one). To run it by hand:

```bash
scripts/cloud-setup.sh
eval "$(scripts/cloud-setup.sh --print-env)"
scripts/verify.sh M00
```

The script is for cloud sessions only (`CLAUDE_CODE_REMOTE=true`). On your own machine it stops with exit code 2, because it would install a native PostgreSQL on port 5432 next to Docker Compose; use `scripts/init-env.sh` and `docker compose up -d --wait` there.

Browsers are never installed in a cloud session; mobile WebKit runs only in CI.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Development server on <http://localhost:3000> |
| `pnpm lint` | ESLint, including module boundaries and forbidden packages |
| `pnpm typecheck` | Route types (`next typegen`) and `tsc --noEmit` |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm e2e` | Playwright E2E tests against `next start` on port 3100 (run `pnpm build` first) |
| `scripts/db-env-check.sh` | Checks the test database: PostgreSQL ≥ 16, PostGIS ≥ 3.4, UTF-8 locale |
| `scripts/verify.sh <Mxx\|all>` | The milestone check: one line per step, full log in `.verify/<Mxx>.log` |
| `docker compose up -d --wait` / `docker compose down` | Start / stop the local services (data stays in named volumes) |

## Repository layout

| Path | Contents |
|---|---|
| `src/app` | Next.js App Router routes |
| `e2e/` | Playwright tests (`@smoke`, `@M00` … tags) and the project matrix |
| `scripts/` | `verify.sh` and `verify.d/`, `cloud-setup.sh`, `db-env-check.sh`, `init-env.sh` |
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
| [`docs/WingChunRoots_Project_Specification.bg.md`](docs/WingChunRoots_Project_Specification.bg.md) | Project specification (Bulgarian translation) |
| [`docs/WingChunRoots_Project_Specification.en.md`](docs/WingChunRoots_Project_Specification.en.md) | Project specification (English original) |
| [`docs/WingChunRoots_Execution_Plan.bg.md`](docs/WingChunRoots_Execution_Plan.bg.md) | Execution plan (Bulgarian translation) |
| [`docs/WingChunRoots_Execution_Plan.en.md`](docs/WingChunRoots_Execution_Plan.en.md) | Execution plan (English original) |
| [`docs/source/WingChunRoots_Documentation.md`](docs/source/WingChunRoots_Documentation.md) | The original short summary in Bulgarian, kept for reference |

The specification and the execution plan predate the owner's corrections of 16 October 2026, so the technical plan wins where they differ (for example, the UI is English only and hosting is deferred). Guides for the Bulgarian user and administrator (`docs/guides/*.bg.md`) arrive with the first screens in M00b.
