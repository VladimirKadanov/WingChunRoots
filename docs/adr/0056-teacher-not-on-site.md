# ADR 0056: Учител, който още не е в WingChunRoots, и поемане на профил без втори профил

| | |
|---|---|
| Статус | Прието (25.11.2026) |
| Контекст | Прегледът на всички роли (25.11.2026, https://claude.ai/artifact/6bt42cDSmTEspvjVeMzH5u), находки P1-1 и P1-2. Собственикът поиска P1 („Do you need anything from me for p1?“). |
| Свързани | [ADR 0013](0013-claims-reports-arbitration.md), [ADR 0040](0040-self-claim.md), M09, M10b, план §6.7 |

## Проблемът

1. **Задънена улица при избор на учител.** Ученикът намира публичния запис на учителя си в **Name a teacher**, попълва формата и едва при изпращане чете „This teacher has no account yet. Requests to teachers without an account open later in the pilot.“ Поканата (`/dashboard/teachers/invite`) прави **нов** запис, така че учителят остава с два записа.
2. **Изгубен иск при регистрация.** Посетител отваря **Ask to claim this profile**, влиза през **Create an account**, но връзката в писмото за потвърждаване не носи `next` на страницата на иска (`ridesInConfirmationLink` познаваше само покани и пробни тренировки). След входа той стига до **Set up your profile**, прави втори профил и после страницата на иска му казва, че не може да поеме друг.
3. Одобрен иск от страницата на профила не пускаше заявките, които чакат записа (`awaiting_claim`); пускаше се само заявката на самата покана.

## Решение

- **`relationships.invite` приема `teacherId`.** Публичен запис на жив човек, който никой не е поел, се посочва с покана; не се прави нов запис (`newTeacherRecord: false` в одита). Отказва се с думи: запис, който вече е на някого („This teacher is on WingChunRoots already: send them a request instead.“), собственият запис, исторически или починал човек, непубличен запис. Записът се чете с `FOR SHARE`, за да изчака одобряван в момента иск.
- **Търсенето казва `invitable`** (публично поле на `personHitSchema`): `stewardship = 'unclaimed'`, `kind = 'living'`, не `deceased`. Профилната страница вече показва същото („Kept by the archive; nobody has claimed it yet“ и **Is this you?**), така че не се разкрива нищо ново. Палитрата в режим на избор пише **Not on WingChunRoots yet**.
- **Формата на заявката** показва раздел **Invite them** с адреса по желание и бутон **Send the request and invite**; тънкото действие вика `relationships.invite` вместо `relationships.request`. Резултатът е `?invited=<id>` в **Your teachers**, както при поканата.
- **Одобреният иск пуска всички чакащи заявки** към записа (`review-kinds.ts`, `decidePersonClaim`), в реда на създаването им, с известие до учителя за всяка и `invitation.claimed` до всеки ученик. Ключът за идемпотентност носи само събитието на собствената заявка на случая (ключът е уникален за актьора).
- **Искът оцелява при регистрация.** `isClaimPath` (`/people/<slug>/claim`) се пренася в писмото за потвърждаване; страницата за регистрация казва **Then your claim**; `/onboarding` с такъв `next` иска само документите, както при покана.
- **„Is there a profile of you already?“** над **Set up your profile**: GET търсене (`?find=`, без JavaScript), което показва само `invitable` записи с **This is me: ask to claim it**.
- **Акаунт с профил** на страницата на иска получава **Report it as a second profile of you** (`viewer.ownProfile` в `claims.get`), което отваря **Report profile** с причина `misleading`.
- Текстът на `NO_ACCOUNT_MESSAGE` (когато клиент на API все пак прати `relationships.request` към такъв запис) вече не споменава пилота.

## Последици

- Договорът се променя: `relationships.invite` (`teacherId`), `search.query` (`invitable`), `claims.get` (`viewer.ownProfile`); `docs/api/openapi.json` е регенериран.
- Тестове: `profile-claims.int.test.ts` (покана към намерен запис, отказите, одобреният иск пуска двете заявки), `search.int.test.ts` (`invitable`), `relationships.int.test.ts` (новият текст), `e2e/claim-request.spec.ts` (регистрация към иск, търсенето при профила, формата с покана, сигнал за втори профил), `e2e/m07-search.spec.ts` (списъкът на ключовете).
- Визуалните еталони на `/onboarding` и `/dashboard/teachers/new` се сменят (новото поле и текстът).
