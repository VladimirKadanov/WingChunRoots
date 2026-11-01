# M11 — Школи, карта и филтри по линия

`docs/plan/M11-schools-map.md` · клон `m11-schools-map` · таван 50 хода · D08, D12, D17, D18

## Цел (Objective)

Посетителят намира школи на картата или в списък по радиус и по линия. Школите в режим „само град“ никога не издават точните си координати. Публичен пин публикува само инструктор с право `pro_sifu`.

## Прочети първо (Read first)

`docs/WingChunRoots_Technical_Plan.bg.md`: §2.3, §3.3, §5.3 (правилото за картата), §5.6, §5.8, §6.2, §6.3, §6.4, §6.5, §6.8; `docs/design/direction.md`.

## Зависимости (Dependencies)

M08, M10a (опашката за преглед).

## Обхват (In scope)

1. **`place`.** Извлечение от GeoNames за България и страните на фиктивните школи от M01 (`DEFAULT`: BG, GR, DE, GB, US, HK), с атрибуция CC BY 4.0. Показва се английското име, а алтернативните имена (например на `zh` и `bg`, където ги има) служат за търсене. Други страни се добавят след решение на собственика. Атрибуцията на GeoNames и OpenStreetMap влиза в `/legal/licenses` чрез `licenses/addenda/`.
2. **`/dashboard/schools`.**
   - Полета: име, град, режим на местоположението (`exact` или `city_only`), точна точка, избрана с „drop the pin“ (без доставчик на геокодиране), уебсайт, начини за контакт, преподавани форми.
   - Инструктори (`school_instructor`).
   - Статус `draft` → `pending_review` (опашката от M10a, вид `school_listing`) → `active`.
   - `last_activity_at` се обновява само при редакция или потвърждение на школата, никога при вход (D17).
3. **Права.** Публичен пин само ако инструкторът на школата има право `pro_sifu` (тестово право). Безплатен Сифу може да създаде чернова, но при публикуване вижда `<UpgradePrompt>`. Правилата за пинове чрез федерация са във Фаза 3 (D12). Отнемането на правото скрива пина, без да изтрива школата (`DEFAULT D08/D18`).
4. **Поверителност** по план §6.4:
   - `public_point`, `school_private_location`, `precision: "city"`, разстояния, закръглени до 1 km;
   - заявките са `ST_DWithin(public_point, ST_SetSRID(ST_MakePoint($lng,$lat),4326)::geography, $radius_m)` върху колоните `geography` от M01. Колона `geometry` не се преобразува по време на заявката;
   - процедури `schools.inViewport` и `schools.search({ center, radiusKm, lineageRootId })`; редакцията и публикуването на школа също са oRPC процедури, обвити от Server Actions (план §6.8).
5. **`lineage_membership`.** Материализира се за избраните корени само от `v_public_edge` и се обновява със задача на pg-boss при промяна в потвърдените ребра. После worker-ът вика `POST /api/internal/revalidate`.
6. **Карта.** MapLibre GL JS 6.14 с `@vis.gl/react-maplibre` 8.1.3. Зарежда се само на `/schools`. Адресите на стиловете на OpenFreeMap за тъмната и за светлата тема са в конфигурацията и картата сменя стила заедно с темата, а тестовете ползват локален минимален стил без външни заявки. Контролата за атрибуция е включена. Черновата на политиката за поверителност посочва OpenFreeMap като получател.
   - **Маркери:** точен пин; кух маркер „Private club, by invitation“ в центъра на града; различни по форма и текст, не само по цвят.
   - **Долен панел на телефон** с точки на спиране `[0.15, 0.5, 0.92]` и надпис като „23 schools within 50 km · {lineage}“. `padding.bottom` на картата е равен на височината на панела, а панелът отчита `env(safe-area-inset-bottom)`.
   - **Десктоп:** списък встрани.
   - **Състояние в URL:** `lat`, `lng`, `z`, `radius`, `lineage`, `view`, `clat`, `clng` (центърът от „Search this area“, отделен от изгледа; добавени при прегледа). Записът при местене на картата е с `replace` и ограничена честота.
   - **Резервен списъчен изглед**, ако WebGL2 не е наличен.
7. **`/schools/[slug]`.** Инструктори с връзки към профила, списъчния изглед и изследователя; контакти; местоположение (точно или само град).
8. **Sitemap, Open Graph и JSON-LD** за школите, генерирани само от публичните DTO.
9. **Снимки и преглед на дизайна.** `@screenshots` записва `docs/screenshots/M11/<изглед>-<390x844|1440x900>-<dark|light>.png`. Преди PR нишката прави прегледа на дизайна от план §5.8 (е) и го записва в `docs/design/reviews/M11.md`. Бюджетът на JavaScript за `/schools` се измерва и записва в ADR (план §5.8 (в)).
10. **Ръководства:** `docs/guides/user-guide.bg.md` описва търсенето на школи, картата, страницата на школа и обявяването на школа; `docs/guides/admin-guide.bg.md` описва прегледа на обявите и публикуването на пин.

## Извън обхват (Out of scope)

Проверка за активност 90/105 дни (Фаза 2, D17 и D18). Топлинна карта за федерации. Самостоятелно хостнати плочки Protomaps (заедно с хостинга, план §2.3 и §3.3). График, такси, снимки и пробна тренировка (Фаза 2, план §2.3).

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: точните координати на школа „само град“ никога не напускат сървъра.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M11` завършва с `VERIFY M11: PASS`. `scripts/verify.d/M11.sh` проверява, че снимките и `docs/design/reviews/M11.md` съществуват и че ръководствата са променени в клона.
2. E2E тестове в `e2e/m11-schools.spec.ts`:
   - `@M11 the radius filter returns schools within 50 km and excludes one outside`
   - `@M11 the lineage filter returns only schools whose instructors descend from the chosen fictional root`
   - `@M11 a school whose instructor is demo-two-lineages is returned for both lineage roots`
   - `@M11 demo-school-city-only: the exact coordinates appear in no API response, page, sitemap, Open Graph image, JSON-LD or test-results/server.log`
   - `@M11 a Free Sifu sees an upgrade prompt instead of publishing a pin; a Pro Sifu test plan publishes after listing review`
   - `@M11 revoking the Pro Sifu test grant hides the pin and keeps the school`
   - `@M11 pages other than /schools load no map code or map style`
   - `@M11 with WebGL unavailable the list view shows the same schools`
   - `@M11 at 390x844 selecting a pin opens the sheet and the pin stays visible above it`
   - `@M11 the school page links to the instructor's profile, list view and explorer`
   - `@M11 the map switches between the dark and light styles together with the theme`
   - `@M11 no axe violations on the /schools list view and a school page in dark and light themes`
3. Интеграционни тестове: школа на 49 km се връща, а на 51 km не; `EXPLAIN` показва GiST индекса върху колоната `geography`; `app_public_ro` не може да чете `school_private_location`; разстоянията са закръглени до 1 km; `last_activity_at` не се променя при вход.
4. Съществуват `src/server/geo/`, `docs/schools-and-map.md` (на български), `docs/screenshots/M11/`, `docs/design/reviews/M11.md` и добавката за GeoNames и OpenStreetMap в `licenses/addenda/`; бюджетът на JavaScript за `/schools` е записан в ADR. Изпълнен е `/security-review`. Описанието на PR съдържа връзки към снимките и към прегледа на дизайна. PR, зелен CI (включително мобилния WebKit, визуалната регресия и бюджетите), чист `git status`.

## Кога да спре и да попита (Stop and ask)

Общите условия, а освен това: ако пилотът изисква страни извън извлечението на GeoNames, или ако OpenFreeMap е недостъпен от средата. В тестовете се ползва локалният стил, а проблемът се записва.

## Ред за /goal

```text
/goal Implement milestone M11 exactly as written in docs/plan/M11-schools-map.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. First run `git fetch origin`. If branch m11-schools-map exists on origin, check it out and continue from its Progress log and any answered question in docs/plan/questions/M11.md; otherwise branch from origin/main. If a milestone listed under Dependencies is not merged into origin/main, print `BLOCKED M11: dependency <milestone> not merged`. Begin every turn with the line `M11 turn <n>/50`. Success: the goal is met when this conversation shows all of: (1) the step summary printed by `scripts/verify.sh M11`, ending with the line `VERIFY M11: PASS`; (2) the work committed and pushed on branch m11-schools-map with a PR to main whose description is in English and includes that step summary and links to the committed screenshots in docs/screenshots/M11/ and to the design review in docs/design/reviews/M11.md; (3) the PR's CI checks all passed, including mobile WebKit, visual regression and the performance budgets (show the GitHub tool output or `gh pr checks`); (4) `git status` showing a clean tree. Respect the Out of scope, Constraints and Stop and ask sections. Exact coordinates of city-only schools must never leave the server. Every mutation is an oRPC procedure; Server Actions only wrap it. Before opening the PR, review the screenshots at 390x844 and 1440x900 in dark and light themes against docs/design/direction.md, fix what falls short and record the review in docs/design/reviews/M11.md. Update the Bulgarian user and admin guides in docs/guides/. Commit and push after every green checkpoint and add one line per checkpoint to the Progress log. Before the final verify run /code-review and /security-review on the diff and fix correctness, privacy or requirement gaps only. Never delete, skip or weaken a test or check to get a pass. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M11.md, commit and push. The goal also ends, not as success, when you print a `BLOCKED M11: <one-line reason>` line (after recording any question as above) or `STOPPED M11: turn limit` followed by a progress summary after 50 turns.
```

## Дневник на напредъка (Progress log)

- 2026-11-01 05:56 — миграцията `*_m11_schools_map` (статусите на школата, формите и контактите, `place.alternate_names` и `search_text`, един отворен случай на школа, `v_public_school` с правилото за пина, DEFAULT D08/D18), извлечението от GeoNames за BG, GR, DE, GB, US и HK (`scripts/geonames-extract.ts`, `pnpm geo:extract`, `pnpm geo:load`) и зареждането му от `db:seed` (f0c1d5e)
- 2026-11-01 06:15 — услугите `schools.*` и `places.search` (радиус с `ST_DWithin` върху `geography`, цели километри, филтър по линия от `lineage_membership`), прегледът на обявите в опашката на M10a (`school_listing`), процедурите в `/api/rpc` и `/api/v1`, договорът OpenAPI и интеграционните тестове (c692f9d)
- 2026-11-01 06:55 — `/schools` с картата (MapLibre 6.14 и `@vis.gl/react-maplibre` 8.1.3 с `next/dynamic`, работникът през `?asset`, долният лист `[0.15, 0.5, 0.92]`, адресът с `replaceState`, списък без WebGL 2), `/schools/[slug]` с Open Graph и JSON-LD, sitemap, таблото `/dashboard/schools` с тънки Server Actions; ADR 0001 и бюджетът на `/schools` с `LAZY_ONLY` (0a23d06)
- 2026-11-01 07:20 — `e2e/m11-schools.spec.ts` с дванадесетте заглавия и записа на изгледа в адреса в проекта `exclusive` (`PUBLIC_WRITE_SPECS`), ключовите маршрути, състоянията на екраните, добавките за GeoNames и OpenStreetMap; редакторът на отделна страница, за да остане под 170 kB (373c077)
- 2026-11-01 07:32 — ADR 0013 (след сливането с M10b — ADR 0014), `docs/schools-and-map.md`, седемте въпроса към собственика (`docs/plan/questions/M11.md`), двете ръководства (0ff33e0, 1dddb36, f8ac913)
- 2026-11-01 07:51 — снимките в `docs/screenshots/M11/` и първият кръг на прегледа на дизайна: списъкът встрани вече не удължава страницата, контролите на картата следват темата и са 44×44 px при докосване (2ce12d8, 56df402, 0c45d1c)
- 2026-11-01 07:56 — ъглите на контролите и на бутона на списъка, празното търсене и страницата на непублична школа като ключови екрани, DEFAULT D12, моделът на данните, `scripts/verify.d/M11.sh` (5a35322…ebe7712)
- 2026-11-01 08:13 — формата за нова школа не избира режим на местоположението предварително (правилото на M08, c09e282); всеки `scripts/verify.d/*.sh` минава сам; прегледът на дизайна `docs/design/reviews/M11.md` и новите снимки (0cc404a, 4871cc6)
- 2026-11-01 08:28 — тестът за границата на картата пише пробите си в `src/components/schools`, а не в общата папка на теста за правата (двата паралелни теста трият пробите си взаимно, c5f8fd2); самопрегледът на сигурността и поверителността без нови находки; `scripts/verify.sh M11` → `VERIFY M11: PASS` (E2E 158 + 13 в проекта `exclusive`; `/schools` 159,6 kB от 170 kB, MapLibre 287,3 kB след страницата). Визуалните еталони на новите екрани се приемат от CI
- 2026-11-01 14:40 — поправките от прегледа на PR #23 (групи A, B и C: прегледът на обявата не се заобикаля с редакция, решението носи версията на обявата, изтриването на акаунт на Сифу архивира школите му, публичните инструктори и филтърът по линия, `inViewport` по паралели, `clat`/`clng` в адреса, листът на телефон, атрибуцията, голям текст и принудителни цветове, картата за пина), документацията и ръководствата, приетите визуални еталони на непроменените екрани, новите снимки; INP на `/explore` на клона не е по-бавен от main (10 + 10 повторения); `scripts/verify.sh M11` → `VERIFY M11: PASS` (E2E 182 + 13 в `exclusive`) на 298397b
- 2026-11-01 15:40 — слят `origin/main` с M10b (PR #22, ae08122) с merge commit: ADR на M11 преномериран на 0014 (`docs/adr/0014-schools-map.md`, 0013 е на M10b), миграцията на M11 генерирана отново след тази на M10b (`20261101151739_m11_schools_map`, същият SQL), случаите **School listing** минават през общото ядро на опашката от M10b (`review-core.ts`: решават модератор или администратор, възлагането се пише в `review_event`), разделът за школите в ръководството за администратора е вече 17; таймаутът на задачата `verify` в CI е 90 минути; `scripts/verify.sh M11` и `M10b`: PASS; 20-те базови снимки на M11 (schools-list, dashboard-schools, dashboard-school-new, schools-map, schools-map-selected) са приети от CI run 41316483820 в отделен commit; след това: случаите **School listing** записват историята на прегледа като другите видове (51dbd0a); `/dashboard/students/requests` отново под бюджета си — двете граници за грешка (на таблото и на страницата) носеха цялата таблица `LOAD_ERRORS`, към която M11 добави два записа (170,0 → 169,4 kB от 170 kB; на main 169,9 kB), сега текстовете са по един модул на страница в `src/components/account/load-errors/` (28ea093); от CI run 41323978929: бутонът „Drop the pin on a map“ се рисува и от сървъра (неактивен до хидратацията, скрит без JavaScript), за да не мести отметките под него (a411dd9), axe изчаква заглавието на документа след пренасочване от Server Action (5309f16), базовите снимки dashboard-sifu 1440x900 в двете теми (f41d801); `scripts/verify.sh M11`: PASS, всеки `scripts/verify.d/*.sh`: PASS
