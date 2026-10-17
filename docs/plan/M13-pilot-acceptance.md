# M13 — Приемане на пилота (локално)

`docs/plan/M13-pilot-acceptance.md` · клон `m13-pilot-acceptance` · таван 40 хода · D20, D23, D24

## Цел (Objective)

Целият път на пилота от план §2.2 минава от край до край на десктоп и на телефон (Chromium в облачната сесия и в CI, мобилен WebKit в CI), пълната матрица за оторизация е зелена, а API и интерфейсът са в бюджета. Ръководствата на български покриват целия път. Готовността на Фаза 1 е описана с доказателства и с този етап Фаза 1 се приема.

## Прочети първо (Read first)

`docs/WingChunRoots_Technical_Plan.bg.md`: §2.2, §4.11, §5.5, §5.8, §6.4, §7.5. `docs/design/direction.md`.

## Зависимости (Dependencies)

M12.

## Обхват (In scope)

1. **Начална страница** по план §5.5 и избраната посока: мисия, обяснение на верификацията, търсене, връзки към картата и изследователя, вход и регистрация.
2. **Пакетът `@pilot`** в `e2e/pilot.spec.ts`, пуснат в проектите `desktop-chromium`, `mobile-chromium` и (в CI) `mobile-webkit`.
3. **Пълната матрица за оторизация:** всяка функция на услугите × роля × собственост (`authz-matrix.int.test.ts`), през oRPC и през Server Actions.
4. **`pnpm perf:api`:** p95 на `lineage.ego` и `schools.search` върху тестовите данни, записан в `docs/perf/api.md` до измерванията на заявките от M04.
5. **Бюджетите на интерфейса.** Lighthouse CI в мобилен профил за всички основни маршрути от план §5.5, INP на ключовите взаимодействия и бюджетът на JavaScript, записани в `docs/perf/web-vitals.md`.
6. **Финални снимки** на основните екрани при 390×844 и 1440×900 в двете теми в `docs/screenshots/M13/`.
7. **Ръководствата.** Пълен преглед на `docs/guides/user-guide.bg.md` и `docs/guides/admin-guide.bg.md` спрямо пилотния път: всяка стъпка от `@pilot` е описана на български.
8. **`docs/phase1-readiness.md`:** всяко условие от план §2.2 с доказателство и ясно разграничение кое е подготвено, реализирано и тествано. Документът казва, че Фаза 1 се приема с M13, а хостингът, тестовата среда в облака и архивите извън машината са в отложения етап (план §3.3).

## Извън обхват (Out of scope)

Хостинг, тестова и реална среда в облака, архиви извън машината (отложени, план §3.3). Импорт на реални данни.

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: само фиктивни данни; таванът p95 и бюджетите не се вдигат, за да мине проверката.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M13` завършва с `VERIFY M13: PASS`. Включва всичко от `scripts/verify.sh all`, пакета `@pilot` в проектите на Chromium, матрицата за оторизация и `pnpm perf:api` с p95 < 300 ms (D24 по подразбиране).
2. E2E тестове в `e2e/pilot.spec.ts` (десктоп и телефон):
   - `@pilot register → onboarding → find a teacher with the palette → request → the teacher approves → the relationship shows in the profile, list view and explorer (opened focused from the palette) → find a school within 50 km in the teacher's lineage`
   - `@pilot an unrelated user cannot approve a claim or open evidence`
   - `@pilot a teacher with students in two active lineages sees and manages both`
   - `@pilot a teacher with two active verified teachers in different lineages appears in both lineage views, approves one student in each lineage, and their school is returned by the lineage filter of both roots`
   - `@pilot leak scan: an anonymous crawl of all public routes, the sitemap, Open Graph and JSON-LD finds no private fields, pending edges, involved-only persons, city-only coordinates or evidence keys`
3. В CI: `@pilot` минава и в `mobile-webkit`, а бюджетите от план §5.8 (в) са спазени на всички основни маршрути.
4. Съществуват `e2e/pilot.spec.ts`, `docs/perf/api.md` (с p95), `docs/perf/web-vitals.md`, `docs/screenshots/M13/` и `docs/phase1-readiness.md`; ръководствата са обновени.
5. PR, зелен CI, чист `git status`.

## Кога да спре и да попита (Stop and ask)

Общите условия. Ако p95 надхвърля 300 ms или маршрут не е в бюджета, се записват измерването и най-бавната заявка или най-тежкият маршрут, а етапът спира, вместо таванът да се вдигне.

## Ред за /goal

```text
/goal Implement milestone M13 exactly as written in docs/plan/M13-pilot-acceptance.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. First run `git fetch origin`. If branch m13-pilot-acceptance exists on origin, check it out and continue from its Progress log and any answered question in docs/plan/questions/M13.md; otherwise branch from origin/main. If a milestone listed under Dependencies is not merged into origin/main, print `BLOCKED M13: dependency <milestone> not merged`. Begin every turn with the line `M13 turn <n>/40`. Success: the goal is met when this conversation shows all of: (1) the step summary printed by `scripts/verify.sh M13`, ending with the line `VERIFY M13: PASS`; (2) the p95 values written to docs/perf/api.md and the web-vitals results written to docs/perf/web-vitals.md, printed in the conversation; (3) the work committed and pushed on branch m13-pilot-acceptance with a PR to main whose description is in English and includes that step summary; (4) the PR's CI checks all passed, including @pilot on mobile WebKit and the performance budgets (show the GitHub tool output or `gh pr checks`); (5) `git status` showing a clean tree. Respect the Out of scope, Constraints and Stop and ask sections. Use only clearly fictional fixture data. Review the Bulgarian guides in docs/guides/ against the pilot journey. Commit and push after every green checkpoint and add one line per checkpoint to the Progress log. Run /code-review on the diff before the final verify and fix only correctness or requirement gaps. Never delete, skip or weaken a test or check to get a pass. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M13.md, commit and push. The goal also ends, not as success, when you print a `BLOCKED M13: <one-line reason>` line (after recording any question as above) or `STOPPED M13: turn limit` followed by a progress summary after 40 turns.
```

## Дневник на напредъка (Progress log)
