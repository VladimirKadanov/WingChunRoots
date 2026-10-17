# M03 — Модул за подредба на родословието

`docs/plan/M03-lineage-layout.md` · клон `m03-lineage-layout` · таван 40 хода · D20, D21, D22, D24

## Цел (Objective)

Чист TypeScript модул превръща всеки подграф в рангове, после в ELK граф и накрая в подредена сцена. Резултатът е детерминиран и модулът работи в Web Worker, във фонови задачи в Node и в тестовете. Това е техническата проверка (spike) на избора React Flow с ELK: доказва, че поколенията остават на един ред и че времето е в бюджета. Етапът не зависи от базата и върви паралелно с M01.

## Прочети първо (Read first)

`docs/WingChunRoots_Technical_Plan.bg.md`: §4.1, §4.4, §4.5, §4.6, §4.11, §4.13, §4.14, §6.3.

## Зависимости (Dependencies)

M00. Върви паралелно с M00b, M01, M01b и M02. Не чака `fixtures/lineage-600.json` от M01: има собствен синтетичен граф (точка 1).

## Обхват (In scope)

1. **Синтетични данни.** `src/lib/lineage-layout/testing/synthetic.ts`: детерминиран генератор (със seed) на граф във формата от план §6.3, около 600 души в 3 линии, с хъбове с ≥ 120 ученици и с опорните форми под същите slug-ове като в M01: `demo-root-a`, `demo-root-b`, `demo-shared-ancestor`, `demo-two-lineages`, `demo-converging`, `demo-hub-a`. Ако `fixtures/lineage-600.json` от M01 вече е в `origin/main`, тестовете и бенчмаркът се пускат и върху него; иначе това прави M05.
2. Файлове в `src/lib/lineage-layout/`:
   - `types.ts`: входът е формата от план §6.3;
   - `ranks.ts`: рангове в реда от план §4.4: първо без отрязаните учители, после всеки отрязан учител на `min(rank на учениците му) − 1`, накрая отместване до 0;
   - `elk-graph.ts`: настройките от план §4.5. Layering е винаги `INTERACTIVE` с псевдо y-координата `rank × 200`. Връзките към друга линия не се прокарват от ELK, но участват в ранговете. Връзките от гръбнака на фокуса получават по-висок `elk.layered.priority.straightness`; `priority.direction` не се ползва;
   - `scene.ts`: кутии за трите нива на детайл, ортогонални пътища и контролни точки на Безие за кривите;
   - `layout.ts`: асинхронен API, който ползва `elkjs/lib/elk.bundled.js`. Вика се от worker-а в браузъра или от фонова задача в Node, никога в пътя на заявката;
   - `layout.worker.ts`: единствената входна точка на Web Worker (`/// <reference lib="webworker" />`). Импортира `elk.bundled.js`, пуска подредбата синхронно в своята нишка и отказва остарелите заявки по идентификатор. `elk-worker.min.js` не се ползва;
   - `presets.ts`: набори за изследователя, за разгъване (`elk.layered.crossingMinimization.semiInteractive` с предишните x) и за печат.
3. **Граница чрез ESLint.** Папката не може да импортира `react`, `next`, `src/server` и DOM глобални обекти. `*.worker.ts` е изключен само от правилото за DOM глобалните обекти и може да ползва `self` и `postMessage`.
4. Цикъл във входа дава типизирана грешка, а не зацикляне.
5. **Алгоритъм за разполагане.** NETWORK_SIMPLEX и BRANDES_KOEPF се сравняват с теста от план §4.5: „гръбнакът на фокуса няма точки на огъване в его-изгледите на опорните записи“. Изборът се записва в ADR. Тества се и дали `semiInteractive` с предишните x запазва реда в слоя след разгъване. Ако не го запазва, ADR казва ясно, че стабилни са само ранговете.
6. `pnpm bench:layout` върху синтетичния граф (и върху `fixtures/lineage-600.json`, ако е наличен) записва таблица в `docs/perf/layout-bench.md`: его-изгледи на опорните записи, изглед на една линия, изглед от около 500 души, студена и топла подредба.
7. `docs/adr/0005-graph-layout.md` на български: решението, доказателствата от план §4.13, резервите. Ако резервата d3-dag се разглежда, тя се измерва наново с точната конфигурация от план §4.1.
8. `licenses/addenda/elkjs.md`: текстът на EPL-2.0 и връзка към изходния код на elkjs 0.12.0 (план §4.14). Генераторът на `THIRD_PARTY_NOTICES.md` от M00b го включва, независимо кой от двата етапа се слее пръв.

## Извън обхват (Out of scope)

React компоненти, API, изобразяване, печат. Подредба в процеса на Next.js по време на заявка. Достъп до базата.

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: прагът за производителност и тестовете за ранговете не се отслабват, за да мине избраният алгоритъм.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M03` завършва с `VERIFY M03: PASS`.
2. Единични тестове в `src/lib/lineage-layout/*.test.ts`, които доказват, че:
   - за всяка връзка, включително към друга линия, `rank(ученик) > rank(учител)`, а y следва ранга;
   - еднакъв ранг означава еднаква y-координата;
   - всяка личност е точно един възел;
   - за всеки от двата набора настройки повторното пускане със същия вход дава байт по байт еднакъв изход;
   - синтетичният генератор е детерминиран (еднакъв seed дава еднакъв граф);
   - отрязан учител стои точно един слой над най-високия си ученик;
   - изгледът около `demo-shared-ancestor` (два корена на линии с общ предшественик и връзка към друга линия между клоновете им) спазва правилото за ранговете;
   - гръбнакът на фокуса няма точки на огъване в его-изгледите на опорните записи (с избрания алгоритъм);
   - връзките към друга линия имат път на Безие и не са прокарани от ELK;
   - вход с цикъл връща грешка;
   - тест за границата: временен файл в папката, който импортира `react`, проваля lint, а `layout.worker.ts` минава.
3. Предпазни прагове в `layout.perf.test.ts`: всеки его-изглед от данните ≤ 1000 ms, изглед от 500 души ≤ 2500 ms в Node.
4. Съществуват `src/lib/lineage-layout/testing/synthetic.ts`, `licenses/addenda/elkjs.md`, `docs/perf/layout-bench.md` (с реални измервания) и `docs/adr/0005-graph-layout.md`.
5. PR, зелен CI, чист `git status`.

## Кога да спре и да попита (Stop and ask)

Общите условия, а освен това: ако `INTERACTIVE` не запазва подадените рангове, първо се проверява дали псевдо y-координатите се подават правилно. Ако и тогава поколенията не стоят на един ред, етапът спира с изхода от измерването. Тогава основното архитектурно предположение е паднало и собственикът решава дали да се мине на резервата d3-dag от план §4.1.

## Ред за /goal

```text
/goal Implement milestone M03 exactly as written in docs/plan/M03-lineage-layout.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. First run `git fetch origin`. If branch m03-lineage-layout exists on origin, check it out and continue from its Progress log and any answered question in docs/plan/questions/M03.md; otherwise branch from origin/main. If a milestone listed under Dependencies is not merged into origin/main, print `BLOCKED M03: dependency <milestone> not merged`. Begin every turn with the line `M03 turn <n>/40`. This milestone runs in parallel with M01: build the deterministic synthetic graph generator described in the milestone and do not wait for fixtures/lineage-600.json. Success: the goal is met when this conversation shows all of: (1) the step summary printed by `scripts/verify.sh M03`, ending with the line `VERIFY M03: PASS`; (2) the benchmark table written to docs/perf/layout-bench.md, printed in the conversation; (3) the work committed and pushed on branch m03-lineage-layout with a PR to main whose description is in English and includes that step summary; (4) the PR's CI checks all passed (show the GitHub tool output or `gh pr checks`); (5) `git status` showing a clean tree. Respect the Out of scope, Constraints and Stop and ask sections. Commit and push after every green checkpoint and add one line per checkpoint to the Progress log. Run /code-review on the diff before the final verify and fix only correctness or requirement gaps. Never delete, skip or weaken a test or check to get a pass. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M03.md, commit and push. The goal also ends, not as success, when you print a `BLOCKED M03: <one-line reason>` line (after recording any question as above) or `STOPPED M03: turn limit` followed by a progress summary after 40 turns.
```

## Дневник на напредъка (Progress log)
