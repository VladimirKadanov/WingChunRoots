# ADR 0046: Добавки към паспорта за Premium Student

| | |
|---|---|
| Статус | Прието (18.11.2026) |
| Контекст | Планът „Premium student upgrade plan“ (Claude Doc, 18.11.2026), функция 3 „Passport extras“, одобрен от собственика; правилото за събитията е на собственика: „premium student can say he attended, but organizer have to approve it to be visible“. След ADR 0045 собственикът каза „go“. Спецификация §3.1, §8; план §6.4, §6.5 |
| Свързани | [ADR 0022](0022-passport.md) (паспортът, M19), [ADR 0044](0044-premium-student.md), [ADR 0045](0045-lineage-card.md) (печатът), [ADR 0019](0019-galleries.md) (галерията), [`docs/entitlements.md`](../entitlements.md) (матрицата `2026-11-18.3`) |

## Решение

Пълният паспорт (Premium Student и Professional Sifu, `passportLevel(plan) === 'full'`) получава три неща. Free Student и Free Sifu запазват основния паспорт без промяна.

### 1. Заявка за присъствие на събитие

- Ученикът избира минало публикувано събитие на `/dashboard/passport` („Add an event you attended“) и пита организатора („Ask the organizer to confirm“). Предлагат се до `CLAIMABLE_EVENTS_LIMIT` = 100 събития, най-новите първо, без тези, които ученикът е организирал или на които е преподавал, и без тези, за които вече има запис или заявка.
- Заявката е ред в `event_attendance` със `status = 'pending'` и `claimed = true`. Тя се вижда **само в собствения паспорт на ученика**, с надпис „Waiting for the organizer to confirm: only you see it“; не е в публичния паспорт (`v_public_passport` взима само `active`), не се брои в „скрити от плана“. Ученикът може да я върне („Take back the request“, `withdrawn`) и да пита отново.
- Най-много `ATTENDANCE_CLAIMS_PENDING_MAX` = 20 чакащи заявки на ученик (DEFAULT, без D номер); над тях — отказ `CONFLICT` с обяснение. Една отворена заявка или запис на събитие и човек: частичният уникален индекс `event_attendance_open_key` върху `active`, `pending` и `refused`.
- Решава организаторът на събитието (акаунтът или личността), инструктор на събитието или активен админ на организацията, която го организира (`/dashboard/events/attendance`, „Attendance requests“). Известие `passport.attendance-claimed` (категория „Teachers and students“, имейл по подразбиране) отива при организатора или админите на организацията; в него няма името на ученика.
- „Confirm“ прави реда `active`: влиза в паспорта като събитие и ученикът решава дали профилът го показва (видимостта е както при всеки запис). Като „Marked by“ се записва потвърдилият, ако е организатор или инструктор; админ на организация не се записва като учител.
- „Refuse“ прави реда `refused`: **пази се**, никой не го вижда (и ученикът — не), и същото събитие не може да се заяви отново. Ученикът получава `passport.attendance-decided` с отговора. Ако по-късно учителят-организатор отбележи ученика (`passport.markAttendance`), отказаната или чакащата заявка става негов запис (`active`).
- Повторен еднакъв отговор е идемпотентен; обратният на вече даден — `CONFLICT`. Одит: `passport.attendance_claim`, `passport.attendance_decide`, при връщане `passport.withdraw`; само идентификатори.
- Нови колони: `claimed`, `decided_at`, `decided_by_user_id` (при изтриване на акаунта се изчиства, `account-erasure.ts`). Проверките `event_attendance_claim_status`, `event_attendance_pending_undecided` и `event_attendance_refused_decided` пазят състоянията смислени.

### 2. Снимки към степен

- Ученикът слага до `PASSPORT_RANK_PHOTOS_MAX` = 3 снимки от **собствената си галерия** на всяка своя активна степен („Add photos“ / „Change photos“ на `/dashboard/passport`), в реда на галерията. Празен списък ги маха.
- Таблица `passport_rank_photo` (степен, снимка, позиция 0–2; каскадно изтриване със степента или снимката). Услугата `passport.setRankPhotos` (`POST /api/v1/passport/rank/photos`) проверява, че степента е на ученика и е активна, че планът е пълен (иначе `ENTITLEMENT_REQUIRED`) и че всяка снимка е негова и е в галерията (`active` или `gallery`; иначе `BAD_REQUEST`). Одит `passport.rank_photos` с броя преди и след.
- Снимките се показват със степента в пълния публичен паспорт и в собствения паспорт. Адресите са тези на галерията (`/api/photos/...`), които се дават на всички точно когато човекът е публичен, затова паспортът не открива нищо ново. Снимка, махната от галерията, изпада от степента. При по-нисък план изборът се пази, но не се показва (DEFAULT D08), а нов избор се отказва.

### 3. Печат и PDF

- `/dashboard/passport/print` („Print or save as PDF“ от `/dashboard/passport`): копие на собствения паспорт за хартия. Бутонът извиква печата на браузъра; „Save as PDF“ прави PDF, без библиотека (както картата, ADR 0045). При печат менюто на таблото и лентите на приложението са скрити (`print:hidden`), цветовете са хартиените.
- По подразбиране само публичните записи; „Include private entries“ (`?private=1`) добавя частните, всеки с надпис „Private entry: not shown on the profile“. Чакащите заявки никога не се печатат. Страницата е лична (не се кешира, не се индексира).
- При основен паспорт страницата казва в едно изречение, че печатът е част от Premium Student и Professional Sifu, без подкана.

### 4. Матрицата

Редът `passport` запазва клетките от спецификацията (`source`); надписите стават „Full timeline, event confirmations, rank photos and PDF“ (Premium Student) и „Full timeline with confirmations, photos and PDF, and you record for your students“ (Professional Sifu). `PLAN_MATRIX_VERSION` е `2026-11-18.3`.

## Алтернативи

- Записът на ученика да е видим веднага: отхвърлено от собственика (организаторът трябва да потвърди).
- Отказаната заявка да се трие: отхвърлено (нищо не се трие, D08; иначе ученикът би питал отново безкрай).
- Отделно качване на снимки за степента: отхвърлено, снимките идват от галерията (един лимит, една модерация).
- PDF библиотека: отхвърлено (печатът на браузъра стига).

## Последици

- `docs/api/openapi.json` има `passport.claimable`, `passport.claimAttendance`, `passport.attendanceClaims`, `passport.decideAttendance` и `passport.setRankPhotos`; матрицата за права има редовете им и тези на Server Actions.
- Интеграционни тестове: `attendance-claims.int.test.ts`, `passport-rank-photos.int.test.ts`; E2E `e2e/premium-passport-extras.spec.ts`.
- Ръководствата за потребителя и администратора описват заявките, снимките и печата.
