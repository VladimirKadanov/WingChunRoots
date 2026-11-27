// Bulgarian for the control panel: review, text used in client components (docs/adr/0043-admin-bulgarian.md).
// Keys are the English text exactly as the components pass it to t(); {name} placeholders stay as they are.

import type { AdminDict } from '../translate';

export const BG_REVIEW_CLIENT: AdminDict = {
  // Assigning a case.
  'Give the case to': 'Възложи случая на',
  'Choose a reviewer': 'Изберете проверяващ',
  'Assign to me': 'Възложи на мен',
  'Unassign': 'Освободи',
  'Assign': 'Възложи',
  'Unassigning…': 'Освобождаване…',
  'Assigning…': 'Възлагане…',

  // The decisions of a historical claim (also the words review.get sends for it).
  'Verify the claim': 'Потвърди заявката',
  'Verifying…': 'Потвърждаване…',
  'Note on the decision': 'Бележка към решението',
  'Optional. Kept with the case for the reviewers; the claimant is told the claim was confirmed.':
    'По избор. Пази се със случая за проверяващите; на заявителя се съобщава, че заявката е потвърдена.',
  'Refuse the claim': 'Откажи заявката',
  'Refusing…': 'Отказване…',
  'Reason': 'Причина',
  'Required. The claimant reads it on Your teachers. Neutral and specific: what the evidence does not show.':
    'Задължително. Заявителят я чете в „Вашите учители“. Неутрално и конкретно: какво доказателствата не показват.',
  'Ask for more information': 'Поискай още информация',
  'Sending…': 'Изпращане…',
  'Question for the claimant': 'Въпрос към заявителя',
  'Required. The claimant reads it on Your teachers and can add evidence to the claim.':
    'Задължително. Заявителят го чете в „Вашите учители“ и може да добави доказателства към заявката.',
  'Also take the profile down from the public pages': 'Свали профила и от публичните страници',
  'Not ticked unless you choose it. The note above is then required and is sent to the owner as the reason (never name the reporter). You can put the profile back from the record page.':
    'Не е отметнато, освен ако не го изберете. Тогава бележката по-горе е задължителна и се изпраща на собственика като причина (никога не назовавайте подалия сигнала). Можете да върнете профила от страницата на записа.',

  // Notes, arbitration, photos.
  'Internal note': 'Вътрешна бележка',
  'Only reviewers read internal notes.': 'Вътрешните бележки се четат само от проверяващите.',
  'Add the note': 'Добави бележката',
  'Adding…': 'Добавяне…',
  'Required. Both people read it in their notification, their e-mail and on their case page. Say what is disputed and what evidence would settle it.':
    'Задължително. И двамата я четат в известието, в имейла и на страницата на случая си. Кажете какво се оспорва и какви доказателства биха решили въпроса.',
  'Set in arbitration': 'Предай на арбитраж',
  'Setting…': 'Предаване…',
  'Reason for removing the photo': 'Причина за премахване на снимката',
  "Required. Kept in the audit log. The photo's files are deleted; the person can add another photo.":
    'Задължително. Пази се в одитния журнал. Файловете на снимката се изтриват; човекът може да добави друга снимка.',
  'Remove photo': 'Премахни снимката',
  'Removing…': 'Премахване…',
  'Reason for removing this photo': 'Причина за премахване на тази снимка',
  "Required. Kept in the audit log. The photo's files are deleted.": 'Задължително. Пази се в одитния журнал. Файловете на снимката се изтриват.',

  // The archival edit.
  'Name in Latin letters': 'Име на латиница',
  'Name in its own script': "Име в оригиналната писменост",
  'Script': 'Писменост',
  'Life status': "Жив или починал",
  'Biography': 'Биография',
  'Evidence': 'Доказателства',
  'Script of that name': 'Писменост на това име',
  'Choose a script': 'Изберете писменост',
  'Not known': "Неизвестно",
  'Deceased': 'Починал',
  'Living': 'Жив',
  'Biography (English)': 'Биография (на английски)',
  'Link evidence': 'Свържи доказателства',
  'Optional. JPEG, PNG, WebP or PDF, up to 20 MB each. Linked files stay with the record.':
    'По избор. JPEG, PNG, WebP или PDF, до 20 MB всеки. Свързаните файлове остават към записа.',
  'Required. Why the record changes and on what basis; kept in the audit log with your name and role.':
    'Задължително. Защо записът се променя и на какво основание; пази се в одитния журнал с вашето име и роля.',
  'Saving…': 'Запазване…',
  'Save the record': 'Запази записа',

  // Take down and restore.
  'Reason for putting the record back': 'Причина за връщане на записа',
  'Reason for taking the record down': 'Причина за сваляне на записа',
  'Required. Kept in the audit log. The owner is told the record is back, and it returns to what the owner chose.':
    'Задължително. Пази се в одитния журнал. Собственикът е уведомен, че записът е върнат, и той отново е такъв, какъвто го е избрал собственикът.',
  'Required. Kept in the audit log and sent to the owner, if the record has one. Write it for the owner to read, and never name a reporter. The record can be put back at any time.':
    'Задължително. Пази се в одитния журнал и се изпраща на собственика, ако записът има такъв. Пишете така, че собственикът да я прочете, и никога не назовавайте подал сигнала. Записът може да бъде върнат по всяко време.',
  'Restore record': 'Върни записа',
  'Take record down': 'Свали записа',
  'Restoring…': 'Връщане…',
  'Taking down…': 'Сваляне…',
  // ADR 0067.
  'Ask {name} to confirm': 'Помолете {name} да потвърди',
  'Asking…': 'Питане…',
  // ADR 0088: impersonation reports.
  'Also suspend the account that held the profile': 'Спри също акаунта, който държеше профила',
  'Suggested. Untick it when the account looks like a mistake rather than an impostor. You can lift a suspension from the account page.': 'Препоръчително. Махнете отметката, ако акаунтът изглежда като грешка, а не самозванец. Спирането може да се отмени от страницата на акаунта.',
  'The proof could not settle it either way': 'Доказателствата не решават въпроса нито в едната, нито в другата посока',
  'Both sides read “could not be settled” rather than “not upheld”. The reporter may report the profile again later with new proof.': 'Двете страни четат „не можа да бъде решен“ вместо „не се уважава“. Подателят може по-късно да подаде нов сигнал с нови доказателства.',
  'Hold the profile': 'Задръж профила',
  'Close the report': 'Закрий сигнала',
  'Optional. Only reviewers read it. The profile is held for 30 days: nobody can rename, hide, delete or hand it over. Both sides are told, and have 14 days to bring proof.': 'По избор. Четат я само проверяващите. Профилът се задържа за 30 дни: никой не може да го преименува, скрие, изтрие или прехвърли. Двете страни са уведомени и имат 14 дни за доказателства.',
  'Required. The reporter reads it. Nothing changes for the profile, and its account is never told.': 'Задължително. Подателят я чете. За профила нищо не се променя и акаунтът му никога не се уведомява.',
  'I saw the code on the page': 'Видях кода на страницата',
};
