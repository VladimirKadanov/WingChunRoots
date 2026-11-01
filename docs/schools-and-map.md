# Школи, карта и филтър по линия (M11)

Този документ описва как работят търсенето на школи, картата, страницата на школа и обявяването на школа: какви данни се пазят, какво става публично, как се пази точното място на школите „само град“ и как се проверява всичко това. Решенията и причините са в [ADR 0013](adr/0013-schools-map.md); ръководствата за потребителя и администратора са в `docs/guides/`.

## Накратко

- Посетителят търси школи на **`/schools`**: близо до град („Near“), в радиус (10–250 km) и по линия („Lineage“: школи, чийто инструктор произлиза от избрания корен). Резултатите са на картата (MapLibre, от 1024 px със списък вляво, на телефон с долен лист) или в списъчния изглед (`?view=list`).
- Школа с **точно местоположение** е плътен пин на своето място; школа **„само град“** („Private club, by invitation“) е кух пръстен в центъра на града. Точната ѝ точка никога не напуска сървъра.
- **`/schools/<slug>`** показва инструкторите (с връзки към профила, списъчния изглед и изследователя), контактите, формите и местоположението.
- Сифу обявява школа в **`/dashboard/schools`**. Черновата е видима само за него. Публичен пин публикува само акаунт с **Professional Sifu**, след преглед на обявата в опашката `/admin/review`. Free Sifu вижда предложението за надграждане вместо „Send for review“.
- Отнемането на Professional Sifu **скрива пина и запазва школата**; ново право го връща без нов преглед.

## Решения по подразбиране

| Решение | Какво прави приложението | Къде |
|---|---|---|
| DEFAULT D08/D18 | Пинът се показва, докато акаунтът, обявил школата, има Professional Sifu; отнемането скрива пина (и публичната страница) и запазва школата | `v_public_school` в миграцията на M11, `src/server/services/schools.ts` |
| DEFAULT D17 | `last_activity_at` се мести само при редакция или „Confirm it is current“, никога при вход | `src/server/services/schools.ts` |
| DEFAULT D12 | Пинове чрез федерация няма до Фаза 3; брои се само акаунтът, обявил школата | `src/server/services/schools.ts`, миграцията на M11, ADR 0013 §3 |
| DEFAULT (M11 In scope 1) | Извлечение от GeoNames за BG, GR, DE, GB, US, HK | `src/server/geo/geonames.ts` |
| DEFAULT (без D номер) | Стиловете на OpenFreeMap: Positron (светла тема) и Dark (тъмна) | `src/server/geo/map-styles.ts` |
| DEFAULT (без D номер) | Обявите се одобряват от модератор или администратор | `src/server/services/school-review.ts` |
| DEFAULT (без D номер) | Страниците на школите са индексируеми и са в `/sitemap.xml`; непублична школа дава 200 с `noindex` | `src/app/schools/[slug]/page.tsx`, `src/app/sitemap.ts` |

Отворените въпроси към собственика са в [`docs/plan/questions/M11.md`](plan/questions/M11.md).

## Данни

### Градовете (`place`)

Извлечението `src/server/geo/data/geonames-places.tsv` (CC BY 4.0) има 5210 населени места. За всяко: английското име (показва се), ASCII името, координатите на центъра, страната, населението и алтернативните имена на китайски и на кирилица (само за търсене). `place.search_text` пази всяко име, сгънато като ключовете за търсене на хора (M07), с trigram индекс, затова „София“, „Sofia“ и „sofiya“ намират един и същ град.

Обновяване (собственикът, на своя компютър):

```bash
# файловете от https://download.geonames.org/export/dump/
pnpm geo:extract --cities cities1000.txt --alternate-names alternateNamesV2.txt --source "GeoNames cities1000.txt and alternateNamesV2.txt of <дата>"
pnpm geo:load        # зарежда файла в базата от DATABASE_URL; db:seed го зарежда сам
```

Идентификаторите на местата идват от GeoNames id, затова школите и профилите запазват градовете си. Записаното извлечение е построено от копието на дъмпа от 18.03.2020 в npm пакета `cities-with-1000` 1.0.4 (въпрос 1 в `questions/M11.md`).

### Школата

| Поле | Публично? |
|---|---|
| име, град, режим на местоположението, уебсайт, e-mail, телефон, описание, форми, инструктори (само публичните им профили), `last_activity_at` | да, щом школата е публична |
| `school.public_point` | само при `exact`; при `city_only` публичната точка е центърът на града |
| `school_private_location.exact_point`, `address_line` | никога: само собственикът на школата я вижда в редактора; `app_public_ro` не чете таблицата |
| `created_by_user_id` | никога; решава дали пинът е разрешен |

Статуси: `draft` (чернова) → `pending_review` (случай `school_listing` в опашката) → `active` (обявена). `hidden` и `archived` от M01 остават за модерация и премахване.

## Поверителност на местоположението (план §6.4)

1. Всяка публична заявка чете `v_public_school`, който за `city_only` дава центъра на града.
2. Радиусът е `ST_DWithin` върху колоната `geography` с GiST индекса; разстоянията са цели километри от публичната точка.
3. Точките в отговорите са закръглени до 5 знака; адрес никога не се връща.
4. Само публичните DTO влизат в кеша (`'use cache'`, минути, таг `schools`).
5. Страницата, JSON-LD (без `geo` за „само град“), изображението за Open Graph и sitemap-ът се строят само от публичното DTO.
6. Одитът и логовете не съдържат координати, адреси и контакти.

E2E тестът `@M11 demo-school-city-only: …` търси точната точка (с 3 до 5 знака) и адреса в отговорите на API, в HTML на страниците, в JSON-LD, в sitemap-а, в изображението за Open Graph и в сървърния лог.

## Картата

- **Зареждане:** само на `/schools`, с `next/dynamic` след страницата; редакторът на школа зарежда малка карта само след „Drop the pin on a map“. Никоя друга страница не зарежда код или стил на картата (`scripts/check-bundle-budget.mjs` → `LAZY_ONLY`, E2E тест).
- **Стилове:** OpenFreeMap (`src/server/geo/map-styles.ts`), сменят се с темата. `MAP_STYLES=local` (и всеки E2E билд) ползва `public/map-styles/light.json` и `dark.json`: фон и мрежа, без външни заявки.
- **Без WebGL2:** същият списък на мястото на картата и връзка към списъчния изглед.
- **Телефон:** долен лист с точки `[0.15, 0.5, 0.92]`; картата държи избрания пин над листа (`padding.bottom` = височината на листа над картата); при по-малко от 88 px видима карта тя е `inert`, докато листът слезе.
- **Адрес:** `lat`, `lng`, `z`, `radius`, `lineage`, `view`; изгледът се пише с `replaceState`, най-много веднъж на 500 ms, само след ход на читателя или избор.

Бюджети (gzip): `/schools` 159,6 kB от 170 kB; MapLibre 287,3 kB след страницата (ADR 0013 §7).

## Обявяване и преглед

1. Сифу с профил: `/dashboard/schools` → „List a school“ → формата (име, град, режим, точка, контакти, описание, форми, инструктори) → „Save the draft“.
2. Free Sifu: на страницата на школата вижда `<UpgradePrompt>` с „Request pilot access“; `schools.submit` отговаря `ENTITLEMENT_REQUIRED`.
3. Pro Sifu: „Send for review“ → `pending_review` и случай `school_listing`.
4. Модератор или администратор в `/admin/review`: „Approve the listing“ (школата става `active`, пинът се показва), „Return it to draft“ (с причина) или „Ask for more information“ (въпрос към Сифу; той изпраща обявата отново).
5. Обявена школа: „Confirm it is current“ мести `last_activity_at`; редакциите ѝ се виждат веднага, без нов преглед.

## API

Всички четения и промени са oRPC процедури в `/api/rpc` и `/api/v1` (договорът е `docs/api/openapi.json`):

| Процедура | Път в `/api/v1` | Кой |
|---|---|---|
| `schools.search` | `POST /schools/search` | всеки: радиус и/или линия |
| `schools.inViewport` | `POST /schools/in-viewport` | всеки: школите в правоъгълник |
| `schools.get` | `GET /schools/{slug}` | всеки; 404 за непублична |
| `schools.sitemap` | `GET /sitemap/schools` | всеки |
| `places.search` | `GET /places/search` | всеки |
| `schools.mine`, `schools.edit`, `schools.options` | `GET /schools/mine`, `/schools/mine/{id}`, `/schools/mine/new` | собственикът |
| `schools.create`, `update`, `submit`, `confirm` | `POST /schools/…` | собственикът (Сифу с профил) |
| `review.decide` (за `school_listing`) | `POST /review/decide` | модератор или администратор с потвърден втори фактор |

## Тестове

- **Интеграционни** (`src/server/services/schools.int.test.ts`): школа на 49 km се връща, на 51 km не; разстоянията са цели километри; `EXPLAIN` показва GiST индекса; `app_public_ro` не чете `school_private_location`; филтърът по линия; Free Sifu не публикува; Pro Sifu публикува след преглед, а отнемането скрива пина; `last_activity_at` не се мести при вход.
- **E2E** (`e2e/m11-schools.spec.ts`, проектът `exclusive`, защото одобрената обява прави школа публична): дванадесетте заглавия на етапа и записът на изгледа в адреса.
- **Бюджет:** `scripts/check-bundle-budget.mjs` (маршрутите и `LAZY_ONLY`).
- **Проверка на етапа:** `scripts/verify.d/M11.sh`.
