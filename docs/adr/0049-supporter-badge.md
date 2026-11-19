# ADR 0049: Значка „Supporter“ за Premium Student и Professional Sifu

| | |
|---|---|
| Статус | Прието (19.11.2026) |
| Контекст | Планът „Premium student upgrade plan“ (Claude Doc, 18.11.2026), функция „Supporter badge“, одобрен от собственика. На 19.11.2026 собственикът каза „go on, dont wait for my approval, lets pack this up“. Спецификация §3.1; план §5.6, §6.5 |
| Свързани | [ADR 0047](0047-featured-profile.md), [ADR 0048](0048-kung-fu-family.md), [`docs/entitlements.md`](../entitlements.md) (матрицата `2026-11-19.3`) |

## Решение

Нов ред в матрицата, `supporter_badge` („Supporter badge“): включен в Premium Student и Professional Sifu („Optional badge on your profile“); Free Student и Free Sifu „No“; за Federation е „Not applicable“. `supporterIncluded(plan)` в `src/server/services/supporter.ts` пита матрицата.

- **По избор.** Колона `person.supporter_badge`, `false` по подразбиране (DEFAULT ADR 0049: изключена, докато членът сам не я включи в `/dashboard/profile`, раздел **Supporter badge**, отметката **Show the Supporter badge on my profile**).
- **Процедури.** `profile.supporter` (собственият избор и дали планът го включва), `profile.setSupporter` (`show: true` иска плана, иначе `ENTITLEMENT_REQUIRED`; `show: false` работи на всеки план; одит `person.supporter_badge` с избора преди и след), `people.supporter` (публичният отговор, еднакъв за всички, кеширан за минути и маркиран с `personTag`; NOT_FOUND за човек, който не е публичен).
- **Видът.** Хапче с ромб и думата „Supporter“ в мастило, под фактите в заглавката на профила. Собствена форма, никога кръглият печат на проверката (план §4.6), и никога само цвят.
- **Значката не променя нищо друго:** търсенето, линията, прегледите и подредбите не я четат. Плащането не показва никого: чете се само за човек в `v_public_person`.
- На по-нисък план изборът се пази и значката не се показва (DEFAULT D08); `/dashboard/profile` казва това в едно изречение. При изтриване на акаунта изборът се нулира.
- Ранен достъп: планът го споменава, но засега няма функция с ранен достъп, затова нито матрицата, нито страниците го обещават (CLAUDE.md §11: само ползи, които съществуват сега).

## Алтернативи

- Значката включена по подразбиране: отхвърлено (някои членове не искат да показват, че плащат).
- Значката в търсенето или в графа: отхвърлено (без предимство по план в подредбата и видимостта).

## Последици

- Миграция `*_premium_supporter_badge`; `docs/api/openapi.json` има трите процедури; матрицата за права има редовете им и Server Action-а.
- Интеграционни тестове: `supporter.int.test.ts`; E2E `e2e/premium-supporter-badge.spec.ts` (в изключителното пускане, защото пише публична страница).
