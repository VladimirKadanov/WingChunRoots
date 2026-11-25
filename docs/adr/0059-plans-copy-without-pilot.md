# ADR 0059: Страницата с плановете и текстове без „пилот“

| | |
|---|---|
| Статус | Прието (25.11.2026) |
| Контекст | Прегледът на всички роли (25.11.2026, https://claude.ai/artifact/6bt42cDSmTEspvjVeMzH5u), находка P1-5. Собственикът поиска P1. |
| Свързани | M08, [ADR 0044](0044-premium-student.md), `docs/entitlements.md` (матрица `2026-11-25.1`) |

## Проблемът

1. `/plans` започва раздела за ученици с „In the pilot both student plans give the same… What Premium Student adds is planned.“, а таблицата под него показва галерия, видеа, карта на родословието, представен профил, кунг-фу семейство и паспорт — всички работят.
2. Колоната Free на планирания ред „Advertising“ пише „Ads shown“: недостатък, за който никой не е питал, на сайт без реклами.
3. Членовете виждат „пилот“ навсякъде: „Join the pilot“, „Plans of the pilot“, „The pilot lists a small set of cities“, „Write to the pilot team“, „carried out by hand during the pilot“.

## Решение

- Изречението за учениците изброява какво добавя Premium Student днес. Групата „In the pilot“ в таблиците става **Available now**, заглавието — **Plans and what they include**; „Most of it is planned“ при организациите отпада.
- Редът `advertising` е `hidden: true` (матрица `2026-11-25.1`): редът от спецификацията §3.1 остава, но не се показва на `/plans` и в каталога на API.
- Членски текстове без „пилот“: регистрацията („Join WingChunRoots“, „WingChunRoots is open to people aged 18 or older“), съгласието за възраст, спряният акаунт („Write to the WingChunRoots team“), градовете („Countries with cities“, „Only some cities are listed so far“), изтриването на данни, плановете в настройките и съобщенията за Federation.
- **Остават:** „Test mode, no real charge“ и „Proposed price (not final)“; потокът **Request pilot access** (бутонът, известията и списъкът при администраторите), защото е самата функция и ще отпадне с истинските плащания; правните чернови (чакат пренаписването на известието за поверителност); панелът за администратори.

## Последици

- Тестове: отпечатъкът на матрицата в `src/server/entitlements/plans.test.ts`; `e2e/m08-entitlements.spec.ts` (заглавието; скритите редове вече се проверяват общо), `e2e/m02-auth.spec.ts` (съгласието за възраст). Визуалните еталони на `/plans`, регистрацията и първоначалния профил се приемат от CI.
- Ръководство: `docs/guides/user-guide.bg.md`, „Плановете“.
