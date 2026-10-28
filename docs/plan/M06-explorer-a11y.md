# M06 — Изследовател: клавиатура, екранни четци, телефон и разгъване

`docs/plan/M06-explorer-a11y.md` · клон `m06-explorer-a11y` · таван 50 хода · D22, D24

## Цел (Objective)

Изследователят се ползва изцяло с клавиатура, с екранен четец и с докосване. При избор на личност осветява всичките ѝ пътища на произход и зарежда още хора при поискване.

## Прочети първо (Read first)

`docs/WingChunRoots_Technical_Plan.bg.md`: §4.4, §4.7–§4.11, §5.6, §5.8; `docs/design/direction.md`.

## Зависимости (Dependencies)

M05.

## Обхват (In scope)

1. **Клавиатурен модел** от план §4.9:
   - React Flow с `edgesFocusable={false}`, `nodesDraggable={false}`, `nodesConnectable={false}`, `disableKeyboardA11y` и за всеки възел `domAttributes: { tabIndex: id === activeId ? 0 : -1 }`;
   - стрелките се обработват от контейнера. Преди фокус се вика `setCenter` върху целевия възел, изчаква се един кадър, докато той се изобрази, и едва тогава се фокусира;
   - клавишите от един знак (`/`, `?`, `+`, `−`, `0`) работят само при фокус в контейнера на графа;
   - `/` отваря `<SearchPalette>`, ако тя вече е в `main`; иначе фокусира полето за търсене в заглавната лента.
2. **Екранни четци.** Регион `aria-live="polite"` с обявяване на име, статус, брой учители и ученици и надписа за поколението по план §4.4. Всеки възел има `aria-label` и `aria-describedby`.
3. **Избор и осветяване** по план §4.7 (плътни тонове, без прозрачност), с панел: вдясно на десктоп, Base UI Drawer на телефон (немодален, с точки на спиране `[0.15, 0.5, 0.92]`). Панелът показва пътищата на произход като подредени списъци, учителите с период и статус и действията „Open profile“, „Focus this lineage“ и „Show historical“.
4. **Разгъващи бутони** „+N students“ и „+N teachers“ от `hiddenCounts`. Зарежда се само разликата и се пуска нова подредба с набора за разгъване от M03. Ранговете остават същите, а редът в слоя се пази според решението в `docs/adr/0005-graph-layout.md`. Обобщеният възел „and N more →“ над 12 ученици отваря страниран списък.
5. **Докосване.** Бутони за мащаб, побиране и центриране; цели поне 44×44 CSS px на телефон (план §5.8); `touch-action: none` само върху платното. Под 640 px изгледът тръгва с `up=2, down=1`, компактни възли и без миникарта. Долният панел отчита `env(safe-area-inset-bottom)`, ползва `overscroll-behavior: contain` и работи с докосване, без посочване (hover).
6. **Движение** по план §5.8 (д). Изборът, разгъването и долният панел се анимират с токените за движение и запазват позицията на фокуса, а `prefers-reduced-motion` спира анимациите на подредбата.
7. **Документация.** `docs/a11y/explorer.md` на български съдържа ръчния списък за проверка с NVDA и VoiceOver, който собственикът или пилотът изпълняват. `docs/perf/explorer.md` е шаблон за ръчните измервания от план §4.11 (топла и студена подредба).
8. **Снимки и преглед на дизайна.** `@screenshots` записва `docs/screenshots/M06/<изглед>-<390x844|1440x900>-<dark|light>.png`, включително долния панел на телефон. Преди PR нишката прави прегледа на дизайна от план §5.8 (е) и го записва в `docs/design/reviews/M06.md`.
9. **Ръководство:** `docs/guides/user-guide.bg.md` описва клавишите, работата с екранен четец, долния панел на телефон и разгъването.

## Извън обхват (Out of scope)

Самата палитра за търсене (M07). Преходът с `<ViewTransition>` от възел към заглавието на профила е извън обхвата на M06.

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: правилата на axe не се изключват.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M06` завършва с `VERIFY M06: PASS`. `scripts/verify.d/M06.sh` проверява, че снимките и `docs/design/reviews/M06.md` съществуват и че ръководството е променено в клона.
2. E2E тестове в `e2e/m06-explorer-a11y.spec.ts`:
   - `@M06 keyboard only: Tab into the graph, ArrowUp moves to a teacher, the announcement includes name and status, Enter opens the profile`
   - `@M06 exactly one element inside .react-flow has tabindex="0"`
   - `@M06 ArrowDown reaches a student node that started off-screen`
   - `@M06 Space on demo-two-lineages highlights both routes of descent and the panel lists them`
   - `@M06 "+N students" on demo-hub-a adds nodes and keeps the focused node in view`
   - `@M06 a teacher with more than 12 students shows an "and N more" node that opens a paginated list`
   - `@M06 at 390x844 a tap opens the bottom sheet with Open profile; zoom and fit buttons work`
   - `@M06 on mobile every explorer control is at least 44x44 CSS px`
   - `@M06 single-key shortcuts do nothing when focus is outside the graph`
   - `@M06 prefers-reduced-motion disables layout animation`
   - `@M06 "?" opens the shortcut help dialog listing every key`
   - `@M06 no axe violations on /explore at desktop and mobile sizes in dark and light themes`
3. Съществуват `docs/a11y/explorer.md`, `docs/perf/explorer.md`, `docs/screenshots/M06/` и `docs/design/reviews/M06.md`.
4. Описанието на PR съдържа връзки към снимките (десктоп и телефон, двете теми) и към прегледа на дизайна. PR, зелен CI (включително мобилния WebKit и визуалната регресия), чист `git status`.

## Кога да спре и да попита (Stop and ask)

Общите условия. Ръчните проверки с екранен четец и измерванията на устройство не са причина за спиране: те се записват като ръчни задачи за собственика в `docs/a11y/explorer.md` и `docs/perf/explorer.md`.

## Ред за /goal

```text
/goal Implement milestone M06 exactly as written in docs/plan/M06-explorer-a11y.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. First run `git fetch origin`. If branch m06-explorer-a11y exists on origin, check it out and continue from its Progress log and any answered question in docs/plan/questions/M06.md; otherwise branch from origin/main. If a milestone listed under Dependencies is not merged into origin/main, print `BLOCKED M06: dependency <milestone> not merged`. Begin every turn with the line `M06 turn <n>/50`. Success: the goal is met when this conversation shows all of: (1) the step summary printed by `scripts/verify.sh M06`, ending with the line `VERIFY M06: PASS`; (2) the work committed and pushed on branch m06-explorer-a11y with a PR to main whose description is in English and includes that step summary and links to the committed desktop and mobile screenshots in docs/screenshots/M06/ and to the design review in docs/design/reviews/M06.md; (3) the PR's CI checks all passed, including mobile WebKit and visual regression (show the GitHub tool output or `gh pr checks`); (4) `git status` showing a clean tree. Respect the Out of scope, Constraints and Stop and ask sections. Before opening the PR, review the screenshots at 390x844 and 1440x900 in dark and light themes against docs/design/direction.md, fix what falls short and record the review in docs/design/reviews/M06.md. Update the Bulgarian user guide in docs/guides/. Commit and push after every green checkpoint and add one line per checkpoint to the Progress log. Run /code-review on the diff before the final verify and fix only correctness or requirement gaps. Never delete, skip or weaken a test or check to get a pass. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M06.md, commit and push. The goal also ends, not as success, when you print a `BLOCKED M06: <one-line reason>` line (after recording any question as above) or `STOPPED M06: turn limit` followed by a progress summary after 50 turns.
```

## Дневник на напредъка (Progress log)

- 2026-10-27 22:28 — Пакет F, точка F1: Drawer, Dialog и търсенето получават пропуските за изследователя (`initialFocus`, `finalFocus`, `onSnapPointChange`, `headerActions`, `keepMounted`; първата дробна точка на спиране се мери в пиксели; управляем Dialog без задължителен бутон; изнесен `openSearch`); `pnpm lint`, `pnpm typecheck` и единичните тестове са зелени (`a695c99`).
- 2026-10-27 22:28 — Пакет F, точка F2: шевовете на изследователя и заглушките за пакетите A–D (`canvas.tsx`: една спирка на Tab, пазач при загуба на фокуса, обработчикът на клавишите, регионът `aria-live`, бутоните във възела, обобщеният възел, котвата; `explorer.tsx`: `aria-label`, `aria-describedby`, разгъванията, осветените пътища, панелът в свой chunk; `state.ts`: обобщените id, `capFanout` с закачени хора, `withSummaryNodes`); lint, typecheck и unit (84 файла, 1010 теста) са зелени; първоначалният JS на `/explore` е 195,5 kB (195489 байта) (`fde8a4b`).
- 2026-10-27 22:28 — Пакет F, точка F3: помощниците за E2E (`e2e/helpers/explorer-a11y.ts`) и блокът „foundation“ на `e2e/m06-explorer-a11y.spec.ts` (тест 2); `uncoveredNode` избира само възли на личности; lint и typecheck са зелени (`b06f9af`).
- 2026-10-27 22:59 — Пакет F, точка F4: lint, typecheck и unit (84 файла, 1010 теста) са зелени; `pnpm e2e --grep "@M05\b|@M06\b"` 96/96 в desktop-chromium и mobile-chromium; спецификацията на M06 и тестовете на M05 за фокус, клавиатура, панел, легенда и мащаб 40/40 при изгледа на iPhone 15 в Chromium (временен проект, без commit); `/explore` 195,5 kB от 200 kB след `pnpm build:e2e` и `scripts/check-bundle-budget.mjs`. INP тестът на M05 (голям изглед, 4x CPU) падна по веднъж в два пълни прогона, както и на основата `a57f3fa`; самостоятелно, на смени с основата по 8 кръга: 15 от 16 минавания и от двете страни (`0200869`).
- 2026-10-27 23:25 — Пакет A, точка A1: `nav.ts` (↑ към начертаните учители, първо основният по DEFAULT D05, при двама и повече — избор; ↓ към ученика, най-близък по x, обобщеният възел включително; ←/→ в същия ранг без превъртане; причина, когато няма ход) и `announce.ts` („{име}. {статус}. {T} учители, {S} ученици. {поколение}.“ от общите бройки на записа, DEFAULT D22); `nav.test.ts`, `announce.test.ts`, lint и typecheck са зелени (`58f4738`).
- 2026-10-27 23:25 — Пакет A, точка A2: `keys.tsx` (един обработчик върху обвивката на графа, само за клавиш върху възел, WCAG 2.1.4), изборът на учител (менюто на приложението, закотвено за възела), помощта за клавишите, таблицата `shortcuts.ts` и пръстенът на фокуса; `MenuContent` получава `anchor`, `label`, `initialFocus` и `finalFocus`; lint, typecheck и unit (1045 теста) са зелени (`391e6be`).
- 2026-10-27 23:25 — Пакет A, точка A3: E2E тестовете 1, 3, 9, 11, изборът на учител (Esc и Enter) и INP при ArrowDown под 200 ms при 4x CPU са зелени в desktop-chromium (`d3ff0a7`).
- 2026-10-27 23:39 — Пакет A, точка A4: chunk-ът на помощта се иска още при изпълнението на chunk-а на платното, докато тече първата подредба (тестът на M05 за времето на chunk-овете); `pnpm e2e --grep "@M05\b|@M06\b"` — 108 минали в desktop-chromium и mobile-chromium; блокът на клавиатурата е зелен при изгледа на iPhone 15 (`da3b1e2`).
- 2026-10-27 23:42 — Пакет A, точка A5: lint, typecheck и unit (87 файла, 1045 теста) са зелени; тестовете на пакет A са зелени в desktop-chromium, mobile-chromium и при изгледа на iPhone 15 в Chromium (временен проект, без commit); `pnpm e2e --grep "@M05\b|@M06\b"` 108/108; `pnpm build` и бюджетът минават; `/explore` 195,6 kB (195615 байта) от 200 kB (`ca03fe5`).
- 2026-10-27 23:23 — Пакет C, точка C1: разгъване на изгледа („+N students“ и „+N teachers“ четат разликата с `lineage.ego`, сливане по id, закачени хора за `capFanout`, нова подредба с `preset: 'expand'` и 100 ms изчакване), обобщеният възел „and N more“ и списъкът на учениците по 20 на страница; `pnpm lint`, `pnpm typecheck` и `pnpm test` (86 файла) са зелени (`b8ce77b`).
- 2026-10-28 00:25 — Пакет C, точка C2: котвата на разгъването (`anchoredScene`: натиснатият възел пази мястото си, а изгледът не се мести) и `expand-engine.ts` извън първия JS (зарежда се при първото натискане); бутоните във възела пазят Enter и Space за себе си; lint, typecheck, unit (86 файла, 1045 теста), `pnpm test:int` (23 файла) и `pnpm api:openapi --check` са зелени; `/explore` 197,1 kB след `pnpm build:e2e` (`0489fa8`).
- 2026-10-28 00:25 — Пакет C, точка C3: интеграционният тест `lineage-expand.int.test.ts` с петте случая от плана (раздел c) върху демо данните; `pnpm test:int` е зелен (23 файла, 302 теста) (`65a440d`).
- 2026-10-28 00:25 — Пакет C, точка C4: E2E тестовете 5 и 6 (разгъване с клавиатурата и списъкът на обобщения възел) са зелени в desktop-chromium и mobile-chromium (по 3 прогона, тест 5 още 16) (`2dc39f9`).
- 2026-10-28 00:36 — Пакет C, точка C5: lint, typecheck, unit (86 файла, 1045 теста), `pnpm test:int` (23 файла, 302 теста), `pnpm api:openapi --check` и `pnpm e2e --grep "@M05\b|@M06\b"` (100 минали) са зелени; `/explore` 197,1 kB от 200 kB (11 файла); мързеливи chunk-ове: платното 68,5 + 4,1 kB, панелът 3,6 kB, двигателят на разгъването 2,0 kB (`cd89bc4`).
- 2026-10-28 00:40 — R1 (сливане на първия кръг): `m06-wp-a` и `m06-wp-c` са слети с merge commit-и (`bfbfc80`, `4cf6dd2`); единственият конфликт е в import-ите на `e2e/m06-explorer-a11y.spec.ts` и е решен като обединение на двата; `pnpm lint` и `pnpm typecheck` са зелени.
- 2026-10-28 00:51 — R1, точка R1-1: тест 6 отваря списъка на обобщения възел с Enter (клавишите на пакет A), а щракването върху възела се проверява отделно; lint и typecheck са зелени, unit (89 файла, 1080 теста), `pnpm test:int` (23 файла, 302 теста) и `pnpm api:openapi --check` са зелени; `pnpm build:e2e` и бюджетът минават — `/explore` 197,2 kB (197162 байта) от 200 kB; `pnpm e2e --grep "@M05\b|@M06\b"` 112/112 в desktop-chromium и mobile-chromium; спецификацията на M06 9/9 при изгледа на iPhone 15 в Chromium (временен проект, без commit); `scripts/verify.d/M05.sh` е непроменен и всичките му проверки минават без тази за ръководството, което M06 още не е обновило (пакетите D и I) (`025e530`).
- 2026-10-28 02:55 — Пакет B, точка B1: пътищата на произход (`routes.ts`: `litOf` и `litFlow`, нови обекти само за сменените флагове), панелът с пътищата „Route k of N“ (до 5, DEFAULT D05), учителите, „Focus this lineage“ и „Show ended training“, а на телефон немодален долен панел (Drawer с точки 0,15, 0,5 и 0,92, отваря се в отложено рендериране за INP; Esc го сваля, после изчиства избора; „Назад“ го затваря и пази адреса); lint, typecheck и unit (90 файла, 1089 теста) са зелени (`c7a8e0d`).
- 2026-10-28 02:55 — Пакет B, точка B2: осветяването в `globals.css` (осветените хора и връзки с мастило и по-дебели, останалото в плътните приглушени тонове, без прозрачност; преход само на осветените връзки); INP тестът на M05 по 3 пъти на проект е зелен (компютър: малък 136–168, голям 152–168 ms; телефон: малък 136–184, голям 144–168 ms), изборът с долния панел 128–192 ms (`329d1c0`).
- 2026-10-28 02:55 — Пакет B, точка B3: мострата на кривата към учител от друга линия в ключа на „Routes of descent“ е кухата лента от легендата (b13); `pnpm e2e --grep "@M04\b|@M00b\b"` 232/232 (`9953a90`).
- 2026-10-28 02:55 — Пакет B, точка B4: E2E тестовете 4 и 7, INP на избора с долния панел, „Назад“, „Center on this person“ и Esc; тестът на M05 за легендата и бутоните на телефон мери видимата част на долния панел (`visibleBox`); lint, typecheck, unit (90 файла, 1089 теста), `pnpm e2e --grep "@M05\b|@M06\b"` 124/124 в desktop-chromium и mobile-chromium; `/explore` 197,6 kB от 200 kB (`39cb072`).
- 2026-10-28 01:48 — Пакет D, точка D1: бутоните над платното се подреждат според мястото в рамката (`controls-layout.ts`: колона, на телефон два реда, после един ред, в тясна ивица скрити; DEFAULT, без номер D), надписът на React Flow е поле 44 × 44 px под 48 rem, `touch-action: none` е само на `.react-flow`, а **Fit the whole view** показва първия изглед (b4); lint, typecheck и unit (90 файла, 1089 теста) са зелени, тестовете на M05 за нисък телефон, телефон настрани, безопасните зони и Fit са зелени (`4c9b0e2`).
- 2026-10-28 01:48 — Пакет D, точка D2: E2E тестовете 8 (44 × 44 px на три телефона), 10 (намалено движение) и 12 (axe в двете теми на телефон и компютър) са зелени в desktop-chromium и mobile-chromium, освен състоянието с менюто за избор на учител в тест 12 (axe `aria-hidden-focus` на немодалното меню на пакет A; докладвано) (`af575ed`).
- 2026-10-28 02:11 — Пакет D, точка D3: списъкът за ръчна проверка с NVDA и VoiceOver (`docs/a11y/explorer.md`), шаблонът за измерване (`docs/perf/explorer.md`, целите по DEFAULT D24) и черновата на раздела за M06 в ръководството; `pnpm build:e2e` и бюджетът минават, `/explore` 197,2 kB (`2bda178`).
- 2026-10-28 03:03 — Интеграция (I): `m06-wp-b` и `m06-wp-d` са слети с merge commit-и (`4cf119e`, `1ad01aa`); единственият конфликт е в import-ите на `e2e/m06-explorer-a11y.spec.ts` и е решен като обединение на двата; lint, typecheck и unit (91 файла, 1098 теста) са зелени.
- 2026-10-28 03:20 — I, точка I1: менюто за избор на учител е модално (axe `aria-hidden-focus` без изключено правило; цената е в ADR 0010); тест 12 (всички състояния, двете теми) и тестът на менюто са зелени в desktop-chromium и mobile-chromium (`6878ad9`).
- 2026-10-28 03:20 — I, точка I2: фокусът никога не пада на `<body>` (без начертан възел остава върху графа, а следващата стрелка, Enter или Space връщат активния човек; панорамирането на ход с клавиш не отменя фокуса на целта му; скритите бутони връщат фокуса в графа), а средната точка на долния панел се снижава, за да останат над него легендата и избраният човек; lint, typecheck, unit (91 файла, 1098 теста), `pnpm e2e --grep @M06` 38/38; `/explore` 197,5 kB (`93a71e7`).
- 2026-10-28 04:26 — I, точка I3: на телефон бутоните над платното стоят в ъгъла до надписа на React Flow, който се мести вляво от тях (`--attribution-right`), а празното място в обвивката им не взема докосвания; тестовете на M05 и M06 са зелени в изгледа на iPhone в Chromium (66), както и в desktop-chromium и mobile-chromium (131, INP тестът пуснат отново сам) (`94291b6`).
- 2026-10-28 04:26 — I, точка I4: изборът на телефон не разтърсва рамката на платното (мястото под долния панел е височината на спрялата точка, а панелът пази тялото на предишния човек, докато новото е стъпка назад); тестът на M05 за връзките 16/16 с 4 worker-а, INP сам: малък изглед 120–184, голям 128–184, ↓ 72–96, долният панел 112–160 ms (`42fc38d`).
- 2026-10-28 05:40 — I, точка I5: петте състояния на изследователя за снимките и визуалната регресия (`e2e/helpers/m06-states.ts`); `explore-expanded` стига до възела **and N more →** с клавишите вместо с **Fit**, за да са картите четливи; 20 снимки в `docs/screenshots/M06` (`3c11c13`).
- 2026-10-28 05:40 — I, точка I6: панелът на компютър никога не покрива възела, от който клавиатурата го е отворила (`useRevealFocused`, след рисуването; щракване не мести изгледа); нов E2E тест, зелен в desktop-chromium, mobile-chromium и изгледа на iPhone в Chromium (`dea67b2`).
- 2026-10-28 05:40 — I, точка I7: ADR 0010, прегледът на дизайна `docs/design/reviews/M06.md`, ръководството, списъкът за екранни четци, бележките за INP и статусът в `docs/plan/README.md`; `/explore` 197,5 kB от 200 kB след `pnpm build:e2e` (`41bc5ae`).
- 2026-10-28 05:40 — I, точка I8: `scripts/verify.d/M06.sh`; lint, typecheck и unit са зелени (`e5d57c6`).
- 2026-10-28 06:00 — I, точка I9: прегледът на кода (`/code-review high`) — поправени са само грешките: Esc затваря списъка на учениците преди избора (в графа и в списъка); разгънат изглед, който не може да се подреди, се връща към прочетения, вместо да скрие платното; известието за разгъване се казва веднъж; възелът **and N more →** се брои по връзките, както ги ограничава `capFanout`; „1 more student“; ново отваряне на долния панел не помни старата точка; нови unit тестове и E2E тест за Esc; спецификацията на M06 63/63 в desktop-chromium, mobile-chromium и изгледа на iPhone в Chromium (`69a4aa5`).
- 2026-10-28 06:10 — I, точка I10: ръководството за администратора описва M06 (проверката, визуалната регресия, ръчната проверка с NVDA и VoiceOver, тестовете за INP сами), което `scripts/verify.sh M04` иска; `/explore` 197,8 kB от 200 kB след прегледа (`9b10e48`).
- 2026-10-28 06:45 — I, точка I11: `scripts/verify.sh M06` PASS (`69a4aa5`), `M04` PASS (`9b10e48`), `M07` и `M00b` PASS; `M05` пада само на `@M05 selecting a node responds with INP under 200 ms …` на компютър (216–304 ms, и сам с 1 worker), но същата сборка отпреди интеграцията (`42fc38d`) пада и тя на същата машина (176–232 ms, по-рано днес 152–184 ms): машината е по-бавна; тестът не е облекчен, числата са в `docs/perf/explorer.md` и ADR 0010.
- 2026-10-28 06:47 — PR [#18](https://github.com/VladimirKadanov/WingChunRoots/pull/18) е отворен като чернова; CI е зелен на `9324bd3` (с mobile-webkit и визуалната регресия), след като еталоните на двата нови визуални изгледа са взети от CI, а смяната на темата в тестовете чака WebKit да приложи новата схема.
- 2026-10-28 09:55 — Петте независими прегледа в облака (код, достъпност, изисквания, екрани, производителност) с опит за опровергаване на всяка находка: 32 находки, 19 потвърдени, 13 опровергани (сред тях двете за INP: CI мина тези тестове два пъти).
- 2026-10-28 09:55 — Поправки, група 1 (11 находки): фокусът не пада на `<body>` при действия в панела и в долния панел; изборът, изчистването му и списъкът на учениците се обявяват, а избраният възел има „, selected“ в името си; обобщеният възел има описание; бутоните на страниците са 44 px; „Show ended training“ показва натиснатото си състояние; връзките в долния панел заемат неговия запис в историята (`466760c`…`00e52b2`).
- 2026-10-28 10:05 — Поправки, група 2 (5 находки): в нисък прозорец под 768 px долният панел покрива платното, вместо да го смали до нула, а избраният човек остава видим или фокусът влиза в панела; **Fit the whole view** пази хората извън легендата и бутоните при всяко мащабиране; без начертан възел графът сам е единствената спирка на Tab; проверките за плътни тонове, осветяването и намаленото движение в `M06.sh` вече могат да паднат; ADR 0010 описва графа като `role="application"` (`f257e12`…`ae84388`).
- 2026-10-28 10:30 — Пазачите на фокуса на платното са по една функция за целия му живот: изборът и ходът с клавиш вече не рендерират наново всеки начертан възел (находка perf-3); нов E2E тест (`24364ba`, `6d7636d`).
