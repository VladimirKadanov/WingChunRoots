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
- 2026-10-25 — `/code-review`: списъчният изглед и за човек извън графа (или при неуспешно четене), счупеният worker отказва веднага, етикетът на поколението само по начертаните връзки и с името като име (`lang`, `translate="no"`), скелетът по графа след тавана, Graph след List без сървърно рендериране.
- 2026-10-25 — Отворен е PR [#14](https://github.com/VladimirKadanov/WingChunRoots/pull/14) към `main` като чернова, на `4f804b9`; след него прегледите в облака дадоха поправките на групите по-долу.
- 2026-10-26 — Група D (тестове и проверки): `36fbc3e`, `d57269a`, `a8f9e04`, `eb5ddcf`, `e85af02`. Проверката на бюджета се сверява с частичните prerender-и и търси ELK в chunk-овете; `verify.d/M05.sh` проверява ELK в сглобените chunk-ове и `import()` в кода; E2E тестовете проверяват това, което обещават заглавията им; тестът за раздела-заместител от M00b е върнат срещу `/schools`; INP се мери и в големия изглед Lineage.
- 2026-10-26 — Група A1 (карти, изглед, бутони): `c726b02`, `4dd052d`, `12b5a46`, `7df4a9f`, `67869b5`, `b4ffe75`. Размерите на картите идват от типографската скала; **Fit the whole view** не приближава над мащаб 1, бутоните се движат с токените за движение и пръстенът на фокуса е вътре в тях; графът пази приближението и мястото си при List и обратно, а първият изглед се поставя веднага; връзките се скриват, докато хората се местят; връзка в арбитраж слага етикет на картата на ученика.
- 2026-10-26 — Група A2 (връзки, легенда, крива): `49a37c6`, `42d6145`, `5be28ff`, `d0a156a`, `e010353`. Легендата рисува щрихите на платното; щрихите пазят дебелината и шарката си при отдалечаване; кривата към учител от друга линия минава в пролуката над реда на ученика, с надпис до ученика при дълъг пробег (по подразбиране, ADR 0009, т. 10).
- 2026-10-26 — Група C (начална страница, `lineage.start`, данни): `5d52a10`, `9545f3f`, `6e42422`, `f6ff02c`, `877bfa9`, `ff5117e`. При над 12 ученици първо се чертаят потвърдените и тези, които още учат, а **+N students** брои всички неначертани; интеграционни тестове за `lineage.start`; неуспешното четене се различава от празния запис (с **Retry**); имената на линиите не се превеждат; списъчният изглед в рамката е без втория превключвател.
- 2026-10-26 — Група B (обвивката на изследователя): `0b749dd`, `943de99`, `6ac546e`, `1f2f513`, `1431c83`, `74b4a39`, `8585841`, `f0732fe`, `6ac70f7`, `9fc76d7`, `ec4e166`, `2207836`, `e8e6227`, `77cf894`, `47cf1e5`, `5127ad8`, `bae7958`, `88bd9ac`, `1ea4e52`. Четенето минава през TanStack Query utils на oRPC; телефонът подрежда само своя изглед и го пази при завъртане; React Flow идва с едно `import()` заедно с първата подредба; List показва човека във фокуса; панелът е под графа на телефон и вляво от бутоните от md; легендата казва **Pending**; от 768 px се пазят безопасните зони; изборът не пренаписва редовете за поколението и сменя само възлите и връзките, които засяга (INP в големия изглед пада от 640–690 ms на 128 ms на компютър и 104 ms на телефон в клона на групата); скелетът на телефон има формата на изгледа му.
- 2026-10-26 — Интеграция: `2b61d6e`, `f02766f`, `cad7c5a`, `86184e1`, `8cd1307`, `825b048`, `64f79e8`, `a6aff77`, `bfa8534`, `0440da3` (`Legend strokes="canvas"`, връзката на панела към списъка с `explorerHref`, непреведен надпис „Teacher in …“, надписът React Flow в безопасните зони, web-vitals 6.2.3 за измерването на INP, списъчният изглед като ключов екран, `verify.d/M05.sh` по събрания код, тестът за завъртян телефон във всеки браузър) и документите `0bf500d`, `793e90f`, `0a95cbc`, `be9aeb6`, `4359435`, `0222fde`, `77a04e8` (ръководствата, ADR 0001, 0006 и 0009, въпросите, снимките и кръг 4 на прегледа на дизайна). `/explore` е 193,3 kB от 200 kB; INP при избор при 4x забавяне е 152–224 ms: в големия изглед е близо до прага от 200 ms и от пет пускания два пъти беше 224 ms, а повторното пускане минава (ADR 0009).
- 2026-10-26 — Следват поправката на подредбата за ученици с двама учители (тестът `d80ae8e` на група D, задържан дотогава) и еталоните на `explore-list` за визуалната регресия (от CI).
- 2026-10-26 — Група L (двойното превъртане в списъчния изглед): `3974e15`, `d45116e`, `6b6b7f0`. Превъртащият се списък в рамката е позиционирана рамка (`relative`), затова невидимите за окото текстове (`sr-only`) в заглавието, в „Routes of descent“ и в страниците на учениците остават в него; на телефон рамката брои и долната граница на горната лента. В Graph и в List страницата е колкото екрана (900 px при 1440x900, 844 px при 390x844), а не 3476 и 4762 px (и 845 px в Graph на телефон). E2E тестът `M05 fixes L` го проверява в двата изгледа и при двата размера; снимките `explore-list` са в `docs/screenshots/M05/`.
- 2026-10-26 — Група I (INP на големия изглед): `70f204b`, `5435056`. Всеки възел дава слота си като `measured`, така че React Flow пази измереното за избрания възел и изборът не рисува наново връзките му (в изгледа Lineage на Demo Lineage A по 20 при всеки избор); нов E2E тест го проверява. INP при 4x забавяне, медиана на 14 пускания, редувани с `5645310`: голям изглед 184 → 136 ms на компютър и 152 → 124 ms на телефон, малък 136 → 120 ms и 120 → 112 ms; тестът мина 14 от 14 пъти на всеки проект (преди 8 от 14 на компютър) (ADR 0009).
