# M07 — Имена, профил, поверителност на акаунта и търсене

`docs/plan/M07-names-search.md` · клон `m07-names-search` · таван 40 хода · D03, D20

## Цел (Objective)

Потребителят редактира собствените си имена на няколко писмености, решава дали профилът му е публичен и управлява съгласията си. Името на латиница е задължително, а име в оригиналната писменост (например традиционни или опростени китайски йероглифи), Jyutping и пинин са по желание. Търсенето през командната палитра намира хора, школи и линии по всички тях, както и по имена на кирилица. Интерфейсът остава на английски.

## Прочети първо (Read first)

`docs/WingChunRoots_Technical_Plan.bg.md`: §5.3, §5.6, §5.8, §6.2, §6.4, §6.6, §6.8; `docs/design/direction.md`.

## Зависимости (Dependencies)

M04 (публичните DTO), M02.

## Обхват (In scope)

1. **Редактор на профила** `/dashboard/profile`, само за собствената личност. Полета:
   - имена: вид, стойност, писменост, `lang`, романизация, основно име за показване. Основното име на латиница е задължително, а останалите са по желание (план §5.3). Стойностите се пазят в Unicode NFC без загуба, на всяка писменост;
   - кратка биография (засега на английски, с поле за език);
   - държава, град, година на започване;
   - „Show my profile publicly“ (не е отметнато предварително; сменя `person.visibility` на профил със `stewardship = self`).

   Ползва TanStack Form и Zod. Промяната е oRPC процедура `profile.update`, а формата я вика чрез тънък Server Action (план §6.8). Промените се одитират и обновяват публичния кеш чрез `invalidatePublic` (план §6.4). Архивната редакция на чужди записи е в M10a.
2. **Ключове за търсене** (`src/server/search/keys.ts`), генерирани при запис:
   - нормализация;
   - българската обтекаема система (Streamlined System);
   - `transliteration` 2.6 за друга кирилица;
   - `pinyin-pro` 3.29 и `to-jyutping` 3.1 за йероглифите;
   - `opencc-js` 1.4 за сгъване на традиционен и опростен китайски;
   - ръчно поддържани псевдоними (например хонконгски изписвания) като редове с източник.

   Задача на pg-boss генерира ключовете за съществуващите фиктивни данни.
3. **Услуга и процедура `search.query({ q, country?, lineageId? })`.** Търси по триграмна прилика, `word_similarity`, префикс и точен йероглиф. Дава по-висок ранг на основните имена и на потвърдените хора. Връща само публични DTO, групирани на People, Schools и Lineages. Като съвпадение показва съхранено име от `person_name`, никога генериран ключ.
4. **Палитра** `<SearchPalette>`: Base UI Autocomplete в Dialog, с поведението от план §5.6. Отваря се от полето в заглавната лента и с `Ctrl/⌘+K`; глобален клавиш `/` няма. `⌘/Ctrl+Enter` води до `/explore?focus=<id>`. Ако M06 вече е в `main`, клавишът `/` в графа се свързва с палитрата. Последните търсения се пазят в `localStorage` (с `try/catch` и бутон „Clear“). На телефон палитрата заема целия екран (`dvh`, безопасни зони), а резултатите се избират с докосване.
5. **`/account/privacy`.**
   - Оттегляне на незадължителни съгласия: нов ред в `consent_record` и одит `consent.withdraw`.
   - „Request account deletion“ отваря `review_case` от вид `deletion_request` и уведомява администраторите (одит `account.deletion_request`).
   - Срокът на пазене е решение по подразбиране (`DEFAULT`): данните на акаунта се изтриват, а потвърдените връзки остават като исторически записи до правния преглед. Въпросът се записва в `docs/plan/questions/M07.md`, без да спира етапа.
6. **Документация:** `docs/search.md` на български, с праговете и известните ограничения. Кратките китайски имена дават слаб триграмен сигнал, затова за тях основна роля имат точното и префиксното съвпадение.
7. **API-first.** Оттеглянето на съгласие и заявката за изтриване също са oRPC процедури (`consent.withdraw`, `account.requestDeletion`), обвити от Server Actions.
8. **Снимки и преглед на дизайна.** `@screenshots` записва `docs/screenshots/M07/<екран>-<390x844|1440x900>-<dark|light>.png` за редактора на профила, палитрата и `/account/privacy`. Преди PR нишката прави прегледа на дизайна от план §5.8 (е) и го записва в `docs/design/reviews/M07.md`.
9. **Ръководства:** `docs/guides/user-guide.bg.md` описва имената (включително китайски йероглифи, Jyutping и пинин), търсенето, публичния профил, оттеглянето на съгласие и заявката за изтриване; `docs/guides/admin-guide.bg.md` описва обработката на заявка за изтриване.

## Извън обхват (Out of scope)

Meilisearch и Typesense. Търсене с изкуствен интелект. Подробно търсене на школи по място (M11). Архивна редакция (M10a).

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: само фиктивни имена в тестовете.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M07` завършва с `VERIFY M07: PASS`.
2. Единични тестове в `keys.test.ts`:
   - „Тестов“ дава `testov` по обтекаемата система;
   - за китайското име на `demo-cjk-name` се генерират ключове на пинин и Jyutping;
   - традиционното и опростеното изписване дават еднакъв ключ;
   - тоновите знаци се премахват;
   - име на кирилица и име с китайски йероглифи се записват и четат без загуба (NFC).
3. E2E тестове в `e2e/m07-search.spec.ts`:
   - `@M07 Ctrl+K opens the palette and the query "Тестов" finds demo-latin-name`
   - `@M07 a Jyutping query finds demo-cjk-name and shows its stored name`
   - `@M07 a match on a generated Jyutping key shows the stored primary name, not the generated romanization`
   - `@M07 Simplified and Traditional spellings find the same person`
   - `@M07 a toneless pinyin query finds demo-cjk-name`
   - `@M07 a query filtered by country returns only people and schools in that country`
   - `@M07 no query is sent during IME composition and one is sent after compositionend`
   - `@M07 search results contain only public persons and no private fields`
   - `@M07 pressing "/" with focus outside the graph does not open the palette`
   - `@M07 a user edits their own names in three scripts; editing another person's profile is refused`
   - `@M07 saving a profile without a Latin-script primary name is refused with a clear message`
   - `@M07 Ctrl+Enter navigates to /explore?focus=<id> of the selected person`
   - `@M07 withdrawing a consent records consent.withdraw`
   - `@M07 a deletion request creates a review case and notifies admins`
   - `@M07 at 390x844 the palette opens full screen and a result can be chosen by touch`
   - `@M07 no axe violations with the palette open in dark and light themes`
4. Съществуват `src/server/search/`, `docs/search.md`, `docs/screenshots/M07/` и `docs/design/reviews/M07.md`. Ръководствата са обновени (`scripts/verify.d/M07.sh` проверява снимките, прегледа и ръководствата); `api-parity.test.ts` минава.
5. Описанието на PR съдържа връзки към снимките и към прегледа на дизайна. PR, зелен CI (включително мобилния WebKit и визуалната регресия), чист `git status`.

## Кога да спре и да попита (Stop and ask)

Общите условия. Ако библиотека за транслитерация дава резултат, който изглежда грешен за дадена писменост, това се документира с пример и се продължава с ръчен псевдоним. Не е причина за спиране.

## Ред за /goal

```text
/goal Implement milestone M07 exactly as written in docs/plan/M07-names-search.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. First run `git fetch origin`. If branch m07-names-search exists on origin, check it out and continue from its Progress log and any answered question in docs/plan/questions/M07.md; otherwise branch from origin/main. If a milestone listed under Dependencies is not merged into origin/main, print `BLOCKED M07: dependency <milestone> not merged`. Begin every turn with the line `M07 turn <n>/40`. Success: the goal is met when this conversation shows all of: (1) the step summary printed by `scripts/verify.sh M07`, ending with the line `VERIFY M07: PASS`; (2) the work committed and pushed on branch m07-names-search with a PR to main whose description is in English and includes that step summary and links to the committed screenshots in docs/screenshots/M07/ and to the design review in docs/design/reviews/M07.md; (3) the PR's CI checks all passed, including mobile WebKit and visual regression (show the GitHub tool output or `gh pr checks`); (4) `git status` showing a clean tree. Respect the Out of scope, Constraints and Stop and ask sections. Use only fictional fixture names. A Latin-script primary name is required; native-script names (including Traditional and Simplified Chinese), Jyutping and pinyin are optional and searchable. Every mutation is an oRPC procedure; Server Actions only wrap it. Before opening the PR, review the screenshots at 390x844 and 1440x900 in dark and light themes against docs/design/direction.md, fix what falls short and record the review in docs/design/reviews/M07.md. Update the Bulgarian user and admin guides in docs/guides/. Commit and push after every green checkpoint and add one line per checkpoint to the Progress log. Run /code-review on the diff before the final verify and fix only correctness or requirement gaps. Never delete, skip or weaken a test or check to get a pass. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M07.md, commit and push. The goal also ends, not as success, when you print a `BLOCKED M07: <one-line reason>` line (after recording any question as above) or `STOPPED M07: turn limit` followed by a progress summary after 40 turns.
```

## Дневник на напредъка (Progress log)

- 2026-10-25 12:29 (UTC+2) — ключовете за търсене, услугата за търсене, профилът, съгласията и заявката за изтриване с единичните и интеграционните тестове са зелени (8e455c7)
- 2026-10-25 13:13 (UTC+2) — редакторът на профила, палитрата, `/account/privacy`, 16-те E2E теста @M07 и снимките са зелени (9b0c378)
- 2026-10-25 13:39 (UTC+2) — поправките от четирите независими прегледа и от `/code-review`; 32/32 E2E @M07, единичните и интеграционните тестове са зелени, снимките са наново заснети (cf3ef97, ef527c9)
- 2026-10-25 15:39 (UTC+2) — на компютъра на собственика (Windows, Git Bash): `scripts/verify.sh M07` и `M08` завършват с PASS на 4eda2df, а `M04` — на 68ccf05
- 2026-10-25 20:11 (UTC+2) — поправките от прегледа на PR #13, в облачна сесия (Linux): lint, typecheck, 748 единични и 289 интеграционни теста и целият E2E пакет (382 + 4) са зелени; `scripts/verify.sh all` спира на `checks:M00b` — бюджетите на JavaScript за `/dashboard/profile` (191,2 от 170 kB) и `/styleguide` (254,5 от 250 kB) чакат решението на собственика (`questions/M07.md`, въпрос 3); проверките M01, M01b, M02, M03, M04, M07 и M08 минават поотделно (7a46bda)
