// Bulgarian for the control panel: archive, text used in client components (docs/adr/0043-admin-bulgarian.md).
// Keys are the English text exactly as the components pass it to t(); {name} placeholders stay as they are.

import type { AdminDict } from '../translate';

export const BG_ARCHIVE_CLIENT: AdminDict = {
  // The error state (error.tsx; the pages' own state uses the same words)
  'Archive editor': 'Редактор на архива',
  "We couldn't load the archive. Nothing was changed.": 'Архивът не можа да се зареди. Нищо не е променено.',
  'Back to administration': 'Обратно към администрацията',

  // Field labels (forms.tsx, edit-link-form.tsx)
  'Name of the lineage': 'Име на линията',
  Description: 'Описание',
  'Root record': 'Запис в корена',
  Reason: 'Причина',
  'Name in Latin letters': 'Име на латиница',
  'Name in its own script': "Име в оригиналната писменост",
  'Script of that name': 'Писменост на това име',
  Pinyin: 'Пинин',
  'Life status': "Жив или починал",
  'Biography (English)': 'Биография (на английски)',
  Evidence: 'Доказателства',
  Lineage: 'Линия',
  Teacher: 'Учител',
  Student: 'Ученик',
  'From (year)': 'От (година)',
  'To (year)': 'До (година)',
  Source: 'Източник',

  // Hints
  'Required. Why, and on what basis; kept in the audit log with your name and role.':
    'Задължително. Защо и на какво основание; пази се в одитния журнал с вашето име и роля.',
  'In Latin letters, as the explorer shows it.': 'На латиница, както го показва изследователят на линиите.',
  'Optional. The address of the record at the root (the part after /people/, or as the search shows it). Leave empty when the root is not known.':
    'По желание. Адресът на записа в корена (частта след /people/ или както го показва търсенето). Оставете празно, ако коренът не е известен.',
  "The everyday spelling, shown as the person's name.": 'Обичайното изписване, показвано като име на лицето.',
  'Choose a script': 'Изберете писменост',
  'For example: sou1 zuk1 cing4': 'Например: sou1 zuk1 cing4',
  'A person whose life status is not known is treated as living: the record and its links stay off the public pages until the evidence shows a death.':
    'Лице, за което не е известно дали е живо, се смята за живо: записът и връзките му остават извън публичните страници, докато доказателствата не покажат смърт.',
  Deceased: 'Починал',
  'Not known': "Неизвестно",
  'Optional. JPEG, PNG, WebP or PDF, up to 20 MB each. Linked files stay with the record; staff only.':
    'По желание. JPEG, PNG, WebP или PDF, до 20 MB всеки. Свързаните файлове остават към записа; само за екипа.',
  "The teacher's record address.": 'Адресът на записа на учителя.',
  "The student's record address.": 'Адресът на записа на ученика.',
  'Leave both years empty when the dates of the training are not known.': 'Оставете двете години празни, ако датите на обучението не са известни.',
  'Required. Where this training is recorded: a book and its page, an interview, a certificate. Staff see it; the public pages do not.':
    'Задължително. Къде е записано това обучение: книга и страница, интервю, сертификат. Вижда се от екипа, но не и на публичните страници.',
  'Optional. JPEG, PNG, WebP or PDF, up to 20 MB each: a scan of the page, a photo of the certificate. Staff only.':
    'По желание. JPEG, PNG, WebP или PDF, до 20 MB всеки: сканирана страница, снимка на сертификата. Само за екипа.',
  'Reason for ending this link': 'Причина за прекратяване на тази връзка',
  'Required. The link leaves the public pages; its history stays.': 'Задължително. Връзката излиза от публичните страници; историята ѝ остава.',

  // Buttons
  'Creating…': 'Създаване…',
  'Create the lineage': 'Създай линията',
  'Saving…': 'Запазване…',
  'Save the lineage': 'Запази линията',
  'Create the record': 'Създай записа',
  'Adding…': 'Добавяне…',
  'Add the link': 'Добави връзката',
  'Find by name': 'Търсене по име',
  'Choose the teacher': 'Изберете учителя',
  'Choose the student': 'Изберете ученика',
  'Type the name in any spelling. Only public records are found; type the address of any other record.': 'Въведете името с какъвто и да е правопис. Намират се само публичните записи; за друг запис въведете адреса му.',
  'Chosen: {name}': 'Избрано: {name}',
  'Ending…': 'Прекратяване…',
  'End this link': 'Прекрати тази връзка',
  // Journey review 2026-11-26 (P1-3, ADR 0077).
  'Era': 'Епоха',
  'Shown on the public pages, for example "d. 1901" or "active 1850s to 1880s".': 'Показва се на публичните страници, например „d. 1901“ или „active 1850s to 1880s“ (на английски).',
  'How sure the record is': 'Колко сигурен е записът',
  'Public source line': 'Публичен ред за източника',
  'Shown on the public pages in words and by the line. Documented: a written record of the time. Traditional account: told within the lineage. Disputed by historians: sources disagree.': 'Показва се на публичните страници с думи и с линията. Документирано: писмен запис от времето. Традиционен разказ: предаван в рамките на линията. Оспорвано от историци: източниците се разминават.',
  'Documented': 'Документирано',
  'Traditional account': 'Традиционен разказ',
  'Disputed by historians': 'Оспорвано от историци',
  'Shown to everyone after "According to", for example "the hall\'s oral history". Keep private notes in Source.': 'Показва се на всички след „According to“, например „the hall\'s oral history“ (на английски). Личните бележки остават в „Източник“.',
  'Show this lineage on the home page': 'Покажи тази линия на началната страница',
  'One lineage at a time: choosing this one takes the place of any other. With none chosen, the home page shows a different public lineage each day.': 'Една линия наведнъж: изборът на тази заменя всяка друга. Ако няма избрана, началната страница показва всеки ден различна публична линия.',
  // Journey review P2-10 (ADR 0086): merging duplicates and the common roots.
  'This lineage holds the common roots': 'Тази линия съдържа общите корени',
  'The teachers every branch shares, before the branches split, kept once here. A link kept here is not recorded again in another lineage. One lineage at a time.': 'Учителите, общи за всички клонове преди разделянето им, записани веднъж тук. Връзка, записана тук, не се записва отново в друга линия. Само една линия наведнъж.',
  // Review 2026-11-13 (ADR 0088): the review of a naming request.
  'Reason (optional, kept in the audit log)': 'Причина (по избор, пази се в одитния дневник)',
  Approve: 'Одобри',
  Decline: 'Откажи',
};
