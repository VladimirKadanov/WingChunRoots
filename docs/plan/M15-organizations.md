# M15 — Организации

`docs/plan/M15-organizations.md` · клон `m15-organizations` · искане на собственика от 02.11.2026 · D03, D04, D08, D09, D12, D13, D20, D25

## Цел (Objective)

Федерация, асоциация или група школи кандидатства за страница с официалното си име, ръководителя и неговата длъжност, уебсайт, държава на седалището, приблизителен брой школи и по желание подкрепящ документ (пази се частно, като доказателство). Архивист или администратор одобрява или отказва кандидатурата в опашката за преглед. Одобрената организация получава публична страница `/organizations/<slug>` само с публични данни: членовете, които вече са публични (D03), и школите, приели връзката, само с града (никога точни координати). Администраторите на организацията са акаунти, отделни от членството на хора; те управляват данните, членовете и връзките със школи от табло. Администратор може да даде на организацията тестов или безплатен план Federation. Никое действие на организация не създава, не проверява и не променя учителска връзка (D12).

## Прочети първо (Read first)

`CLAUDE.md` (§5, §6, §8, §10, §15); `docs/WingChunRoots_Technical_Plan.bg.md`: §3.2, §5.8, §6.1, §6.2, §6.4, §6.5, §6.8, §10.1 (D03, D04, D08, D09, D12, D13, D20, D25); `docs/WingChunRoots_Project_Specification.bg.md` §4.3, §16.3; `docs/adr/0007-entitlements.md`, `docs/adr/0012-evidence-and-review.md`, `docs/adr/0014-schools-map.md`; `docs/design/direction.md`.

## Зависимости (Dependencies)

M14 (и всички етапи преди него), слят в `main` (10097b8).

## Обхват (In scope)

1. **Модел на данни.** Колони на кандидатурата в `organization` (`leader_name`, `leader_title`, `schools_estimate`, `created_by_user_id`, `approved_at`, `approved_by_user_id`); таблици `organization_admin` (власт на акаунт, отделна от членството) и `organization_school` (връзка, на която отговаря школата); `review_case.organization_id` и нов вид случай `organization_application`; изгледът `v_public_organization` (само одобрени); една миграция за PostgreSQL 16+ и PostGIS 3.4+, идентификаторите се правят в приложението; `app_public_ro` няма права върху четирите таблици.
2. **Кандидатура.** `organizations.apply`: полетата на кандидатурата и по желание файлове (качени като доказателства, D13/D25) и бележка; акаунтът става първи собственик; отваря се случай в опашката; по една чакаща кандидатура на акаунт и до три на ден.
3. **Преглед.** Видът `organization_application` в опашката по образеца на M11: картата на случая показва организацията и нейната версия; архивист или администратор одобрява (статус `active`) или отказва с причина, всеки рецензент може да попита; страната по случая не го преглежда; одобрение от карта, по-стара от кандидатурата, се отказва (CONFLICT).
4. **Публична страница.** `/organizations` и `/organizations/<slug>` само от публичния DTO: вид, държава, уебсайт, текущите членове, които са публични хора (D03), и публичните школи, приели връзката, с града; без администратори, план, ръководител от кандидатурата и документи; страницата казва, че одобрението не е проверка (D04).
5. **Табло.** `/dashboard/organization`, `/dashboard/organization/apply`, `/dashboard/organization/<id>`: одобрението и планът като две отделни състояния (D04); чакаща организация редактира само своята кандидатура (по подразбиране, ADR 0018); одобрената — уебсайта, ръководителя и броя школи, не името, вида и държавата; собственик добавя и маха администратори, администратор може да напусне; всяка друга организация е „не е намерена“ (404).
6. **Членове и школи.** Членове се добавят само по адреса на публичен профил; връзка се иска до публична школа, а акаунтът на школата приема или отказва в `/dashboard/schools`; всяка страна прекратява приета връзка; школата и нейният пин не се променят.
7. **План.** `organizations.grant` и `organizations.revokeGrant` за администратор с втори фактор (`/admin/organizations`): тестов или безплатен Federation (`ORGANIZATION_GRANTABLE_PLANS`, отделно от `GRANTABLE_PLANS`); цената остава „Proposed price (not final)“ (D09); без плащания. Управлението на членове и школи иска одобрение и активен Federation; отнемането затваря само него и оставя членовете, връзките, страницата и личните планове на хората (D08).
8. **API и одит.** oRPC процедури за всяко четене и действие (`organizations.*`), регенериран `docs/api/openapi.json`; тънки Server Actions в таблицата за паритет и в матрицата за оторизация; одит `organization.*`; известия `organization.reviewed`, `organization.admin_added`, `organization.school_requested`, `organization.school_answered`.
9. **Тестове.** Unit (DTO, входът); интеграционни (`organizations.int.test.ts`, редовете в матрицата за оторизация с администратор на друга организация); E2E `@M15` на desktop-chromium и mobile-chromium; маршрутите в `e2e/routes.ts` за axe.
10. **Документи и проверка.** ADR 0018, `scripts/verify.d/M15.sh`, двете ръководства, `docs/data-model.md`, `docs/plan/questions/M15.md`.

## Извън обхват (Out of scope)

Плащания и пробни периоди, масов внос, сертификати, топлинна карта и анализи, пинове чрез федерация, разделяния, наследяване, спорове между организации.

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: само фиктивни `demo-` организации в демо данните; никога реална федерация; ръководителят от кандидатурата не е публичен; никое действие на организация не пише в `teaching_relationship` и не променя видимостта на човек; визуалните еталони се приемат само от CI.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M15` завършва с `VERIFY M15: PASS`.
2. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int` и `pnpm build` (с бюджетите) минават.
3. E2E `@M15` (`e2e/m15-organizations.spec.ts`, в изключителното пускане) минава: кандидатура само с клавиатура, одобрение от архивист, публичната страница без ръководителя; администратор на друга организация получава 404; Federation, член и отнемане, което пази члена; axe в двете теми.
4. Матрицата за оторизация има ред за всяка нова процедура и действие.
5. Съществуват ADR 0018, обновените ръководства, `docs/data-model.md` и редът на M15 в `docs/plan/README.md`.

## Кога да спре и да попита (Stop and ask)

Общите условия. Особено ако организация трябва да създава или проверява учителска връзка, ако планът трябва да струва пари или ако публичната страница трябва да показва непубличен човек.

## Ред за /goal

```text
/goal Implement milestone M15 exactly as written in docs/plan/M15-organizations.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. Work on branch m15-organizations from origin/main. Success: `scripts/verify.sh M15` ends with `VERIFY M15: PASS`, the work is committed and pushed on the branch, and `git status` is clean. Never delete, skip or weaken a test or check. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M15.md, commit and push, and print `BLOCKED M15: <reason>`.
```

## Дневник на напредъка (Progress log)

- 2026-11-02 23:40 — модел на данни (миграция `20261102225916_m15_organizations`, `organization_admin`, `organization_school`, `v_public_organization`, вид случай `organization_application`), услугите, прегледът, планът на организация, одитът, известията и процедурите `organizations.*` (6c7d19c)
- 2026-11-03 00:20 — публичните страници, таблото, кандидатурата, отговорът на школата, `/admin/organizations` и организацията на картата на случая; тънки Server Actions (2400ae2)
- 2026-11-03 00:50 — редовете в матрицата за оторизация, `organizations.int.test.ts`, unit тестовете (1d182d2)
- 2026-11-03 01:20 — E2E `@M15`, маршрутите за axe, ADR 0018, файлът на етапа и списъците на етапите (6ab7c94); `scripts/verify.d/M15.sh`, ръководствата, `docs/data-model.md`, въпросите (02ee9c2)
- 2026-11-03 02:30 — поправки след `/code-review`: `v_public_organization` само за `app_rw` (списъкът на `app_public_ro` остава трите изгледа от M01), датите на членството, вътрешната бележка на решението, етикетите на кеша за всички членове; `scripts/verify.sh M15` — `VERIFY M15: PASS` (fe31f65)
