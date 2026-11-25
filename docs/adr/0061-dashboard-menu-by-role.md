# ADR 0061: Менюто на таблото по роля

| | |
|---|---|
| Статус | Прието (25.11.2026) |
| Контекст | Прегледът на всички роли (25.11.2026, https://claude.ai/artifact/6bt42cDSmTEspvjVeMzH5u), находка P2-7 и първата точка на P2-6. Собственикът поиска всички P2 („do all of those, merge when ready“). |
| Свързани | [ADR 0039](0039-member-navigation.md), [ADR 0053](0053-phone-layout.md), M25 |

## Проблемът

Менюто на ученика имаше **Digital successor** (страница на Sifu, която завършва с „comes with Professional Sifu“) и празно **Cases**. Менюто на Professional Sifu имаше около 20 реда в групи, които започваха с обучението на самия Sifu. Администратор на организация публикува събития, но **Events** липсваше в менюто му.

## Решение

- Групи: **Overview**; за Sifu **Teaching** (заявки, паспортите на учениците, проверката на инструктор до проверката) и **Schools and events** (школи, събития); за всеки член **My training** (бившето **Learning**); **Organizations**; **Account** (бившето **You**).
- **Cases** се показва, когато акаунтът е страна по поне един случай (`hasPartyCases` в `src/server/services/cases.ts`, същото условие като `cases.mine`).
- **Digital successor** се показва на Sifu и на всеки, който е посочил наследник или е посочен (ред в `succession_nomination`). Страниците сами проверяват достъпа, както преди: менюто е само път.
- Администратор на организация, който не е Sifu, вижда **Events** в **Organizations** (P2-6).
- Броят стои само до редовете, в които нещо чака (заявки, непрочетени известия), както досега.

## Последици

- Тестове: `src/components/dashboard/dashboard-nav.test.ts`, `e2e/member-nav.spec.ts` (редът на групите на Sifu, без **Digital successor** за ученик). Визуалните еталони на страниците на таблото се приемат от CI.
- Ръководство: `docs/guides/user-guide.bg.md`, „Таблото (Dashboard)“.
