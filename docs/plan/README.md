# Етапи на Фаза 1: индекс и статус

Каноничният текст на всеки етап е във файла му в тази папка (план §8.3). Общите правила за всяка цел са в [`RULES.md`](RULES.md). Картата на зависимостите е в план §8.1 (`docs/WingChunRoots_Technical_Plan.bg.md`). Въпросите към собственика са в [`questions/`](questions/), по един файл на етап (`questions/Mxx.md`, на английски).

Всеки PR на етап обновява само собствения си ред в таблицата. Възможните статуси са: „не е започнат“, „в изпълнение“, „PR отворен“, „BLOCKED“ (с връзка към въпроса) и „слят“.

| Етап | Файл | Зависи от | Статус |
|---|---|---|---|
| M00 | [M00 — Основа на хранилището и проверка](M00-foundation.md) | Стъпка 0 (PR `docs-bootstrap`) | слят ([#2](https://github.com/VladimirKadanov/WingChunRoots/pull/2) в `docs-bootstrap`; към `main` с [#5](https://github.com/VladimirKadanov/WingChunRoots/pull/5)) |
| M00b | [M00b — Дизайн система по избраната посока](M00b-design-system.md) | M00 и изборът на посока в `docs/design/direction.md` | слят ([#8](https://github.com/VladimirKadanov/WingChunRoots/pull/8)) |
| M01 | [M01 — Модел на данни, роли в базата и фиктивни данни](M01-data-model.md) | M00 | слят ([#3](https://github.com/VladimirKadanov/WingChunRoots/pull/3) в `m00-foundation`; към `main` с [#5](https://github.com/VladimirKadanov/WingChunRoots/pull/5); поправки от прегледа: [#6](https://github.com/VladimirKadanov/WingChunRoots/pull/6)) |
| M01b | [M01b — Фонови задачи и поща](M01b-jobs-mail.md) | M01 | слят ([#7](https://github.com/VladimirKadanov/WingChunRoots/pull/7)) |
| M02 | [M02 — Акаунти, роли и съгласия](M02-accounts.md) | M00b, M01b | слят ([#9](https://github.com/VladimirKadanov/WingChunRoots/pull/9)) |
| M03 | [M03 — Модул за подредба на родословието](M03-lineage-layout.md) | M00 | слят ([#4](https://github.com/VladimirKadanov/WingChunRoots/pull/4)) |
| M04 | [M04 — API за родословието, публичен профил и списъчен изглед](M04-lineage-api.md) | M02 | слят ([#10](https://github.com/VladimirKadanov/WingChunRoots/pull/10), 24.10.2026) |
| M05 | [M05 — Интерактивен изследовател: изгледи и връзки](M05-explorer-views.md) | M03, M04 | слят ([#14](https://github.com/VladimirKadanov/WingChunRoots/pull/14), 26.10.2026) |
| M06 | [M06 — Изследовател: клавиатура, екранни четци, телефон и разгъване](M06-explorer-a11y.md) | M05 | в изпълнение (клон `m06-explorer-a11y`; пакетите F, A, B, C, D и интеграцията са слети в клона, PR предстои) |
| M07 | [M07 — Имена, профил, поверителност на акаунта и търсене](M07-names-search.md) | M04 | слят ([#13](https://github.com/VladimirKadanov/WingChunRoots/pull/13), 26.10.2026) |
| M08 | [M08 — Права по план, тестови права и табла](M08-entitlements.md) | M02 | слят ([#11](https://github.com/VladimirKadanov/WingChunRoots/pull/11), 24.10.2026) |
| M09 | [M09 — Заявки към учител и независими одобрения](M09-teacher-requests.md) | M07, M08 | не е започнат |
| M10a | [M10a — Доказателства, исторически учители и опашка за преглед](M10a-evidence-review.md) | M09 | не е започнат |
| M10b | [M10b — Покани, поемане на профил, проверка на инструктор, сигнали и арбитраж](M10b-claims-reports.md) | M10a | не е започнат |
| M11 | [M11 — Школи, карта и филтри по линия](M11-schools-map.md) | M08, M10a | не е започнат |
| M12 | [M12 — Локално пускане като в production, основно наблюдение, локален архив и учение по възстановяване](M12-local-ops.md) | M10b, M11 | не е започнат |
| M13 | [M13 — Приемане на пилота (локално)](M13-pilot-acceptance.md) | M12 | не е започнат |
| Отложен | [Хостинг и разгръщане](deferred-hosting.md) | M13 и решението на собственика за хостинга (план §3.3) | чака решение на собственика |
