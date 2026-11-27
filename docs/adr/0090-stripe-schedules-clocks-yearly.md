# ADR 0090: Stripe в тестов режим на staging: смяна в края на периода, тестов часовник, годишна цена

| | |
|---|---|
| Статус | Прието (27.11.2026) |
| Контекст | Собственикът включва Stripe sandbox на staging и иска двете липси на адаптера затворени („can we fix those“), плюс „give yearly subs 2 months discount, … pay the price of 10 months“. |
| Свързани | M22, M23, [ADR 0025](0025-billing.md), [ADR 0026](0026-federation-billing.md), [ADR 0033](0033-staging.md) |

## 1. Webhook-ът на staging минава без паролата на сайта

Stripe не може да прати паролата на Caddy. `deploy/staging/Caddyfile` пуска без нея само `POST /api/billing/webhook`; маршрутът сам проверява `Stripe-Signature` (400 без валиден подпис), отказва `livemode: true` и чете до 256 KiB. `staging.sh deploy` пресъздава Caddy, когато `Caddyfile` се е променил (иначе контейнерът пази стария файл). Настройките в таблото на Stripe са в [`staging.md`](../operations/staging.md).

## 2. Смяна в края на периода при Stripe (замества последния ред на ADR 0026 §2)

- Смяна „в края на периода“ (Federation от годишно към месечно, и всяко понижение) е **subscription schedule** с две фази: текущата цена до края на периода и новата цена от нов период (`billing_cycle_anchor=phase_start`, `proration_behavior=none`, `end_behavior=release`). Нищо не се таксува преди края.
- Какво е планирано, пише в `metadata` на абонамента (`scheduled_plan_code`, `scheduled_interval`; `none` за нищо, защото празна стойност маха ключа). Втората фаза поставя `none` и новия `plan_code`, когато започне, така че webhook събитието на подновяването изчиства планираната смяна. Без тези ключове приложението пази каквото има (както досега).
- Връщане на смяната (`billing.cancelChange`), отказ в края на периода и смяна веднага първо освобождават schedule-а (`/release`); Stripe не позволява отказ на абонамент, който schedule управлява.

## 3. Тестовият часовник при Stripe (`STRIPE_TEST_CLOCKS`)

- `STRIPE_TEST_CLOCKS=true` (по подразбиране изключено): всеки нов клиент на Stripe се създава от приложението върху свой Stripe test clock (без име и имейл; Checkout пита платеца), преди Checkout.
- **Move to the end of the period** в `/admin/billing/<id>` мести часовника на клиента до два часа след края на периода (Stripe финализира и таксува фактурата за подновяване около час след създаването ѝ). **Move to the end of the grace period** прекратява абонамента веднага, както последният неуспешен опит при тестовия доставчик.
- Цена: такъв абонамент се подновява **само** когато часовникът се мести, затова настройката е изключена по подразбиране. Абонамент от клиент отпреди включването ѝ няма часовник и получава ясен отказ.
- `pnpm billing:test-clock` (CLI) остава само за тестовия доставчик.

## 4. Годишна цена = 10 месечни (матрица `2026-11-27.1`)

- `YEARLY_MONTHS_CHARGED = 10` в `src/server/entitlements/plans.ts`: Premium Student $40, Professional Sifu $190, Federation $990 годишно (както досега). Цените остават работни предложения (D09).
- `/plans` показва „$19 a month or $190 a year (two months free)“. На `/account/plan` всеки платен план има и годишна оферта с ред „Two months free compared with paying monthly.“ (без срокове и натиск, CLAUDE.md §11). Смяната от месечно към годишно е веднага с приспадане (ADR 0026 §2).
