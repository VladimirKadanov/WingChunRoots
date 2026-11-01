# M10a — Доказателства, исторически учители и опашка за преглед

`docs/plan/M10a-evidence-review.md` · клон `m10a-evidence-review` · таван 50 хода · D03, D13, D25

## Цел (Objective)

Ученикът може да заяви исторически учител с поверителни доказателства. Проверяващите решават през опашка за преглед, а архивистът може да редактира архивни записи с причина. Доказателствата никога не стигат до неупълномощен потребител.

## Прочети първо (Read first)

`docs/WingChunRoots_Technical_Plan.bg.md`: §5.6, §5.8, §6.1 (бележката за `proxy.ts`), §6.2, §6.4, §6.6, §6.7, §6.8; `docs/design/direction.md`.

## Зависимости (Dependencies)

M09.

## Обхват (In scope)

1. **Исторически или починал учител.** `verification_path = committee_review` → `under_review` и `review_case` от вид `historical_claim`. Доказателствата са задължителни. Новият запис за учителя е с `visibility = 'involved_only'` (план §6.4).
2. **Качване на доказателства** (`/api/evidence/upload`, извън matcher-а на `proxy.ts`, план §6.1):
   - по един файл на заявка; отказ при `Content-Length` над 20 MB, преди тялото да се чете; до 20 файла на случай (D25 по подразбиране);
   - позволени са само JPEG, PNG, WebP и PDF, проверени по „магически байтове“;
   - изображенията се прекодират със sharp, което премахва EXIF и GPS;
   - `sha256` е хешът на съхранения обект, а `original_sha256` е хешът на качения оригинал, когато изображението е прекодирано;
   - случаен ключ за съхранение;
   - полето е обикновен `<input type="file">` с `accept="image/jpeg,image/png,image/webp,application/pdf"`, който работи и в мобилен webview; влаченето на файл е само допълнение (план §5.8).

   `ObjectStore` (интерфейсът за съхранение) има драйвер S3, ползван със SeaweedFS локално и в CI, и драйвер за файловата система (облачни сесии). Двата минават един и същ тест на договора. Облачно хранилище се добавя заедно с хостинга (план §3.3), без промяна в услугите. `scan_status` започва като `pending`. Антивирусната проверка е по желание и по-късно.
3. **Изтегляне** (`/api/evidence/[id]`). Файлът минава поточно през приложението след проверка на правата, с `Content-Disposition: attachment`, `Cache-Control: no-store` и `X-Content-Type-Options: nosniff`. Разрешено е на качилия, на засегнатия учител (за собствената му заявка), на назначените проверяващи и на администраторите. Всяко изтегляне е одит `evidence.view`. За всички останали отговорът е 404.
4. **Опашка `/admin/review`** (TanStack Table):
   - филтри по вид и статус;
   - карта на случая с доказателствата и вътрешни бележки;
   - действия: потвърждаване, отказ с причина, `needs_info`, възлагане.

   Всяко решение е oRPC процедура (`review.decide`, `review.assign`), записва `relationship_event` и одит. Достъпът е за архивист, модератор и администратор, със сесия с проверен втори фактор. Влязъл потребител без роля на персонала вижда изричното състояние за отказан достъп (план §5.6).
5. **Архивна редакция** (план §6.6). Само архивист редактира записи със `stewardship` `platform` или `unclaimed`, от `/admin/review`. Причината е задължителна, а връзките към доказателства са по желание. Одитът `person.update` пази `reason` и `evidence_ids`.
6. **Документация:** `docs/evidence-and-review.md` на български, с решенията по подразбиране за D13 и D25 и бележка за `proxyClientMaxBodySize`.
7. **Ръководства:** `docs/guides/user-guide.bg.md` описва заявката за исторически учител и качването на доказателства; `docs/guides/admin-guide.bg.md` описва опашката за преглед, решенията и архивната редакция.

## Извън обхват (Out of scope)

Покани, поемане на профил, проверка на инструктор, сигнали и арбитраж (M10b). Автоматична модерация на изображения. Обжалване. Публична галерия.

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: presigned GET адреси за доказателства не се дават.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M10a` завършва с `VERIFY M10a: PASS`.
2. E2E тестове в `e2e/m10a-evidence.spec.ts`:
   - `@M10a a student claims a fictional historical teacher with a PDF; an archivist verifies it in /admin/review; the edge becomes public`
   - `@M10a a historical teacher record created by a student is absent from anonymous HTML, API, search and sitemap until verified`
   - `@M10a evidence download: the uploader is allowed; an unrelated user and an anonymous visitor get 404; every download writes evidence.view`
   - `@M10a a 15 MB PDF is stored intact: the stored object's SHA-256 equals the client-side SHA-256`
   - `@M10a upload refuses a renamed executable and a file over 20 MB`
   - `@M10a at 390x844 evidence is attached through the plain file input without drag and drop`
   - `@M10a a signed-in non-staff user on /admin/review sees the explicit denied state`
   - `@M10a an archival edit of demo-root-c requires a reason and records actor, role and linked evidence in audit_log; a moderator without the archivist role cannot edit`
   - `@M10a storage keys and evidence URLs never appear in public HTML or API responses`
3. Интеграционни тестове: EXIF и GPS са премахнати; `sha256` е на съхранения обект, а `original_sha256` е записан за прекодираните изображения; таванът от 20 файла на случай се спазва; `Content-Length` над 20 MB се отказва, преди тялото да се чете; отговорът при изтегляне има трите заглавки от точка 3.
4. Съществуват `src/server/storage/` (двата драйвера и общият тест на договора), `src/app/api/evidence/`, `docs/evidence-and-review.md`, `docs/screenshots/M10a/`. Ръководствата са обновени (`scripts/verify.d/M10a.sh` проверява, че са променени в клона). Изпълнен е `/security-review`. PR, зелен CI, чист `git status`.

## Кога да спре и да попита (Stop and ask)

Общите условия, а освен това: ако е нужна политика за срок на съхранение на доказателствата (GDPR). Междувременно се ползва полето `retention_until`, без автоматично изтриване, и въпросът се записва.

## Ред за /goal

```text
/goal Implement milestone M10a exactly as written in docs/plan/M10a-evidence-review.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. First run `git fetch origin`. If branch m10a-evidence-review exists on origin, check it out and continue from its Progress log and any answered question in docs/plan/questions/M10a.md; otherwise branch from origin/main. If a milestone listed under Dependencies is not merged into origin/main, print `BLOCKED M10a: dependency <milestone> not merged`. Begin every turn with the line `M10a turn <n>/50`. Success: the goal is met when this conversation shows all of: (1) the step summary printed by `scripts/verify.sh M10a`, ending with the line `VERIFY M10a: PASS`; (2) the work committed and pushed on branch m10a-evidence-review with a PR to main whose description is in English and includes that step summary; (3) the PR's CI checks all passed (show the GitHub tool output or `gh pr checks`); (4) `git status` showing a clean tree. Respect the Out of scope, Constraints and Stop and ask sections. Evidence must never reach an unauthorized user. Every mutation is an oRPC procedure; Server Actions only wrap it. Update the Bulgarian user and admin guides in docs/guides/. Commit and push after every green checkpoint and add one line per checkpoint to the Progress log. Before the final verify run /code-review and /security-review on the diff and fix correctness, security or requirement gaps only. Never delete, skip or weaken a test or check to get a pass. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M10a.md, commit and push. The goal also ends, not as success, when you print a `BLOCKED M10a: <one-line reason>` line (after recording any question as above) or `STOPPED M10a: turn limit` followed by a progress summary after 50 turns.
```

## Дневник на напредъка (Progress log)

- 2026-11-01 00:14 — `ObjectStore` с драйвер за файловата система и S3 драйвер (`aws4fetch`) за SeaweedFS, общият тест на договора, sharp за прекодирането (`allowBuilds: false`), `.storage/` извън git (ca20023)
- 2026-11-01 00:14 — схемата и миграцията (`original_name`, видовете в `mime`, един отворен случай на връзка, ключ на бележките), услугата за доказателства, `POST /api/evidence/upload` (411/413 преди тялото, магически байтове, без EXIF и GPS) и `GET /api/evidence/[id]` със заглавките и одита `evidence.view` (debb9f8)
- 2026-11-01 00:15 — искът за исторически учител (`relationships.requestHistorical`, `involved_only`, DEFAULT D03), опашката (`review.*`), архивната редакция (`archive.*`), шаблоните, процедурите в `/api/rpc` и `/api/v1`, списъкът за паритет и договорът OpenAPI (3452cc9); страниците `/dashboard/teachers/historical`, `/admin/review` и `/admin/review/records/[slug]` с тънки Server Actions и полето за файлове (9295ae6)
- 2026-11-01 00:17 — SeaweedFS в CI със същия образ и команда като `docker-compose.yml`, sharp и aws4fetch в ADR 0001, маркерът DEFAULT D13 (c5078aa)
- 2026-11-01 00:24 — интеграционните тестове: `evidence.int.test.ts` (18) и `review.int.test.ts` (11) минават (d078cad)
- 2026-11-01 00:41 — `e2e/m10a-evidence.spec.ts` с деветте заглавия в проекта `exclusive` (`PUBLIC_WRITE_SPECS`), ключовите маршрути и състоянията на екраните; `PW_EXCLUSIVE=1 pnpm e2e --grep @M10a` минава (69bd8ad, 555c39a); лицензите на sharp и aws4fetch (dd7ef1e)
- 2026-11-01 01:00 — ADR 0012, `docs/evidence-and-review.md`, двете ръководства, моделът на данните, статусът в плана и четирите въпроса към собственика (`docs/plan/questions/M10a.md`: срок на съхранение, заявките за изтриване извън опашката, отделният маршрут на иска, качването иска JavaScript); формата за заявка води към иска (4ae845c)
- 2026-11-01 01:05 — `scripts/verify.d/M10a.sh`; проверката на M09 за `PUBLIC_WRITE_SPECS` приема и спецификацията на M10a (dc4ca1e); снимките в `docs/screenshots/M10a/` (7a1bcb1)
- 2026-11-01 01:40 — матрицата роля × маршрут в `guards.int.test.ts` включва `/admin/review` (aa3065c); `TextAreaField` и текстовете за грешка на M10a в отделни модули, за да останат `/dashboard/teachers/new` (169,4 kB) и `/dashboard/students/requests` (169,8 kB) под 170 kB (abb8f7b)
- 2026-11-01 02:30 — самопреглед и `/security-review` без находки; `scripts/verify.sh M10a` → `VERIFY M10a: PASS` (E2E 130 + 9 в проекта `exclusive`); всеки `scripts/verify.d/*.sh` минава сам. Визуалните еталони на новите и променените екрани (`teachers-historical`, `review-queue`, `review-record`, `teachers`, `teachers-new`) се приемат от CI
- 2026-11-01 02:27 — визуалните еталони на новите и променените екрани (`teachers-historical`, `review-queue`, `review-record`, `teachers`, `teachers-new`) от CI (58afd16)
- 2026-11-01 02:30 — четири независими прегледа на клона: 22 потвърдени находки, от тях 11 за екраните (`screens-1` … `screens-11`), останалите за услугите, хранилището и документацията
- 2026-11-01 02:52 — поправки на екраните: полето за файлове пази фокуса и не отваря избора, докато файловете се качват, всеки ред казва **Uploaded** или **Not uploaded:** с причината, а учтив дневник чете всеки файл и обобщение; файл, добавен към отворен иск, минава в списъка на иска; **Assign** без проверяващ се отказва и само **Unassign** маха възлагането; резултатът на всяко действие взема фокуса, а потвърждението за бележка е под бележките; имената на случаите в опашката, стилът на филтрите, страницата на иска при 200 % текст на телефон и E2E тестове за находките (3f287a1…b499b95)
- 2026-11-01 02:59 — поправки в сървъра: `review.assign` заключва връзката преди случая (без deadlock с решение или оттегляне); прозорецът на заявките брои само собствените заявки на акаунта; крайният срок на S3 покрива заглавките, не тялото на GET; файловете и имената им се отварят точно за кръга от In scope 3, а записът свързва само файлове, качени от архивиста; проверяващ, който е страна в случая, не чете вътрешните бележки и не може да го получи; архивната редакция пише `audit_log.evidence_ids`; договорът на S3 чете `.env` като приложението и отчита пропуск вместо минаване; файл, изпратен с един иск, не се изпраща с друг; моделът на данните (556ac01…1a4c6dc)
