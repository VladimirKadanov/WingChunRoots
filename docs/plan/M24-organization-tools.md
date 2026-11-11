# M24 — Инструменти на организациите

`docs/plan/M24-organization-tools.md` · клон `m24-organization-tools` · искане на собственика от 11.11.2026 · D03, D04, D08, D09, D12, D20

## Цел (Objective)

Одобрена организация с план Federation внася членовете си от CSV файл (спецификация §9.1): вижда всеки ред и проблемите му по колона и нищо не се внася, докато не потвърди. Внесените хора са частни записи без акаунт, никога съпоставени или слети със съществуващ човек; внесеният учител е твърдение „claimed by the organization“, никога проверена връзка без одобрението на живия учител. Организацията вижда анализи на собствените си записи (само броеве) и топлинна карта на школите си без точни координати (спецификация §3.1). Правилата за разделяне (§10.3) казват какво остава, какво си отива, кой решава и кой научава, а услугите ги прилагат; една организация никога не чете и не променя данните на друга.

## Прочети първо (Read first)

`CLAUDE.md` (§5, §6, §8, §10, §11, §15); `docs/plan/RULES.md`; `docs/WingChunRoots_Technical_Plan.bg.md`: §3.2, §5.8, §6.1, §6.4, §6.8, „Фаза 3“, §10.1 (D03, D04, D08, D09, D12, D20); `docs/WingChunRoots_Project_Specification.bg.md` §3.1, §9.1, §10.3; `docs/adr/0018-organizations.md`, `docs/adr/0007-entitlements.md`, `docs/adr/0014-schools-map.md`, `docs/adr/0021-notices.md`.

## Зависимости (Dependencies)

M15 (организациите) и M22 (всички етапи преди него), слети в `main` (6b13481). Не зависи от M23.

## Обхват (In scope)

1. **Модел на данни.** Една миграция `m24_organization_tools`: `organization_import`, `organization_import_row`, `organization_member_record`, `organization_teacher_claim`; права само за `app_rw`.
2. **Масов внос.** `organizationTools.importPreview` (проверка, нищо не се създава), `importCommit`, `importDiscard`, `imports`, `importGet`; шаблонът на §9.1; граници за файл, редове, прегледи на ден и срок на прегледа; `Email` не се чете; никакво съпоставяне и сливане; полетата на редовете се изчистват след края; одит без имена.
3. **Твърдения за учител.** `organization_teacher_claim` „Claimed by the organization, not verified“; `organizationTools.claims`, `withdrawClaim`; никога `teaching_relationship` (D12).
4. **Анализи.** `organizationTools.analytics`: броеве на собствените записи по държава, град и месец, само публичните състояния на връзките (D03); Federation (D08).
5. **Топлинна карта.** `organizationTools.heatmap`: квадрати по 1° в центъра на града, без квадрат под 3 школи; страница с таблица и MapLibre само при поискване (бюджетите на маршрута).
6. **Разделяне.** Правилата на §10.3 в услугите (`organization-separation-core.ts`), `organizationTools.memberships` и `leave`; `organizations.endMember` прилага същото; известия в таблото.
7. **Страници.** `/dashboard/organization/<id>/import`, `/dashboard/organization/<id>/import/<importId>`, `/dashboard/organization/<id>/analytics`, `/dashboard/organization/<id>/heatmap`; раздел „Tools“ и правилата за разделяне на таблото на организацията; „Your memberships“ на `/dashboard/organization`.
8. **API и одит.** oRPC процедури `organizationTools.*` в OpenAPI; тънки Server Actions в таблицата за паритет; редове в матрицата за оторизация (администратор на друга организация: 404); одит `organization.import_*`, `organization.claim_withdraw`, `organization.member_leave`.
9. **Тестове.** Unit (разбор на CSV и проверка на редовете); интеграционни (`organization-tools.int.test.ts`, матрицата); E2E `@M24` на desktop-chromium и mobile-chromium с axe в двете теми и 44 px на телефон; състояния за снимки на новите екрани.
10. **Документи и проверка.** ADR 0027, `docs/plan/questions/M24.md`, `scripts/verify.d/M24.sh`, двете ръководства, `docs/data-model.md`, редовете в `docs/plan/README.md` и план §8.3.

## Извън обхват (Out of scope)

Настойници и непълнолетни (отложено от собственика), разбор на Excel, сертификати, покани или писма от внос, автоматично превръщане на твърдение във връзка, независимост на школа след 90 дни неплащане (§10.3, плащания), спорове между организации, промени в матрицата на плановете.

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: никакво действие на организация не пише в `teaching_relationship` (D12); внесените хора са `involved_only` и без акаунт; топлинната карта и анализите никога не носят име, идентификатор на човек или координата на школа; нищо от новите таблици не влиза в публичен DTO или `'use cache'`; логовете без имена и съдържание на файлове; само фиктивни `Demo …` имена в тестовете (D20); без нова зависимост.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M24` завършва с `VERIFY M24: PASS`.
2. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int` и `pnpm build` (с бюджетите) минават.
3. E2E `@M24` (`e2e/m24-organization-tools.spec.ts`) минава на компютър и телефон: внос с клавиатура, преглед с грешки, потвърждение, частен запис без връзка, оттегляне на твърдение, отказ на преглед, анализи, топлинна карта без точни координати, напускане, „not found“ за акаунт без организация; axe в двете теми.
4. Матрицата за оторизация има ред за всяка нова процедура и действие.
5. Съществуват ADR 0027, въпросите, обновените ръководства, `docs/data-model.md` и редът на M24 в `docs/plan/README.md`.

## Кога да спре и да попита (Stop and ask)

Общите условия. Особено ако вносът трябва да създаде или провери учителска връзка, да покани или да пише на някого, да съпостави ред със съществуващ акаунт, или ако топлинната карта трябва да показва точка на школа.

## Ред за /goal

```text
/goal Implement milestone M24 exactly as written in docs/plan/M24-organization-tools.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. Work on branch m24-organization-tools from origin/main. Success: `scripts/verify.sh M24` ends with `VERIFY M24: PASS`, the work is committed and pushed on the branch, and `git status` is clean. Never delete, skip or weaken a test or check. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M24.md, commit and push, and print `BLOCKED M24: <reason>`.
```

## Дневник на напредъка (Progress log)

- 2026-11-11 20:18 — модел на данни (миграция `20261111201826_m24_organization_tools`, четирите таблици и правата) (0ef1920)
- 2026-11-11 20:28 — услугите на вноса, твърденията, анализите, топлинната карта и разделянето; процедурите `organizationTools.*`, одитът, известията, задачата за изтеклите прегледи, OpenAPI (4f87c3f)
- 2026-11-11 20:38 — страниците на вноса, анализите, топлинната карта и членствата; тънки Server Actions; `organization-tools.int.test.ts` (a5b8d8c)
- 2026-11-11 20:42 — редовете в матрицата за оторизация и таблицата за паритет (90de2c7)
- 2026-11-11 20:51 — E2E `@M24` с axe в двете теми и 44 px на телефон (5a09e0f); състояния за снимки (27434e6)
