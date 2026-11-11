# M23 — Абонамент Federation, смяна на плана и пробен период на федерация

`docs/plan/M23-federation-billing.md` · клон `m23-federation-billing` · Фаза 2/3 (избор на собственика от 11.11.2026: всичко останало от Фаза 2 и 3 без настойниците и непълнолетните) · спецификация §3.1, §10.2, §10.3; D09, D12, D20

## Цел (Objective)

Собственикът на одобрена федерация плаща Federation за организацията в тестов режим, месечно или годишно, и сменя периода на плащане. Повишаването е веднага с пропорционално приспадане, а понижаването е в края на периода.

Администраторът дава на федерация пробен период без карта. Администраторите на организацията получават известия 14 и 7 дни преди края. Ако никой не абонира организацията, пробният период просто свършва: нищо не се таксува и нищо не се трие.

Каквото и да стане с абонамента или пробния период на федерацията, платените планове на школите и учениците в нея не се променят (спецификация §10.3).

Истинско таксуване няма.

## Прочети първо (Read first)

- `CLAUDE.md` (§3, §5, §6, §8, §10, §11, §12, §15, §16).
- Спецификация §3.1, §10.2, §10.3; D09, D12, D20.
- `docs/plan/M22-billing.md`, `docs/adr/0025-billing.md`, `docs/plan/questions/M22.md`.
- `docs/adr/0018-organizations.md`, `docs/adr/0021-notices.md`, `docs/entitlements.md`.
- `src/server/billing/`, `src/server/services/billing.ts`, `organizations.ts`, `organization-grants.ts`, `notify.ts`, `src/server/jobs/plan-expiry.ts`.

## Зависимости (Dependencies)

M22 и всички етапи преди него, слети в `main`.

## Обхват (In scope)

1. **Federation в тестов режим.**
   - Купува собственик на одобрена организация от вид `federation`, за организацията, никога за себе си (DEFAULT M23, въпрос 1). Друг администратор само чете, а API му отговаря 403. Всеки друг акаунт получава 404.
   - Месечно $99 или годишно $990, с етикета „Proposed price (not final)“ (DEFAULT D09). Само тестовият доставчик в CI; Stripe приема само `sk_test_…`.
   - На `/plans` Federation остава „Planned“ като цяло. Страницата на организацията изрежда само това, което планът дава сега (CLAUDE.md §11).
   - Новата страница е `/dashboard/organization/<id>/billing`: планът, пробният период, абонаментът, смяната, предложенията и историята на плащанията.
2. **Смяна между платени планове** (DEFAULT M23, въпрос 2).
   - Повишаване (по-висок план или от месечно към годишно) — веднага, с нов период и приспадане на неизползваната част.
   - Понижаване — в края на периода, с възможност да се върне („Keep the current plan and billing“).
   - Адаптерът за Stripe прави само промени веднага; промяна в края на периода там се отказва.
3. **Пробен период на федерация** (DEFAULT M23, въпроси 3–5).
   - Започва го администратор с втори фактор на `/admin/organizations/<id>`, с причина: 6 или 12 месеца, по подразбиране 12, без карта. Само веднъж за организация.
   - Известия при начало, 14 и 7 дни преди края и при края, до всички администратори на организацията, в категория Plan (имейлът е включен по подразбиране).
   - Изтичането без абонамент просто свършва: без таксуване, без изтриване.
   - Абонамент по време на пробния период продължава от него: първата фактура е $0.00, а първото плащане е при края на пробния период.
4. **Независимост надолу** (DEFAULT M23, въпрос 6): нито абонаментът, нито пробният период на федерацията пипат правата на школите и учениците. Интеграционни и E2E тестове го доказват.
5. **API.** `billing.organization`, `billing.changePlan`, `billing.cancelChange`, `federationTrials.adminGet`, `federationTrials.start`, `federationTrials.end` на `/api/rpc` и `/api/v1`; `docs/api/openapi.json` е регенериран. Server Actions са тънки обвивки, с редове в матрицата за оторизация.
6. **Данни.** Миграция `m23_federation_billing`: таблица `federation_trial`, колони за планирана смяна в `billing_subscription` и `billing_test_subscription`, `trial_ends_at` в `billing_checkout`.
7. **Тестове.**
   - Unit: `changeTiming`, `addMonths`, `prorate`, адаптерът за Stripe (`trial_end`, `changePlan`), известията.
   - Интеграционни: `federation-billing.int.test.ts` и редовете в `authz-matrix.int.test.ts`.
   - E2E `@M23` в `exclusive` (пробен период → годишно, смяна, независимост надолу) и изгледът на компютър и телефон; axe в двете теми; екранни състояния.
8. **Документи и проверка.** ADR 0026, `scripts/verify.d/M23.sh`, двете ръководства, `docs/data-model.md`, `docs/entitlements.md`, `docs/plan/questions/M23.md`, редът на M23 тук и в план §8.3, бележката [`deferred-minors.md`](deferred-minors.md).

## Извън обхват (Out of scope)

- Истинско таксуване и живи ключове.
- Окончателни цени (D09).
- Плановите функции на Federation, които още са планирани (D12).
- Настойници, детски профили и непълнолетни ([`deferred-minors.md`](deferred-minors.md)).
- Промяна в края на периода при Stripe (график на абонамента).
- Отстъпки за школите в една федерация.

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това:
- в хранилището няма тайни; без платени ресурси;
- субектът на абонамента идва само от checkout-а на приложението;
- абонаментът и пробният период на организация създават и приключват само права на организацията;
- без изкуствена спешност: напомнянията са едно изречение с дата, без обратно броене;
- статусът никога не се показва само с цвят;
- визуалните еталони се приемат само от CI.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M23` завършва с `VERIFY M23: PASS`.
2. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int` и `pnpm build` минават, както и всички `bash scripts/verify.d/M*.sh`.
3. E2E `@M23` минава: пробен период без карта и продължение с годишно плащане, смяна на периода, независимост надолу; axe в двете теми.
4. Съществуват ADR 0026, обновените ръководства, `docs/data-model.md` и въпросите в `docs/plan/questions/M23.md`.

## Кога да спре и да попита (Stop and ask)

Общите условия. Особено ако:
- е нужен истински ключ, акаунт или платен ресурс;
- краят на абонамент или пробен период на федерация би трябвало да промени правата на школа или ученик;
- пробният период би трябвало да иска карта.

## Ред за /goal

```text
/goal Implement milestone M23 exactly as written in docs/plan/M23-federation-billing.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. Work on branch m23-federation-billing from origin/main. Success: `scripts/verify.sh M23` ends with `VERIFY M23: PASS`, the work is committed and pushed on the branch, and `git status` is clean. Never delete, skip or weaken a test or check. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M23.md, commit and push, and print `BLOCKED M23: <reason>`.
```

## Дневник на напредъка (Progress log)

- 2026-11-11 — миграция `m23_federation_billing`, смяната на плана при двата доставчика, checkout на Federation за организация, `federation_trial` и дневната задача, известията (typecheck, lint, unit — зелени)
- 2026-11-11 — страницата `/dashboard/organization/<id>/billing`, формите за смяна, формите на администратора за пробния период, редът на `/plans`
- 2026-11-11 — интеграционни тестове (`federation-billing.int.test.ts`), редовете в матрицата за оторизация, unit тестовете; известията на организация с ключ за имейл за всеки получател
- 2026-11-11 — E2E `@M23` (изключителното пускане и изгледът на компютър и телефон), екранните състояния; тестовото плащане се връща към страницата на организацията
- 2026-11-11 — документите (ADR 0026, въпросите, ръководствата, модела на данните, `deferred-minors.md`), `scripts/verify.d/M23.sh`
