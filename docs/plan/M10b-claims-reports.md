# M10b — Покани, поемане на профил, проверка на инструктор, сигнали и арбитраж

`docs/plan/M10b-claims-reports.md` · клон `m10b-claims-reports` · таван 40 хода · D03, D04, D13, D19

## Цел (Objective)

Ученикът може да покани липсващ жив учител. Поканеният поема профила си след преглед и сам одобрява връзката. Самообявен Сифу може да докаже, че е инструктор. Потребителите сигнализират за профили, а модераторът може да постави връзка „в арбитраж“, като уведомява двете страни.

## Прочети първо (Read first)

`docs/WingChunRoots_Technical_Plan.bg.md`: §5.6, §5.8, §6.2, §6.4, §6.5, §6.6, §6.7, §6.8; `docs/design/direction.md`.

## Зависимости (Dependencies)

M10a.

## Обхват (In scope)

1. **Липсващ жив учител.** Създава се непотвърден запис (`stewardship = unclaimed`, `visibility = 'involved_only'`) и връзка в `awaiting_claim` (план §6.7). По желание се изпраща покана по имейл с шаблон от `src/server/templates/` (хеш на токена, срок на валидност): „Invite your teacher to claim this profile“. Етикетът „Unclaimed record“ се вижда само от ученика, поканения и проверяващите.
2. **Поемане на профил** (`/invite/[token]`). Поканеният приема поканата → `person_claim` и `review_case` от вид `person_claim` → архивистът одобрява → попълва се `claimed_by_user_id`, а връзката минава от `awaiting_claim` в `pending_teacher`. После учителят сам одобрява или отказва, както в M09. Дотогава връзката остава `involved_only`.
3. **Проверка на инструктор** (план §6.5). `review_case` от вид `instructor_verification` с доказателства през конвейера от M10a, решава архивист. Докато не е одобрен, човекът се показва като „Instructor (unverified)“, а панелът на одобрените от него връзки казва „Approved by an unverified instructor“ (`DEFAULT D04/D13`). Одит `instructor.verify`. Опорните Сифу в тестовите данни са потвърдени.
4. **Сигнал за профил.** „Report profile“ с причина (copyright, spam, inappropriate, misleading) отваря `review_case` от вид `profile_report`. Един потребител може да подаде само един сигнал за даден профил. Автоматичното скриване е извън обхвата.
5. **Арбитраж (D19).** Модератор или администратор поставя `in_arbitration` с причина. Двете страни получават известие (в таблото и по имейл) с причината и връзка за подаване на доказателства (`needs_info`). Публичните страници показват „Disputed“.
6. **Документация:** `docs/evidence-and-review.md` се допълва с решенията по подразбиране за D04 и D19.
7. **API-first.** Поканата, поемането, проверката на инструктор, сигналът и арбитражът са oRPC процедури, а формите ги викат чрез тънки Server Actions (план §6.8).
8. **Ръководства:** `docs/guides/user-guide.bg.md` описва поканата, поемането на профил, проверката на инструктор и сигнала; `docs/guides/admin-guide.bg.md` описва прегледа на поемането, проверката на инструктор, сигналите и арбитража.

## Извън обхват (Out of scope)

Обжалване. Спорове с няколко страни. Автоматично скриване при сигнали.

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: поканеният никога не получава достъп до доказателствата на ученика преди поемането на профила.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M10b` завършва с `VERIFY M10b: PASS`.
2. E2E тестове в `e2e/m10b-claims.spec.ts`:
   - `@M10b a missing teacher gets an invitation, claims the profile after review, then approves the pending request; before approval the edge stays involved_only`
   - `@M10b an unclaimed teacher record created by a student is absent from anonymous HTML, API, search and sitemap until verified`
   - `@M10b a self-declared Sifu is shown as unverified until an archivist approves instructor evidence`
   - `@M10b a moderator sets a relationship to in arbitration with a reason; public pages show "Disputed" and both parties receive a notification with the reason and an evidence-submission link`
   - `@M10b "Report profile" opens a review case and the same user cannot report the same profile twice`
3. Интеграционни тестове: токенът на поканата се пази като хеш и изтича; `awaiting_claim → pending_teacher` става само след одобрен `person_claim`; всеки преход записва `relationship_event` и одит; `api-parity.test.ts` минава.
4. Съществува `docs/screenshots/M10b/`. Ръководствата са обновени (`scripts/verify.d/M10b.sh` проверява, че са променени в клона). Изпълнен е `/security-review`. PR, зелен CI, чист `git status`.

## Кога да спре и да попита (Stop and ask)

Общите условия, а освен това: ако текстът на поканата изисква правен текст извън черновите от M02.

## Ред за /goal

```text
/goal Implement milestone M10b exactly as written in docs/plan/M10b-claims-reports.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. First run `git fetch origin`. If branch m10b-claims-reports exists on origin, check it out and continue from its Progress log and any answered question in docs/plan/questions/M10b.md; otherwise branch from origin/main. If a milestone listed under Dependencies is not merged into origin/main, print `BLOCKED M10b: dependency <milestone> not merged`. Begin every turn with the line `M10b turn <n>/40`. Success: the goal is met when this conversation shows all of: (1) the step summary printed by `scripts/verify.sh M10b`, ending with the line `VERIFY M10b: PASS`; (2) the work committed and pushed on branch m10b-claims-reports with a PR to main whose description is in English and includes that step summary; (3) the PR's CI checks all passed (show the GitHub tool output or `gh pr checks`); (4) `git status` showing a clean tree. Respect the Out of scope, Constraints and Stop and ask sections. Every mutation is an oRPC procedure; Server Actions only wrap it. Update the Bulgarian user and admin guides in docs/guides/. Commit and push after every green checkpoint and add one line per checkpoint to the Progress log. Before the final verify run /code-review and /security-review on the diff and fix correctness, security or requirement gaps only. Never delete, skip or weaken a test or check to get a pass. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M10b.md, commit and push. The goal also ends, not as success, when you print a `BLOCKED M10b: <one-line reason>` line (after recording any question as above) or `STOPPED M10b: turn limit` followed by a progress summary after 40 turns.
```

## Дневник на напредъка (Progress log)

- 2026-11-01 05:45 — схемата и единствената миграция `*_m10b_claims_reports` (`review_event` само за добавяне, `invitation.accepted_by_user_id` и ключ за идемпотентност, един сигнал от акаунт за обект, една отворена проверка на инструктор, `v_public_person.instructor_status`, `v_public_edge.approved_by_unverified_instructor`), тестовите данни: опорните Сифу са потвърдени (f0fe0a2)
- 2026-11-01 06:11 — услугите: поканата (токен от 32 байта, само SHA-256, 14 дни, веднъж, писмото през outbox със запечатана връзка), поемането (`awaiting_claim → pending_teacher` само след одобрен `person_claim`), проверката на инструктор, сигналите, арбитражът (DEFAULT D19), страницата на случая; шаблоните на писмата и известията (efbb2c9)
- 2026-11-01 06:27 — процедурите в `/api/rpc` и `/api/v1`, тънките Server Actions в таблицата за паритет, страниците (`/dashboard/teachers/invite`, `/invite/[token]`, `/dashboard/instructor`, `/dashboard/cases`, `/people/[slug]/report`, `/admin/review/arbitrate/[id]`), „Disputed“ на публичните страници, „Instructor (unverified)“ и „Approved by an unverified instructor“ (12ebfa3)
- 2026-11-01 06:40 — `claims.int.test.ts` (12): токенът като хеш, изтичане, еднократност, един и същ 404; преходът само след одобрен иск; поканеният не отваря доказателствата преди това; всеки преход с `relationship_event` и одит; инструктор, сигнал, арбитраж (f50f1f4)
- 2026-11-01 06:43 — `e2e/m10b-claims.spec.ts` с петте заглавия в проекта `exclusive` (`PUBLIC_WRITE_SPECS`), новите маршрути и състояния на екраните; `PW_EXCLUSIVE=1 pnpm e2e --grep @M10b` минава (f9e4f6d); снимките в `docs/screenshots/M10b/` (0f5afa4)
- 2026-11-01 06:55 — `docs/evidence-and-review.md` (D03, D04/D13, D19, D23, сигналите), ADR 0013, двете ръководства, моделът на данните, статусът в плана (M10a слят), трите въпроса към собственика (`docs/plan/questions/M10b.md`), `scripts/verify.d/M10b.sh`, **Your cases** в таблото
- 2026-11-01 08:05 — `/code-review` на разликата и `/security-review`: поправени са потвържденията на документите за поканения (прескача настройката на профила, не и тях), състоянието на иска на страницата на поканата, бележките и файловете на другата страна за член на персонала, който е страна по спор, възлагането на спор и сигнал само на решаващите и `from_status` при оттегляне; уязвимости с висока увереност няма (fe22707)
