# ADR 0001: Технологичен стек, настройки на pnpm и списък на install скриптовете

| | |
|---|---|
| Статус | Прието (M00, 16.10.2026) |
| Контекст | План §3 (стек и обосновка), §3.2 (сигурност на веригата за доставки), §7.5–§7.6 (команди и среди), §10.2 ред 10 (телеметрия) |
| Етап | [`docs/plan/M00-foundation.md`](../plan/M00-foundation.md) |

## Решение

Стекът е този от план §3.1. Таблицата показва версиите, които реално са закачени в `package.json` и `pnpm-lock.yaml` при M00, и всяко отклонение от плана с причината.

| Слой | Пакет | Закачена версия | Бележка |
|---|---|---|---|
| Среда | Node.js | 26.12.1 в `.nvmrc`; `engines.node` `>=26.12.1` | Издание с поправки на сигурността (27.10.2026). Облачните сесии го инсталират от nodejs.org (`scripts/cloud-setup.sh`, проверка по SHA-256), затова отделната задача на Node 22 в CI отпадна |
| Пакети | pnpm | 12.14.0 (`packageManager`) | Последното стабилно издание; публикувано на 15.10.2026 в 13:39 UTC, тоест на повече от един ден при M00. Инсталира се с `npm install --global pnpm@12.14.0`, без Corepack |
| Уеб рамка | `next` | **16.4.1** (планът: 16.4.2) | `next@16.4.2` е публикуван на 15.10.2026 в 20:57 UTC и при M00 е по-млад от `minimumReleaseAge` (1440 минути), затова строгият режим го отказва. По правилото на M00 („patch версия → предишната“) е взета 16.4.1, която отговаря и на задължителния минимум ≥ 16.4.1 (поправките на двете критични RCE от 14.10.2026). Renovate ще предложи 16.4.2 след периода на изчакване |
| UI ядро | `react`, `react-dom` | 19.3.1 | React Compiler: `babel-plugin-react-compiler` 1.0.0, `reactCompiler: true` |
| Език | `typescript` | 6.0.3 | typescript-eslint 8.71 поддържа само TypeScript < 6.1 |
| Lint | `eslint` | 9.39.5 | ESLint 10 не е съвместим с `eslint-plugin-react` 7.37.5 (peer `^9.7`), който идва чрез `eslint-config-next` 16.4.1; затова и `create-next-app` 16.4 създава проекти с `eslint@^9`. npm отбелязва 9.39.5 като „deprecated“ (поддръжката на линия 9 е приключила); това е предупреждение за инструмент само за разработка. Преминаването към ESLint 10 чака `eslint-config-next` с поддръжка за него (правило в Renovate: `<10`) |
| Lint | `eslint-config-next` | 16.4.1 | Същата версия като `next` |
| Lint | `typescript-eslint`, `eslint-plugin-react-hooks` | 8.71.2, 7.1.1 | Идват и чрез `eslint-config-next`; изрично закачени, за да са точно версиите от плана (в lockfile-а има по една версия) |
| Тестове | `vitest` | 5.0.5 | Конфигурацията е `vitest.config.mts` (ESM за родния зареждач на Vite) |
| Тестове | `@playwright/test`, `@axe-core/playwright` | 1.64.1, 4.14.0 | Проекти `desktop-chromium`, `mobile-chromium` и `mobile-webkit` (само при `CI=true`) |
| Типове | `@types/node`, `@types/react`, `@types/react-dom` | 26.6.5, 19.3.0, 19.3.0 | `@types/node` следва Node 26 |
| Сайт (M00b) | `tailwindcss`, `@tailwindcss/postcss`; `@base-ui/react`; `class-variance-authority`, `clsx`, `tailwind-merge`; `@fontsource/gloock`, `@fontsource-variable/schibsted-grotesk`, `@fontsource/noto-serif-display`; `lighthouse`, `chrome-launcher` (за разработка) | 4.3.3; 1.9.0; 0.7.1, 2.1.1, 3.7.0; 5.3.0; 13.4.1, 1.2.1 | Дизайн системата, шрифтовете (OFL, през `next/font/local`) и Lighthouse за `/` (`scripts/lighthouse.mjs`). Причините и отклоненията са в [ADR 0006](0006-design-system.md). Нито един от пакетите няма install скрипт |
| База данни (M01) | `drizzle-orm`, `drizzle-kit` | 1.0.0-rc.4 | Drizzle 1.0 RC по план §3.1 с точна версия: последната RC, по-стара от един ден при M01. Миграциите са в новия формат на 1.0 (`drizzle/<време>_<име>/migration.sql` + `snapshot.json`); `drizzle-kit check` проверява миграции от паралелни клонове. Резерва при блокираща грешка: 0.45.4 (план §3.1) |
| База данни (M01) | `pg`, `@types/pg` | 8.23.1, 8.23.1 | Драйверът node-postgres за Drizzle (`drizzle-orm/node-postgres`): пул за всяка роля с `statement_timeout` 2 s |
| Скриптове (M01) | `tsx` | 4.23.15 | Пуска TypeScript скриптовете `pnpm db:*` и `pnpm fixtures:generate` без отделна компилация |
| Тестове (M01) | `@testcontainers/postgresql` | 12.2.1 | Testcontainers 12.2 по план §3.1: интеграционните тестове без `TEST_DATABASE_URL` пускат `postgis/postgis:18-3.6` по същия digest. Зарежда се само при нужда (в облачната сесия няма Docker и се ползва `TEST_DATABASE_URL`) |
| Задачи (M01b) | `pg-boss` | 12.38.0 | Опашка и outbox в същата база (план §3.1); версия на схемата 46. Само ESM, изисква Node ≥ 22.12. Върви с `migrate: false`: схемата `pgboss` се създава от `pnpm db:migrate` като `migrator` ([ADR 0003](0003-jobs-and-mail.md)) |
| Поща (M01b) | `nodemailer` | 10.1.1 | SMTP към Mailpit и файловият транспорт (`streamTransport`) в `src/server/mail`; типовете са в пакета. 10.1.2 е публикувана на 16.10.2026 и е по-млада от `minimumReleaseAge`, затова е взета предишната |
| Шаблони (M01b) | `react-email`, `@react-email/render` | 6.11.2, 2.1.0 | React Email 6 (план §3.1): компонентите са в пакета `react-email` (отделните `@react-email/*` компоненти са отбелязани в npm като остарели); `render` дава HTML и текст. По-новите 6.11.3 и 2.1.1 са от 16.10.2026, по-млади от `minimumReleaseAge`. Внасят се само в `src/server/templates` (ESLint) |
| Изследовател (M05) | `@xyflow/react`; `@tanstack/react-query`; `nuqs`; `@orpc/client`, `@orpc/tanstack-query` | 12.12.0; 5.104.3; 2.10.2; 1.15.7, 1.15.7 | Всички MIT, без install скриптове. React Flow рисува графа (план §4.1, библиотеката не се сменя без собственика) и се зарежда с `next/dynamic` само в `/explore`. TanStack Query с клиента на oRPC носи данните на изгледа (M05 In scope 1), а nuqs пази `focus`, `up`, `down`, `lineage`, `show` и `view` в адреса. `@orpc/client` е със същата версия като сървърния `@orpc/server`; клиентът и пакетите му се внасят само от `src/lib/rpc-client` (ESLint). Бюджетът на `/explore` е в [ADR 0009](0009-explorer.md) |
| Тестове (M05) | `web-vitals` | 6.2.3 | За разработка (devDependency), Apache-2.0, без зависимости и без install скрипт; публикуван на 05.10.2026. Само за E2E измерването на INP (план §5.8 (c)): Playwright инжектира браузърната му сборка в страницата (`e2e/helpers/explorer-checks.ts`), затова не влиза в нито един bundle, а `THIRD_PARTY_NOTICES.md` не се променя |
| Търсене (M07) | `transliteration`, `pinyin-pro`, `to-jyutping`, `opencc-js` | 2.6.2, 3.29.5, 3.1.1, 1.4.2 | Ключовете за търсене на имената (план §5.3, M07; `docs/search.md`): Latin транслитерация на кирилица и други писмености (MIT), пинин с режим за фамилия (MIT), Jyutping (BSD-2-Clause), сгъване на традиционни към опростени йероглифи (MIT за кода, Apache-2.0 за речниците; двата текста са в `THIRD_PARTY_NOTICES.md`, `pnpm notices` чете папката `LICENSES/` по REUSE). Версиите са линиите от плана, с последната patch версия, по-стара от `minimumReleaseAge`. Внасят се само в `src/server/search` (ESLint). Нито един няма install скрипт |
| Форми (M07) | `@tanstack/react-form` | 1.33.5 | TanStack Form за сложните форми (план §5.6): редакторът на профила с редовете на имената; правилата са Zod схема (`src/lib/profile-form-rules.ts`, с `zod/mini`), която редакторът зарежда при първия фокус във формата или при първия запис, а не със страницата: в сборката на Turbopack Zod е около 40 kB gzip JavaScript, и с `zod/mini` (план §5.8 (в)). Последното стабилно издание (2.0 е alpha). Няма install скрипт |
| Доказателства (M10a) | `sharp`, `aws4fetch` | 0.35.5, 1.0.20 | `sharp` (Apache-2.0; готовите `@img/sharp-*` пакети с libvips под LGPL-3.0, текстовете са в `THIRD_PARTY_NOTICES.md`) прекодира качените изображения, за да не стигнат EXIF и GPS до хранилището; вече беше в lockfile-а като незадължителна зависимост на `next` и няма install скрипт. `aws4fetch` (MIT, без зависимости, без install скрипт) подписва заявките на S3 драйвера към SeaweedFS (AWS Signature V4 върху `fetch`) вместо целия AWS SDK. И двата се внасят само от `src/server/storage` (ESLint). Причините са в [ADR 0012](0012-evidence-and-review.md) |

### Docker образи (по `@sha256` digest)

Digest-ите са взети на 16.10.2026 от registry API на Docker Hub (заглавката `docker-content-digest`) и от Docker Hub API. Всички са на индекса (multi-arch), не на отделна платформа.

| Образ | Таг | Digest | Платформи |
|---|---|---|---|
| `postgis/postgis` | `18-3.6` (PostgreSQL 18.6, PostGIS 3.6.4) | `sha256:60f6ad1d21ea86a67d47780b9a0d1e1d200500f62b19293fa834d0dea80b8677` | само `linux/amd64` (в Compose е `platform: linux/amd64`; на Apple Silicon върви с емулация) |
| `axllent/mailpit` | `v1.31.6` | `sha256:23fe39e81bde596a918000b3135c0f85dc8bb4c9ea6be274b051143f3e300387` | amd64, arm64, 386 |
| `chrislusf/seaweedfs` | `4.48` | `sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d` | amd64, arm64, 386, arm |
| `zricethezav/gitleaks` (CI) | `v8.30.1` | `sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f` | amd64, arm64 |

Важно за `postgis/postgis:18-*`: от PostgreSQL 18 образите пазят данните в `/var/lib/postgresql/18/docker` и обявяват `VOLUME /var/lib/postgresql`. Затова томът в `docker-compose.yml` се монтира на `/var/lib/postgresql`, а не на `/var/lib/postgresql/data`. Данните са в именувани томове (не в bind mount под `C:\`), а портовете слушат само на `127.0.0.1`.

SeaweedFS върви като `weed mini` (master, volume, filer и S3 в един процес) без WebDAV, Admin UI, Iceberg и Lance. Администраторската S3 самоличност идва от `AWS_ACCESS_KEY_ID` и `AWS_SECRET_ACCESS_KEY` (в `.env`), а кофите `wcr-evidence` и `wcr-media` се създават при старт чрез `S3_BUCKET`.

GitHub Actions също са закачени по commit SHA: `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `actions/upload-artifact` v7.0.2.

## Настройки на pnpm (`pnpm-workspace.yaml`)

pnpm 12 отказва настройка, която не разпознава, с `ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS`, когато закачената версия съвпада с работещата. Първият `pnpm install` мина с всички настройки по-долу, следователно pnpm 12.14.0 поддържа всяка от тях и **нито една не отпада**.

| Настройка | Стойност | Бележка |
|---|---|---|
| `minimumReleaseAge` | `1440` | Изрично, въпреки че е и вграденото подразбиране |
| `minimumReleaseAgeStrict` | `true` | От pnpm 12.3 е `true` по подразбиране, когато `minimumReleaseAge` е зададен изрично; записан е изрично по план §3.2. Именно той отказа `next@16.4.2` (виж по-горе) |
| `minimumReleaseAgeExcludePrune` | `true` | Маха от `minimumReleaseAgeExclude` записите, които lockfile-ът вече не ползва (път за поправки по сигурността, план §3.2) |
| `strictDepBuilds` | `true` | Install скрипт, който не е в `allowBuilds`, спира инсталацията |
| `blockExoticSubdeps` | `true` | Зависимостите на зависимостите не могат да идват от git или tarball адреси |
| `trustPolicy` | `no-downgrade` | Отказва версия с по-слабо доказателство за доверие от по-рано публикувана |
| `shellEmulator` | `true` | Скриптовете в `package.json` ползват POSIX синтаксис (`NEXT_TELEMETRY_DISABLED=1 next dev`). С вградения емулатор на обвивка pnpm ги пуска еднакво на Linux, macOS и WSL2, а и от PowerShell или cmd, ако някой ги пусне оттам. Емулаторът на pnpm 12.14.0 не поддържа няколко пренасочвания в една команда (`> файл 2>&1`), затова такива команди не се пишат в `package.json`. Командата на `webServer` в `playwright.config.ts` се пуска от Playwright, а не от pnpm, и ползва само пренасочване, което разбират и `sh`, и `cmd.exe`; папката `test-results/` се създава в самия конфиг. Основният път остава WSL2; Windows без WSL2 (Git Bash) е втори, по-бавен път (README, ръководството за администратора и „Облачни сесии, CI и локално“ по-долу) |
| `trustPolicyExclude` | `semver@6.3.1` | Виж следващия раздел |
| `allowBuilds` | `unrs-resolver`, `esbuild`, `ssh2`, `cpu-features`, `protobufjs`, `sharp` (M10a): всички `false` | Виж раздела за install скриптовете |

### Изключение от `trustPolicy`: `semver@6.3.1` (решение по подразбиране)

`trustPolicy: no-downgrade` отказа `semver@6.3.1` („High-risk trust downgrade … possible package takeover“). Пакетът идва чрез `eslint-config-next` → `eslint-plugin-import` (и други пакети на Babel и ESLint) и е само за разработка.

Причината е фалшива тревога: `semver@7.5.2` (15.06.2023) е публикуван с provenance, а `semver@6.3.1` и `semver@5.7.2` са публикувани по-късно (10.07.2023) от същите поддържащи като backport на поправката на ReDoS (CVE-2022-25883) към старите мажорни линии, без provenance. pnpm сравнява по дата на публикуване, затова backport-ът изглежда като понижаване на доверието.

Решението е изключение **само за точната версия** `semver@6.3.1`, без диапазони и шаблони. Всички останали пакети остават под `trustPolicy: no-downgrade`. Ново изключение изисква същата проверка и запис тук. Решението е взето по подразбиране, за да не спира M00, и е посочено в PR за преглед от собственика.

## Install скриптове (`allowBuilds`)

Картата е изведена от изхода на първия `pnpm install` в M00 (с `strictDepBuilds: true` pnpm изброява всеки пакет с install скрипт, който не е решен):

| Пакет | Стойност | Причина |
|---|---|---|
| `unrs-resolver` | `false` | Идва чрез `eslint-config-next` → `eslint-import-resolver-typescript`. Скриптът (`napi-postinstall`) само проверява и при нужда тегли native бинарния файл, ако pnpm не е инсталирал подходящия `@unrs/resolver-binding-*` от `optionalDependencies`. pnpm го инсталира (в облачната сесия `@unrs/resolver-binding-linux-x64-gnu`), затова скриптът не е нужен; `create-next-app` 16.4 също го забранява |

Други пакети с install скрипт в M00 няма: `sharp` 0.35.5 вече няма install скрипт (идва с готови `@img/sharp-*` пакети), а `@next/swc-*` са готови бинарни пакети в `optionalDependencies`. Всеки следващ етап, който добави пакет с install скрипт, го добавя тук с причина; `scripts/verify.d/M00.sh` проверява, че всеки запис в `allowBuilds` е `true` или `false` и е описан в този файл.

Добавени в M01 (`pnpm add` с `strictDepBuilds: true` ги изброи):

| Пакет | Стойност | Причина |
|---|---|---|
| `esbuild` | `false` | Идва чрез `drizzle-kit` (0.25.12) и чрез `tsx` и `vite` (0.28.2). Скриптът `node install.js` само проверява и подменя JavaScript обвивката с бинарния файл за по-бърз старт. pnpm инсталира готовия бинарен пакет от `optionalDependencies` (в облачната сесия `@esbuild/linux-x64`), а обвивката го намира и без скрипта: `tsx`, `drizzle-kit` и Vitest работят |
| `ssh2` | `false` | Идва чрез `@testcontainers/postgresql` → `testcontainers` → `dockerode` → `docker-modem` (SSH връзка към отдалечен Docker). Скриптът се опитва да компилира незадължително native разширение за криптография с `node-gyp`; без него `ssh2` ползва вградения `crypto` на Node. Тестовете се свързват с локалния Docker, не по SSH |
| `cpu-features` | `false` | Незадължителна зависимост на `ssh2`: native модул (`node-gyp rebuild`), с който `ssh2` избира шифри според процесора. Без него `ssh2` работи с подразбиращия се ред на шифрите; няма нужда от компилатор при инсталация |
| `protobufjs` | `false` | Идва чрез `dockerode` → `@grpc/grpc-js` / `@grpc/proto-loader` (BuildKit сесии, които не ползваме). `postinstall` само проверява версиите на зависимостите на CLI-я `pbjs`; библиотеката работи и без него |

Добавен в M10a ([ADR 0012](0012-evidence-and-review.md)):

| Пакет | Стойност | Причина |
|---|---|---|
| `sharp` | `false` | Пряка зависимост от M10a (прекодиране на изображенията на доказателствата). 0.35.5 няма install скрипт и зарежда готовия `@img/sharp-*` бинарен пакет от `optionalDependencies`; изричното `false` гарантира, че компилация от изходен код (`node-gyp`) няма да тръгне, ако бъдещо издание добави такъв скрипт |

## Телеметрия и „agent feedback“ на Next.js (решение по подразбиране, план §10.2 ред 10)

- Телеметрията е изключена с `NEXT_TELEMETRY_DISABLED=1`: в скриптовете `dev`, `build`, `start` и `typecheck` на `package.json`, в CI (`env` на workflow-а), в `.claude/settings.json` и в `.env.example`. Next.js 16.4 чете само тази променлива или глобалната настройка `next telemetry disable`; настройка в `next.config.ts` няма.
- `experimental.agentFeedback` е изрично `false` в `next.config.ts`. „Agent feedback“ изисква телеметрия и добавя инструкции за изпращане на обратна връзка в `AGENTS.md`.
- `AGENTS.md` съдържа само блока с правила, който `next dev` поддържа (`<!-- BEGIN:nextjs-agent-rules -->`); `CLAUDE.md` го импортира с `@AGENTS.md`.

## Облачни сесии, CI и локално

- **Облачна сесия:** няма Docker daemon, а apt.postgresql.org (PGDG) е блокиран. `scripts/cloud-setup.sh` (от SessionStart hook-а) инсталира `postgresql-16`, `postgresql-16-postgis-3` и `postgresql-contrib` от архива на Ubuntu (при M00: PostgreSQL 16.15 и PostGIS 3.4.2) и създава `wingchunroots_test` с `createdb -T template0 -E UTF8 --locale=C.UTF-8`. Скриптът работи само при `CLAUDE_CODE_REMOTE=true` (иначе спира с код 2, освен с `--force` или `--print-env`): на машината на разработчика би инсталирал PostgreSQL на порт 5432 до Docker Compose и би сменил паролата на локалния `postgres`.
- **Еднакви бази навсякъде:** образът `postgis/postgis` зарежда PostGIS и съпътстващите разширения (сред тях `postgis_topology` със схемата `topology`) в базата от `POSTGRES_DB`. Затова в CI и в Docker Compose `POSTGRES_DB` е `postgres`, а базите на приложението се създават празни от `template0` с UTF8 и `C.UTF-8`: `wingchunroots_test` с `docker/postgres/20-create-test-database.sql` (същият файл в Compose и в CI), а `wingchunroots` в Compose с `docker/postgres/20-create-dev-database.sql`. Така тестовата база започва празна и в облачната сесия, и в CI, и локално: миграция, която забрави `CREATE EXTENSION`, пада навсякъде, а интроспекцията на схемата вижда едно и също. `scripts/verify.d/M00.sh` проверява тази настройка. Том на Compose, създаден преди тази промяна, се пресъздава с `docker compose down -v`.
- **Chromium в облачната сесия:** Playwright 1.64.1 очаква Chromium build 1248 (Chrome 156), а в сесията е предварително инсталиран build 1194 (Chromium 141). `scripts/pw-chromium.sh` открива разликата и hook-ът задава `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; проектите на Chromium в `playwright.config.ts` го подават като `executablePath`. `playwright install` не се пуска в сесията. В CI Playwright инсталира своите Chromium и WebKit.
- **CI:** `scripts/verify.sh all` на Node 26.12.1 срещу PostgreSQL 18 + PostGIS 3.6 (service контейнер по digest), с трите проекта на Playwright; отделна задача за сигурност (gitleaks по цялата история, `pnpm audit --prod --audit-level=high`); задачата `ci` минава само ако всички минат и е единствената задължителна проверка за `main`.
- **Локално (Windows с Docker Desktop и WSL2):** `scripts/init-env.sh` създава `.env` с локални пароли, `docker compose up -d --wait` пуска услугите, а `scripts/verify.sh` при нужда сам пуска услугата `postgres`. Изисква `psql` (`sudo apt-get install -y postgresql-client`).
- **Локално, Windows без WSL2 (Git Bash), отклонение от плана:** план §7.6 и риск 32 (§11) слагат хранилището, Node и pnpm в WSL2, защото файловата система там е много по-бърза от диск на Windows. Това остава основният път. За компютър без WSL2 има и втори, по-бавен: хранилището на диск на Windows, командите в Git Bash, Node 26.12.1 от nvm for Windows, pnpm с `npm install --global` (не Corepack), psql от PostgreSQL for Windows, услугите пак в Docker Desktop. Проверен е със `scripts/verify.sh M04` с `PW_WORKERS=2`: с подразбиращия се брой процеси на Playwright проверката на личността в proxy изпуска срока си от 500 ms (README). За да работи и там, кодът и тестовете сравняват пътища с `/`, пускат CLI-те на Node през `process.execPath`, а pnpm през `npm_execpath` (`pnpmCommand` в `scripts/lib/notices.ts`), никога през `node_modules/.bin/*` или голо `pnpm` без обвивка: на Windows това са shim-ове (`.cmd`, `.ps1`, sh), които `execFile` не пуска.

## Скорост на тестовете (26.10.2026, клон `test-speedup`)

Мерено на 8-ядрен компютър с Windows 10 без WSL2 (Git Bash, Docker Desktop, `PW_WORKERS=2`). Нито един тест, проверка, срок или бюджет не е махнат или отслабен.

| Мярка | Преди | След | Как |
|---|---|---|---|
| `pnpm test:int` | 127 s | 87 s (254 теста) | `hardening.int.test.ts` (111 s: изчаква прага на отговора при регистрация и вход, `src/server/auth/answer-floor.ts`) е разделен по `describe` на три файла, всеки със своя база, които вървят едновременно; тестовете са преместени дословно, общите помощници са в `test-support.ts` |
| `pnpm test` | около 87 s | около 80 s (712 теста) | Проектът `unit` върви в нишки без изолация (`pool: 'threads'`, `isolate: false`): 28 s → 15 s. Десетте файла (след прегледа на клона единадесет, виж „Unit тестовете“ по-долу), които подменят модули, променливи на средата, глобални стойности или часовника, остават изолирани (`unit-isolated`, списъкът `ISOLATED` във `vitest.config.mts`); `scripts/vitest-isolation.test.ts` пада, ако друг файл започне да ги ползва, а след прегледа и `scripts/vitest-shared-state.ts`, ако файл остави такова състояние променено |

Мерено и в облачна сесия на Claude Code (4 ядра, Linux, Node 22, PostgreSQL 16 + PostGIS 3.4). На същата машина работят и други агенти, затова всяко пускане е под общ lock, а времената варират от пускане до пускане:

| Мярка | Преди (`main`, `2dd27c7`) | След (клонът) |
|---|---|---|
| `pnpm test:int` | 108–111 s | 91–117 s (медиана 100 s); 94 s след прегледа |
| Най-дългият интеграционен файл | 104 s (`hardening.int.test.ts`) | 40 s |
| `pnpm test` | 53–66 s | 48–59 s; 51–52 s след прегледа |
| `pnpm test` без `timed` | 17 s | 12 s |

Там `timed` е около 34 s и в двата случая. `pnpm test:int` слиза по-малко, отколкото на компютъра на собственика: Vitest пуска 3 файла наведнъж и общото време упира в сумата от около 190 s работа.

Опитано и отхвърлено:

- **Двата файла с бюджети за време едновременно** (`timed`, около 62 s от `pnpm test`): 66 s → 45 s, но изгледът от 500 души стигна 2073 ms от бюджета си от 2500 ms (сам: 1933–2056 ms). Твърде малко резерв за CI с 4 ядра; остават един след друг.
- **4 работника за E2E на Windows:** 300 s → 248 s за `@smoke|@M04`, но проверката на proxy (500 ms) изтече веднъж и тестът за скрита личност падна. Остават 2 (README).
- **`resultTypes: ['violations']` за axe:** без разлика (79 s → 78 s за тестовете за axe на M04); бавни са зарежданията на страниците, не axe.
- **Шаблонна база за интеграционните тестове:** създаването на база е 0,7–2,5 s, печалбата е малка.
- **Общо състояние за влизане в E2E:** около 15 s най-много, а тестовете, които прекратяват сесии или броят опитите за вход, се нуждаят от свое влизане.

`scripts/verify.sh M04` на клона: всички стъпки минават (`test:int` 83 s); падат само двете проверки „ръководството е променено в този клон“, които важат за клона на M04. В облачната сесия (на `b3fc505`, 581 s) също минават всички стъпки, с E2E `@smoke|@M04` (148 теста); там пада само проверката за ръководството на потребителя, защото клонът вече променя ръководството на администратора.

Следваща стъпка извън този клон: разделяне на E2E в CI на паралелни задачи (`--shard`), без измерване тук.

### Unit тестовете: три проекта и списъкът `ISOLATED`

Поводът за ускоряването: пусканията на тестовете (10–40 минути с E2E) бяха твърде дълги. То сменя само как Vitest пуска файловете; нито един тест не е пропуснат.

- **Три проекта** във `vitest.config.mts`:
  - `unit` — повечето файлове, в нишки (`pool: 'threads'`) с `isolate: false`: файловете в една нишка споделят заредените модули, затова React, Zod, Better Auth и кодът на приложението се зареждат веднъж на нишка, а не за всеки файл. След всеки файл Vitest сам връща шпионите на `vi.spyOn` и маха регистрираните `vi.mock`, но не връща `process.env`, глобалните обекти, фалшивите таймери и състоянието вътре в модулите.
  - `unit-isolated` — списъкът `ISOLATED`: файловете, които променят такова състояние (`vi.mock`/`vi.doMock`, `vi.resetModules`, `vi.stubEnv`/`vi.stubGlobal`, запис в `process.env`, в свойство на `globalThis` или в метод на `Date`, `Math`, `console` и `JSON` (`fetch`, `Date.now`, `console.error`), слушател на `process`, фалшиви таймери, или модул със състояние, който тестът оставя другаде). Те вървят с изолация, както преди: всеки файл с нов граф на модулите. Прегледът на клона добави единадесетия, `src/server/db/ids.test.ts`: два от тестовете му местеха часовника на `uuidv7()` в 2027 и 2030 г., което следващите файлове в нишката биха наследили; сега всеки тест взима нов модул.
  - `timed` — `TIMED` (тестовете за време на подредбата, M03), без промяна: след другите, един по един.
- **Две проверки пазят списъка.** `scripts/vitest-isolation.test.ts` чете кода на тестовите файлове (без коментарите и без текста в низовете) и пада, когато файл извън `ISOLATED` и `TIMED` ползва някое от тези API-та или записва в свойство на `process`, `globalThis`/`global`, `Date`, `Math`, `console` или `JSON`, където и да е на реда (и когато списъкът съдържа несъществуващ файл). `scripts/vitest-shared-state.ts`, setup файл на проекта `unit`, сравнява преди и след всеки файл `process.env`, фалшивите таймери и собствените свойства на `globalThis`, `Date`, `Math`, `console` и `JSON`, проваля файла, който е оставил някое от тях променено или изтрито (печата само имената, не стойностите), и го връща за следващия файл. Нови свойства са позволени, защото библиотеките сами добавят свои глобални обекти при първо ползване; шпионите на `vi.spyOn` не се броят, защото Vitest ги връща след всеки файл. Тя хваща и промяна през помощен модул или през кода под тест, която четенето на текста не вижда. Нито една от двете не вижда състояние в модул, което тестът променя през обикновена функция, методите на `process` (graceful-fs подменя `process.cwd` и `process.chdir` веднъж на нишка) и вградените обекти извън петте (`Array.prototype`, `Promise`, `Error`): такъв файл се добавя при преглед.
- **Как се добавя файл:** пътят му от корена на хранилището влиза в `ISOLATED` във `vitest.config.mts`, по азбучен ред; `pnpm test` трябва да мине. Когато някоя от двете проверки падне, съобщението казва кой файл да се добави; проверката не се заобикаля с друг запис на същото API. PR, който добавя такъв тестов файл, добавя и реда.

### Интеграционните тестове: разделеният `hardening.int.test.ts`

`src/server/auth/hardening.int.test.ts` изчакваше минималните времена за отговор на регистрацията и входа (800 и 500 ms) последователно и беше най-бавният файл. Разделен е на три файла: `hardening.int.test.ts` (поемане на адрес, отговорът на регистрацията, времената, линковете, опашката), `hardening-limits.int.test.ts` (ограниченията, вторият фактор, публичното разгръщане, съгласията) и `hardening-lockout.int.test.ts` (никой не може да заключи собственика), с общите помощници в `src/server/auth/test-support.ts`. Всеки файл създава своя база, затова Vitest ги пуска паралелно (`pool: 'forks'`). Тестовете са преместени дословно: 38 теста (15 + 17 + 6), сравнени по заглавие и тяло.

## Renovate

`renovate.json`: точни версии (`rangeStrategy: pin`), `minimumReleaseAge: 3 days` за обикновените обновявания (повече от строгия ден на pnpm), седмичен график (понеделник преди 6:00, Europe/Sofia) за обновяванията и за digest-ите на образите и действията, а поправките по сигурността (`vulnerabilityAlerts`, OSV) — по всяко време и без изчакване. Next.js и React са в една група. Ограничения: `typescript <6.1`, `eslint <10`, `@types/node <25`; мажорните и минорните версии на `postgis/postgis` и на Node се обновяват като отделни цели (план §9), а Renovate обновява само digest-ите им.

Поправка по сигурността, по-млада от един ден, се спира от строгия `minimumReleaseAge` на pnpm и `pnpm install --frozen-lockfile` в CI пада. Това не става автоматично: Renovate отваря PR-а веднага (`vulnerabilityAlerts.minimumReleaseAge: null`, за да не се губи време), а `prBodyNotes` в него напомня следващата стъпка. PR-ът добавя точната версия в `minimumReleaseAgeExclude` в `pnpm-workspace.yaml` с причина в описанието; записът се маха, след като версията навърши един ден (`minimumReleaseAgeExcludePrune` го маха и сам, щом lockfile-ът вече не го ползва). Настройката не се отслабва глобално.

## Последствия

- Всяко обновяване на версия е отделен PR. Поправка по сигурността, по-млада от един ден, се добавя в `minimumReleaseAgeExclude` в същия PR (виж „Renovate“; според плана `pnpm audit --fix` го прави сам, но при pnpm 12.14.0 това не е проверено), а `minimumReleaseAgeExcludePrune` маха записа после.
- SQL-ът се изпитва на PostgreSQL 16 (облачна сесия) и на 18 (CI), затова не ползва функции само от 17 или 18.
- Не са упражнени в облачната сесия при M00 (нямат Docker или WebKit): Docker Compose (`docker compose config` е валиден), проектът `mobile-webkit`, PostgreSQL 18 и gitleaks. Те се проверяват в CI и на машината на собственика.
