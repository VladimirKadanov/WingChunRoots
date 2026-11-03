# M16 — Галерии

`docs/plan/M16-galleries.md` · клон `m16-galleries` · решения на собственика от 03.11.2026 · D07, D13, D20

## Цел (Objective)

Всеки акаунт има галерия на собствения си профил: добавя, маха и подрежда снимки, дава на всяка подпис по избор, а снимката на профила е една от тях. Броят е по плана (`photos`, DEFAULT D07) и се прилага на сървъра; подканата за по-висок план се показва само на истинската граница. Доказателствата за проверка остават в частното хранилище и никога не се броят срещу галерията (D13, решение на собственика). Школата има отделна галерия: едно лого и снимки на залите с отделна граница, на публичната си страница, без точното място на школата в нито един файл. Снимката в картата на изследователя е квадрат с височината на картата на предния ѝ ръб, а картата става толкова по-широка.

## Прочети първо (Read first)

`CLAUDE.md` (§5, §6, §10, §11, §15); `docs/WingChunRoots_Technical_Plan.bg.md`: §3.2, §5.6, §5.8, §6.1, §6.4, §6.8, §10.1 (D07, D13, D20); `docs/adr/0016-profile-photos.md`, `docs/adr/0007-entitlements.md`, `docs/adr/0008-person-pages-404.md`, `docs/adr/0014-schools-map.md`, `docs/adr/0005-graph-layout.md`, `docs/adr/0017-stacked-students.md`; `docs/design/direction.md`.

## Зависимости (Dependencies)

M15 (и всички етапи преди него), слят в `main` (6373491).

## Обхват (In scope)

1. **Модел на данни.** `person_photo` получава `caption`, `position`, `full_width`/`full_height` и статуса `gallery` (снимката на профила остава единствената `active`); нова таблица `school_photo` (лого и зали, история, кой и защо е махнал, едно активно лого); една миграция за PostgreSQL 16+; `app_public_ro` няма права върху `school_photo`.
2. **Обработка.** Освен квадратите 96 и 512 px — цялата снимка `full.webp` (до 1280 px, никога уголемена); логото цяло в прозрачен квадрат; всяка версия без EXIF, GPS, XMP и IPTC.
3. **Право по план.** `photos` е `availability: 'now'` и `enforced`; всяка снимка на галерията се брои, и тази на профила (DEFAULT D07: 1/10/2/100/без граница); доказателствата никога (D13); по-висока граница само от грант на администратор; подканата само на границата и само с ползи, които съществуват сега.
4. **Галерия на школата.** Едно лого и до 12 снимки на залите (DEFAULT D07 (M16), въпрос в `questions/M16.md`); качва и маха акаунтът, който е обявил школата (M11); на публичната страница на школата; нищо не се брои срещу `photos` на човека.
5. **API.** `gallery.mine`, `gallery.get`, `gallery.add`, `gallery.remove`, `gallery.update`, `gallery.reorder`, `gallery.setProfile`; `schoolPhotos.get`, `schoolPhotos.upload`, `schoolPhotos.remove`, `schoolPhotos.update`, `schoolPhotos.reorder` на `/api/rpc` и `/api/v1`, регенериран `docs/api/openapi.json`; `GET /api/school-photos/<id>/<хеш>/<размер>.webp`; Server Actions на модерацията (`removeGalleryPhotoAction`, `removeSchoolPhotoAction`) в таблицата на съответствието.
6. **Интерфейс (само английски, Ink Register).** Раздел **Photos** в профила (мрежа и разглеждане); `/dashboard/photos` (добавяне, подпис, подреждане с „Move up“/„Move down“, „Use as profile photo“, махане, подканата на границата); логото в заглавието на школата и раздел **Photos** на страницата ѝ; `/dashboard/schools/<id>/photos`; разглеждане в диалог в страницата: клавиатура (Enter, стрелките само вътре, Esc), докосване (бутони 44 px, плъзгане), нищо само при посочване, без нови прозорци; `alt` от подписа или от името.
7. **Модерация.** Персоналът с втори фактор маха снимка на галерия или на школа с причина (одит), от картата на случая.
8. **Картата.** Квадратната снимка (или монограмът) 64×64 на предния ръб на пълната карта; пълната карта е 264×64 (`NODE_SIZES.full`), скелетът — също; ELK, блоковете (ADR 0017) и разстоянията остават.
9. **Демо данни (D20).** Две снимки на галерията на `demo-two-lineages`; лого и две зали на `demo-school-sofia`, една зала на `demo-school-city-only`; всичко генерирано.
10. **Тестове.** Unit (обработката без метаданни, логото, решенията на плановете); интеграционни (`gallery.int.test.ts`, `school-photos.int.test.ts`, редовете в матрицата за оторизация); E2E `@M16` (desktop-chromium и mobile-chromium, axe в двете теми, маршрутите).
11. **Документи и проверка.** ADR 0019, `scripts/verify.d/M16.sh`, двете ръководства, `docs/data-model.md`, `docs/entitlements.md`, `docs/plan/questions/M16.md`.

## Извън обхват (Out of scope)

Видео, изрязване от потребителя, CDN и хостинг (план §3.3), плащания, галерии на линии и организации, лимит на залите по план.

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: само фиктивни генерирани изображения в демо данните и тестовете; никога точните координати на школа, ключ на файл или подпис в лог или публичен отговор; визуалните еталони се сменят (по-широките карти, галериите) и се приемат само от CI, визуалните тестове не се пипат.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M16` завършва с `VERIFY M16: PASS`.
2. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int` и `pnpm build` (с бюджетите) минават.
3. E2E `@M16` (`e2e/m16-galleries.spec.ts`, в изключителното пускане) минава: разглеждане с клавиатура и бутони, собствена галерия до границата с подканата, лого и зала на школа без GPS в изпратените байтове; axe в двете теми.
4. `@M05`, `@M06`, `@M07` и `@M14` минават.
5. Съществуват ADR 0019, обновените ръководства и `docs/data-model.md`; редът на M16 в `docs/plan/README.md`; въпросите в `docs/plan/questions/M16.md`.

## Кога да спре и да попита (Stop and ask)

Общите условия. Особено ако снимка трябва да се показва на скрит човек пред други, ако бюджет на JavaScript трябва да се вдигне, ако е нужна нова зависимост за изображения или ако две колони на телефон с 390 px трябва да се запазят на цената на отслабен тест (тогава въпрос с решение по подразбиране).

## Ред за /goal

```text
/goal Implement milestone M16 exactly as written in docs/plan/M16-galleries.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. Work on branch m16-galleries from origin/main. Success: `scripts/verify.sh M16` ends with `VERIFY M16: PASS`, the work is committed and pushed on the branch, and `git status` is clean. Never delete, skip or weaken a test or check. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M16.md, commit and push, and print `BLOCKED M16: <reason>`.
```

## Дневник на напредъка (Progress log)

- 2026-11-03 09:05 — модел на данни (`person_photo` с подпис, ред, цяла снимка и статус `gallery`; таблица `school_photo`; миграция `20261103085033_m16_galleries`) (96a18d5)
- 2026-11-03 09:10 — услугите `gallery` и `school-photos`, процедурите, адресът `/api/school-photos/…`, цялата снимка, логото, демо данни (caf7832)
- 2026-11-03 09:12 — `photos` е `now` и се прилага (D07), матрица `2026-11-03.1` (2e9dbcb)
- 2026-11-03 09:15 — екраните: **Photos** в профила с разглеждане, `/dashboard/photos`, лого и зали на школата, модерация от картата на случая (c9188e4)
- 2026-11-03 09:30 — квадратната снимка на предния ръб на картата, пълна карта 264×64; `questions/M16.md` (c37999b)
- 2026-11-03 09:55 — интеграционни тестове и редовете в матрицата за оторизация (59926f5); OpenAPI и E2E `@M16`
- 2026-11-03 10:40 — `scripts/verify.d/M16.sh`, ADR 0019, ръководствата, `docs/data-model.md`; E2E на разглеждането на компютър и телефон (`e2e/m16-gallery-viewer.spec.ts`), скелетът с ширината на пълната карта (572a7cc, 17ccd51, aa6ce1c)
- 2026-11-03 11:10 — най-малкият мащаб следва ширината на картата (**Fit the whole view** на 390 px показва всички) (bfb1348); поправки от `/code-review`: цялата снимка се събира в 1 MB, отказано подреждане връща записания ред, без грешка в лога за галерия, която зрителят не вижда, квадратът в картата с 512 px на плътни екрани (1db620d)
- 2026-11-03 12:30 — каталогът на плановете показва `photos` като налично сега (674d988); `scripts/verify.sh M16`: `VERIFY M16: PASS`
