# ADR 0073: Знак „From your invite link“ на заявките

| | |
|---|---|
| Статус | Прието (26.11.2026) |
| Контекст | Прегледът на всички роли (25.11.2026, https://claude.ai/artifact/6bt42cDSmTEspvjVeMzH5u), находка P1-3: „Requests that come through the Sifu's own link are marked "from your invite link" so they can be approved quickly (still one by one; no auto-approval).“ Собственикът одобри („Yea, do all of those, merge when ready“). |
| Свързани | [ADR 0058](0058-invite-link.md), [ADR 0060](0060-request-note.md), M09 |

## Решение

- Връзката `/join/<адрес>` води към `/dashboard/teachers/new?teacher=<адрес>&from=invite`. `&from=invite` минава през регистрацията, имейла и първоначалния профил като останалата част от адреса.
- Формата за заявка помни учителя от връзката (скрито поле `viaInviteFor`). Заявката се отбелязва само ако е изпратена точно до този учител; ако ученикът избере друг учител, знак няма.
- Нова колона `teaching_relationship.via_invite_link` (boolean, по подразбиране `false`) и поле `viaInviteLink` на `relationships.request`. Одитът `relationship.request` пази `viaInviteLink`.
- Учителят (и проверяващите) виждат „From your invite link“ до „Sent to you“ в **Student requests**. Ученикът не го вижда. Знакът е само подсказка: не одобрява нищо и не дава предимство — учителят пак одобрява всяка заявка поотделно.

## Защо е само подсказка

Връзката не пази тайна (ADR 0058): всеки може да отвори `/join/<адрес>` на публичен профил. Затова знакът казва само „ученикът е дошъл от вашата връзка“, а не „това е ваш ученик“.
