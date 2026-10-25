# M05 — Интерактивен изследовател: изгледи и връзки

`docs/plan/M05-explorer-views.md` · клон `m05-explorer-views` · таван 50 хода · D03, D05, D22, D24

## Цел (Objective)

`/explore` показва интерактивен граф на родословието, подреден по поколения, около избрана личност или линия. Връзките с няколко учители и с учители от друга линия са нарисувани правилно. Легендата на статусите е постоянно видима, а превключвателят „Graph / List“ работи.

## Прочети първо (Read first)

`docs/WingChunRoots_Technical_Plan.bg.md`: §4.1, §4.3–§4.8, §4.11, §5.2, §5.8, §10.2 (ред 9); `docs/design/direction.md`.

## Зависимости (Dependencies)

M03, M04.

## Обхват (In scope)

1. **Клиентски остров.** `@xyflow/react` 12.12.0, зареден с `browser()` или `next/dynamic`. ELK се зарежда само тук, през `src/components/lineage/useLayoutWorker.ts`. Той създава worker-а от M03 с `new Worker(new URL('../../lib/lineage-layout/layout.worker.ts', import.meta.url), { type: 'module' })` и го подгрява с малка фиктивна подредба при зареждане на маршрута. Данните идват от TanStack Query с клиента на oRPC. Състоянието е в URL (nuqs): `focus`, `up`, `down`, `lineage`, `show`, `view`.
2. **Изгледи:** личност (по подразбиране), N поколения със стъпки и една линия (план §4.3).
3. **Възли.** Персонализирани възли с фиксирани размери за трите нива на детайл (план §4.5) и превключване по мащаб (план §4.8). Показват име с `lang`, титла, икона и текст за статуса, чип „2 teachers“ и надпис за поколението по правилото от план §4.4. Включен е `onlyRenderVisibleElements`.
4. **Връзки:** главна, събираща се, крива към друга линия, историческа, в преглед и в арбитраж, точно по таблицата в план §4.6.
5. **Легенда** в рамката на изследователя: икона, образец на щриха и текст.
6. **Превключвател „Graph / List“.** `<Activity>` пази състоянието на графа, а списъкът е съдържанието от M04.
7. **Избор на възел** отваря прост панел с „Open profile“. Пълният панел и клавиатурата са в M06.
8. **Зареждане:** скелет със същата форма, докато подредбата работи.
9. **Значката на React Flow остава** (решение по подразбиране; план §10.2, ред 9).
10. **Снимки и преглед на дизайна.** Playwright проектът `@screenshots` записва `docs/screenshots/M05/<изглед>-<390x844|1440x900>-<dark|light>.png` за трите изгледа (план §7.8). Преди PR нишката прави прегледа на дизайна от план §5.8 (е) и го записва в `docs/design/reviews/M05.md`. Ключовите екрани влизат във визуалната регресия (`@visual`).
11. **Бюджети и движение** (план §5.8). Бюджетът на JavaScript за `/explore` се измерва и записва в ADR (ELK е в worker-а и не влиза в него). INP при избор на възел се мери при 4× забавяне на процесора. Анимацията на подредбата ползва токените за движение. Изследователят запълва динамичната височина (`dvh`) и спазва безопасните зони.
12. **Ръководство:** `docs/guides/user-guide.bg.md` описва изследователя, трите изгледа, легендата и превключвателя „Graph / List“.

## Извън обхват (Out of scope)

Клавиатурен модел, `aria-live`, осветяване на предците, разгъващи бутони, долен панел на телефон (M06). Изгледът „път между двама души“.

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: библиотеката за графа не се сменя без решение на собственика.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M05` завършва с `VERIFY M05: PASS`. `scripts/verify.d/M05.sh` проверява, че снимките и `docs/design/reviews/M05.md` съществуват и че ръководството е променено в клона.
2. E2E тестове в `e2e/m05-explorer.spec.ts`:
   - `@M05 ego view of demo-two-lineages shows two incoming teacher edges`
   - `@M05 cross-lineage teacher edge is curved, long-dashed and labelled with the lineage`
   - `@M05 demo-converging shows two same-lineage incoming edges, routed orthogonally, with the student placed horizontally between both teachers and a "2 teachers" chip`
   - `@M05 historical relationships are hidden by default and shown with show=historical`
   - `@M05 all nodes of one generation share the same y position`
   - `@M05 the label reads "Generation N from {root}" only when the view root is the lineage root and every edge on the path is verified, and "N generations below {name} in this view" otherwise`
   - `@M05 reload keeps focus, depth and view from the URL`
   - `@M05 profile page does not request the ELK worker; the explorer page does`
   - `@M05 the explorer shows a shape-matched loading skeleton while the layout runs`
   - `@M05 legend shows an icon, a stroke sample and text for every status in view`
   - `@M05 Graph/List toggle switches views and back without losing the focus person`
   - `@M05 at 390x844 the explorer fills the dynamic viewport height and keeps its controls inside the safe areas`
   - `@M05 selecting a node responds with INP under 200 ms at 4x CPU throttling`
   - `@M05 no axe violations on /explore in dark and light themes`
3. Съществуват `src/components/lineage/`, `docs/screenshots/M05/` и `docs/design/reviews/M05.md`; бюджетът на JavaScript за `/explore` е записан в ADR.
4. Описанието на PR съдържа връзки към снимките в `docs/screenshots/M05/` и към прегледа на дизайна. PR, зелен CI (включително мобилния WebKit, визуалната регресия и бюджетите), чист `git status`.

## Кога да спре и да попита (Stop and ask)

Общите условия, а освен това: ако React Flow очевидно не се справя с данните (например местенето на изглед от 500 души насича). Тогава се записва измерването. Резервата Cytoscape.js **не** се включва без решение на собственика.

## Ред за /goal

```text
/goal Implement milestone M05 exactly as written in docs/plan/M05-explorer-views.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. First run `git fetch origin`. If branch m05-explorer-views exists on origin, check it out and continue from its Progress log and any answered question in docs/plan/questions/M05.md; otherwise branch from origin/main. If a milestone listed under Dependencies is not merged into origin/main, print `BLOCKED M05: dependency <milestone> not merged`. Begin every turn with the line `M05 turn <n>/50`. Success: the goal is met when this conversation shows all of: (1) the step summary printed by `scripts/verify.sh M05`, ending with the line `VERIFY M05: PASS`; (2) the work committed and pushed on branch m05-explorer-views with a PR to main whose description is in English and includes that step summary and links to the committed screenshots in docs/screenshots/M05/ and to the design review in docs/design/reviews/M05.md; (3) the PR's CI checks all passed, including mobile WebKit, visual regression and the performance budgets (show the GitHub tool output or `gh pr checks`); (4) `git status` showing a clean tree. Respect the Out of scope, Constraints and Stop and ask sections. Do not switch graph libraries. Before opening the PR, review the screenshots at 390x844 and 1440x900 in dark and light themes against docs/design/direction.md, fix what falls short and record the review in docs/design/reviews/M05.md. Update the Bulgarian user guide in docs/guides/. Commit and push after every green checkpoint and add one line per checkpoint to the Progress log. Run /code-review on the diff before the final verify and fix only correctness or requirement gaps. Never delete, skip or weaken a test or check to get a pass. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M05.md, commit and push. The goal also ends, not as success, when you print a `BLOCKED M05: <one-line reason>` line (after recording any question as above) or `STOPPED M05: turn limit` followed by a progress summary after 50 turns.
```

## Дневник на напредъка (Progress log)

- 2026-10-25 — Изследователят `/explore` е готов: сървърна страница с началните точки (`lineage.start`) и първото четене, клиентски остров (TanStack Query с клиента на oRPC, състоянието в адреса с nuqs, React Flow с `next/dynamic`), подредбата в worker-а с ELK, трите изгледа, нивата на детайл, връзките от план §4.6 с легендата, панелът на избора, скелетът и Graph/List с `<Activity>`; `e2e/m05-explorer.spec.ts` минава (28/28); бюджетът на `/explore` е 200 kB при измерени 190,3 kB, а INP при избор е 112 ms (компютър) и 120 ms (телефон) при 4x забавяне (ADR 0009).
- 2026-10-25 — Снимките в `docs/screenshots/M05/` са готови; при компактните карти и точките връзките се довеждат до кутията, която се вижда (`joinToBox`), а изглед с над 40 души се отваря центриран върху фокуса с пълни карти вместо смален до точки.
- 2026-10-25 — Четири независими прегледа (коректност, поверителност, изисквания, екрани) и прегледът на дизайна (`docs/design/reviews/M05.md`): един и същи прочит на адреса в сървъра и браузъра, грешката в подредбата важи само за своя отговор, сцената остава при нова подредба (анимацията), „Center on this person“ в изгледа Lineage, чипът и печатът само по начертаните връзки, скрити самотни хора с приключило обучение, етикетът на поколението само в една линия, таг `explore-start`, бутони от 44 px (тестът проверява 44), INP с измерване и в WebKit, монограм на картата, долен панел на телефон; въпроси за титлата, компактните карти и бюджета на React Flow.
