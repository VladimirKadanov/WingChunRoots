# M00 — Основа на хранилището и проверка

`docs/plan/M00-foundation.md` · клон `m00-foundation` · таван 40 хода · D01, D02 (решено от собственика: чисто хранилище, ново приложение)

## Цел (Objective)

Празното хранилище става работещо Next.js приложение с инструменти, локални услуги, CI, команда за проверка и `CLAUDE.md`, а етапите на плана са отделни файлове. Всяка следваща нишка може да пусне `scripts/verify.sh Mxx` и в облачната сесия, и локално, включително на Windows с Docker Desktop и WSL2.

## Прочети първо (Read first)

`docs/WingChunRoots_Technical_Plan.bg.md`: §3, §5.8, §6.1, §6.4, §6.8, §7, §8.0–§8.3, §10.2.

## Зависимости (Dependencies)

Стъпка 0 (план §8.0): документите от PR `docs-bootstrap` са в `main`. Достъп за публикуване в GitHub. Мрежов достъп до npm и до архива на Ubuntu. Изборът на дизайн посока **не** е нужен.

## Обхват (In scope)

1. **Планът в хранилището.**
   - `docs/plan/RULES.md`: план §8.2 дословно.
   - По един файл за етап, от `docs/plan/M00-foundation.md` до `docs/plan/M13-pilot-acceptance.md`, по шаблона от план §8.3, и бележката `docs/plan/deferred-hosting.md`.
   - `docs/plan/README.md` (индекс със статус на всеки етап) и папка `docs/plan/questions/`.
   - В `docs/WingChunRoots_Technical_Plan.bg.md` разделите на етапите се заменят с таблица с връзки към файловете (план §8.3).
2. **Скелет.**
   - Next.js 16.4.2, React 19.3.1, TypeScript 6.0.3. Node 24 LTS в `.nvmrc`, а `engines.node` е `>=22.12` (план §3.2), така че облачната сесия работи с наличния Node 22.
   - pnpm: последното стабилно издание, което поддържа настройките от план §3.2 и в момента на M00 е поне на един ден (поле `packageManager`). Инсталира се с `npm i -g pnpm@<версия>`; Corepack не се ползва.
   - `next.config.ts` с `cacheComponents: true`, `partialPrefetching: true` и `reactCompiler: true`.
   - ESLint с typescript-eslint 8.71 и `eslint-plugin-react-hooks` 7.x.
   - `pnpm-workspace.yaml` по план §3.2: изрично `minimumReleaseAge: 1440` и `minimumReleaseAgeStrict: true`, `minimumReleaseAgeExcludePrune: true`, `strictDepBuilds: true`, `blockExoticSubdeps: true`, `trustPolicy: no-downgrade`. `allowBuilds` е карта, изведена от изхода на първия `pnpm install`: за всеки пакет с install скрипт изрично `true` или `false`, с причина в `docs/adr/0001-stack.md`. Настройка, която избраното издание на pnpm не поддържа, отпада и се записва в ADR.
   - `.gitattributes` с `* text=auto eol=lf`.
   - Началната страница засега показва само името WingChunRoots. Дизайнът идва в M00b.
3. **Тестове.** Vitest 5 и Playwright 1.64.1 с axe (`@axe-core/playwright`). `playwright.config.ts` има проекти `desktop-chromium` (1440×900), `mobile-chromium` (устройство от клас Pixel) и `mobile-webkit` (iPhone; включен само при `CI=true`, защото WebKit не може да се инсталира в облачните сесии). В облачната сесия се ползва предварително инсталираният Chromium; ако закачената версия на Playwright очаква друга сборка, `executablePath` идва от `PW_CHROMIUM_EXECUTABLE` (план §7.6). `webServer` пуска `pnpm start` (от M01b и `pnpm worker`).
4. **Локални услуги.** `docker-compose.yml` с `postgis/postgis:18-3.6`, `axllent/mailpit:v1.31` и SeaweedFS (`chrislusf/seaweedfs`), всички закачени по `@sha256:` digest. В облачната сесия няма Docker daemon, затова digest-ите се вземат от registry API на Docker Hub (заглавката `docker-content-digest`; достъпът е проверен на 16.10.2026). `scripts/db-env-check.sh` проверява версиите (PostgreSQL ≥ 16, PostGIS ≥ 3.4), `postgis_full_version()` и UTF-8 локала на базата.
5. **Облачни сесии.** `scripts/cloud-setup.sh` и SessionStart hook в `.claude/settings.json` (със skill-а `session-start-hook`, ако е наличен). Hook-ът:
   - инсталира PostgreSQL 16 и PostGIS 3.4 от архива на Ubuntu (`apt-get install -y postgresql-16 postgresql-16-postgis-3 postgresql-contrib`), без Docker и без PGDG;
   - създава базата с UTF-8 локал: `createdb -T template0 -E UTF8 --locale=C.UTF-8` (`C.UTF-8` е единственият UTF-8 локал в сесията, а при локал `C` pg_trgm не дава триграми за кирилица и китайски);
   - инсталира точната версия на pnpm от `packageManager`;
   - не инсталира браузъри: ползва предварително инсталирания Chromium и задава `PW_CHROMIUM_EXECUTABLE`, когато е нужно;
   - задава `TEST_DATABASE_URL`.
6. **Проверка.** `scripts/verify.sh` по договора от план §7.5 (обобщение по стъпки на екрана, пълен лог в `.verify/Mxx.log`) и `scripts/verify.d/M00.sh`.
7. **CI и зависимости.**
   - `.github/workflows/ci.yml` с проверка `ci`: `pnpm install --frozen-lockfile`, lint, typecheck, unit, build, E2E в трите проекта на Playwright с PostGIS 18 като service контейнер (по digest), gitleaks, `pnpm audit --prod --audit-level=high`, плюс лека задача на Node 22 (lint, typecheck, unit). Логът от `verify.sh` се качва като artifact.
   - `renovate.json` със забавяне за нови версии, обновяване на digest-ите на образите и седмичен прозорец за поправки по сигурността (план §3.2, „Път за поправки по сигурността“).
8. **Документи.**
   - `CLAUDE.md` по схемата от план §7.3 (езиците, API-first, летвата за интерфейса, отложеният хостинг); `README.md` на английски с пускане на Windows (Docker Desktop с WSL2, хранилището във файловата система на WSL2), Linux, macOS и в облачна сесия; `.env.example`.
   - `docs/adr/0001-stack.md` с решенията от план §3, картата `allowBuilds` и реално приложените настройки на pnpm.
   - Телеметрията и „agent feedback“ на Next.js се изключват и решението се записва като решение по подразбиране.

## Извън обхват (Out of scope)

Дизайн токени, теми, шрифтове и shadcn (M00b). Схема на базата и миграции (M01). Автентикация (M02). Екрани. Хостинг и разгръщане (отложени, план §3.3).

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: всеки CLI на пакет се пуска през pnpm с точна версия, никога през `npx`.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M00` завършва с `VERIFY M00: PASS`. Проверката включва lint, typecheck, unit, build, `pnpm e2e --grep "@smoke|@M00"`, `scripts/db-env-check.sh` и проверка на файловете.
2. Съществуват: `CLAUDE.md`, `README.md`, `.env.example`, `.nvmrc`, `.gitattributes`, `pnpm-workspace.yaml`, `playwright.config.ts`, `docker-compose.yml`, `.claude/settings.json`, `.github/workflows/ci.yml`, `renovate.json`, `scripts/verify.sh`, `scripts/verify.d/M00.sh`, `scripts/cloud-setup.sh`, `scripts/db-env-check.sh`, `docs/adr/0001-stack.md`, `docs/plan/README.md`, `docs/plan/RULES.md`, `docs/plan/questions/`, седемнадесетте файла `docs/plan/M00-…md` до `docs/plan/M13-…md` и `docs/plan/deferred-hosting.md`.
3. Тестове и проверки:
   - `e2e/smoke.spec.ts › @smoke home page responds with 200 and has no axe violations` (в проектите на Chromium в сесията и в трите проекта в CI);
   - `scripts/verify.d/M00.sh` проверява, че `pnpm-workspace.yaml` съдържа `minimumReleaseAgeStrict: true` (или че ADR записва защо липсва), че `.nvmrc` сочи 24, а `engines.node` е `>=22.12`, че всеки образ в `docker-compose.yml` е закачен по digest и че `docs/plan/RULES.md` съвпада с план §8.2;
   - `scripts/db-env-check.sh` минава на PostgreSQL 16 в облачната сесия и на 18 в CI.
4. PR от `m00-foundation` към `main` е отворен (описанието е на английски), CI е зелен, `git status` е чист.

## Кога да спре и да попита (Stop and ask)

Общите условия от `docs/plan/RULES.md`, а освен това:

- няма права за публикуване или GitHub Actions е изключен;
- npm или архивът на Ubuntu са блокирани. В `docs/plan/questions/M00.md` (на английски) се записват точните хостове, които собственикът да добави в Allowed domains;
- версия от план §3 не може да се инсталира заради строгия `minimumReleaseAge`. Ако става дума за patch версия, се взема предишната и това се записва. При разлика в мажорната версия етапът спира.

Настройка на pnpm, която последното стабилно издание не поддържа, не е причина за спиране: тя отпада и се записва в ADR.

## Ред за /goal

```text
/goal Set up the WingChunRoots repository foundation described in milestone M00 in section 8 of docs/WingChunRoots_Technical_Plan.bg.md. Read CLAUDE.md if it exists, then sections 3, 5.8, 6.1, 6.4, 6.8, 7, 8.0-8.3 and 10.2 of that document before writing code. First run `git fetch origin`. If branch m00-foundation exists on origin, check it out and continue from the Progress log in docs/plan/M00-foundation.md and any answered question in docs/plan/questions/M00.md; otherwise branch from origin/main. If docs/WingChunRoots_Technical_Plan.bg.md is not on origin/main, print `BLOCKED M00: step 0 (docs-bootstrap PR) not merged`. Begin every turn with the line `M00 turn <n>/40`. Start by splitting section 8 into docs/plan/RULES.md (section 8.2 verbatim), docs/plan/README.md, docs/plan/questions/, one file per milestone, docs/plan/M00-foundation.md ... docs/plan/M13-pilot-acceptance.md, and docs/plan/deferred-hosting.md, exactly as section 8.3 describes, and commit. Environment: cloud sessions have Node 22, no Docker daemon and no access to apt.postgresql.org, so the SessionStart hook installs PostgreSQL 16 and PostGIS 3.4 from the Ubuntu archive and sets TEST_DATABASE_URL; use the preinstalled Playwright Chromium and never run `playwright install`; mobile WebKit runs only in CI. Put Node 24 in .nvmrc with engines `>=22.12`, and pin the latest stable pnpm that supports the settings in section 3.2 (drop and record any unsupported setting). Success: the goal is met when this conversation shows all of: (1) the step summary printed by `scripts/verify.sh M00`, ending with the line `VERIFY M00: PASS`; (2) the work committed and pushed on branch m00-foundation with a PR to main whose description is in English and includes that step summary; (3) the PR's CI checks all passed (show the GitHub tool output or `gh pr checks`); (4) `git status` showing a clean tree. Respect the Out of scope, Constraints and Stop and ask sections of the milestone and docs/plan/RULES.md. Commit and push after every green checkpoint and add one line per checkpoint to the Progress log. Run /code-review on the diff before the final verify and fix only correctness or requirement gaps. Never delete, skip or weaken a test or check to get a pass. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M00.md, commit and push. The goal also ends, not as success, when you print a `BLOCKED M00: <one-line reason>` line (after recording any question as above) or `STOPPED M00: turn limit` followed by a progress summary after 40 turns.
```

## Дневник на напредъка (Progress log)

- 2026-10-16 16:22 — раздел 8 на плана е разделен на `docs/plan/` (RULES.md, 17 файла на етапи, deferred-hosting.md, README.md, questions/) (eb1d807)
- 2026-10-16 16:40 — скелет на Next.js 16.4.1, pnpm 12.14.0 с настройките от §3.2, ESLint, Vitest, Playwright с axe, Docker Compose по digest, `scripts/cloud-setup.sh`, SessionStart hook и `scripts/db-env-check.sh`; lint, typecheck, unit, build и `@smoke` (Chromium) са зелени, db-env-check минава на PostgreSQL 16.15 / PostGIS 3.4.2 (2089306)
- 2026-10-16 16:45 — `scripts/verify.sh` и `scripts/verify.d/M00.sh`, CI (`ci`, node22, security), Renovate, `CLAUDE.md`, README на английски и ADR 0001; `scripts/verify.sh M00` и `scripts/verify.sh all` завършват с PASS в облачната сесия (c948ad3)
- 2026-10-16 17:01 — поправки след `/code-review` (verify.sh, cloud-setup.sh, pw-chromium.sh, init-env.sh, M00.sh, ESLint, Renovate, ADR); `scripts/verify.sh M00` → PASS; отворен PR #2 към `docs-bootstrap` (95985bb)
