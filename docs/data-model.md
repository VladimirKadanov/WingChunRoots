# Модел на данните (Фаза 1)

Етапи M01, M01b и M02 · план §6.2–§6.7 · решения: [ADR 0002](adr/0002-data-model.md), [ADR 0003](adr/0003-jobs-and-mail.md) (задачи и поща), [ADR 0004](adr/0004-auth.md) (акаунти)

Този документ описва базата данни на WingChunRoots такава, каквато я създават миграциите в `drizzle/`: таблиците, изгледите, ролите и правата, ограниченията, личните данни и сроковете им на пазене, и фиктивните данни за разработка. Източникът на истината е кодът: схемата на Drizzle в `src/server/db/schema/` и SQL-ът на миграциите. При разминаване важи кодът, а документът се поправя.

## Съдържание

1. [Общи правила](#1-общи-правила)
2. [Таблици](#2-таблици)
3. [Публични изгледи](#3-публични-изгледи)
4. [Роли и права](#4-роли-и-права)
5. [Ограничения и индекси](#5-ограничения-и-индекси)
6. [Одитен журнал](#6-одитен-журнал)
7. [Лични данни и срокове на пазене](#7-лични-данни-и-срокове-на-пазене)
8. [Миграции и команди](#8-миграции-и-команди)
9. [Фиктивни данни](#9-фиктивни-данни)
10. [Решения по подразбиране](#10-решения-по-подразбиране)

## 1. Общи правила

- **PostgreSQL 16+ и PostGIS 3.4+.** SQL-ът върви на PostgreSQL 16 (облачната сесия) и 18 (CI, Docker Compose). Не се ползват `uuidv7()`, виртуални генерирани колони и `OLD`/`NEW` в `RETURNING` (план §3.2); `scripts/verify.d/M01.sh` го проверява.
- **Идентификатори.** Всички първични ключове са `uuid`. Приложението ги генерира като UUIDv7 (`src/server/db/ids.ts`, Drizzle `$defaultFn`): нарастващи във времето, затова индексите остават компактни. Колоните имат резервно `DEFAULT gen_random_uuid()` (UUIDv4) за ръчни вмъквания в SQL.
- **Време.** Всяка таблица има `created_at` и `updated_at` (`timestamptz`, по подразбиране `now()`; Drizzle обновява `updated_at` при всяка промяна). Таблиците с меко изтриване имат `deleted_at`: `person`, `lineage`, `school`, `organization`, `evidence_file`.
- **Изброявания.** Статусите и видовете са `text` с `CHECK (... IN (...))`, а не типове `enum` на PostgreSQL: нова стойност е една миграция без `ALTER TYPE` извън транзакция. Списъците са в `src/server/db/schema/common.ts`, и същите стойности ползва TypeScript.
- **Потребители.** Акаунтите са в `auth_user` (Better Auth, M02). Всяка колона `*_user_id` е `uuid` с външен ключ към `auth_user.id`, освен `audit_log.actor_user_id`: журналът е само за добавяне и надживява акаунта. Акаунтът е отделен от личността (DEFAULT D04): личност може да няма акаунт, а акаунтът получава своя личност при първоначалния профил (`person.claimed_by_user_id`).
- **Slug.** `person`, `lineage`, `school` и `organization` имат уникален `slug` във формат `^[a-z0-9]+(-[a-z0-9]+)*$`. Фиктивните записи започват с `demo-` (D20).
- **Държави** са двубуквени кодове по ISO 3166-1 (`^[A-Z]{2}$`), **писмености** са кодове по ISO 15924 (`Latn`, `Hant`, `Hans`, `Cyrl`, …), а **езиците** са BCP 47 тагове (`en`, `bg-Latn`, `yue-Latn`, `zh-Hant`).

## 2. Таблици

### Личности и имена

| Таблица | Предназначение и важни колони |
|---|---|
| `person` | Една личност е един възел в графа. `kind` (`living`, `historical`), `life_status` (`living`, `deceased`, `unknown`), `stewardship` (`self` — профилът е поет от самия човек; `platform` — исторически запис, поддържан от архивистите; `unclaimed` — жив човек без акаунт), **`visibility`** (`involved_only` по подразбиране, `public`), `claimed_by_user_id` (уникален), `created_by_user_id`, `country_code`, `place_id` (град от `place`, M02), `training_start_year` (1900–2100, M02), `birth_date` (не се събира във Фаза 1, DEFAULT D16), `deleted_at`. `stewardship = 'self'` изисква `claimed_by_user_id` |
| `person_name` | Всички изписвания на името (план §5.3). `kind` (`name`, `alias`, `romanization`), `value`, `script`, `lang`, `romanization` (`jyutping`, `pinyin`, `yale`, `hk_gov`, `bg_streamlined`), `is_primary`, `sort_order`. Всяка личност има точно едно основно име (`is_primary`), и то е на латиница (`script = 'Latn'`, `kind = 'name'`); останалите са по желание: оригиналната писменост, Jyutping, пинин, псевдоними |
| `person_name_key` | Нормализирани ключове за търсене (M07): `key`, `key_kind` (`latin`, `jyutping`, `pinyin`, `han`, `cyrillic`, `alias`), `is_primary`, `source` (как е получен ключът: `name`, `bg_streamlined`, `transliteration`, `pinyin-pro`, `to-jyutping`, `opencc-js`, `alias:hk-spelling`). Пише се при всеки запис на имената и от задачата `search.keys.rebuild`; след `pnpm db:seed` е празна, докато worker-ът не изпълни задачата. GIN `gin_trgm_ops` и B-tree `text_pattern_ops` върху `key`. Търсенето я чете само през изгледа `v_public_person_key` (виж §4, `docs/search.md`) |
| `person_bio` | Биография на даден език: една на личност и език (`person_id`, `lang`) |
| `person_claim` | Заявка „това съм аз“: `user_id`, `status` (`pending`, `approved`, `rejected`, `withdrawn`), `message`, `review_case_id`, кой и кога е решил (`decided_by_user_id`, `decided_at`). Най-много една чакаща заявка от един потребител за една личност; няколко души могат да заявят една и съща личност и прегледът решава |
| `invitation` | Покана към жив учител без акаунт (статус `awaiting_claim`, план §6.7): `email` (`NULL`, след като срокът на пазене изтече; задължителен при `pending`), `token_hash` (SHA-256 на токена в hex; самият токен не се пази), `status` (`pending`, `accepted`, `expired`, `revoked`), `expires_at`, `relationship_id` |

### Линии и връзки

| Таблица | Предназначение и важни колони |
|---|---|
| `lineage` | Линия (стил, клон): `slug`, `name`, `description`, `root_person_id` — може да е празен (DEFAULT D22) |
| `teaching_relationship` | Ребро учител → ученик в една линия: `teacher_person_id`, `student_person_id`, `lineage_id` (задължителен), `status` (8-те статуса от план §6.7: `pending_teacher`, `awaiting_claim`, `under_review`, `verified`, `rejected`, `withdrawn`, `in_arbitration`, `revoked`), `verification_path` (`teacher_approval`, `committee_review`), `is_display_primary`, `visibility`, `requested_by_user_id`, `confirmed_by_user_id`, `confirmed_at`, `status_reason` (при `rejected`: кодът на неутралната причина, M09), `prefers_display_primary` (M09: желанието на ученика тази връзка да е основната линия, изпратено със заявката и приложено към `is_display_primary` при одобрение, DEFAULT D05). Ребрата не се трият физически: приключилото обучение става историческо чрез `training_period` |
| `training_period` | Периоди на обучение по връзка (прекъсване = два периода): `starts_on`, `ends_on`, `precision` (`year`, `month`, `day`, `unknown`), `ongoing`, `sort_order`, `school_id` (M09: школата на периода, по желание; `ON DELETE SET NULL`). Текущ период няма крайна дата; краят не е преди началото. Краят на обучението (`relationships.end`, M09) слага `ends_on` на текущите периоди и маха `ongoing`; връзката остава |
| `relationship_event` | Пълната история на статусите на всяка връзка: `from_status`, `to_status`, `actor_user_id`, `actor_role`, `reason`, `idempotency_key` (M09: ключът, който клиентът праща с всяка промяна; уникален за (`actor_user_id`, `idempotency_key`), формат `^[A-Za-z0-9_-]{8,64}$`; повторено извикване със същия ключ намира събитието и не променя нищо, план §5.6). Само за добавяне за `app_rw`; външният ключ към връзката е `ON DELETE RESTRICT`, така че историята не може да изчезне чрез каскада |
| `lineage_membership` | Кой към коя линия принадлежи и на каква дълбочина (`lineage_id`, `person_id`, `depth`, `computed_at`). Попълва се от фоновата задача `lineage.recompute` (от M09, след всяко одобрение), която чете само `v_public_edge` и `v_public_person`; членове са хората в двата края на публичните ребра на линията и публичният ѝ корен, `depth` е броят поколения под корена (`NULL` за член без връзка с корена) |

### Школи и география

| Таблица | Предназначение и важни колони |
|---|---|
| `place` | Справочник на градовете от GeoNames (лиценз CC BY 4.0): `geonames_id` (уникален), `name`, `ascii_name`, `country_code`, `admin1_code`, `feature_code`, `population`, `timezone`, **`centroid`** |
| `school` | Школа: `slug`, `name`, `place_id`, `location_privacy` (`exact`, `city_only`; по подразбиране `city_only`), **`public_point`** (точната точка при `exact`, центроидът на града при `city_only`; при `city_only` тригер записва центроида, който и да пише, вж. §5), `status` (`draft`, `published`, `hidden`, `archived`), `description`, `website_url`, `last_activity_at` (DEFAULT D17), `created_by_user_id`, `deleted_at` |
| `school_private_location` | Точното място и адресът на школата (`school_id`, **`exact_point`**, `address_line`). Отделна таблица, до която `app_public_ro` няма никакъв достъп |
| `school_instructor` | Инструкторите на школата: `school_id`, `person_id`, `role` (`head_instructor`, `instructor`, `assistant`) |

Трите колони `place.centroid`, `school.public_point` и `school_private_location.exact_point` са `geography(Point,4326)` (`customType` в `src/server/db/schema/geography.ts`), всяка с GiST индекс. Върху `geography` `ST_DWithin(…, 50000)` мери в метри; върху `geometry(Point,4326)` би мерил в градуси. Приложението подава точките като `{ lng, lat }` (първо дължина, както в GeoJSON и PostGIS).

### Доказателства и модерация

| Таблица | Предназначение и важни колони |
|---|---|
| `evidence_file` | Файл с доказателство в частния бъкет (DEFAULT D13): `storage_key` (уникален), `sha256` (хеш на съхранения обект), `original_sha256` (хеш на качения оригинал, когато изображението е прекодирано), `mime` (`CHECK`: само `image/jpeg`, `image/png`, `image/webp`, `application/pdf`, разпознати по първите байтове, M10a), `size_bytes` (до 20 MB, DEFAULT D25), `original_name` (името на качения файл, изчистено, до 200 знака; показва се само на тези, които могат да изтеглят файла, M10a), `scan_status` (`pending`, `clean`, `rejected`), `retention_until`, `uploaded_by_user_id`, `deleted_at`. Ключът е случаен и не излиза от сървъра ([`docs/evidence-and-review.md`](evidence-and-review.md)) |
| `evidence_link` | Към какво се отнася доказателството: точно едно от `review_case_id`, `relationship_id`, `person_id`; `note` |
| `review_case` | Случай за преглед: `kind` (`historical_claim`, `person_claim`, `instructor_verification`, `relationship_dispute`, `profile_report`, `school_listing`, `deletion_request`), `status` (`open`, `in_review`, `needs_info`, `resolved`, `dismissed`), обект (`relationship_id`, `person_id`, `school_id`), `assigned_to_user_id`, `resolution` (`approved`, `rejected`), `resolution_reason`, `resolved_at`. Най-много един отворен случай (`open`, `in_review`, `needs_info`) от един вид за една връзка (M10a) |
| `review_note` | Бележки по случая: `author_user_id`, `body` (не празен), `is_internal` (по подразбиране вътрешна, видима само за екипа; въпросът „нужна е информация“ и бележката на ученика към иска не са вътрешни), `idempotency_key` (уникален за автора, M10a: повторното изпращане на същата форма не добавя втора бележка) |
| `content_report` | Сигнал за съдържание: `subject_type` (`person`, `teaching_relationship`, `school`, `person_name`), `subject_id`, `reason` (`incorrect`, `impersonation`, `privacy`, `offensive`, `other`), `status`, `review_case_id` |

### Организации и права

| Таблица | Предназначение и важни колони |
|---|---|
| `organization` | Скелет за федерации и асоциации (DEFAULT D12): `slug`, `name`, `kind` (`federation`, `association`, `school_group`), `status` (`pending`, `active`, `suspended`), `country_code`, `website_url` |
| `organization_membership` | Членство на личност в организация: `role` (`leader`, `admin`, `member`), `starts_on`, `ends_on`. Отделно е от историята на обучение и не я променя |
| `entitlement_grant` | Право на план (M08): точно един получател (`subject_user_id` или `subject_organization_id`), `plan_code` (`free_student`, `premium_student`, `free_sifu`, `pro_sifu`, `federation`), `source` (`test_grant`, `complimentary`, `stripe`), `starts_at`, `ends_at`, задължителна `reason`, отмяна с `revoked_at`, `revoked_by_user_id` и `revoke_reason` |
| `pilot_access_request` | Заявка „Request pilot access“ от подканата за по-висок план (M08, план §5.6): `user_id`, `plan_code`, `status` (`open`, `closed`), `closed_at`, `closed_by_user_id`, `grant_id` (правото, с което администраторът я е затворил; празно, когато я е затворил без план, с причина в одита `pilot_access.close`, или когато смяната на вида акаунт я е затворила). Най-много една отворена заявка на акаунт. Не води до плащане ([`docs/entitlements.md`](entitlements.md)) |

### Съгласия, известия и одит

| Таблица | Предназначение и важни колони |
|---|---|
| `consent_record` | Дадено или оттеглено съгласие: `user_id`, `kind` (`terms`, `privacy_ack`, `authenticity_declaration`, `age_18_plus`, `publication`; M02), `document_version` (версията на документа от `content/legal/`, например `2026-10-17-draft`), `action` (`granted`, `withdrawn`), `occurred_at`. Редовете не се променят: нова версия или оттегляне е нов ред |
| `notification` | Известия в таблото: `user_id`, `template` (текстовете са в `src/server/templates/`), `payload`, `read_at`. От M08: `pilot-access.requested` (до администраторите), `pilot-access.closed` (до акаунта, когато администратор затвори заявката му без план), `plan.granted` (`payload`: `planCode`, `startsAt`, `endsAt`) и `plan.revoked`; частичният индекс `notification_user_id_unread_idx` брои непрочетените |
| `email_delivery` | Един ред на имейл (M01b: `Mailer` и outbox-ът): `to_email` (`NULL`, след като срокът на пазене изтече; задължителен при `queued`), `template`, `idempotency_key` (уникален), `status` (`queued`, `sent`, `failed`), `attempts` (брой опити, ≥ 0), `last_attempt_at`, `provider_message_id`, `error` (без адреси, до 500 знака), `sent_at` |
| `audit_log` | Одитен журнал само за добавяне (раздел 6) |

`media_asset` (Фаза 2) още не съществува.

### Акаунти (M02)

Таблиците на Better Auth 1.7 с префикс `auth_` ([ADR 0004](adr/0004-auth.md)). Имената на свойствата в Drizzle са имената на полетата на Better Auth, а колоните са в `snake_case` като навсякъде.

| Таблица | Предназначение и важни колони |
|---|---|
| `auth_user` | Акаунт за вход: `email` (уникален, винаги с малки букви), `email_verified`, `name` (празно: имената на човека са в `person_name`), **`role`** (`user`, `moderator`, `archivist`, `admin`; не се подава при регистрация), `two_factor_enabled`, `banned`, `ban_reason`, `ban_expires`, `timezone`, **`account_type`** (M08: `student` по подразбиране или `sifu`; изборът на човека, който определя безплатния план и не потвърждава нищо, DEFAULT D04). Роля на персонала само при `two_factor_enabled` (`CHECK auth_user_staff_needs_2fa`) |
| `auth_session` | Сесия: `token` (уникален; в бисквитката и като `Authorization: Bearer` е подписан), `expires_at`, `user_agent`, **`ip_address`** (никога IP адресът, а `ip_hmac`: 64 hex знака, `CHECK auth_session_ip_hmac_format`), **`two_factor_verified_at`** (кога тази сесия е минала втория фактор; `requireStaff2FA()` проверява него), `impersonated_by` |
| `auth_account` | Начин за вход на акаунта: `provider_id` (`credential` за имейл и парола), `account_id`, **`credential_hash`** (хеш scrypt със сол, никога паролата; полето `password` на Better Auth); колоните за OAuth токени остават празни във Фаза 1. Уникален `(provider_id, account_id)` |
| `auth_verification` | Краткотрайни стойности: токени за потвърждаване (24 часа) и възстановяване (1 час), чакащ втори фактор, доверено устройство. `identifier` се пази хеширан; `value`, `expires_at` |
| `auth_two_factor` | TOTP на акаунта (един ред на акаунт): `secret` и `backup_codes`, шифрирани с `BETTER_AUTH_SECRET`; `verified`, `failed_verification_count`, `locked_until` (временно заключване след грешни кодове при вход или в сесия без проверен втори фактор; сесия, която вече го е минала, не праща кодове и не брои тук, трети кръг на прегледа) |
| `auth_throttle` | Броячи и еднократни отметки на модула за акаунти (M02, първи кръг на прегледа): `key` (до 200 знака), `count` (≥ 0), `expires_at`. Ключовете никога не съдържат адрес или код в чист вид, а HMAC с `IP_HMAC_KEY`: `sign-in:<HMAC на адреса>` (опити с парола от браузъри, които не са познати за адреса; 10 поредни неуспешни заключват адреса за 15 минути; от третия кръг на прегледа се брои и правилната парола на непотвърден акаунт, която получава отговора на грешна парола, а потвърждаването на адреса нулира ключа), `sign-in-device:<HMAC на адреса и идентификатора на браузъра>` (същото за един познат браузър, бисквитката `wcr.known_device`; втори кръг на прегледа) и `totp:<HMAC на акаунта и кода>` (приет TOTP код, отказва се повторно 120 s; код, който плъгинът откаже по друга причина, се освобождава веднага, трети кръг). Опитът се запазва, преди паролата да бъде проверена (`reserve()`, една заявка), и се връща, когато не е бил грешна парола (ADR 0004, раздел 7) |

`auth_account`, `auth_session` и `auth_two_factor` се трият с акаунта (`CASCADE`).

### Схемата `pgboss` (M01b)

Опашката на pg-boss е в същата база, в отделна схема `pgboss` (версия 46 при pg-boss 12.38.0). Не я създават миграциите на Drizzle, а стъпка в `pnpm db:migrate` след тях, като `migrator`, от плановете за създаване и миграция на самия pg-boss (`src/server/jobs/schema.ts`, [ADR 0003](adr/0003-jobs-and-mail.md)). Приложението не пише в нея с SQL, а само през pg-boss. Задачите на имейлите носят `deliveryId` и данните на шаблона, но не и адреса; изпълнените задачи се трият след 7 дни.

## 3. Публични изгледи

Анонимното четене минава само през три изгледа. И трите са `security_barrier`, така че филтрите им се прилагат преди условията от заявката.

| Изглед | Съдържа | Колони |
|---|---|---|
| `v_public_person` | Само `visibility = 'public'` и без изтритите | `id`, `slug`, `kind`, `life_status`, `stewardship`, `country_code`, `display_name` (основното име), `alt_names` (JSON масив с останалите имена: `value`, `script`, `lang`, `kind`, `romanization`), `bio` (на английски, иначе първата по език), `created_at`, `updated_at`, `city_name` (от M04: името на града от `place`, никога точка). Без `birth_date`, без потребителски идентификатори |
| `v_public_edge` | Само `status` `verified` или `in_arbitration` с `visibility = 'public'`, между двама публични и неизтрити души с основно име (същото условие като във `v_public_person`, така че всяко ребро сочи към възел, който публичният граф има), в неизтрита линия | `id`, `teacher_person_id`, `student_person_id`, `lineage_id`, `status`, `verification_path`, `is_display_primary`, `visibility`, `confirmed_at`, `periods` (JSON: `startsOn`, `endsOn`, `precision`, `ongoing`), `created_at`, `updated_at`, `lineage_slug`, `lineage_name`, `lineage_root_person_id` (от M04; коренът само когато е публична личност, иначе `NULL`, DEFAULT D22) |
| `v_public_person_key` (M07) | Само ключовете на хората, които `v_public_person` показва; без `security_barrier`, за да се ползват индексите; `SELECT` само за `app_rw` (не за `app_public_ro`) | `person_id`, `person_name_id`, `key`, `key_kind`, `is_primary`, `source` |
| `v_public_school` | Само `status = 'published'` и без изтритите | `id`, `slug`, `name`, `location_privacy`, `precision` (`exact` или `city`), `public_point` (при `city_only` винаги центроидът на града от `place`, независимо какво пише в `school.public_point`: втора защита след тригера от §5), `place_id`, `city_name`, `country_code`, `description`, `website_url`, `last_activity_at`, `instructor_person_ids` (само публичните инструктори), `created_at`, `updated_at` |

Чакащите заявки, отказаните, оттеглените и отменените връзки, хората без публична връзка (например `demo-claim-only-teacher`), точните координати, адресите, доказателствата и одитът не са достъпни за публичната роля по никакъв път.

## 4. Роли и права

Ролите не се създават в миграциите: това изисква `CREATEROLE` и би сложило пароли в хранилището. Създава ги `scripts/db-bootstrap.sql` (обвивка `scripts/db-bootstrap.sh`), пуснат от суперпотребител веднъж за всяка среда и за всяка база, с пароли от средата (`DB_MIGRATOR_PASSWORD`, `DB_APP_RW_PASSWORD`, `DB_APP_PUBLIC_RO_PASSWORD`). Паролите стигат до psql чрез `\getenv`, никога през командния ред, а записът в лога на сървъра е изключен за тази сесия. Паролата на суперпотребителя също не минава през командния ред (там всеки локален потребител я вижда с `ps`): `scripts/lib/psql.sh` и `spawnPsql` в `src/server/db/admin.ts` я подават чрез `PGPASSWORD`, а `scripts/verify.sh` и `scripts/cloud-setup.sh` пускат `scripts/db-bootstrap.sh --test-database` вместо да подават адреса. Нужен е psql 15 или по-нов (`\getenv`); `scripts/db-bootstrap.sh`, `scripts/verify.sh` и `pnpm test:int` спират с ясна грешка при по-стар клиент (Ubuntu 22.04 има psql 14, Ubuntu 24.04 — psql 16). Скриптът още прави `migrator` собственик на базата и създава PostGIS (то не е „trusted“ разширение и иска суперпотребител). Миграциите съдържат само `GRANT` и `REVOKE`.

| Роля | Права |
|---|---|
| `migrator` | Собственик на базата и на всеки обект на приложението. `pnpm db:migrate` и `pnpm db:seed` работят като `migrator` (`SET ROLE migrator`), независимо кой се свързва, затова собственикът е един и същ навсякъде. Създава разширенията `pg_trgm`, `unaccent` и `fuzzystrmatch` (trusted) |
| `app_rw` | Услугите, Better Auth и worker-ът. `SELECT`, `INSERT`, `UPDATE`, `DELETE` върху таблиците на приложението, включително `auth_*` (M02); върху `audit_log` и `relationship_event` само `SELECT` и `INSERT`; `SELECT` върху трите изгледа. В схемата `pgboss` (M01b): `USAGE`, `SELECT`, `INSERT`, `UPDATE`, `DELETE` върху таблиците и `USAGE`, `SELECT`, `UPDATE` върху поредиците (и за таблиците от бъдещи версии чрез `ALTER DEFAULT PRIVILEGES`). Няма `CREATE` в нито една схема и в базата |
| `app_public_ro` | Анонимното четене: само `SELECT` върху `v_public_person`, `v_public_edge` и `v_public_school`; няма достъп до схемата `pgboss`. Всяка таблица, включително `school_private_location`, `evidence_file`, `evidence_link` и таблиците `auth_*`, дава `permission denied`. Към базата има само `CONNECT`: без `TEMPORARY`, така че не може да създава временни таблици (`PUBLIC` също губи подразбиращото се `TEMPORARY`; има го само `app_rw`). Интеграционен тест сверява пълния списък с релации, които ролята може да чете, и че не може да пише в нито една |

Приложението се свързва като `app_rw` (`getDb()`) и като `app_public_ro` (`getPublicDb()`) от `src/server/db/index.ts`, с отделен пул за всяка роля и `statement_timeout` 2 s, към хоста и базата от `DATABASE_URL` (в облачната сесия и в CI: `TEST_DATABASE_URL`). Всеки пул има слушател за събитието `error`: когато сървърът прекъсне неактивна връзка (рестарт на PostgreSQL или Docker Desktop, заспал компютър, `pg_terminate_backend`), процесът (`next start`, worker-ът) не пада, а пулът отваря нова връзка при следващата заявка. В лога отиват само ролята и SQLSTATE, никога адрес, заявка или параметри.

## 5. Ограничения и индекси

- `CHECK (teacher_person_id <> student_person_id)` (`teaching_relationship_not_self`).
- Частичен уникален индекс `teaching_relationship_active_key` върху `(teacher_person_id, student_person_id, lineage_id)` за активните статуси (`pending_teacher`, `awaiting_claim`, `under_review`, `verified`, `in_arbitration`): дублирана активна връзка се отказва, а нова заявка след отказ, оттегляне или отмяна е позволена.
- `teaching_relationship_one_display_primary_key`: най-много една установена връзка (`verified` или `in_arbitration`) с `is_display_primary` на ученик (DEFAULT D05). Заявките не участват, така че скрита заявка не може да заеме мястото и да издаде съществуването си чрез флаговете на публичните ребра на ученика (план §4.14).
- `teaching_relationship_display_primary_after_verification`: `is_display_primary` е позволен само при `verified`, `in_arbitration` или `revoked` (отменената връзка го пази като история). Слага го преходът към `verified` (M09), никога заявката.
- Тригерът `school_city_only_point` (`BEFORE INSERT OR UPDATE OF location_privacy, place_id, public_point` върху `school`) записва центроида на града в `school.public_point` за всяка школа с `city_only`, който и да пише, а `place_centroid_to_city_only_schools` (`AFTER UPDATE OF centroid` върху `place`) мести тези школи с поправения центроид. Така заявката по радиус от план §6.3, която M11 пуска като `app_rw` директно върху `school.public_point` (с GiST индекса), не може да измери разстояние до точната точка (план §6.4). През `v_public_school` индексът не се ползва: `ST_DWithin` не е `LEAKPROOF`, затова планерът го държи над филтрите на изгледа със `security_barrier`.
- `teaching_relationship_public_only_after_verification`: `visibility = 'public'` само при `verified`, `in_arbitration` или `revoked` (DEFAULT D03).
- Покриващи индекси `(student_person_id) INCLUDE (teacher_person_id, status, lineage_id)` и `(teacher_person_id) INCLUDE (student_person_id, status, lineage_id)` за рекурсивните заявки от план §6.3 (в отделна миграция, защото Drizzle не поддържа `INCLUDE`).
- `person_name_key.key`: GIN `gin_trgm_ops` (триграмна прилика) и B-tree `text_pattern_ops` (префикс).
- GiST върху трите `geography` колони.
- `email_delivery_queued_has_address` и `invitation_pending_has_email` (M01b): писмо в `queued` и покана в `pending` винаги имат адрес; адресът се заличава само след края им. `email_delivery_attempts_check`: `attempts >= 0`.
- Уникални: `slug` в четирите таблици със slug; `place.geonames_id`; `invitation.token_hash`; `evidence_file.storage_key`; `email_delivery.idempotency_key`; `review_note` (`author_user_id`, `idempotency_key`); един отворен `review_case` от вид за връзка (M10a); една основна `person_name` на личност; една `person_bio` на личност и език; една чакаща `person_claim` от потребител за личност; една личност на потребител (`person.claimed_by_user_id`).
- Формати: `slug`, двубуквени държави, ISO 15924 писмености, BCP 47 езици, SHA-256 в hex (`evidence_file`, `invitation`), `ip_hmac` (64 hex знака), действията в одита (`обект.действие`, например `relationship.verify`).
- Личности, линии и връзки по правило не се трият физически: скриват се (`deleted_at`) или връзката сменя статуса си и приключва. Базата го подкрепя: `teaching_relationship` държи личностите и линията с `ON DELETE RESTRICT`, а `relationship_event` държи връзката с `ON DELETE RESTRICT` (каскадните действия вървят с правата на собственика на таблицата и биха заобиколили правилото „само добавяне“). Имената, биографиите, заявките, поканите, периодите и членствата се трият заедно със своята личност или връзка (`CASCADE`), а препратките от случаите за преглед стават `NULL`.
- Акаунти (M02): `auth_user_role_check` (четирите роли), `auth_user_staff_needs_2fa` (роля на персонала само с включен 2FA), `auth_user_email_lowercase`, `auth_user_name_length` (до 200 знака), `auth_user_no_image` (`image` винаги `NULL`), `auth_session_ip_hmac_format`, `auth_two_factor_failed_count_check` (≥ 0), `auth_throttle_key_length`, `auth_throttle_count_check`, `person_training_start_year_range` (1900–2100). Уникални: `auth_user.email`, `auth_session.token`, `auth_two_factor.user_id`, `auth_account (provider_id, account_id)`.
- Тригерът `auth_user_end_sessions` (`AFTER UPDATE OF role, two_factor_enabled` върху `auth_user`): при смяна на ролята и при включване на 2FA трие всички сесии на акаунта и краткотрайните му стойности в `auth_verification` (план §3.2). Важи за всеки път, за бисквитки и за токени.
- Външни ключове към `auth_user` (M02): `CASCADE` само за редовете, които принадлежат изцяло на акаунта (`auth_*`, `notification`, `person_claim.user_id`, `entitlement_grant.subject_user_id`); `SET NULL` за `content_report.reporter_user_id`, `review_case.assigned_to_user_id` и `email_delivery.user_id`; `RESTRICT` за всички останали, включително `consent_record.user_id` (доказателство за съгласието) и авторите на записи, решения и доказателства. `person.place_id` → `place` е `SET NULL`.
- Права по план (M08): `auth_user_account_type_check` (`student`, `sifu`); `pilot_access_request_plan_code_check`, `pilot_access_request_status_check`, `pilot_access_request_closed` (затворената заявка има `closed_at`, отворената няма); частичният уникален индекс `pilot_access_request_one_open_key` (една отворена заявка на акаунт). `pilot_access_request.user_id` е `CASCADE`, `closed_by_user_id` е `RESTRICT`, `grant_id` е `SET NULL`. `app_rw` чете и пише `pilot_access_request`, а `app_public_ro` няма права върху нея.
- Циклите в графа не се проверяват от база данни: проверката е в услугата при преход към `verified`, под глобален advisory lock (план §6.3, M04).

## 6. Одитен журнал

`audit_log` е само за добавяне (план §6.6):

- `app_rw` има само `SELECT` и `INSERT` (`REVOKE UPDATE, DELETE, TRUNCATE`);
- тригерите `audit_log_no_update_delete` (`BEFORE UPDATE OR DELETE`, за всеки ред) и `audit_log_no_truncate` (`BEFORE TRUNCATE`) отказват промяна за всяка роля, включително собственика, с грешка `audit_log is append-only: <операция> is not allowed`;
- колони: `occurred_at`, `actor_user_id`, `actor_role`, `action`, `subject_type`, `subject_id`, `request_id`, **`ip_hmac`**, `before`, `after`, `reason`, `evidence_ids`, по желание `prev_hash` и `hash` (верига от хешове против подправяне).
- `evidence_ids` (`uuid[]`) са файловете с доказателства, на които се основава промяната (M10a): архивната редакция `person.update` (заедно с `reason`), искът за исторически учител `relationship.request` и решението по него `relationship.verify` или `relationship.reject`. Без доказателства колоната е `NULL`.

`relationship_event` също е само за добавяне за `app_rw`: няма `UPDATE` и `DELETE`, а външният ключ `ON DELETE RESTRICT` не позволява изтриване на връзка с история. Тригер няма: собственикът (`migrator`) може да поправя данни с миграция.

### `ip_hmac`

`ip_hmac = HMAC-SHA-256(таен ключ, IP адрес)` в hex. Пази се в `audit_log.ip_hmac` и в `auth_session.ip_address` (M02). Ключът е `IP_HMAC_KEY` в средата на сървъра (от M02), не е в базата и се сменя веднъж годишно. Обикновен SHA-256 на IPv4 адрес се обръща с изброяване на 2^32 стойности, затова се ползва ключ. **`ip_hmac` са лични данни** (псевдонимизиран IP адрес): с ключа всеки известен IP адрес може да се сравни с журнала.

## 7. Лични данни и срокове на пазене

Сроковете са решение по подразбиране за пилота и се потвърждават при правния преглед (план §10.2, ред 11); черновата на политиката за поверителност ги повтаря.

| Данни | Къде | Срок на пазене |
|---|---|---|
| `ip_hmac` | `audit_log`, `auth_session` | **Свързваемостта се пази до 13 месеца.** Ключът се сменя на всеки 12 месеца, а старият се унищожава до един месец след смяната. След това старите стойности не могат да се свържат с IP адрес и престават да са лични данни. Редовете не се трият (журналът е само за добавяне), затова срокът се постига чрез унищожаване на ключа. Новата стойност на ключа не се извежда от старата |
| Имена, биография, държава, дата на раждане | `person`, `person_name`, `person_bio` | Докато профилът съществува. При заявка за изтриване (`review_case.kind = 'deletion_request'`) личните полета се премахват или профилът се скрива (`deleted_at`), а връзките остават в графа като анонимни, ако други потребители зависят от тях (M10b). Таблото (M08, `dashboard.overview`) вече спазва това: другият човек във връзка с `deleted_at` се показва като „A removed profile“, без име, оригинално име и slug, а чакащата му заявка не се брои в „Student requests“ и в подканата за по-висок план |
| Имейл в поканата | `invitation.email` | До приемане, изтичане или отмяна на поканата плюс 30 дни; после се заличава (`NULL`), а покана, която още е `pending`, става `expired`. Изпълнява го задачата `retention.purge` (M01b) |
| Имейл на получателя | `email_delivery.to_email` | 90 дни от създаването на реда (отстраняване на проблеми с доставката); после се заличава (`NULL`), а неизпратено писмо става `failed`. Изпълнява го задачата `retention.purge` (M01b) |
| Имена и адрес в писмото | Задачите в `pgboss`, файловете на транспорта `file` (`.mail/`), Mailpit | Задачите се трият 7 дни след изпълнението си. `.mail/` и Mailpit са само за разработка с фиктивни данни; Mailpit пази до 5000 писма |
| Акаунт: имейл, хеш на паролата, TOTP | `auth_user`, `auth_account`, `auth_two_factor` | Докато акаунтът съществува. Акаунт, чийто адрес не е потвърден 7 дни след регистрацията, се изтрива от `retention.purge` заедно със записите си за съгласие, освен ако друг ред сочи към него (DEFAULT без номер D, [ADR 0004](adr/0004-auth.md)) |
| Броячи на входа и използвани TOTP кодове (HMAC) | `auth_throttle` | До изтичане (15 минути, 2 минути); изтеклите редове трие `retention.purge` |
| Сесия: токен, `user_agent`, `ip_hmac` | `auth_session` | До изтичане (7 дни, подновява се при ползване) или до изход. Изтеклите редове трие задачата `retention.purge` (M02) |
| Токени за потвърждаване и възстановяване, чакащ втори фактор | `auth_verification` | До изтичане (24 часа, 1 час, минути); изтеклите редове трие `retention.purge` |
| Съгласия | `consent_record` | Докато акаунтът съществува, като доказателство кога и за коя версия е дадено съгласието (`RESTRICT` към `auth_user`). Срокът след закриване на акаунта се решава при правния преглед |
| Точна точка и адрес на школа | `school_private_location` | Докато школата съществува; никога в публичен отговор, лог, sitemap, Open Graph или JSON-LD |
| Доказателства | `evidence_file` и частният бъкет | Срокът не е решен: `retention_until` остава празно и нищо не се трие автоматично (въпрос 1 в `docs/plan/questions/M10a.md`, GDPR). Докато акаунтът има качени доказателства, бележки по случаи или история на връзки, външните ключове `RESTRICT` не позволяват да бъде изтрит (`pnpm account:delete` спира с `CONFLICT`) |
| Одитни записи (без `ip_hmac`) | `audit_log` | Без срок: доказателство за всяко одобрение и архивна промяна (план §6.6) |

Задачата `retention.purge` (`src/server/services/retention.ts`) върви всеки ден в 03:17 UTC в worker-а, като `app_rw`, и е идемпотентна. От M02 трие и изтеклите редове на `auth_session`, `auth_verification` и `auth_throttle` (Better Auth трие изтекла сесия само когато токенът ѝ дойде отново), както и непотвърдените акаунти на повече от 7 дни. Променя редовете на партиди по 1000 (всяка в своя транзакция, далеч от `statement_timeout`) и прескача ред, заключен от писмо, което се изпраща в момента; следващото пускане го изтрива. Неуспех се записва в лога само със SQLSTATE. Ключът за идемпотентност в `email_delivery` остава и след изтриването на адреса, затова никога не съдържа лични данни (`@` се отказва, ADR 0003).

Логовете на приложението не съдържат имена, имейли, IP адреси и координати (план §6.4, M12). Worker-ът пише само идентификатори на задачи и доставки, а грешките на SMTP се записват в `email_delivery.error` с адресите заменени с `<address>`.

## 8. Миграции и команди

| Команда | Действие |
|---|---|
| `scripts/db-bootstrap.sh` | Роли, пароли, собственик на базата и PostGIS за базите от `DATABASE_URL` и `TEST_DATABASE_URL` (или подадените адреси). Веднъж за всяка среда и след създаване на нова база; `scripts/verify.sh` и `scripts/cloud-setup.sh` го пускат сами за тестовата база |
| `pnpm db:generate` | `drizzle-kit generate`: нова миграция от промяна в схемата. SQL, който Drizzle не изразява (изгледи, права, тригери, `INCLUDE`), е в миграция, създадена с `pnpm db:generate --custom --name <име>` |
| `pnpm db:migrate` | Прилага чакащите миграции като `migrator` върху `DATABASE_URL` (или `TEST_DATABASE_URL`, ако `DATABASE_URL` не е зададен). Всички чакащи миграции вървят в една транзакция. След тях създава или обновява схемата `pgboss` (M01b) и дава правата на `app_rw` |
| `pnpm db:seed` | Изпразва таблиците на приложението (без `audit_log`) и зарежда фиктивните данни; отпечатва броя редове и хеша на съдържанието. Отказва при `NODE_ENV=production` |
| `pnpm db:reset` | Трие всички обекти на приложението (схемите `public`, `drizzle` и `pgboss`) и възстановява празната база с PostGIS. Само за локален хост или `TEST_DATABASE_URL`, никога при `NODE_ENV=production`, и само като суперпотребител. След него: `pnpm db:migrate && pnpm db:seed` |
| `pnpm db:check` | `drizzle-kit check` (конфликти между миграции от паралелни клонове), проверка, че схемата няма промени без миграция, и прилагане на всички миграции в нова празна база (два пъти: вторият път не прилага нищо), включително стъпката за `pgboss` (създава версията на закачения pg-boss, а вторият път не променя нищо) |
| `pnpm test:int` | Интеграционните тестове `src/server/**/*.int.test.ts` (базата, задачите, пощата, сроковете на пазене): всеки файл създава своя база, прилага bootstrap и миграциите, и я трие накрая. Срещу `TEST_DATABASE_URL`, а без него — Testcontainers с образа `postgis/postgis:18-3.6` по digest (нужен е Docker) |
| `pnpm fixtures:generate` | Записва `fixtures/lineage-600.json` от генератора |

Миграциите в M01:

1. `*_extensions`: `postgis`, `pg_trgm`, `unaccent`, `fuzzystrmatch` (`CREATE EXTENSION IF NOT EXISTS`).
2. `*_schema`: таблиците, ограниченията и индексите, генерирани от схемата.
3. `*_roles_views_audit`: покриващите индекси, трите изгледа, тригерите на `audit_log` и правата (само `GRANT` и `REVOKE`).
4. `*_relationship_event_keep_history`: `ON DELETE RESTRICT` вместо `CASCADE` за `relationship_event` → `teaching_relationship`.
5. `*_display_primary_after_verification` (след прегледа на M01): индексът за `is_display_primary` брои само `verified` и `in_arbitration`, а `CHECK` не позволява флага на заявка.
6. `*_school_public_point_and_views` (след прегледа на M01): тригерите за `school.public_point` при `city_only`; `v_public_edge` иска основно име и за двата края, както `v_public_person`.

Миграцията в M01b:

7. `*_mail_delivery_attempts_and_retention`: `email_delivery.attempts` и `last_attempt_at`, индекс по `created_at` за почистването; `email_delivery.to_email` и `invitation.email` допускат `NULL` (сроковете на пазене от §7) с `CHECK`, че писмо в `queued` и покана в `pending` имат адрес.

Миграциите в M02:

8. `*_auth_accounts`: таблиците `auth_*`, външните ключове от всяка колона `*_user_id` към `auth_user` (без `audit_log.actor_user_id`), `person.place_id` и `person.training_start_year`, новите видове съгласия.
9. `*_auth_roles_sessions`: правата на `app_rw` върху `auth_*` (и изричен `REVOKE` за `app_public_ro`) и тригерът `auth_user_end_sessions`.
10. `*_auth_hardening` (първи кръг на прегледа): таблицата `auth_throttle` с правата ѝ, индекс на всеки външен ключ към `auth_user`, който нямаше (изтриването на непотвърден акаунт и проверките `RESTRICT` не сканират цели таблици), и `CHECK`-овете `auth_user_name_length` и `auth_user_no_image`.

Миграцията в M04:

11. `*_public_views_lineage_city`: `v_public_person` получава `city_name`, а `v_public_edge` — `lineage_slug`, `lineage_name` и `lineage_root_person_id` (за профила и списъчния изглед, `docs/api/lineage.md`). `CREATE OR REPLACE VIEW` добавя колоните накрая; филтрите, редът на колоните и правата остават, така че `app_public_ro` чете същите три изгледа.

Миграцията в M08 (след M04: при сливането с `main` е генерирана наново върху миграцията на M04, със същия SQL):

12. `*_m08_entitlements`: генерираната от схемата `pilot_access_request` с ограниченията и индексите ѝ (и частичния уникален `pilot_access_request_one_open_key`), `auth_user.account_type` с `auth_user_account_type_check` и частичният индекс `notification_user_id_unread_idx`; накрая, на ръка, правата: `app_rw` чете и пише `pilot_access_request`, а `REVOKE ALL` я затваря за `app_public_ro`.

Миграцията в M10a (след тези на M07 и M09):

- `*_m10a_evidence_review`: `evidence_file.original_name` с `CHECK` за дължината, `CHECK` за четирите вида в `evidence_file.mime`, частичният уникален индекс за един отворен случай от вид за връзка, `review_note.idempotency_key` с уникален индекс за автора и формата си и `CHECK`, че бележката не е празна. Нова таблица няма, затова и нови права: `app_rw` вече чете и пише четирите таблици на доказателствата и прегледа, а `app_public_ro` няма достъп до тях.

Поправка към коментара на миграция 1: там пише, че в облачната сесия, CI и локалните тестове миграцията сама създава PostGIS като суперпотребител. Това не е вярно: миграциите винаги вървят като `migrator` (`SET ROLE`), а PostGIS създава `scripts/db-bootstrap.sql` преди всяка миграция; `CREATE EXTENSION IF NOT EXISTS postgis` в миграцията само го потвърждава. Приложена миграция не се редактира, затова поправката е тук и в коментара на миграция 6.

Базата трябва да е с UTF-8 и локал `C.UTF-8`: при `LC_CTYPE=C` `pg_trgm` не извлича триграми от кирилица и китайски (`scripts/db-env-check.sh` и интеграционните тестове го проверяват с `show_trgm('Тестов')`).

## 9. Фиктивни данни

`src/fixtures/generate.ts` е детерминиран генератор (seed `20261016`): един и същ seed дава едни и същи редове, байт по байт. Идентификаторите са UUIDv7, изградени от seed-а, а времената — от фиксирана дата (1.1.2026), никога от часовника. Всички записи са явно измислени (DEFAULT D20): slug-овете започват с `demo-`, всяка биография съдържа „Fictional demo record“, фамилиите на латиница и кирилица са измислени (`Testov`, `Samplewood`, `Примерова`), а имейлите са на домейна `example.test`. Градовете са реални (извлечение от GeoNames, CC BY 4.0, в `src/fixtures/geonames-cities.ts`), школите в тях са измислени.

| Мярка | Стойност при seed 20261016 | Изискване (M01, точка 10) |
|---|---|---|
| Хора / линии | 600 / 3 | 550–650 / 3 |
| Ученици на `demo-hub-a` / `demo-hub-b` | 129 / 123 | ≥ 120 всеки |
| С двама учители в една линия | 48 (8 %) | 6–10 % |
| С учител от друга линия | 18 (3 %) | 2–4 % |
| Само с исторически (приключили) връзки | 10 (1,7 %) | 1–3 % |
| Статуси | и осемте от план §6.7 | поне по една връзка във всеки |
| Имена | 286 души с традиционни йероглифи (140 и с опростени), Jyutping и пинин; 30 с кирилица; 38 псевдонима | основно име на латиница за всички |

`person.visibility` е `public` точно за хората с поне една публична връзка (`verified` или `in_arbitration`). Опорните записи с фиксирани slug-ове (`demo-root-a`, `demo-root-b`, `demo-root-c`, `demo-shared-ancestor`, `demo-hub-a`, `demo-hub-b`, `demo-two-lineages`, `demo-converging`, `demo-historical-only`, `demo-pending`, `demo-under-review`, `demo-arbitration`, `demo-claim-only-teacher`, `demo-cjk-name`, `demo-cyrillic-name`, `demo-latin-name`, `demo-free-sifu-5`, `demo-pro-sifu-8`, `demo-school-city-only`, `demo-school-two-lineages`) са описани в `src/fixtures/generate.ts` и се проверяват от `src/fixtures/generate.test.ts`. Освен тях има `demo-invited-teacher` (жив учител без акаунт с покана и връзка в статус `awaiting_claim`).

`fixtures/lineage-600.json` е публичната част на данните във формата на план §6.3 (`focusId` е `demo-two-lineages`, `nodes`, `edges` с `kind` `primary`, `converging` или `crossLineage`, `hiddenCounts`), с два допълнителни ключа за тестовете: `anchors` (slug → id на публичните опорни записи) и `lineages`. Файлът се генерира с `pnpm fixtures:generate`; unit тестът и `scripts/verify.d/M01.sh` проверяват, че е актуален.

`pnpm db:seed` създава и входни акаунти за тестовете (M02), никога при `NODE_ENV=production`:

- `<slug>@example.test`, свързани с опорните личности `demo-pending`, `demo-root-a`, `demo-hub-a`, `demo-free-sifu-5`, `demo-pro-sifu-8` и `demo-two-lineages` (`person.claimed_by_user_id`, `stewardship = 'self'`);
- `demo-admin@example.test`, `demo-archivist@example.test` и `demo-moderator@example.test` с ролите си и включен TOTP;
- съгласията от регистрацията за всеки акаунт, с текущите версии (DEFAULT D10).

Паролата на всички е `E2E_PASSWORD`, а TOTP тайната на персонала е `E2E_TOTP_SECRET`, шифрирана с `BETTER_AUTH_SECRET`. Тези стойности са само за локалната среда и CI, генерират се случайно и не са в хранилището; без тях seed-ът пропуска паролите и тайните. Доказателства seed-ът не създава. Единственото право по план е тестовият Professional Sifu на `demo-pro-sifu-8` (M08: от 1.2.2026, без край, дадено от `demo-admin`, с причина „Fictional demo record: …“); `demo-free-sifu-5` е Free Sifu с 5 от 5 одобрени ученици и една чакаща заявка.

## 10. Решения по подразбиране

| Решение | Как е приложено |
|---|---|
| DEFAULT D03 | Чакащите заявки и личностите, създадени чрез заявка или покана, са `involved_only`; връзка става `public` само след `verified` (`CHECK` в базата); изгледите показват само публичното |
| DEFAULT D04 | Акаунтът (`auth_user`) е отделен от личността (`person`); ролите на персонала са отделни от плановете (`entitlement_grant`) и от проверката на връзките |
| DEFAULT D04/D13 (M08) | `auth_user.account_type` само избира безплатния план; Sifu без одобрен случай `instructor_verification` се показва като „Instructor (unverified)“ |
| DEFAULT D05 | Всички активни връзки се пазят; `is_display_primary` е само визуално предпочитание, най-много една на ученик сред `verified` и `in_arbitration`; заявка не носи флага, слага го потвърждаването (M09) |
| DEFAULT D06, D08 (M08) | Отнемането на право по план (`revoked_at`) и смяната Sifu → Student не пипат `teaching_relationship`: потвърдените връзки остават потвърдени и публични |
| DEFAULT D07, D09 (M08) | Медийните квоти и предложените цени са в матрицата в код (`src/server/entitlements/plans.ts`), не в базата; не се налагат и не се таксуват |
| DEFAULT D10 | Пилотът е само за пълнолетни: съгласие `age_18_plus` при регистрация, без рождена дата |
| DEFAULT D12 | `organization` и `organization_membership` са само скелет; членството не променя историята на обучение |
| DEFAULT D13 | Доказателствата са в отделна таблица и частен бъкет; публичната роля няма достъп до `evidence_file` и `evidence_link` |
| DEFAULT D16 | `person.birth_date` не се попълва във Фаза 1 |
| DEFAULT D17 | `school.last_activity_at` се обновява само при редакция или потвърждение на школата, никога при вход |
| DEFAULT D20 | Само явно измислени данни със slug `demo-…` |
| DEFAULT D22 | `lineage.root_person_id` може да е празен; коренът може да е исторически (`demo-root-c`) |
| DEFAULT D23 | `consent_record.document_version` сочи чернова (`2026-10-17-draft`) с надпис „Draft — pending legal review“ |
| DEFAULT D25 | `evidence_file.size_bytes` е до 20 MB |

Решенията без номер D (например текст с `CHECK` вместо `enum` и сроковете на пазене от раздел 7) са в [ADR 0002](adr/0002-data-model.md), а тези за акаунтите — в [ADR 0004](adr/0004-auth.md).
