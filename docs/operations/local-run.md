# Локално пускане като в production

Етап M12 (план §3.3, §7.6). WingChunRoots върви от един Docker образ (`Dockerfile`) с Docker Compose, профил `app`: същият образ и същите стъпки, които CI проверява при всеки PR (задачата `image`). Хостингът е отложен: образът не се публикува никъде и нищо не напуска компютъра.

За разработка (`pnpm dev`) виж [ръководството за администратора](../guides/admin-guide.bg.md), раздел 2. Тук е пускането „като в production“: сборка на Next.js (standalone сървър), `NODE_ENV=production`, worker и миграции в контейнери.

## Какво се пуска

| Услуга | Какво прави | Остава ли да върви |
|---|---|---|
| `postgres` | PostgreSQL 18 + PostGIS 3.6 | да |
| `mailpit` | Пощенска кутия за проба на <http://localhost:8025> | да |
| `seaweedfs` | Частното хранилище на доказателствата (S3) | да |
| `db-bootstrap` | Ролите `migrator`, `app_rw`, `app_public_ro` с паролите от `.env`, собственикът на базата и PostGIS | не: свършва и спира |
| `migrate` | Миграциите и схемата на опашката, като `migrator` | не: свършва и спира |
| `web` | Сайтът на <http://localhost:3000> (една реплика) | да |
| `worker` | Писмата, изтриването на стари адреси, ключовете за търсене, броячите на родословието | да |

Всички портове слушат само на `127.0.0.1`. Приложението ползва базата `wingchunroots`, същата като `pnpm dev`: не пускайте двете едновременно.

## Изисквания

### Windows: Docker Desktop и WSL2 (основният път)

- Windows 10 или 11, WSL2 с Ubuntu 24.04 и [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) с WSL2 backend (*Settings → Resources → WSL integration*: включена дистрибуция; около 8 GB памет за Docker).
- Хранилището е във файловата система на WSL2 (например `~/src/wingchunroots`), не под `C:\`. Командите се пускат от терминала на Ubuntu.
- За демо данните, архива и учението: Node 26.12.1 и pnpm 12.14.0, както в раздел 2 на ръководството за администратора.

На Windows без WSL2 (Git Bash) същите команди работят; там Docker Desktop върви с Hyper-V backend, а хранилището е на диска на Windows (по-бавно). Окончанията на редовете остават LF (`.gitattributes`), така че скриптовете в контейнерите работят.

### Linux

Docker Engine 24 или по-нов с приставката `docker compose` (v2), Node 26.12.1 и pnpm 12.14.0. Потребителят ви е в групата `docker` (или командите вървят със `sudo`).

### macOS

Docker Desktop (на Apple Silicon образът на базата `postgis/postgis` е само `linux/amd64` и върви с емулация: по-бавно, но работи), Node 26.12.1 и pnpm 12.14.0.

## Първо пускане

```bash
git clone https://github.com/VladimirKadanov/WingChunRoots.git ~/src/wingchunroots
cd ~/src/wingchunroots
scripts/init-env.sh                    # .env с локални пароли и ключове (само веднъж)
scripts/check-env.sh compose           # всички настройки са попълнени и нито една не е примерна
docker compose --profile app up --build
```

Първата сборка отнема няколко минути. Когато в изхода се появи `worker: ready`, отворете <http://localhost:3000>. `Ctrl+C` спира всичко.

Във фонов режим:

```bash
docker compose --profile app up --build -d
docker compose --profile app ps        # web трябва да е "healthy"; db-bootstrap и migrate са "exited (0)"
curl http://localhost:3000/healthz     # {"ok":true}
```

### Демо данни

Образът върви с `NODE_ENV=production`, а `pnpm db:seed` никога не върви в production, затова измислените демо данни се зареждат от хоста (веднъж, след като `migrate` е свършил):

```bash
pnpm install
pnpm db:seed
```

Worker-ът в контейнера после записва ключовете за търсене. Демо акаунтите влизат с паролата от `E2E_PASSWORD` в `.env`; персоналът и с втория фактор (раздел 2 на ръководството за администратора).

## Настройките

`docker-compose.yml` чете `.env` (от `scripts/init-env.sh`). Всеки контейнер на приложението пуска `scripts/check-env.sh` преди процеса: при липсваща настройка, стойност като примерната от `.env.example` или заместител като `changeme` той спира с имената на настройките (никога със стойностите), например:

```text
check-env: web: refusing to start.
  missing or empty: BETTER_AUTH_SECRET
```

Тогава допълнете `.env` (`scripts/init-env.sh` добавя липсващите стойности) и пуснете отново. Полезни настройки:

| Настройка | По подразбиране | Значение |
|---|---|---|
| `APP_PORT` | `3000` | Портът на хоста. Сменяте ли го, сменете и `APP_URL` (например `http://localhost:3001`) |
| `APP_URL` | `http://localhost:3000` | Адресът в браузъра: връзките в писмата и доверения произход на API |
| `LOG_LEVEL` | `info` | `debug` за повече редове, `warn` за по-малко |

## Логовете

Всеки ред е JSON: `level`, `time`, `service` (`web` или `worker`), `msg` и при заявка `requestId`. Имейл адреси, имена, IP адреси и координати не се записват.

```bash
docker compose --profile app logs -f web worker
docker compose --profile app logs web | grep '"level":"error"'
```

`requestId` е същият номер, който одитът записва за заявката (`audit_log.request_id`); когато proxy пред приложението изпраща заглавка `X-Request-Id`, номерът идва от нея. Така един ред в лога се свързва с одита и с проверка на сигнал.

## Състоянието

- `http://localhost:3000/healthz` отговаря само с `{"ok":true}` (код 200) или `{"ok":false}` (код 503). Коя проверка е паднала (базата или опашката) е в лога на `web`.
- `/admin/system` (персонал с проверен втори фактор) показва опашката, неуспешните задачи, неуспешните писма и времето на последния архив (раздел 18 на ръководството за администратора).

## Обновяване

```bash
git pull
scripts/check-env.sh compose
docker compose --profile app up --build -d
```

`db-bootstrap` и `migrate` вървят наново при всяко пускане (безопасно е: правят само липсващото), после `web` и `worker` тръгват с новия образ. Преди обновяване направете архив (`scripts/backup-local.sh`, [backup-and-restore.md](backup-and-restore.md)).

## Спиране

```bash
docker compose --profile app stop      # спира, контейнерите остават
docker compose --profile app down      # спира и маха контейнерите; данните остават в томовете
```

`docker compose --profile app down -v` трие и томовете: базата и файловете в SeaweedFS изчезват. Правете го само с архив, който сте възстановили успешно поне веднъж.

## Когато нещо не тръгва

| Признак | Какво да направите |
|---|---|
| `check-env: ... refusing to start` | Допълнете назованите настройки в `.env` |
| `migrate` е `exited (1)` | `docker compose --profile app logs migrate`; обикновено базата не е готова или паролата на `migrator` в `.env` не съвпада с тази при първото пускане на тома |
| `web` не става `healthy` | `curl -i http://localhost:3000/healthz` и `docker compose --profile app logs web`; при `{"ok":false}` логът казва дали е базата или опашката |
| Портът 3000 е зает (например от `pnpm dev`) | Спрете другия процес или задайте `APP_PORT` и `APP_URL` |
| `/admin/system` казва, че архив няма, а има | Архивът е за друга база или в друга папка: `web` чете `backups/` на хоста |
| `backups/` е собственост на root (Linux) | `sudo chown "$USER" backups`; папката идва с хранилището, за да не я създаде Docker |
