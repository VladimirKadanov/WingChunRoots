# M20 — Проверка за активност на школите

`docs/plan/M20-school-activity.md` · клон `m20-school-activity` · Фаза 2 („Проверка за активност на школите (90/105 дни)“, технически план §2.4) · спецификация §7.3; D17, D18, D20

## Цел (Objective)

Пинът на школа на картата показва школа, която работи. Обявена школа, чийто акаунт не я е редактирал и не я е потвърдил 90 дни, чака потвърждение: собственикът (и администраторите на организациите, с които школата е свързана) получава спокойно известие с молба да потвърди обявата в рамките на около 14 дни. На ден 105 без активност публичният пин и обявата се скриват от всички публични отговори, без школата да се трие, а собственикът научава как да я покаже отново. Потвърждение („This listing is current“) или редакция връщат школата, само ако всички останали условия за пина още са изпълнени (D18). Влизането в профила никога не е активност (D17).

## Прочети първо (Read first)

`CLAUDE.md` (§5, §6, §8, §10, §11, §15); спецификация §7.3; технически план §2.4, §5.6, §5.8, §6.1, §6.4, §6.5, §6.8, §10.1 (D17, D18, D20); `docs/adr/0003-jobs-and-mail.md`, `0014-schools-map.md`, `0021-notices.md`; `docs/schools-and-map.md`; `src/server/services/schools.ts`, `src/server/jobs/plan-expiry.ts` (образецът за дневна задача и известие); `docs/design/direction.md`.

## Зависимости (Dependencies)

M19 и всички етапи преди него, слети в `main`.

## Обхват (In scope)

1. **Състояние, записано изрично.** `school.activity_stage` (`current`, `awaiting_confirmation`, `hidden`) с `activity_awaiting_since` и `activity_hidden_at`, проверка, че всеки етап носи точно своите дати, и частичен индекс за дневната задача. Една миграция за PostgreSQL 16+. `v_public_school` (същите колони) не показва скрита школа, така че картата, списъкът, търсенето, страницата на школата, sitemap, Open Graph, JSON-LD, страниците на организации и събития я губят без собствен филтър.
2. **Дневна задача `schools.activity`** (pg-boss, 05:23 UTC). DEFAULT D17: ден 90 без редакция или потвърждение → `awaiting_confirmation` и известие `school.activity-awaiting` до собственика и до администраторите на организациите с приета връзка; ден 105 → `hidden` и известие `school.activity-hidden` до собственика. Скриване никога по-рано от 14 дни след молбата (пропуснат ден не скрива без известие). Възрастта се мери с часовника на базата; всяка школа се мести в своя транзакция с условие, което повтаря всички проверки; ключ на известието за школа, етап и период без активност. Повторно пускане, повторен опит и две задачи наведнъж не правят нищо повече. След скриване задачата изчиства публичния кеш `schools` през вътрешния адрес.
3. **Известията.** Категория `schools` (имейлът е включен по подразбиране и може да се изключи, M18). Текст само на английски в `src/server/templates/`: датата на последната активност и ориентировъчна дата, без обратно броене, натиск или упрек (CLAUDE.md §11).
4. **Възстановяване.** `schools.confirm`, `schools.update` (истинска промяна) и `schools.submit` местят `last_activity_at` и връщат `current`. DEFAULT D18: пинът се връща само ако обявата е активна и одобрена, а акаунтът има Professional Sifu. На Free Sifu потвърждението се записва, но пин не се отключва. Влизането не мести нищо (DEFAULT D17).
5. **Таблото на собственика.** `/dashboard/schools` и `/dashboard/schools/[id]`: етапът с текст и знак (не само цвят) и с датата („Awaiting confirmation since …“, „Hidden from the map since …“), едно основно действие „This listing is current“, бележка за Free Sifu.
6. **Персоналът.** `/admin/schools` (модератор и администратор с втори фактор): обявените школи с етапа, датите, дали са на картата, и филтър по етап; връзка от `/admin`.
7. **API.** `schools.adminList` (`GET /api/v1/admin/schools`), `schools.mine` и `schools.edit` с `activity`, `schools.confirm` с новото описание; регенериран `docs/api/openapi.json`; Server Actions остават тънки обвивки; редове в матрицата за оторизация.
8. **Демо данни (D20).** Само измислени, с фиксирани дати и собствен поток от идентификатори: `demo-school-awaiting-birmingham` (чака потвърждение, публична) и `demo-school-hidden-munich` (скрита, пазена) на `demo-pro-sifu-8`, с известията им (прочетени).
9. **Тестове.** Unit (шаблоните, каталогът, датите на етапа); интеграционни (`school-activity.int.test.ts`: границите 89/90/104/105, повторно пускане, съперничество с потвърждение, часовник напред, връщане със и без право, влизането не брои, скрита школа липсва от всеки публичен отговор, никакви точни координати, организацията); E2E `@M20` (в `exclusive`): собственикът вижда етапа, потвърждава и пинът се връща; axe в двете теми, телефон, визуални еталони.
10. **Документи и проверка.** ADR 0023, `scripts/verify.d/M20.sh`, двете ръководства, `docs/data-model.md`, `docs/schools-and-map.md`, `docs/plan/questions/M20.md`, редът на M20 в `docs/plan/README.md` и в план §8.3.

## Извън обхват (Out of scope)

SMS и push известия; плащания; ръчно скриване от персонала извън съществуващата модерация; автоматично изтриване на стари школи; проверка за активност на организации и събития; heatmap на федерацията (Фаза 3).

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: скриването е на сървъра, никога с CSS; точни координати в нито един публичен отговор, известие, имейл или лог; в логовете само броеве и идентификатори; без изкуствена спешност; визуалните еталони се приемат само от CI.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M20` завършва с `VERIFY M20: PASS`.
2. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int` и `pnpm build` (с бюджетите) минават; всички `bash scripts/verify.d/M*.sh` минават.
3. E2E `@M20` минава: собственикът вижда „Hidden from the map“, потвърждава и пинът се връща; axe в двете теми.
4. `@M11` и `@M18` минават.
5. Съществуват ADR 0023, обновените ръководства и `docs/data-model.md`, въпросите в `docs/plan/questions/M20.md`.

## Кога да спре и да попита (Stop and ask)

Общите условия. Особено ако скриването би трябвало да изтрие данни, ако публичен отговор би трябвало да съдържа точна точка, или ако е нужен SMS доставчик.

## Ред за /goal

```text
/goal Implement milestone M20 exactly as written in docs/plan/M20-school-activity.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. Work on branch m20-school-activity from origin/main. Success: `scripts/verify.sh M20` ends with `VERIFY M20: PASS`, the work is committed and pushed on the branch, and `git status` is clean. Never delete, skip or weaken a test or check. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M20.md, commit and push, and print `BLOCKED M20: <reason>`.
```

## Дневник на напредъка (Progress log)

- 2026-11-08 — файлът на етапа
- 2026-11-08 — `school.activity_stage` (миграция), `v_public_school` без скритите школи, дневната задача `schools.activity`, известията, връщането при потвърждение и редакция, таблото на собственика, `/admin/schools`, `schools.adminList`, демо школите (typecheck, lint, unit — зелени)
- 2026-11-08 — интеграционните тестове (`school-activity.int.test.ts`, 17), редовете в матрицата за оторизация, unit тестовете на датите и известията, E2E `@M20` (изключителното пускане и изгледът на компютър и телефон), маршрутите и екранните снимки
- 2026-11-08 — ADR 0023, въпросите, двете ръководства, `docs/data-model.md`, `docs/schools-and-map.md`, редовете в README и в план §8.3, `scripts/verify.d/M20.sh`
