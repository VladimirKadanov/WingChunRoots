# M12 — Локално пускане като в production, основно наблюдение, локален архив и учение по възстановяване

`docs/plan/M12-local-ops.md` · клон `m12-local-ops` · таван 40 хода · D24

## Цел (Objective)

Приложението има един Docker образ за `web` и `worker`, който върви локално като в production с Docker Compose, включително на Windows с Docker Desktop и WSL2. Има основно наблюдение без лични данни, локален архив с `pg_dump` и автоматично учение по възстановяване, което мери времето. Всичко се доказва в CI без тайни и без облачни услуги. Хостингът остава отложен (план §3.3).

## Прочети първо (Read first)

`docs/WingChunRoots_Technical_Plan.bg.md`: §3.1 (реда „Архиви“), §3.3, §6.4, §7.6, §7.7, §10.1 (D24).

## Зависимости (Dependencies)

M10b, M11 (и всички етапи преди тях).

## Обхват (In scope)

1. **Образ и Compose.**
   - `Dockerfile` (`node:26.12.1-trixie-slim`, Next.js standalone, команди `web` и `worker`, процесът не върви като root); базовите образи са по digest.
   - Профил `app` в `docker-compose.yml`: `web` (една реплика, план §7.6), `worker`, еднократната услуга `migrate` с ролята `migrator`, PostGIS, Mailpit и SeaweedFS. `docker compose --profile app up --build` пуска всичко на `http://localhost:3000`.
   - `scripts/check-env.sh` спира стартирането, ако липсва задължителна променлива или ако стойност е оставена като примерната от `.env.example`.
2. **Наблюдение.**
   - pino JSON логове с идентификатор на заявката и изчистване на личните полета.
   - `/healthz` проверява базата и опашката вътрешно, но връща само `{"ok":true}` и код на състоянието.
   - `/admin/system` (персонал с проверен втори фактор): дълбочина на опашката, неуспешни задачи, неуспешни доставки на имейли, време на последния архив.
   - Външна услуга за грешки не се добавя (план §3.3). Логерът има функция `reportError` с празен доставчик, която по-късно може да се свърже със Sentry.
3. **Архив и възстановяване.**
   - `scripts/backup-local.sh`: `pg_dump -Fc` в `backups/` (в `.gitignore`), с дата в името и файл със SHA-256; пази последните 14 копия; по желание копира и обектите от SeaweedFS или от локалната папка в `backups/objects/`.
   - `scripts/restore-drill.sh`: възстановяване във временна база (временен контейнер `postgis/postgis:18-3.6` локално или отделна база в PostgreSQL на облачната сесия), после `amcheck`, броене на редовете, проверка на външните ключове, проверка за цикли и връзки на човек със себе си сред потвърдените ребра, очакваните пътища до предците в данните, извадка от SHA-256 на доказателствата спрямо `evidence_file.sha256` (хешът на съхранения обект) и наличие на таблиците на Better Auth. Скриптът отпечатва времето за възстановяване и се проваля, ако то надхвърли RTO (4 часа, `DEFAULT D24`).
   - `pg_dump` и `pg_restore` са от същата основна версия като сървъра: локално и в CI се пускат в контейнера на базата (`docker compose exec` или `docker exec`), а в облачната сесия са от PostgreSQL 16. `pg_dump` 16 отказва да архивира сървър 18.
   - `.github/workflows/restore-drill.yml`: архив, възстановяване и проверките върху PostgreSQL 18 като service контейнер. Пуска се седмично и при PR, който пипа `scripts/backup-local.sh`, `scripts/restore-drill.sh` или `drizzle/`. Не ползва тайни.
4. **CI.** Задача `image`: build на образа, стартиране с профила `app`, проверка на `/healthz` и пакета `@smoke` срещу контейнера.
5. **Документи на български.**
   - `docs/operations/local-run.md`: пускане като в production на Windows (Docker Desktop, WSL2), Linux и macOS; обновяване; спиране.
   - `docs/operations/backup-and-restore.md`: локалният архив, учението, RPO на локалния пилот (до последния архив) и RTO до 4 часа (`DEFAULT D24`); какво се променя с хостинга (план §3.3).
   - `docs/operations/incident.md`: срок за отговор на поддръжката в пилота (`DEFAULT D24`) и стъпки при изтичане на данни.
   - `docs/guides/admin-guide.bg.md`: пускане, архив, възстановяване и `/admin/system`, написани за българския администратор.

## Извън обхват (Out of scope)

Хостинг, тестова и реална среда в облака, разгръщане, публикуване на образи, облачни архиви и второ копие, Sentry, Healthchecks, pgBackRest, домейн (отложеният етап, план §3.3). Пакетът `@pilot` (M13).

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: никакви облачни или платени ресурси и никакви тайни на реални услуги.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M12` завършва с `VERIFY M12: PASS`. Включва `scripts/backup-local.sh` и `scripts/restore-drill.sh` срещу `TEST_DATABASE_URL`, като учението отпечатва времето за възстановяване.
2. Тестове:
   - `logger.redaction.test.ts`: pino маха имейл, име, IP и координати;
   - `scripts/check-env.test.sh` (вика се от `scripts/verify.d/M12.sh`): липсваща задължителна променлива или примерна стойност спира стартирането;
   - `e2e/ops.spec.ts › @M12 /healthz returns only {"ok":true}`;
   - `e2e/ops.spec.ts › @M12 /admin/system shows queue depth and the last backup time to verified staff only`.
3. Задачите в CI `image` и `restore-drill` са зелени в PR.
4. Съществуват `Dockerfile`, профилът `app` в `docker-compose.yml`, `scripts/check-env.sh`, `scripts/backup-local.sh`, `scripts/restore-drill.sh`, `.github/workflows/restore-drill.yml`, трите документа в `docs/operations/`, `docs/screenshots/M12/` (`/admin/system`) и обновеният `docs/guides/admin-guide.bg.md`.
5. Изпълнен е `/security-review`. PR, зелен CI, чист `git status`.

## Кога да спре и да попита (Stop and ask)

Общите условия. Особено при всяка стъпка, която изисква облачна услуга, платен ресурс или реална тайна: хостингът е отложен.

## Ред за /goal

```text
/goal Implement milestone M12 exactly as written in docs/plan/M12-local-ops.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. First run `git fetch origin`. If branch m12-local-ops exists on origin, check it out and continue from its Progress log and any answered question in docs/plan/questions/M12.md; otherwise branch from origin/main. If a milestone listed under Dependencies is not merged into origin/main, print `BLOCKED M12: dependency <milestone> not merged`. Begin every turn with the line `M12 turn <n>/40`. Success: the goal is met when this conversation shows all of: (1) the step summary printed by `scripts/verify.sh M12`, ending with the line `VERIFY M12: PASS` and including the restore drill with its duration; (2) the work committed and pushed on branch m12-local-ops with a PR to main whose description is in English and includes that step summary; (3) the PR's CI checks all passed, including the image and restore-drill jobs (show the GitHub tool output or `gh pr checks`); (4) `git status` showing a clean tree. Respect the Out of scope, Constraints and Stop and ask sections. Everything runs locally: never deploy, create cloud or paid resources, or use real-service secrets. Update the Bulgarian admin guide in docs/guides/. Commit and push after every green checkpoint and add one line per checkpoint to the Progress log. Before the final verify run /code-review and /security-review on the diff and fix correctness, security or requirement gaps only. Never delete, skip or weaken a test or check to get a pass. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M12.md, commit and push. The goal also ends, not as success, when you print a `BLOCKED M12: <one-line reason>` line (after recording any question as above) or `STOPPED M12: turn limit` followed by a progress summary after 40 turns.
```

## Дневник на напредъка (Progress log)

- 2026-11-01 09:20 — pino 10.4.0 със структурирани JSON редове, `requestId`, заличаване на адреси, имена, IP и координати (`logger.redaction.test.ts`), `onRequestError` и `reportError` с празен доставчик (43e0ebc); `/healthz`, `system.status` (`GET /api/v1/admin/system`, персонал с втори фактор) и страницата `/admin/system`, `output: standalone` (1407ca6)
- 2026-11-01 09:50 — `scripts/backup-local.sh` и `scripts/restore-drill.sh` (време 1,3 s срещу RTO 4 h, DEFAULT D24; amcheck, редове, външни ключове, цикли, пътища до предците, SHA-256 на доказателствата, таблиците на Better Auth), `restore-drill.yml` (dc082e4); `Dockerfile`, профилът `app`, `scripts/check-env.sh` с теста му и задачата `image` в CI (da9136d); `e2e/ops.spec.ts` минава на desktop и mobile Chromium (e70b35d); заявката за имейлите на `/admin/system` поправена с интеграционен тест (db5806a)
- 2026-11-01 12:55 — всички логове на доказателствата и задачите минават през pino (8116a4e); поправки от прегледа на кода: паралелни проверки, ред за стар архив, потребител на тренировъчния контейнер, SHA-256 при възстановяване на обектите (79c66eb); `scripts/verify.d/M12.sh` (86def91); документи в `docs/operations/`, ADR 0013 (след сливането с M10b и M11 — ADR 0015), ръководство на администратора, въпроси към собственика (62e7c07)
- 2026-11-01 13:55 — преглед на сигурността без находки; снимките на `/admin/system` наново (d929cae); проверките на M12 съвпадат с многоредов код и кирилски заглавия (502ac27); `scripts/verify.sh M12`: PASS, учението възстановява за 1,3 s (RTO 4 h)
- 2026-11-01 19:30 — слят `origin/main` с M10b (PR #22) и M11 (PR #23, ea0b7a0) с merge commit (5db77d1): ADR на M12 преномериран на 0015 (`docs/adr/0015-local-ops.md`; 0013 е на M10b, 0014 на M11) с всички препратки; таймаутът на `verify` в CI остава 90 min (едно копие), задачата `image` и `ci needs image` остават, както и поправката на името на образа в Compose (beeb55d); раздел 18 на ръководството на администратора след 16 (M10b) и 17 (M11); lockfile и лицензи наново. Покритие (0b8038a): редакцията на логовете маха и ключовете на M10b и M11 (`teacherAddress` и всеки `*address`, `inviteeName`, `lineageName`, `rootName`, `asciiName`, `addressLine`, `publicPoint`, `centroid`, `pin`); учението по възстановяване проверява и частните таблици (доказателства, покани, поемане, сигнали, история на прегледа, `school_private_location`, одит); `outputFileTracingIncludes` носи шрифтовете на Open Graph изображението на школа в standalone сървъра (без тях образът връщаше 500). Въпрос 3 в `questions/M12.md`: проверката на M00b за шрифтовете на Google пада на копието на `@vercel/og` в `.next/standalone`. `scripts/verify.sh M12`: PASS (учение 1,5 s); `M11` и `M10b` минават всичко освен локалните проверки спрямо merge base (ръководството на потребителя не е пипано в клона; M11 — „точно една нова миграция в клона“), които в плиткия checkout на CI не се проверяват.
- 01.11.2026: standalone сървърът на Next.js се сглобява само в Docker образа (`WCR_STANDALONE=1`), така че `.next` на останалите сборки няма копие на `node_modules` и проверката за шрифтове на M00b минава без промяна (въпрос 3 в questions/M12.md, приложен вариант 1); редовете на M10b и M11 в docs/plan/README.md са „слят“; `scripts/verify.sh M12` завършва с PASS.
- 2026-11-01 20:15 — поправки от независимия преглед: hook-ът на pino чисти всеки аргумент (грешка без съобщение и обекти в `%o`/`%j`/`%s`, нови тестове, падат без поправката; d62df91); логът на `pg_restore` в учението е частен (`umask 077`, `mktemp`, трие се) и при грешка показва само редовете с грешката без DETAIL/CONTEXT (3d69868); `web` монтира `${BACKUP_DIR:-./backups}`, а `migrate` взема `DB_MIGRATOR_PASSWORD` отделно и я кодира (`migratorUrl`; 9399215, 4d342f5); `scripts/verify.sh M12` завършва с PASS
