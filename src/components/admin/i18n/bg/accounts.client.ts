// Bulgarian for the control panel: accounts, text used in client components (docs/adr/0043-admin-bulgarian.md).
// Keys are the English text exactly as the components pass it to t(); {name} placeholders stay as they are.

import type { AdminDict } from '../translate';

export const BG_ACCOUNTS_CLIENT: AdminDict = {
  ' of {email}': ' на {email}',
  'Account e-mail': 'Имейл на акаунта',
  'Reason': 'Причина',
  'Ends': 'Край',
  'Confirmation': 'Потвърждение',
  'The address the account signs in with.': 'Адресът, с който акаунтът влиза.',
  'Required. Kept in the audit log. The person is not sent this or any message: tell them by other means, if at all.': 'Задължително. Пази се в одитния журнал. На човека не се изпраща това или друго съобщение: кажете му по друг начин, ако изобщо е нужно.',
  'The suspension ends by itself at 00:00 UTC that day. Leave empty to keep it until you lift it.': 'Спирането приключва само в 00:00 UTC на този ден. Оставете празно, за да остане, докато не го отмените.',
  'The account is signed out everywhere at once and refused on every page and sign-in. Its profile stays as it is: take a profile down from its record page. You can not suspend your own account or the last active administrator.': 'Акаунтът излиза веднага навсякъде и се отказва на всяка страница и при всяко влизане. Профилът му остава какъвто е: свалете профил от страницата на записа му. Не можете да спрете собствения си акаунт или последния активен администратор.',
  'Suspending…': 'Спиране…',
  'Suspend account': 'Спри акаунта',
  'Suspended on {since} · ends {until}': 'Спрян на {since} · изтича на {until}',
  'Suspended on {since} · until an administrator lifts it': 'Спрян на {since} · докато администратор не отмени спирането',
  'Lift suspension…': 'Отмени спирането…',
  'Lift suspension': 'Отмени спирането',
  'Lifting…': 'Отменяне…',
  'Reason for lifting the suspension': 'Причина за отмяната на спирането',
  'Required. Kept in the audit log.': 'Задължително. Пази се в одитния журнал.',
  'The account that asked for its deletion:': 'Акаунтът, който поиска изтриването си:',
  'its account is gone already': 'акаунтът вече не съществува',
  '. The request is closed with the erasure.': '. Искането се затваря със заличаването.',
  'The address the account signs in with. A member who asked in the app is on the administration page, under Account deletion requests.': 'Адресът, с който акаунтът влиза. Член, който е поискал това в приложението, е на страницата на администрацията, под „Искания за изтриване на акаунт“.',
  'Required. Kept in the audit log, never shown to the person.': 'Задължително. Пази се в одитния журнал и никога не се показва на човека.',
  'I understand that this can not be undone': 'Разбирам, че това не може да бъде отменено',
  "The sign-in account, the profile's other names and biography, photos, schools, events, the passport and pending requests are removed. Relationships that others confirmed stay as historical records.": 'Премахват се акаунтът за вход, другите имена и биографията на профила, снимките, школите, събитията, паспортът и чакащите заявки. Връзките, потвърдени от други, остават като исторически записи.',
  'Erasing…': 'Заличаване…',
  'Erase account': 'Заличи акаунта',
  'Administration': 'Администрация',
  'Accounts': 'Акаунти',
  "We couldn't load the suspended accounts. Nothing was changed.": 'Не успяхме да заредим спрените акаунти. Нищо не е променено.',
  'Back to administration': 'Обратно към администрацията',
};
