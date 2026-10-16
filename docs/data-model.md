# Модел на данните (Фаза 1)

Етап M01 · план §6.2–§6.7 · решение: [ADR 0002](adr/0002-data-model.md)

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
- **Потребители.** Колоните `*_user_id` са `uuid` без външен ключ. Таблицата на потребителите идва с Better Auth в M02, който добавя и външните ключове.
- **Slug.** `person`, `lineage`, `school` и `organization` имат уникален `slug` във формат `^[a-z0-9]+(-[a-z0-9]+)*$`. Фиктивните записи започват с `demo-` (D20).
- **Държави** са двубуквени кодове по ISO 3166-1 (`^[A-Z]{2}$`), **писмености** са кодове по ISO 15924 (`Latn`, `Hant`, `Hans`, `Cyrl`, …), а **езиците** са BCP 47 тагове (`en`, `bg-Latn`, `yue-Latn`, `zh-Hant`).

## 2. Таблици

### Личности и имена

| Таблица | Предназначение и важни колони |
|---|---|
| `person` | Една личност е един възел в графа. `kind` (`living`, `historical`), `life_status` (`living`, `deceased`, `unknown`), `stewardship` (`self` — профилът е поет от самия човек; `platform` — исторически запис, поддържан от архивистите; `unclaimed` — жив човек без акаунт), **`visibility`** (`involved_only` по подразбиране, `public`), `claimed_by_user_id` (уникален), `created_by_user_id`, `country_code`, `birth_date`, `deleted_at`. `stewardship = 'self'` изисква `claimed_by_user_id` |
| `person_name` | Всички изписвания на името (план §5.3). `kind` (`name`, `alias`, `romanization`), `value`, `script`, `lang`, `romanization` (`jyutping`, `pinyin`, `yale`, `hk_gov`, `bg_streamlined`), `is_primary`, `sort_order`. Всяка личност има точно едно основно име (`is_primary`), и то е на латиница (`script = 'Latn'`, `kind = 'name'`); останалите са по желание: оригиналната писменост, Jyutping, пинин, псевдоними |
| `person_name_key` | Нормализирани ключове за търсене (M07): `key`, `key_kind` (`latin`, `jyutping`, `pinyin`, `han`, `cyrillic`), `is_primary`. В M01 остава празна; GIN `gin_trgm_ops` и B-tree `text_pattern_ops` върху `key` |
| `person_bio` | Биография на даден език: една на личност и език (`person_id`, `lang`) |
| `person_claim` | Заявка „това съм аз“: `user_id`, `status` (`pending`, `approved`, `rejected`, `withdrawn`), `message`, `review_case_id`, кой и кога е решил (`decided_by_user_id`, `decided_at`). Най-много една чакаща заявка от един потребител за една личност; няколко души могат да заявят една и съща личност и прегледът решава |
| `invitation` | Покана към жив учител без акаунт (статус `awaiting_claim`, план §6.7): `email`, `token_hash` (SHA-256 на токена в hex; самият токен не се пази), `status` (`pending`, `accepted`, `expired`, `revoked`), `expires_at`, `relationship_id` |

### Линии и връзки

| Таблица | Предназначение и важни колони |
|---|---|
| `lineage` | Линия (стил, клон): `slug`, `name`, `description`, `root_person_id` — може да е празен (DEFAULT D22) |
| `teaching_relationship` | Ребро учител → ученик в една линия: `teacher_person_id`, `student_person_id`, `lineage_id` (задължителен), `status` (8-те статуса от план §6.7: `pending_teacher`, `awaiting_claim`, `under_review`, `verified`, `rejected`, `withdrawn`, `in_arbitration`, `revoked`), `verification_path` (`teacher_approval`, `committee_review`), `is_display_primary`, `visibility`, `requested_by_user_id`, `confirmed_by_user_id`, `confirmed_at`, `status_reason`. Ребрата не се трият физически: приключилото обучение става историческо чрез `training_period` |
| `training_period` | Периоди на обучение по връзка (прекъсване = два периода): `starts_on`, `ends_on`, `precision` (`year`, `month`, `day`, `unknown`), `ongoing`, `sort_order`. Текущ период няма крайна дата; краят не е преди началото |
| `relationship_event` | Пълната история на статусите на всяка връзка: `from_status`, `to_status`, `actor_user_id`, `actor_role`, `reason`. Само за добавяне за `app_rw`; външният ключ към връзката е `ON DELETE RESTRICT`, така че историята не може да изчезне чрез каскада |
| `lineage_membership` | Кой към коя линия принадлежи и на каква дълбочина (`lineage_id`, `person_id`, `depth`, `computed_at`). Попълва се от фонова задача (M11), която чете само `v_public_edge`; в M01 е празна |

### Школи и география

| Таблица | Предназначение и важни колони |
|---|---|
| `place` | Справочник на градовете от GeoNames (лиценз CC BY 4.0): `geonames_id` (уникален), `name`, `ascii_name`, `country_code`, `admin1_code`, `feature_code`, `population`, `timezone`, **`centroid`** |
| `school` | Школа: `slug`, `name`, `place_id`, `location_privacy` (`exact`, `city_only`; по подразбиране `city_only`), **`public_point`** (точната точка при `exact`, центроидът на града при `city_only`), `status` (`draft`, `published`, `hidden`, `archived`), `description`, `website_url`, `last_activity_at` (DEFAULT D17), `created_by_user_id`, `deleted_at` |
| `school_private_location` | Точното място и адресът на школата (`school_id`, **`exact_point`**, `address_line`). Отделна таблица, до която `app_public_ro` няма никакъв достъп |
| `school_instructor` | Инструкторите на школата: `school_id`, `person_id`, `role` (`head_instructor`, `instructor`, `assistant`) |

Трите колони `place.centroid`, `school.public_point` и `school_private_location.exact_point` са `geography(Point,4326)` (`customType` в `src/server/db/schema/geography.ts`), всяка с GiST индекс. Върху `geography` `ST_DWithin(…, 50000)` мери в метри; върху `geometry(Point,4326)` би мерил в градуси. Приложението подава точките като `{ lng, lat }` (първо дължина, както в GeoJSON и PostGIS).

### Доказателства и модерация

| Таблица | Предназначение и важни колони |
|---|---|
| `evidence_file` | Файл с доказателство в частния бъкет (DEFAULT D13): `storage_key` (уникален), `sha256` (хеш на съхранения обект), `original_sha256` (хеш на качения оригинал, когато изображението е прекодирано), `mime`, `size_bytes` (до 20 MB, DEFAULT D25), `scan_status` (`pending`, `clean`, `rejected`), `retention_until`, `uploaded_by_user_id`, `deleted_at` |
| `evidence_link` | Към какво се отнася доказателството: точно едно от `review_case_id`, `relationship_id`, `person_id`; `note` |
| `review_case` | Случай за преглед: `kind` (`historical_claim`, `person_claim`, `instructor_verification`, `relationship_dispute`, `profile_report`, `school_listing`, `deletion_request`), `status` (`open`, `in_review`, `needs_info`, `resolved`, `dismissed`), обект (`relationship_id`, `person_id`, `school_id`), `assigned_to_user_id`, `resolution` (`approved`, `rejected`), `resolution_reason`, `resolved_at` |
| `review_note` | Бележки по случая; `is_internal` (по подразбиране вътрешна, видима само за екипа) |
| `content_report` | Сигнал за съдържание: `subject_type` (`person`, `teaching_relationship`, `school`, `person_name`), `subject_id`, `reason` (`incorrect`, `impersonation`, `privacy`, `offensive`, `other`), `status`, `review_case_id` |

### Организации и права

| Таблица | Предназначение и важни колони |
|---|---|
| `organization` | Скелет за федерации и асоциации (DEFAULT D12): `slug`, `name`, `kind` (`federation`, `association`, `school_group`), `status` (`pending`, `active`, `suspended`), `country_code`, `website_url` |
| `organization_membership` | Членство на личност в организация: `role` (`leader`, `admin`, `member`), `starts_on`, `ends_on`. Отделно е от историята на обучение и не я променя |
| `entitlement_grant` | Право на план (M08): точно един получател (`subject_user_id` или `subject_organization_id`), `plan_code` (`free_student`, `premium_student`, `free_sifu`, `pro_sifu`, `federation`), `source` (`test_grant`, `complimentary`, `stripe`), `starts_at`, `ends_at`, задължителна `reason`, отмяна с `revoked_at`, `revoked_by_user_id` и `revoke_reason` |

### Съгласия, известия и одит

| Таблица | Предназначение и важни колони |
|---|---|
| `consent_record` | Дадено или оттеглено съгласие: `user_id`, `kind` (`terms`, `privacy`, `age_18_plus`, `publication`), `document_version`, `action` (`granted`, `withdrawn`), `occurred_at` |
| `notification` | Известия в таблото: `user_id`, `template` (текстовете са в `src/server/templates/`), `payload`, `read_at` |
| `email_delivery` | Един ред на имейл: `to_email`, `template`, `idempotency_key` (уникален), `status` (`queued`, `sent`, `failed`), `provider_message_id`, `error`, `sent_at` |
| `audit_log` | Одитен журнал само за добавяне (раздел 6) |

Таблиците на Better Auth (M02), схемата на pg-boss (M01b) и `media_asset` (Фаза 2) не са част от M01.

## 3. Публични изгледи

Анонимното четене минава само през три изгледа. И трите са `security_barrier`, така че филтрите им се прилагат преди условията от заявката.

| Изглед | Съдържа | Колони |
|---|---|---|
| `v_public_person` | Само `visibility = 'public'` и без изтритите | `id`, `slug`, `kind`, `life_status`, `stewardship`, `country_code`, `display_name` (основното име), `alt_names` (JSON масив с останалите имена: `value`, `script`, `lang`, `kind`, `romanization`), `bio` (на английски, иначе първата по език), `created_at`, `updated_at`. Без `birth_date`, без потребителски идентификатори |
| `v_public_edge` | Само `status` `verified` или `in_arbitration` с `visibility = 'public'`, между двама публични и неизтрити души, в неизтрита линия | `id`, `teacher_person_id`, `student_person_id`, `lineage_id`, `status`, `verification_path`, `is_display_primary`, `visibility`, `confirmed_at`, `periods` (JSON: `startsOn`, `endsOn`, `precision`, `ongoing`), `created_at`, `updated_at` |
| `v_public_school` | Само `status = 'published'` и без изтритите | `id`, `slug`, `name`, `location_privacy`, `precision` (`exact` или `city`), `public_point` (при `city_only` винаги центроидът на града от `place`, независимо какво пише в `school.public_point`), `place_id`, `city_name`, `country_code`, `description`, `website_url`, `last_activity_at`, `instructor_person_ids` (само публичните инструктори), `created_at`, `updated_at` |

Чакащите заявки, отказаните, оттеглените и отменените връзки, хората без публична връзка (например `demo-claim-only-teacher`), точните координати, адресите, доказателствата и одитът не са достъпни за публичната роля по никакъв път.

## 4. Роли и права

Ролите не се създават в миграциите: това изисква `CREATEROLE` и би сложило пароли в хранилището. Създава ги `scripts/db-bootstrap.sql` (обвивка `scripts/db-bootstrap.sh`), пуснат от суперпотребител веднъж за всяка среда и за всяка база, с пароли от средата (`DB_MIGRATOR_PASSWORD`, `DB_APP_RW_PASSWORD`, `DB_APP_PUBLIC_RO_PASSWORD`). Паролите стигат до psql чрез `\getenv`, никога през командния ред, а записът в лога на сървъра е изключен за тази сесия. Скриптът още прави `migrator` собственик на базата и създава PostGIS (то не е „trusted“ разширение и иска суперпотребител). Миграциите съдържат само `GRANT` и `REVOKE`.

| Роля | Права |
|---|---|
| `migrator` | Собственик на базата и на всеки обект на приложението. `pnpm db:migrate` и `pnpm db:seed` работят като `migrator` (`SET ROLE migrator`), независимо кой се свързва, затова собственикът е един и същ навсякъде. Създава разширенията `pg_trgm`, `unaccent` и `fuzzystrmatch` (trusted) |
| `app_rw` | Услугите и worker-ът. `SELECT`, `INSERT`, `UPDATE`, `DELETE` върху таблиците на приложението; върху `audit_log` и `relationship_event` само `SELECT` и `INSERT`; `SELECT` върху трите изгледа. Няма `CREATE` в схемата и в базата |
| `app_public_ro` | Анонимното четене: само `SELECT` върху `v_public_person`, `v_public_edge` и `v_public_school`. Всяка таблица, включително `school_private_location`, `evidence_file` и `evidence_link`, дава `permission denied` |

Приложението се свързва като `app_rw` (`getDb()`) и като `app_public_ro` (`getPublicDb()`) от `src/server/db/index.ts`, с отделен пул за всяка роля и `statement_timeout` 2 s, към хоста и базата от `DATABASE_URL` (в облачната сесия и в CI: `TEST_DATABASE_URL`).

## 5. Ограничения и индекси

- `CHECK (teacher_person_id <> student_person_id)` (`teaching_relationship_not_self`).
- Частичен уникален индекс `teaching_relationship_active_key` върху `(teacher_person_id, student_person_id, lineage_id)` за активните статуси (`pending_teacher`, `awaiting_claim`, `under_review`, `verified`, `in_arbitration`): дублирана активна връзка се отказва, а нова заявка след отказ, оттегляне или отмяна е позволена.
- `teaching_relationship_one_display_primary_key`: най-много една активна връзка с `is_display_primary` на ученик (DEFAULT D05).
- `teaching_relationship_public_only_after_verification`: `visibility = 'public'` само при `verified`, `in_arbitration` или `revoked` (DEFAULT D03).
- Покриващи индекси `(student_person_id) INCLUDE (teacher_person_id, status, lineage_id)` и `(teacher_person_id) INCLUDE (student_person_id, status, lineage_id)` за рекурсивните заявки от план §6.3 (в отделна миграция, защото Drizzle не поддържа `INCLUDE`).
- `person_name_key.key`: GIN `gin_trgm_ops` (триграмна прилика) и B-tree `text_pattern_ops` (префикс).
- GiST върху трите `geography` колони.
- Уникални: `slug` в четирите таблици със slug; `place.geonames_id`; `invitation.token_hash`; `evidence_file.storage_key`; `email_delivery.idempotency_key`; една основна `person_name` на личност; една `person_bio` на личност и език; една чакаща `person_claim` от потребител за личност; една личност на потребител (`person.claimed_by_user_id`).
- Формати: `slug`, двубуквени държави, ISO 15924 писмености, BCP 47 езици, SHA-256 в hex (`evidence_file`, `invitation`), `ip_hmac` (64 hex знака), действията в одита (`обект.действие`, например `relationship.verify`).
- Личности, линии и връзки по правило не се трият физически: скриват се (`deleted_at`) или връзката сменя статуса си и приключва. Базата го подкрепя: `teaching_relationship` държи личностите и линията с `ON DELETE RESTRICT`, а `relationship_event` държи връзката с `ON DELETE RESTRICT` (каскадните действия вървят с правата на собственика на таблицата и биха заобиколили правилото „само добавяне“). Имената, биографиите, заявките, поканите, периодите и членствата се трият заедно със своята личност или връзка (`CASCADE`), а препратките от случаите за преглед стават `NULL`.
- Циклите в графа не се проверяват от база данни: проверката е в услугата при преход към `verified`, под глобален advisory lock (план §6.3, M04).

## 6. Одитен журнал

`audit_log` е само за добавяне (план §6.6):

- `app_rw` има само `SELECT` и `INSERT` (`REVOKE UPDATE, DELETE, TRUNCATE`);
- тригерите `audit_log_no_update_delete` (`BEFORE UPDATE OR DELETE`, за всеки ред) и `audit_log_no_truncate` (`BEFORE TRUNCATE`) отказват промяна за всяка роля, включително собственика, с грешка `audit_log is append-only: <операция> is not allowed`;
- колони: `occurred_at`, `actor_user_id`, `actor_role`, `action`, `subject_type`, `subject_id`, `request_id`, **`ip_hmac`**, `before`, `after`, `reason`, `evidence_ids`, по желание `prev_hash` и `hash` (верига от хешове против подправяне).

`relationship_event` също е само за добавяне за `app_rw`: няма `UPDATE` и `DELETE`, а външният ключ `ON DELETE RESTRICT` не позволява изтриване на връзка с история. Тригер няма: собственикът (`migrator`) може да поправя данни с миграция.

### `ip_hmac`

`ip_hmac = HMAC-SHA-256(таен ключ, IP адрес)` в hex. Ключът е в средата на сървъра (от M02), не е в базата и се сменя веднъж годишно. Обикновен SHA-256 на IPv4 адрес се обръща с изброяване на 2^32 стойности, затова се ползва ключ. **`ip_hmac` са лични данни** (псевдонимизиран IP адрес): с ключа всеки известен IP адрес може да се сравни с журнала.

## 7. Лични данни и срокове на пазене

Сроковете са решение по подразбиране за пилота и се потвърждават при правния преглед (план §10.2, ред 11); черновата на политиката за поверителност ги повтаря.

| Данни | Къде | Срок на пазене |
|---|---|---|
| `ip_hmac` | `audit_log` | **Свързваемостта се пази до 13 месеца.** Ключът се сменя на всеки 12 месеца, а старият се унищожава до един месец след смяната. След това старите стойности не могат да се свържат с IP адрес и престават да са лични данни. Редовете не се трият (журналът е само за добавяне), затова срокът се постига чрез унищожаване на ключа. Новата стойност на ключа не се извежда от старата |
| Имена, биография, държава, дата на раждане | `person`, `person_name`, `person_bio` | Докато профилът съществува. При заявка за изтриване (`review_case.kind = 'deletion_request'`) личните полета се премахват или профилът се скрива (`deleted_at`), а връзките остават в графа като анонимни, ако други потребители зависят от тях (M10b) |
| Имейл в поканата | `invitation.email` | До приемане, изтичане или отмяна на поканата плюс 30 дни; после се заличава (задача в M01b) |
| Имейл на получателя | `email_delivery.to_email` | 90 дни (отстраняване на проблеми с доставката); после се заличава (M01b) |
| Точна точка и адрес на школа | `school_private_location` | Докато школата съществува; никога в публичен отговор, лог, sitemap, Open Graph или JSON-LD |
| Доказателства | `evidence_file` и частният бъкет | До `retention_until`, определен при решаването на случая (M10a) |
| Одитни записи (без `ip_hmac`) | `audit_log` | Без срок: доказателство за всяко одобрение и архивна промяна (план §6.6) |

Логовете на приложението не съдържат имена, имейли, IP адреси и координати (план §6.4, M12).

## 8. Миграции и команди

| Команда | Действие |
|---|---|
| `scripts/db-bootstrap.sh` | Роли, пароли, собственик на базата и PostGIS за базите от `DATABASE_URL` и `TEST_DATABASE_URL` (или подадените адреси). Веднъж за всяка среда и след създаване на нова база; `scripts/verify.sh` и `scripts/cloud-setup.sh` го пускат сами за тестовата база |
| `pnpm db:generate` | `drizzle-kit generate`: нова миграция от промяна в схемата. SQL, който Drizzle не изразява (изгледи, права, тригери, `INCLUDE`), е в миграция, създадена с `pnpm db:generate --custom --name <име>` |
| `pnpm db:migrate` | Прилага чакащите миграции като `migrator` върху `DATABASE_URL` (или `TEST_DATABASE_URL`, ако `DATABASE_URL` не е зададен). Всички чакащи миграции вървят в една транзакция |
| `pnpm db:seed` | Изпразва таблиците на приложението (без `audit_log`) и зарежда фиктивните данни; отпечатва броя редове и хеша на съдържанието. Отказва при `NODE_ENV=production` |
| `pnpm db:reset` | Трие всички обекти на приложението (схемите `public` и `drizzle`) и възстановява празната база с PostGIS. Само за локален хост или `TEST_DATABASE_URL`, никога при `NODE_ENV=production`, и само като суперпотребител. След него: `pnpm db:migrate && pnpm db:seed` |
| `pnpm db:check` | `drizzle-kit check` (конфликти между миграции от паралелни клонове), проверка, че схемата няма промени без миграция, и прилагане на всички миграции в нова празна база (два пъти: вторият път не прилага нищо) |
| `pnpm test:int` | Интеграционните тестове `src/server/db/*.int.test.ts`: всеки файл създава своя база, прилага bootstrap и миграциите, и я трие накрая. Срещу `TEST_DATABASE_URL`, а без него — Testcontainers с образа `postgis/postgis:18-3.6` по digest (нужен е Docker) |
| `pnpm fixtures:generate` | Записва `fixtures/lineage-600.json` от генератора |

Миграциите в M01:

1. `*_extensions`: `postgis`, `pg_trgm`, `unaccent`, `fuzzystrmatch` (`CREATE EXTENSION IF NOT EXISTS`).
2. `*_schema`: таблиците, ограниченията и индексите, генерирани от схемата.
3. `*_roles_views_audit`: покриващите индекси, трите изгледа, тригерите на `audit_log` и правата (само `GRANT` и `REVOKE`).
4. `*_relationship_event_keep_history`: `ON DELETE RESTRICT` вместо `CASCADE` за `relationship_event` → `teaching_relationship`.

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

`pnpm db:seed` не създава потребители, права, съгласия и доказателства: в M01 няма акаунти (те идват с M02).

## 10. Решения по подразбиране

| Решение | Как е приложено |
|---|---|
| DEFAULT D03 | Чакащите заявки и личностите, създадени чрез заявка или покана, са `involved_only`; връзка става `public` само след `verified` (`CHECK` в базата); изгледите показват само публичното |
| DEFAULT D05 | Всички активни връзки се пазят; `is_display_primary` е само визуално предпочитание, най-много една на ученик |
| DEFAULT D12 | `organization` и `organization_membership` са само скелет; членството не променя историята на обучение |
| DEFAULT D13 | Доказателствата са в отделна таблица и частен бъкет; публичната роля няма достъп до `evidence_file` и `evidence_link` |
| DEFAULT D17 | `school.last_activity_at` се обновява само при редакция или потвърждение на школата, никога при вход |
| DEFAULT D20 | Само явно измислени данни със slug `demo-…` |
| DEFAULT D22 | `lineage.root_person_id` може да е празен; коренът може да е исторически (`demo-root-c`) |
| DEFAULT D25 | `evidence_file.size_bytes` е до 20 MB |

Решенията без номер D (например текст с `CHECK` вместо `enum` и сроковете на пазене от раздел 7) са в [ADR 0002](adr/0002-data-model.md).
