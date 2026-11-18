// Bulgarian for the control panel: organizations (docs/adr/0043-admin-bulgarian.md).
// Keys are the English text exactly as the components pass it to t(); {name} placeholders stay as they are.

import type { AdminDict } from '../translate';

export const BG_ORGANIZATIONS: AdminDict = {
  // Shared with the shell and other areas
  'Organizations': 'Организации',
  'Control panel': 'Контролен панел',
  'Administration': 'Администрация',
  'Back to administration': 'Обратно към администрацията',
  'Show': 'Покажи',
  'Clear': 'Изчисти',
  'Plan': 'План',
  'Plan grants': 'Подарени планове',
  'Active': 'Активен',
  'Ended': 'Приключил',
  'Waiting for review': 'Чака преглед',
  'Approved': 'Одобрено',

  // The list
  "We couldn't load the organizations. Nothing was changed.": 'Организациите не можаха да се заредят. Нищо не е променено.',
  'matching': 'съвпадащи',
  'in all': 'общо',
  'waiting for review': 'чакат преглед',
  'approved': 'одобрени',
  'Approval is decided in the review queue. The plan is separate: give an approved organization a test or complimentary Federation plan on its page.':
    'Одобрението се решава в опашката за преглед. Планът е отделно: дайте на одобрена организация тестов или подарен план Federation на нейната страница.',
  'Name or address': 'Име или адрес',
  'Approval': 'Одобрение',
  'Any ({count})': 'Всички ({count})',
  'Waiting for review ({count})': 'Чакат преглед ({count})',
  'Approved ({count})': 'Одобрени ({count})',
  'Suspended ({count})': 'Спрени ({count})',
  'Declined ({count})': 'Отказани ({count})',
  'Any plan': 'Всеки план',
  'No plan': 'Без план',
  'waiting first, then by name': 'първо чакащите, после по име',
  'No organization matches these filters. Change them, or clear them.': 'Няма организация, която да отговаря на тези филтри. Променете ги или ги изчистете.',
  'No organization has applied.': 'Още няма кандидатствала организация.',
  'Organizations, waiting for review first, then by name': 'Организации, първо чакащите преглед, после по име',
  'Organization': 'Организация',
  'Admins': 'Администратори',
  'Actions': 'Действия',
  'until {date}': 'до {date}',
  'Plan and details': 'План и подробности',
  ' of {name}': ' на {name}',
  'Open the application': 'Отвори заявлението',
  'Pages of organizations': 'Страници с организации',

  // Labels from the services
  'Federation': 'Федерация',
  'Association': 'Асоциация',
  'Group of schools': 'Група школи',
  'Declined': 'Отказано',
  'Suspended': 'Спряно',
  'Payment': 'Плащане',
  'Starts later': 'Започва по-късно',
  'Revoked': 'Отменен',
  'Trial running': 'Пробният период тече',
  'Continued as a subscription': 'Продължен като абонамент',
  'Trial ended': 'Пробният период приключи',
  'Trial ended early': 'Пробният период е прекратен',
  'The trial runs until {date} with no card and no charge. To continue after that, choose monthly or yearly billing; if you do nothing, the trial simply ends and nothing is deleted.':
    'Пробният период трае до {date} без карта и без плащане. За да продължи след това, изберете месечно или годишно плащане; ако не направите нищо, пробният период просто приключва и нищо не се изтрива.',
  'The organization subscribed during the trial on {date}; the first payment is due when the trial period ends.':
    'Организацията се абонира по време на пробния период на {date}; първото плащане е дължимо, когато пробният период приключи.',
  'The trial ended on {date} without a subscription. Nothing was charged, and the members, school links and history are kept.':
    'Пробният период приключи на {date} без абонамент. Нищо не е таксувано, а членовете, връзките с школи и историята се пазят.',
  'An administrator ended the trial on {date}. Nothing was charged, and the members, school links and history are kept.':
    'Администратор прекрати пробния период на {date}. Нищо не е таксувано, а членовете, връзките с школи и историята се пазят.',

  // Service messages
  'No such organization.': 'Няма такава организация.',
  'No such plan grant.': 'Няма такъв подарен план.',
  'No such trial.': 'Няма такъв пробен период.',
  'Choose a plan.': 'Изберете план.',
  'Choose a plan grant.': 'Изберете подарен план.',
  'Choose test plan or complimentary.': 'Изберете тестов или подарен план.',
  'Give a reason; it is kept in the audit log.': 'Посочете причина; тя се пази в одитния журнал.',
  'Keep the reason under 500 characters.': 'Причината трябва да е под 500 знака.',
  'Choose 6 or 12 months.': 'Изберете 6 или 12 месеца.',
  'Check the highlighted fields.': 'Проверете отбелязаните полета.',
  'Enter the start as a date, for example 2026-11-01.': 'Въведете началото като дата, например 2026-11-01.',
  'The start cannot be before today.': 'Началото не може да е преди днес.',
  'Choose a date within the next two years.': 'Изберете дата в следващите две години.',
  'Enter the end as a date, for example 2026-12-31.': 'Въведете края като дата, например 2026-12-31.',
  'The end must be after the start.': 'Краят трябва да е след началото.',
  'A plan is given to an approved organization. Approval is decided in the review queue.':
    'План се дава на одобрена организация. Одобрението се решава в опашката за преглед.',
  'The organization holds Federation already. Revoke that grant first to give it for other dates.':
    'Организацията вече има Federation. Първо отменете този подарен план, за да го дадете за други дати.',
  'This plan was already revoked.': 'Този план вече е отменен.',
  'This plan has already ended.': 'Този план вече е приключил.',
  'A trial is given to an approved organization. Approval is decided in the review queue.':
    'Пробен период се дава на одобрена организация. Одобрението се решава в опашката за преглед.',
  'A Federation trial is for federations; this organization is registered as another kind.':
    'Пробният период на Federation е за федерации; тази организация е регистрирана като друг вид.',
  'The organization has had its trial. An organization has one trial.': 'Организацията вече е имала пробен период. Всяка организация има един пробен период.',
  'The organization pays for Federation already.': 'Организацията вече плаща за Federation.',
  'The organization holds Federation already. A trial is for an organization without it.':
    'Организацията вече има Federation. Пробният период е за организация без него.',
  'This trial is not running.': 'Този пробен период не тече.',
  'Something went wrong on our side; nothing was changed. Try again.': 'Нещо се обърка от наша страна; нищо не е променено. Опитайте отново.',

  // One organization
  'Organization not found': 'Организацията не е намерена',
  'Federation was given. The organization’s admins can manage members and schools while it holds.':
    'Federation е даден. Администраторите на организацията могат да управляват членове и школи, докато планът е в сила.',
  'The grant was revoked. Members, school links and the public page stay; member and school administration is closed.':
    'Подареният план е отменен. Членовете, връзките с школи и публичната страница остават; управлението на членове и школи е затворено.',
  'The Federation trial started. The organization’s admins were told; no card is needed and nothing is charged.':
    'Пробният период на Federation започна. Администраторите на организацията са уведомени; не е нужна карта и нищо не се таксува.',
  'The trial was ended. Members, school links and the public page stay; nothing was charged.':
    'Пробният период е прекратен. Членовете, връзките с школи и публичната страница остават; нищо не е таксувано.',
  '{n} admin': '{n} администратор',
  '{n} admins': '{n} администратори',
  ' · until {date}': ' · до {date}',
  'Open the application in the review queue': 'Отвори заявлението в опашката за преглед',
  'Public page': 'Публична страница',
  'No plan was ever given.': 'Досега не е даван план.',
  'From {from} to {to}': 'От {from} до {to}',
  'From {from}, no end date': 'От {from}, без крайна дата',
  ' · by {email}': ' · от {email}',
  'Reason: ': 'Причина: ',
  'Revoked: ': 'Отменен: ',
  '{plan} trial': 'Пробен период на {plan}',
  'A trial without a card. The organization’s admins are told when it starts, 14 and 7 days before it ends and when it ends. If no owner subscribes, it simply ends: nothing is charged and nothing is deleted.':
    'Пробен период без карта. Администраторите на организацията се уведомяват, когато започне, 14 и 7 дни преди края и когато приключи. Ако никой собственик не се абонира, той просто приключва: нищо не се таксува и нищо не се изтрива.',
  'Give {plan}': 'Дай {plan}',
  'A test or complimentary plan only; nothing is charged. {plan}’s price is a proposed price (not final).':
    'Само тестов или подарен план; нищо не се таксува. Цената на {plan} е предложена (не е окончателна).',
};
