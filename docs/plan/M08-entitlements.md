# M08 — Права по план, тестови права и табла

`docs/plan/M08-entitlements.md` · клон `m08-entitlements` · таван 40 хода · D04, D06, D07, D08, D09, D13

## Цел (Objective)

Един централен механизъм решава правата по план за всичките пет плана. Администраторът дава и отнема тестови планове, а всяко действие остава в одита. Учениците и Сифу-тата имат базови табла. Подканите за по-висок план показват само реални ползи, а отнемането на право не трие история.

## Прочети първо (Read first)

- `docs/WingChunRoots_Project_Specification.bg.md` (или `.en.md`): §3.1.
- `docs/WingChunRoots_Technical_Plan.bg.md`: §5.6, §5.8, §6.5, §6.8.
- `docs/design/direction.md`.

## Зависимости (Dependencies)

M02.

## Обхват (In scope)

1. **Матрица и функции.**
   - `src/server/entitlements/plans.ts` съдържа матрицата на петте плана по спецификация §3.1, с версия. Всяка функция има `availability: 'now' | 'planned'`. Цените имат етикет „работно предложение“ (D09). Медийните квоти (D07) и правилата за понижаване при плащане (D08) са записани, но не се налагат във Фаза 1.
   - `requireEntitlement()` и `effectivePlan()` (план §6.5).
   - Помощна функция за квоти с `pg_advisory_xact_lock`.
2. **Вид на акаунта.** Student или Sifu в `/dashboard/settings`. Сменя безплатния план (`free_student` или `free_sifu`) и се одитира. Не дава никакво потвърждение (D04). Сифу без одобрена проверка се показва като „Instructor (unverified)“ (`DEFAULT D04/D13`; проверката идва в M10b). Смяната Sifu → Student запазва потвърдените връзки.
3. **`/admin/grants`.** Таблица (TanStack Table 9) с даване и отнемане на тестов план: причина, начало, край. Даването и отнемането са oRPC процедури (`grants.create`, `grants.revoke`), а формата ги вика чрез тънки Server Actions (план §6.8). Изисква персонал с проверен втори фактор. Одит `grant.create` и `grant.revoke`. Отнемането не сваля потвърдени връзки (`DEFAULT D06/D08`, план §6.5).
4. **`<UpgradePrompt>`** по план §5.6: изрежда само функции с `availability: 'now'`. Действието „Request pilot access“ създава известие до администраторите и не води до плащане.
5. **`/plans`.** Статична страница, която сравнява плановете от матрицата, отбелязва функциите с `planned` като „Planned — not available yet“ и показва надписа „Proposed prices — not final. Payments are not available during the pilot.“
6. **`/dashboard`.**
   - Ученик: „My teachers“ и „My requests“ (празни състояния със следващо действие).
   - Сифу: „Student requests“ и „My schools“ (празни състояния).
   - Известия с брояч на непрочетените. Отбелязването като прочетено ползва `useOptimistic`.
7. **Тест срещу изкуствена спешност.** `copy.no-fomo.test.ts` проверява английските текстове в `src/app`, `src/components` и `src/server/templates/` и отхвърля обратни броячи и изрази за недостиг или спешност от определен списък, като „only today“, „hurry“ и „last chance“.
8. **Ръководства:** `docs/guides/user-guide.bg.md` описва вида на акаунта, плановете, подканата за по-висок план и таблата; `docs/guides/admin-guide.bg.md` описва даването и отнемането на тестови планове в `/admin/grants`.

## Извън обхват (Out of scope)

Stripe и всякакви плащания. Налагане на медийни квоти. Логиката за понижаване при платени планове (Фаза 2).

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: без обратни броячи, недостиг и предварително сложени отметки.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M08` завършва с `VERIFY M08: PASS`.
2. Единични и интеграционни тестове:
   - `plans.test.ts`: матрицата съвпада със спецификация §3.1 за петте плана;
   - `requireEntitlement.test.ts`;
   - `quota.int.test.ts`: 10 паралелни одобрения при Безплатен Сифу с 4 ученици дават точно 1 успешно;
   - `downgrade.int.test.ts`: отнемането на тестовия план Pro Sifu от `demo-pro-sifu-8` оставя и осемте връзки потвърдени и публични, а `requireEntitlement` отказва ново одобрение с код `quota`; смяната Sifu → Student запазва потвърдените връзки;
   - `copy.no-fomo.test.ts`.
3. E2E тестове в `e2e/m08-entitlements.spec.ts`:
   - `@M08 admin grants a Pro Sifu test plan with a reason; the grant and an audit row appear`
   - `@M08 a non-admin and a staff session without a verified second factor cannot open /admin/grants`
   - `@M08 the upgrade prompt shows the current allowance, real benefits, a "Proposed price (not final)" label and an equally prominent "Not now"`
   - `@M08 the upgrade prompt lists only features available in the current release`
   - `@M08 /plans labels planned features as not yet available and states that prices are proposals and payments are unavailable`
   - `@M08 "Request pilot access" notifies admins and creates no charge`
   - `@M08 switching the account type to Sifu sets the Free Sifu plan, shows "Instructor (unverified)" and is audited`
   - `@M08 student and Sifu dashboards render empty states with a next action`
   - `@M08 the dashboards and the upgrade prompt work at 390x844 with no horizontal scroll`
4. Съществуват `src/server/entitlements/`, `docs/entitlements.md` (на български) и `docs/screenshots/M08/`. Ръководствата са обновени (`scripts/verify.d/M08.sh` проверява, че са променени в клона); `api-parity.test.ts` минава. PR, зелен CI, чист `git status`.

## Кога да спре и да попита (Stop and ask)

Общите условия, а освен това: ако спецификация §3.1 е противоречива за функция, която Фаза 1 налага. За останалите функции се ползва решението по подразбиране и се записва.

## Ред за /goal

```text
/goal Implement milestone M08 exactly as written in docs/plan/M08-entitlements.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. First run `git fetch origin`. If branch m08-entitlements exists on origin, check it out and continue from its Progress log and any answered question in docs/plan/questions/M08.md; otherwise branch from origin/main. If a milestone listed under Dependencies is not merged into origin/main, print `BLOCKED M08: dependency <milestone> not merged`. Begin every turn with the line `M08 turn <n>/40`. Success: the goal is met when this conversation shows all of: (1) the step summary printed by `scripts/verify.sh M08`, ending with the line `VERIFY M08: PASS`; (2) the work committed and pushed on branch m08-entitlements with a PR to main whose description is in English and includes that step summary; (3) the PR's CI checks all passed (show the GitHub tool output or `gh pr checks`); (4) `git status` showing a clean tree. Respect the Out of scope, Constraints and Stop and ask sections. Upgrade prompts must show real benefits only: no countdowns, scarcity or pre-ticked options. Every mutation is an oRPC procedure; Server Actions only wrap it. Update the Bulgarian user and admin guides in docs/guides/. Commit and push after every green checkpoint and add one line per checkpoint to the Progress log. Run /code-review on the diff before the final verify and fix only correctness or requirement gaps. Never delete, skip or weaken a test or check to get a pass. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M08.md, commit and push. The goal also ends, not as success, when you print a `BLOCKED M08: <one-line reason>` line (after recording any question as above) or `STOPPED M08: turn limit` followed by a progress summary after 40 turns.
```

## Дневник на напредъка (Progress log)

- 18.10.2026: матрицата на петте плана, `effectivePlan()`, `requireEntitlement()` и `withQuota()` с `pg_advisory_xact_lock`; миграция (`account_type`, `pilot_access_request`); тестови данни; `plans.test.ts`, `requireEntitlement.test.ts` и `quota.int.test.ts` минават.
- 18.10.2026: услуги и oRPC процедури (`account.setType`, `plans.*`, `grants.*`, `notifications.*`, `dashboard.overview`) с тънки Server Actions; `downgrade.int.test.ts` и `plans.int.test.ts` минават; lint, typecheck, unit и integration са зелени.
- 18.10.2026: екрани `/plans`, `/dashboard` (подкана за надграждане, известия с `useOptimistic` и без JavaScript), `/dashboard/settings` и `/admin/grants` (TanStack Table 9, `@tanstack/table-core`, рендерирана на сървъра); lint, typecheck и unit тестовете са зелени.
- 18.10.2026: `copy.no-fomo.test.ts` (с доказателство, че проверката може да падне), `e2e/m08-entitlements.spec.ts` с деветте заглавия и тест за известията със и без JavaScript, нови маршрути в `e2e/routes.ts` (axe в двете теми), ключови екрани и снимки в `docs/screenshots/M08/`; `@smoke|@M08` минава (102 теста).
- 18.10.2026: `docs/entitlements.md`, ADR 0007 (TanStack Table 9 като `@tanstack/table-core` 9.3.1, MIT), `docs/data-model.md`, двете ръководства, `pnpm notices` и `scripts/verify.d/M08.sh`; проверките на M08 минават.
- 18.10.2026: поправките от прегледа на кода (f2a3f9c); входът на персонала в E2E вече издържа, когато два работника вземат един и същ TOTP код (c34e7ff); `scripts/verify.sh M08` завършва с `VERIFY M08: PASS` (605 единични, 201 интеграционни и 102 E2E теста); отворен е PR #11 (чернова).
- 19.10.2026: циклите по маршрути в E2E влизат от отделен клиентски адрес при всеки вход, което поправи падналия CI (1741871); 16-те нови визуални еталона са приети от лога на CI (cc48144); задачата `verify` в CI има 60 минути (ae9b71a); подправянето в два теста от M02 вече винаги променя запечатаните байтове (a2a1ca0); axe проверката на страницата за сигурност изчаква цветовите преходи след смяна на темата (3fb8e3b); `scripts/verify.sh M08`, `M02` и `M01` завършват с PASS; и четирите проверки в CI (ci, verify, node22, security) са зелени на 3fb8e3b.
- 19.10.2026: първи кръг на прегледа (50 находки): едно заключване на акаунта първо (без deadlock), до 5 смени на вида за 24 часа, граници на датите на правата, `until` през последователни права, READ COMMITTED за квотите, bearer заявките без бисквитки, спокойна подкана в „Student requests“, „Staff work“, честни празни състояния, известия за екранния четец, `/plans` като регистър, карти и лента за сортиране в `/admin/grants`, вход към таблото, формите без JavaScript се отварят на резултата си (5c13b48…bc650c0); `scripts/verify.sh M08` завършва с `VERIFY M08: PASS` (627 единични, 209 интеграционни, 108 E2E теста, 135 проверки на M08); пълният E2E пакет (244 теста, настолен и мобилен Chromium) минава.
- 19.10.2026: 16-те променени визуални еталона от първия кръг (`plans`, `dashboard-sifu`, `dashboard-student`, `dashboard-settings` в два размера и двете теми) са приети от лога на CI (изпълнение 39198944343) и прегледани един по един; останалите 386 E2E теста в CI минават, включително `mobile-webkit`.
- 19.10.2026: проверката на M02 за oRPC приема опции на `RPCHandler` и `OpenAPIHandler` (прехващачът, който записва неуспешните процедури), но все така изисква и двата да обслужват целия рутер; `scripts/verify.d/M02.sh`, `M03.sh` и `M08.sh` минават локално.
- 19.10.2026: CI е зелен на 3472303 (изпълнение 39205529912, четирите проверки).
- 19.10.2026: втори кръг на прегледа (11 находки): кой е поискал пилотен достъп и броят на отворените заявки се виждат само след втория фактор; `?next=` пази `?request=<id>`; клиентът в процеса записва неуспехите като HTTP обработчиците, а Server Actions не хвърлят грешката нагоре („nothing was changed“ е вярно, защото всяка промяна чете отговора си в своята транзакция); `grants.closeRequest` затваря заявка без план, с причина; избраният вид акаунт се вижда в принудителни цветове; остаряла подкана казва защо; имейлът в таблицата се показва цял; празното начало е 00:00 UTC; проверен Sifu не чете „unverified“ (ef6e162…77346c5); `scripts/verify.sh M08` завършва с `VERIFY M08: PASS` (632 единични, 212 интеграционни, 118 E2E теста, 152 проверки на M08).
- 19.10.2026: отклонение: празните състояния без реална следваща стъпка нямат връзка (план §5.6); казват кога се отваря стъпката.
- 19.10.2026: четирите променени визуални еталона на `dashboard-settings` от втория кръг (текстът за проверен Sifu) са приети от лога на CI (изпълнение 39214540988, 4069085) и прегледани един по един; останалите 413 E2E теста в CI минават, включително `mobile-webkit`.
- 19.10.2026: CI е зелен на 4b8f088 (изпълнение 39218948449, четирите проверки; `VERIFY all: PASS`, от `checks:M00` до `checks:M08`).
- 19.10.2026: финалната проверка (13 потвърдени находки) е поправена изцяло: неочакваната грешка на процедура стига до страницата само като гола грешка 500, без SQL заявката и нейните параметри, и в лога на сървъра остава само безопасният ред (security-1); `/dashboard`, `/dashboard/settings` и `/admin/grants` показват грешка при зареждане в обвивката на приложението с „Try again“, със и без JavaScript (requirements-2); „Not now“ без JavaScript презарежда страницата със затворена подкана (screens-1); отговорена заявка за пилотен достъп вече не предлага „Review the request“ (screens-4); проверката за изкуствена спешност чете всеки клон на условния текст (code-2); празната форма за тестов план показва всички грешки наведнъж (screens-2); „Give …“ дава фокуса на полето Reason (screens-3); изтрит профил е анонимен в таблото (security-2); `/plans` показва Federation по функции (requirements-4); лимитът на Free Sifu идва от матрицата (code-3); плюс requirements-3, requirements-5 и screens-7. Тестовете, които заключват цяла таблица, вървят в отделно изпълнение (`PW_EXCLUSIVE=1`). `scripts/verify.sh M08` и `scripts/verify.sh M02` минават на 5559d85.
- 19.10.2026: трите бележки от потвърждението на финалната проверка са поправени: `/account` чете броя на непрочетените известия с `pageRead()` и при заключена таблица `notification` се показва цялата, без броя, със и без JavaScript (бележка 1, нов тест в `e2e/m08-failures.exclusive.spec.ts`); кратките описания на Free Sifu и Professional Sifu взимат лимита от `FREE_SIFU_STUDENT_LIMIT` (DEFAULT D06), матрицата е `2026-10-19.2`, а проверката в `scripts/verify.d/M08.sh` сканира и `plans.ts` (бележка 2); проверката за изкуствена спешност чете стойност от изходния код пред „left“, „remaining“ и „to go“ като обратно броене (бележка 3). PR #10 (M04) още не е слят, затова `main` не е слят и миграцията е непроменена. `scripts/verify.sh M08` (с отделното изпълнение `PW_EXCLUSIVE=1`) и `scripts/verify.sh M02` минават на 85c3383.
- 19.10.2026: двете бележки от второто потвърждение са поправени: тестът на `/account` търси страницата за грешка на Next.js по корена ѝ (`<html id="__next_error__">`) и по заглавието с всеки от двата апострофа (`expectNoNextErrorPage()`), защото Next.js пише „couldn’t“ с U+2019, а без JavaScript праща само празния корен; `e2e/next-error.test.ts` не допуска прав апостроф в текст от вградените страници на Next.js, а `e2e/next-error.spec.ts` показва, че проверката пада на страницата за грешка от сборката (бележка 1). Проверката за изкуствена спешност чете самозатварящ се елемент в изречението и елемент с празно тяло като стойност, а `<br />` като интервал (бележка 2). При проверката на M02 се появи надпревара в помощната функция `submitStaffCode()`: тя вече съди за всеки код по отговора на формата (`x-action-redirect`), а не по екрана. PR #10 (M04) още не е слят, затова `main` не е слят и миграцията е непроменена. `scripts/verify.sh M08` (с отделното изпълнение `PW_EXCLUSIVE=1`) и `scripts/verify.sh M02` минават на dcab130.
