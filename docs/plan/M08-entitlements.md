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
