# M09 — Заявки към учител и независими одобрения

`docs/plan/M09-teacher-requests.md` · клон `m09-teacher-requests` · таван 50 хода · D03, D04, D05, D06

## Цел (Objective)

Ученик изпраща заявка за връзка с регистриран учител. Всеки учител одобрява или отказва своята заявка независимо от другите. Потвърдените връзки стават публични, двете страни получават известия, а всеки преход се одитира.

## Прочети първо (Read first)

`docs/WingChunRoots_Technical_Plan.bg.md`: §5.6, §5.8, §6.2, §6.3, §6.4, §6.5, §6.6, §6.7, §6.8; `docs/design/direction.md`; `docs/api/lineage.md` §6.1 (кои тагове на кеша изчиства всеки запис; добавено от M04).

## Зависимости (Dependencies)

M07, M08.

## Обхват (In scope)

1. **Добавяне на учител** (`/dashboard/teachers/new`):
   - търсене на учителя с палитрата в режим на избор;
   - линия (по желание);
   - един или повече периоди на обучение (начало с точност, край или „ongoing“, школа по желание);
   - предпочитание за показване (D05, само визуално).

   oRPC процедура `relationships.request` с ключ за идемпотентност, която формата вика чрез тънък Server Action (план §6.8). Резултатът е `pending_teacher` с `visibility = 'involved_only'` (D03).
2. **Нова заявка.** Учителят получава известие в таблото и имейл с името на ученика, началото на обучението и връзка към опашката.
3. **Страната на учителя** (`/dashboard/students/requests`). Таблица с „Approve“ и „Reject“ (с неутрална причина), през процедурите `relationships.approve` и `relationships.reject`. Одобрението минава в една транзакция, по ред:
   - глобалният lock `pg_advisory_xact_lock(hashtext('teaching_relationship.verify'))` (план §6.3);
   - `requireEntitlement` (до 5 ученици за Безплатен Сифу, D06);
   - проверка за цикъл върху основната таблица `teaching_relationship` по статусите `verified` и `in_arbitration`, независимо от видимостта;
   - дубликат и връзка със самия себе си.
4. **При одобрение:** `verified` и `public`; двете личности стават `public` (план §6.2); `relationship_event`; одит `relationship.approve`; `invalidatePublic` за таговете на профилите и линията (план §6.4); известия в таблото и по имейл (outbox) и за двете страни; задача за преизчисляване на броячите.
5. **Вътрешно обновяване на кеша.** `POST /api/internal/revalidate` със споделен таен ключ, достъпен само в мрежата на Compose (в тестовете на localhost), вика `revalidateTag(tag, 'max')`. Worker-ът го вика след всяко преизчисляване (план §6.4).
6. **При отказ:** неутрално обяснение. Ученикът получава известие с причината и връзка за повторно подаване, може да поправи данните и да подаде заявката отново. Ученикът може и да оттегли заявка (`relationships.withdraw`).
7. **Край на обучението** (`relationships.end`). Ученикът или учителят могат да отбележат, че обучението е приключило (крайна дата). Връзката става историческа и не се изтрива.
8. Няколко учители са независими: едно одобрение не потвърждава други връзки.
9. **Допълване на матрицата за оторизация** за услугите за връзки (роля × собственост).
10. **Ръководство:** `docs/guides/user-guide.bg.md` описва заявката към учител, одобрението и отказа, повторното подаване, оттеглянето и края на обучението, от страната на ученика и на учителя.

## Извън обхват (Out of scope)

Липсващи и исторически учители, доказателства (M10a, M10b). Седмичен имейл с обобщение на чакащите заявки. Спорове.

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: проверката за цикли никога не чете `v_public_edge`.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M09` завършва с `VERIFY M09: PASS`.
2. E2E тестове в `e2e/m09-requests.spec.ts`:
   - `@M09 a student requests two teachers in different lineages; each approves separately; both edges become public`
   - `@M09 a pending request is visible only to the student, the teacher and reviewers (profile, list view and API)`
   - `@M09 a new request creates a teacher dashboard notification and an email with the student, the training start and a queue link`
   - `@M09 an unrelated user's approve action is refused with no state change`
   - `@M09 demo-free-sifu-5's sixth approval is blocked, the upgrade prompt appears and the request stays pending`
   - `@M09 a rejection notifies the student with the neutral reason and a resubmit link; the student corrects and resubmits`
   - `@M09 a claim that would create a cycle is refused with a clear message`
   - `@M09 double-clicking Approve records one approval and sends one email`
   - `@M09 a teacher marks training as ended and the relationship stays visible as historical`
   - `@M09 request and approve a teacher at 390x844`
   - `@M09 after an approval the teacher's public descendant count updates without waiting for cacheLife`
3. Интеграционни тестове:
   - всеки преход записва `relationship_event` и `audit_log`; матрицата за оторизация на услугите за връзки минава;
   - `cycle.int.test.ts`: три едновременни одобрения, които образуват цикъл A→B, B→C, C→A, дават точно две успешни;
   - `revalidate.int.test.ts`: вътрешният маршрут отказва заявка без тайния ключ;
   - `relationships.api.int.test.ts`: заявка и одобрение през `/api/v1` с `Authorization: Bearer` дават същия резултат и същия одит като уеб формата; `api-parity.test.ts` минава.
4. Съществува `docs/screenshots/M09/`. Ръководството е обновено (`scripts/verify.d/M09.sh` проверява, че е променено в клона). Изпълнен е `/security-review`. PR, зелен CI, чист `git status`.

## Кога да спре и да попита (Stop and ask)

Общите условия, а освен това: ако се окаже нужно учителят да редактира периодите, вместо да одобри или откаже. По подразбиране ученикът предлага, а учителят одобрява или отказва с причина. Въпросът се записва и етапът продължава с това правило.

## Ред за /goal

```text
/goal Implement milestone M09 exactly as written in docs/plan/M09-teacher-requests.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. First run `git fetch origin`. If branch m09-teacher-requests exists on origin, check it out and continue from its Progress log and any answered question in docs/plan/questions/M09.md; otherwise branch from origin/main. If a milestone listed under Dependencies is not merged into origin/main, print `BLOCKED M09: dependency <milestone> not merged`. Begin every turn with the line `M09 turn <n>/50`. Success: the goal is met when this conversation shows all of: (1) the step summary printed by `scripts/verify.sh M09`, ending with the line `VERIFY M09: PASS`; (2) the work committed and pushed on branch m09-teacher-requests with a PR to main whose description is in English and includes that step summary; (3) the PR's CI checks all passed (show the GitHub tool output or `gh pr checks`); (4) `git status` showing a clean tree. Respect the Out of scope, Constraints and Stop and ask sections. Every relationship mutation is an oRPC procedure that also accepts a bearer session; Server Actions only wrap it. Update the Bulgarian user guide in docs/guides/. Commit and push after every green checkpoint and add one line per checkpoint to the Progress log. Before the final verify run /code-review and /security-review on the diff and fix correctness, authorization or requirement gaps only. Never delete, skip or weaken a test or check to get a pass. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M09.md, commit and push. The goal also ends, not as success, when you print a `BLOCKED M09: <one-line reason>` line (after recording any question as above) or `STOPPED M09: turn limit` followed by a progress summary after 50 turns.
```

## Дневник на напредъка (Progress log)
