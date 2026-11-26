# ADR 0068: Една страница за плана

| | |
|---|---|
| Статус | Прието (26.11.2026) |
| Контекст | Прегледът на всички роли (25.11.2026, https://claude.ai/artifact/6bt42cDSmTEspvjVeMzH5u), находка P2-13. Собственикът поиска P2. |
| Свързани | M08, M22, M23, [ADR 0025](0025-billing.md), [ADR 0026](0026-federation-billing.md) |

## Проблемът

Членът имаше две страници за едно и също: **Plan and billing** (`/account/plan`: вид на акаунта, план в сила, тестови планове) и **Billing** (`/dashboard/billing`: абонамент, избор на платен план, плащания). Първата водеше към втората с **Billing and invoices**, втората — обратно с **Plan and billing**, а планът беше описан и на двете.

## Решение

- `/account/plan` е единствената страница: **Account type**, **Your plan** (как се показвате, план в сила, тестови планове), после частта за плащане: банерът „Test mode, no real charge“, **Subscription**, **Choose a paid plan**, **Payment history** и **Earlier subscriptions**.
- Кодът на плащането е в `src/app/account/plan/_billing/` (частна папка, не е адрес): `sections.tsx` (`BillingSections`, бившата страница), `actions.ts`, `forms.tsx`, `changes.tsx`, `form-ids.ts`. Страницата на организацията (`/dashboard/organization/<id>/billing`) ползва същите форми.
- `/dashboard/billing` пренасочва завинаги (308) към `/account/plan` с цялата заявка (`?checkout=`, `?plan=`, `?cancelled=`, `?outcome=`); браузърът пази `#outcome`. Старите връзки в имейли и известия продължават да работят.
- Връщането от тестовото плащане (`successUrl`, `cancelUrl`), формите, известията за плащане („Open your plan and billing“) и **Choose this plan** в `/plans` водят направо към `/account/plan`.
- Редът **Paid plan** в **Your plan** отпада: абонаментът е на същата страница малко по-долу.
- Ключовите екрани: `account-plan` (demo-free-sifu-5, приключил абонамент) и новият `account-plan-subscribed` (demo-premium-student, активен абонамент); `dashboard-billing*` отпадат. Проверките на M22 и M23 следят новите пътища.

## Последици

- Едно място за всичко около плана; по-малко връзки напред-назад.
- Страницата е по-дълга; разделите имат заглавия и котви (`#account-type-heading`, `#billing`, `#outcome`).
