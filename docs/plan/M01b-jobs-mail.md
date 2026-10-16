# M01b — Фонови задачи и поща

`docs/plan/M01b-jobs-mail.md` · клон `m01b-jobs-mail` · таван 30 хода · без решения от регистъра

## Цел (Objective)

pg-boss работи като outbox в същата база, worker-ът е отделен процес, а имейлите минават през интерфейса `Mailer` към Mailpit (локално и в CI) или към файл (облачна сесия). Шаблоните на писмата и текстовете на известията са на английски в един модул. E2E тестовете могат да четат пощата.

## Прочети първо (Read first)

`docs/WingChunRoots_Technical_Plan.bg.md`: §3.1 (редове „Фонови задачи“, „Имейл“ и „Текст на интерфейса“), §6.1, §6.2 (ролите и pg-boss), §7.5.

## Зависимости (Dependencies)

M01. Върви паралелно с M00b и M03.

## Обхват (In scope)

1. **pg-boss 12.38 с `migrate: false`.** Миграционна стъпка с ролята `migrator` създава и обновява схемата `pgboss` чрез плановете за създаване и миграция на pg-boss (`getConstructionPlans`, `getMigrationPlans`). `app_rw` получава `USAGE` върху схемата и права за четене и запис в таблиците ѝ, без `CREATE` върху базата (план §6.2).
2. **Worker.** `src/worker.ts` (команди `pnpm worker` и `pnpm worker:dev`) и `src/server/jobs/` с помощна функция, която създава задача в транзакцията на промяната (outbox).
3. **Поща.**
   - Интерфейс `Mailer`: `send({ template, to, data, idempotencyKey })`, с транспорти SMTP (Mailpit) и файл (облачни сесии). Доставчик на реални писма няма във Фаза 1 (план §3.3).
   - Записи в `email_delivery`; идемпотентност по ключ; повторни опити с таван. След последния неуспешен опит доставката е `failed`.
   - Шаблони с React Email в `src/server/templates/email/` и текстове на известията в таблото в `src/server/templates/notifications.ts`, на английски. Това е единственото място с текст на писма и известия. Имената в писмата се показват с атрибут `lang`.
4. **Помощни средства за тестовете.** `e2e/helpers/mailbox.ts` чете Mailpit API или файловия транспорт. `playwright.config.ts` пуска в `webServer` и `pnpm worker`, а изходът на сървъра отива в `test-results/server.log`.
5. **Документация:** `docs/adr/0003-jobs-and-mail.md`.

## Извън обхват (Out of scope)

Имейлите за вход и регистрация (M02). Известията в таблото (M08). Доставчик на реални писма (отложен с хостинга, план §3.3).

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: worker-ът се свързва само като `app_rw`.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M01b` завършва с `VERIFY M01b: PASS`.
2. Интеграционни тестове:
   - `outbox.int.test.ts`: един ключ за идемпотентност дава точно един ред в `email_delivery`; неуспешно изпращане се опитва отново; след последния опит доставката е `failed`; задача от транзакция, която е върната назад, не се изпраща;
   - `pgboss.int.test.ts`: worker-ът стартира като `app_rw`, без право `CREATE` върху базата;
   - `mailbox.int.test.ts`: писмо, изпратено през worker-а, се чете от `e2e/helpers/mailbox.ts`.
3. Единичен тест `templates.test.ts`: всеки шаблон се рендерира с примерни данни в HTML и в текстова версия, има тема (subject) и не оставя незаместени променливи.
4. Съществуват `src/worker.ts`, `src/server/jobs/`, `src/server/mail/`, `src/server/templates/`, `e2e/helpers/mailbox.ts`, `docs/adr/0003-jobs-and-mail.md`.
5. PR, зелен CI, чист `git status`.

## Кога да спре и да попита (Stop and ask)

Общите условия, а освен това: ако pg-boss не може да стартира без `CREATE` върху базата дори с `migrate: false`. Тогава се записва точната грешка.

## Ред за /goal

```text
/goal Implement milestone M01b exactly as written in docs/plan/M01b-jobs-mail.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. First run `git fetch origin`. If branch m01b-jobs-mail exists on origin, check it out and continue from its Progress log and any answered question in docs/plan/questions/M01b.md; otherwise branch from origin/main. If a milestone listed under Dependencies is not merged into origin/main, print `BLOCKED M01b: dependency <milestone> not merged`. Begin every turn with the line `M01b turn <n>/30`. Success: the goal is met when this conversation shows all of: (1) the step summary printed by `scripts/verify.sh M01b`, ending with the line `VERIFY M01b: PASS`; (2) the work committed and pushed on branch m01b-jobs-mail with a PR to main whose description is in English and includes that step summary; (3) the PR's CI checks all passed (show the GitHub tool output or `gh pr checks`); (4) `git status` showing a clean tree. Respect the Out of scope, Constraints and Stop and ask sections. Email and notification text is English and lives only in src/server/templates/; there is no translation library. Commit and push after every green checkpoint and add one line per checkpoint to the Progress log. Run /code-review on the diff before the final verify and fix only correctness or requirement gaps. Never delete, skip or weaken a test or check to get a pass. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M01b.md, commit and push. The goal also ends, not as success, when you print a `BLOCKED M01b: <one-line reason>` line (after recording any question as above) or `STOPPED M01b: turn limit` followed by a progress summary after 30 turns.
```

## Последваща работа (Follow-up)

`docs/guides/` още не съществува: ръководствата се създават в M00b. M01b добавя поведение за администратора, което `docs/guides/admin-guide.bg.md` трябва да опише, когато и двата етапа са в `main` (етапът, който се слее втори, го дописва):

- worker-ът е отделен процес: `pnpm worker` (и `pnpm worker:dev`), свързва се само като `app_rw`, спира плавно при `SIGTERM`;
- пощата: `MAIL_TRANSPORT=smtp` към Mailpit (`docker compose up -d --wait mailpit`, http://localhost:8025) или `file` (писмата са в `.mail/`); във Фаза 1 `SMTP_URL` сочи само към местния Mailpit;
- `pnpm mail:check <адрес>` за пробно писмо;
- ежедневната задача `retention.purge` (03:17 UTC): адресите в `email_delivery` се изтриват след 90 дни, а в поканите 30 дни след края им.

`scripts/verify.d/M01b.sh` проверява това, щом `docs/guides/admin-guide.bg.md` съществува.

## Дневник на напредъка (Progress log)

- 2026-10-16 22:25 — pg-boss 12.38.0 (схема `pgboss` от миграционна стъпка като `migrator`, `migrate: false`), `Mailer` с транспорти SMTP (Mailpit) и файл, шаблон `mail-check` с React Email и `notifications.ts`, outbox (`queueEmail` в транзакцията на Drizzle), worker като `app_rw`, задача за срока на пазене на адресите, `e2e/helpers/mailbox.ts`; lint, typecheck, unit (82) и интеграционни тестове (64) са зелени на PostgreSQL 16.15, `mailbox.int.test.ts` минава и с файловия транспорт, и през SMTP към Mailpit 1.31.6; `db:check` минава (339b64c)
- 2026-10-16 22:35 — `playwright.config.ts` пуска и `pnpm worker`, `e2e/mail.spec.ts` (@M01b) чете пощата и с файловия транспорт, и през Mailpit; `scripts/verify.sh` пуска E2E срещу тестовата база; Mailpit в CI; променливите за пощата в `.env.example`, `init-env.sh` и `cloud-setup.sh` (9f5251e)
- 2026-10-16 22:50 — `scripts/verify.d/M01b.sh`, ESLint граници за `nodemailer`, `pg-boss` и `react-email`, ADR 0003, `docs/data-model.md`, `README.md`; проверките на M00, M01 и M01b минават (0f4c050)
- 2026-10-16 23:15 — поправки от /code-review: производителят създава липсващите опашки, неуспешен старт спира инстанцията, стъпката за pg-boss изгражда отново прекъснати индекси, `mail:check` без `--name`, `.env` преди проверката за production, грешките на базата в лога само със SQLSTATE, реалният прозорец на повторните опити (31–60 min); unit (85) и интеграционни тестове (66) са зелени
- 2026-10-16 23:35 — `scripts/verify.sh M01b` и `scripts/verify.sh all` завършват с PASS; PR [#7](https://github.com/VladimirKadanov/WingChunRoots/pull/7) към `main` (след #5 и #6)
