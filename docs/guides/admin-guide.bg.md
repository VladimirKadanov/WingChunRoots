# WingChunRoots: ръководство за администратора

Това ръководство е за човека, който пуска и поддържа WingChunRoots. Във Фаза 1 всичко работи **локално**: на вашия компютър с Docker Desktop, в облачните сесии на Claude Code и в GitHub Actions. Няма хостинг, облачни услуги или платени ресурси (план §3.3). Всеки етап, който променя нещо за администратора, допълва ръководството.

Последна промяна: M00b (дизайн система, теми, бюджети и визуална регресия), 17.10.2026. Включва и worker-а и пощата от M01b.

Командите са дословно; изпълняват се в терминала на WSL2 (Ubuntu), в папката на хранилището. Подробностите на английски са в [`README.md`](../../README.md).

## 1. От какво се състои

| Част | Какво прави | Как се пуска |
|---|---|---|
| Приложението (Next.js) | Сайтът на <http://localhost:3000> | `pnpm dev` (разработка) или `pnpm build` и `pnpm start` |
| Worker-ът | Фоновите задачи: изпраща писмата, пуска задачите по график | `pnpm worker:dev` или `pnpm worker` |
| PostgreSQL 18 + PostGIS 3.6 | Базата данни | Docker Compose |
| Mailpit | Пощенска кутия за проба: всички писма остават тук | Docker Compose, <http://localhost:8025> |
| SeaweedFS | Хранилище за файлове (S3), за доказателствата от следващите етапи | Docker Compose, <http://localhost:8333> |

Услугите слушат само на `127.0.0.1`: не са достъпни от други компютри в мрежата.

## 2. Пускане локално на Windows (Docker Desktop и WSL2)

### Изисквания

- Windows 10 или 11 с WSL2 и дистрибуция **Ubuntu 24.04** (`wsl --install -d Ubuntu-24.04`).
- [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) с WSL2 backend. В *Settings → Resources → WSL integration* включете дистрибуцията Ubuntu; дайте на Docker около 8 GB памет.
- Хранилището е **във файловата система на WSL2** (например `~/src/wingchunroots`), не под `C:\` или `/mnt/c`: там `pnpm install` и `next build` са многократно по-бързи, а правата на файловете са верни. Всички команди се пускат от терминала на WSL2, никога от PowerShell или cmd.

### Първо пускане

1. Инструментите (в терминала на Ubuntu):

   ```bash
   sudo apt-get update && sudo apt-get install -y git postgresql-client
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash   # после отворете терминала наново
   nvm install 24
   npm install --global pnpm@12.14.0
   ```

2. Хранилището, настройките и услугите:

   ```bash
   mkdir -p ~/src && cd ~/src
   git clone https://github.com/VladimirKadanov/wingchunroots.git
   cd wingchunroots
   nvm use                        # Node от .nvmrc
   scripts/init-env.sh            # .env с местни пароли и ключове (само за тази машина)
   docker compose up -d --wait    # PostgreSQL + PostGIS, Mailpit, SeaweedFS
   scripts/db-bootstrap.sh        # роли и собственик на базата, веднъж за база
   pnpm install
   pnpm db:migrate && pnpm db:seed   # схема и измислени демо данни
   pnpm exec playwright install --with-deps chromium   # браузър за E2E тестовете на вашата машина
   ```

3. Пускане (два терминала):

   ```bash
   pnpm dev          # сайтът: http://localhost:3000
   pnpm worker:dev   # във втори терминал: фонови задачи и поща
   ```

4. Проверка: `scripts/verify.sh M00b`; последният ред трябва да е `VERIFY M00b: PASS`.

Файлът `.env` не се качва в Git. Ако е създаден преди M01 или M01b, пуснете `scripts/init-env.sh` още веднъж: той пази съществуващите стойности и само добавя липсващите (паролите на трите роли в базата и `MAIL_TRANSPORT=smtp`). След нови пароли на ролите пуснете `scripts/db-bootstrap.sh`.

### Пускане като в production (по желание)

```bash
pnpm build
pnpm start      # http://localhost:3000
pnpm worker     # във втори терминал
```

## 3. Спиране

За спиране на всичко, без да губите данни, са достатъчни първите две стъпки.

- **Сайтът и worker-ът:** `Ctrl+C` в терминала им. Worker-ът спира плавно при `SIGTERM` (и при `Ctrl+C`): довършва текущата задача и затваря връзките.
- **Услугите в Docker:** `docker compose down`. Данните остават в именуваните томове на Docker и се връщат при следващото `docker compose up -d --wait`.
- **Изтриване на всички местни данни** (базата, писмата, файловете): `docker compose down -v`. Това е необратимо; след него повторете стъпките от „Първо пускане“ от `docker compose up -d --wait` нататък.
- **Само данните в базата, без услугите:** `pnpm db:reset`, после `pnpm db:migrate && pnpm db:seed`. Работи само с местна база или с `TEST_DATABASE_URL`, никога с `NODE_ENV=production`.

## 4. Обновяване

За обновяване, след като собственикът е слял нов етап в `main`:

```bash
cd ~/src/wingchunroots
git checkout main && git pull
nvm use                         # ако .nvmrc е сменен
scripts/init-env.sh             # добавя нови настройки, без да пипа старите
pnpm install                    # точните версии от pnpm-lock.yaml
docker compose up -d --wait     # нови образи, ако docker-compose.yml е сменен
scripts/db-bootstrap.sh         # само ако етапът го казва (нови роли или пароли)
pnpm db:migrate                 # новите миграции
scripts/verify.sh <етап>        # например scripts/verify.sh M00b
```

После пуснете сайта и worker-а наново (раздел 2, стъпка 3). Какво е ново за потребителя, пише в [`user-guide.bg.md`](user-guide.bg.md).

## 5. Worker и поща (M01b)

- **Worker-ът е отделен процес:** `pnpm worker` (или `pnpm worker:dev`, който се рестартира при промяна в кода). Свързва се с базата само като ролята `app_rw`, без право да създава таблици или схеми. Спира плавно при `SIGTERM`.
- **Всички писма минават през worker-а:** приложението ги записва в опашката в същата транзакция като промяната, която ги поражда, а worker-ът ги изпраща. Във Фаза 1 нищо не излиза извън компютъра.
- **`MAIL_TRANSPORT=smtp`** (това записва `scripts/init-env.sh`): писмата отиват в Mailpit. Пуснете го с `docker compose up -d --wait mailpit` и ги четете на <http://localhost:8025>. `SMTP_URL` може да сочи само към местния Mailpit (`localhost`, адрес на loopback или `mailpit`); всеки друг хост спира worker-а още при старта.
- **`MAIL_TRANSPORT=file`** (когато променливата липсва; облачните сесии): всяко писмо се записва в папката `.mail/` като `.eml` и `.json`.
- **Пробно писмо:** `pnpm mail:check <адрес>`, например `pnpm mail:check demo@wingchunroots.test`, докато worker-ът работи. Писмото се появява в Mailpit (или в `.mail/`).
- **Почистване по график:** задачата `retention.purge` върви всеки ден в 03:17 UTC. Адресите в `email_delivery` се изтриват 90 дни след като писмото е записано, а адресът в поканите 30 дни след края на поканата (приета, изтекла или оттеглена).

Останалите настройки (`SMTP_URL`, `MAIL_FILE_DIR`, `MAIL_FROM`, `MAILPIT_URL`) са описани в `.env.example`.

## 6. Външен вид: теми и дизайн система (M00b)

- **Темите не се настройват от администратора.** Всеки посетител избира в браузъра си: по подразбиране сайтът следва темата на устройството, а ръчният избор се пази в бисквитката `wcr-theme` на този браузър (виж ръководството за потребителя).
- **Посоката на дизайна** е записана в [`docs/design/direction.md`](../design/direction.md), а решенията и отклоненията в [`docs/adr/0006-design-system.md`](../adr/0006-design-system.md). Собственикът избра посоката „Ink Register“ на 17.10.2026.
- **Токените** (цветове, шрифтове, размери, радиуси, движение) са само в `src/design/tokens.ts`. След промяна там: `pnpm tokens:build`, който обновява `src/design/generated/tokens.css` и `tokens.json`. Тестовете падат, ако генерираните файлове не са обновени или ако някой цвят няма нужния контраст.
- **Шрифтовете** се доставят от самото приложение (пакетите `@fontsource` в `package.json`). Сайтът никога не тегли шрифтове от Google или от друг сайт.
- **`/styleguide`** показва токените и компонентите в двете теми. Страницата е за разработчици и за прегледа на дизайна и не се индексира от търсачките.

## 7. Лицензи

`THIRD_PARTY_NOTICES.md` и страницата `/legal/licenses` се генерират от `pnpm notices`: от `pnpm licenses list --json --prod`, от `tailwindcss` (пакет за разработка, чийто генериран CSS стига до браузъра) и от бележките в `licenses/addenda/`. Там са и пакетите, които `--prod` пропуска, защото са незадължителни, например `sharp` и `libvips` на Next.js (LGPL-3.0-or-later). Заглавието на такава бележка съдържа версиите; ако обновяване на Next.js смени версията на `sharp` в lockfile-а, `pnpm notices` спира с грешка, докато бележката не бъде обновена. Еднаквите текстове на лицензи се показват веднъж, а всеки пакет сочи към своя; редовете за авторското право от началото на текста се показват отделно за всеки пакет. След промяна на зависимостите пуснете `pnpm notices` и включете промените в commit-а; CI проверява, че файловете са актуални.

## 8. Проверки на качеството

| Команда | Какво проверява |
|---|---|
| `scripts/verify.sh M00b` | Целият етап: lint, типове, тестове, build, E2E, бюджети, Lighthouse, документите. Пълният лог е в `.verify/M00b.log` |
| `pnpm build` и `node scripts/check-bundle-budget.mjs` | JavaScript, който всяка страница зарежда първоначално (gzip): до 170 kB, `/styleguide` до 250 kB |
| `pnpm e2e` | Playwright срещу `next start` на порт 3100 и worker-а (първо `pnpm build`); axe на всяка страница в двете теми |
| `pnpm screenshots` | Снимките в `docs/screenshots/<етап>/` при 390×844 и 1440×900 в двете теми (първо `pnpm build`) |

Lighthouse (LCP < 2,5 s и CLS < 0,1 за `/` в мобилен профил, медианата от три пускания) върви като част от `scripts/verify.sh M00b` и в CI чрез `scripts/lighthouse.mjs` (Lighthouse 13 и `chrome-launcher`); праговете са в `lighthouserc.json`. Ползва Chromium на Playwright: локално от `pnpm exec playwright install chromium`, а в облачната сесия от `PW_CHROMIUM_EXECUTABLE`. Отчетите са в `.lighthouseci/reports/`. Пускане на ръка срещу работещ сървър: `node scripts/lighthouse.mjs --url=http://127.0.0.1:3000/`.

## 9. Визуална регресия

Тестът `e2e/visual.spec.ts` (таг `@visual`) сравнява `/` и `/styleguide` при 390×844 и 1440×900 в тъмна и светла тема с базовите снимки в `e2e/__screenshots__/visual.spec.ts/*-linux.png`. Върви **само в CI**, защото само там Chromium е точно версията на закачения Playwright; на друга машина шрифтовете и изглаждането дават малки разлики.

Базовите снимки се сменят само с commit. Когато екранът е променен нарочно, CI пада на тези тестове и печата новите снимки в лога на задачата `verify` (стъпка „Print the visual regression screenshots that match no baseline“). Обновяване:

1. В GitHub отворете неуспешното изпълнение на `ci` в PR → задачата `verify (Node 24, PostgreSQL 18, Playwright)`.
2. Вземете снимките по един от двата начина:
   - артефакта `verify-log` (бутонът *Artifacts* долу на страницата на изпълнението): разархивирайте го, например в `~/Downloads/verify-log`; там е и отчетът на Playwright (`playwright-report/index.html`), който показва разликите;
   - или лога на задачата (⋯ → *Download log archive*): разархивирайте и вземете файла на задачата `verify`.
3. В хранилището, на клона на PR:

   ```bash
   scripts/visual-baselines.sh accept ~/Downloads/verify-log   # или пътя до файла с лога
   git status                                                  # кои снимки са сменени
   ```

   При лог скриптът проверява размера и SHA-256 на всяка снимка и спира, ако е повредена.
4. Прегледайте новите PNG файлове (сравнете ги с отчета или със старите в GitHub). Ако промяната е нарочна, направете commit и push. CI минава отново със същите снимки.

Ако разликата **не е** нарочна, не приемайте снимките: поправете кода.
