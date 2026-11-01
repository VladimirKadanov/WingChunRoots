# Архив и възстановяване

Етап M12 (план §3.1 „Архиви“, §3.3, §10.1 D24). Във Фаза 1 архивът е локален: `pg_dump` на вашия компютър, без облачни услуги. Учението по възстановяване доказва, че архивът наистина се възстановява и че данните в него са цели, и мери колко време отнема.

## Какво влиза в архива

- Цялата база: личностите, родословията и връзките, акаунтите и сесиите (таблиците на Better Auth), одитът, доказателствата като записи (`evidence_file`), поканите, поемането на профил, сигналите и историята на прегледа (M10b), школите с точните им места (`school_private_location`, M11), опашката на задачите (`pgboss`) и историята на миграциите.
- С `--objects`: и самите файлове на доказателствата от SeaweedFS (или от частната папка `.storage/evidence`), копирани в `backups/objects/`.
- Не влизат: `.env` (пазете го отделно и на сигурно място: без него паролите на ролите и ключовете не съвпадат), писмата в Mailpit, логовете.

Архивите съдържат лични данни. Пазят се само в `backups/` (извън git), с права само за собственика (`0600`), и не се изпращат никъде.

## Архив: `scripts/backup-local.sh`

```bash
scripts/backup-local.sh                    # базата на DATABASE_URL (wingchunroots)
scripts/backup-local.sh --objects          # и файловете на доказателствата
scripts/backup-local.sh --test-database    # базата на TEST_DATABASE_URL
```

Скриптът пише в `backups/`:

| Файл | Съдържание |
|---|---|
| `wingchunroots-20261101T020000Z.dump` | `pg_dump -Fc` на цялата база; името носи датата и часа в UTC |
| `….dump.sha256` | SHA-256 на архива (`sha256sum -c` го чете) |
| `….dump.lineage` | Броят и отпечатъкът на пътищата до предците сред потвърдените ребра в момента на архива; учението ги сравнява |
| `objects/wingchunroots-20261101T020000Z/` | С `--objects`: файловете на доказателствата |

Пазят се последните 14 архива на всяка база (`BACKUP_KEEP`); по-старите се трият заедно с файловете си. `BACKUP_DIR` в `.env` сменя папката: абсолютен път или път спрямо папката на хранилището (без `~`). Compose монтира в `web` същата папка (`${BACKUP_DIR:-./backups}` на `/backups`, само за четене), затова `/admin/system` вижда архивите и когато са другаде; след промяна на `BACKUP_DIR` пуснете профила наново (`docker compose --profile app up -d`).

`pg_dump` трябва да е от основната версия на сървъра (`pg_dump` 16 отказва PostgreSQL 18). Затова локално скриптът го пуска **в контейнера на базата** (`docker exec` в услугата `postgres` на Compose или в контейнера от `PG_CONTAINER`), а в облачната сесия от PostgreSQL 16 на `PATH`. Ако версиите не съвпадат, скриптът спира с обяснение.

### Колко често

Колкото данни сте готови да загубите. До хостинга **RPO е до последния архив** (`DEFAULT D24`): всичко след него може да се загуби. Препоръка за пилота: архив всеки ден, в който е имало промени, и винаги преди обновяване. Скриптът може да се пусне по график, например с cron в WSL2:

```bash
crontab -e
# всеки ден в 02:00, с файловете на доказателствата
0 2 * * * cd ~/src/wingchunroots && scripts/backup-local.sh --objects >> backups/backup.log 2>&1
```

(WSL2 пуска cron само докато дистрибуцията работи.) `/admin/system` показва времето на последния архив и предупреждава, ако архив няма или файлът `.sha256` липсва.

## Учение по възстановяване: `scripts/restore-drill.sh`

```bash
scripts/restore-drill.sh                       # последният архив на wingchunroots
scripts/restore-drill.sh backups/<файл>.dump   # конкретен архив
```

Учението никога не пипа истинската база. То:

1. сверява SHA-256 на архива с файла `.sha256`;
2. възстановява във **временна база**: локално във временен контейнер `postgis/postgis:18-3.6` (по digest), в облачната сесия и в CI в отделна база на същия сървър; после я маха;
3. мери времето на възстановяването и **пада, ако то надхвърли RTO от 4 часа** (`DEFAULT D24`; `RESTORE_RTO_SECONDS` го сменя);
   Ако `pg_restore` спре с грешка, учението показва само редовете с грешката, без `DETAIL` и `CONTEXT` и с цитираните стойности заменени с `…`, защото те могат да съдържат данни от редовете. Пълният лог на `pg_restore` е във временен файл, четим само от собственика (`mktemp`, `umask 077`), и се трие при изход.
4. проверява възстановеното копие:
   - `amcheck`: всеки B-tree индекс (`bt_index_check` с проверка срещу таблицата) и всяка таблица (`verify_heapam`);
   - броят на редовете на всяка таблица е като в архива;
   - всички външни ключове от архива са налице и валидирани, и нито един ред не сочи в нищото;
   - сред потвърдените ребра няма човек, който е учител на себе си, и няма цикъл;
   - пътищата до предците са същите като в момента на архива (`.lineage`);
   - извадка до 20 файла на доказателства има SHA-256, равен на `evidence_file.sha256` (от копието в `objects/`, ако го има, иначе от хранилището);
   - таблиците на Better Auth (`auth_user`, `auth_session`, `auth_account`, `auth_verification`, `auth_two_factor`, `auth_throttle`) са налице;
   - частните таблици са налице: `evidence_file`, `evidence_link`, `invitation`, `person_claim`, `content_report`, `review_case`, `review_event`, `review_note`, `school_private_location`, `audit_log` (броят на редовете им вече е сверен по-горе; тази проверка хваща таблица, която изобщо липсва в архива).

Изходът завършва с ред като:

```text
restore-drill: restore took 1.3s (RTO 14400s, DEFAULT D24)
...
RESTORE DRILL: PASS — wingchunroots-20261101T020000Z.dump restored in 1.3s (RTO 14400s, DEFAULT D24); 47 tables, 12056 rows, 66 foreign keys, 659 verified edges
```

При проблем скриптът спира с `restore-drill: FAIL <причина>` и код 1.

Учението върви автоматично:

- всяка седмица и при всеки PR, който променя `scripts/backup-local.sh`, `scripts/restore-drill.sh` или `drizzle/`, в GitHub Actions (`.github/workflows/restore-drill.yml`, PostgreSQL 18 като service контейнер, без тайни);
- в `scripts/verify.sh M12` и `scripts/verify.sh all` срещу тестовата база; редът `RESTORE DRILL: PASS …` с времето е в обобщението.

Пускайте го и на ръка след всяко обновяване на PostgreSQL или на образа на базата.

## Истинско възстановяване

Само когато базата е загубена или повредена. Учението трябва да е минало с архива, който ще ползвате.

```bash
# 1. Спрете приложението (базата остава да върви)
docker compose --profile app stop web worker
# 2. Нова празна база на мястото на старата
docker compose exec -T postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE IF EXISTS wingchunroots WITH (FORCE)' \
  -c "CREATE DATABASE wingchunroots TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C.UTF-8'"
# 3. Възстановяване от архива с pg_restore на сървъра
docker cp backups/wingchunroots-20261101T020000Z.dump "$(docker compose ps -q postgres)":/tmp/restore.dump
docker compose exec -T postgres pg_restore -U postgres -d wingchunroots --exit-on-error /tmp/restore.dump
docker compose exec -T postgres rm /tmp/restore.dump
# 4. Ролите и правата на базата, после приложението
docker compose --profile app up -d
```

Ако и файловете на доказателствата са загубени (например томът на SeaweedFS), върнете ги от копието на същия архив:

```bash
docker compose exec -T postgres psql -U postgres -d wingchunroots -X -q -t -A \
  -c "SELECT storage_key || '|' || mime || '|' || sha256 FROM evidence_file WHERE deleted_at IS NULL" |
  pnpm exec tsx scripts/ops/evidence-objects.ts restore --objects backups/objects/wingchunroots-20261101T020000Z
```

След това влезте като администратор и проверете `/admin/system` и няколко страници на личности. Запишете кога и защо е направено възстановяването (`docs/operations/incident.md`).

## Какво се променя с хостинга

Хостингът е отложен (план §3.3). Когато собственикът го реши:

- локалният `pg_dump` се заменя с непрекъснат архив (pgBackRest към обектно хранилище) и второ криптирано копие (`age`) при друг доставчик;
- целта за реалната среда е RPO около 1–5 минути и RTO до 4 часа (`DEFAULT D24`), доказани с учение в новата среда;
- учението остава седмично, срещу копие на истинския архив;
- наличността се следи отвън (например Healthchecks), а `reportError` получава доставчик на грешки.
