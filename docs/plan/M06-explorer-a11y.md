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
