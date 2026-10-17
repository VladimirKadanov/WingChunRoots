# M00b — Дизайн система по избраната посока: токени, теми, шрифтове и компоненти

`docs/plan/M00b-design-system.md` · клон `m00b-design-system` · таван 40 хода · D01

## Цел (Objective)

Приложението получава дизайн системата на посоката, избрана от собственика (план §5.8): токени за тъмна и светла тема с проверен контраст, генерирани като CSS и JSON; самостоятелно хостнати шрифтове; shadcn/ui върху Base UI, оформени по посоката; обвивка, която работи добре на телефон и в мобилен webview; бюджети за производителност; страница с лицензите. Създават се и ръководствата на български за потребителя и администратора.

## Прочети първо (Read first)

- `docs/design/direction.md` и файла на прототипа, посочен в него (в `docs/design/prototypes/`).
- `docs/WingChunRoots_Technical_Plan.bg.md`: §3.1, §4.7 (приглушените тонове), §4.14, §5 (целия, особено §5.8), §6.8, §10.2 (ред 2).

## Зависимости (Dependencies)

M00. Изборът на собственика, записан в `docs/design/direction.md` в `origin/main`. Върви паралелно с M01, M01b и M03.

## Обхват (In scope)

1. **Посоката.** Посоката от `docs/design/direction.md` (или смесицата, която собственикът е описал там) се превежда в токени, типография, компоненти и движение. Всяко съзнателно отклонение от прототипа (заради контраст, производителност или webview) се записва с причина в `docs/adr/0006-design-system.md`.
2. **Токени.** `src/design/tokens.ts` е единственият източник: семантичните роли от план §5.2 за тъмна и светла тема, плюс радиуси, разстояния, типографска скала, сенки и движение (продължителности и криви) на посоката. `pnpm tokens:build` генерира `src/design/generated/tokens.css` (за `@theme` на Tailwind 4.3.3, в oklch с hex стойност в коментар) и `src/design/generated/tokens.json` (за бъдещото мобилно приложение, план §6.8). CI проверява, че генерираните файлове са актуални. `src/design/contrast.test.ts` проверява всички двойки от план §5.2 за двете теми, включително плътните тонове за приглушаване от план §4.7.
3. **Теми.** Тъмна и светла. По подразбиране темата следва `prefers-color-scheme`, а ръчният избор се пази в бисквитка, така че сървърът рендерира правилната тема без премигване. `color-scheme` и `<meta name="theme-color">` са зададени за двете теми.
4. **Шрифтове.** По посоката, самостоятелно хостнати през `next/font/local` от пакети `@fontsource-variable/*` (OFL), с подмножества `latin` и `latin-ext`. Кирилското подмножество се зарежда само при нужда, а китайските имена ползват системните CJK шрифтове от план §5.3. Резултатът се записва в ADR.
5. **Компоненти.** `pnpm dlx shadcn@4.21.5 init -b base` и базовият набор, оформен по посоката: Button, Input, Dialog, Drawer (долен панел), Menu, Tabs, Toast, Skeleton и значка за статус (икона и текст). В `CLAUDE.md` е правилото `render` вместо `asChild`. Страницата `/styleguide` (`noindex`) показва токените и компонентите в двете теми.
6. **Обвивка на приложението.** Заглавна лента и навигация, удобни на телефон (по посоката: долна навигация или меню), с изискванията от план §5.8 (б): `viewport-fit=cover` и `env(safe-area-inset-*)`, `dvh` вместо `100vh`, цели за докосване поне 44×44 px, нищо само при посочване. Началната страница е първата версия по посоката; окончателната е в M13.
7. **Бюджети и автоматични проверки.** `scripts/check-bundle-budget.mjs` (JavaScript на маршрут) и Lighthouse CI в мобилен профил за `/`, с праговете от план §5.8 (в). `e2e/routes.ts` със списъка на страниците и `e2e/a11y.spec.ts`, който пуска axe на всяка от тях в двете теми. Визуална регресия (`@visual`) за `/` и `/styleguide` при 390×844 и 1440×900 в двете теми.
8. **Лицензи.** Страница `/legal/licenses` и `THIRD_PARTY_NOTICES.md`, генериран в CI от `pnpm licenses list --json` и от файловете в `licenses/addenda/`. Бележката за EPL-2.0 на elkjs се добавя в M03 като `licenses/addenda/elkjs.md`, а атрибуциите на GeoNames и OpenStreetMap в M11 (план §4.14).
9. **Ръководства.** `docs/guides/user-guide.bg.md` и `docs/guides/admin-guide.bg.md` на български, със структура по областите на продукта. В първата версия: какво е WingChunRoots, как се отваря сайтът локално, темите и началната страница; за администратора: пускане локално на Windows с Docker Desktop и WSL2, спиране и обновяване. `README.md` получава връзка към тях. Следващите етапи ги допълват. Ако M01b вече е слят, администраторското ръководство описва и worker-а и пощата по списъка „Последваща работа“ в раздела „Извън обхват“ на [`M01b-jobs-mail.md`](M01b-jobs-mail.md) (`scripts/verify.d/M01b.sh` го проверява).
10. **Снимки.** `@screenshots` записва `docs/screenshots/M00b/<екран>-<390x844|1440x900>-<dark|light>.png` за `/` и `/styleguide`.

## Извън обхват (Out of scope)

Екрани освен началната страница, `/styleguide` и `/legal/licenses`. База данни. Превод на интерфейса (не се планира, план §5).

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: без `next/font/google` и без заявки към Google по време на build или в браузъра; контрастът не се сваля под праговете, за да се следва прототипът: стойността се коригира и отклонението се записва.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M00b` завършва с `VERIFY M00b: PASS`.
2. Съществуват `src/app/globals.css`, `src/design/tokens.ts`, `src/design/generated/tokens.css`, `src/design/generated/tokens.json`, `src/design/contrast.test.ts`, `components.json`, `src/components/ui/`, `src/app/styleguide/`, `scripts/check-bundle-budget.mjs`, `e2e/routes.ts`, `e2e/a11y.spec.ts`, `THIRD_PARTY_NOTICES.md`, `licenses/addenda/`, `docs/guides/user-guide.bg.md`, `docs/guides/admin-guide.bg.md`, `docs/adr/0006-design-system.md`, `docs/screenshots/M00b/`, `scripts/verify.d/M00b.sh`.
3. Тестове:
   - `src/design/contrast.test.ts`: всички двойки от план §5.2 за двете теми отговарят на праговете (4,5:1 за текст, 3:1 за граници и графични елементи);
   - `src/design/tokens.build.test.ts`: генерираните CSS и JSON съвпадат с `tokens.ts`;
   - `e2e/smoke.spec.ts › @M00b home page renders in both themes with no axe violations`;
   - `e2e/smoke.spec.ts › @M00b the theme follows prefers-color-scheme, the manual choice persists across reloads and the server renders it without a flash`;
   - `e2e/smoke.spec.ts › @M00b at 390x844 the app shell respects safe-area insets and has no horizontal scroll`;
   - `e2e/smoke.spec.ts › @M00b every interactive element on / and /styleguide is at least 44x44 px on mobile`;
   - `e2e/smoke.spec.ts › @M00b fonts are self-hosted (no requests to fonts.googleapis.com or fonts.gstatic.com)`;
   - `e2e/smoke.spec.ts › @M00b /legal/licenses lists the third-party licenses`;
   - в CI: визуалната регресия за `/` и `/styleguide`, Lighthouse CI за `/` в бюджета и бюджетът на JavaScript.
4. PR (описанието е на английски, с връзки към снимките), зелен CI, чист `git status`.

## Кога да спре и да попита (Stop and ask)

Общите условия, а освен това:

- `docs/design/direction.md` липсва в `origin/main` или не записва избор на собственика. Тогава въпросът се записва и целта завършва с `BLOCKED M00b: no design direction chosen`;
- посоката изисква нещо, което противоречи на достъпността (например информация само с цвят) и не може да се поправи с малка корекция.

Компонент, който съществува само в Radix, се добавя с `-b radix` и се записва в PR. Това не е причина за спиране.

## Ред за /goal

```text
/goal Implement milestone M00b exactly as written in docs/plan/M00b-design-system.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code, including docs/design/direction.md and the prototype file it names. First run `git fetch origin`. If branch m00b-design-system exists on origin, check it out and continue from its Progress log and any answered question in docs/plan/questions/M00b.md; otherwise branch from origin/main. If a milestone listed under Dependencies is not merged into origin/main, print `BLOCKED M00b: dependency <milestone> not merged`. If docs/design/direction.md is missing on origin/main or does not record the owner's chosen direction, write the question in English to docs/plan/questions/M00b.md, commit, push and print `BLOCKED M00b: no design direction chosen`. Begin every turn with the line `M00b turn <n>/40`. Success: the goal is met when this conversation shows all of: (1) the step summary printed by `scripts/verify.sh M00b`, ending with the line `VERIFY M00b: PASS`; (2) the work committed and pushed on branch m00b-design-system with a PR to main whose description is in English and includes that step summary and links to the committed screenshots in docs/screenshots/M00b/; (3) the PR's CI checks all passed, including mobile WebKit, visual regression and the performance budgets (show the GitHub tool output or `gh pr checks`); (4) `git status` showing a clean tree. Respect the Out of scope, Constraints and Stop and ask sections. Implement the chosen direction faithfully for dark and light themes and record every deliberate deviation with its reason. Create the Bulgarian guides docs/guides/user-guide.bg.md and docs/guides/admin-guide.bg.md. Commit and push after every green checkpoint and add one line per checkpoint to the Progress log. Run /code-review on the diff before the final verify and fix only correctness or requirement gaps. Never delete, skip or weaken a test or check to get a pass. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M00b.md, commit and push. The goal also ends, not as success, when you print a `BLOCKED M00b: <one-line reason>` line (after recording any question as above) or `STOPPED M00b: turn limit` followed by a progress summary after 40 turns.
```

## Дневник на напредъка (Progress log)

- 2026-10-17 07:58 — **Отклонение от „Кога да спре и да попита“:** `docs/design/direction.md` липсва в `origin/main`, а изборът на собственика не е записан. По указание етапът не спира с `BLOCKED M00b: no design direction chosen`, а ползва препоръчаната посока по подразбиране „Ink Register“ (Ink Lineage върху модела на Living Archive, с панела 96 px и крайната спирка от Transit Map и легендата и чипа „Back to <name>“ от Constellation). PR не се слива преди собственикът да потвърди избора; въпросите са в [`questions/M00b.md`](questions/M00b.md)
- 2026-10-17 07:58 — токени в `src/design/tokens.ts` с генератор (`pnpm tokens:build` → CSS и JSON) и тестове за контраста и генерирането; шрифтове през `next/font/local` от `@fontsource` (Gloock, Schibsted Grotesk, Noto Serif Display само за кирилица) с размерно съгласувани резервни шрифтове; тема от бисквитка чрез вграден скрипт; обвивка с долни раздели и странична лента; lint, typecheck и unit тестовете са зелени (069ac8c)
- 2026-10-17 08:13 — компоненти на Base UI (Button, Input, Dialog, Drawer с надникване 96 px, Menu, Tabs, Toast, Skeleton, StatusBadge, TrailChip), печати и щрихи на състоянията, легенда, `/styleguide`, началната страница с демо линия, `/legal/licenses`, `pnpm notices` и `THIRD_PARTY_NOTICES.md` (603cf44)
- 2026-10-17 08:20 — сливане на `origin/main` (M01b) с merge commit, `pnpm install`, регенерирани бележки за лицензите (3ad20ae, 0896bd4)
- 2026-10-17 08:45 — E2E: шестте теста `@M00b`, `e2e/routes.ts`, `e2e/a11y.spec.ts` (axe в двете теми), `@visual` само в CI, `@screenshots`; `scripts/check-bundle-budget.mjs` (`/` 159,7 kB от 170 kB), Lighthouse CI с приложено забавяне (LCP около 1,8 s, CLS 0), `scripts/verify.d/M00b.sh`; 30 E2E теста са зелени в Chromium (0c5ebaa)
- 2026-10-17 08:50 — снимките в `docs/screenshots/M00b/` (cd0047e); първи CI: всичко минава освен липсващите базови снимки (очаквано) и теста за 44 px в мобилния WebKit
- 2026-10-17 09:02 — CI записва снимките без базова снимка (`updateSnapshots: 'default'`) и печата отчетите за грешките; тестът за 44 px чака менюто да спре да се анимира; `docs/design/direction.md` и прототипите (6ced014, 5f425d7)
- 2026-10-17 09:30 — ADR 0006, ръководствата за потребителя и администратора, `README.md`, ADR 0001, въпросите към собственика, редът в `docs/plan/README.md` (cbc7db9)
- 2026-10-17 09:35 — втори CI: минават 51 теста, включително мобилният WebKit; падат само 8-те визуални теста без базова снимка (очаквано)
- 2026-10-17 09:45 — втори кръг на дизайна (`docs/design/reviews/M00b.md`): потвърденият щрих е в мастило навсякъде (`strokeColor`), 4 px между името и метареда (dfee5fa); `/code-review`: поправени са печатът, чекмеджето, текущият раздел, времето на проследяването, `lang` на имената, 44 px на връзките в лицензите, `scroll-padding-top` и шрифтовете за zh-Hans (a484526); lint, typecheck, 342 unit теста, бюджетът и 30 E2E теста са зелени; нови снимки (e9f1279)
- 2026-10-17 09:50 — трети CI (e9f1279): минават 51 теста, включително мобилният WebKit; 8-те визуални снимки от лога са приети като базови за Linux (`scripts/visual-baselines.sh accept`, проверени размер и SHA-256, прегледани); маркери `DEFAULT D20` и `DEFAULT D24` (789a01c, c62ab3b)
- 2026-10-17 09:55 — четвърти CI (c62ab3b): всички 59 E2E теста минават, включително визуалната регресия и мобилният WebKit; `checks:M00` пада, защото коментар в `src/design/fonts.ts` споменава забранения импорт. Коментарът е преформулиран, проверката е непроменена; местно `scripts/verify.sh M00b` и `M01` минават, всички `scripts/verify.d/*.sh` минават (8c04702)
- 2026-10-17 10:05 — пети CI (8c04702): `VERIFY all: PASS` (lint, типове, unit, интеграционни тестове, целият E2E с мобилния WebKit и `@visual`, Lighthouse, бюджетите и всички `scripts/verify.d/*.sh`); местно `VERIFY M00b: PASS`, `VERIFY M00: PASS`, `VERIFY M01: PASS`; описанието на PR #8 е допълнено. PR остава чернова, докато собственикът не потвърди посоката
- 2026-10-17 11:40 — първи кръг на прегледа (четири гледни точки, 5 високи, 28 средни и 29 ниски бележки): `lighthouse` 13.4.1 и `chrome-launcher` 1.2.1 вместо `@lhci/cli` (осем известни уязвимости в дървото за разработка), бележките за лицензите с `tailwindcss` и `sharp`/`libvips` и с всеки текст веднъж, нови граници в ESLint (34289d0); типографска скала и пространство в токените, натиснати тонове, печатът „Verified“ като издълбан печат, приглушени печати, скриването на „Skip to content“ над безопасната зона, `NavLinks` в `Suspense`, долен и страничен панел, диалог и toast по посоката (0fe1572); линията на началната страница веднага под заглавието на телефон, „чернова с молив“ и изписване с мастило, преработената рисунка на залата, „Trace this hall’s line“, `e2e/ui.spec.ts` с 12 нови проверки (92ce049)
- 2026-10-17 12:01 — затъмнението на модалния панел е плътно на всяка точка на спиране (Base UI отчита `--drawer-swipe-progress` 1 на половин височина) и тестът проверява непрозрачността му; образците на шрифтовете в `/styleguide` показват всички 15 стъпки (липсващ клас спира сборката); ADR 0006, ADR 0001, ръководствата, `direction.md`, `README.md` и въпрос 3 към собственика (бюджетите и темата без JavaScript)
- 2026-10-17 12:20 — CI на 4bd11a9 (run 39031266430): падат само 8-те визуални теста (очаквано: `/` и `/styleguide` са променени нарочно) и в мобилния WebKit заглавието на панела при 150 % текст: Gloock е 1,2 em висок, а `line-clamp` реже по редовете от 1,15 em, затова заглавието е с `leading-tight` (36e33cc). Новите 8 базови снимки са приети от лога (`scripts/visual-baselines.sh accept`, проверени размер и SHA-256, прегледани)
- 2026-10-17 12:35 — CI на 735d887 (run 39031949241) е зелен: `VERIFY all: PASS` (Node 24, PostgreSQL 18, Chromium и мобилен WebKit, визуалните тестове с новите базови снимки), lint, typecheck и unit на Node 22, gitleaks и pnpm audit. Локално `scripts/verify.sh M00b` на 735d887: `VERIFY M00b: PASS` (87 проверки, 383 unit, 71 интеграционни, 54 e2e; JavaScript: / 161,5 kB, /styleguide 240,5 kB; Lighthouse: медиана LCP 1800 ms, CLS 0)
- 2026-10-17 12:55 — CI на 61d7300 (run 39032950027, само ред в дневника) падна в `mobile-chromium` на теста за safe-area: `boundingBox()` на раздел върна null. Причина: предварително генерираната страница изпраща първо резервния списък на разделите (Suspense), а React го заменя с изпратения по-късно списък кадър или повече след `load` (локално в 4 от 20 зареждания); тестът намира раздела с едно извикване и го мери с друго. Тестът за safe-area и тестът за 150 % текст мерят четирите видими раздела с една стъпка в страницата; проверките са същите. Двата теста минават 24 от 24 пъти; `scripts/verify.sh M00b`: `VERIFY M00b: PASS`
