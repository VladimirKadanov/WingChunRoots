# M04 — API за родословието, публичен профил и списъчен изглед

`docs/plan/M04-lineage-api.md` · клон `m04-lineage-api` · таван 40 хода · D03, D05, D22

## Цел (Objective)

Всеки може да отвори публичен профил на личност и списъчен изглед на нейното родословие, рендериран на сървъра. Процедурите на oRPC за родословието връщат филтрирани по поверителност подграфи с таван, във формата от план §6.3. Те са достъпни и през OpenAPI под `/api/v1`, а договорът е в `docs/api/openapi.json` (план §6.8).

## Прочети първо (Read first)

`docs/WingChunRoots_Technical_Plan.bg.md`: §4.3, §4.10, §5.6, §5.8, §6.2, §6.3, §6.4, §6.8; `docs/design/direction.md`.

## Зависимости (Dependencies)

M02.

## Обхват (In scope)

1. **oRPC 1.15** със Zod 4. Рутерът и контекстът от M02 обслужват `/api/rpc`, а M04 добавя `OpenAPIHandler` под `/api/v1`, командата `pnpm api:openapi` и проверката `pnpm api:openapi --check` в CI (план §6.8). Процедури:
   - `lineage.ego({ focusId, up, down, fanoutLimit })`;
   - `lineage.ancestors({ focusId })`;
   - `lineage.subtree({ rootId, lineageId?, depth })`;
   - `lineage.paths({ focusId, limit })`.

   Всяка задава `SET LOCAL statement_timeout = '2s'`. Таванът е около 500 възела, а излишъкът отива в `hiddenCounts`.
2. **Поверителност.** Анонимните заявки ползват `app_public_ro`, `v_public_person` и `v_public_edge`. Когато влезлият потребител е участник във връзката, отделен източник добавя неговите `involved_only` връзки с отбелязана видимост (D03). `childCount` и `hiddenCounts` се броят само от `v_public_edge`.
3. **Публични DTO** (`src/server/dto/public.ts`) преди всяко `'use cache'`. Тагове `person:<id>` и `lineage:<rootId>`. Резултатите за конкретен потребител никога не се кешират.
4. **`/people/[slug]`** (RSC): имена с `lang` и `translate="no"`, жизнен статус, място, учители и ученици със статус като текст и икона, връзки към изследователя и към списъчния изглед. Скрита личност връща 404.
5. **`/people/[slug]/lineage`:** списъчният изглед от план §4.10. Работи без JavaScript. Дървото на наследниците е от вложени `<ul>` с `<details>`/`<summary>` и връзки, разгънато на сървъра до 2 нива, без `role=tree`.
6. **Общи компоненти.** Легендата на статусите (икона и текст, споделена с M05). Състояния за зареждане, празно, грешка (`catchError` с бутон Retry) и съзнателно 404 за скрити личности. За теста на грешката има превключвател `WCR_TEST_FAULTS=lineage-once`, който работи само извън production и проваля услугата за родословие веднъж.
7. **Измерване на заявките.** `pnpm perf:queries` пуска отново его-мрежата, предците и поддървото на наличната версия на PostgreSQL (16 в облачната сесия, 18 локално и в CI) с ключове `uuid` и с изгледите, върху генериран граф от около 100 000 връзки, и записва резултата заедно с версията в `docs/perf/api.md` (план §6.3).
8. **Документация:** `docs/api/lineage.md` на български, с връзка към `docs/api/openapi.json`.
9. **Ръководство:** `docs/guides/user-guide.bg.md` описва публичния профил и списъчния изглед.

## Извън обхват (Out of scope)

Интерактивният граф (M05), търсенето (M07), всякаква редакция.

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: превключвателят за грешки не съществува в production сборката.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M04` завършва с `VERIFY M04: PASS`.
2. E2E тестове в `e2e/m04-lineage.spec.ts`:
   - `@M04 profile of demo-two-lineages lists two teachers from different lineages with status text`
   - `@M04 list view shows the routes of descent with JavaScript disabled`
   - `@M04 with JavaScript disabled the descendants outline uses details and summary and contains no role=tree`
   - `@M04 anonymous viewer never receives pending or under-review edges (HTML and API)`
   - `@M04 the involved student sees their own pending request marked "Pending"`
   - `@M04 lineage.ego on demo-hub-a caps students and reports hiddenCounts`
   - `@M04 a pending request to demo-hub-a does not change its hiddenCounts or descendant count for an anonymous viewer`
   - `@M04 a person with two teachers appears under both in the outline, marked "also a student of"`
   - `@M04 when the lineage service fails once, the profile shows the catchError state with Retry, and Retry recovers`
   - `@M04 profile and list view at 390x844 have no horizontal scroll`
   - `@M04 no axe violations on the profile and list view in dark and light themes`
3. Интеграционни тестове: `ego`, `ancestors`, `subtree` и `paths` връщат очакваните множества от възли за опорните записи; `statement_timeout` е зададен; таванът на разклонение се спазва; `demo-claim-only-teacher` липсва в отговорите за анонимен потребител; `lineage.ego` през `/api/v1` връща същия отговор като през `/api/rpc`; `pnpm api:openapi --check` минава.
4. Съществуват `src/server/rpc/`, `src/server/services/lineage.ts`, `src/server/dto/public.ts`, `docs/api/openapi.json`, `docs/api/lineage.md`, `docs/perf/api.md` с измерванията и версията на PostgreSQL и `docs/screenshots/M04/`. Ръководството е обновено (`scripts/verify.d/M04.sh` проверява, че е променено в клона).
5. Изпълнен е `/security-review`. PR, зелен CI, чист `git status`.

## Кога да спре и да попита (Stop and ask)

Общите условия, а освен това: ако е нужно правило за видимост извън D03 по подразбиране и план §6.2.

## Ред за /goal

```text
/goal Implement milestone M04 exactly as written in docs/plan/M04-lineage-api.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. First run `git fetch origin`. If branch m04-lineage-api exists on origin, check it out and continue from its Progress log and any answered question in docs/plan/questions/M04.md; otherwise branch from origin/main. If a milestone listed under Dependencies is not merged into origin/main, print `BLOCKED M04: dependency <milestone> not merged`. Begin every turn with the line `M04 turn <n>/40`. Success: the goal is met when this conversation shows all of: (1) the step summary printed by `scripts/verify.sh M04`, ending with the line `VERIFY M04: PASS`; (2) the work committed and pushed on branch m04-lineage-api with a PR to main whose description is in English and includes that step summary; (3) the PR's CI checks all passed (show the GitHub tool output or `gh pr checks`); (4) `git status` showing a clean tree. Respect the Out of scope, Constraints and Stop and ask sections. Expose every procedure through /api/rpc and the OpenAPI handler under /api/v1 and keep docs/api/openapi.json current. Update the Bulgarian user guide in docs/guides/. Commit and push after every green checkpoint and add one line per checkpoint to the Progress log. Before the final verify run /code-review and /security-review on the diff and fix correctness, privacy or requirement gaps only. Never delete, skip or weaken a test or check to get a pass. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M04.md, commit and push. The goal also ends, not as success, when you print a `BLOCKED M04: <one-line reason>` line (after recording any question as above) or `STOPPED M04: turn limit` followed by a progress summary after 40 turns.
```

## Дневник на напредъка (Progress log)

- 2026-10-18 — Изгледите `v_public_person` (+ `city_name`) и `v_public_edge` (+ линия: slug, име, корен) са разширени с нова миграция; услугата за родословието (`lineage.ego`, `ancestors`, `subtree`, `paths`, `people.get`, `people.students`), публичните DTO, кешът с тагове, превключвателят `WCR_TEST_FAULTS` и `pnpm api:openapi [--check]` са готови; интеграционните тестове минават.
- 2026-10-18 — Профилът `/people/[slug]` (с `catchError` и Retry) и списъчният изглед `/people/[slug]/lineage` (без JavaScript: учители, пътища на произход, ученици на страници, наследници с `<details>`/`<summary>`) са готови; „Not on the record“ е еднакво за скрит и липсващ запис; `e2e/m04-lineage.spec.ts` и axe минават.
- 2026-10-18 — Снимките в `docs/screenshots/M04/` са готови; `pnpm perf:queries` мери заявките на генериран граф от 99 864 връзки (PostgreSQL 16.15) и пише `docs/perf/api.md`; обхождането на поддървото е по поколения, а броят учители и ученици е с `LATERAL` по индекс, затова най-бавната транзакция е около 140 ms и не е нужна миграция с индекси.
- 2026-10-18 — `docs/api/lineage.md`, `docs/data-model.md` (колоните на изгледите и миграцията), двете ръководства и редовете на M02 и M04 в `docs/plan/README.md` са обновени; `scripts/verify.d/M04.sh` (с проба, че сървър с `WCR_TEST_FAULTS` и публичен `APP_URL` не тръгва) минава, а CI пуска `pnpm api:openapi --check`.
- 2026-10-18 — Поправките от `/code-review` (обхождане на учениците в `lineage.ego` по поколения, без `Promise.all` в една транзакция, най-плиткото споменаване в списъка на наследниците, текстът за потвърдена непублична връзка, имена с `lang` и `translate="no"`, цели от 44 px, проверка на броя наследници и на еднаквия HTML за скрит и липсващ профил) и `/security-review` (без находки) са готови; снимките на списъчния изглед са обновени.
