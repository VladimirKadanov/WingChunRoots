// Bulgarian for the control panel: organizations, text used in client components (docs/adr/0043-admin-bulgarian.md).
// Keys are the English text exactly as the components pass it to t(); {name} placeholders stay as they are.

import type { AdminDict } from '../translate';

export const BG_ORGANIZATIONS_CLIENT: AdminDict = {
  // The grant form
  'Kind': 'Вид',
  'Reason': 'Причина',
  'Starts': 'Начало',
  'Ends': 'Край',
  'Test plan': 'Тестов план',
  'Complimentary': 'Подарен',
  'Kept in the audit log.': 'Пази се в одитния журнал.',
  'Today when empty.': 'Днес, ако е празно.',
  'No end when empty.': 'Без край, ако е празно.',
  'Giving…': 'Даване…',
  'Give Federation': 'Дай Federation',
  // The revoke form
  'Reason to revoke': 'Причина за отмяната',
  'Members, school links and the public page stay; only member and school administration closes.':
    'Членовете, връзките с школи и публичната страница остават; затваря се само управлението на членове и школи.',
  'Revoking…': 'Отменяне…',
  'Revoke': 'Отмени',
  // The trial forms
  'Length': 'Продължителност',
  '{n} month': '{n} месец',
  '{n} months': '{n} месеца',
  'Starting…': 'Стартиране…',
  'Start the trial': 'Започни пробния период',
  'Reason to end the trial': 'Причина за прекратяване на пробния период',
  'Members, school links and the public page stay; nothing is charged.': 'Членовете, връзките с школи и публичната страница остават; нищо не се таксува.',
  'Ending…': 'Прекратяване…',
  'End the trial now': 'Прекрати пробния период сега',
};
