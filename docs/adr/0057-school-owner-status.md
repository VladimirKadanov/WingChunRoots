# ADR 0057: Школите на собственика на едно място, състоянието с думи и потвърждение с едно натискане

| | |
|---|---|
| Статус | Прието (25.11.2026) |
| Контекст | Прегледът на всички роли (25.11.2026, https://claude.ai/artifact/6bt42cDSmTEspvjVeMzH5u), находка P1-4. Собственикът поиска P1. |
| Свързани | M11, M20 (DEFAULT D17), M21, [ADR 0039](0039-member-navigation.md) |

## Проблемът

1. **My schools** на таблото четеше само `school_instructor`, а **Your schools** само `created_by_user_id`: обявена школа без ред на инструктор (или без собственика като инструктор) липсваше от таблото, а двата списъка не съвпадаха.
2. Обявена школа, която проверката за активност е скрила, пише „Listed“ в реда си, а под него — „Hidden from the map since …“.
3. Напомнянето е на таблото и в известието, а бутонът **This listing is current** беше само на страницата на школата; запитванията за пробна тренировка не се виждаха на таблото.

## Решение

- `dashboard.overview` чете школите, които акаунтът е обявил, **или** които водят профила му като инструктор, по веднъж. Нови полета на `SchoolItem`: `owned`, `openTrialRequests` (само за собствени школи), `needsConfirmation` (собствена, обявена, етап `awaiting_confirmation` или `hidden`). Ролята е „Listed by you“, ако акаунтът не е и инструктор.
- Едно състояние с думи за собственика (`listingLabel` в `school-activity.ts`), еднакво в **Your schools**, на страницата на школата и на таблото: **Listed, needs your confirmation** и **Hidden from the map until you confirm it** вместо „Listed“; другите са като досега.
- **This listing is current** е на реда в **Your schools** и в **My schools** на таблото. Формата е същата (`ListingAction`, `schools.confirm`) с поле `back` (`schools` или `home`, име, а не адрес) и собствен идентификатор на ред (`school-listing-<id>`); резултатът се връща в същия списък (`?confirmed=<id>`). Работи и без JavaScript.
- Не е ново API: `schools.confirm` е непроменено.

## Последици

- `/dashboard` е на 167,9 от 170 kB JavaScript (бюджетът от M00b): клиентската форма вече се ползва от `/dashboard/schools`.
- Тестове: `school-activity.int.test.ts` (две нови), `e2e/m20-school-activity.spec.ts` (едно натискане от таблото и от **Your schools**, без JavaScript, axe), `e2e/m08-entitlements.spec.ts` (новият празен текст).
- Визуалният еталон на `/dashboard` за Sifu може да се смени (празният текст).
