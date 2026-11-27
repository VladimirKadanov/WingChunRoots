# ADR 0080: Един път „Add a teacher“ и липсваща линия

| | |
|---|---|
| Статус | Прието (27.11.2026) |
| Контекст | Вторият преглед на всички пътища (26.11.2026), находка P2-2. Собственикът: „great“ и „all the fixes you proposed are good“. |
| Свързани | M09, M10a, M10b, [ADR 0067](0067-ask-teacher-to-confirm.md), [ADR 0077](0077-legend-and-record.md) |

## Проблемът

Страницата **Your teachers** имаше три бутона (**Name a teacher**, **Name a historical teacher**, **Invite a teacher**), а ученикът трябваше сам да реши кой път е неговият, преди да е потърсил учителя. Полето **Lineage of this training** изглеждаше като задължителен избор, а ако линията изобщо липсваше на сайта, нямаше кого да попита.

## Решение

- **Един бутон.** **Your teachers** има един бутон **Add a teacher** (`/dashboard/teachers/new`). Формата първо търси учителя; ако не го намерите, **Not found? Add them** води към поканата (`/dashboard/teachers/invite?from=search`), където първият въпрос е **Has this teacher died?**: **No, add and invite them** остава на поканата, **Yes, name a historical teacher** отваря иска с доказателства.
- **Линията по подразбиране.** Празният избор се казва „Not sure: the teacher’s own lineage“, с подсказка да се смени само ако сте тренирали в друга линия.
- **„My lineage is not listed“.** Връзката под полето води към `/dashboard/lineages/missing`: име на линията (до 120 знака) отива като известие **A lineage is missing** (категория **Account**, само на таблото) до архивистите и администраторите (`lineage.reportMissing`, до 5 на ден на акаунт, одит `lineage.missing_report`). Нищо не се записва в архива автоматично; архивистът добавя линията през архивната редакция.

## Последици

- Новата процедура `lineage.reportMissing` (`POST /api/v1/lineage/report-missing`) е само за вписани потребители; Server Action `reportMissingLineageAction` е тънка обвивка над нея.
- Името на линията е в известието и в одита (въведено от потребителя, без лични данни по предназначение); не се логва.
