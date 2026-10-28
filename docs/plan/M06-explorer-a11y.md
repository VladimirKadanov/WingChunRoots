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
