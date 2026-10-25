# WingChunRoots — instructions for Claude

@AGENTS.md

## 1. The project

WingChunRoots documents Wing Chun teaching lineages: a teacher–student network in which one student can have several teachers, each relationship verified independently, plus a school finder with a map and a training passport. Phase 1 is a local pilot for adults (the plan, §2).

Documents (Bulgarian; on any conflict the technical plan wins):

- `docs/WingChunRoots_Technical_Plan.bg.md` — stack, architecture, milestones, verification ("plan §x.y").
- `docs/WingChunRoots_Project_Specification.bg.md` (English original `.en.md`) — "specification §x.y".
- `docs/WingChunRoots_Execution_Plan.bg.md` (English original `.en.md`).
- `docs/plan/` — one file per milestone (canonical since M00), `README.md` (index and status), `RULES.md` (rules for every goal), `questions/`.

## 2. Languages

- **The UI is English only, permanently.** No translation library (no `next-intl`, i18next, Paraglide or similar), no `[locale]` route segment, no message files. UI strings are plain English in the components; e-mail and notification texts live only in `src/server/templates/`.
- **Names are accepted in any script.** A Latin-script name is mandatory and is the primary display name. Optionally: the original script (Traditional or Simplified Chinese, Cyrillic, …), Jyutping and pinyin. Search finds a person by every spelling (M07). Each name is rendered with its `lang` attribute and `translate="no"`; Chinese uses system CJK fonts (plan §5.3).
- **Documentation in `docs/` is Bulgarian**, including the guides for the Bulgarian user and administrator, `docs/guides/user-guide.bg.md` and `docs/guides/admin-guide.bg.md` (created in M00b, updated by every milestone that changes user or admin behaviour).
- **Code, comments, commit messages, PR descriptions and questions to the owner** (`docs/plan/questions/Mxx.md`) are English.

## 3. Stack and versions

The full table, with reasons and deviations, is in `docs/adr/0001-stack.md`. Pinned exactly:

| Layer | Version |
|---|---|
| Node.js | 24 LTS in `.nvmrc` (CI, Docker); `engines.node` `>=22.12` (cloud sessions run Node 22) |
| pnpm | 12.14.0 (`packageManager`; install with `npm install --global pnpm@<version>`, never Corepack) |
| Next.js | 16.4.1 — App Router, Turbopack, Cache Components, Partial Prefetching, React Compiler |
| React | 19.3.1 |
| TypeScript | 6.0.3 (typescript-eslint 8.71 supports < 6.1) |
| Lint | ESLint 9.39.5, eslint-config-next 16.4.1, typescript-eslint 8.71.2, eslint-plugin-react-hooks 7.1.1 |
| Tests | Vitest 5.0.5; Playwright 1.64.1 with `@axe-core/playwright` 4.14.0 |
| Database | PostgreSQL 18.6 + PostGIS 3.6 in Docker Compose and CI; PostgreSQL 16 + PostGIS 3.4 in cloud sessions |

Rules:

- Versions are not bumped without a separate PR. A dependency is not added without a justification in the PR. Every version in `package.json` is exact; the lockfile is committed.
- SQL must work on **PostgreSQL 16+ and PostGIS 3.4+** (plan §3.2): no `uuidv7()`, no virtual generated columns, no `OLD`/`NEW` in `RETURNING`. UUIDv7 ids are generated in the app; the column fallback is `gen_random_uuid()`.
- Package CLIs run through pnpm with an exact version (for example `pnpm dlx shadcn@4.21.5`), never through `npx`.
- pnpm supply-chain settings live in `pnpm-workspace.yaml` (plan §3.2). A package with an install script needs an explicit `true`/`false` in `allowBuilds` and a reason in the ADR.

## 4. Commands

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm worker:dev` | App (and, from M01b, the worker) locally |
| `pnpm lint` | ESLint, including the module boundaries and forbidden packages |
| `pnpm typecheck` | `next typegen` + `tsc --noEmit` |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:int` | Integration tests against PostGIS via `TEST_DATABASE_URL` (from M01) |
| `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:reset`, `pnpm db:check` | Migrations, demo data, reset (local or `TEST_DATABASE_URL` only), migration check (from M01) |
| `pnpm admin:create --email <address>` | Local only: makes an existing account with a confirmed address and TOTP on an admin; prints no secrets (from M02) |
| `pnpm build` | `next build` (bundle budget from M00b) |
| `pnpm e2e` / `pnpm e2e --grep @M05` | Playwright against `next start` on port 3100 (server log: `test-results/server.log`) |
| `scripts/db-env-check.sh` | PostgreSQL >= 16, PostGIS >= 3.4, `postgis_full_version()`, UTF-8 locale, pg_trgm on Cyrillic and Chinese |
| `scripts/verify.sh Mxx` | The milestone check; last line `VERIFY Mxx: PASS`; full log in `.verify/Mxx.log` |
| `scripts/verify.sh all` | Everything, including the whole E2E suite (CI and M13) |
| `scripts/cloud-setup.sh` | Cloud session setup (the SessionStart hook runs it) |
| `scripts/init-env.sh` | Local `.env` with generated local-only values |

### Environments

- **Cloud session (this sandbox):** no Docker daemon; apt.postgresql.org is blocked. The SessionStart hook (`.claude/settings.json` → `scripts/cloud-setup.sh`) installs PostgreSQL 16 + PostGIS 3.4 from the Ubuntu archive, creates `wingchunroots_test` (UTF8, `C.UTF-8`) and exports `TEST_DATABASE_URL`. If those variables are missing, run `eval "$(scripts/cloud-setup.sh --print-env)"`.
- **Browsers:** never run `playwright install` in a cloud session. The preinstalled Chromium is used through `PW_CHROMIUM_EXECUTABLE` when the pinned Playwright expects another build. `mobile-webkit` runs only in CI (`CI=true`).
- **Local (owner):** Windows with Docker Desktop + WSL2, repository inside the WSL2 filesystem; `docker compose up -d --wait` (PostGIS 18-3.6, Mailpit, SeaweedFS). See `README.md`.
- **Local, Windows without WSL2:** repository on a Windows drive, commands in Git Bash; Node 24 via nvm for Windows, pnpm via `npm install --global` (not Corepack), psql 15+ on `PATH`, `POSTGRES_PORT=5433` (and the port in `DATABASE_URL`/`TEST_DATABASE_URL`) when a native PostgreSQL holds 5432, `PW_WORKERS=2` in `.env` for E2E (Playwright's default overruns the proxy's 500 ms person check). Code and tests stay path-agnostic: compare paths with `/` separators and start CLIs through `process.execPath`, never `node_modules/.bin/*`. See `README.md`.
- **CI:** GitHub Actions, required check `ci`; PostgreSQL 18 service container; Chromium and WebKit.

## 5. Module boundaries (plan §6.1)

- `src/app`, `src/components`: Server Components by default; the graph, the map and the command palette are client islands. Never import `src/server/db`; go through the services (oRPC or a thin Server Action).
- `src/server/services`: the only place with business logic. Every service checks permissions itself, whoever calls it.
- `src/server/dto`: public DTOs strip private fields; only their output may enter `'use cache'`.
- `src/server/db`: Drizzle schema, roles `app_rw` and `app_public_ro`, `statement_timeout` 2 s.
- `src/server/entitlements`, `src/server/audit`, `src/server/jobs` + `src/worker.ts`, `src/server/search`, `src/server/geo`, `src/server/storage`, `src/server/mail`, `src/server/templates`, `src/server/rpc`, `src/design`.
- `src/lib/lineage-layout`: pure TypeScript — no React, DOM, Next.js or `src/server` (only `layout.worker.ts` may use worker globals).
- ESLint (`eslint.config.mjs`) enforces these imports; extend it when a new boundary appears.

## 6. Privacy — never

- private fields inside `'use cache'` (cache only public DTOs; no session, cookies or roles in cached functions);
- exact school coordinates in any public response, HTML, sitemap, Open Graph, JSON-LD or log;
- evidence outside the private bucket or private folder, or behind a presigned GET;
- personal data (names, e-mails, IP addresses, coordinates) in logs;
- hiding data with CSS instead of filtering it on the server.

## 7. Data

Only clearly fictional demo data (D20). Demo slugs start with `demo-`. Real people, lineages, dates and ranks are never entered or invented — not in seeds, tests, fixtures or screenshots.

## 8. Decisions by default

Every place that relies on a default for an open decision D01–D26 (plan §10.1) is marked in code or docs with `DEFAULT Dxx` (for example `// DEFAULT D03: pending relationships are involved_only`). Defaults not tied to a D number are recorded in the milestone PR and, when lasting, in an ADR.

## 9. Workflow

- Follow `docs/plan/RULES.md` (plan §8.2) and the milestone file in `docs/plan/`.
- One branch per milestone, `mxx-<slug>`. Small English commits. Commit and push after every green checkpoint and add one line per checkpoint to the milestone's Progress log.
- Run `/code-review` on the diff before the final `scripts/verify.sh Mxx`; fix only correctness and requirement gaps.
- Stop-and-ask protocol: write the question in English to `docs/plan/questions/Mxx.md` (date, milestone, question, options, proposed default), commit, push, print `BLOCKED Mxx: <reason>`.
- Update the Bulgarian guides in `docs/guides/` whenever user or administrator behaviour changes.
- **Never delete, skip or weaken a test, a lint rule or a check to get a pass.**
- Never write to `main`, never force-push shared branches, never rewrite history. The owner merges (squash). Claude does not merge unless the owner allows it here after M02.

## 10. UI

- The quality bar of plan §5.8 and the chosen direction in `docs/design/direction.md` (from M00b): mobile webview ready, performance budgets (LCP, INP, CLS, JS per route), Playwright on desktop and phone, visual regression, axe on every page in both themes, design review in M05, M06, M07 and M11.
- Base UI uses `render`, not Radix `asChild`. Use the Base UI section of the shadcn docs and `shadcn/skills`.
- Status is never conveyed by colour alone (text or shape as well).
- Every hover behaviour has keyboard and touch equivalents; nothing is reachable only by hover.
- Single-key shortcuts only while focus is inside the component (WCAG 2.1.4).
- Touch targets at least 44×44 CSS px on phones.
- No `100vh` (use `dvh`/`svh`), no `window.open`, no pop-ups; `viewport-fit=cover` with `env(safe-area-inset-*)`.

## 11. Copy

No artificial urgency, scarcity, countdowns, shaming or FOMO. Upgrade prompts appear only at a real limit and show only benefits that exist now (`availability: 'now'`).

## 12. Secrets

Never in the repository. `.env.example` lists names only; `.env` is local and git-ignored (`scripts/init-env.sh` generates local-only values). Phase 1 uses no secrets of real services. gitleaks runs in CI.

## 13. Next.js

Read `AGENTS.md` and the version-matched docs in `node_modules/next/dist/docs/` before writing Next.js code. Telemetry is off (`NEXT_TELEMETRY_DISABLED=1` in the package scripts, CI and `.claude/settings.json`) and `experimental.agentFeedback` is `false` — a default decision (plan §10.2, row 10) recorded in `docs/adr/0001-stack.md`. `src/proxy.ts` runs only for `/people/:slug` and `/people/:slug/lineage` (the 404 of a hidden person; owner decision 2026-10-19, M04, ADR 0008); its matcher never includes `api`, `healthz` or `_next` (plan §6.1).

## 14. Forbidden packages

`vaul`, `@antv/*`, `cytoscape-svg` (GPL), `@cosmograph/*` (non-commercial licence), `mapbox-gl`, `reactflow` (old name; use `@xyflow/react`), `next-intl` and any other UI translation library. ESLint and `scripts/verify.d/M00.sh` enforce this.

## 15. API-first (plan §6.8)

Business logic lives only in `src/server/services`. Every read and every mutation has an oRPC procedure in the OpenAPI contract (`/api/rpc` for the web, `/api/v1` for the future mobile app). Server Actions are thin wrappers over the same services and are never the only path to a mutation.

## 16. Hosting

Deferred (plan §3.3): no deployment, cloud services or paid resources until the owner decides. Everything runs locally (Docker Compose), in cloud sessions and in CI.
