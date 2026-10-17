# M01 — Модел на данни, роли в базата и фиктивни данни

`docs/plan/M01-data-model.md` · клон `m01-data-model` · таван 40 хода · D03, D05, D12, D13, D20, D22

## Цел (Objective)

Всички основни таблици на Фаза 1 съществуват като Drizzle схема и миграции върху PostgreSQL с PostGIS, със SQL, който работи на PostgreSQL 16+ и PostGIS 3.4+ (облачната сесия) и на 18 (CI). Ролите и публичните изгледи в базата налагат поверителността още на ниво база. Детерминиран набор от фиктивни данни се зарежда с една команда.

## Прочети първо (Read first)

`docs/WingChunRoots_Technical_Plan.bg.md`: §3.2 („PostgreSQL 16 в облачните сесии…“), §5.3 (правилата за имената), §6.2, §6.3, §6.4, §6.6, §6.7.

## Зависимости (Dependencies)

M00. Върви паралелно с M00b и M03.

## Обхват (In scope)

1. **Drizzle и скриптове.** Drizzle ORM 1.0 RC (точна версия) и drizzle-kit; `drizzle.config.ts`; миграции в `drizzle/`. Скриптове:
   - `pnpm db:migrate` и `pnpm db:seed`;
   - `pnpm db:reset`: отказва да работи при `NODE_ENV=production` или при хост, който не е локален или `TEST_DATABASE_URL`;
   - `pnpm db:check`: `drizzle-kit check` и прилагане на всички миграции в празна база.
2. **Разширения.** `postgis`, `pg_trgm`, `unaccent`, `fuzzystrmatch`. Базата е с UTF-8 локал.
3. **Роли.** `scripts/db-bootstrap.sql` създава `migrator`, `app_rw` и `app_public_ro` с пароли от средата. Пуска се веднъж за всяка среда от суперпотребител: локално, в CI и от SessionStart hook-а. Миграциите съдържат само `GRANT` и `REVOKE` (план §6.2).
4. **Таблици.** Тези от план §6.2, включително `person.visibility`, без таблиците на Better Auth (M02) и без `media_asset` (Фаза 2). Колоните `*_user_id` са `uuid` без външен ключ; M02 добавя външните ключове.
5. **География.** `place.centroid`, `school.public_point` и `school_private_location.exact_point` са `geography(Point,4326)`, декларирани чрез `customType` в `src/server/db/schema/geography.ts`, всяка с GiST индекс върху колоната (план §6.2).
6. **Ограничения и индекси.**
   - `CHECK (teacher_person_id <> student_person_id)`;
   - частичен уникален индекс за активните статуси;
   - покриващи индекси `(student_person_id) INCLUDE (teacher_person_id, status, lineage_id)` и обратният по учител;
   - GIN `gin_trgm_ops` и B-tree `text_pattern_ops` на `person_name_key.key`;
   - идентификатори UUIDv7, генерирани от приложението (`src/server/db/ids.ts`, Drizzle `$defaultFn`), с резервно `DEFAULT gen_random_uuid()`; без `uuidv7()` на PostgreSQL 18 (план §6.2).
7. **Изгледи.** `v_public_person` (само `visibility = 'public'`), `v_public_edge` (само `verified` и `in_arbitration` с `visibility = 'public'`) и `v_public_school`. Правата са по план §6.2.
8. **Одитен журнал.** `REVOKE UPDATE, DELETE` от `app_rw` и тригер, който отказва промяна в `audit_log`. Колоната за IP е `ip_hmac` (план §6.2).
9. **Достъп до базата.** `src/server/db/` с двете връзки и помощна функция за тестове: Testcontainers или `TEST_DATABASE_URL`.
10. **Генератор на фиктивни данни** `src/fixtures/generate.ts` (детерминиран, със seed):
    - 550–650 души в 3 линии; 2 „хъба“ с ≥ 120 ученици всеки;
    - 6–10% с двама учители в една линия; 2–4% с учител от друга линия; 1–3% само с исторически връзки;
    - поне по една връзка във всеки статус от план §6.7;
    - всяко име има основно изписване на латиница; много хора имат и име с традиционни или опростени китайски йероглифи, с Jyutping и пинин; няколко имат име на кирилица (за проверка на Unicode); има псевдоними и романизации;
    - всички slug-ове започват с `demo-`, а всяка биография съдържа „Fictional demo record“;
    - `person.visibility` е `public` за хората с поне една публична връзка.

    Опорни записи с фиксирани slug-ове за тестовете:
    - корени и хъбове: `demo-root-a`, `demo-root-b`, `demo-root-c` (исторически корен), `demo-shared-ancestor` (измислен исторически учител над `demo-root-a` и `demo-root-b`), `demo-hub-a`, `demo-hub-b`;
    - връзки: `demo-two-lineages` (двама активни потвърдени учители в различни линии и поне по един ученик във всяка от тях; свързва клоновете под `demo-shared-ancestor` с връзка към друга линия), `demo-converging`, `demo-historical-only`, `demo-pending`, `demo-under-review`, `demo-arbitration`;
    - `demo-claim-only-teacher`: запис, създаден само от заявката на `demo-under-review`, с `visibility = 'involved_only'`;
    - имена: `demo-cjk-name` (традиционни йероглифи, Jyutping и пинин), `demo-cyrillic-name`, `demo-latin-name` (основно име „Ivan Testov“, измислено);
    - квоти: `demo-free-sifu-5` (5 потвърдени ученици и една чакаща заявка), `demo-pro-sifu-8` (8 потвърдени ученици);
    - школи: няколко фиктивни школи в реални градове от малко извлечение от GeoNames за страните по подразбиране от M11 (BG, GR, DE, GB, US, HK), сред тях `demo-school-city-only` в режим „само град“ и `demo-school-two-lineages` с инструктор `demo-two-lineages`.

    Данните се експортират и в `fixtures/lineage-600.json` във формата от план §6.3 (за M03 и M05).
11. **Документация** на български: `docs/data-model.md` (включително `ip_hmac` като лични данни със срок на пазене) и `docs/adr/0002-data-model.md`.

## Извън обхват (Out of scope)

Таблиците на Better Auth (M02). Бизнес логика, API и UI. Схемата на pg-boss (M01b). Генериране на ключове за търсене (M07; таблицата `person_name_key` може да остане празна).

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: пароли и тайни няма в миграциите и в хранилището; без функции само за PostgreSQL 17 или 18.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M01` завършва с `VERIFY M01: PASS`. Включва `pnpm test:int`, `pnpm db:check` и `pnpm db:reset && pnpm db:migrate && pnpm db:seed` срещу `TEST_DATABASE_URL`.
2. Интеграционни тестове в `src/server/db/*.int.test.ts`, които минават на PostgreSQL 16 (облачната сесия) и на 18 (CI) и доказват, че:
   - всички миграции се прилагат в празна база, а `drizzle-kit check` не открива конфликти;
   - `show_trgm('Тестов')` не е празно, т.е. локалът е UTF-8;
   - връзка на човек със самия себе си и дублирана активна връзка се отказват;
   - `app_public_ro` получава permission denied за `school_private_location` и `evidence_file`;
   - `UPDATE` и `DELETE` върху `audit_log` се отказват за `app_rw`;
   - `v_public_edge` съдържа само `verified` и `in_arbitration` с `visibility = 'public'`, а `demo-pending` не се вижда;
   - `v_public_person` не съдържа `demo-claim-only-teacher`;
   - `school.public_point` е от тип `geography`;
   - новите идентификатори са UUID версия 7;
   - две поредни зареждания на данните дават еднакъв хеш на съдържанието;
   - статистиките на данните са в диапазоните от точка 10.
3. `scripts/verify.d/M01.sh` проверява, че миграциите не викат `uuidv7()`.
4. Съществуват: `drizzle.config.ts`, `drizzle/` (поне една миграция), `src/server/db/schema/`, `src/server/db/ids.ts`, `scripts/db-bootstrap.sql`, `src/fixtures/generate.ts`, `fixtures/lineage-600.json`, `docs/data-model.md`, `docs/adr/0002-data-model.md`, `scripts/verify.d/M01.sh`.
5. PR, зелен CI, чист `git status`.

## Кога да спре и да попита (Stop and ask)

Общите условия, а освен това:

- PostGIS не може да се инсталира в сесията;
- значението на някой статус не е ясно от план §6.7. Тогава се ползва план §6.7 и въпросът се записва, но етапът продължава.

Блокираща грешка в Drizzle RC не е причина за спиране: преминава се на 0.45.4 и това се записва.

## Ред за /goal

```text
/goal Implement milestone M01 exactly as written in docs/plan/M01-data-model.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. First run `git fetch origin`. If branch m01-data-model exists on origin, check it out and continue from its Progress log and any answered question in docs/plan/questions/M01.md; otherwise branch from origin/main. If a milestone listed under Dependencies is not merged into origin/main, print `BLOCKED M01: dependency <milestone> not merged`. Begin every turn with the line `M01 turn <n>/40`. Success: the goal is met when this conversation shows all of: (1) the step summary printed by `scripts/verify.sh M01`, ending with the line `VERIFY M01: PASS`; (2) the work committed and pushed on branch m01-data-model with a PR to main whose description is in English and includes that step summary; (3) the PR's CI checks all passed, including the integration tests on PostgreSQL 18 (show the GitHub tool output or `gh pr checks`); (4) `git status` showing a clean tree. Respect the Out of scope, Constraints and Stop and ask sections. SQL must run on PostgreSQL 16+ with PostGIS 3.4+: generate UUIDv7 in the application and use no PostgreSQL 17/18-only feature. Use only clearly fictional fixture data. Commit and push after every green checkpoint and add one line per checkpoint to the Progress log. Run /code-review on the diff before the final verify and fix only correctness or requirement gaps. Never delete, skip or weaken a test or check to get a pass. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M01.md, commit and push. The goal also ends, not as success, when you print a `BLOCKED M01: <one-line reason>` line (after recording any question as above) or `STOPPED M01: turn limit` followed by a progress summary after 40 turns.
```

## Дневник на напредъка (Progress log)

- 2026-10-16 18:10 — Drizzle 1.0.0-rc.4 схема и три миграции (разширения, таблици, изгледи/права/одитен тригер), `scripts/db-bootstrap.sql`, `pnpm db:migrate|seed|reset|check`, генератор на 600 фиктивни души и `fixtures/lineage-600.json`; lint, typecheck и unit са зелени, `db:reset && db:migrate && db:seed` и `db:check` минават на PostgreSQL 16.15 / PostGIS 3.4.2 (222dd85)
- 2026-10-16 18:30 — интеграционни тестове (42) на PostgreSQL 16.15, `scripts/verify.d/M01.sh`, bootstrap на ролите в `verify.sh`, `cloud-setup.sh` и CI, `docs/data-model.md` и ADR 0002; `scripts/verify.sh M01` → PASS (8d04268)
- 2026-10-16 18:40 — преглед на кода: `relationship_event` с `ON DELETE RESTRICT` (нова миграция), тест за пълнотата на списъка с таблици в `db:seed`, поправки в `docs/data-model.md`; `scripts/verify.sh M01` → PASS (86c6baa)
- 2026-10-16 18:45 — отворен PR #3 към `m00-foundation` (стъпково над PR #2); статусът в `docs/plan/README.md` е „PR отворен“
- 2026-10-16 18:55 — CI (PostgreSQL 18): `ON DELETE RESTRICT` дава код 23001, а не 23503 като на 16; тестът приема и двата; `scripts/verify.sh M01` → PASS (6ea7f4f)
- 2026-10-16 21:45 — независим преглед на M01 (клон `m01-review-fixes`, след сливането на PR #3 в `m00-foundation`): тригер пази центроида в `school.public_point` при `city_only`; `is_display_primary` само за `verified`/`in_arbitration` (нова миграция и `CHECK`); `v_public_edge` иска основно име и на двата края; `app_public_ro` без `TEMPORARY` и тест за пълния списък с релациите ѝ; слушател за `error` на пуловете; проверка за psql 15+; без пароли в командния ред и в `.verify/M01.log`; `.env` с CRLF; drizzle-kit през `node`; `scripts/verify.sh M01` → PASS (f62b144)
- 2026-10-16 21:55 — отворен PR #6 към `main` (след #5) с поправките от прегледа; статусът в `docs/plan/README.md` е обновен
