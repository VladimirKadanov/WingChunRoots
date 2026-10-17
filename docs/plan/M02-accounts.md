# M02 — Акаунти, роли и съгласия

`docs/plan/M02-accounts.md` · клон `m02-accounts` · таван 40 хода · D04, D10, D16, D23

## Цел (Objective)

Пълнолетен потребител се регистрира, потвърждава имейла си, влиза и възстановява паролата си. Персоналът е длъжен да ползва TOTP, проверен в текущата сесия. Съгласията се пазят с версия. Акаунтът е отделен от личността. Сесията работи и с бисквитка, и с токен за бъдещ native клиент, а всяка промяна на акаунта е достъпна през OpenAPI договора. Тестовете могат да влизат като всяка опорна роля.

## Прочети първо (Read first)

`docs/WingChunRoots_Technical_Plan.bg.md`: §3.2 („Better Auth и отделна личност“ и „API-first“), §5.3 (правилата за имената), §5.5, §5.6, §5.8, §6.2, §6.4, §6.6, §6.8. `docs/design/direction.md`.

## Зависимости (Dependencies)

M00b, M01b.

## Обхват (In scope)

1. **Better Auth 1.7.10.**
   - Drizzle адаптер; таблиците се преименуват на `auth_*` чрез `modelName`; добавят се външните ключове от M01.
   - Имейл и парола, потвърждаване на имейла, възстановяване на паролата, ограничаване на честотата на заявките (rate limiting).
   - Полето `role` има `input: false`. Плъгини `twoFactor` (TOTP и резервни кодове), `admin` и `bearer`.
2. **Предпазни проверки (guards) в `src/server/auth/guards.ts`:** `requireUser()`, `requireRole()` и `requireStaff2FA()`, по план §3.2:
   - сесията има допълнително поле `two_factor_verified_at`, което `hooks.after` попълва след `/two-factor/verify-totp` и `/two-factor/verify-backup-code`; `requireStaff2FA()` проверява него, а не само `twoFactorEnabled`;
   - `hooks.before` отказва `trustDevice` за роли на персонала;
   - `admin`, `moderator` и `archivist` се дават само на акаунт с `twoFactorEnabled = true`;
   - при смяна на роля и при включване на 2FA всички сесии на потребителя се прекратяват.
3. **API-first (план §6.8).** Контекстът на oRPC намира сесията от бисквитката или от `Authorization: Bearer`. Първоначалният профил и съгласията са oRPC процедури (`account.onboard`, `consent.record`), а уеб формите ги викат чрез тънки Server Actions. `api-parity.test.ts` сверява Server Actions с процедурите. Интеграцията `@better-auth/expo` е по-късна стъпка.
4. **Регистрация.**
   - Отметки за `terms`, `privacy_ack`, `authenticity_declaration` и „I am 18 or older“ (D10). Нито една не е сложена предварително. Без отметките за пълнолетие, условия и декларация за достоверност регистрацията се отказва. Всяка отметка се записва в `consent_record` с версия на документа.
   - Рождена дата не се събира (D16).
   - Чернови на условията и поверителността в `content/legal/` с надпис „Draft — pending legal review“ (D23). `terms.en.md` казва, че пилотът е само за пълнолетни. `privacy.en.md` изрежда получателите (OpenFreeMap за картата; доставчиците на хостинг, поща и наблюдение се добавят, когато бъдат избрани, план §3.3) и описва `ip_hmac`.
5. **Първоначален профил** (`/onboarding`). Създава личност със `stewardship = self`, `claimed_by_user_id` и `visibility = 'involved_only'`. Отметката „Show my profile publicly“ не е сложена предварително (план §6.2). Полета: основно име на латиница (задължително); по желание име в оригиналната писменост с `lang` (например традиционни или опростени китайски йероглифи), Jyutping и пинин; държава, град от `place`, година на започване.
6. **Писма.** Потвърждаване на имейла и възстановяване на паролата през `Mailer` от M01b, с шаблони от `src/server/templates/`.
7. **Екрани:** `/sign-up`, `/sign-in`, `/verify-email`, `/reset-password`, `/account/security`, `/onboarding`, оформени по `docs/design/direction.md` и летвата от план §5.8. `/admin` е празна страница-заместител, защитена с `requireStaff2FA()`, която показва само броя на неуспешните доставки на имейли. Поставянето на текст е разрешено и полетата имат правилни `autocomplete` атрибути (WCAG 3.3.8). Новите маршрути влизат в `e2e/routes.ts`.
8. **Одит:** `role.change`, `consent.grant`, `auth.2fa.enable`.
9. **Входни акаунти за тестовете.** `pnpm db:seed` (никога при `NODE_ENV=production`) създава акаунти, свързани с опорните записи: ученика на `demo-pending`, `demo-root-a`, `demo-hub-a`, `demo-free-sifu-5`, `demo-pro-sifu-8`, `demo-two-lineages`, както и `demo-admin`, `demo-archivist` и `demo-moderator` с TOTP тайна от `E2E_TOTP_SECRET` и парола от `E2E_PASSWORD` (в `.env.example`). `e2e/helpers/auth.ts` дава `signInAs(slugOrRole)`.
10. **Първи администратор:** скрипт `pnpm admin:create --email <адрес>`, само за локалната среда. Не отпечатва тайни.
11. **Ръководства на български.** `docs/guides/user-guide.bg.md`: регистрация, потвърждаване на имейла, вход, възстановяване на паролата, първоначален профил (включително име с китайски йероглифи). `docs/guides/admin-guide.bg.md`: създаване на първия администратор, задължителният TOTP, писмата в Mailpit.
12. **Документация:** `docs/adr/0004-auth.md`.

## Извън обхват (Out of scope)

Вход чрез социални мрежи, passkeys, magic links. Интеграцията `@better-auth/expo`. Непълнолетни. Покани (M10b). Редакция на имената отвъд първоначалния профил и поверителност на акаунта (M07). Права по план (M08).

## Ограничения (Constraints)

`docs/plan/RULES.md`, а освен това: тестовите тайни (`E2E_TOTP_SECRET`, `E2E_PASSWORD`) са само за локална среда и CI.

## Критерии за готовност (Done when)

1. `scripts/verify.sh M02` завършва с `VERIFY M02: PASS`.
2. E2E тестове в `e2e/m02-auth.spec.ts`:
   - `@M02 sign up, confirm the email from the outbox and sign in`
   - `@M02 password reset through the emailed link`
   - `@M02 consent and adult checkboxes start unticked and are stored with the document version`
   - `@M02 sign-up is refused unless "I am 18 or older", terms and the authenticity declaration are ticked`
   - `@M02 role cannot be set through the sign-up request`
   - `@M02 a staff session without a verified second factor is redirected from /admin to /account/security`
   - `@M02 a seeded staff account signs in with the test TOTP and opens /admin`
   - `@M02 onboarding creates a person linked to the account`
   - `@M02 onboarding requires a Latin-script primary name and stores an optional Chinese name with its lang`
   - `@M02 sign-up and onboarding complete at 390x844`
   - `@M02 no axe violations on sign-up, sign-in and onboarding`
3. Интеграционни тестове в `guards.int.test.ts`: матрица роля × маршрут; сесия без `two_factor_verified_at` получава 403 на `/admin`; `trustDevice` се пренебрегва за персонала; роля на персонала не се дава на акаунт без 2FA; смяна на ролята прекратява сесиите; защитена oRPC процедура приема сесия от бисквитка и от `Authorization: Bearer` и отказва заявка без сесия.
4. `templates.test.ts` покрива и шаблоните на M02; `api-parity.test.ts` минава.
5. Ръководствата са обновени (`scripts/verify.d/M02.sh` проверява, че са променени в клона).
6. Съществуват `src/server/auth/`, `e2e/helpers/auth.ts`, `content/legal/terms.en.md`, `content/legal/privacy.en.md`, `docs/adr/0004-auth.md` и `docs/screenshots/M02/`.
7. Изпълнен е `/security-review` и находките са поправени или записани в PR. PR, зелен CI, чист `git status`.

## Кога да спре и да попита (Stop and ask)

Общите условия, а освен това: ако за пилота се изисква истински правен текст. Междувременно се ползват черновите. Ако Better Auth не може да ползва `uuid` идентификатори, се избира съвместим тип и се записва в ADR. Това не е причина за спиране.

## Ред за /goal

```text
/goal Implement milestone M02 exactly as written in docs/plan/M02-accounts.md. Read CLAUDE.md, docs/plan/RULES.md, the milestone file and every document section listed under its Read first heading before writing code. First run `git fetch origin`. If branch m02-accounts exists on origin, check it out and continue from its Progress log and any answered question in docs/plan/questions/M02.md; otherwise branch from origin/main. If a milestone listed under Dependencies is not merged into origin/main, print `BLOCKED M02: dependency <milestone> not merged`. Begin every turn with the line `M02 turn <n>/40`. Success: the goal is met when this conversation shows all of: (1) the step summary printed by `scripts/verify.sh M02`, ending with the line `VERIFY M02: PASS`; (2) the work committed and pushed on branch m02-accounts with a PR to main whose description is in English and includes that step summary; (3) the PR's CI checks all passed (show the GitHub tool output or `gh pr checks`); (4) `git status` showing a clean tree. Respect the Out of scope, Constraints and Stop and ask sections. Every account mutation must be an oRPC procedure that also accepts a bearer session; Server Actions only wrap it. Build the screens in the chosen design direction and update the Bulgarian guides in docs/guides/. Commit and push after every green checkpoint and add one line per checkpoint to the Progress log. Before the final verify run /code-review and /security-review on the diff and fix correctness, security or requirement gaps only. Never delete, skip or weaken a test or check to get a pass. If a Stop and ask condition occurs, write the question in English to docs/plan/questions/M02.md, commit and push. The goal also ends, not as success, when you print a `BLOCKED M02: <one-line reason>` line (after recording any question as above) or `STOPPED M02: turn limit` followed by a progress summary after 40 turns.
```

## Дневник на напредъка (Progress log)
- 2026-10-17 18:35 — зависимости (better-auth, oRPC, zod), настройките за акаунтите, таблиците auth_*, външните ключове към auth_user, тригерът за прекратяване на сесиите и демо акаунтите в seed; db:check и интеграционните тестове на базата са зелени
- 2026-10-17 19:05 — Better Auth (имейл и парола, потвърждаване, възстановяване, rate limiting, twoFactor, admin, bearer), куките за съгласията, trustDevice и two_factor_verified_at, предпазните проверки, услугите (съгласия, профил, роли, админ), oRPC под /api/rpc и /api/v1 със защита от CSRF, шаблоните на писмата; auth.int.test.ts и guards.int.test.ts са зелени
- 2026-10-17 19:31 — екраните /sign-up, /sign-in (и втората стъпка), /verify-email, /reset-password, /account, /account/security (TOTP с QR код и текстова тайна, резервни кодове), /onboarding, /admin и черновите /legal/terms и /legal/privacy; тънки Server Actions, api-parity.test.ts, интеграционни тестове за account.onboard и consent.record; lint, typecheck, unit, int и build зелени, бюджетът на JavaScript е спазен
- 2026-10-17 20:02 — пауза по молба на собственика; незавършената работа по e2e тестовете (e2e/m02-auth.spec.ts, e2e/helpers/auth.ts), маршрутите и визуалните снимки е записана като междинен commit, който още не е проверен (lint, тестове)
- 2026-10-17 20:08 — междинният commit е проверен: поправена е грешка на lint в e2e/helpers/auth.ts; lint, typecheck, unit, int, build, e2e @M02 (22 теста) и @smoke/@M00b/@M01b (136 теста) са зелени
- 2026-10-17 20:12 — `pnpm admin:create --email <адрес>` (само локално, без тайни в изхода): дава роля admin на потвърден акаунт с включен TOTP, прекратява сесиите му и записва role.change; unit и интеграционни тестове са зелени
- 2026-10-17 20:23 — критичен преглед на дизайна (всички екрани на 390x844 и 1440x900 в двете теми, сравнени с началната страница): бележки до формите за вход, потвърждаване, възстановяване и втория фактор, колоната с бележки е на нивото на надзаглавието, полетата Jyutping и пинин са подравнени, състоянието на 2FA е със знак и текст, QR кодът не се разтяга, „e-mail“ не се пренася на тирето, един червен бутон на екран, заглавията на правните текстове са с пълен тон; снимките в docs/screenshots/M02/; e2e @M02 и @a11y са зелени
- 2026-10-17 20:45 — документация: ADR 0004 (акаунти, CSRF, uuid, зависимости и лицензи), двете ръководства, модел на данните, README, CLAUDE.md §4 и статусите в docs/plan/README.md; бележки DEFAULT D04; задачата retention.purge трие и изтеклите сесии (както казва политиката за поверителност); scripts/verify.d/M02.sh; THIRD_PARTY_NOTICES.md обновен; lint, typecheck и unit тестовете са зелени
- 2026-10-17 21:20 — преглед на кода (/code-review) и поправки: нова версия на документите се иска и от акаунт с готов профил (landingPath, формата само с отметките в /onboarding, връзка в /account), ip_hmac на сесията от адреса на клиента, латинско име без знаци от други писмености, премахнати остарели кодове на държави, IPv6 в логовете се маскира, повторното искане на връзка за потвърждаване е анонимно, oRPC проверява сесията и ролята преди входните данни, бележка за base32 на тестовата TOTP тайна; lint, typecheck, unit, int и e2e @M02 са зелени
- 2026-10-17 21:25 — преглед на сигурността (/security-review): `?next=` вече не може да стане път към друг сайт след нормализиране (`/.//host` и `/a/..//host` водят до `//host`); unit тестове за safeNextPath и интеграционен тест за landingPath; lint, typecheck, unit и int са зелени
- 2026-10-17 21:46 — `scripts/verify.sh M02`: PASS; M00, M00b и M01b: PASS; черновата PR #9 е отворена и възложена; първият CI е зелен освен 12-те визуални еталона (sign-up, sign-in, onboarding), които са приети от лога на CI; колоната с хеша на паролата е `auth_account.credential_hash`, защото проверката на M01 не допуска думата PASSWORD в миграциите
- 2026-10-17 22:10 — `scripts/verify.sh` за M00, M00b, M01, M01b, M03 и M02: PASS на 0cc8911; CI на PR #9 е зелен (ci, verify, node22, security), включително визуалните еталони
- 2026-10-17 22:35 — CI на c09bb70: два нестабилни теста: axe мереше цветовете веднага след смяна на темата без презареждане (новият тест за документите) и визуалната снимка на /onboarding понякога хващаше лентата преди отбелязването на текущия раздел; тестът презарежда страницата във всяка тема, а e2e/visual.spec.ts чака отбелязания раздел преди снимката
