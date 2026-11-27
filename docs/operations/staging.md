# Тестов сървър със защита с парола (staging)

Решение на собственика от 17.11.2026 ([ADR 0033](../adr/0033-staging.md)): един сървър Hetzner CX23 (2 vCPU, 4 GB, 40 GB, Хелзинки; създаден на 18.11.2026, Ubuntu 26.04) за оценка на системата. Без домейн, без изходяща поща, без плащания и без вход със социални мрежи. Целият сайт е зад една обща парола. Работи на два етапа:

1. **Етап 1, демо данни.** Измислените демо данни и по един акаунт от всеки вид. Администраторът ги разглежда, дава обратна връзка и правим промени.
2. **Етап 2, чиста база.** Всичко се изтрива. Остават само двама истински администратори, които започват да въвеждат историческите учители, корените на линиите. Тези данни вероятно преминават в production, затова от този момент архивите са задължителни.

## Какво работи на сървъра

Същият Docker Compose като локално (профилът `app`, [local-run.md](local-run.md)) и отгоре `deploy/staging/compose.staging.yml`:

| Услуга | Роля |
|---|---|
| `caddy` | HTTPS (Let's Encrypt) и паролата пред всичко освен `/healthz` и `POST /api/billing/webhook` (подписаните събития на Stripe, вижте „Плащания със Stripe в тестов режим“); `noindex` на всеки отговор; единствената услуга, отворена навън (портове 80 и 443) |
| `web`, `worker`, `migrate` | приложението от образа `ghcr.io/vladimirkadanov/wingchunroots:sha-<commit>`; сървърът никога не build-ва |
| `postgres` | PostgreSQL 18 + PostGIS 3.6, томът `wingchunroots_postgres-data` |
| `seaweedfs` | снимките, логата, плакатите и доказателствата, томът `wingchunroots_seaweedfs-data` |
| `mailpit` | всяко писмо остава на сървъра и се чете на `https://mail.<адрес>` зад същата парола |

**Адресът** е `https://<IP с тирета>.sslip.io` (например `https://203-0-113-7.sslip.io`). Услугата sslip.io връща IP адреса от самото име, затова не ни трябва домейн, а Caddy получава истински сертификат.

**Образът** се build-ва в GitHub (`.github/workflows/staging-image.yml`) при всеки commit в `main` и се качва в GitHub Container Registry. Първия път пакетът е частен: в GitHub отворете **Packages → wingchunroots → Package settings → Change visibility → Public** (хранилището е публично, а образът не съдържа тайни). Ако предпочитате пакетът да остане частен, на сървъра влезте веднъж с `docker login ghcr.io` и личен токен с право само `read:packages`.

**Паметта.** Всичко заедно ползва около 1–1,5 GB от 4 GB. Има 2 GB swap за кратките пикове (оразмеряване на качена снимка). Ако сайтът стане бавен: Hetzner Console → сървъра → **Rescale** → CX33 (8 GB), с отметка **CPU and RAM only**. Данните остават, а по-късно може да се върнете обратно.

## Първоначална настройка (веднъж)

### 1. Сървърът в Hetzner

В Hetzner Console създайте сървър: локация в ЕС (CX23 имаше свободни само в Helsinki на 18.11.2026), образ **Ubuntu 26.04** (скриптът работи и на 24.04), тип **CX23** (или CPX22), **SSH key** (публичният ви ключ, например `~/.ssh/id_ed25519.pub`; ако нямате, `ssh-keygen -t ed25519`) и отметка **Backups** (дневни снимки на целия сървър, +20% от цената).

Ключът трябва да е **отметнат във формата при създаването**: Hetzner слага ключове на сървъра само тогава, а Rebuild не позволява избор на ключ. Ако ключът ви има парола (passphrase), отключете го веднъж преди автоматичните стъпки: `eval "$(ssh-agent -a ~/.ssh/agent.sock)"; ssh-add ~/.ssh/id_ed25519`. Иначе `ssh` в неинтерактивен режим връща „Permission denied (publickey)“, макар сървърът да приема ключа. Заключване накрая: `SSH_AUTH_SOCK=~/.ssh/agent.sock ssh-agent -k`.

### 2. Подготовка на сървъра (като root)

```bash
ssh root@<IP>
git clone https://github.com/VladimirKadanov/WingChunRoots.git /root/wcr-setup
bash /root/wcr-setup/deploy/staging/setup-server.sh
```

Скриптът обновява системата, включва автоматичните обновления за сигурност и инсталира Docker, 2 GB swap и защитна стена (само SSH, HTTP и HTTPS). Създава потребителя `deploy` с вашия SSH ключ и изключва входа с парола по SSH. Слага Node и pnpm за командите на оператора и клонира хранилището в `/home/deploy/wingchunroots`.

### 3. Настройките и паролата на сайта (като deploy)

```bash
ssh deploy@<IP>
cd wingchunroots
deploy/staging/staging.sh init
```

`init` създава `.env` с нови случайни пароли и ключове (`scripts/init-env.sh`) и записва адреса. После пита за **потребителско име и парола на сайта** (поне 12 знака). Пази се само bcrypt хешът им в `.staging/auth.caddy`. Накрая пита за **публичния ключ на `age`** за криптиране на архивите. Можете да го пропуснете на етап 1, но на етап 2 е задължителен.

```bash
# на вашия компютър, не на сървъра:
age-keygen -o wcr-age-key.txt   # личният ключ: в мениджъра на пароли и на втори носител
```

**Копие на `.env`** запазете в мениджъра на пароли. Без него архивът не може да се ползва изцяло ([backup-and-restore.md](backup-and-restore.md)).

### 4. Пускане

```bash
deploy/staging/staging.sh deploy            # най-новият commit в main
deploy/staging/staging.sh deploy <commit>   # точно определена версия (образът трябва да е build-нат)
```

`deploy` взема кода и образа на същия commit, пуска миграциите и чака `/healthz`. Сайтът е на адреса от `init`.

## Етап 1: демо данни

```bash
deploy/staging/staging.sh seed-demo
deploy/staging/staging.sh demo-logins   # как се влиза с демо акаунтите
deploy/staging/staging.sh totp-key      # ключът за приложението за удостоверяване на трите акаунта на персонала
```

`seed-demo` зарежда измислените демо данни и включва `WCR_DEMO_SIGN_IN=1`. Без тази настройка демо акаунтите (`demo-…@example.test`) не могат да влязат на публичен адрес. Таблицата с всички акаунти е в [ръководството за администратора](../guides/admin-guide.bg.md), раздел 6, „Демо акаунти“. Паролата на всички е `E2E_PASSWORD` от `.env` (`grep '^E2E_PASSWORD=' .env`).

Писмата (потвърждаване на адрес, известия) се четат на `https://mail.<адрес>`. Всеки тестващ може да си направи и собствен акаунт с истинския си адрес: писмото за потвърждение пак отива в Mailpit, не в пощата му.

`seed-demo` отказва база, в която има данни, които не са ясно демо (защитата от 13.11.2026). Затова не може случайно да изтрие истинските данни на етап 2.

## Етап 2: чиста база с двама администратори

```bash
deploy/staging/staging.sh clean-start
```

Командата пита за `DELETE EVERYTHING`. Първо прави последен архив и го премества заедно със старите в `backups/before-clean-<време>/`. После спира всичко и изтрива томовете на базата и на файловете. Mailpit се изчиства сам при рестарт. Демо входът се изключва. Пуска празна база с всички миграции и зарежда списъка с градовете (`pnpm geo:load`, единствените справочни данни).

После, за всеки от двамата администратори:

1. Регистрация на `https://<адрес>/sign-up` с истинския му имейл.
2. Писмото за потвърждение се отваря на `https://mail.<адрес>`, после връзката в него.
3. Вход и **Account → Security**: включете двуфакторното удостоверяване (TOTP; задължително за персонала).
4. На сървъра: `deploy/staging/staging.sh make-admin <имейл>`. Сесиите на акаунта приключват, затова той влиза отново с паролата и кода.

После включете архивите (по-долу), преди да се въведат първите данни.

Историческите учители, линиите и връзките между тях се въвеждат в **Admin → Archive editor** (`/admin/archive`, M26): първо записите, после линията с корена ѝ, накрая всяка връзка с източника ѝ. Стъпките са в [ръководството за администратора](../guides/admin-guide.bg.md), раздел 35.

## Архиви (задължителни от етап 2)

```bash
deploy/staging/staging.sh backup         # архив сега: базата и всички файлове (scripts/backup-local.sh --objects)
deploy/staging/staging.sh install-cron   # всяка нощ в 02:30 (UTC), лог в backups/backup.log
```

Три нива:

1. **Hetzner Backups**: дневна снимка на целия сървър (отметката при създаване, 7 копия).
2. **Нощният архив** в `backups/` на сървъра, криптиран с `age`, когато `BACKUP_AGE_RECIPIENT` е зададен; пазят се 14.
3. **Копие извън сървъра** (по желание, препоръчително на етап 2): Hetzner Storage Box BX11 (около €4 на месец). В `.env`:

   ```bash
   STAGING_OFFSITE=u123456@u123456.your-storagebox.de:wcr-staging
   STAGING_OFFSITE_PORT=23
   ```

   SSH ключът на `deploy` трябва да е добавен в Storage Box (`ssh-keygen -t ed25519` като deploy, после публичният ключ в Hetzner Console → Storage Box → SSH keys). Копират се само криптираните файлове. Без `BACKUP_AGE_RECIPIENT` нищо не напуска сървъра.

Веднъж след включването проверете, че архивът се възстановява, на вашия компютър (там е личният ключ):

```bash
BACKUP_AGE_IDENTITY=~/wcr-age-key.txt scripts/restore-drill.sh backups/<име>.dump.age
```

## Плащания със Stripe в тестов режим

По подразбиране staging ползва тестовия доставчик на приложението (без акаунт и без ключове). За да опитате истинската страница за плащане на Stripe в тестов режим (sandbox):

1. В таблото на Stripe, в sandbox: **Developers → Webhooks → Add destination** (екранът „Create an event destination“):
   - **Event destination scope:** Your account;
   - **Payload style:** Snapshot;
   - **API version:** версията по подразбиране на акаунта (приложението не праща своя версия, така че отговорите на API и събитията са в една и съща версия);
   - **Events:** `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`;
   - **Destination type:** Webhook endpoint;
   - **Endpoint URL:** `https://<STAGING_HOST>/api/billing/webhook`.
2. В `.env` на сървъра (`nano ~/wingchunroots/.env` като `deploy`), никога в чат или в git:
   - `BILLING_PROVIDER=stripe`;
   - `STRIPE_SECRET_KEY=sk_test_…` (**Developers → API keys → Secret key**);
   - `STRIPE_WEBHOOK_SECRET=whsec_…` (**Signing secret** на създадения endpoint).

   Публичният ключ (`pk_test_…`) не трябва: приложението праща купувача към страницата на Stripe, без Stripe.js в браузъра.
3. `deploy/staging/staging.sh deploy`: Compose пресъздава `web` и `worker` с новите стойности.

Caddy пуска без паролата на сайта само `POST /api/billing/webhook`: Stripe не може да прати паролата, а маршрутът сам проверява подписа `Stripe-Signature` на всяко събитие (400 без валиден подпис) и отказва събития с `livemode: true`. `staging.sh deploy` рестартира Caddy, когато `Caddyfile` се е променил.

Плаща се с тестовите карти на Stripe, например `4242 4242 4242 4242`, произволна бъдеща дата и произволен CVC. Тестовият часовник в `/admin/billing/<id>` работи само с тестовия доставчик. Смяната на месечен към годишен план на федерация в края на периода не се поддържа със Stripe (`docs/plan/questions/M23.md`, въпрос 2). За връщане към тестовия доставчик махнете `BILLING_PROVIDER=stripe` и пуснете `deploy` пак.

## Ежедневни команди

| Команда | Какво прави |
|---|---|
| `staging.sh status` | услугите, паметта, диска, `/healthz`, версията и дали демо входът е включен |
| `staging.sh logs web` | последните 200 реда от лога (и `worker`, `caddy`, `migrate`) |
| `staging.sh deploy` | обновяване до най-новия `main`; архивирайте първо (`staging.sh backup`) |
| `staging.sh password` | нова парола на сайта |

## Сигурност

- Отворени навън са само портове 22 (SSH с ключ), 80 и 443. Базата, SeaweedFS, Mailpit и приложението слушат само на 127.0.0.1 и в мрежата на Compose.
- Паролата на сайта пази от случайни посетители и търсачки. Тя не замества акаунтите: персоналът пак има задължителен втори фактор.
- `.env` и `.staging/` имат права `0600` и са извън git. Архивите съдържат лични данни: от сървъра излизат само криптирани.
- Сайтът не се индексира (`X-Robots-Tag: noindex`, плюс паролата).
